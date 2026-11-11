"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_STUDY_PREFERENCES, parseStudyPreferences, STUDY_PREFERENCES_KEY, type StudyPreferences } from "@/core/study-preferences";

export function useStudyPreferences() {
  const [preferences, setPreferences] = useState<StudyPreferences>({ ...DEFAULT_STUDY_PREFERENCES });
  const [storageAvailable, setStorageAvailable] = useState(true);
  const latest = useRef(preferences);

  useEffect(() => {
    function load() {
      try {
        const next = parseStudyPreferences(localStorage.getItem(STUDY_PREFERENCES_KEY));
        latest.current = next;
        setPreferences(next);
        setStorageAvailable(true);
      } catch {
        setStorageAvailable(false);
      }
    }
    function sync(event: StorageEvent) {
      if (event.key === STUDY_PREFERENCES_KEY || event.key === null) load();
    }
    load();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const updatePreferences = useCallback((patch: Partial<StudyPreferences>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setPreferences(next);
    try {
      localStorage.setItem(STUDY_PREFERENCES_KEY, JSON.stringify(next));
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
  }, []);

  return { preferences, updatePreferences, storageAvailable };
}
