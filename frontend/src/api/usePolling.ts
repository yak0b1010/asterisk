import { useEffect, useState } from "react";
import { api } from "./client";

/** Fetches `path` now and then every `intervalMs`. Pauses while the tab is hidden. */
export function usePolling<T>(path: string, intervalMs = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;

    const tick = async () => {
      if (!document.hidden) {
        try {
          const d = await api<T>(path);
          if (alive) { setData(d); setError(null); setUpdatedAt(new Date()); }
        } catch (e) {
          if (alive) setError(e instanceof Error ? e.message : "Request failed");
        }
      }
      if (alive) timer = window.setTimeout(tick, intervalMs);
    };

    tick();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [path, intervalMs]);

  return { data, error, updatedAt };
}
