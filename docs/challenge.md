# Technical Challenges & Architectural Insights — pixi Voice Assistant

Building **pixi**, an agentic desktop voice assistant with an Electron + React stack, presented several complex engineering challenges across operating system process management, Web Audio pipelines, window frame manipulation, and LLM memory synchronization.

Here is a breakdown of the key challenges encountered during development and how they were resolved.

---

## 1. Background Audio Persistence & Electron Throttling

### **The Challenge**
Electron applications by default enable `backgroundThrottling: true`. Whenever pixi's window was hidden (`window.hide()`) to run in the background Windows system tray:
- Node.js timers and Web Audio `AudioContext` instances were suspended by Chromium to conserve CPU/power.
- Chromium automatically placed microphone input streams into a `"suspended"` state.
- As a result, the hands-free **"Hey pixi"** wake word listener froze and stopped working whenever the window was closed or hidden.

### **The Solution**
1. **Disabled Background Throttling**: Configured `backgroundThrottling: false` in `BrowserWindow.webPreferences` in [`src/main/index.ts`](file:///c:/Users/kapil/Desktop/space/pixi-assistant/src/main/index.ts#L29).
2. **Audio Context Auto-Resumption**: Implemented automated `.resume()` calls on Web Audio contexts attached to `window-shown`, `focus`, and `visibilitychange` events in [`src/renderer/index.tsx`](file:///c:/Users/kapil/Desktop/space/pixi-assistant/src/renderer/index.tsx#L430).
3. **Window Close Interception**: Intercepted the title bar `close` event to execute `window.hide()` instead of destroying the Electron window, keeping pixi continuously active in the system tray.

---

## 2. Chromium Web Speech API `network` Errors & Offline Fallback (VAD)

### **The Challenge**
Chromium's built-in `webkitSpeechRecognition` API requires active network connectivity to Google speech servers and Electron binaries do not include API keys. Under restricted network conditions or offline usage, `webkitSpeechRecognition` threw repeated `[Wake Word Error]: network` errors, breaking wake word functionality.

### **The Solution**
Engineered a **100% offline Web Audio Voice Activity Detector (VAD)** fallback:
- Analyzes raw microphone audio energy using Web Audio `AnalyserNode` frequency spectrum arrays.
- Measures sustained RMS volume energy above custom thresholds (`averageVolume > 45` over consecutive frames).
- When `webkitSpeechRecognition` encounters a `network` error, pixi seamlessly fails over to the local VAD without crashing or interrupting background voice detection.

---

## 3. Asynchronous Windows TTS Process Killing & Sequential Queueing

### **The Challenge**
On Windows, native PowerShell `System.Speech` / `WMPlayer` processes spawned for Text-To-Speech (TTS) run asynchronously in child processes. Standard Node `childProcess.kill()` signals often failed to terminate underlying COM/audio processes immediately, causing:
- Lingering background voices speaking stale responses.
- Parallel speech outputs overlapping and talking over each other when multiple responses were queued.

### **The Solution**
1. **Forceful Windows Process Tree Termination**: Implemented explicit `taskkill /pid <PID> /f /t` process tree termination in [`src/providers/tts.ts`](file:///c:/Users/kapil/Desktop/space/pixi-assistant/src/providers/tts.ts).
2. **Sequential FIFO Queue (`QueuedTTS`)**: Wrapped the TTS provider in a synchronized FIFO queue so speech outputs play sequentially.
3. **Instant Speech Interruption (Barge-In)**: Triggered `tts.stop()` immediately whenever new user speech or microphone activity was detected.

---

## 4. Agentic Memory Architecture & LLM Synchronization

### **The Challenge**
Injecting long-term user context (user preferences, facts, reminders) into LLM system prompts without inflating context windows or introducing high API latency during live voice turns.

### **The Solution**
1. **Post-Session Memory Processing**: Moved heavy transcript summarization to an asynchronous post-session worker [`src/memory/summarizer.ts`](file:///c:/Users/kapil/Desktop/space/pixi-assistant/src/memory/summarizer.ts).
2. **Mem0 Integration & Local Cache**: Integrated Mem0 Cloud REST API (`MEM0_API_KEY`) to extract user memory triples, deduplicate facts, and sync them locally to [`user_context.md`](file:///c:/Users/kapil/Desktop/space/pixi-assistant/user_context.md).
3. **Dynamic System Prompt Injection**: System prompts dynamically read cached facts from `user_context.md` at runtime across OpenAI, Groq, Gemini, Cloudflare, and Ollama providers in [`src/providers/llm.ts`](file:///c:/Users/kapil/Desktop/space/pixi-assistant/src/providers/llm.ts).




