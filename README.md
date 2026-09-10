# Nexus Audio 🎧👁️

Nexus Audio is an AI-native productivity and accessibility platform designed specifically to provide a superior, eyes-free experience for users, moving far beyond traditional screen readers through intelligent, multimodal interactions[cite: 2].

---

## 🚀 Current Working MVP
The current version of Nexus Audio features a robust, working core focusing on hands-on AI accessibility:
* **Voice-Controlled Vision Pipeline:** Tap the mic or use voice commands to capture your physical surroundings via the device camera[cite: 2].
* **Real-Time Multimodal Analysis:** Integrates Google Gemini AI to analyze environmental context, read documents, and provide immediate audio/text feedback.
* **Dynamic API Management:** Secure local storage for custom user API keys, ensuring smooth runtime execution.

---

## 🗺️ Full Product Vision & Roadmap
Nexus Audio is built to scale into a comprehensive ecosystem addressing educational and daily navigation barriers. The full-fledged vision encompasses the following core features:

1. **100% Voice-First Navigation**
   * **Natural Language Control:** Navigate the entire application using conversational commands such as "Play the Biology lecture," "Go to my bookmarks," or "Stop."[cite: 2]
   * **No Touch Required:** Designed to eliminate the need for complex touch gestures or locating small buttons on a screen[cite: 2].
   * **Always-Listening Mode:** Once activated, the app continuously listens for commands, providing a truly hands-free experience[cite: 2].

2. **Intelligent "Recall" Assistant (Gemini AI)**
   * **Conversational Search:** Ask questions about audio content in natural language, such as "What did the professor say about the exam date?"[cite: 2]
   * **Context-Aware Answers:** The AI analyzes bookmarks and notes to provide specific answers rather than simple keyword matches[cite: 2].
   * **Deep Search (RAG):** Instead of listening linearly, jump instantly to the exact moment a topic was discussed based on the AI's analysis[cite: 2].

3. **Smart Vision (Multimodal AI)**
   * **Visual Question Answering:** Use the device camera to take a picture of a physical document, whiteboard, or environment to interact with it[cite: 2].
   * **Beyond OCR:** Understands layout and context. Users can ask, "Summarize this page," "What are the prices on this menu?" or "Describe the scene in front of me."[cite: 2]
   * **Environmental Awareness:** Provides detailed descriptions of the physical surroundings to assist with navigation and object identification[cite: 2].

4. **Intelligent Bookmarking & Bluetooth Tactile Integration**
   * **Voice-Annotated Bookmarks:** Attach a voice note instantly to a timestamp (e.g., "Mark this as important for the final project").[cite: 2]
   * **Bluetooth & Tactile Integration:** Designed to pair with Bluetooth hardware and physical interfaces for instant, haptic-confirmed bookmarking and navigation while on the move[cite: 2].
   * **Semantic Organization:** Bookmarks function as searchable data points that structure long audio files into navigable chapters[cite: 2].

5. **Local Dialect Support (Cultural Accessibility)**
   * **Multi-Language Interface:** Full support for Nigerian English, Pidgin, Yoruba, Hausa, and Igbo[cite: 2].
   * **Localized AI Responses:** The assistant replies in the user's selected language, ensuring technology is accessible to those who are not fluent in standard English[cite: 2].

6. **Cloud-Native Collaboration**
   * **Real-Time Sync:** User data, including bookmarks, playback positions, and notes, is synced instantly to the cloud for seamless switching between devices[cite: 2].
   * **Study Groups:** Allows users to share audio files along with their "knowledge layer" (bookmarks and notes) to collaborate with peers[cite: 2].

7. **Universal Document Import (Planned)**
   * **Format Agnosticism:** Direct support for importing PDF, EPUB, and Word documents[cite: 2].
   * **Instant Audio Conversion:** Automatically converts text-heavy documents into high-quality, navigable audiobooks[cite: 2].

8. **Offline Resilience**
   * **Local Caching:** Caches data locally to ensure access to bookmarks and playback history even with unstable or no internet connection[cite: 2].
   * **Offline Mode:** Core playback and navigation features remain fully functional without active data[cite: 2].

---

## 📖 How to Use Nexus Audio (User Guide)

> The complete official user guide is available as a PDF: **[HOW_TO_USE_NEXUS_AUDIO.pdf](./HOW_TO_USE_NEXUS_AUDIO.pdf)** — Voice-Powered AI Assistant for the Visually Impaired, Version 1.0 (August 2026). The full guide is reproduced below.

### 1. System Requirements
* **Operating System:** Android 8.0 (Oreo) or higher
* **Storage:** At least 100 MB of free space
* **Internet Connection:** Required for AI image analysis
* **Camera:** A working rear-facing camera
* **Microphone:** A working built-in microphone
* **Speaker / Earphones:** For audio feedback

### 2. Downloading and Installing the App
1. **Open the installation link** in your Android browser:
   https://expo.dev/accounts/programmersheddy/projects/THE-AUDIO/builds/31ee69b5-6fdd-477e-a212-dfacb15978da
   (You can also scan the QR code provided separately to open the link directly.)
