# Saira

> A Siri-like native Windows voice assistant with 100% offline privacy mode, local & cloud AI providers, and long-term memory.

![Release](https://img.shields.io/github/v/release/Kapil564/saira-assistant?style=flat-square&color=blue)
![License](https://img.shields.io/github/license/Kapil564/saira-assistant?style=flat-square&color=green)
![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011%20x64-0078D4?style=flat-square&logo=windows)
![TypeScript](https://img.shields.io/badge/language-TypeScript-blue?style=flat-square&logo=typescript)

---

## 📖 Description

Most cloud voice assistants lock you into closed ecosystems, require persistent internet connectivity, and collect sensitive voice and personal telemetry. **Saira** solves this by delivering a privacy-first, highly extensible native Windows desktop voice assistant.

Whether you want **100% offline operation** using local models (Ollama, GGML Whisper, Piper ONNX) or ultra-fast cloud inference (OpenAI, Google Gemini, Groq, Fish Audio, ElevenLabs), Saira intelligently routes requests and gracefully falls back to local providers whenever APIs are unreachable or offline.

### Key Capabilities
- 🔒 **100% Offline Privacy Mode**: Runs completely on your PC with zero data leaving your machine.
- 🎙️ **Hands-Free Wake Word & VAD**: Trigger Saira anytime by saying `"Hey Saira"` or using global hotkey `Ctrl+Shift+Space`.
- 🧠 **Markdown Long-Term Memory**: Automatically extracts, updates, and indexes user preferences, routines, and identity into `%APPDATA%\Saira\memory\`.
- ⚡ **Pluggable Provider Matrix**: Seamlessly switch between local Ollama / Whisper / Piper models and cloud API keys.
- 🪟 **Windows Native Integration**: Native desktop notifications, taskbar tray controls, and widget bar overlay modes.
- ⏰ **Automated Task Scheduling**: Create recurring reminders and to-do items powered by local SQLite storage.

---

## 💻 Tech Stack

| Component | Technologies & Tools |
|---|---|
| **Core Architecture** | Electron (v34+), Node.js (v20+), TypeScript (v5.7+), Socket.io |
| **User Interface** | React (v18), Tailwind CSS, Vite, tsup, Catppuccin Theme System |
| **Speech-to-Text (STT)** | OpenAI Whisper API, Groq Whisper, Local GGML `whisper-cli.exe` |
| **LLM & Intent Parsing** | OpenAI GPT-4o-mini, Google Gemini 1.5 Flash, Groq Llama 3, Local Ollama (`llama3.2:3b`) |
| **Text-to-Speech (TTS)** | Local Piper ONNX TTS, Windows SAPI5, Fish Audio, ElevenLabs, Azure Speech |
| **Storage & Database** | SQLite, Drizzle ORM, Per-User Gzip Log Archives |
| **System & Native OS** | `node-notifier`, `node-cron`, Windows PowerShell Native Audio Pipeline |

---

## 🛠️ Getting Started

### Prerequisites

Make sure your machine meets the following software & hardware requirements:

- **Operating System**: Windows 10 or Windows 11 (64-bit)
- **Node.js**: `v20.0.0` or higher ([Download Node.js](https://nodejs.org/))
- **Package Manager**: `pnpm` (`v9.x` or higher) — install via `npm i -g pnpm`
- **Memory (RAM)**: 4 GB RAM minimum (8 GB recommended for local LLM inference)
- **Disk Space**: ~3 GB free disk space (for local Whisper STT & Piper TTS model storage)
- *(Optional)* **Ollama**: Required only for 100% local offline LLM inference ([Install Ollama](https://ollama.com))

---

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Kapil564/saira-assistant.git
   cd saira-assistant
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

5. **Launch Saira in development mode**:
   ```bash
   pnpm dev
   ```

---

### Environment Variables

Saira auto-selects active providers based on the keys available in your `.env` or saved in `%APPDATA%\Saira\settings.json`. If no cloud API keys are provided, Saira automatically defaults to **100% Offline Mode**.

Create or update your `.env` file with the keys you possess:

```env
# ==============================================================================
# SAIRA ASSISTANT CONFIGURATION
# ==============================================================================

# Server & IPC Port Configuration
PORT=16123
SERVER_URL=http://localhost:16123

# Provider Selection Options:
# LLM: 'ollama' | 'openai' | 'gemini' | 'groq' | 'cloudflare'
# STT: 'whisper' | 'openai' | 'groq' | 'cloudflare' | 'elevenlabs'
# TTS: 'piper' | 'fishaudio' | 'elevenlabs' | 'azure' | 'cloudflare'
LLM_PROVIDER=ollama
STT_PROVIDER=whisper
TTS_PROVIDER=piper

# ------------------------------------------------------------------------------
# OPTIONAL CLOUD API KEYS (Fill only what you have)
# ------------------------------------------------------------------------------

# OpenAI API Key (For Whisper STT & GPT-4o-mini LLM)
OPENAI_API_KEY=

# Google Gemini API Key (For Gemini Flash LLM)
GEMINI_API_KEY=

# Groq API Key (For ultra-fast Llama & Whisper)
GROQ_API_KEY=

# Fish Audio TTS API Key & Voice Reference ID
FISH_AUDIO_API_KEY=
FISH_AUDIO_REFERENCE_ID=

# ElevenLabs TTS API Key & Voice ID
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=

# Azure Speech Key & Region
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=

# Local Server URLs
OLLAMA_BASE_URL=http://localhost:11434
```

#### Fallback Matrix

| Category | Provided API Key | Active Provider | Fallback when API Key is missing |
|---|---|---|---|
| **Speech-to-Text** | `OPENAI_API_KEY` or `GROQ_API_KEY` | Cloud Whisper API | Local `whisper-cli.exe` GGML Model |
| **LLM / Intent** | `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `GROQ_API_KEY` | Cloud LLM Inference | Local Ollama (`llama3.2:3b`) |
| **Text-to-Speech** | `FISH_AUDIO_API_KEY`, `ELEVENLABS_API_KEY`, or `AZURE_SPEECH_KEY` | Cloud Voice Synthesis | Local Piper ONNX TTS / Windows SAPI5 |

---

### Usage

#### 1. Running the App
- **Development Mode**:
  ```bash
  pnpm dev
  ```
- **Build Executables & Distributable Installers**:
  ```bash
  pnpm build
  pnpm pack
  ```
  Executable installers and portable binaries will be generated inside `release/`.

#### 2. User Controls & Keybindings
- **Global Toggle Hotkey**: Press <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd> anywhere in Windows to bring up Saira.
- **Hands-Free Voice Activation**: Speak `"Hey Saira"` to activate voice listening.
- **Interface Switching**: Click the mode toggle button on the floating orb to switch between the **Pixel Blob Orb** and **Windows 11 Widget Bar**.

#### 3. Voice Command Examples
- *"Hey Saira, set a reminder to call Alex tomorrow at 3 PM."*
- *"Add buy coffee beans to my to-do list."*
- *"Show my upcoming reminders."*
- *"Remember that I prefer dark mode and short answers."*

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
