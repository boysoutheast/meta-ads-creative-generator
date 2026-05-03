// Minimal global UI store — most flow state lives in page-local React state.
import { create } from 'zustand'

interface UIState {
  apiOnline: boolean | null
  setApiOnline: (v: boolean) => void
}

export const useUIStore = create<UIState>((set) => ({
  apiOnline: null,
  setApiOnline: (v) => set({ apiOnline: v }),
}))
