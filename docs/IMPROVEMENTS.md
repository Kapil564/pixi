# System Improvements & Technical Enhancements

This document logs architectural and pipeline improvements made to **pixi Assistant**.

---

## 1. Global LLM Assistant Context & Persona Alignment

- **Problem**: `user_context.md` previously contained individual user profile context. This caused inconsistent persona enforcement and lack of unified behavioral guidelines across sessions.
- **Improvement**:
  - Converted `user_context.md` into **Global Assistant Instructions & Behavioral Context** defining pixi's voice-first guidelines, brevity, tone, and operating rules.
  - Updated `DEFAULT_CONTEXT` in [src/memory/context.ts](file:///c:/Users/kapil/Desktop/space/pixi-assistant/src/memory/context.ts) to populate new context files with global instructions.
  - Refactored `getSystemPrompt()` in [src/providers/llm.ts](file:///c:/Users/kapil/Desktop/space/pixi-assistant/src/providers/llm.ts) to frame the loaded context as `Global Assistant Behavior & Guidelines (Applies to All Sessions)`.
  - Updated `SUMMARIZE_SYSTEM_PROMPT` in [src/memory/summarizer.ts](file:///c:/Users/kapil/Desktop/space/pixi-assistant/src/memory/summarizer.ts) to preserve global instructions during post-session consolidation.
- **Impact**: Guarantees consistent, concise, and spoken-friendly LLM responses across all sessions.

---

## 2. Removal of Parallel Processing in TTS & Instant Speech Interruption (Barge-In)

- **Problem**: 
  - TTS speech outputs executed concurrently or queued up, causing audio stacking and background process lingering.
  - When the user started speaking while pixi was responding, TTS audio kept playing until the user finished recording and sent audio, causing pixi to talk over the user.
- **Improvement**:
  - **Instant Interruption Bridge**: Added `stopSpeech()` to [src/main/preload.ts](file:///c:/Users/kapil/Desktop/space/pixi-assistant/src/main/preload.ts) and `stop-speech` IPC handler in [src/main/index.ts](file:///c:/Users/kapil/Desktop/space/pixi-assistant/src/main/index.ts) to forward `stop_speech` socket events to the backend instantly.
  - **Immediate Barge-In Execution**: Updated [src/renderer/index.tsx](file:///c:/Users/kapil/Desktop/space/pixi-assistant/src/renderer/index.tsx) (`startRecording`, `handleSendText`, WebSpeech wake word, and offline VAD volume detection) to call `assistant.stopSpeech()` immediately when user input or voice energy is detected.
  - **Non-Parallel & Preempted Pipeline**: Refactored `QueuedTTS` in [src/providers/tts.ts](file:///c:/Users/kapil/Desktop/space/pixi-assistant/src/providers/tts.ts) and pipeline handlers in [src/orchestrator/index.ts](file:///c:/Users/kapil/Desktop/space/pixi-assistant/src/orchestrator/index.ts) to enforce single-threaded sequential TTS execution. Monotonic `activeRequestId` tracking drops stale STT/LLM responses.
- **Piper Local Neural TTS Enhancements**:
  - **Sounds Natural**: Uses AI neural models (VITS/ONNX) to create smooth, human-like speech instead of the flat, robotic tone of legacy SAPI5.
  - **Works Everywhere**: Runs cross-platform on Windows, Linux, macOS, and Raspberry Pi, whereas SAPI5 was strictly locked to Windows.
  - **100+ Voice Options**: Offers hundreds of downloadable voices across dozens of languages and accents, replacing default system voices (David/Zira).
  - **Consistent Quality**: Bundles the exact voice file chosen directly with the app, ensuring identical sound quality on every user's computer.
  - **Easy Audio Control**: Generates raw audio files or streams (WAV/PCM) directly to code for simple processing, speed adjustment, and playback in Electron or Node.js.
  - **Privacy & Offline**: Works 100% offline without needing internet or extra Windows system components.
- **Impact**: Zero parallel TTS processing, instant audio cutoff as soon as user starts speaking, zero speech stacking, and high-quality neural voice speech output.

---

## 3. Permanent Top-Right Floating Orb UI & 4-Second Silence Auto-Send

- **Problem**: 
  - pixi previously expanded into a rectangular chat window panel upon click, taking up screen real estate.
  - Users had to manually click to stop recording, rather than automatically processing when speech finished.
- **Improvement**:
  - **Permanent Floating Orb**: Updated [src/main/index.ts](file:///c:/Users/kapil/Desktop/space/pixi-assistant/src/main/index.ts) to position the 130x130 transparent window permanently at the top-right corner of the primary screen. Locked `resize-to-panel` to maintain orb size.
  - **Single Orb Interface**: Locked [src/renderer/index.tsx](file:///c:/Users/kapil/Desktop/space/pixi-assistant/src/renderer/index.tsx) to render `<WakeOrb>` exclusively. Orb click directly toggles mic recording (`startRecording` / `stopRecording`).
  - **4-Second Post-Speech Silence VAD**: Added real-time vocal energy RMS tracking. Once user speech is detected (`rms > 0.015`), a timer monitors for silence. If 4 seconds (`4000ms`) of silence elapse after speech, recording automatically stops and audio is submitted to the LLM pipeline.
- **Impact**: Seamless hands-free voice interactions with automatic 4-second pause submission and zero desktop window clutter.

---

## 4. Architectural Step-by-Step Latency Documentation

- **Improvement**:
  - Added Section 5 ("Step-by-Step Pipeline Latency Breakdown") to [ARCHITECTURE.md](file:///c:/Users/kapil/Desktop/space/pixi-assistant/ARCHITECTURE.md).
  - Detailed expected latencies for VAD, PCM WAV encoding, WebSocket transport, STT engines (Groq/OpenAI/Faster-Whisper), LLM models (Groq/Gemini/Ollama/OpenAI), SQLite execution, and TTS synthesis (Windows SAPI5/ElevenLabs/Azure).
  - Documented end-to-end latency benchmarks (ranging from **~350ms** for fast offline configurations to **~400ms - 800ms** for optimal cloud setups).

