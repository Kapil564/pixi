# Pixi - window local ai assistant

 A Siri-like native Windows voice assistant with 100% offline privacy mode, local & cloud AI providers, long-term memory, and a strict sequential startup pipeline.

---

## 📖 Description

Most cloud voice assistants lock you into closed ecosystems, require persistent internet connectivity, and collect sensitive voice and personal telemetry. **pixi** solves this by delivering a privacy-first, highly extensible native Windows desktop voice assistant.

Whether you want **100% offline operation** using local models (Ollama, whisper.cpp, Piper ONNX) or fast cloud inference (OpenAI, Google Gemini, ElevenLabs), pixi intelligently routes requests and gracefully falls back to local providers whenever APIs are unreachable or rate-limited.

### Key Capabilities

- 🔒 **100% Offline Privacy Mode** — runs entirely on your PC; zero data leaves your machine.
- 🎙️ **Hands-Free Wake Word & VAD** — trigger pixi by saying `"Hey pixi"`, via voice-activity detection, or with the global hotkey `Ctrl+Shift+Space`.
- 🛑 **Instant Barge-In** — speak or click anytime while pixi is talking; TTS playback halts immediately and listening starts with zero audio overlap.
- ⛓️ **Sequential Pipeline Gate (STT → LLM → TTS)** — services are never independent at startup: Speech-to-Text is installed and verified first, then the LLM, then Text-to-Speech. The mic, wake-word listener, text input, and reminder voice alerts all stay locked until every stage is ready, eliminating startup mismatches.
- 🧠 **Markdown Long-Term Memory** — automatically extracts and indexes user preferences, routines, and identity into human-readable Markdown under `%APPDATA%\pixi\memory\`, with rolling session summaries in SQLite.
- ⚡ **Pluggable Provider Matrix** — switch between local Ollama / Whisper / Piper and cloud API keys at runtime via onboarding or settings; automatic per-turn fallback keeps responses flowing.
- 🖤 **Minimal Black & White UI** — a monochrome pixel-blob mascot and floating widget bar; a live setup banner shows a per-stage `STT → LLM → TTS` checklist during first-run downloads.
- 🪟 **Windows Native Integration** — system tray, desktop notifications, always-on-top floating window, and login autostart.
- ⏰ **Automated Task Scheduling** — create reminders and to-dos powered by local SQLite; due reminders fire native notifications and spoken alerts.

---

## 💻 Tech Stack

| Component | Technologies & Tools |
|---|---|
| **Core Architecture** | Electron (v31), Node.js (v20+), TypeScript (v5.4+), Socket.io |
| **User Interface** | React (v18), Tailwind CSS, tsup, monochrome (black & white) design system |
| **Speech-to-Text (STT)** | OpenAI Whisper API, ElevenLabs Scribe, local `whisper-cli.exe` (whisper.cpp GGML models) |
| **LLM & Intent Parsing** | OpenAI GPT-4o-mini, Google Gemini, local Ollama (`llama3.2:3b`) |
| **Text-to-Speech (TTS)** | Local Piper ONNX TTS, ElevenLabs |
| **Storage & Database** | SQLite (`better-sqlite3`), Drizzle ORM, local Markdown memory |
| **System & Native OS** | `node-notifier`, Windows PowerShell native audio pipeline, Electron Tray/IPC |

---

## ⛓️ How the Startup Pipeline Works

pixi's three AI stages are **ordered, not parallel**. A shared readiness gate (`src/providers/readiness.ts`) is the single source of truth consulted by the orchestrator, the reminder scheduler, and the UI:

```text
Boot
 └─> Readiness gate evaluates the pipeline in strict order:

     1. STT   Whisper binary + GGML model      ── verified ──┐
     2. LLM   Ollama service + model pull      ── verified ──┤  each stage must
     3. TTS   Piper binary + ONNX voice        ── verified ──┘  finish first

 └─> While any stage is pending:
       • Mic, wake-word/VAD, and text input are disabled in the UI
       • Audio/text requests are rejected with "Setup in progress"
       • Reminder voice alerts are skipped (retried after setup)

 └─> Gate opens → UI unlocks → voice pipeline goes live
