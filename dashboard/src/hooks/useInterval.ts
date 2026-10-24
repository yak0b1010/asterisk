import { useEffect, useRef } from "react";

export function useInterval(
  callback: () => void,
  delay: number | null,
): void {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;
    const timer = window.setInterval(() => savedCallback.current(), delay);
    return () => window.clearInterval(timer);
  }, [delay]);
}
