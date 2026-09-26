import React from 'react';
import { PixelBlobCharacter } from './PixelBlobCharacter';

export type OrbPhase = 'idle' | 'listening' | 'speaking' | 'thinking';

interface WakeOrbProps {
  phase: OrbPhase;
  onClick?: () => void;
  onSwitchMode?: () => void;
  size?: number; // Size in pixels (default: 100)
  /** When false, clicking does nothing and the orb shows a "setup" tooltip. */
  disabled?: boolean;
}

export const WakeOrb: React.FC<WakeOrbProps> = ({ phase, onClick, onSwitchMode, size = 100, disabled = false }) => {
  const getTitleText = () => {
    if (disabled) {
      return 'pixi is setting up (STT → LLM → TTS). Voice starts once setup completes.';
    }
    switch (phase) {
      case 'listening':
        return 'pixi is Listening... (Click to stop)';
      case 'thinking':
        return 'pixi is Processing...';
      case 'speaking':
        return 'pixi is Speaking...';
      default:
        return 'Click to talk to pixi';
    }
  };

  const handleClick = () => {
    if (disabled) return;
    onClick?.();
  };

  return (
    <div
      style={{ width: `${size}px`, height: `${size}px` }}
      className="drag-region flex items-center justify-center select-none relative bg-transparent"
      title={getTitleText()}
    >
      {/* no-drag wrapper ensures OS drag handler doesn't swallow click events on the character */}
      <div
        className="no-drag absolute inset-0 flex items-center justify-center cursor-pointer"
        onClick={handleClick}
      >
        <PixelBlobCharacter phase={phase} size={size} />
      </div>

      {/* Mode switcher button — always visible, top-right corner, allows escaping Orb view */}
      {onSwitchMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSwitchMode();
          }}
          className="no-drag absolute top-0 right-0 w-5 h-5 rounded-full bg-black/85 border border-white/25 flex items-center justify-center hover:bg-neutral-800 hover:border-white/50 transition-all"
          title="Switch to Widget Bar view"
          style={{ transform: 'translate(30%, -30%)' }}
        >
          <svg className="w-3 h-3 fill-current text-white/90" viewBox="0 0 24 24">
            <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
          </svg>
        </button>
      )}
    </div>
  );
};
