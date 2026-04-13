"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import type { GongCredentials } from "@/lib/types";

interface CredentialContextValue {
  credentials: GongCredentials | null;
  setCredentials: (creds: GongCredentials) => void;
  clearCredentials: () => void;
  isConfigured: boolean;
}

const CredentialContext = createContext<CredentialContextValue | null>(null);

const STORAGE_KEY = "gong-explorer-credentials";

export function CredentialProvider({ children }: { children: ReactNode }) {
  const [credentials, setCredentialsState] = useState<GongCredentials | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        setCredentialsState(JSON.parse(stored) as GongCredentials);
      }
    } catch {
      // sessionStorage unavailable
    }
    setLoaded(true);
  }, []);

  const setCredentials = useCallback((creds: GongCredentials) => {
    setCredentialsState(creds);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
    } catch {
      // sessionStorage unavailable
    }
  }, []);

  const clearCredentials = useCallback(() => {
    setCredentialsState(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // sessionStorage unavailable
    }
  }, []);

  if (!loaded) return null;

  return (
    <CredentialContext.Provider
      value={{
        credentials,
        setCredentials,
        clearCredentials,
        isConfigured: credentials !== null,
      }}
    >
      {children}
    </CredentialContext.Provider>
  );
}

export function useCredentials(): CredentialContextValue {
  const ctx = useContext(CredentialContext);
  if (!ctx) {
    throw new Error("useCredentials must be used within a CredentialProvider");
  }
  return ctx;
}
