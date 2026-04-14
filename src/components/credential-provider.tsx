"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import type { Credentials, Provider } from "@/lib/types";

interface CredentialContextValue {
  credentials: Credentials | null;
  provider: Provider | null;
  setCredentials: (creds: Credentials) => void;
  clearCredentials: () => void;
  isConfigured: boolean;
}

const CredentialContext = createContext<CredentialContextValue | null>(null);

const STORAGE_KEY = "call-explorer-credentials";
const LEGACY_STORAGE_KEY = "gong-explorer-credentials";

function isCredentials(value: unknown): value is Credentials {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.provider === "gong") {
    return typeof v.accessKey === "string" && typeof v.accessKeySecret === "string" && typeof v.baseUrl === "string";
  }
  if (v.provider === "salesloft") {
    return typeof v.apiKey === "string";
  }
  return false;
}

export function CredentialProvider({ children }: { children: ReactNode }) {
  const [credentials, setCredentialsState] = useState<Credentials | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (isCredentials(parsed)) setCredentialsState(parsed);
      }
      // Drop any legacy single-provider blob so it doesn't linger.
      sessionStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // sessionStorage unavailable
    }
    setLoaded(true);
  }, []);

  const setCredentials = useCallback((creds: Credentials) => {
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
        provider: credentials?.provider ?? null,
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
