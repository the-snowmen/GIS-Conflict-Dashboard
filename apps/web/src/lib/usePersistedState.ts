import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

// useState that mirrors to localStorage, so a preference survives a reload.
export function usePersistedState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored !== null ? (JSON.parse(stored) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable (private mode / quota) — non-fatal */
    }
  }, [key, value]);
  return [value, setValue];
}
