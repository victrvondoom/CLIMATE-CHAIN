import { createContext, useContext } from 'react';
import type { Overview } from '../types';

export const SignalContext = createContext<{
  data: Overview | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
}>({ data: null, error: null, loading: true, refreshing: false });

// Native tools and signal screens consume the same selected, automatically refreshed snapshot.
export const useSignals = () => useContext(SignalContext);
