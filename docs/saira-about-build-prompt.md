# Build prompt: Saira — "about" landing page

Build a single self-contained HTML file (inline CSS + JS, no build step) that
introduces **Saira**, a real product, to visitors. Below is everything needed:
product context, design system, page structure, and a full component spec for
the signature visual (a live-drawn pixel-art orb).

---

## 1. Product context (use this verbatim for copy — don't invent facts beyond it)

Saira is a **privacy-first, Siri-like desktop voice assistant for Windows**,
built with **Electron, React, TypeScript, and SQLite**.

**The problem:**
- Existing desktop voice assistants are tightly locked to proprietary cloud
  ecosystems — telemetry, mandatory accounts, static cloud endpoints.
- They break completely when cloud APIs are unavailable.
- Users have no local control over which speech, intent, or text-to-speech
  provider is doing the work.

**What's been built:**
- A modular, local-first assistant architecture with a central orchestrator.
- Pluggable STT / LLM / TTS providers with automatic fallback:
  - **STT:** OpenAI Whisper, Groq Whisper, local faster-whisper
  - **LLM:** OpenAI GPT-4o-mini, Gemini Flash, Groq Llama, local Ollama
  - **TTS:** Fish Audio, ElevenLabs, Azure, Windows SAPI5 / Piper
  - All three stages support **100% offline** operation.
- Dynamic continuous voice activity detection (VAD).
- Long-term memory: per-user SQLite (`%APPDATA%\Saira\assistant.db`) +
  Markdown memory files.
- **Dual UI modes:** a Catppuccin-themed Windows 11 desktop widget, and a
  floating pixel-art mascot orb.

**Windows-native behavior:**
- Runs silently in the System Tray.
- Global hotkey: `Ctrl+Shift+Space`.
- Auto-start at boot (`openAtLogin`).
- Frameless, transparent, always-on-top overlay for the widget/mascot.
- Native OS notifications via `node-notifier`.
- Monitors system sleep / wake / screen-unlock events to scan for and
  surface overdue reminders.

**Architecture tree (render this as a styled diagram, not prose):**
```
Electron Tray App (Main Process)
  ├── Global Hotkey (Ctrl+Shift+Space) & System Tray Menu
  ├── System Sleep / Wake / Screen Unlock Monitors
  └── Transparent Frameless Overlay (Widget / Mascot)
        ↕ Socket.io IPC
Node.js Orchestrator & Task Scheduler
  ├── Pluggable STT  ──> OpenAI Whisper · Groq Whisper · Local faster-whisper
  ├── Pluggable LLM  ──> GPT-4o-mini · Gemini Flash · Groq Llama · Local Ollama
  ├── Pluggable TTS  ──> Fish Audio · ElevenLabs · Azure · SAPI5 / Piper
  └── Local Storage  ──> SQLite (assistant.db) + Markdown memory
```

**Honesty constraints:** The Windows app is still in development. Don't
invent download links, pricing, release dates, or benchmark numbers. The
page should link to a separate interactive browser demo (`saira-bot.html`)
that shows the same state machine, not a real download.

---

## 2. Design system

**Palette (dark, warm-neutral base):**
```
--bg:        #0b0a08
--bg-soft:   #131210
--bg-card:   #16140f
--rule:      rgba(255,255,255,0.09)
--text:      #f3ede2
--text-muted:#8f8878
--gold:      #d99a4e   (idle / primary accent)
--sage:      #6fae8c   (listening)
--silver:    #c7ccd6   (thinking)
--ember:     #e2694a   (speaking)
```

**Type system (Google Fonts):**
- Display / headlines: **Fraunces**, italic, weight 500–600 — used for the
  wordmark and all `h1`/`h2`.
- Body / UI: **Inter**, weights 400/500/600.
- Labels, state text, code, eyebrows: **IBM Plex Mono**, uppercase,
  letter-spacing ~2.5–4px.

**Recurring UI patterns:**
- Pill buttons (`border-radius: 999px`) — solid gold for primary CTA,
  outlined for secondary.
- Cards: `--bg-card` fill, 1px `--rule` border, ~18px radius.
- "Eyebrow" labels above every section heading: small mono, muted, uppercase,
  wide letter-spacing.
- Chips for provider/tech lists: pill-shaped, outlined; give offline-capable
  chips a sage border + sage text to visually flag them.
- Fact/feature lists use a colored left border rule (2px, translucent gold)
  instead of icons or numbered bullets.

---

## 3. Page structure (in order)

1. **Nav** — wordmark "Saira" (italic Fraunces) + small mono "for Windows"
   subtitle, and a pill link "Try the interaction demo" → `saira-bot.html`.

