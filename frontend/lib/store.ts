import { useSyncExternalStore } from 'react';

interface AnalysisState {
  loading: boolean;
  error: string;
}

let state: AnalysisState = {
  loading: false,
  error: "",
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

export function useAnalysisStore() {
  const storeState = useSyncExternalStore(analysisStore.subscribe, analysisStore.getState, analysisStore.getState);

  return {
    ...storeState,
    setLoading,
    setError,
  };
}
