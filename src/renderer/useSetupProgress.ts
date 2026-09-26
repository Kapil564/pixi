import { useEffect, useRef, useState } from 'react';

export interface SetupProgressState {
  isComplete: boolean;
  progress: number;
  stepText: string;
}

/**
 * Subscribes to the main-process setup progress stream with a single shared
 * listener. Seeds the state from getSetupStatus() on mount so a setup that is
 * already running is reflected immediately, and fires `onChange` whenever the
 * progress updates.
 */
export function useSetupProgress(onChange?: (state: SetupProgressState) => void): SetupProgressState {
  const callbackRef = useRef(onChange);
  callbackRef.current = onChange;

  const [state, setState] = useState<SetupProgressState>({
    isComplete: false,
    progress: 0,
    stepText: 'Checking setup status...',
  });

  useEffect(() => {
    const assistant = (window as any).assistant;
    if (!assistant) return;

    let mounted = true;

    const update = (data: { progress: number; text: string }) => {
      const next: SetupProgressState = {
        isComplete: data.progress >= 100,
        progress: data.progress,
        stepText: data.text,
      };
      setState(next);
      callbackRef.current?.(next);
    };

    if (assistant.getSetupStatus) {
      assistant
        .getSetupStatus()
        .then((st: { isComplete?: boolean; overallProgress?: number; stepText?: string } | null) => {
          if (!mounted || !st) return;
          const next: SetupProgressState = {
            isComplete: Boolean(st.isComplete),
            progress: st.overallProgress ?? 0,
            stepText: st.stepText || '',
          };
          setState(next);
          callbackRef.current?.(next);
        })
        .catch(() => {});
    }

    const unsubscribe = assistant.onSetupProgress?.(update);

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  return state;
}