2. **Hero**
   - The **pixel-art orb** (see full spec in §4) centered above the headline,
     auto-cycling through its states on its own, with a live state label
     (mono, uppercase) underneath it.
   - Headline (Fraunces italic): *"Siri, without the cloud strings
     attached."*
   - Subhead: 1–2 sentences summarizing the local-first pitch.
   - CTA row: primary "Try the interaction demo" button + secondary
     "See how it's built" anchor-scroll link.
   - Small stack tags row: Electron / React / TypeScript / SQLite.

3. **"Why Saira exists"** — two-column card split:
   - Left card ("The problem"): 3 bullets, each with a small ember dot
     marker, drawn from §1.
   - Right card ("What Saira does instead"): 3 bullets, sage dot markers.

4. **"Two ways to see her"** — dual UI modes:
   - Card 1: "Pixel-art mascot orb" — small live preview(s) of the orb
     widget (reuse the §4 component at a smaller size) + description.
   - Card 2: "Windows 11 widget" — a simple mocked-up panel (a few gray
     skeleton lines, one accent line) representing the Catppuccin widget,
     since there's no real screenshot — label it clearly as a mockup only
     if it could be mistaken for a real screenshot.

5. **"Under the hood"** (`id="architecture"`) — render the architecture
   tree from §1 inside a bordered, card-style `<pre>` block in IBM Plex
   Mono, with the local/offline-only lines picked out in sage and key
   nouns in gold.

6. **"Choose your providers"** — three columns (STT / LLM / TTS), each a
   card with chips for every provider from §1. Offline-capable chips get
   the sage "offline" treatment. Add one small note below explaining what
   the sage color means.

7. **"Native to Windows"** — three short fact blocks (gold left-border
   rule style) covering: tray + hotkey + autostart; frameless always-on-top
   overlay + native notifications; sleep/wake/unlock monitoring for
   reminders. Use inline `<code>` styling for the hotkey and API names.

8. **Final CTA** — short, honest: app is still in development; the linked
   demo shows the interaction flow, not a finished product. One primary
   button back to `saira-bot.html`.

9. **Footer** — one muted mono line: "Saira — Electron · React · TypeScript
   · SQLite".

Make the whole page responsive (stack to 1 column under ~760px), and respect
`prefers-reduced-motion` by scaling down animation amplitude/speed rather
than removing motion entirely.

---

## 4. Component spec: the pixel-art orb (the signature visual)

This is the one element reused at multiple sizes across the page (large in
the hero, small in the "Two ways to see her" card). Build it as a reusable
canvas-drawing function, **not** as image assets — the character is drawn
live with `fillRect` pixel blocks so it can be recolored/reused cheaply.

**Grid & rendering:**
- Logical pixel grid ~26 wide × 24 tall, cell size ~10px, scaled up via
  `image-rendering: pixelated` on the canvas element.
- Character body: rounded square head with small side "ears," a lighter
  highlight patch top-left, pink blush rectangles on both cheeks.
- Shared outline color `#1e2028` for all states.

**Three states, three palettes:**

| State | Body color | Eyes | Mouth | Extra |
|---|---|---|---|---|
| **Idle** | pale white/gray `#e2e5e7` | small closed dot-line eyes | tiny closed "o" | 2 semi-transparent purple `Z` glyphs drifting up and fading on a loop (staggered timing, gentle horizontal wobble) |
| **Listening** | green `#76d18c` | wide open eyes with a white glint that flicks left/right on a sine timer | open alert "O" | two small antennas above the head (green + blue tips), drawn with their own outline |
| **Speaking** | yellow `#f6dfa9` | wide open eyes, static glint | mouth **animates**: cycles between a flat closed line and a taller open rectangle on a fast sine wave, to simulate talking | — |

**Animation loop:** a single `requestAnimationFrame` loop redraws the whole
character every frame based on an incrementing time value `t`; state
switches just change which draw function + palette is used, no need to
reset `t`.

**Reuse pattern:** wrap the draw logic in a factory so you can instantiate
it more than once (e.g. one big auto-cycling instance in the hero, smaller
fixed-state instances elsewhere) without duplicating the pixel-drawing code.

**Hero behavior specifically:** auto-cycle **idle → listening → speaking →
idle …** on a timer (~2.5–3s per state) with no user interaction required,
and update the mono state-label text under the orb in sync with each
change.

---

## 5. Cross-page link

Assume a second file, `saira-bot.html`, already exists: a working
interactive demo with a mic button (Web Speech API), text-input fallback,
and a transcript, driven by the same idle/listening/thinking/speaking state
machine. All CTAs on this about page link to it — don't rebuild it here.

---

## 6. Output requirements

- One HTML file, inline `<style>` and `<script>`, Google Fonts via
  `<link>` (Fraunces, Inter, IBM Plex Mono).
- No external image assets — the orb is 100% canvas-drawn.
- No frameworks; vanilla JS is sufficient.
- Keep copy honest and specific — no fabricated stats, pricing, or links.
