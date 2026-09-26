import { Server, type Socket } from 'socket.io';
import { createServer } from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { executeIntent } from '../actions/executor';
import { createSTTRouter } from '../providers/stt-router';
import { createLLMRouter } from '../providers/llm-router';
import { createTTSRouter } from '../providers/tts-router';
import { ensureFullSetupReady } from '../providers/setup-manager';
import { ensurePipelineReady, refreshPipelineReadiness, startReadinessWatcher } from '../providers/readiness';
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

  // Evaluate the ordered pipeline gate (STT -> LLM -> TTS) once at boot, then keep
  // it fresh in the background so every consumer (requests, scheduler, renderer)
  // sees the same readiness state instead of probing services independently.
  await refreshPipelineReadiness(true);
  startReadinessWatcher(2000);

  ensureFullSetupReady().catch((err) => console.error('[Setup Init Error]:', err));

  const stt = createSTTRouter();
  const llm = createLLMRouter();
  const tts = createTTSRouter();

  io.on('connection', (socket) => {
    console.log('renderer connected');
    let sessionId: number;
    try {
      sessionId = getActiveOrCreateSession();
      console.log(`[Session] Active SQLite Session #${sessionId}`);
    } catch (err) {
      console.error('[Session Error] Database not ready at connection time:', err);
      socket.emit('response', {
        spoken: 'pixi is still starting up. Please try again in a moment.',
        display: 'Still starting up...',
      });
      return;
    }

    let activeRequestId = 0;

    const cancelActivePipeline = () => {
      activeRequestId++;
      tts.stop();
      socket.emit('speaking_stop');
    };

    const ensureSetupReady = async (): Promise<boolean> => {
      // Shared ordered gate (STT -> LLM -> TTS). Re-evaluates fresh when not
      // ready so requests are admitted the moment setup completes.
      const readiness = await ensurePipelineReady();
      if (!readiness.ready) {
        const stage = readiness.currentStage ? readiness.currentStage.toUpperCase() : 'PIPELINE';
        console.warn(
          `[Orchestrator] Request blocked: pipeline not ready (awaiting ${stage}: ${readiness.nextBlocker})`
        );
        socket.emit('response', {
          spoken: 'pixi is still setting up. Please wait for models to finish installing.',
          display: `Setup in progress — waiting for ${stage}...`,
        });
        return false;
      }
      return true;
    };

    const speakWithEvents = async (currentReqId: number, text: string) => {
      try {
        await tts.speak(text, () => {
          if (currentReqId === activeRequestId) {
            socket.emit('speaking_start');
          }
        });
      } catch (err) {
        console.warn('[TTS Warning]:', err);
      }
      if (currentReqId === activeRequestId) {
        console.log('[TTS] Finished speaking.');
        socket.emit('speaking_stop');
      } else {
        console.log('[TTS] Speech output was preempted by a newer request.');
      }
    };

    const handlePipelineError = async (currentReqId: number, err: unknown) => {
      if (currentReqId !== activeRequestId) return;
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Pipeline Error]:', message);
      socket.emit('response', { spoken: 'Sorry, something went wrong.', display: 'Sorry, something went wrong.' });
      if (tts) {
        await speakWithEvents(currentReqId, 'Sorry, something went wrong.');
      }
    };

    const runPipeline = async (userText: string, currentReqId: number, socket: Socket, sessionId: number) => {
      try {
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
          await speakWithEvents(currentReqId, response.spoken);
        } else {
          console.log('[TTS] Intent output is silent. Skipping TTS speech.');
          socket.emit('speaking_stop');
        }
      } catch (err) {
        await handlePipelineError(currentReqId, err);
      }
    };

    socket.on('stop_speech', () => {
      console.log('[Orchestrator] Stop speech signal received from renderer.');
      tts.stop();
      socket.emit('speaking_stop');
    });

    socket.on('audio', async (audioBuffer: Buffer) => {
      if (!(await ensureSetupReady())) return;
      cancelActivePipeline();
      const currentReqId = activeRequestId;

      try {
        const debugPath = path.join(os.tmpdir(), 'pixi_debug.wav');
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
            await speakWithEvents(currentReqId, emptyResponse.spoken);
          }
          return;
        }

        await runPipeline(userText, currentReqId, socket, sessionId);
      } catch (err) {
        await handlePipelineError(currentReqId, err);
      }
    });

    socket.on('text', async (text: string) => {
      if (!(await ensureSetupReady())) return;
      cancelActivePipeline();
      const currentReqId = activeRequestId;

      try {
        console.log(`[Text Input]: "${text}"`);
        socket.emit('transcript', { text });

        const userText = text.trim();
        if (!userText) return;

        await runPipeline(userText, currentReqId, socket, sessionId);
      } catch (err) {
        await handlePipelineError(currentReqId, err);
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

  await new Promise<void>((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 20;
    const initialPort = config.server.port;

    const tryListen = (port: number) => {
      const onError = (err: any) => {
        if (err.code === 'EADDRINUSE' && attempts < maxAttempts) {
          attempts++;
          const nextPort = initialPort + attempts;
          console.warn(`[Orchestrator Port Warning] Port ${port} is in use. Retrying with fallback port ${nextPort}...`);
          tryListen(nextPort);
        } else {
          console.error(`[Orchestrator Port Error] Failed to bind HTTP server to port ${port}:`, err);
          reject(err);
        }
      };

      httpServer.once('error', onError);
      httpServer.listen(port, '127.0.0.1', () => {
        httpServer.removeListener('error', onError);
        config.server.port = port;
        console.log(`pixi orchestrator listening on 127.0.0.1:${port}`);
        resolve();
      });
    };

    tryListen(initialPort);
  });

  return { io, tts };
}
