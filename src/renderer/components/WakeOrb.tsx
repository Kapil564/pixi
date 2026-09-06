import React from 'react';
import { PixelBlobCharacter } from './PixelBlobCharacter';

export type OrbPhase = 'idle' | 'listening' | 'speaking' | 'thinking';

interface WakeOrbProps {
  phase: OrbPhase;
  onClick?: () => void;
  size?: number; // Size in pixels (default: 100)
}

export const WakeOrb: React.FC<WakeOrbProps> = ({ phase, onClick, size = 100 }) => {
  const getTitleText = () => {
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

  return (
    <div
      onClick={onClick}
      style={{ width: `${size}px`, height: `${size}px` }}
      className="drag-region flex items-center justify-center cursor-pointer select-none relative bg-transparent"
      title={getTitleText()}
    >
      {/* Pure Pixel Blob Character floating transparently without surrounding card */}
      <PixelBlobCharacter phase={phase} size={size} />
    </div>
  );
};
