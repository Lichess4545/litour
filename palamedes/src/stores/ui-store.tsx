"use client";

import { createContext, type ReactNode, useContext, useRef } from "react";
import { createStore, useStore } from "zustand";

/**
 * Next-safe Zustand: the store is created inside a provider so every request
 * (and every test) gets its own instance — a module-level store would leak
 * state across server requests.
 */

interface UiState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

const createUiStore = () =>
  createStore<UiState>()((set) => ({
    sidebarOpen: false,
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  }));

type UiStoreApi = ReturnType<typeof createUiStore>;

const UiStoreContext = createContext<UiStoreApi | undefined>(undefined);

export function UiStoreProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<UiStoreApi | undefined>(undefined);
  storeRef.current ??= createUiStore();

  return (
    <UiStoreContext.Provider value={storeRef.current}>
      {children}
    </UiStoreContext.Provider>
  );
}

export function useUiStore<T>(selector: (state: UiState) => T): T {
  const store = useContext(UiStoreContext);
  if (store === undefined) {
    throw new Error("useUiStore must be used within a UiStoreProvider");
  }
  return useStore(store, selector);
}
