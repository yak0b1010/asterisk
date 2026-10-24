import { useEffect } from "react";

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · Asterisk Control Center` : "Asterisk Control Center";
  }, [title]);
}
