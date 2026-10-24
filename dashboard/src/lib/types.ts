export type Role = "admin" | "supervisor" | "agent" | "viewer";

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface Envelope<T> {
  data: T;
  meta?: PageMeta;
}

export interface User {
  id: string;
  username: string;
  email: string;
  full_name: string;
  role: Role;
  active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at?: string;
}

export interface TokenEnvelope {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: User;
  permissions: string[];
}

export interface AuthMe {
  user: User;
  permissions: string[];
}

export interface Session {
  id: string;
  ip: string;
  user_agent: string;
  created_at: string;
  expires_at: string;
}

export interface Extension {
  id: string;
  number: string;
  display_name: string;
  user_id?: string;
  context: string;
  codecs: string;
  caller_id?: string;
  voicemail_enabled: boolean;
  voicemail_pin?: string;
  sip_password?: string;
  enabled: boolean;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface ExtensionCredentials {
  id: string;
  number: string;
  sip_password: string;
  voicemail_pin: string;
}

export interface ExtensionStatusEntry {
  extension: string;
  enabled: boolean;
  state: string;
  channels?: string[] | null;
  source: string;
}

export interface ExtensionStatuses {
  configured: boolean;
  source: string;
  endpoints: ExtensionStatusEntry[];
}

export interface ExtensionStatus {
  extension: string;
  enabled: boolean;
  configured: boolean;
  status: {
    resource?: string;
    state?: string;
    source?: string;
    [key: string]: unknown;
  };
}

export interface DialplanRule {
  id: string;
  context: string;
  pattern: string;
  priority: number;
  app: string;
  app_data: string;
  description?: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface VoicemailBox {
  id: string;
  extension: string;
  context: string;
  name: string;
  email?: string;
  timezone?: string;
  pin?: string;
  max_messages: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface QueueMember {
  id: string;
  queue_id: string;
  interface: string;
  member_name?: string;
  penalty: number;
  paused: boolean;
  created_at: string;
  updated_at: string;
}

export interface Queue {
  id: string;
  name: string;
  strategy: string;
  timeout: number;
  music_on_hold?: string;
  ring_in_use: boolean;
  max_wait: number;
  announce?: string;
  announce_frequency: number;
  description?: string;
  active: boolean;
  members_count: number;
  members?: QueueMember[];
  created_at: string;
  updated_at: string;
}

export type IVRDestinationType =
  | "extension"
  | "queue"
  | "voicemail"
  | "ivr"
  | "conference"
  | "playback";

export interface IVROption {
  id?: string;
  menu_id?: string;
  digit: string;
  destination_type: IVRDestinationType;
  destination: string;
  description?: string;
  sort_order?: number;
}

export interface IVRMenu {
  id: string;
  name: string;
  description?: string;
  greeting_sound: string;
  invalid_sound?: string;
  timeout: number;
  max_attempts: number;
  active: boolean;
  options: IVROption[];
  created_at: string;
  updated_at: string;
}

export interface ConferenceRoom {
  id: string;
  number: string;
  name: string;
  pin?: string;
  max_members: number;
  muted: boolean;
  record: boolean;
  active: boolean;
  description?: string;
  created_at: string;
  updated_at: string;
}

export type Disposition =
  | "ANSWERED"
  | "NO ANSWER"
  | "BUSY"
  | "FAILED"
  | "CONGESTION"
  | "UNKNOWN";

export interface CDR {
  id: number;
  calldate: string;
  clid: string;
  src: string;
  dst: string;
  dcontext: string;
  channel: string;
  dstchannel: string;
  lastapp: string;
  lastdata: string;
  duration: number;
  billsec: number;
  disposition: string;
  amaflags: number;
  accountcode: string;
  uniqueid: string;
  userfield: string;
  peeraccount: string;
  linkedid: string;
  sequence: number;
}

export interface CDRDayStat {
  day: string;
  count: number;
  answered: number;
  total_billsec_seconds: number;
}

export interface CDRDispositionStat {
  disposition: string;
  count: number;
  total_billsec_seconds: number;
}

export interface CDRStats {
  total: number;
  answered: number;
  no_answer: number;
  busy: number;
  failed: number;
  answer_rate: number;
  total_duration_seconds: number;
  total_billsec_seconds: number;
  average_duration_seconds: number;
  average_billsec_seconds: number;
  by_disposition: CDRDispositionStat[];
  by_day: CDRDayStat[];
}

export interface AuditEntry {
  id: number;
  user_id?: string;
  username: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  method: string;
  path: string;
  status_code: number;
  ip: string;
  user_agent?: string;
  details?: string;
  created_at: string;
}

export interface Setting {
  key: string;
  value: unknown;
  description?: string;
  updated_by?: string;
  updated_at: string;
}

export interface Backup {
  id: string;
  created_at: string;
  updated_at: string;
  filename: string;
  size_bytes: number;
  status: string;
  includes: string;
  error?: string;
  created_by: string;
  completed_at?: string;
}

export interface DashboardStats {
  users: { total: number; active: number };
  extensions: { total: number; enabled: number; voicemail_enabled: number };
  dialplan: { enabled_rules: number };
  queues: { total: number };
  ivr: { total: number };
  conferences: { total: number };
  voicemail: { boxes: number; active: number };
  calls: {
    today: number;
    answered_today: number;
    active: number;
    asterisk_configured: boolean;
    active_calls_error: string;
  };
  system: {
    cpu_percent: number;
    memory_percent: number;
    disk_percent: number;
    load_1: number;
    uptime_seconds: number;
  };
}

export interface SystemSnapshot {
  hostname: string;
  os: string;
  arch: string;
  cpus: number;
  uptime_seconds: number;
  load_1: number;
  load_5: number;
  load_15: number;
  cpu_percent: number;
  memory_total_bytes: number;
  memory_used_bytes: number;
  memory_free_bytes: number;
  memory_percent: number;
  swap_total_bytes: number;
  swap_used_bytes: number;
  disk_total_bytes: number;
  disk_used_bytes: number;
  disk_free_bytes: number;
  disk_percent: number;
  goroutines: number;
  heap_alloc_bytes: number;
  rss_bytes: number;
  collected_at: string;
}

export interface MonitoringStatus {
  status: string;
  version: string;
  uptime_seconds: number;
  database: {
    connected: boolean;
    pool: {
      open: number;
      in_use: number;
      idle: number;
      max_open: number;
      wait_count: number;
      wait_duration_s: number;
    };
  };
  asterisk: {
    ami: {
      configured: boolean;
      connected: boolean;
      host: string;
      port: number;
      error?: string;
    };
    ari: {
      configured: boolean;
      connected: boolean;
      url: string;
      error?: string;
    };
  };
  time: string;
}

export interface MonitoringSystem {
  system: SystemSnapshot;
  process: {
    version: string;
    python_version: string;
    uptime_seconds: number;
  };
}

export type TelephonyRow = Record<string, unknown>;

export interface MonitoringAsterisk {
  configured: boolean;
  status: MonitoringStatus["asterisk"];
  core?: Record<string, unknown>;
  core_error?: string;
  version?: unknown;
}

export interface TelephonyCollection {
  configured: boolean;
  source?: string;
  count?: number;
  [key: string]: unknown;
}

export interface QueueLiveStatus {
  configured: boolean;
  queues: TelephonyRow[];
}

export interface ConferenceLiveStatus {
  configured: boolean;
  conferences: TelephonyRow[];
}

export interface UserExtensions {
  data: Extension[];
}

export interface BackupRestoreResult {
  restored: boolean;
  backup_id: string;
  filename: string;
  restored_at: string;
  includes_cdr: boolean;
  realtime_synced: boolean;
  realtime_error?: string;
}

export interface SimpleMessage {
  message: string;
}
