"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { savedTheme, THEME_STORAGE_KEY, type Theme } from "@/core/theme";

const ThemeContext = createContext({ theme: "light" as Theme, toggle: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const preference = useRef<Theme | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function apply(next: Theme) {
      document.documentElement.dataset.theme = next;
      setTheme(next);
    }
    function syncStorage() {
      try {
        preference.current = savedTheme(localStorage.getItem(THEME_STORAGE_KEY));
      } catch {
        preference.current = null;
      }
      apply(preference.current ?? (media.matches ? "dark" : "light"));
    }
    function systemChanged() {
      if (!preference.current) apply(media.matches ? "dark" : "light");
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

  function toggle() {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    preference.current = next;
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Switching still works for this visit when browser storage is blocked.
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function ThemeToggle() {
  const { theme, toggle } = useContext(ThemeContext);
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
