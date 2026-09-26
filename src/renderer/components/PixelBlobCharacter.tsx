import React from 'react';
import type { OrbPhase } from './WakeOrb';

interface PixelBlobCharacterProps {
  phase: OrbPhase;
  size?: number; // width/height in px
  className?: string;
  onClick?: () => void;
}

export const PixelBlobCharacter: React.FC<PixelBlobCharacterProps> = ({
  phase,
  size = 100,
  className = '',
  onClick,
}) => {
  // Catppuccin colors per phase
  const getBlobColors = () => {
    switch (phase) {
      case 'listening':
        return {
          body: '#7cd092ff',      // Teal
          border: '#181825',
          blush: '#f38ba8',
          eye: '#11111b',
        };
      case 'thinking':
        return {
          body: '#f9e2af',      // Yellow
          border: '#181825',
          blush: '#f38ba8',
          eye: '#11111b',
        };
      case 'speaking':
        return {
          body: '#f5c2e7',      // Pink
          border: '#181825',
          blush: '#f38ba8',
          eye: '#11111b',
        };
      case 'idle':
      default:
        return {
          body: '#fbfbfbe4',      // Lavender
          border: '#181825',
          blush: '#f38ba8',
          eye: '#11111b',
        };
    }
  };

  const colors = getBlobColors();

  return (
    <div
      onClick={onClick}
      style={{ width: size, height: size }}
      className={`relative flex items-center justify-center select-none cursor-pointer ${className}`}
    >
      <style>{`
        @keyframes pixel-idle-bob {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-1px); }
        }
        @keyframes float-z-1 {
          0% { transform: translate(0px, 0px); opacity: 0; }
          30% { opacity: 1; }
          100% { transform: translate(3px, -8px); opacity: 0; }
        }
        @keyframes float-z-2 {
          0% { transform: translate(0px, 0px); opacity: 0; }
          30% { opacity: 1; }
          100% { transform: translate(4px, -9px); opacity: 0; }
        }
        @keyframes eq-bounce-1 { 0%, 100% { transform: scaleY(0.4); } 50% { transform: scaleY(1.3); } }
        @keyframes eq-bounce-2 { 0%, 100% { transform: scaleY(1.2); } 50% { transform: scaleY(0.3); } }
        @keyframes eq-bounce-3 { 0%, 100% { transform: scaleY(0.5); } 50% { transform: scaleY(1.4); } }
        @keyframes eq-bounce-4 { 0%, 100% { transform: scaleY(1.1); } 50% { transform: scaleY(0.4); } }
        @keyframes orbit-ring {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes float-music-note-1 {
          0% { transform: translate(0px, 0px) scale(0.8); opacity: 0; }
          40% { opacity: 1; }
          100% { transform: translate(10px, -10px) scale(1.1); opacity: 0; }
        }
        @keyframes float-music-note-2 {
          0% { transform: translate(0px, 0px) scale(0.8); opacity: 0; }
          40% { opacity: 1; }
          100% { transform: translate(7px, -12px) scale(1); opacity: 0; }
        }
        @keyframes talk-cycle {
          0%, 100% { transform: scaleY(1); }
          50% { transform: scaleY(2); }
        }
        .pixel-rendering {
          image-rendering: pixelated;
          image-rendering: crisp-edges;
        }
        .anim-bob { animation: pixel-idle-bob 2s ease-in-out infinite; }
        .anim-z1 { animation: float-z-1 2.2s linear infinite; }
        .anim-z2 { animation: float-z-2 2.2s linear 1.1s infinite; }
        .anim-bar-1 { animation: eq-bounce-1 0.5s ease-in-out infinite; transform-origin: bottom; }
        .anim-bar-2 { animation: eq-bounce-2 0.5s ease-in-out 0.12s infinite; transform-origin: bottom; }
        .anim-bar-3 { animation: eq-bounce-3 0.5s ease-in-out 0.25s infinite; transform-origin: bottom; }
        .anim-bar-4 { animation: eq-bounce-4 0.5s ease-in-out 0.37s infinite; transform-origin: bottom; }
        .anim-orbit-ring { animation: orbit-ring 3.8s linear infinite; transform-origin: 16px 19px; }
        .anim-note-1 { animation: float-music-note-1 1.6s ease-out infinite; }
        .anim-note-2 { animation: float-music-note-2 1.6s ease-out 0.8s infinite; }
        .anim-talking-mouth { animation: talk-cycle 0.25s ease-in-out infinite; transform-origin: 16px 22px; }
      `}</style>

      <svg
        viewBox="0 0 32 32"
        className="w-full h-full pixel-rendering overflow-visible"
        shapeRendering="crispEdges"
      >
        {/* ------------------- FLOATING EFFECTS ABOVE HEAD ------------------- */}

        {/* IDLE: Sleeping Z letters (positioned safely inside top padding) */}
        {phase === 'idle' && (
          <g className="anim-bob">
            <g className="anim-z1">
              <path d="M 21 6 h 4 v 1 l -3 2 h 3 v 1 h -4 v -1 l 3 -2 h -3 z" fill="#cba6f7" />
            </g>
            <g className="anim-z2">
              <path d="M 23 3 h 4 v 1 l -3 2 h 3 v 1 h -4 v -1 l 3 -2 h -3 z" fill="#b4befe" />
            </g>
          </g>
        )}

        {/* LISTENING: Animated Pixel Audio Equalizer Waves */}
        {phase === 'listening' && (
          <g transform="translate(10, 3)">
            <rect x="0" y="2" width="2" height="6" rx="0.5" fill="#52ec59" className="anim-bar-1" />
            <rect x="3.5" y="0" width="2" height="8" rx="0.5" fill="#f9e2af" className="anim-bar-2" />
            <rect x="7" y="1" width="2" height="7" rx="0.5" fill="#89dceb" className="anim-bar-3" />
            <rect x="10.5" y="3" width="2" height="5" rx="0.5" fill="#52ec59" className="anim-bar-4" />
          </g>
        )}

        {/* THINKING: Orbiting Pixel Ring */}
        {phase === 'thinking' && (
          <g className="anim-orbit-ring">
            <rect x="15" y="4" width="2" height="2" fill="#f9e2af" />
            <rect x="28" y="18" width="2" height="2" fill="#fab387" />
            <rect x="15" y="30" width="2" height="2" fill="#f9e2af" />
            <rect x="2" y="18" width="2" height="2" fill="#fab387" />
            <rect x="24" y="8" width="1.5" height="1.5" fill="#cba6f7" />
            <rect x="6" y="26" width="1.5" height="1.5" fill="#89dceb" />
          </g>
        )}

        {/* SPEAKING: Floating Musical Notes */}
        {phase === 'speaking' && (
          <g transform="translate(19, 13)">
            <g className="anim-note-1">
              <rect x="2" y="2" width="2" height="2" fill="#f5c2e7" />
              <rect x="3" y="0" width="1" height="4" fill="#f5c2e7" />
              <rect x="4" y="0" width="2" height="1" fill="#f5c2e7" />
            </g>
            <g className="anim-note-2">
              <rect x="4" y="4" width="2" height="2" fill="#89dceb" />
              <rect x="5" y="2" width="1" height="4" fill="#89dceb" />
            </g>
          </g>
        )}

        {/* ------------------- MAIN BLOB CHARACTER BODY ------------------- */}
        <g className="anim-bob">
          {/* 1. Dark Pixel Outline */}
          <rect x="4" y="11" width="24" height="17" rx="4" fill={colors.border} />

          {/* 2. Main Blob Body Color Fill */}
          <rect x="5" y="12" width="22" height="15" rx="3" fill={colors.body} />

          {/* 3. Top-Left Specular Pixel Highlight */}
          <rect x="7" y="13" width="8" height="2" fill="#ffffff" opacity="0.4" />

          {/* 4. Floating Arms */}
          {/* Left Arm */}
          <rect x="2" y="18" width="3" height="5" rx="1" fill={colors.border} />
          <rect x="3" y="19" width="2" height="4" rx="0.5" fill={colors.body} />

          {/* Right Arm */}
          <rect x="27" y="18" width="3" height="5" rx="1" fill={colors.border} />
          <rect x="27" y="19" width="2" height="4" rx="0.5" fill={colors.body} />

          {/* 5. Pink Pastel Cheeks (Blush) */}
          <rect x="7" y="20" width="3.5" height="2" fill={colors.blush} />
          <rect x="21.5" y="20" width="3.5" height="2" fill={colors.blush} />

          {/* ------------------- FACE EXPRESSIONS ------------------- */}

          {/* IDLE: Dot Eyes & Cute Mouth */}
          {phase === 'idle' && (
            <g>
              <rect x="10" y="17" width="3" height="3" fill={colors.eye} />
              <rect x="19" y="17" width="3" height="3" fill={colors.eye} />
              <rect x="15" y="21" width="2" height="1.5" fill={colors.eye} />
            </g>
          )}

          {/* LISTENING: Wide Round Eyes with Specular Sparkle */}
          {phase === 'listening' && (
            <g>
              {/* Left Eye */}
              <rect x="9.5" y="16" width="4" height="4" fill={colors.eye} />
              <rect x="10" y="16.5" width="1.5" height="1.5" fill="#ffffff" />
              {/* Right Eye */}
              <rect x="18.5" y="16" width="4" height="4" fill={colors.eye} />
              <rect x="19" y="16.5" width="1.5" height="1.5" fill="#ffffff" />
              {/* Surprised Open Mouth */}
              <rect x="15" y="21" width="2" height="2.5" rx="0.5" fill={colors.eye} />
            </g>
          )}

          {/* THINKING: Eyes Shifted Sideways */}
          {phase === 'thinking' && (
            <g>
              {/* Left Eye */}
              <rect x="11.5" y="17" width="3.5" height="3.5" fill={colors.eye} />
              <rect x="13.5" y="17.5" width="1" height="1" fill="#ffffff" />
              {/* Right Eye */}
              <rect x="20.5" y="17" width="3.5" height="3.5" fill={colors.eye} />
              <rect x="22.5" y="17.5" width="1" height="1" fill="#ffffff" />
              {/* Pondering Flat Line Mouth */}
              <rect x="14" y="22" width="4" height="1.2" fill={colors.eye} />
            </g>
          )}

          {/* SPEAKING: Talking Open Mouth */}
          {phase === 'speaking' && (
            <g>
              {/* Left Eye */}
              <rect x="10" y="16.5" width="3" height="4" fill={colors.eye} />
              <rect x="10.5" y="17" width="1" height="1" fill="#ffffff" />
              {/* Right Eye */}
              <rect x="19" y="16.5" width="3" height="4" fill={colors.eye} />
              <rect x="19.5" y="17" width="1" height="1" fill="#ffffff" />
              {/* Animated Talking Mouth */}
              <g className="anim-talking-mouth">
                <rect x="14.5" y="21" width="3" height="2" rx="0.5" fill="#11111b" />
                <rect x="15" y="22" width="2" height="1" fill="#f38ba8" />
              </g>
            </g>
          )}
        </g>
      </svg>
    </div>
  );
};