2. **Download the APK file** — tap the Download button, wait for the download to finish, then tap the notification to begin installation.
3. **Allow installation from unknown sources** — when prompted "Your phone is not allowed to install unknown apps from this source," tap **Settings** → toggle ON **"Allow from this source"** → press back.
4. **Install the app** — tap **Install**, then **Open** (or find the app icon on your home screen later).

### 3. First-Time Setup
* **Grant Camera Permission** — when asked *"Allow Nexus Audio to take pictures and record video?"*, tap **Allow**. Required for Smart Vision.
* **Grant Microphone Permission** — when asked *"Allow Nexus Audio to record audio?"*, tap **Allow**. Required for voice commands.
  *If either was denied by mistake:* go to **Settings → Apps → Nexus Audio → Permissions** and enable Camera and Microphone.
* **Listen for the Welcome Message** — the app will speak: *"Welcome to Nexus Audio. Tap the microphone button to activate your voice assistant."* This confirms everything is working.

### 4. Setting Up Your Gemini API Key
The AI image analysis requires a free Google Gemini API key:
1. Visit **https://aistudio.google.com/app/apikey** and sign in with a Google account.
2. Click **Create API Key** and copy it (it starts with `AIzaSy...`).
3. In the app, tap the **Settings (⚙️)** icon in the top-right corner.
4. Tap the **"Gemini API Key"** text box, paste your key, and tap **Save**.

> ⚠️ Without a valid API key, the "Take Picture" and "Scan" voice commands will not work. Your key is stored securely **on your device only** and is never shared.

### 5. Using the App (Voice Commands)
1. On the home screen, tap the large **"🎙 Start Listening"** button.
2. The button changes to **"⏹ Stop"** and a green pulsing orb appears — the app is now listening.
3. You'll see live text of what the app hears below the orb.

| Command | What Happens |
|---|---|
| *"Go to camera" / "Open camera" / "Camera"* | Switches to the camera screen to prepare for a picture. |
| *"Take picture" / "Take a picture" / "Capture" / "Scan"* | Opens the camera if needed, takes a photo, and sends it to the AI. The AI describes what it sees out loud. |
| *"Describe" / "See"* | Same as "Take picture" — describes your surroundings. |
| *"Go home" / "Home" / "Go back" / "Back" / "Exit"* | Returns to the main home screen. |
| *"Help" / "Instructions"* | Reads all available voice commands aloud. |

### 6. How Smart Vision Works
1. Say **"Take picture"** — if not on the camera screen, the app switches there and says: *"Camera is open. Say take picture to scan."*
2. Hold the phone steady with the rear camera facing what you want described.
3. Say **"Take picture"** again — the app says *"Analyzing image, please wait."*
4. Within a few seconds, the AI speaks a clear 2-sentence description of what's in front of you.

*Example AI responses:*
> *"There is a dining table in front of you with four chairs around it. A plate of food is placed on the table."*
> *"You are facing a road with cars parked on both sides. There is a pedestrian crossing directly ahead of you."*

After the description, the app automatically returns to the home screen and resumes listening for your next command.

### 7. Understanding the Status Indicator
The coloured dot at the top-right of the screen tells you what the app is doing:
* **GREY — IDLE:** not listening; tap the mic button to start.
* **GREEN — LISTENING:** actively listening for your voice.
* **ORANGE — PROCESSING:** analyzing an image with the AI.
* **PURPLE — SPEAKING:** reading a response aloud.

### 8. Stopping the App
* Tap **"⏹ Stop"** on the home screen at any time to stop voice recognition.
* Press your phone's home button or app switcher to close Nexus Audio — all settings (including your API key) are automatically saved.

### 9. Troubleshooting
| Problem | Solution |
|---|---|
| *"Vision is not configured."* | Add your Gemini API key (Section 4, Steps 8–9). |
| App can't hear me / voice commands not working | Enable the Microphone permission (**Settings → Apps → Nexus Audio → Permissions**); ensure a quiet environment and speak clearly. |
| AI takes too long / *"Network connection timed out."* | Check your internet connection — the app automatically retries once, then try again in a stronger-signal area. |
| Camera image blurry or dark | Hold the phone steady for 1–2 seconds before saying "Take picture" so the camera can focus and adjust to light. |
| *"Sorry, I encountered an error with the vision analysis."* | Your API key may be invalid or out of quota — clear it in Settings (⚙️) and generate a new one at https://aistudio.google.com/app/apikey. |
| App installed but crashes on open | Ensure Android 8.0+; restart your phone and try again. |

### 10. Privacy and Data Information
* Your Gemini API key is stored **only on your device** and is never uploaded to any server.
* Photos are **not saved to your gallery** — processed in memory and sent temporarily to Google's Gemini API for analysis only.
* **No voice recordings are stored** — recognition runs entirely on your device's built-in speech engine.
* The app does **not collect any personal data**.

---

## 🛠️ Tech Stack
* **Mobile Framework:** React Native, Expo
* **AI Engine:** Google Gemini API (Multimodal / Vision)
* **State & Storage:** React hooks & Secure Local Storage

---

## ⚙️ Getting Started (Local Development)

1. Clone the repository:
   ```bash
   git clone [https://github.com/Programmersheddy/nexus-audio.git](https://github.com/Programmersheddy/nexus-audio.git)
