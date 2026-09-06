import React, { useState, useEffect } from 'react';

export interface OnboardingWizardProps {
  onComplete: () => void;
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ onComplete }) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [mode, setMode] = useState<'offline' | 'cloud'>('offline');
  const [apiKeys, setApiKeys] = useState<{ openai?: string; gemini?: string; groq?: string }>({});
  const [sysInfo, setSysInfo] = useState<any>(null);
  const [setupProgress, setSetupProgress] = useState<number>(0);
  const [setupText, setSetupText] = useState<string>('Initializing setup...');
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState<boolean>(false);
  const [isSettingUp, setIsSettingUp] = useState<boolean>(false);

  const assistant = (window as any).assistant;

  useEffect(() => {
    if (assistant?.getSystemStatus) {
      assistant.getSystemStatus().then((info: any) => setSysInfo(info)).catch((err: any) => {
        console.warn('[Onboarding Warning] Failed to fetch system status:', err);
      });
    }
  }, []);

  useEffect(() => {
    if (!assistant) return;

    assistant.onSetupProgress?.((data: { progress: number; text: string }) => {
      setSetupProgress(data.progress);
      setSetupText(data.text);
      if (data.progress >= 100) {
        setIsSettingUp(false);
      }
    });
  }, []);

  const fetchLogs = async () => {
    if (assistant?.getSetupLogs) {
      try {
        const logEntries = await assistant.getSetupLogs();
        setLogs(logEntries || []);
      } catch (err) {
        console.warn('[Onboarding Warning] Failed to fetch setup logs:', err);
      }
    }
  };

  const startSetup = async () => {
    setIsSettingUp(true);
    setStep(3);

    try {
      if (assistant?.saveSettings) {
        await assistant.saveSettings({ mode, apiKeys });
      }

      if (assistant?.runSetupSequence) {
        const success = await assistant.runSetupSequence();
        if (success) {
          setStep(4);
        } else {
          setIsSettingUp(false);
        }
      }
    } catch {
      setIsSettingUp(false);
    }
  };

  const handleRetry = async () => {
    setIsSettingUp(true);
    try {
      if (assistant?.retrySetup) {
        const success = await assistant.retrySetup();
        if (success) {
          setStep(4);
        } else {
          setIsSettingUp(false);
        }
      }
    } catch {
      setIsSettingUp(false);
    }
  };

  const finishOnboarding = async () => {
    try {
      if (assistant?.saveSettings) {
        await assistant.saveSettings({ onboardingCompleted: true, mode, apiKeys });
      }
      if (assistant?.resizeToOrb) {
        assistant.resizeToOrb();
      }
    } catch {
      // Ignore settings save error on finish
    }
    onComplete();
  };

  return (
    <div className="fixed inset-0 bg-[#11111b]/80 backdrop-blur-md flex items-center justify-center p-4 z-50 select-none">
      <div className="w-full max-w-[560px] bg-[#1e1e2e] border-2 border-[#313244] rounded-3xl p-6 shadow-[0_20px_50px_rgba(0,0,0,0.6)] flex flex-col space-y-5 text-[#cdd6f4] box-border overflow-hidden">
        
        {/* Wizard Header */}
        <div className="flex items-center justify-between border-b border-[#313244] pb-4">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-[#b4befe] text-[#11111b] flex items-center justify-center font-bold text-lg shadow-sm">
              S
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight text-[#cdd6f4]">Welcome to pixi</h2>
              <p className="text-xs text-[#a6adc8]">Step {step} of 4 — First Run Onboarding</p>
            </div>
          </div>

          {/* Step Indicator Dots */}
          <div className="flex items-center space-x-1.5">
            {[1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                  step === i ? 'bg-[#89b4fa] w-5' : step > i ? 'bg-[#a6e3a1]' : 'bg-[#313244]'
                }`}
              />
            ))}
          </div>
        </div>

        {/* STEP 1: Mode Selection */}
        {step === 1 && (
          <div className="flex flex-col space-y-4 w-full overflow-hidden">
            <h3 className="text-sm font-semibold text-[#cdd6f4]">Choose your preferred assistant mode:</h3>
            
            <div
              onClick={() => setMode('offline')}
              className={`p-4 rounded-2xl border-2 cursor-pointer transition-all w-full box-border ${
                mode === 'offline'
                  ? 'border-[#89b4fa] bg-[#181825]'
                  : 'border-[#313244] bg-[#1e1e2e] hover:border-[#45475a]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-[#89b4fa]">🔒 100% Offline Privacy Mode</span>
                {mode === 'offline' && <span className="text-xs text-[#a6e3a1] font-bold">Selected</span>}
              </div>
              <p className="text-xs text-[#a6adc8] mt-1.5 leading-relaxed break-words whitespace-normal font-normal">
                Runs local Ollama LLM, Whisper STT, and Piper TTS on your computer. Zero data leaves your PC. Downloads ~2.5GB local models.
              </p>
            </div>

            <div
              onClick={() => setMode('cloud')}
              className={`p-4 rounded-2xl border-2 cursor-pointer transition-all w-full box-border ${
                mode === 'cloud'
                  ? 'border-[#f5c2e7] bg-[#181825]'
                  : 'border-[#313244] bg-[#1e1e2e] hover:border-[#45475a]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-[#f5c2e7]">⚡ Cloud API Key Mode</span>
                {mode === 'cloud' && <span className="text-xs text-[#a6e3a1] font-bold">Selected</span>}
              </div>
              <p className="text-xs text-[#a6adc8] mt-1.5 leading-relaxed break-words whitespace-normal font-normal">
                Connect your OpenAI, Gemini, or Groq API keys for instant cloud inference without downloading local LLM models.
              </p>
            </div>

            {mode === 'cloud' && (
              <div className="p-3 bg-[#181825] rounded-xl border border-[#313244] space-y-2 w-full box-border">
                <span className="text-xs font-semibold text-[#cdd6f4]">Optional API Keys:</span>
                <input
                  type="password"
                  placeholder="OpenAI API Key (sk-...)"
                  value={apiKeys.openai || ''}
                  onChange={(e) => setApiKeys({ ...apiKeys, openai: e.target.value })}
                  className="w-full bg-[#1e1e2e] border border-[#45475a] rounded-lg px-3 py-1.5 text-xs text-[#cdd6f4] outline-none"
                />
                <input
                  type="password"
                  placeholder="Gemini API Key"
                  value={apiKeys.gemini || ''}
                  onChange={(e) => setApiKeys({ ...apiKeys, gemini: e.target.value })}
                  className="w-full bg-[#1e1e2e] border border-[#45475a] rounded-lg px-3 py-1.5 text-xs text-[#cdd6f4] outline-none"
                />
              </div>
            )}

            <button
              onClick={() => setStep(2)}
              className="w-full py-2.5 rounded-xl bg-[#89b4fa] text-[#11111b] font-bold text-sm hover:bg-[#b4befe] transition-all shadow-md mt-2"
            >
              Continue to System Check →
            </button>
          </div>
        )}

        {/* STEP 2: System Diagnostics */}
        {step === 2 && (
          <div className="flex flex-col space-y-4 w-full overflow-hidden">
            <h3 className="text-sm font-semibold text-[#cdd6f4]">Pre-flight System Diagnostics</h3>

            {sysInfo ? (
              <div className="grid grid-cols-2 gap-3 text-xs w-full">
                <div className="p-3 bg-[#181825] rounded-xl border border-[#313244]">
                  <span className="text-[#a6adc8] block">Available RAM</span>
                  <span className="font-bold text-sm text-[#a6e3a1]">
                    {sysInfo.freeRamGb} GB free / {sysInfo.totalRamGb} GB total
                  </span>
                </div>

                <div className="p-3 bg-[#181825] rounded-xl border border-[#313244]">
                  <span className="text-[#a6adc8] block">CPU Architecture</span>
                  <span className="font-bold text-sm text-[#a6e3a1]">
                    {sysInfo.cpuArch} (64-bit Compatible)
                  </span>
                </div>

                <div className="p-3 bg-[#181825] rounded-xl border border-[#313244] col-span-2">
                  <span className="text-[#a6adc8] block">Operating System</span>
                  <span className="font-bold text-sm text-[#a6e3a1]">
                    Windows 10 / 11 Compatible ({sysInfo.osRelease})
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-xs text-[#a6adc8] py-4 text-center">Checking system specifications...</div>
            )}

            <div className="flex space-x-2 mt-2 w-full">
              <button
                onClick={() => setStep(1)}
                className="w-1/3 py-2.5 rounded-xl bg-[#313244] text-[#cdd6f4] font-semibold text-xs hover:bg-[#45475a] transition-all"
              >
                ← Back
              </button>

              <button
                onClick={startSetup}
                className="w-2/3 py-2.5 rounded-xl bg-[#89b4fa] text-[#11111b] font-bold text-sm hover:bg-[#b4befe] transition-all shadow-md"
              >
                Start Setup & Download →
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Download & Progress */}
        {step === 3 && (
          <div className="flex flex-col space-y-4 w-full overflow-hidden">
            <h3 className="text-sm font-semibold text-[#cdd6f4]">
              Downloading & Configuring Local Models
            </h3>

            <div className="space-y-2 w-full">
              <div className="flex items-center justify-between text-xs w-full">
                <span className="text-[#a6adc8] truncate">{setupText}</span>
                <span className="font-bold text-[#89b4fa] ml-2 shrink-0">{setupProgress}%</span>
              </div>
              <div className="w-full bg-[#181825] h-3 rounded-full overflow-hidden border border-[#313244]">
                <div
                  className="bg-gradient-to-r from-[#89b4fa] via-[#a6e3a1] to-[#94e2d5] h-full transition-all duration-300 rounded-full"
                  style={{ width: `${Math.max(3, Math.min(100, setupProgress))}%` }}
                />
              </div>
            </div>

            {!isSettingUp && setupProgress < 100 && (
              <button
                onClick={handleRetry}
                className="w-full py-2 rounded-xl bg-[#313244] text-[#cdd6f4] font-semibold text-xs hover:bg-[#45475a] transition-all"
              >
                Retry Setup
              </button>
            )}

            {/* Diagnostic Logs Drawer */}
            <div className="border-t border-[#313244] pt-3 w-full">
              <button
                onClick={() => {
                  fetchLogs();
                  setShowLogs(!showLogs);
                }}
                className="text-xs text-[#89b4fa] hover:underline flex items-center space-x-1"
              >
                <span>{showLogs ? '▼ Hide Diagnostic Logs' : '▶ View Diagnostic Logs'}</span>
              </button>

              {showLogs && (
                <div className="mt-2 p-3 bg-[#181825] rounded-xl border border-[#313244] max-h-36 overflow-y-auto font-mono text-[11px] text-[#a6adc8] space-y-1 w-full box-border">
                  {logs.length > 0 ? (
                    logs.map((line, idx) => <div key={idx} className="break-words">{line}</div>)
                  ) : (
                    <div>No log entries buffered yet.</div>
                  )}
                </div>
              )}
            </div>

            {setupProgress >= 100 && (
              <button
                onClick={() => setStep(4)}
                className="w-full py-2.5 rounded-xl bg-[#a6e3a1] text-[#11111b] font-bold text-sm hover:bg-[#94e2d5] transition-all shadow-md mt-2"
              >
                Proceed to Getting Started →
              </button>
            )}
          </div>
        )}

        {/* STEP 4: Ready */}
        {step === 4 && (
          <div className="flex flex-col space-y-4 text-center py-2 w-full overflow-hidden">
            <div className="w-12 h-12 rounded-full bg-[#a6e3a1]/20 text-[#a6e3a1] flex items-center justify-center text-2xl mx-auto border border-[#a6e3a1]">
              ✓
            </div>
            <h3 className="text-base font-bold text-[#cdd6f4]">pixi is Ready to Assist You!</h3>
            <p className="text-xs text-[#a6adc8] max-w-md mx-auto leading-relaxed">
              Your voice assistant models and offline configuration are complete. You can speak to pixi or trigger the assistant anytime.
            </p>

            <div className="p-3 bg-[#181825] rounded-xl border border-[#313244] text-left text-xs space-y-1.5 text-[#cdd6f4] w-full box-border">
              <span className="font-bold text-[#89b4fa] block">Quick Shortcuts & Tips:</span>
              <div>• Global Hotkey: <code className="bg-[#313244] px-1.5 py-0.5 rounded text-[#a6e3a1]">Cmd/Ctrl + Shift + Space</code></div>
              <div>• Wake Word: Speak <code className="bg-[#313244] px-1.5 py-0.5 rounded text-[#94e2d5]">"Hey pixi"</code> anytime</div>
              <div>• System Tray: Right-click pixi icon in taskbar for autostart settings</div>
            </div>

            <button
              onClick={finishOnboarding}
              className="w-full py-3 rounded-xl bg-[#89b4fa] text-[#11111b] font-bold text-sm hover:bg-[#b4befe] transition-all shadow-md mt-2"
            >
              Start Using pixi
            </button>
          </div>
        )}

      </div>
    </div>
  );
};
