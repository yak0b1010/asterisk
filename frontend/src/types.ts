export type Role = "admin" | "operator" | "viewer";

export interface AuthUser {
  username: string;
  fullName: string;
  role: Role;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

/* ── Dashboard ─────────────────────────────────────────── */
export type CallStatus = "answered" | "missed" | "busy" | "failed";

export interface RecentCall {
  id: string;
  startedAt: string; // ISO 8601
  caller: string;
  callee: string;
  durationSec: number;
  status: CallStatus;
}

/** GET /dashboard/summary */
export interface DashboardSummary {
  asterisk: { status: "running" | "degraded" | "stopped"; version: string; uptimeSec: number };
  extensions: { total: number; registered: number };
  calls: { active: number; today: number; answered: number; missed: number; avgDurationSec: number };
  recentCalls: RecentCall[];
}

/** GET /system/metrics (one sample; the UI keeps the history) */
export interface SystemMetrics {
  timestamp: string; // ISO 8601
  cpuPercent: number;
  memoryPercent: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  diskPercent: number;
  diskUsedGb: number;
  diskTotalGb: number;
}
