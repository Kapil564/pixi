import { useEffect, useRef, useState } from 'react';
import type { OrbPhase } from './components/WakeOrb';

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
    osc.onended = () => { ctx.close().catch(() => {}); };
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

export interface UseVoiceCaptureOptions {
  wakeWordEnabled: boolean;
  /** Must read the current orb phase from a ref so its value is never stale inside the engine. */
  getPhase: () => OrbPhase;
  onPhaseChange: (phase: OrbPhase) => void;
  onStatus: (text: string) => void;
  onError: (message: string) => void;
  /** Called once just before recording begins (e.g. interrupt assistant speech, show window). */
  onPrepareRecording?: () => void;
  /** Called with the recorded WAV buffer when capture stops with samples. */
  onAudioCaptured: (wav: ArrayBuffer) => void;
}

export function useVoiceCapture(options: UseVoiceCaptureOptions) {
  const {
    wakeWordEnabled,
    getPhase,
    onPhaseChange,
    onStatus,
    onError,
    onPrepareRecording,
    onAudioCaptured,
  } = options;

  const [listening, setListening] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const recognitionRef = useRef<any>(null);
  const isRecordingRef = useRef(false);
  const recordingStartTimeRef = useRef<number>(0);
  const vadStreamRef = useRef<MediaStream | null>(null);
  const vadAudioCtxRef = useRef<AudioContext | null>(null);
  const silenceCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasSpokenRef = useRef(false);
  const lastSpeechTimeRef = useRef<number>(0);

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

  const startLocalAudioVad = () => {
    if (vadAudioCtxRef.current || isRecordingRef.current || !wakeWordEnabled || getPhase() !== 'idle') return;

    const startTime = Date.now();
    const WARMUP_DURATION_MS = 1200;

    navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    }).then((stream) => {
      if (isRecordingRef.current || getPhase() !== 'idle') {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      vadStreamRef.current = stream;
      const ctx = new AudioContext();
      vadAudioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let activeEnergyCount = 0;
      let baselineSum = 0;
      let baselineCount = 0;
      let dynamicThreshold = 65;

      const checkVolume = () => {
        if (!wakeWordEnabled || isRecordingRef.current || !vadAudioCtxRef.current || getPhase() !== 'idle') return;

        analyser.getByteFrequencyData(dataArray);

        // Focus on speech frequency band (bins 4 to 32, roughly 125Hz to 2000Hz)
        let sum = 0;
        const startBin = 4;
        const endBin = Math.min(32, dataArray.length);
        for (let i = startBin; i < endBin; i++) {
          sum += dataArray[i];
        }
        const speechBandVolume = sum / (endBin - startBin);

        if (Date.now() - startTime < WARMUP_DURATION_MS) {
          baselineSum += speechBandVolume;
          baselineCount++;
          dynamicThreshold = Math.max(65, (baselineSum / Math.max(1, baselineCount)) + 28);
          requestAnimationFrame(checkVolume);
          return;
        }

        if (speechBandVolume > dynamicThreshold) {
          activeEnergyCount++;
          // Require sustained voice energy (~300ms) rather than momentary click or tap
          if (activeEnergyCount >= 18) {
            console.log(`[Offline VAD] Clear voice activity detected (vol=${speechBandVolume.toFixed(1)} > ${dynamicThreshold.toFixed(1)}). Auto-triggering recording...`);
            activeEnergyCount = 0;
            startRecording();
            return;
          }
        } else {
          activeEnergyCount = Math.max(0, activeEnergyCount - 1);
        }

        requestAnimationFrame(checkVolume);
      };

      checkVolume();
      console.log('[Offline VAD] Listening for local voice activity (idle only)...');
    }).catch((err) => {
      console.warn('[Offline VAD Error]: Microphone access failed:', err);
    });
  };

  const restartVoiceListener = () => {
    if (!wakeWordEnabled || isRecordingRef.current || getPhase() !== 'idle') return;

    if (recognitionRef.current) {
      try { recognitionRef.current.start(); } catch {}
    }

    if (!vadAudioCtxRef.current) {
      startLocalAudioVad();
    }
  };

  const processChunk = (chunk: Float32Array) => {
    pcmChunksRef.current.push(chunk);

    let sum = 0;
    for (let i = 0; i < chunk.length; i++) {
      sum += chunk[i] * chunk[i];
    }
    const rms = Math.sqrt(sum / (chunk.length || 1));

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
    recordingStartTimeRef.current = Date.now();

    if (silenceCheckIntervalRef.current) {
      clearInterval(silenceCheckIntervalRef.current);
    }

    silenceCheckIntervalRef.current = setInterval(() => {
      if (!isRecordingRef.current) return;
      if (hasSpokenRef.current) {
        const elapsedSilence = Date.now() - lastSpeechTimeRef.current;
        if (elapsedSilence >= 2000) {
          console.log('[Silence VAD] 2 seconds of silence detected after user speech. Auto-submitting audio to LLM...');
          stopRecording();
        }
      } else {
        const elapsedRecording = Date.now() - recordingStartTimeRef.current;
        if (elapsedRecording >= 10000) {
          console.log('[Silence VAD] No speech detected after 10 seconds. Auto-stopping recording...');
          stopRecording();
        }
      }
    }, 200);

    onPrepareRecording?.();
    playWakeChime();
    onPhaseChange('listening');
    setListening(true);
    onStatus('🎙 Listening...');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        },
      });
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
      onError('Microphone access is required.');
      onStatus('');
      onPhaseChange('idle');
      isRecordingRef.current = false;
      restartVoiceListener();
    }
  };

  const stopRecording = () => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    stopVadListener();

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
      onStatus('');
      onPhaseChange('idle');
      restartVoiceListener();
      return;
    }

    const pcm = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of chunks) {
      pcm.set(chunk, offset);
      offset += chunk.length;
    }

    const wavBuffer = encodeWav(pcm, 16000);
    onStatus('⚡ Transcribing...');
    onPhaseChange('thinking');
    onAudioCaptured(wavBuffer);
    setListening(false);
  };

  const toggleRecording = () => {
    if (listening || isRecordingRef.current) stopRecording();
    else startRecording();
  };

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
              transcript.includes('pixi') ||
              transcript.includes('hey pixi') ||
              transcript.includes('hi pixi') ||
              transcript.includes('ok pixi') ||
              transcript.includes('wake up pixi')
            ) {
              console.log('[Wake Word Detected]:', transcript);
              startRecording();
              break;
            }
          }
        };

        recognition.onerror = (e: any) => {
          if (e.error === 'network' || e.error === 'no-speech' || e.error === 'aborted') {
            if (e.error === 'network' && getPhase() === 'idle') {
              startLocalAudioVad();
            }
            return;
          }
          console.warn('[Wake Word Warning]:', e.error);
        };

        recognition.onend = () => {
          if (wakeWordEnabled && !isRecordingRef.current && getPhase() === 'idle') {
            setTimeout(() => {
              if (wakeWordEnabled && !isRecordingRef.current && getPhase() === 'idle') {
                try { recognition.start(); } catch {}
              }
            }, 1000);
          }
        };

        recognition.start();
        recognitionRef.current = recognition;
        console.log('[Wake Word] Listening for "Hey pixi"...');
      } catch (err) {
        if (getPhase() === 'idle') {
          startLocalAudioVad();
        }
      }
    } else {
      if (getPhase() === 'idle') {
        startLocalAudioVad();
      }
    }

    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        recognitionRef.current = null;
      }
      stopVadListener();
    };
  }, [wakeWordEnabled]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        recognitionRef.current = null;
      }
      stopVadListener();
      cleanupWorkletUrl();
    };
  }, []);

  const resumeAudioContexts = () => {
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    if (vadAudioCtxRef.current && vadAudioCtxRef.current.state === 'suspended') {
      vadAudioCtxRef.current.resume().catch(() => {});
    }
  };

  return {
    listening,
    startRecording,
    stopRecording,
    toggleRecording,
    restartVoiceListener,
    stopVadListener,
    resumeAudioContexts,
  };
}