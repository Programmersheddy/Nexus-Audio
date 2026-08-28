import React, { useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImageManipulator from 'expo-image-manipulator';

// ─── Gemini API Configuration ───────────────────────────────────────────────
const DEFAULT_GEMINI_API_KEY = ''; // Enter your Gemini API key via the Settings (⚙️) button in the app
// ────────────────────────────────────────────────────────────────────────────
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  Animated,
  StatusBar,
  Dimensions,
  Platform,
  Modal,
  TextInput,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';
import Voice from '@dev-amirzubair/react-native-voice';
import { check, request, PERMISSIONS, RESULTS, openSettings } from 'react-native-permissions';

const { width } = Dimensions.get('window');

export default function App() {
  // Screen and UI states
  const [currentScreen, setCurrentScreen] = useState('home'); // 'home' | 'camera'
  const [voiceStatus, setVoiceStatus] = useState('idle'); // 'idle' | 'listening' | 'processing_command' | 'processing_vision' | 'speaking'
  const [recognizedText, setRecognizedText] = useState('');
  const [logs, setLogs] = useState([]);
  const [base64Info, setBase64Info] = useState(null);

  // Gemini API key state management
  const [geminiApiKey, setGeminiApiKey] = useState(DEFAULT_GEMINI_API_KEY);
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');

  // Permissions
  // NOTE: useCameraPermissions() covers camera only.
  // Microphone for Voice is managed exclusively via react-native-permissions
  // (check/request RECORD_AUDIO) inside startListening() — no separate hook needed.
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  // Refs for tracking latest states in event handlers
  const currentScreenRef = useRef(currentScreen);
  const voiceStatusRef = useRef(voiceStatus);
  const cameraRef = useRef(null);
  const isTransitioningRef = useRef(false);
  const isCapturingRef = useRef(false);
  const geminiApiKeyRef = useRef(DEFAULT_GEMINI_API_KEY);
  const processCommandRef = useRef(null);
  // Tracks whether the user has explicitly activated listening.
  // onSpeechEnd / onSpeechError only auto-restart when this is true,
  // preventing the mic from engaging without the user's direct action.
  const isListeningActiveRef = useRef(false);
  // Caches the most recent partial transcript so onSpeechEnd can act on it
  // if onSpeechResults never fires (common Android bug with this Voice fork).
  const lastPartialRef = useRef('');
  // Tracks whether a final result already fired so onSpeechEnd doesn't double-process.
  const finalResultFiredRef = useRef(false);

  // Sync refs
  useEffect(() => { currentScreenRef.current = currentScreen; }, [currentScreen]);
  useEffect(() => { voiceStatusRef.current = voiceStatus; }, [voiceStatus]);
  useEffect(() => { geminiApiKeyRef.current = geminiApiKey; }, [geminiApiKey]);

  // Pulsing animation for the listening indicator
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (voiceStatus === 'listening') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1.0,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [voiceStatus]);

  // Helper to add timestamped logs on the screen
  const addLog = (message) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${time}] ${message}`, ...prev.slice(0, 19)]);
  };

  // Load saved Gemini API key on mount
  useEffect(() => {
    const loadApiKey = async () => {
      try {
        const savedKey = await AsyncStorage.getItem('gemini_api_key');
        if (savedKey !== null && savedKey.trim() !== '') {
          const trimmed = savedKey.trim();
          setGeminiApiKey(trimmed);
          geminiApiKeyRef.current = trimmed;
          addLog('[System] Custom Gemini API key loaded successfully.');
        } else {
          addLog('[System] Using default Gemini API key.');
        }
      } catch (err) {
        addLog(`[Error] Failed to load custom API key: ${err.message}`);
      }
    };
    loadApiKey();
  }, []);

  // Speaks feedback and restarts listening afterward — but ONLY if
  // the user had explicitly activated listening before this speech began.
  const speakAndListen = (text) => {
    addLog(`[AI] "${text}"`);
    setVoiceStatus('speaking');

    // Capture whether the user had listening active before we interrupt it
    const shouldResumeListen = isListeningActiveRef.current;

    // Stop listening before speaking to avoid feedback loops
    Voice.stop()
      .catch((err) => console.log('Stop voice error during speak:', err))
      .finally(() => {
        Speech.speak(text, {
          onDone: () => {
            if (shouldResumeListen) {
              addLog('[System] Speech done, resuming listener.');
              startListening();
            } else {
              addLog('[System] Speech done. Mic is idle (tap mic to listen).');
              setVoiceStatus('idle');
            }
          },
          onError: (err) => {
            console.error('Speech error:', err);
            if (shouldResumeListen) {
              addLog('[System] Speech error, resuming listener.');
              startListening();
            } else {
              setVoiceStatus('idle');
            }
          },
        });
      });
  };

  // Starts the speech recognition engine, gated behind a runtime permission check.
  // This is the ONLY place Voice.start() is called. It must be triggered by an
  // explicit user action — never called automatically on app load.
  // ─── Command processor ────────────────────────────────────────────────────
  // Single place where recognized text is matched to actions.
  // Called from both onSpeechResults (final) and onSpeechEnd (partial fallback).
  const processCommand = (text) => {
    setRecognizedText(text);
    addLog(`[Voice] Heard: "${text}"`);
    const cleanText = text.toLowerCase().trim();

    // ⚠️ Order matters: more-specific checks FIRST to avoid false matches.
    // "take picture" / vision commands — must come before 'camera' check
    if (
      cleanText.includes('take picture') ||
      cleanText.includes('take a picture') ||
      cleanText.includes('capture') ||
      cleanText.includes('describe') ||
      cleanText.includes('scan') ||
      (cleanText.includes('see') && !cleanText.includes('camera'))
    ) {
      triggerVisionCapture();
      // Go home / navigation back — before generic 'camera' to avoid misfires
    } else if (
      cleanText.includes('go home') ||
      cleanText.includes('home') ||
      cleanText.includes('go back') ||
      cleanText.includes('back') ||
      cleanText.includes('exit') ||
      cleanText.includes('close')
    ) {
      navigateTo('home');
      // Open camera
    } else if (
      cleanText.includes('camera') ||
      cleanText.includes('open camera') ||
      cleanText.includes('go to camera')
    ) {
      navigateTo('camera');
    } else if (cleanText.includes('help') || cleanText.includes('instruction')) {
      readHelpInstructions();
    } else {
      // Unknown command — restart listening for next attempt
      startListening();
    }
  };

  const startListening = async () => {
    const micPermKey = Platform.OS === 'ios'
      ? PERMISSIONS.IOS.MICROPHONE
      : PERMISSIONS.ANDROID.RECORD_AUDIO;

    try {
      // 1. Re-check permission status every time — never rely on cached state
      const status = await check(micPermKey);

      if (status === RESULTS.GRANTED) {
        // 2. Permission confirmed — reset partial tracking and start Voice
        isListeningActiveRef.current = true;
        lastPartialRef.current = '';
        finalResultFiredRef.current = false;
        setVoiceStatus('listening');
        // Destroy any prior session first; ignore errors if never initialized
        try { await Voice.destroy(); } catch (_) { }
        await Voice.start('en-US');

      } else if (status === RESULTS.DENIED) {
        // 3. Not yet asked — request now
        addLog('[Permission] Microphone not granted. Requesting...');
        const requestStatus = await request(micPermKey);
        if (requestStatus === RESULTS.GRANTED) {
          isListeningActiveRef.current = true;
          lastPartialRef.current = '';
          finalResultFiredRef.current = false;
          setVoiceStatus('listening');
          try { await Voice.destroy(); } catch (_) { }
          await Voice.start('en-US');
        } else {
          // User said no — stop retrying; they must tap the button again
          addLog('[Warning] Microphone permission denied by user. Tap mic to retry.');
          isListeningActiveRef.current = false;
          setVoiceStatus('idle');
        }

      } else if (status === RESULTS.BLOCKED) {
        // 4. Permanently denied — only Settings can fix this
        addLog('[Warning] Microphone BLOCKED. Opening device Settings...');
        isListeningActiveRef.current = false;
        setVoiceStatus('idle');
        openSettings().catch(() =>
          addLog('[Error] Could not open device settings.')
        );

      } else {
        // UNAVAILABLE or unknown
        addLog(`[Warning] Microphone unavailable on this device (status: ${status}).`);
        isListeningActiveRef.current = false;
        setVoiceStatus('idle');
      }
    } catch (e) {
      console.error('Voice start error:', e);
      addLog(`[Error] Failed to start voice: ${e.message}`);
      isListeningActiveRef.current = false;
      setVoiceStatus('idle');
    }
  };

  // Stops listening explicitly. Sets the active flag to false so that
  // onSpeechEnd / onSpeechError do not auto-restart the mic.
  const stopListening = async () => {
    isListeningActiveRef.current = false;
    setVoiceStatus('idle');
    try {
      await Voice.stop();
      await Voice.destroy();
      addLog('[System] Listener stopped by user.');
    } catch (e) {
      console.error('Voice stop error:', e);
    }
  };

  // Navigates screens hands-free
  const navigateTo = (screen) => {
    if (currentScreenRef.current === screen) {
      speakAndListen(`You are already on the ${screen} screen.`);
      return;
    }

    addLog(`[System] Navigating to ${screen.toUpperCase()}`);
    setCurrentScreen(screen);
    speakAndListen(`Switching to ${screen} view.`);
  };

  // Captured photo handling and base64 formatting
  const triggerVisionCapture = async () => {
    // If not on camera screen, switch first
    if (currentScreenRef.current !== 'camera') {
      addLog('[Voice Command] Capture requested. Auto-navigating to Camera.');
      isTransitioningRef.current = true;
      setCurrentScreen('camera');

      // Stop listening, announce navigation, then restart mic so user can say "take picture"
      Voice.stop().catch(() => { });
      setVoiceStatus('speaking');

      Speech.speak('Camera is open. Say take picture to scan.', {
        onDone: () => {
          isTransitioningRef.current = false;
          // Restart listening so the user's "take picture" command is heard
          startListening();
        },
        onError: () => {
          isTransitioningRef.current = false;
          startListening();
        }
      });
      return;
    }

    captureAndProcessImage();
  };

  // Core smart vision capture function
  const captureAndProcessImage = async (isRetry = false, retryPhotoData = null) => {
    if (isCapturingRef.current && !isRetry) {
      console.log('Capture already in progress, ignoring duplicate call');
      return;
    }
    isCapturingRef.current = true;
    let photoData = retryPhotoData;

    if (!photoData) {
      if (!cameraRef.current) {
        addLog('[Error] Camera reference not ready.');
        speakAndListen('Sorry, the camera is not initialized yet.');
        isCapturingRef.current = false;
        return;
      }

      // 1. Pause listening so the mic does not intercept background noise
      isListeningActiveRef.current = false;
      try {
        await Voice.stop();
        await Voice.destroy();
      } catch (err) {
        console.warn('Unable to fully stop voice before capture:', err);
      }

      setVoiceStatus('processing_vision');
      addLog('[Camera] Snapping photo — please hold steady...');

      // Give the camera sensor 800 ms to warm up (auto-focus, auto-exposure)
      // before snapping — avoids blurry / dark first-frame captures.
      await new Promise((resolve) => setTimeout(resolve, 800));

      try {
        // 2. Capture raw image path from expo-camera (without base64 for speed)
        const options = { base64: false, quality: 0.8, skipProcessing: false };
        const photo = await cameraRef.current.takePictureAsync(options);

        if (!photo || !photo.uri) {
          throw new Error('No image returned from camera');
        }

        addLog('[Camera] Optimizing image size...');
        // Resize width to max 1024px (maintaining aspect ratio) and compress to 0.5
        const manipResult = await ImageManipulator.manipulateAsync(
          photo.uri,
          [{ resize: { width: 1024 } }],
          { compress: 0.5, base64: true }
        );

        if (!manipResult || !manipResult.base64) {
          throw new Error('Failed to encode optimized image to Base64');
        }

        photoData = manipResult.base64;

        setBase64Info({
          uri: manipResult.uri,
          length: manipResult.base64.length,
          preview: manipResult.base64.substring(0, 50) + '...',
        });
        addLog(`[Success] Base64 formatted: ${manipResult.base64.length} characters.`);
      } catch (err) {
        console.error('Capture/manipulation error:', err);
        addLog(`[Error] Camera capture failed: ${err.message}`);
        speakAndListen('Sorry, I failed to capture the image. Please try again.');
        setCurrentScreen('home');
        isCapturingRef.current = false;
        return;
      }
    }

    try {
      addLog('[Gemini] Sending image to Gemini 2.0 Flash...');
      if (isRetry) {
        Speech.speak('Connection slow. Retrying analysis.');
      } else {
        Speech.speak('Analyzing image, please wait.');
      }

      // 3. Resolve active Gemini API key (checking ref, state, AsyncStorage and default)
      const storedKey = await AsyncStorage.getItem('gemini_api_key');
      const activeKey = (geminiApiKeyRef.current || storedKey || geminiApiKey || DEFAULT_GEMINI_API_KEY || '').trim();

      if (!activeKey) {
        addLog('[Error] No Gemini API key set. Please configure it in Settings.');
        speakAndListen('Vision is not configured. Please open settings and add an API key.');
        isCapturingRef.current = false;
        return;
      }

      const requestBody = {
        contents: [
          {
            parts: [
              {
                text: 'Describe what is in front of this user clearly and concisely in 2 sentences for a blind person.',
              },
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: photoData,
                },
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 150,
          temperature: 0.4,
        },
      };

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(activeKey)}`;

      // Create an AbortController for a 15-second fetch timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 15000);

      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errDetail = '';
        try {
          const errJson = await response.json();
          errDetail = errJson?.error?.message || JSON.stringify(errJson);
        } catch (_) {
          errDetail = await response.text();
        }
        throw new Error(`Gemini API error ${response.status}: ${errDetail}`);
      }

      const geminiData = await response.json();
      const aiText =
        geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ??
        'I could not interpret the image. Please try again.';

      addLog(`[Gemini] Analysis received. Speaking response...`);
      setVoiceStatus('speaking');

      Speech.speak(aiText, {
        onDone: () => {
          addLog('[System] Description spoken. Resuming listener.');
          setCurrentScreen('home');
          setVoiceStatus('idle');
          isCapturingRef.current = false;
          startListening();
        },
        onError: () => {
          addLog('[System] Speech failed. Resuming listener.');
          setCurrentScreen('home');
          setVoiceStatus('idle');
          isCapturingRef.current = false;
          startListening();
        },
      });

    } catch (err) {
      console.error('API error:', err);

      const isTimeout = err.name === 'AbortError' || err.message.includes('timeout') || err.message.includes('aborted');

      if (isTimeout) {
        addLog('[Error] Request timed out after 15 seconds.');
        if (!isRetry) {
          addLog('[System] Initiating automatic retry...');
          Speech.speak('Network is slow, trying again.');
          // Small delay before retrying to let TTS start
          setTimeout(() => {
            captureAndProcessImage(true, photoData);
          }, 1500);
          return;
        } else {
          addLog('[Error] Retry attempt also timed out.');
          speakAndListen('Network connection timed out. Please try again later.');
          setCurrentScreen('home');
          isCapturingRef.current = false;
          return;
        }
      }

      addLog(`[Error] Vision pipeline failed: ${err.message}`);
      if (err.message.includes('429')) {
        addLog('[Tip] Quota exceeded. Set your own API key in Settings (⚙️).');
      } else if (err.message.includes('400') || err.message.includes('key')) {
        addLog('[Tip] Invalid API key. Please check your API key in Settings (⚙️).');
      }
      speakAndListen('Sorry, I encountered an error with the vision analysis. Please try again.');
      setCurrentScreen('home');
      isCapturingRef.current = false;
    }
  };

  // Reads the speech navigation options out loud
  const readHelpInstructions = () => {
    const helpText =
      "Here are the available voice commands. Say camera to open the camera preview. Say home or go back to return here. Say take picture or scan to analyze an image. Or say help to repeat these instructions.";
    speakAndListen(helpText);
  };

  // Sync processCommand to ref so listeners always execute latest version
  useEffect(() => {
    processCommandRef.current = processCommand;
  });

  // Voice Event Listeners setup
  useEffect(() => {
    Voice.onSpeechStart = () => {
      setVoiceStatus('listening');
    };

    Voice.onSpeechResults = (e) => {
      if (e.value && e.value.length > 0) {
        // Mark that a final result fired so onSpeechEnd doesn't double-process
        finalResultFiredRef.current = true;
        if (processCommandRef.current) {
          processCommandRef.current(e.value[0]);
        } else {
          processCommand(e.value[0]);
        }
      }
    };

    Voice.onSpeechPartialResults = (e) => {
      if (e.value && e.value.length > 0) {
        const partial = e.value[0];
        // Update display and save for fallback use in onSpeechEnd
        setRecognizedText(partial);
        lastPartialRef.current = partial;
      }
    };

    Voice.onSpeechError = (e) => {
      console.log('Voice listener error:', e);
      const errorCode = e?.error?.code ?? e?.error ?? null;

      // Error codes that mean we should NOT retry automatically:
      //   5  = Client side error (often a stale/double-start)
      //   9  = Insufficient permissions (RECORD_AUDIO denied at OS level)
      //   13 = No match (harmless, but restart will loop if speech engine is broken)
      // Error code 7 = No speech detected (normal timeout) — safe to restart.
      const isFatalError = ['5', '9', 5, 9].includes(errorCode);

      if (isFatalError) {
        addLog(`[Warning] Voice stopped due to fatal error (code ${errorCode}). Check mic permission.`);
        isListeningActiveRef.current = false;
        setVoiceStatus('idle');
        return;
      }

      // For recoverable errors (e.g., timeout code 7), restart only if the
      // user had explicitly activated listening — prevents infinite loops.
      if (
        isListeningActiveRef.current &&
        voiceStatusRef.current !== 'speaking' &&
        voiceStatusRef.current !== 'processing_vision' &&
        !isTransitioningRef.current
      ) {
        setTimeout(() => {
          startListening();
        }, 800);
      }
    };

    Voice.onSpeechEnd = () => {
      // FALLBACK: If onSpeechResults never fired but we have a partial transcript,
      // process it now. This handles the Android bug where final results don't arrive.
      if (
        !finalResultFiredRef.current &&
        lastPartialRef.current.trim().length > 0 &&
        isListeningActiveRef.current &&
        voiceStatusRef.current !== 'speaking' &&
        voiceStatusRef.current !== 'processing_vision' &&
        !isTransitioningRef.current
      ) {
        addLog('[System] Final result missed — using partial as fallback.');
        if (processCommandRef.current) {
          processCommandRef.current(lastPartialRef.current);
        } else {
          processCommand(lastPartialRef.current);
        }
        return;
      }

      // Normal path: final result already fired OR nothing was heard — restart.
      if (
        isListeningActiveRef.current &&
        voiceStatusRef.current !== 'speaking' &&
        voiceStatusRef.current !== 'processing_vision' &&
        !isTransitioningRef.current
      ) {
        startListening();
      }
    };

    // Greet the user on mount — does NOT start the mic automatically.
    // The user must explicitly tap the mic button to begin listening.
    const welcomeUser = async () => {
      addLog('[System] App loaded. Tap the mic button to start listening.');

      // Request camera permission (expo-camera UI hook)
      if (cameraPermission?.canAskAgain && !cameraPermission.granted) {
        await requestCameraPermission();
      }

      // Pre-request the RECORD_AUDIO permission via react-native-permissions
      // so the OS dialog appears at launch rather than the first time the user
      // taps the mic. This eliminates the "stale denied" race condition.
      const micPermKey = Platform.OS === 'ios'
        ? PERMISSIONS.IOS.MICROPHONE
        : PERMISSIONS.ANDROID.RECORD_AUDIO;
      const micStatus = await check(micPermKey);
      if (micStatus === RESULTS.DENIED) {
        addLog('[Permission] Requesting RECORD_AUDIO permission upfront...');
        await request(micPermKey);
      }

      // Announce the app is ready but do NOT call startListening().
      // Voice.start() is only called when the user taps the mic button.
      Speech.speak(
        'Welcome to Nexus Audio. Tap the microphone button to activate your voice assistant.',
        { onDone: () => addLog('[System] Welcome message complete. Mic is idle.') }
      );
    };

    welcomeUser();

    return () => {
      isListeningActiveRef.current = false;
      Voice.destroy().then(Voice.removeAllListeners);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount only — not on every permission state change

  // Render requesting state if camera permission is not loaded yet
  if (!cameraPermission) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6366F1" />
        <Text style={styles.loadingText}>Initializing Permissions...</Text>
      </View>
    );
  }

  // Render manual permissions request UI if camera not granted
  // (Mic is handled inside startListening via react-native-permissions)
  if (!cameraPermission.granted) {
    return (
      <SafeAreaView style={styles.permissionScreen}>
        <View style={styles.glassCard}>
          <Text style={styles.titleText}>Nexus Audio MVP</Text>
          <Text style={styles.descriptionText}>
            This hands-free assistant requires Camera and Microphone permissions to operate.
          </Text>

          <View style={styles.permissionItem}>
            <Text style={styles.permissionName}>Microphone (Speech Rec)</Text>
            <Text style={[styles.permissionStatus, styles.statusOk]}>
              Managed at runtime
            </Text>
          </View>

          <View style={styles.permissionItem}>
            <Text style={styles.permissionName}>Camera (Smart Vision)</Text>
            <Text style={[styles.permissionStatus, cameraPermission.granted ? styles.statusOk : styles.statusMissing]}>
              {cameraPermission.granted ? 'Granted' : 'Missing'}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={async () => {
              await requestCameraPermission();
            }}
          >
            <Text style={styles.actionButtonText}>Grant Camera Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Main UI render
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Top Banner showing app status */}
      <View style={styles.header}>
        <Text style={styles.logo}>NEXUS <Text style={styles.logoLight}>AUDIO</Text></Text>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => {
              setTempApiKey(geminiApiKey === DEFAULT_GEMINI_API_KEY ? '' : geminiApiKey);
              setIsSettingsVisible(true);
            }}
            accessibilityLabel="Open settings"
          >
            <Text style={styles.settingsButtonText}>⚙️</Text>
          </TouchableOpacity>
          <View style={styles.statusBadgeContainer}>
            <View style={[styles.statusDot, { backgroundColor: getStatusColor(voiceStatus) }]} />
            <Text style={styles.statusLabel}>{voiceStatus.toUpperCase()}</Text>
          </View>
        </View>
      </View>

      {/* Main View Area */}
      <View style={styles.mainView}>
        {currentScreen === 'home' ? (
          <View style={styles.dashboardContainer}>
            {/* Visualizer card representing AI State */}
            <View style={styles.visualizerCard}>
              <View style={styles.orbContainer}>
                <Animated.View style={[
                  styles.glowOrb,
                  {
                    transform: [{ scale: pulseAnim }],
                    backgroundColor: getGlowColor(voiceStatus),
                    shadowColor: getGlowColor(voiceStatus),
                  }
                ]} />
                <View style={styles.innerOrb}>
                  {voiceStatus === 'processing_vision' ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.orbText}>🎙️</Text>
                  )}
                </View>
              </View>

              <Text style={styles.captionText}>
                {voiceStatus === 'listening' ? 'Listening...' :
                  voiceStatus === 'processing_vision' ? 'Processing Smart Vision...' :
                    voiceStatus === 'speaking' ? 'Assistant Speaking...' : 'Tap mic to start'}
              </Text>

              {/* Explicit mic toggle button — runtime permission gated */}
              <TouchableOpacity
                style={[
                  styles.micButton,
                  voiceStatus === 'listening' && styles.micButtonActive,
                  (voiceStatus === 'speaking' || voiceStatus === 'processing_vision') && styles.micButtonDisabled,
                ]}
                onPress={() => {
                  if (voiceStatus === 'listening') {
                    stopListening();
                  } else if (voiceStatus === 'idle') {
                    startListening();
                  }
                }}
                disabled={voiceStatus === 'speaking' || voiceStatus === 'processing_vision'}
                accessibilityLabel={voiceStatus === 'listening' ? 'Stop listening' : 'Start listening'}
              >
                <Text style={styles.micButtonText}>
                  {voiceStatus === 'listening' ? '⏹ Stop' : '🎙 Start Listening'}
                </Text>
              </TouchableOpacity>

              {/* Real-time transcribed text */}
              <View style={styles.transcriptionBox}>
                <Text style={styles.transcriptionLabel}>Live Transcription:</Text>
                <Text style={styles.transcriptionText}>
                  {recognizedText || 'Heard text will appear here...'}
                </Text>
              </View>
            </View>

            {/* Quick tips list of commands */}
            <View style={styles.commandGuide}>
              <Text style={styles.guideTitle}>Try saying:</Text>
              <Text style={styles.guideItem}>🗣️ "Go to camera"</Text>
              <Text style={styles.guideItem}>🗣️ "Take picture" or "Scan"</Text>
              <Text style={styles.guideItem}>🗣️ "Help" for instructions</Text>
            </View>
          </View>
        ) : (
          /* Live Camera Preview Screen */
          <View style={styles.cameraContainer}>
            <CameraView
              style={styles.camera}
              ref={cameraRef}
              facing="back"
            />
            {/* Overlay rendered on top of the camera, not inside it */}
            <View style={styles.cameraOverlay}>
              <View style={styles.cameraBanner}>
                <Text style={styles.cameraBannerText}>Smart Vision Active</Text>
                <Text style={styles.cameraSubtext}>Say "take picture" to scan or "go home" to exit</Text>
              </View>

              {/* Status Indicator over Camera */}
              <View style={styles.cameraFooter}>
                <View style={styles.cameraStatusCard}>
                  <ActivityIndicator size="small" color="#10B981" />
                  <Text style={styles.cameraStatusText}>
                    {voiceStatus === 'processing_vision' ? 'Sending to Gemini 2.0 Flash...' : 'Listening for "take picture"...'}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}
      </View>

      {/* Console/Logs Console at bottom */}
      <View style={styles.logConsole}>
        <Text style={styles.logTitle}>System & AI Event Feed</Text>
        <ScrollView style={styles.logScroll} contentContainerStyle={styles.logScrollContent}>
          {base64Info && (
            <View style={styles.base64Badge}>
              <Text style={styles.base64Text}>
                📸 Image base64 encoded: {base64Info.length} chars (quality: 0.5)
              </Text>
            </View>
          )}
          {logs.map((log, index) => (
            <Text
              key={index}
              style={[
                styles.logLine,
                log.includes('[AI]') && styles.aiLog,
                log.includes('[Voice]') && styles.voiceLog,
                log.includes('[Error]') && styles.errorLog,
              ]}
            >
              {log}
            </Text>
          ))}
          {logs.length === 0 && (
            <Text style={styles.emptyLogs}>No events logged yet.</Text>
          )}
        </ScrollView>
      </View>

      {/* Settings Modal */}
      <Modal
        visible={isSettingsVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsSettingsVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Gemini API Settings</Text>
            <Text style={styles.modalDescription}>
              Configure your custom Gemini API key to avoid 429 quota limits. Get a free API key from:
            </Text>
            <Text
              style={styles.linkText}
              onPress={() => {
                addLog('[System] Visit https://aistudio.google.com/app/apikey to get a key.');
              }}
            >
              https://aistudio.google.com/app/apikey
            </Text>

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Gemini API Key</Text>
              <TextInput
                style={styles.textInput}
                placeholder="AIzaSy..."
                placeholderTextColor="#64748B"
                value={tempApiKey}
                onChangeText={setTempApiKey}
                secureTextEntry={true}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.inputHelp}>
                {geminiApiKey === DEFAULT_GEMINI_API_KEY
                  ? 'Currently using the shared default key (runs out of quota easily).'
                  : 'Currently using your custom API key.'}
              </Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setIsSettingsVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, styles.saveButton]}
                onPress={async () => {
                  try {
                    const trimmedKey = tempApiKey.trim();
                    if (trimmedKey === '') {
                      // Reset to default
                      await AsyncStorage.removeItem('gemini_api_key');
                      setGeminiApiKey(DEFAULT_GEMINI_API_KEY);
                      geminiApiKeyRef.current = DEFAULT_GEMINI_API_KEY;
                      addLog('[System] Reset Gemini API key to default.');
                    } else {
                      await AsyncStorage.setItem('gemini_api_key', trimmedKey);
                      setGeminiApiKey(trimmedKey);
                      geminiApiKeyRef.current = trimmedKey;
                      addLog('[System] Custom Gemini API key saved successfully.');
                    }
                    setIsSettingsVisible(false);
                  } catch (err) {
                    addLog(`[Error] Failed to save API key: ${err.message}`);
                  }
                }}
              >
                <Text style={styles.saveButtonText}>Save</Text>
              </TouchableOpacity>
            </View>

            {geminiApiKey !== DEFAULT_GEMINI_API_KEY && (
              <TouchableOpacity
                style={styles.resetButton}
                onPress={async () => {
                  try {
                    await AsyncStorage.removeItem('gemini_api_key');
                    setGeminiApiKey(DEFAULT_GEMINI_API_KEY);
                    geminiApiKeyRef.current = DEFAULT_GEMINI_API_KEY;
                    setTempApiKey('');
                    addLog('[System] Reset Gemini API key to default.');
                    setIsSettingsVisible(false);
                  } catch (err) {
                    addLog(`[Error] Failed to reset API key: ${err.message}`);
                  }
                }}
              >
                <Text style={styles.resetButtonText}>Reset to Default Key</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// Helpers for dynamic styling colors
const getStatusColor = (status) => {
  switch (status) {
    case 'listening': return '#10B981'; // Green
    case 'processing_vision': return '#F59E0B'; // Orange/Yellow
    case 'speaking': return '#8B5CF6'; // Purple
    default: return '#64748B'; // Slate
  }
};

const getGlowColor = (status) => {
  switch (status) {
    case 'listening': return 'rgba(16, 185, 129, 0.4)';
    case 'processing_vision': return 'rgba(245, 158, 11, 0.4)';
    case 'speaking': return 'rgba(139, 92, 246, 0.4)';
    default: return 'rgba(100, 116, 139, 0.2)';
  }
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#090D16', // Sleek dark body
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#090D16',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#94A3B8',
    marginTop: 10,
    fontSize: 16,
  },
  permissionScreen: {
    flex: 1,
    backgroundColor: '#090D16',
    justifyContent: 'center',
    padding: 24,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 24 : 24,
  },
  glassCard: {
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#334155',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  titleText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 10,
    textAlign: 'center',
  },
  descriptionText: {
    color: '#94A3B8',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
  permissionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  permissionName: {
    color: '#E2E8F0',
    fontSize: 15,
  },
  permissionStatus: {
    fontWeight: 'bold',
    fontSize: 15,
  },
  statusOk: {
    color: '#10B981',
  },
  statusMissing: {
    color: '#EF4444',
  },
  actionButton: {
    backgroundColor: '#6366F1',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 24,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  logo: {
    color: '#6366F1',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  logoLight: {
    color: '#FFFFFF',
    fontWeight: '400',
  },
  statusBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusLabel: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  mainView: {
    flex: 1.2,
    justifyContent: 'center',
  },
  dashboardContainer: {
    flex: 1,
    justifyContent: 'space-evenly',
    alignItems: 'center',
    padding: 20,
  },
  visualizerCard: {
    width: width - 40,
    backgroundColor: '#111827',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#1F2937',
    padding: 24,
    alignItems: 'center',
  },
  orbContainer: {
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  glowOrb: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: 45,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 15,
  },
  innerOrb: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#1E293B',
    borderWidth: 2,
    borderColor: '#475569',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  orbText: {
    fontSize: 24,
  },
  captionText: {
    color: '#E2E8F0',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  transcriptionBox: {
    width: '100%',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  transcriptionLabel: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  transcriptionText: {
    color: '#F8FAFC',
    fontSize: 15,
    lineHeight: 20,
  },
  commandGuide: {
    width: width - 40,
    backgroundColor: '#0F172A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 16,
  },
  guideTitle: {
    color: '#6366F1',
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  guideItem: {
    color: '#94A3B8',
    fontSize: 14,
    marginVertical: 4,
  },
  cameraContainer: {
    flex: 1,
    margin: 20,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#312E81',
  },
  // CameraView fills container naturally with flex (not absoluteFillObject)
  camera: {
    flex: 1,
  },
  // Overlay sits on top of the camera using absolute positioning
  cameraOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  cameraBanner: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    padding: 16,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  cameraBannerText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  cameraSubtext: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 4,
  },
  cameraFooter: {
    padding: 20,
    alignItems: 'center',
  },
  cameraStatusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#10B981',
  },
  cameraStatusText: {
    color: '#10B981',
    fontSize: 13,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  logConsole: {
    flex: 0.8,
    backgroundColor: '#020617',
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    paddingHorizontal: 20,
    paddingTop: 15,
  },
  logTitle: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  logScroll: {
    flex: 1,
  },
  logScrollContent: {
    paddingBottom: 20,
  },
  logLine: {
    color: '#94A3B8',
    fontFamily: 'monospace',
    fontSize: 11,
    marginVertical: 2,
    lineHeight: 15,
  },
  voiceLog: {
    color: '#22D3EE', // Cyan for user voice inputs
  },
  aiLog: {
    color: '#34D399', // Emerald/Green for AI speaking replies
  },
  errorLog: {
    color: '#F87171', // Red for errors
  },
  emptyLogs: {
    color: '#475569',
    fontFamily: 'monospace',
    fontSize: 11,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 20,
  },
  base64Badge: {
    backgroundColor: '#312E81',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginVertical: 4,
  },
  base64Text: {
    color: '#C7D2FE',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  // Mic toggle button — the only entry point to Voice.start()
  micButton: {
    backgroundColor: '#1E293B',
    borderRadius: 50,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderWidth: 2,
    borderColor: '#475569',
    marginVertical: 16,
    alignItems: 'center',
    minWidth: 180,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  micButtonActive: {
    backgroundColor: '#064E3B',
    borderColor: '#10B981',
    shadowColor: '#10B981',
    shadowOpacity: 0.5,
  },
  micButtonDisabled: {
    opacity: 0.4,
  },
  micButtonText: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingsButton: {
    backgroundColor: '#1E293B',
    padding: 8,
    borderRadius: 50,
    borderWidth: 1,
    borderColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  settingsButtonText: {
    fontSize: 16,
    color: '#FFFFFF',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(9, 13, 22, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#1E293B',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#334155',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 10,
    textAlign: 'center',
  },
  modalDescription: {
    color: '#94A3B8',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 8,
  },
  linkText: {
    color: '#6366F1',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    textDecorationLine: 'underline',
  },
  inputContainer: {
    width: '100%',
    marginBottom: 24,
  },
  inputLabel: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: '#0F172A',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    color: '#FFFFFF',
    fontSize: 15,
  },
  inputHelp: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 6,
    fontStyle: 'italic',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: '#334155',
  },
  cancelButtonText: {
    color: '#E2E8F0',
    fontWeight: 'bold',
    fontSize: 15,
  },
  saveButton: {
    backgroundColor: '#6366F1',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 15,
  },
  resetButton: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 8,
  },
  resetButtonText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
