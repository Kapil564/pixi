import { Server } from 'socket.io';
import { createServer } from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { executeIntent } from '../actions/executor';
import { createSTTRouter } from '../providers/stt-router';
import { createLLMRouter } from '../providers/llm-router';
import { createTTSRouter } from '../providers/tts-router';
import { ensureFullSetupReady } from '../providers/setup-manager';
import { type TTSProvider } from '../providers/tts';
import { config } from '../shared/config';
import { initMemoryStorage } from '../memory/markdown-memory';
import { assembleContext } from '../memory/context-pipeline';
import { extractAndStoreFacts } from '../memory/fact-extractor';
import { checkAndRunRollingSummary, recordMessageActivity } from '../memory/rolling-summary';
import { getActiveOrCreateSession, addMessage } from '../db/session-store';

import { getSettings } from '../shared/settings-store';
import { logErrorToFile } from '../shared/error-logger';

export interface Orchestrator {
  io: Server;
  tts: TTSProvider;
}

export async function createOrchestrator(): Promise<Orchestrator> {
  // Sync runtime config with settings.json on startup
  getSettings();

  const httpServer = createServer();
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1') || origin.startsWith('file://')) {
          callback(null, true);
        } else {
          callback(new Error('Blocked by CORS'));
        }
      },
      methods: ['GET', 'POST'],
    },
  });

  // Loopback security middleware: restrict connections to local loopback interface
  io.use((socket, next) => {
    const remoteAddr = socket.handshake.address || '';
    if (!remoteAddr || remoteAddr.includes('127.0.0.1') || remoteAddr.includes('::1') || remoteAddr.includes('localhost')) {
      return next();
    }
    console.warn(`[Socket Security Rejected] Connection attempt from non-loopback address: ${remoteAddr}`);
    return next(new Error('Unauthorized: Socket.IO connections permitted from loopback 127.0.0.1 only.'));
  });

  // Initialize Markdown memory directory and manifest
  initMemoryStorage();

  // Ensure full local setup (Ollama LLM + Whisper STT + Piper TTS) is ready in background
  ensureFullSetupReady().catch((err) => console.error('[Setup Init Error]:', err));

  const stt = createSTTRouter();
  const llm = createLLMRouter();
  const tts = createTTSRouter();

  io.on('connection', (socket) => {
    console.log('renderer connected');
    const sessionId = getActiveOrCreateSession();
    console.log(`[Session] Active SQLite Session #${sessionId}`);

    let activeRequestId = 0;

    const cancelActivePipeline = () => {
      activeRequestId++;
      tts.stop();
    };

    socket.on('stop_speech', () => {
      console.log('[Orchestrator] Stop speech signal received from renderer.');
      cancelActivePipeline();
    });

    socket.on('audio', async (audioBuffer: Buffer) => {
      cancelActivePipeline();
      const currentReqId = activeRequestId;

      try {
        const debugPath = path.join(os.tmpdir(), 'saira_debug.wav');
        fs.writeFileSync(debugPath, audioBuffer);
        console.log(`[Audio Debug] Received ${audioBuffer.length} bytes. Saved to temp dir: ${debugPath}`);

        if (audioBuffer.length < 100) {
          console.warn('[Audio Debug Warning] Audio buffer is nearly empty! Check microphone permissions.');
        }

        console.log(`[STT] Sending audio to provider "${config.stt.provider}"...`);
        const transcription = await stt.transcribe(audioBuffer);
        if (currentReqId !== activeRequestId) return;

        console.log(`[STT Output]: "${transcription.text}"`);
        socket.emit('transcript', { text: transcription.text });

        const userText = transcription.text.trim();
        if (!userText) {
          console.warn('[STT Warning] Received empty transcription. Prompting user to repeat...');
          const emptyResponse = {
            spoken: "I didn't quite catch that. Could you please try repeating?",
            display: "I didn't catch that. Could you please try repeating?",
          };
          socket.emit('response', emptyResponse);
          if (tts) {
            tts.speak(emptyResponse.spoken).catch(() => {});
          }
          return;
        }

        // 1. Add user message to SQLite DB
        addMessage({ sessionId, role: 'user', content: userText });
        recordMessageActivity(sessionId);

        // 2. Assemble context per turn (profile.md + keyword matching memory + summary + recent history)
        const turnContext = assembleContext({ userMessage: userText, sessionId });

        console.log('[LLM] Parsing intent with assembled context pipeline...');
        const intent = await llm.parseIntent(userText, turnContext.fullPromptContext);
        if (currentReqId !== activeRequestId) return;

        console.log('[LLM Output]:', JSON.stringify(intent));
        socket.emit('intent', intent);

        console.log('[Action] Executing intent...');
        const response = await executeIntent(intent);
        if (currentReqId !== activeRequestId) return;

        console.log('[Action Output]:', JSON.stringify(response));
        socket.emit('response', response);

        const assistantText = response.spoken || response.display || '';

        if (assistantText.trim()) {
          // 3. Add assistant response to SQLite DB
          addMessage({ sessionId, role: 'assistant', content: assistantText });
          recordMessageActivity(sessionId);

          // 4. Fire async non-blocking fact extraction
          extractAndStoreFacts({
            userMessage: userText,
            assistantResponse: assistantText,
            llm,
          }).catch((err) => {
            logErrorToFile(err, 'FactExtractionAsync');
          });

          // 5. Fire background rolling summary check
          checkAndRunRollingSummary(sessionId, llm).catch((err) => {
            logErrorToFile(err, 'RollingSummaryAsync');
          });
        }

        if (response.spoken && response.spoken.trim()) {
          console.log('[TTS] Synthesizing speech...');
          await tts.speak(response.spoken);
          if (currentReqId === activeRequestId) {
            console.log('[TTS] Finished speaking.');
          } else {
            console.log('[TTS] Speech output was preempted by a newer request.');
          }
        } else {
          console.log('[TTS] Intent output is silent. Skipping TTS speech.');
        }
      } catch (err) {
        if (currentReqId !== activeRequestId) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error('[Pipeline Error]:', message);
        await tts.speak('Sorry, something went wrong.');
      }
    });

    socket.on('text', async (text: string) => {
      cancelActivePipeline();
      const currentReqId = activeRequestId;

      try {
        console.log(`[Text Input]: "${text}"`);
        socket.emit('transcript', { text });

        const userText = text.trim();
        if (!userText) return;

        // 1. Add user message to SQLite DB
        addMessage({ sessionId, role: 'user', content: userText });
        recordMessageActivity(sessionId);

        // 2. Assemble context per turn
        const turnContext = assembleContext({ userMessage: userText, sessionId });

        console.log('[LLM] Parsing intent with assembled context pipeline...');
        const intent = await llm.parseIntent(userText, turnContext.fullPromptContext);
        if (currentReqId !== activeRequestId) return;

        console.log('[LLM Output]:', JSON.stringify(intent));
        socket.emit('intent', intent);

        console.log('[Action] Executing intent...');
        const response = await executeIntent(intent);
        if (currentReqId !== activeRequestId) return;

        console.log('[Action Output]:', JSON.stringify(response));
        socket.emit('response', response);

        const assistantText = response.spoken || response.display || '';

        if (assistantText.trim()) {
          // 3. Add assistant response to SQLite DB
          addMessage({ sessionId, role: 'assistant', content: assistantText });
          recordMessageActivity(sessionId);

          // 4. Fire async non-blocking fact extraction
          extractAndStoreFacts({
            userMessage: userText,
            assistantResponse: assistantText,
            llm,
          }).catch((err) => {
            console.error('[Fact Extraction Async Error]:', err);
          });

          // 5. Fire background rolling summary check
          checkAndRunRollingSummary(sessionId, llm).catch((err) => {
            console.error('[Rolling Summary Async Error]:', err);
          });
        }

        if (response.spoken && response.spoken.trim()) {
          console.log('[TTS] Synthesizing speech...');
          await tts.speak(response.spoken);
          if (currentReqId === activeRequestId) {
            console.log('[TTS] Finished speaking.');
          } else {
            console.log('[TTS] Speech output was preempted by a newer request.');
          }
        } else {
          console.log('[TTS] Intent output is silent. Skipping TTS speech.');
        }
      } catch (err) {
        if (currentReqId !== activeRequestId) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error('[Pipeline Error]:', message);
        await tts.speak('Sorry, something went wrong.');
      }
    });

    socket.on('disconnect', async () => {
      cancelActivePipeline();
      console.log(`renderer disconnected from Session #${sessionId}. Triggering final session check...`);
      checkAndRunRollingSummary(sessionId, llm, true).catch((err) => {
        console.error('[Rolling Summary Disconnect Error]:', err);
      });
    });
  });

  httpServer.listen(config.server.port, '127.0.0.1', () => {
    console.log(`Saira orchestrator listening on 127.0.0.1:${config.server.port}`);
  });

  return { io, tts };
}
