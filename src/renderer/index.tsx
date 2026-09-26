import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WakeOrb, type OrbPhase } from './components/WakeOrb';
import { Windows11Widget } from './components/Windows11Widget';
import { SetupBanner } from './components/SetupBanner';
import { OnboardingWizard } from './components/OnboardingWizard';
import { useVoiceCapture } from './useVoiceCapture';

interface PipelineStageState {
  stage: string;
  ready: boolean;
  progress: number;
  statusText: string;
  label: string;
}

interface PipelineReadinessState {
  ready: boolean;
  currentStage: string | null;
  nextBlocker: string | null;
  overallProgress: number;
  stages?: PipelineStageState[];
}

function App() {
  const [messages, setMessages] = useState<{ from: 'user' | 'pixi'; text: string }[]>([]);
  const [wakeWordEnabled] = useState(true);
  const [status, setStatus] = useState<string>('');
  const [inputText, setInputText] = useState('');
  // Ordered pipeline gate (STT -> LLM -> TTS): voice + text input stay disabled
  // until the main process reports every stage ready.
  const [pipelineReady, setPipelineReady] = useState<boolean>(false);
  const [pipelineProgress, setPipelineProgress] = useState<number>(0);
  const [pipelineBlocker, setPipelineBlocker] = useState<string>('');
  const [pipelineStages, setPipelineStages] = useState<PipelineStageState[]>([]);
  const [viewMode, setViewMode] = useState<'orb' | 'widget'>('orb');
  const [orbPhase, setOrbPhase] = useState<OrbPhase>('idle');
  const orbPhaseRef = useRef<OrbPhase>('idle');
  const updateOrbPhase = (phase: OrbPhase) => {
    orbPhaseRef.current = phase;
    setOrbPhase(phase);
  };
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

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
      const isOnboardingDone = Boolean(settings?.onboardingCompleted);

      if (isOnboardingDone) {
        setShowOnboarding(false);
        if (assistant.resizeToOrb) assistant.resizeToOrb();
      } else {
        setShowOnboarding(true);
        if (assistant.resizeToOnboarding) assistant.resizeToOnboarding();
      }
    }).catch(() => {});
  }, []);

  // Subscribe to main-process pipeline readiness pushes (STT -> LLM -> TTS) so
  // the UI unlocks exactly when the orchestrator's backend gate opens.
  useEffect(() => {
    const assistant = (window as any).assistant;
    if (!assistant) return;

    let unsubscribe: (() => void) | undefined;

    if (assistant.onPipelineReadiness) {
      unsubscribe = assistant.onPipelineReadiness((data: PipelineReadinessState) => {
        setPipelineReady(Boolean(data?.ready));
        if (data?.overallProgress !== undefined) setPipelineProgress(data.overallProgress);
        if (data?.nextBlocker !== undefined) setPipelineBlocker(data.nextBlocker || '');
        if (data?.stages) setPipelineStages(data.stages);
      });
    }

    // Seed initial state so the gate reflects reality from the first paint
    if (assistant.getSetupStatus) {
      assistant
        .getSetupStatus()
        .then((st: any) => {
          setPipelineReady(Boolean(st?.pipeline?.ready ?? st?.isComplete));
          if (st?.pipeline?.overallProgress !== undefined) setPipelineProgress(st.pipeline.overallProgress);
          if (st?.pipeline?.nextBlocker !== undefined) setPipelineBlocker(st.pipeline.nextBlocker || '');
          if (st?.pipeline?.stages) {
            setPipelineStages(
              st.pipeline.stages.map((s: any) => ({
                stage: s.stage,
                ready: s.ready,
                progress: s.progress,
                statusText: s.statusText,
                label: s.label,
              }))
            );
          }
        })
        .catch(() => {});
    }

    return () => {
      unsubscribe?.();
      assistant.offPipelineReadiness?.();
    };
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, status]);

  const addMessage = (from: 'user' | 'pixi', text: string) => {
    setMessages((prev) => [...prev, { from, text }]);
  };

  const {
    startRecording,
    stopRecording,
    toggleRecording,
    restartVoiceListener,
    stopVadListener,
    resumeAudioContexts,
  } = useVoiceCapture({
    wakeWordEnabled: wakeWordEnabled && pipelineReady,
    getPhase: () => orbPhaseRef.current,
    onPhaseChange: updateOrbPhase,
    onStatus: setStatus,
    onError: (message) => addMessage('pixi', message),
    onPrepareRecording: () => {
      const assistant = (window as any).assistant;
      if (orbPhaseRef.current === 'speaking' && assistant?.stopSpeech) {
        assistant.stopSpeech();
      }
      if (assistant?.showWindow) assistant.showWindow();
    },
    onAudioCaptured: (wav) => {
      const assistant = (window as any).assistant;
      if (assistant?.sendAudio) {
        assistant.sendAudio(wav);
      } else {
        addMessage('pixi', 'Error: Assistant bridge is not connected.');
        setStatus('');
        updateOrbPhase('idle');
        restartVoiceListener();
      }
    },
  });

  const handleSendText = (textOverride?: string) => {
    if (!pipelineReady) {
      addMessage('pixi', 'pixi is still setting up (STT → LLM → TTS). Please wait for setup to complete.');
      return;
    }

    const text = (textOverride || inputText).trim();
    if (!text) return;

    setInputText('');
    setStatus('🧠 Processing request...');
    updateOrbPhase('thinking');

    const assistant = (window as any).assistant;
    if (orbPhaseRef.current === 'speaking' && assistant?.stopSpeech) {
      assistant.stopSpeech();
    }
    if (assistant?.sendText) {
      assistant.sendText(text);
    } else {
      addMessage('pixi', 'Error: Assistant bridge is not connected.');
      setStatus('');
      updateOrbPhase('idle');
      restartVoiceListener();
    }
  };

  useEffect(() => {
    const assistant = (window as any).assistant;
    if (!assistant) return;

    const cleanups: (() => void)[] = [];

    const handleReactivate = () => {
      console.log('[Renderer] Window reactivated. Resuming audio contexts...');
      resumeAudioContexts();
    };

    assistant.onWindowShown?.(handleReactivate);
    window.addEventListener('focus', handleReactivate);
    document.addEventListener('visibilitychange', handleReactivate);
    cleanups.push(() => {
      window.removeEventListener('focus', handleReactivate);
      document.removeEventListener('visibilitychange', handleReactivate);
    });

    const offTranscript = assistant.onTranscript?.((data: { text: string }) => {
      if (data.text) {
        addMessage('user', data.text);
        setStatus('🧠 Thinking...');
        updateOrbPhase('thinking');
      }
    });
    if (offTranscript) cleanups.push(offTranscript);

    const offResponse = assistant.onResponse?.((response: { spoken?: string; display?: string }) => {
      addMessage('pixi', response.display || response.spoken || 'Done.');
      if (!response.spoken || !response.spoken.trim()) {
        setStatus('');
        updateOrbPhase('idle');
        restartVoiceListener();
      } else {
        setStatus('🔊 Speaking...');
      }
    });
    if (offResponse) cleanups.push(offResponse);

    const offSpeakingStart = assistant.onSpeakingStart?.(() => {
      stopVadListener();
      updateOrbPhase('speaking');
      setStatus('🔊 Speaking...');
    });
    if (offSpeakingStart) cleanups.push(offSpeakingStart);

    const offSpeakingStop = assistant.onSpeakingStop?.(() => {
      updateOrbPhase('idle');
      setStatus('');
      // Enforce an 800ms acoustic grace period to allow room reflections of the speaker audio to dissipate
      setTimeout(() => {
        if (orbPhaseRef.current === 'idle') {
          restartVoiceListener();
        }
      }, 800);
    });
    if (offSpeakingStop) cleanups.push(offSpeakingStop);

    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, []);

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


  // NOTE: Window resize is driven by two explicit sources only:
  //   1. toggleViewMode() when the user switches modes interactively
  //   2. The onboarding Promise.then() which resolves the correct startup size
  // A standalone [viewMode] effect is intentionally absent to prevent a startup
  // race condition where resizeToOrb() fires simultaneously with resizeToOnboarding().

  const lastpixiMsg = messages.filter((m) => m.from === 'pixi').slice(-1)[0]?.text;
  const lastUserMsg = messages.filter((m) => m.from === 'user').slice(-1)[0]?.text;

  return (
    <div className="w-full h-full select-none">
      {showOnboarding ? (
        <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
      ) : viewMode === 'widget' ? (
        <div className="w-full flex flex-col items-center">
          <SetupBanner
            isComplete={pipelineReady}
            progress={pipelineProgress}
            stepText={pipelineBlocker || 'Setting up offline models...'}
            stages={pipelineStages}
          />
          <Windows11Widget
            phase={orbPhase}
            transcription={lastUserMsg}
            statusText={status}
            responseMessage={lastpixiMsg}
            onMicClick={toggleRecording}
            onSendText={handleSendText}
            onSwitchMode={toggleViewMode}
            disabled={!pipelineReady}
          />
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <WakeOrb
            phase={orbPhase}
            size={100}
            onClick={toggleRecording}
            onSwitchMode={toggleViewMode}
            disabled={!pipelineReady}
          />
        </div>
      )}
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);