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

/* ── Dialplan ──────────────────────────────────────────── */
export interface QueueRef { id: string; name: string } // GET /queues (extended in the call-center step)

/** Numbering plan entry: a range of extensions and how calls to it are routed. */
export interface DialRange {
  id: string;
  name: string;
  from: number;
  to: number;
  routing: "person" | "queue"; // person = ring the phone; queue = send to a call-center queue
  queue: string | null; // queue id when routing = "queue"
  ringTimeoutSec: number;
  voicemailFallback: boolean; // busy / no answer (or queue overflow) goes to voicemail
}
export type DialRangeInput = Omit<DialRange, "id">;

/** Short service numbers outside the extension ranges (010, 020, ...). */
export interface ServiceNumber {
  id: string;
  number: string;
  label: string;
  kind: "queue" | "voicemail-main" | "voicemail-deposit";
  queue: string | null;
}
export type ServiceNumberInput = Omit<ServiceNumber, "id">;

/** Department-to-department call restrictions: the listed pairs are blocked. */
export interface Restrictions { blocked: { fromRangeId: string; toRangeId: string }[] }

export type ForwardType = "unconditional" | "busy" | "no-answer";
export interface ForwardRule { id: string; extension: string; type: ForwardType; destination: string; enabled: boolean }
export type ForwardRuleInput = Omit<ForwardRule, "id">;

export interface TransferSettings {
  blindEnabled: boolean;
  blindCode: string;
  attendedEnabled: boolean;
  attendedCode: string;
  timeoutSec: number; // how long the transfer target rings before the call returns
}
