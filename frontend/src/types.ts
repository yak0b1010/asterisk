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

/* ── Users & extensions ────────────────────────────────── */
export type DepartmentId = "administration" | "finance" | "it" | "support" | "management";

/** A person. GET/POST /users, GET/PUT/DELETE /users/:id */
export interface DirectoryUser {
  id: string;
  fullName: string;
  email: string;
  department: DepartmentId;
  createdAt: string; // ISO 8601
}
export type UserInput = Pick<DirectoryUser, "fullName" | "email" | "department">;

/** A SIP endpoint. The SIP secret is write-only: it is never returned by the API. */
export interface Extension {
  number: string; // "100".."599"
  userId: string | null;
  enabled: boolean;
  registered: boolean;
  contactIp: string | null; // where the phone registered from, when registered
}
export interface ExtensionInput {
  number: string;
  userId: string | null;
  secret: string; // required on create, empty = unchanged on update
  enabled: boolean;
}
export interface BulkExtensionsInput {
  extensions: { number: string; secret: string }[];
  enabled: boolean;
}
export interface BulkExtensionsResult {
  created: string[];
  skipped: string[]; // numbers that already existed
}
