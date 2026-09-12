# pixi — Interruption & State Flow

A quick guide to how **pixi** handles states, voice interruptions (barge-in), and request preemption.

---

## 1. The 4 States (`OrbPhase`)

| State | Orb Color | What pixi is doing | Mic / VAD Status |
| :--- | :--- | :--- | :--- |
| **`idle`** | White / Lavender | Waiting for you | **ON** — Listens for speech, click, or hotkey |
| **`listening`** | Teal | Recording your voice | **ON** — Auto-sends after 2s of silence |
| **`thinking`** | Yellow | Transcribing (STT) or processing (LLM) | **OFF** — Room noise ignored |
| **`speaking`** | Pink | Playing voice response (TTS) | **OFF** — Speaker sound ignored |

---

## 2. How Interruption Works

### Case 1: Interrupting While pixi is Speaking (Barge-In)
When pixi is talking and you speak or click the orb:
1. **TTS stops instantly** — The audio process is killed immediately via `assistant.stopSpeech()`.
2. **Orb turns Teal** — pixi switches straight to `listening` and records your new question.
3. **No audio overlap** — The old voice response is cut off with zero delay.

### Case 2: Interrupting While pixi is Thinking (Preemption)
When you submit a new question before the previous one finishes:
1. **Request ID increments** — Each new prompt increments an internal counter (`activeRequestId`).
2. **Old turn is dropped** — When the older STT/LLM response finishes, it sees it is outdated and silently discards itself.
3. **Only latest answer plays** — Only your most recent request is processed and spoken.

---

## 3. Protection Against False Triggers

To prevent feedback loops and accidental cutoffs:
- **Phase Guard**: The mic listener **only** runs in `idle`. It is completely disabled during `thinking` and `speaking`.
- **800ms Cooldown**: After pixi finishes speaking, it waits 800ms before turning the mic on so speaker echo won't trigger recording.
- **Echo Cancellation**: Microphone input uses browser/OS echo cancellation and noise suppression.
- **Isolated Stop Signal**: The `stop_speech` command only halts speaker playback—it never cancels an in-flight transcription.
