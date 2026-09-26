<div align="center">
<h2>Pixi</h2>
<img src="assets/mascot.svg" width="140" alt="Pixi Mascot" />
</div>

** A privacy-first, local-first Windows AI assistant. **

Pixi is a native Windows voice assistant designed to bridge the gap between powerful cloud AI and absolute user privacy. It provides a seamless "Siri-like" experience that works 100% offline using local models, or scales to high-performance cloud providers via API.
---

## ✨ Core Philosophy

Most voice assistants are "Cloud-First," meaning your voice and data are processed on remote servers. **Pixi is "Local-First."** 

It uses a intelligent fallback system: if you have an internet connection, it uses fast Cloud APIs (OpenAI, Gemini). If you go offline, it gracefully switches to your local hardware (Ollama, Whisper, Piper) without the user ever noticing a break in the pipeline.

### 💎 Key Features- **🔒 True Privacy:** 100% offline mode. Your voice never leaves your machine.
- **🎙️ Smart Triggering:** Support for "Hey Pixi" wake-word, Voice Activity Detection (VAD), and global hotkeys (`Ctrl+Shift+Space`).
- **⛓️ Sequential Readiness:** A unique startup pipeline ensures STT → LLM → TTS are verified *before* the mic is unmuted, preventing "hallucinated" silence or errors.
- **🧠 Long-Term Memory:** Automatically saves user preferences and facts into local, human-readable Markdown files.
- **⚡ Instant Barge-In:** Stop the AI mid-sentence just by speaking or clicking.

---

## 🛠️ Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Core** | Electron, TypeScript, Node.js, Socket.io |
| **Frontend** | React, Tailwind CSS, Monochrome Design System |
| **Local AI** | Ollama (LLM), Whisper.cpp (STT), Piper ONNX (TTS) |
| **Cloud AI** | OpenAI, Google Gemini, ElevenLabs |
| **Storage** | SQLite (Drizzle ORM), Markdown (User Memory) |

---

## 🚀 Quick Start

### Prerequisites- **Windows 10/11** (64-bit)
- **Node.js** `v20+` & **pnpm**- **Ollama** (Optional, for 100% local LLM)

### Installation

1. **Clone & Install**
   ```bash
   git clone https://github.com/kapil564/pixi.git
   cd pixi
   pnpm install
   ```

2. **Environment Setup**
   ```bash
   cp .env.example .env
   # Add your API keys to .env if using Cloud mode
   ```

3. **Database & Launch**
   ```bash
   pnpm db:generate
   pnpm db:migrate
   pnpm dev
   ```

---

## 🏗️ The Startup Pipeline

Unlike traditional assistants that start all services in parallel (leading to race conditions), Pixi uses a **Strict Sequential Gate**.

**The Boot Sequence:**
1. **STT Verification:** Ensures `whisper-cli` and models are ready.
2. **LLM Verification:** Confirms Ollama/Cloud API connectivity.
3. **TTS Verification:** Validates Piper/ElevenLabs availability.

The UI remains in a "Setup" state until all three stages are green, ensuring a zero-latency experience once the user begins speaking.

---

## 📁 Project Structure

```text
src/
├── main/          # Electron main process (Tray, Windows, IPC)
├── renderer/      # React UI (Orb, Widget, Onboarding)
├── orchestrator/  # Pipeline coordination & Task scheduling
├── providers/     # STT/LLM/TTS routing & Readiness logic
├── memory/        # Markdown-based fact extraction & storage
└── db/            # SQLite schema & Drizzle ORM
```

---

## 📄 License

Distributed under the MIT License. See `package.json` for details.