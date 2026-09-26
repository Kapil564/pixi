import React, { useState, useEffect } from 'react';
import type { OrbPhase } from './WakeOrb';
import { PixelBlobCharacter } from './PixelBlobCharacter';

interface Windows11WidgetProps {
  phase: OrbPhase;
  transcription?: string;
  statusText?: string;
  responseMessage?: string;
  onMicClick?: () => void;
  onSendText?: (text: string) => void;
  onSwitchMode?: () => void;
  /** When false (setup incomplete), mic and text input are disabled. */
  disabled?: boolean;
}

export const Windows11Widget: React.FC<Windows11WidgetProps> = ({
  phase,
  transcription,
  statusText,
  responseMessage,
  onMicClick,
  onSendText,
  onSwitchMode,
  disabled = false,
}) => {
  const [inputText, setInputText] = useState('');
  const [showResultCard, setShowResultCard] = useState(true);
  useEffect(() => {
    if (responseMessage) {
      setShowResultCard(true);
    }
  }, [responseMessage]);

  const isListening = phase === 'listening';
  const isThinking = phase === 'thinking';
  const isSpeaking = phase === 'speaking';

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === 'Enter' && inputText.trim()) {
      onSendText?.(inputText.trim());
      setInputText('');
    }
  };

  const displayPrompt =
    transcription ||
    statusText ||
    (isListening ? 'pixi is listening...' : isThinking ? 'pixi is processing...' : 'Ask pixi anything...');

  const handleMicClick = () => {
    if (disabled) return;
    onMicClick?.();
  };

  const handleSendClick = () => {
    if (disabled) return;
    if (!inputText.trim()) return;
    onSendText?.(inputText.trim());
    setInputText('');
  };

  return (
    <div className="w-full flex flex-col items-center select-none font-sans drag-region p-2">
      {/* 1. Pure Black Floating Horizontal Panel */}
      <div className="no-drag w-full max-w-[580px] h-[60px] rounded-2xl bg-black border border-white/20 shadow-[0_16px_40px_rgba(0,0,0,0.65)] flex items-center justify-between px-3 transition-all duration-300 hover:border-white/35 group">
        
        {/* Left: Pixel Art Blob Character Avatar Button */}
        <div className="relative flex items-center justify-center">
          <button
            onClick={handleMicClick}
            disabled={disabled}
            className="relative w-11 h-11 rounded-xl bg-neutral-900 border border-white/15 flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 hover:border-white/40 shadow-md overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            title={disabled ? 'pixi is setting up (STT → LLM → TTS)...' : isListening ? 'Click to stop listening' : 'Click to speak to pixi'}
          >
            <PixelBlobCharacter phase={phase} size={38} />
          </button>
        </div>

        {/* Center: Live Transcription / Text Input */}
        <div className="flex-1 mx-3 flex items-center justify-between overflow-hidden">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={displayPrompt}
            disabled={disabled}
            className="w-full bg-transparent text-white font-medium text-[15px] tracking-tight placeholder-neutral-500 outline-none border-none truncate disabled:cursor-not-allowed"
          />

          {/* Monochrome Audio Waveform Visualizer for Listening */}
          {isListening && (
            <div className="flex items-center space-x-1 ml-2 h-5 shrink-0">
              <span className="w-1 bg-white/60 rounded-full h-3 animate-[pulse_0.4s_infinite_100ms]" />
              <span className="w-1 bg-white rounded-full h-5 animate-[pulse_0.4s_infinite_200ms]" />
              <span className="w-1 bg-white/60 rounded-full h-4 animate-[pulse_0.4s_infinite_300ms]" />
              <span className="w-1 bg-white rounded-full h-6 animate-[pulse_0.4s_infinite_150ms]" />
            </div>
          )}

          {/* Monochrome Processing Ring for Thinking */}
          {isThinking && (
            <div className="ml-2 shrink-0">
              <div className="w-4 h-4 rounded-full border-2 border-t-white border-r-transparent border-b-white border-l-transparent animate-spin" />
            </div>
          )}
        </div>

        {/* Right: Controls (Submit & Mode Switcher) */}
        <div className="flex items-center space-x-1.5 shrink-0">
          {inputText.trim() && (
            <button
              onClick={handleSendClick}
              className="w-8 h-8 rounded-xl bg-white text-black flex items-center justify-center hover:bg-neutral-200 transition-all shadow-sm font-bold"
              title="Send"
            >
              <svg className="w-4 h-4 fill-current transform rotate-90" viewBox="0 0 24 24">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          )}

          {/* Mode Switcher Button (To Floating Blob Avatar View) */}
          <button
            onClick={onSwitchMode}
            className="w-8 h-8 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white flex items-center justify-center transition-all border border-white/15 hover:border-white/40"
            title="Switch to Floating Pixel Blob view"
          >
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
            </svg>
          </button>
        </div>
      </div>

      {/* 2. Expanded Catppuccin Result Card */}
      {showResultCard && responseMessage && (
        <div className="no-drag w-full max-w-[580px] mt-2.5 p-4 rounded-2xl bg-neutral-950 border border-white/15 shadow-[0_12px_32px_rgba(0,0,0,0.55)] flex flex-col space-y-3 transition-all duration-300 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-neutral-900 border border-white/15 flex items-center justify-center text-white shadow-sm shrink-0">
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                  <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z" />
                </svg>
              </div>

              <div className="flex flex-col">
                <span className="text-sm font-semibold text-white tracking-tight leading-tight">
                  pixi Response
                </span>
                <span className="text-xs text-neutral-400 font-normal mt-0.5 whitespace-pre-wrap break-words max-h-20 overflow-y-auto block leading-relaxed">
                  {responseMessage}
                </span>
              </div>
            </div>

            <button
              onClick={() => setShowResultCard(false)}
              className="text-neutral-500 hover:text-white p-1 rounded-md hover:bg-neutral-800 transition-all"
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
