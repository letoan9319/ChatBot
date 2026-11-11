"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { savedTheme, THEME_STORAGE_KEY, type Theme, type ThemePreference } from "@/core/theme";

const ThemeContext = createContext<{
  theme: Theme;
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
  toggle: () => void;
}>({ theme: "light", preference: "system", setPreference: () => {}, toggle: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const preferenceRef = useRef<Theme | null>(null);
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function apply(next: Theme) {
      document.documentElement.dataset.theme = next;
      setTheme(next);
    }
    function syncStorage() {
      try {
        preferenceRef.current = savedTheme(localStorage.getItem(THEME_STORAGE_KEY));
      } catch {
        preferenceRef.current = null;
      }
      setPreferenceState(preferenceRef.current ?? "system");
      apply(preferenceRef.current ?? (media.matches ? "dark" : "light"));
    }
    function systemChanged() {
      if (!preferenceRef.current) apply(media.matches ? "dark" : "light");
    }
    function storageChanged(event: StorageEvent) {
      if (event.key === THEME_STORAGE_KEY || event.key === null) syncStorage();
    }
    syncStorage();
    media.addEventListener("change", systemChanged);
    window.addEventListener("storage", storageChanged);
    return () => {
      media.removeEventListener("change", systemChanged);
      window.removeEventListener("storage", storageChanged);
    };
  }, []);

  function setPreference(next: ThemePreference) {
    preferenceRef.current = next === "system" ? null : next;
    setPreferenceState(next);
    const applied = preferenceRef.current ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = applied;
    setTheme(applied);
    try {
      if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Switching still works for this visit when browser storage is blocked.
    }
  }
  function toggle() {
    setPreference(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  }

  return (
    <ThemeContext.Provider value={{ theme, preference, setPreference, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label="Chế độ tối"
      aria-pressed={theme === "dark"}
      title={theme === "dark" ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối"}
      onClick={toggle}
    >
      <svg
        className="theme-moon"
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79Z" />
      </svg>
    </button>
  );
}
