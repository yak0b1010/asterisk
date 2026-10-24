const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value?: string | null): string {
  const date = toDate(value);
  return date ? dateTimeFormatter.format(date) : "—";
}

export function formatDate(value?: string | null): string {
  const date = toDate(value);
  return date ? dateFormatter.format(date) : "—";
}

export function formatTime(value?: string | null): string {
  const date = toDate(value);
  return date ? timeFormatter.format(date) : "—";
}

export function formatRelative(value?: string | null): string {
  const date = toDate(value);
  if (!date) return "—";
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  if (absolute < 45) return "just now";
  if (absolute < 3600) return relativeFormatter.format(Math.round(seconds / 60), "minute");
  if (absolute < 86400) return relativeFormatter.format(Math.round(seconds / 3600), "hour");
  if (absolute < 2592000) return relativeFormatter.format(Math.round(seconds / 86400), "day");
  if (absolute < 31536000) return relativeFormatter.format(Math.round(seconds / 2592000), "month");
  return relativeFormatter.format(Math.round(seconds / 31536000), "year");
}

export function formatDuration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${remainingMinutes}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function formatClock(seconds?: number | null): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function formatBytes(bytes?: number | null, digits = 1): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  const exponent = Math.min(
    Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : digits)} ${units[exponent]}`;
}

export function formatUptime(seconds?: number | null): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "—";
  return formatDuration(seconds);
}

export function formatNumber(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat().format(value);
}

export function formatPercent(value?: number | null, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function maskSecret(value?: string | null): string {
  if (!value) return "—";
  return "•".repeat(Math.min(12, Math.max(6, value.length)));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function dateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayInput(): string {
  return dateInputValue(new Date());
}

export function daysAgoInput(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return dateInputValue(date);
}

export type Tone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "accent";

export function dispositionTone(disposition: string): Tone {
  switch (disposition.toUpperCase()) {
    case "ANSWERED":
      return "success";
    case "NO ANSWER":
      return "warning";
    case "BUSY":
      return "info";
    case "FAILED":
    case "CONGESTION":
      return "danger";
    default:
      return "neutral";
  }
}

export function statusTone(status: string): Tone {
  const value = status.toLowerCase();
  if (["ok", "completed", "active", "connected", "online", "registered", "available"].includes(value)) {
    return "success";
  }
  if (["degraded", "pending", "warning", "paused", "unknown", "inactive"].includes(value)) {
    return "warning";
  }
  if (["failed", "error", "offline", "unreachable", "disabled"].includes(value)) {
    return "danger";
  }
  return "neutral";
}
