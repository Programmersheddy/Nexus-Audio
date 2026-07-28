import React, { useState, useEffect, useRef } from 'react';

// ─── Gemini API Configuration ───────────────────────────────────────────────
// Replace the empty string with your Gemini API key from:
// https://aistudio.google.com/app/apikey
const GEMINI_API_KEY = 'AQ.Ab8RN6I9OKhlmmHUwArk1xvYGlUOGeUh0Spah-wRofEvAzcvSA'; // <-- PASTE YOUR KEY HERE
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
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

    if (cleanText.includes('camera') || cleanText.includes('open camera') || cleanText.includes('go to camera')) {
      navigateTo('camera');
    } else if (
      cleanText.includes('home') ||
      cleanText.includes('go back') ||
      cleanText.includes('back') ||
      cleanText.includes('exit') ||
      cleanText.includes('close')
    ) {
      navigateTo('home');
    } else if (
      cleanText.includes('take picture') ||
      cleanText.includes('capture') ||
      cleanText.includes('describe') ||
      cleanText.includes('scan') ||
      cleanText.includes('see')
    ) {
      triggerVisionCapture();
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
        try { await Voice.destroy(); } catch (_) {}
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
          try { await Voice.destroy(); } catch (_) {}
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

      // Stop listening, announce navigation, then wait for mount before taking picture
      Voice.stop().catch(() => { });
      setVoiceStatus('speaking');

      Speech.speak('Opening camera for vision scan. Hold steady.', {
        onDone: () => {
          setTimeout(() => {
            isTransitioningRef.current = false;
            captureAndProcessImage();
          }, 1500); // Allow camera layout to mount and settle
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
  const captureAndProcessImage = async () => {
    if (!cameraRef.current) {
      addLog('[Error] Camera reference not ready.');
      speakAndListen('Sorry, the camera is not initialized yet.');
      return;
    }

    setVoiceStatus('processing_vision');
    addLog('[Camera] Snapping photo and formatting to Base64...');

    try {
      // 1. Capture base64 string directly from expo-camera
      const options = { base64: true, quality: 0.5, skipProcessing: false };
      const photo = await cameraRef.current.takePictureAsync(options);

      if (!photo || !photo.base64) {
        throw new Error('No base64 data returned from camera');
      }

      setBase64Info({
        uri: photo.uri,
        length: photo.base64.length,
        preview: photo.base64.substring(0, 50) + '...',
      });

      addLog(`[Success] Base64 formatted: ${photo.base64.length} characters.`);
      addLog('[Gemini] Sending image to Gemini 2.0 Flash...');

      // 2. Send to Gemini 2.0 Flash via REST API
      if (!GEMINI_API_KEY) {
        addLog('[Error] No Gemini API key set. Please add your key in App.js.');
        speakAndListen('Vision is not configured. Please add a Gemini API key.');
        return;
      }

      const requestBody = {
        contents: [
          {
            parts: [
              {
                text: 'Describe what you see in this image in a clear, natural, 2 to 3 sentence response. Speak directly as if you are a helpful voice assistant describing the scene to someone who cannot see.',
              },
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: photo.base64,
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

      const response = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API error ${response.status}: ${errText}`);
      }

      const geminiData = await response.json();
      const aiText =
        geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ??
        'I could not interpret the image. Please try again.';

      addLog(`[Gemini] Analysis received. Speaking response...`);
      setVoiceStatus('speaking');

      Speech.speak(aiText, {
        onDone: () => {
          setCurrentScreen('home');
          Speech.speak('Returning to home dashboard.', {
            onDone: () => startListening(),
          });
        },
        onError: () => {
          setCurrentScreen('home');
          startListening();
        },
      });

    } catch (err) {
      console.error('Capture/AI error:', err);
      addLog(`[Error] Vision pipeline failed: ${err.message}`);
      speakAndListen('Sorry, I encountered an error with the vision analysis. Please try again.');
    }
  };

  // Reads the speech navigation options out loud
  const readHelpInstructions = () => {
    const helpText =
      "Here are the available voice commands. Say camera to open the camera preview. Say home or go back to return here. Say take picture or scan to analyze an image. Or say help to repeat these instructions.";
    speakAndListen(helpText);
  };

  // Voice Event Listeners setup
  useEffect(() => {
    Voice.onSpeechStart = () => {
      setVoiceStatus('listening');
    };

    Voice.onSpeechResults = (e) => {
      if (e.value && e.value.length > 0) {
        // Mark that a final result fired so onSpeechEnd doesn't double-process
        finalResultFiredRef.current = true;
        processCommand(e.value[0]);
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
        processCommand(lastPartialRef.current);
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
        <View style={styles.statusBadgeContainer}>
          <View style={[styles.statusDot, { backgroundColor: getStatusColor(voiceStatus) }]} />
          <Text style={styles.statusLabel}>{voiceStatus.toUpperCase()}</Text>
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
              style={StyleSheet.absoluteFillObject}
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
});
