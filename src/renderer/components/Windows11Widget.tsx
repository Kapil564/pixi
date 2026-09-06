import React, { useState } from 'react';
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
}

export const Windows11Widget: React.FC<Windows11WidgetProps> = ({
  phase,
  transcription,
  statusText,
  responseMessage,
  onMicClick,
  onSendText,
  onSwitchMode,
}) => {
  const [inputText, setInputText] = useState('');
  const [showResultCard, setShowResultCard] = useState(true);
  const prevResponseRef = React.useRef(responseMessage);

  if (responseMessage !== prevResponseRef.current) {
    prevResponseRef.current = responseMessage;
    if (responseMessage) setShowResultCard(true);
  }

  const isListening = phase === 'listening';
  const isThinking = phase === 'thinking';
  const isSpeaking = phase === 'speaking';

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && inputText.trim()) {
      onSendText?.(inputText.trim());
      setInputText('');
    }
  };

  const displayPrompt =
    transcription ||
    statusText ||
    (isListening ? 'pixi is listening...' : isThinking ? 'pixi is processing...' : 'Ask pixi anything...');

  return (
    <div className="w-full flex flex-col items-center select-none font-sans drag-region p-2">
      {/* 1. Catppuccin Dark Navy (#1e1e2e) Floating Horizontal Panel */}
      <div className="no-drag w-full max-w-[580px] h-[60px] rounded-2xl bg-[#1e1e2e] border-2 border-[#313244] shadow-[0_16px_40px_rgba(0,0,0,0.5)] flex items-center justify-between px-3 transition-all duration-300 hover:border-[#45475a] group">
        
        {/* Left: Pixel Art Blob Character Avatar Button */}
        <div className="relative flex items-center justify-center">
          <button
            onClick={onMicClick}
            className="relative w-11 h-11 rounded-xl bg-[#181825] border border-[#45475a] flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 shadow-md overflow-hidden"
            title={isListening ? 'Click to stop listening' : 'Click to speak to pixi'}
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
            className="w-full bg-transparent text-[#cdd6f4] font-medium text-[15px] tracking-tight placeholder-[#a6adc8] outline-none border-none truncate"
          />

          {/* Catppuccin Audio Waveform Visualizer for Listening */}
          {isListening && (
            <div className="flex items-center space-x-1 ml-2 h-5 shrink-0">
              <span className="w-1 bg-[#94e2d5] rounded-full h-3 animate-[pulse_0.4s_infinite_100ms]" />
              <span className="w-1 bg-[#89dceb] rounded-full h-5 animate-[pulse_0.4s_infinite_200ms]" />
              <span className="w-1 bg-[#94e2d5] rounded-full h-4 animate-[pulse_0.4s_infinite_300ms]" />
              <span className="w-1 bg-[#74c7ec] rounded-full h-6 animate-[pulse_0.4s_infinite_150ms]" />
            </div>
          )}

          {/* Catppuccin Processing Ring for Thinking */}
          {isThinking && (
            <div className="ml-2 shrink-0">
              <div className="w-4 h-4 rounded-full border-2 border-t-[#f9e2af] border-r-transparent border-b-[#f9e2af] border-l-transparent animate-spin" />
            </div>
          )}
        </div>

        {/* Right: Controls (Submit & Mode Switcher) */}
        <div className="flex items-center space-x-1.5 shrink-0">
          {inputText.trim() && (
            <button
              onClick={() => {
                onSendText?.(inputText.trim());
                setInputText('');
              }}
              className="w-8 h-8 rounded-xl bg-[#b4befe] text-[#11111b] flex items-center justify-center hover:bg-[#89b4fa] transition-all shadow-sm font-bold"
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
            className="w-8 h-8 rounded-xl bg-[#181825] hover:bg-[#313244] text-[#cdd6f4] flex items-center justify-center transition-all border border-[#45475a]"
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
        <div className="no-drag w-full max-w-[580px] mt-2.5 p-4 rounded-2xl bg-[#181825] border-2 border-[#313244] shadow-[0_12px_32px_rgba(0,0,0,0.4)] flex flex-col space-y-3 transition-all duration-300 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-[#313244] border border-[#45475a] flex items-center justify-center text-[#f5c2e7] shadow-sm shrink-0">
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                  <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z" />
                </svg>
              </div>

              <div className="flex flex-col">
                <span className="text-sm font-semibold text-[#cdd6f4] tracking-tight leading-tight">
                  pixi Response
                </span>
                <span className="text-xs text-[#a6adc8] font-normal mt-0.5">
                  {responseMessage}
                </span>
              </div>
            </div>

            <button
              onClick={() => setShowResultCard(false)}
              className="text-[#6c7086] hover:text-[#cdd6f4] p-1 rounded-md hover:bg-[#313244] transition-all"
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
