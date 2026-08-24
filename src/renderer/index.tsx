import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WakeOrb, type OrbPhase } from './components/WakeOrb';
import { Windows11Widget } from './components/Windows11Widget';

function encodeWav(samples: Float32Array, sampleRate = 16000): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');

  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);

  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return buffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function playWakeChime() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // ignore audio context error
  }
}

const workletCode = `
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0 && input[0].length > 0) {
      this.port.postMessage(input[0]);
    }
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
`;
let workletBlobUrl: string | null = null;
function getWorkletUrl() {
  if (!workletBlobUrl) {
    const blob = new Blob([workletCode], { type: 'application/javascript' });
    workletBlobUrl = URL.createObjectURL(blob);
  }
  return workletBlobUrl;
}

function cleanupWorkletUrl() {
  if (workletBlobUrl) {
    URL.revokeObjectURL(workletBlobUrl);
    workletBlobUrl = null;
  }
}

import { SetupBanner } from './components/SetupBanner';
import { OnboardingWizard } from './components/OnboardingWizard';

function App() {
  const [messages, setMessages] = useState<{ from: 'user' | 'saira'; text: string }[]>([]);
  const [listening, setListening] = useState(false);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(true);
  const [status, setStatus] = useState<string>('');
  const [inputText, setInputText] = useState('');
  const [viewMode, setViewMode] = useState<'orb' | 'widget'>('orb');
  const [orbPhase, setOrbPhase] = useState<OrbPhase>('idle');
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [setupState, setSetupState] = useState<{
    isComplete: boolean;
    progress: number;
    stepText: string;
  }>({
    isComplete: true,
    progress: 100,
    stepText: '',
  });

  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const isRecordingRef = useRef(false);
  const vadStreamRef = useRef<MediaStream | null>(null);
  const vadAudioCtxRef = useRef<AudioContext | null>(null);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);

  const hasSpokenRef = useRef(false);
  const lastSpeechTimeRef = useRef<number>(0);
  const silenceCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    const assistant = (window as any).assistant;
    if (!assistant) return;

    Promise.all([
      assistant.getSettings ? assistant.getSettings() : Promise.resolve(null),
      assistant.getSetupStatus ? assistant.getSetupStatus() : Promise.resolve(null),
    ]).then(([settings, st]: [any, any]) => {
      if (st) {
        setSetupState({
          isComplete: st.isComplete,
          progress: st.overallProgress,
          stepText: st.stepText,
        });
      }

      const isFullyInstalled = Boolean(st?.isComplete);
      const isOnboardingDone = Boolean(settings?.onboardingCompleted);

      if (isOnboardingDone || isFullyInstalled) {
        setShowOnboarding(false);
        if (assistant.resizeToOrb) assistant.resizeToOrb();
      } else {
        setShowOnboarding(true);
        if (assistant.resizeToOnboarding) assistant.resizeToOnboarding();
      }
    }).catch(() => {});

    assistant.onSetupProgress?.((data: { progress: number; text: string }) => {
      const isDone = data.progress >= 100;
      setSetupState({
        isComplete: isDone,
        progress: data.progress,
        stepText: data.text,
      });

      if (!isDone && data.progress > 0) {
        setViewMode('widget');
      } else if (isDone) {
        setViewMode('orb');
      }
    });
  }, []);


  useEffect(() => {
    scrollToBottom();
  }, [messages, status]);

  const addMessage = (from: 'user' | 'saira', text: string) => {
    setMessages((prev) => [...prev, { from, text }]);
  };

  const stopVadListener = () => {
    if (vadAudioCtxRef.current) {
      try { vadAudioCtxRef.current.close(); } catch {}
      vadAudioCtxRef.current = null;
    }
    if (vadStreamRef.current) {
      try { vadStreamRef.current.getTracks().forEach(t => t.stop()); } catch {}
      vadStreamRef.current = null;
    }
  };

  const processChunk = (chunk: Float32Array) => {
    pcmChunksRef.current.push(chunk);

    let sum = 0;
    for (let i = 0; i < chunk.length; i++) {
      sum += chunk[i] * chunk[i];
    }
    const rms = Math.sqrt(sum / (chunk.length || 1));

    // Threshold for detecting active vocal energy
    if (rms > 0.015) {
      hasSpokenRef.current = true;
      lastSpeechTimeRef.current = Date.now();
    }
  };

  const startRecording = async () => {
    if (isRecordingRef.current) return;
    isRecordingRef.current = true;
    stopVadListener();

    hasSpokenRef.current = false;
    lastSpeechTimeRef.current = Date.now();

    if (silenceCheckIntervalRef.current) {
      clearInterval(silenceCheckIntervalRef.current);
    }

    // 4-second silence detection timer after speech starts
    silenceCheckIntervalRef.current = setInterval(() => {
      if (!isRecordingRef.current) return;
      if (hasSpokenRef.current) {
        const elapsedSilence = Date.now() - lastSpeechTimeRef.current;
        if (elapsedSilence >= 4000) {
          console.log('[Silence VAD] 4 seconds of silence detected after user speech. Auto-submitting audio to LLM...');
          stopRecording();
        }
      }
    }, 200);

    const assistant = (window as any).assistant;
    if (assistant?.stopSpeech) assistant.stopSpeech();
    if (assistant?.showWindow) assistant.showWindow();

    playWakeChime();
    setOrbPhase('listening');
    setListening(true);
    setStatus('🎙 Listening...');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      pcmChunksRef.current = [];

      const source = audioCtx.createMediaStreamSource(stream);

      if (audioCtx.audioWorklet) {
        try {
          await audioCtx.audioWorklet.addModule(getWorkletUrl());
          const workletNode = new AudioWorkletNode(audioCtx, 'pcm-processor');
          workletNodeRef.current = workletNode;
          workletNode.port.onmessage = (e) => {
            processChunk(new Float32Array(e.data));
          };
          source.connect(workletNode);
          workletNode.connect(audioCtx.destination);
        } catch {
          const processor = audioCtx.createScriptProcessor(4096, 1, 1);
          processorRef.current = processor;
          processor.onaudioprocess = (e) => {
            processChunk(new Float32Array(e.inputBuffer.getChannelData(0)));
          };
          source.connect(processor);
          processor.connect(audioCtx.destination);
        }
      } else {
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;
        processor.onaudioprocess = (e) => {
          processChunk(new Float32Array(e.inputBuffer.getChannelData(0)));
        };
        source.connect(processor);
        processor.connect(audioCtx.destination);
      }
    } catch (err) {
      addMessage('saira', 'Microphone access is required.');
      setStatus('');
      setOrbPhase('idle');
      isRecordingRef.current = false;
    }
  };

  const stopRecording = () => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;

    if (silenceCheckIntervalRef.current) {
      clearInterval(silenceCheckIntervalRef.current);
      silenceCheckIntervalRef.current = null;
    }
    hasSpokenRef.current = false;

    if (workletNodeRef.current) {
      try { workletNodeRef.current.disconnect(); } catch {}
      workletNodeRef.current = null;
    }
    if (processorRef.current) {
      try { processorRef.current.disconnect(); } catch {}
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }

    const chunks = pcmChunksRef.current;
    const totalSamples = chunks.reduce((acc, c) => acc + c.length, 0);
    if (totalSamples === 0) {
      setListening(false);
      setStatus('');
      setOrbPhase('idle');
      return;
    }

    const pcm = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of chunks) {
      pcm.set(chunk, offset);
      offset += chunk.length;
    }

    const wavBuffer = encodeWav(pcm, 16000);
    setStatus('⚡ Transcribing...');
    setOrbPhase('thinking');
    const assistant = (window as any).assistant;
    if (assistant?.sendAudio) {
      assistant.sendAudio(wavBuffer);
    } else {
      addMessage('saira', 'Error: Assistant bridge is not connected.');
      setStatus('');
      setOrbPhase('idle');
    }
    setListening(false);
  };

  const toggleRecording = () => {
    if (listening) stopRecording();
    else startRecording();
  };

  // Continuous Offline Voice Activity & Wake-Word Detector
  useEffect(() => {
    if (!wakeWordEnabled) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        recognitionRef.current = null;
      }
      stopVadListener();
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    let useWebSpeech = Boolean(SpeechRecognition);

    if (useWebSpeech) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
          if (isRecordingRef.current) return;

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0]?.transcript?.toLowerCase() || '';
            if (
              transcript.includes('saira') ||
              transcript.includes('hey saira') ||
              transcript.includes('hi saira') ||
              transcript.includes('ok saira') ||
              transcript.includes('wake up saira')
            ) {
              console.log('[Wake Word Detected]:', transcript);
              startRecording();
              break;
            }
          }
        };

        recognition.onerror = (e: any) => {
          if (e.error === 'network' || e.error === 'no-speech' || e.error === 'aborted') {
            if (e.error === 'network') {
              startLocalAudioVad();
            }
            return;
          }
          console.warn('[Wake Word Warning]:', e.error);
        };

        recognition.onend = () => {
          if (wakeWordEnabled && !isRecordingRef.current) {
            setTimeout(() => {
              try { recognition.start(); } catch {}
            }, 1000);
          }
        };

        recognition.start();
        recognitionRef.current = recognition;
        console.log('[Wake Word] Listening for "Hey Saira"...');
      } catch (err) {
        startLocalAudioVad();
      }
    } else {
      startLocalAudioVad();
    }

    function startLocalAudioVad() {
      if (vadAudioCtxRef.current || isRecordingRef.current) return;

      const startTime = Date.now();
      const WARMUP_DURATION_MS = 1500; // Ignore mic init audio pop/spikes for first 1.5s

      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        vadStreamRef.current = stream;
        const ctx = new AudioContext();
        vadAudioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let activeEnergyCount = 0;

        const checkVolume = () => {
          if (!wakeWordEnabled || isRecordingRef.current || !vadAudioCtxRef.current) return;

          // Ignore noise during mic initialization warmup period
          if (Date.now() - startTime < WARMUP_DURATION_MS) {
            requestAnimationFrame(checkVolume);
            return;
          }

          analyser.getByteFrequencyData(dataArray);

          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const averageVolume = sum / dataArray.length;

          // Require natural voice threshold (55) and sustained energy (8 frames ~ 150ms) after warmup
          if (averageVolume > 55) {
            activeEnergyCount++;
            if (activeEnergyCount >= 8) {
              console.log('[Offline VAD] Clear voice activity detected. Auto-triggering recording...');
              startRecording();
              activeEnergyCount = 0;
              return;
            }
          } else {
            activeEnergyCount = Math.max(0, activeEnergyCount - 1);
          }

          requestAnimationFrame(checkVolume);
        };

        checkVolume();
        console.log('[Offline VAD] Listening for local voice activity...');
      }).catch((err) => {
        console.warn('[Offline VAD Error]: Microphone access failed:', err);
      });
    }

    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        recognitionRef.current = null;
      }
      stopVadListener();
    };
  }, [wakeWordEnabled]);

  const handleSendText = (textOverride?: string) => {
    const text = (textOverride || inputText).trim();
    if (!text) return;

    setInputText('');
    setStatus('🧠 Processing request...');
    setOrbPhase('thinking');

    const assistant = (window as any).assistant;
    if (assistant?.stopSpeech) assistant.stopSpeech();
    if (assistant?.sendText) {
      assistant.sendText(text);
    } else {
      addMessage('saira', 'Error: Assistant bridge is not connected.');
      setStatus('');
      setOrbPhase('idle');
    }
  };

  useEffect(() => {
    const assistant = (window as any).assistant;
    if (!assistant) return;

    const handleReactivate = () => {
      console.log('[Renderer] Window reactivated. Resuming audio contexts...');
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
      if (vadAudioCtxRef.current && vadAudioCtxRef.current.state === 'suspended') {
        vadAudioCtxRef.current.resume().catch(() => {});
      }
    };

    assistant.onWindowShown?.(handleReactivate);
    window.addEventListener('focus', handleReactivate);
    document.addEventListener('visibilitychange', handleReactivate);

    assistant.onTranscript?.((data: { text: string }) => {
      if (data.text) {
        addMessage('user', data.text);
        setStatus('🧠 Thinking...');
        setOrbPhase('thinking');
      } else {
        setStatus('');
        setOrbPhase('idle');
      }
    });

    assistant.onResponse?.((response: { spoken?: string; display?: string }) => {
      addMessage('saira', response.display || response.spoken || 'Done.');
      setStatus('');
      if (response.spoken && response.spoken.trim()) {
        setOrbPhase('speaking');
        setTimeout(() => {
          setOrbPhase('idle');
        }, 3500);
      } else {
        setOrbPhase('idle');
      }
    });

    return () => {
      window.removeEventListener('focus', handleReactivate);
      document.removeEventListener('visibilitychange', handleReactivate);
      cleanupWorkletUrl();
    };
  }, [viewMode]);

  const toggleViewMode = () => {
    const nextMode = viewMode === 'orb' ? 'widget' : 'orb';
    setViewMode(nextMode);
    const assistant = (window as any).assistant;
    if (nextMode === 'widget' && assistant?.resizeToWidget) {
      assistant.resizeToWidget();
    } else if (nextMode === 'orb' && assistant?.resizeToOrb) {
      assistant.resizeToOrb();
    }
  };

  useEffect(() => {
    const assistant = (window as any).assistant;
    if (viewMode === 'widget' && assistant?.resizeToWidget) {
      assistant.resizeToWidget();
    } else if (assistant?.resizeToOrb) {
      assistant.resizeToOrb();
    }
  }, [viewMode]);

  const lastSairaMsg = messages.filter((m) => m.from === 'saira').slice(-1)[0]?.text;
  const lastUserMsg = messages.filter((m) => m.from === 'user').slice(-1)[0]?.text;

  return (
    <>
      {showOnboarding && <OnboardingWizard onComplete={() => setShowOnboarding(false)} />}
      {viewMode === 'widget' ? (
        <div className="w-full flex flex-col items-center">
          <SetupBanner
            isComplete={setupState.isComplete}
            progress={setupState.progress}
            stepText={setupState.stepText}
          />
          <Windows11Widget
            phase={orbPhase}
            transcription={lastUserMsg}
            statusText={status}
            responseMessage={lastSairaMsg}
            onMicClick={toggleRecording}
            onSendText={handleSendText}
            onSwitchMode={toggleViewMode}
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center p-2">
          <WakeOrb
            phase={orbPhase}
            size={100}
            onClick={toggleRecording}
          />
        </div>
      )}
    </>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
