import React from 'react';

export interface SetupBannerProps {
  isComplete: boolean;
  progress: number;
  stepText: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export const SetupBanner: React.FC<SetupBannerProps> = ({
  isComplete,
  progress,
  stepText,
  onDismiss,
}) => {
  // Only show while setup is actively in progress (errors are logged to terminal)
  if (isComplete || progress <= 0 || progress >= 100) return null;

  return (
    <div className="w-full max-w-[580px] my-2 p-3.5 rounded-2xl bg-[#1e1e2e] border-2 border-[#313244] shadow-lg flex flex-col space-y-2 select-none animate-in fade-in slide-in-from-top-2 text-[#cdd6f4]">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2.5 overflow-hidden">
          <div className="w-8 h-8 rounded-xl bg-[#181825] border border-[#45475a] flex items-center justify-center shrink-0">
            <div className="w-4 h-4 rounded-full border-2 border-t-[#89b4fa] border-r-transparent border-b-[#89b4fa] border-l-transparent animate-spin" />
          </div>

          <div className="flex flex-col truncate">
            <span className="text-xs font-semibold tracking-tight text-[#cdd6f4]">
              Setting Up pixi Offline Models
            </span>
            <span className="text-[11px] text-[#a6adc8] truncate leading-tight">
              {stepText}
            </span>
          </div>
        </div>

        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-[#6c7086] hover:text-[#cdd6f4] p-1 rounded-md hover:bg-[#313244] transition-all shrink-0"
            title="Dismiss"
          >
            <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        )}
      </div>

      <div className="w-full bg-[#181825] h-2 rounded-full overflow-hidden border border-[#313244] relative">
        <div
          className="bg-gradient-to-r from-[#89b4fa] via-[#a6e3a1] to-[#94e2d5] h-full transition-all duration-300 rounded-full"
          style={{ width: `${Math.max(3, Math.min(100, progress))}%` }}
        />
      </div>
    </div>
  );
};
