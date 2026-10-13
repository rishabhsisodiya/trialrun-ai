import { useCallback, useEffect, useRef, useState } from 'react';
import type { InterviewView, RoundAction } from '../../../shared/types.ts';
import { api, messageOf } from '../api.ts';

const REFRESH_MS = 5000;

export interface InterviewController {
  id: string;
  view: InterviewView | null;
  /** Why the interview could not be loaded at all. */
  loadError: string | null;
  /** The last thing that failed, shown beside the round. */
  error: string | null;
  /** What is in flight: 'start', 'finish', 'resume', 'submit' or an action kind. */
  busy: string | null;
  /** Milliseconds to add to the browser clock to get the server clock. */
  clockOffset: number;
  refresh(): void;
  start(index: number): Promise<void>;
  /** Resolves to true when the action went through. */
  act(index: number, action: RoundAction): Promise<boolean>;
  resume(index: number): Promise<void>;
  submitRound(index: number): Promise<void>;
  /** Resolves to true when the report is ready. */
  finish(): Promise<boolean>;
  clearError(): void;
}

/** Loads one interview, keeps it fresh, and runs every change through one place. */
export function useInterview(id: string): InterviewController {
  const [view, setView] = useState<InterviewView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  // A refresh that started before a change must not overwrite the result of that change.
  const version = useRef(0);

  const accept = useCallback((next: InterviewView) => {
    version.current += 1;
    setView(next);
    setClockOffset(Date.parse(next.now) - Date.now());
    setLoadError(null);
  }, []);

  const refresh = useCallback(() => {
    const startedAt = version.current;
    api.interview(id).then(
      (next) => {
        if (version.current === startedAt) accept(next);
      },
      // A failed background refresh matters only if nothing has loaded yet.
      (failure: unknown) => {
        if (version.current === 0) setLoadError(messageOf(failure));
      },
    );
  }, [id, accept]);

  useEffect(() => {
    version.current = 0;
    setView(null);
    setLoadError(null);
    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const run = useCallback(
    async (label: string, work: () => Promise<InterviewView | void>, quiet = false): Promise<boolean> => {
      if (!quiet) {
        setBusy(label);
        setError(null);
      }
      try {
        const next = await work();
        if (next) accept(next);
        return true;
      } catch (failure) {
        if (!quiet) setError(messageOf(failure));
        // A failure can change the round (paused, locked), so look again.
        refresh();
        return false;
      } finally {
        if (!quiet) setBusy(null);
      }
    },
    [accept, refresh],
  );

  return {
    view,
    loadError,
    error,
    busy,
    clockOffset,
    refresh,
    start: async (index) => void (await run('start', () => api.startRound(id, index))),
    act: (index, action) => run(action.kind, () => api.act(id, index, action), action.kind === 'poll' || action.kind === 'choose'),
    id,
    resume: async (index) => void (await run('resume', () => api.resumeRound(id, index))),
    submitRound: async (index) => void (await run('submit', () => api.submitRound(id, index))),
    finish: () => run('finish', async () => void (await api.finish(id))),
    clearError: () => setError(null),
  };
}
