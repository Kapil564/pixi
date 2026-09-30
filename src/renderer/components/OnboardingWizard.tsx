import React, { useEffect, useState } from 'react';

export interface OnboardingWizardProps {
  onComplete: () => void;
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ onComplete }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [apiKeys, setApiKeys] = useState<{ openai?: string; gemini?: string; opencode?: string; elevenlabs?: string }>({});
  const [setupProgress, setSetupProgress] = useState<number>(0);
  const [setupText, setSetupText] = useState<string>('Initializing setup...');
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState<boolean>(false);
  const [isSettingUp, setIsSettingUp] = useState<boolean>(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  const assistant = (window as any).assistant;

  useEffect(() => {
    if (assistant?.getSettings) {
      assistant
        .getSettings()
        .then((s: any) => {
          if (s?.apiKeys) {
            setApiKeys(s.apiKeys);
          }
        })
        .catch(() => {});
    }
  }, [assistant]);

  useEffect(() => {
    if (!assistant?.onSetupProgress) return;
    const unsub = assistant.onSetupProgress((p: { progress: number; text: string }) => {
      setSetupProgress(p.progress);
      setSetupText(p.text);
      if (p.progress >= 100) {
        setIsSettingUp(false);
        setStep(3);
      }
    });
    return () => {
      unsub?.();
    };
  }, [assistant]);

  const fetchLogs = async () => {
    if (assistant?.getSetupLogs) {
      try {
        const logEntries = await assistant.getSetupLogs();
        setLogs(logEntries || []);
      } catch (err) {
        console.warn('[Onboarding] Failed to fetch logs:', err);
      }
    }
  };

  const isSttCloud = Boolean(apiKeys.openai?.trim() || apiKeys.elevenlabs?.trim());
  const isLlmCloud = Boolean(apiKeys.opencode?.trim() || apiKeys.gemini?.trim() || apiKeys.openai?.trim());
  const isTtsCloud = Boolean(apiKeys.elevenlabs?.trim());

  const sttProviderName = apiKeys.openai?.trim()
    ? 'OpenAI Cloud'
    : apiKeys.elevenlabs?.trim()
      ? 'ElevenLabs Cloud'
      : 'Local Whisper';

  const llmProviderName = apiKeys.opencode?.trim()
    ? 'OpenCode (Cloud)'
    : apiKeys.gemini?.trim()
      ? 'Google Gemini'
      : apiKeys.openai?.trim()
        ? 'OpenAI Cloud'
        : 'Local Ollama';

  const ttsProviderName = apiKeys.elevenlabs?.trim() ? 'ElevenLabs Cloud' : 'Local Piper';

  const localCount = (isSttCloud ? 0 : 1) + (isLlmCloud ? 0 : 1) + (isTtsCloud ? 0 : 1);

  const handleContinue = async () => {
    try {
      if (assistant?.saveSettings) {
        await assistant.saveSettings({
          onboardingCompleted: localCount === 0,
          mode: 'custom',
          apiKeys,
        });
      }
    } catch (err) {
      console.error('[Onboarding] Failed to save settings:', err);
    }

    if (localCount === 0) {
      // All capabilities are cloud-backed with API keys — no local downloads needed
      try {
        if (assistant?.resizeToOrb) {
          assistant.resizeToOrb();
        }
      } catch {}
      onComplete();
      return;
    }

    // Local model setup sequence for any unconfigured capability
    setStep(2);
    setIsSettingUp(true);
    setSetupError(null);

    try {
      if (assistant?.runSetupSequence) {
        const success = await assistant.runSetupSequence();
        if (success) {
          setStep(3);
        } else {
          setIsSettingUp(false);
          setSetupError('Setup encountered an issue. Check diagnostic logs or retry.');
        }
      }
    } catch (err: any) {
      setIsSettingUp(false);
      setSetupError(err?.message || 'Failed to start setup sequence.');
    }
  };

  const handleRetry = async () => {
    setIsSettingUp(true);
    setSetupError(null);
    try {
      if (assistant?.retrySetup) {
        const success = await assistant.retrySetup();
        if (success) {
          setStep(3);
        } else {
          setIsSettingUp(false);
          setSetupError('Setup retry failed. Check local service status.');
        }
      }
    } catch {
      setIsSettingUp(false);
      setSetupError('Setup retry error.');
    }
  };

  const finishOnboarding = async () => {
    try {
      if (assistant?.saveSettings) {
        await assistant.saveSettings({ onboardingCompleted: true, mode: 'custom', apiKeys });
      }
      if (assistant?.resizeToOrb) {
        assistant.resizeToOrb();
      }
    } catch {
      // Ignore save error on finish
    }
    onComplete();
  };

  return (
    <div className="w-full h-full p-2 select-none font-sans text-white box-border flex items-center justify-center">
      <div className="w-full h-full bg-black border border-neutral-800 rounded-2xl p-5 shadow-2xl flex flex-col justify-between box-border overflow-y-auto">
        {/* Header with drag area */}
        <div className="drag-region flex items-center justify-between border-b border-neutral-800 pb-3 shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-7 h-7 rounded-lg bg-white text-black flex items-center justify-center font-bold text-xs shadow-sm">
              P
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-white uppercase">pixi</h2>
              <p className="text-[11px] text-neutral-400">AI Pipeline Configuration</p>
            </div>
          </div>

          <span className="no-drag text-[10px] font-mono tracking-wider px-2 py-0.5 rounded border border-neutral-800 text-neutral-400 bg-neutral-900">
            {step === 1 ? 'CONFIG' : step === 2 ? 'SETUP' : 'READY'}
          </span>
        </div>

        {/* STEP 1: Per-Service Configuration */}
        {step === 1 && (
          <div className="no-drag flex flex-col space-y-3.5 w-full my-auto py-2">
            <div className="space-y-0.5">
              <h3 className="text-sm font-medium text-white">Configure AI Capabilities</h3>
              <p className="text-xs text-neutral-400">
                Provide API keys for cloud services, or leave blank to run that service locally on your device.
              </p>
            </div>

            {/* STT Section */}
            <div className="p-3 rounded-xl border border-neutral-800 bg-neutral-950/70 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold text-xs tracking-wide block">1. Speech Recognition (STT)</span>
                  <span className="text-[10px] text-neutral-400">Transcribes your voice input</span>
                </div>
                <span
                  className={`text-[9px] uppercase font-mono px-2 py-0.5 rounded font-medium border ${
                    isSttCloud
                      ? 'bg-emerald-950/60 border-emerald-700 text-emerald-400'
                      : 'bg-neutral-900 border-neutral-700 text-neutral-300'
                  }`}
                >
                  {sttProviderName}
                </span>
              </div>
              <input
                type="password"
                placeholder="OpenAI API Key (sk-...) • blank for local Whisper"
                value={apiKeys.openai || ''}
                onChange={(e) => setApiKeys({ ...apiKeys, openai: e.target.value })}
                className="w-full bg-black border border-neutral-800 focus:border-white rounded-lg px-3 py-1.5 text-xs text-white placeholder-neutral-600 outline-none transition-colors"
              />
            </div>

            {/* LLM Section */}
            <div className="p-3 rounded-xl border border-neutral-800 bg-neutral-950/70 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold text-xs tracking-wide block">2. Intelligence & Reasoning (LLM)</span>
                  <span className="text-[10px] text-neutral-400">Parses requests & triggers actions</span>
                </div>
                <span
                  className={`text-[9px] uppercase font-mono px-2 py-0.5 rounded font-medium border ${
                    isLlmCloud
                      ? 'bg-emerald-950/60 border-emerald-700 text-emerald-400'
                      : 'bg-neutral-900 border-neutral-700 text-neutral-300'
                  }`}
                >
                  {llmProviderName}
                </span>
              </div>
              <input
                type="password"
                placeholder="OpenCode API Key (oc_sk_...) • priority cloud LLM"
                value={apiKeys.opencode || ''}
                onChange={(e) => setApiKeys({ ...apiKeys, opencode: e.target.value })}
                className="w-full bg-black border border-neutral-800 focus:border-white rounded-lg px-3 py-1.5 text-xs text-white placeholder-neutral-600 outline-none transition-colors"
              />
              <input
                type="password"
                placeholder="Google Gemini API Key (AIzaSy...) • blank for local Ollama"
                value={apiKeys.gemini || ''}
                onChange={(e) => setApiKeys({ ...apiKeys, gemini: e.target.value })}
                className="w-full bg-black border border-neutral-800 focus:border-white rounded-lg px-3 py-1.5 text-xs text-white placeholder-neutral-600 outline-none transition-colors"
              />
            </div>

            {/* TTS Section */}
            <div className="p-3 rounded-xl border border-neutral-800 bg-neutral-950/70 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold text-xs tracking-wide block">3. Speech Synthesis (TTS)</span>
                  <span className="text-[10px] text-neutral-400">Speaks audio responses back</span>
                </div>
                <span
                  className={`text-[9px] uppercase font-mono px-2 py-0.5 rounded font-medium border ${
                    isTtsCloud
                      ? 'bg-emerald-950/60 border-emerald-700 text-emerald-400'
                      : 'bg-neutral-900 border-neutral-700 text-neutral-300'
                  }`}
                >
                  {ttsProviderName}
                </span>
              </div>
              <input
                type="password"
                placeholder="ElevenLabs API Key • blank for local Piper voice"
                value={apiKeys.elevenlabs || ''}
                onChange={(e) => setApiKeys({ ...apiKeys, elevenlabs: e.target.value })}
                className="w-full bg-black border border-neutral-800 focus:border-white rounded-lg px-3 py-1.5 text-xs text-white placeholder-neutral-600 outline-none transition-colors"
              />
            </div>

            {/* Overview & Action Button */}
            <div className="pt-1">
              <div className="flex items-center justify-between text-[11px] text-neutral-400 mb-2 px-1">
                <span>Active configuration:</span>
                <span className="font-mono text-neutral-300">
                  {localCount === 0 ? 'All Cloud (No Downloads)' : `${localCount} Local / ${3 - localCount} Cloud`}
                </span>
              </div>
              <button
                onClick={handleContinue}
                className="w-full py-2.5 rounded-xl bg-white text-black font-semibold text-xs tracking-wide hover:bg-neutral-200 transition-colors shadow-sm"
              >
                {localCount === 0 ? 'Save & Start pixi →' : `Continue with ${localCount} Local Setup →`}
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Local Download & Setup Progress */}
        {step === 2 && (
          <div className="no-drag flex flex-col space-y-4 w-full my-auto py-2">
            <div className="space-y-0.5">
              <h3 className="text-sm font-medium text-white">Configuring Local Components</h3>
              <p className="text-xs text-neutral-400">
                Setting up local models for unconfigured services ({localCount} required)...
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 rounded-lg border border-neutral-800 bg-neutral-950 text-center">
                <span className="text-[10px] text-neutral-400 block font-mono">STT</span>
                <span className="text-xs font-semibold text-white">{sttProviderName}</span>
              </div>
              <div className="p-2 rounded-lg border border-neutral-800 bg-neutral-950 text-center">
                <span className="text-[10px] text-neutral-400 block font-mono">LLM</span>
                <span className="text-xs font-semibold text-white">{llmProviderName}</span>
              </div>
              <div className="p-2 rounded-lg border border-neutral-800 bg-neutral-950 text-center">
                <span className="text-[10px] text-neutral-400 block font-mono">TTS</span>
                <span className="text-xs font-semibold text-white">{ttsProviderName}</span>
              </div>
            </div>

            <div className="space-y-2 p-4 rounded-xl border border-neutral-800 bg-neutral-950">
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-300 truncate max-w-[400px]">{setupText}</span>
                <span className="font-mono font-bold text-white shrink-0 ml-2">{setupProgress}%</span>
              </div>
              <div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-white h-full transition-all duration-300 rounded-full"
                  style={{ width: `${Math.max(4, Math.min(100, setupProgress))}%` }}
                />
              </div>
            </div>

            {setupError && (
              <div className="p-3 rounded-xl border border-neutral-800 bg-neutral-950 text-xs text-neutral-300 space-y-2">
                <p>{setupError}</p>
                <button
                  onClick={handleRetry}
                  className="px-3 py-1.5 rounded-lg bg-neutral-800 text-white text-xs hover:bg-neutral-700 transition-colors"
                >
                  Retry Setup
                </button>
              </div>
            )}

            {/* Diagnostic Logs Drawer */}
            <div className="pt-1">
              <button
                onClick={() => {
                  fetchLogs();
                  setShowLogs(!showLogs);
                }}
                className="text-[11px] text-neutral-400 hover:text-white underline"
              >
                {showLogs ? 'Hide diagnostic logs' : 'View diagnostic logs'}
              </button>

              {showLogs && (
                <div className="mt-2 p-3 bg-black rounded-xl border border-neutral-800 max-h-28 overflow-y-auto font-mono text-[10px] text-neutral-400 space-y-1">
                  {logs.length > 0 ? (
                    logs.map((line, idx) => <div key={idx} className="break-words">{line}</div>)
                  ) : (
                    <div>No logs recorded yet.</div>
                  )}
                </div>
              )}
            </div>

            {setupProgress >= 100 && (
              <button
                onClick={() => setStep(3)}
                className="w-full py-2.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors shadow-sm"
              >
                Continue →
              </button>
            )}
          </div>
        )}

        {/* STEP 3: Setup Completed */}
        {step === 3 && (
          <div className="no-drag flex flex-col space-y-4 text-center py-2 w-full my-auto">
            <div className="w-10 h-10 rounded-full border border-neutral-700 bg-neutral-900 text-white flex items-center justify-center text-lg mx-auto font-mono">
              ✓
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-white">pixi is Ready</h3>
              <p className="text-xs text-neutral-400 leading-relaxed max-w-sm mx-auto">
                Your hybrid voice assistant is configured and ready for interactions.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 text-left">
              <div className="p-2.5 rounded-xl border border-neutral-800 bg-neutral-950">
                <span className="text-[10px] text-neutral-500 font-mono block">STT</span>
                <span className="text-xs font-semibold text-white truncate block">{sttProviderName}</span>
              </div>
              <div className="p-2.5 rounded-xl border border-neutral-800 bg-neutral-950">
                <span className="text-[10px] text-neutral-500 font-mono block">LLM</span>
                <span className="text-xs font-semibold text-white truncate block">{llmProviderName}</span>
              </div>
              <div className="p-2.5 rounded-xl border border-neutral-800 bg-neutral-950">
                <span className="text-[10px] text-neutral-500 font-mono block">TTS</span>
                <span className="text-xs font-semibold text-white truncate block">{ttsProviderName}</span>
              </div>
            </div>

            <div className="p-3 bg-neutral-950 rounded-xl border border-neutral-800 text-left text-xs space-y-1.5 text-neutral-300">
              <div className="font-medium text-white text-[11px] mb-1">Quick Shortcuts:</div>
              <div>
                • <span className="font-mono text-white bg-neutral-900 border border-neutral-800 px-1 py-0.5 rounded text-[10px]">Ctrl + Shift + Space</span> to toggle pixi
              </div>
              <div>
                • Say <span className="font-mono text-white bg-neutral-900 border border-neutral-800 px-1 py-0.5 rounded text-[10px]">"Hey pixi"</span> to wake with voice
              </div>
            </div>

            <button
              onClick={finishOnboarding}
              className="w-full py-2.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors shadow-sm"
            >
              Start Using pixi
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

