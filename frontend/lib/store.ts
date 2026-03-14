import { useSyncExternalStore } from 'react';
import type { AnalysisResult } from '@/lib/api';

interface AnalysisState {
  loading: boolean;
  error: string;
  result: AnalysisResult | null;
}

let state: AnalysisState = {
  loading: false,
  error: "",
  result: null,
};

const listeners = new Set<() => void>();

export const analysisStore = {
  getState: () => state,
  setState: (newState: Partial<AnalysisState>) => {
    state = { ...state, ...newState };
    listeners.forEach((l) => l());
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
};

const setLoading = (loading: boolean) => analysisStore.setState({ loading });
const setError = (error: string) => analysisStore.setState({ error });
const setResult = (
  next: AnalysisResult | null | ((prev: AnalysisResult | null) => AnalysisResult | null),
) => {
  const value = typeof next === "function"
    ? (next as (prev: AnalysisResult | null) => AnalysisResult | null)(state.result)
    : next;
  analysisStore.setState({ result: value });
};

export function useAnalysisStore() {
  const storeState = useSyncExternalStore(analysisStore.subscribe, analysisStore.getState, analysisStore.getState);

  return {
    ...storeState,
    setLoading,
    setError,
    setResult,
  };
}
