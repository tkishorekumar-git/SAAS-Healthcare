'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ApiState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/** Loads data once on mount (and on reload). Ignores results that arrive after unmount. */
export function useApi<T>(load: () => Promise<T>): ApiState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadRef.current();
      if (mounted.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
    };
  }, [reload]);

  return { data, error, loading, reload };
}

/** Runs a mutation, tracking its pending state and error message. */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    setPending(true);
    setError(null);
    try {
      return await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);

  return { pending, error, run, clearError: () => setError(null) };
}
