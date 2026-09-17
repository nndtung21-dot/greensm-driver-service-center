"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { dict, Lang } from "./translations";

const STORAGE_KEY = "gsm_lang";
const SUPPORTED: Lang[] = ["vi", "en"];

type Vars = Record<string, string | number>;

type LanguageContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Translate a dot-path key, e.g. t("checkin.welcome.title") */
  t: (key: string, vars?: Vars) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function readByPath(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined,
      obj
    );
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in vars ? String(vars[key]) : match
  );
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("vi");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY) as Lang | null;
      if (stored && SUPPORTED.includes(stored)) {
        setLangState(stored);
      }
    } catch {
      // localStorage unavailable (e.g. private mode) — default to "vi"
    }
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Vars) => {
      const primary = readByPath(dict[lang], key);
      if (typeof primary === "string") return interpolate(primary, vars);

      // Fallback to Vietnamese, then to the raw key so missing
      // translations are visible instead of crashing the UI.
      const fallback = readByPath(dict.vi, key);
      if (typeof fallback === "string") return interpolate(fallback, vars);

      return key;
    },
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return ctx;
}