```

- Cloud providers (OpenAI / Gemini / ElevenLabs keys) auto-pass their stage; local assets are only required in offline mode.
- The setup banner renders a live per-stage checklist (`✓ STT → ⟳ LLM → · TTS`) so you always know exactly which stage is downloading.
- First-run downloads follow the same order: **Step 1/3 STT → Step 2/3 LLM → Step 3/3 TTS**.

For the full architecture, request sequence diagrams, and latency benchmarks, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 🛠️ Getting Started

### Prerequisites

- **Operating System**: Windows 10 or Windows 11 (64-bit)
- **Node.js**: `v20.0.0` or higher ([Download Node.js](https://nodejs.org/))
- **Package Manager**: `pnpm` (`v9.x` or higher) — install via `npm i -g pnpm`
- **Memory (RAM)**: 4 GB minimum (8 GB recommended for local LLM inference)
- **Disk Space**: ~3 GB free (for local Whisper STT & Piper TTS model storage)
- **Ollama**: required only for 100% local offline LLM inference ([Install Ollama](https://ollama.com))

---

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Kapil564/pixi.git
   cd pixi
   ```

2. **Install project dependencies**:
   ```bash
   pnpm install
   ```

3. **Set up environment configuration**:
   ```bash
   cp .env.example .env
   ```

4. **Initialize local database & run migrations**:
   ```bash
   pnpm db:generate
   pnpm db:migrate
   ```

5. **Launch pixi in development mode**:
   ```bash
   pnpm dev
   ```

On first launch, the onboarding wizard walks you through choosing **100% Local (Offline)** or **Cloud Providers (API Keys)** and runs the sequential STT → LLM → TTS setup with live progress.

---

### Environment Variables

pixi auto-selects active providers based on the keys present in your `.env` (or saved via onboarding into `%APPDATA%\pixi\settings.json`). If no cloud API keys are provided, pixi automatically defaults to **100% Offline Mode**.

```env
# Server & IPC Port
PORT=16123

# Cloud API keys (fill only what you have — blanks fall back to local providers)
OPENAI_API_KEY=
GEMINI_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=

# Provider selection overrides (optional — auto-selected by default)
# LLM_PROVIDER=openai|gemini|ollama
# STT_PROVIDER=openai|elevenlabs|whisper
# TTS_PROVIDER=piper|elevenlabs

# Local / offline services
OLLAMA_BASE_URL=http://localhost:11434
```

See [.env.example](.env.example) for quick-start presets (privacy mode, OpenAI-only, ElevenLabs voice, etc.).

#### Fallback Matrix

| Category | Provided API Key | Active Provider | Fallback when key is missing / fails |
|---|---|---|---|
| **Speech-to-Text** | `OPENAI_API_KEY` or `ELEVENLABS_API_KEY` | Cloud Whisper / Scribe | Local `whisper-cli.exe` GGML model |
| **LLM / Intent** | `OPENAI_API_KEY` or `GEMINI_API_KEY` | Cloud LLM inference | Local Ollama (`llama3.2:3b`) |
| **Text-to-Speech** | `ELEVENLABS_API_KEY` | Cloud voice synthesis | Local Piper ONNX TTS |

---

### Usage

#### Running the App

- **Development mode** (CSS + JS watch with hot restart):
  ```bash
  pnpm dev
  ```
- **Typecheck**:
  ```bash
  pnpm lint
  ```
- **Build & package distributables** (NSIS installer + portable binary into `release/`):
  ```bash
  pnpm build
  pnpm pack
  ```

#### User Controls & Keybindings

- **Global toggle hotkey**: <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd> anywhere in Windows.
- **Hands-free activation**: say `"Hey pixi"` (wake word) or just start speaking (VAD auto-detection).
- **Interface switching**: toggle between the **Pixel Blob Orb** and the **Widget Bar** from the mode button.
- **Barge-in**: click the orb/mic or start typing while pixi is speaking to instantly interrupt.

#### Voice Command Examples

- *"Hey pixi, set a reminder to call Alex tomorrow at 3 PM."*
- *"Add buy coffee beans to my to-do list."*
- *"Show my upcoming reminders."*
- *"Remember that I prefer dark mode and short answers."*

---

## 📁 Project Structure

```text
pixi/
├── assets/               # App icons and media assets
├── docs/                 # Architecture, context, and problem-log documentation
├── src/
│   ├── actions/          # Intent handlers (reminders, todos, chat)
│   ├── db/               # SQLite schema, migrations, and Drizzle ORM operations
│   ├── main/             # Electron main process (tray, windows, IPC, preload bridge)
│   ├── memory/           # Markdown memory, fact extraction, context assembly, rolling summaries
│   ├── orchestrator/     # Socket.io pipeline coordinator & reminder scheduler
│   ├── providers/        # Readiness gate, STT/LLM/TTS routers & local model managers
│   ├── renderer/         # React UI (orb, widget, onboarding, setup banner, voice capture)
│   └── shared/           # Zod config validation, settings store, HTTP/download helpers
├── index.html            # Renderer entry template
├── tsup.config.ts        # Dual-target build (Node main/preload + browser renderer)
└── package.json
```

---

## 📄 License

Distributed under the MIT License (per `package.json`). A `LICENSE` file is not currently included in the repository.
