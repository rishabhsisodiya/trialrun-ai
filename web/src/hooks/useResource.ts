import { useCallback, useEffect, useState } from 'react';

export type Resource<T> =
  | { status: 'loading'; data: T | null }
  | { status: 'ready'; data: T }
  | { status: 'error'; data: T | null; message: string };

/** Loads one thing from the server and tracks its loading, ready and error states. */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>): [Resource<T>, () => void] {
  const [resource, setResource] = useState<Resource<T>>({ status: 'loading', data: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    // Keep what is on screen while reloading, so a re-check does not blank the panel.
    setResource((current) => ({ status: 'loading', data: current.data }));
    load(controller.signal).then(
      (data) => setResource({ status: 'ready', data }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : 'Something went wrong.';
        setResource((current) => ({ status: 'error', data: current.data, message }));
      },
    );
    return () => controller.abort();
  }, [load, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return [resource, reload];
}
