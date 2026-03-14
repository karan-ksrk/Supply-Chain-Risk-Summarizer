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

export function useAnalysisStore() {
  const storeState = useSyncExternalStore(analysisStore.subscribe, analysisStore.getState, analysisStore.getState);
  
  return {
    ...storeState,
    setLoading: (loading: boolean) => analysisStore.setState({ loading }),
    setError: (error: string) => analysisStore.setState({ error }),
  };
}
