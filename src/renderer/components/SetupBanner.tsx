import React from 'react';

export interface SetupBannerProps {
  isComplete: boolean;
  progress: number;
  stepText: string;
  /** Ordered per-stage readiness (STT -> LLM -> TTS) for the checklist UI. */
  stages?: { stage: string; ready: boolean; progress: number; statusText: string; label: string }[];
  onDismiss?: () => void;
}

const STAGE_ORDER = ['stt', 'llm', 'tts'];
const STAGE_SHORT: Record<string, string> = { stt: 'STT', llm: 'LLM', tts: 'TTS' };

export const SetupBanner: React.FC<SetupBannerProps> = ({
  isComplete,
  progress,
  stepText,
  stages,
  onDismiss,
}) => {
  // Only show while setup is actively in progress (errors are logged to terminal)
  if (isComplete || progress <= 0 || progress >= 100) return null;

  const orderedStages = stages
    ? STAGE_ORDER.map((key) => stages.find((s) => s.stage === key)).filter(
        (s): s is NonNullable<typeof s> => Boolean(s)
      )
    : [];

  return (
    <div className="w-full max-w-[580px] my-2 p-3.5 rounded-2xl bg-black border border-white/20 shadow-lg flex flex-col space-y-2.5 select-none animate-in fade-in slide-in-from-top-2 text-white">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2.5 overflow-hidden">
          <div className="w-8 h-8 rounded-xl bg-neutral-900 border border-white/15 flex items-center justify-center shrink-0">
            <div className="w-4 h-4 rounded-full border-2 border-t-white border-r-transparent border-b-white border-l-transparent animate-spin" />
          </div>

          <div className="flex flex-col truncate">
            <span className="text-xs font-semibold tracking-tight text-white">
              Setting Up pixi Offline Models
            </span>
            <span className="text-[11px] text-neutral-400 truncate leading-tight">
              {stepText}
            </span>
          </div>
        </div>

        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-neutral-500 hover:text-white p-1 rounded-md hover:bg-neutral-800 transition-all shrink-0"
            title="Dismiss"
          >
            <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        )}
      </div>

      {/* Ordered stage checklist: STT -> LLM -> TTS. Later stages show as
          waiting until every earlier stage completes (sequential gate). */}
      {orderedStages.length > 0 && (
        <div className="flex items-center gap-1.5">
          {orderedStages.map((s, idx) => {
            const isWaiting = !s.ready && s.progress <= 0;
            return (
              <React.Fragment key={s.stage}>
                {idx > 0 && <span className="text-neutral-600 text-[9px] shrink-0">→</span>}
                <div
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px] font-mono tracking-wide shrink-0 transition-colors ${
                    s.ready
                      ? 'border-white/60 bg-white text-black'
                      : isWaiting
                        ? 'border-white/10 bg-transparent text-neutral-600'
                        : 'border-white/30 bg-neutral-900 text-white'
                  }`}
                  title={s.statusText}
                >
                  {s.ready ? (
                    <span className="font-bold">✓</span>
                  ) : isWaiting ? (
                    <span className="opacity-60">·</span>
                  ) : (
                    <span className="inline-block w-2.5 h-2.5 rounded-full border border-white border-t-transparent animate-spin" />
                  )}
                  <span>{STAGE_SHORT[s.stage] ?? s.stage.toUpperCase()}</span>
                  {!s.ready && !isWaiting && <span className="text-neutral-400">{s.progress}%</span>}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      )}

      <div className="w-full bg-neutral-900 h-2 rounded-full overflow-hidden border border-white/10 relative">
        <div
          className="bg-white h-full transition-all duration-300 rounded-full"
          style={{ width: `${Math.max(3, Math.min(100, progress))}%` }}
        />
      </div>
    </div>
  );
};
