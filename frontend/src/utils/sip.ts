import type { DepartmentId } from "../types";

/** Numbering plan, mirrors the dialplan in asterisk/conf (extensions_custom.conf) */
export const DEPARTMENTS: { id: DepartmentId; label: string; from: number; to: number }[] = [
  { id: "administration", label: "Administration", from: 100, to: 199 },
  { id: "finance", label: "Finance", from: 200, to: 299 },
  { id: "it", label: "IT", from: 300, to: 399 },
  { id: "support", label: "Customer service", from: 400, to: 499 },
  { id: "management", label: "Management", from: 500, to: 599 },
];

export const departmentLabel = (id: DepartmentId) => DEPARTMENTS.find((d) => d.id === id)?.label ?? id;

export function departmentOf(extension: string): DepartmentId | null {
  const n = Number(extension);
  return DEPARTMENTS.find((d) => n >= d.from && n <= d.to)?.id ?? null;
}

/** Random SIP secret (no ambiguous characters). Uses the Web Crypto API. */
export function generateSecret(length = 14): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
