import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiRequest, errorMessage } from "../lib/api";
import type { PageMeta } from "../lib/types";

export interface ApiQuery<T> {
  data: T | null;
  meta?: PageMeta;
  error: ApiError | null;
  loading: boolean;
  refreshing: boolean;
  refresh: () => void;
}

/**
 * Fetch an API envelope and keep the previous value visible while a refresh is
 * in flight. Passing null disables the query (useful for permission-gated or
 * dependent requests).
 */
export function useApiQuery<T>(
  path: string | null,
  deps: unknown[] = [],
): ApiQuery<T> {
  const [data, setData] = useState<T | null>(null);
  const [meta, setMeta] = useState<PageMeta | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [refreshing, setRefreshing] = useState(false);
  const [version, setVersion] = useState(0);
  const hasData = useRef(false);

  useEffect(() => {
    if (!path) {
      hasData.current = false;
      setData(null);
      setMeta(undefined);
      setError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    let active = true;
    const controller = new AbortController();
    setLoading(!hasData.current);
    setRefreshing(hasData.current);

    apiRequest<T>(path, { signal: controller.signal })
      .then((envelope) => {
        if (!active) return;
        setData(envelope.data);
        setMeta(envelope.meta);
        setError(null);
        hasData.current = true;
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if ((caught as Error).name === "AbortError") return;
        setError(
          caught instanceof ApiError
            ? caught
            : new ApiError(0, "unknown_error", errorMessage(caught)),
        );
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
    // The caller supplies primitive dependencies for filters and pagination.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, version, ...deps]);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  return { data, meta, error, loading, refreshing, refresh };
}
