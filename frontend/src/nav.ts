import {
  LayoutDashboard, Users, Phone, ListOrdered, Voicemail, Video, Music, Headset, Workflow,
  Activity, FileClock, ShieldCheck, DatabaseBackup, Network, type LucideIcon,
} from "lucide-react";
import type { Role } from "./types";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
  step: number; // build step in which the page is implemented
  group: "Overview" | "Telephony" | "Call center" | "Insight" | "System";
}

const all: Role[] = ["admin", "operator", "viewer"];
const ops: Role[] = ["admin", "operator"];

export const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: all, step: 2, group: "Overview" },
  { to: "/users", label: "Users", icon: Users, roles: ops, step: 3, group: "Telephony" },
  { to: "/extensions", label: "Extensions", icon: Phone, roles: ops, step: 3, group: "Telephony" },
  { to: "/dialplan", label: "Dialplan", icon: ListOrdered, roles: ["admin"], step: 4, group: "Telephony" },
  { to: "/voicemail", label: "Voicemail", icon: Voicemail, roles: ops, step: 5, group: "Telephony" },
  { to: "/conferences", label: "Conferences", icon: Video, roles: ops, step: 5, group: "Telephony" },
  { to: "/moh", label: "Sound on hold", icon: Music, roles: ops, step: 5, group: "Telephony" },
  { to: "/queues", label: "Queues", icon: Headset, roles: ops, step: 6, group: "Call center" },
  { to: "/ivr", label: "IVR menus", icon: Workflow, roles: ["admin"], step: 7, group: "Call center" },
  { to: "/monitoring", label: "Monitoring", icon: Activity, roles: all, step: 8, group: "Insight" },
  { to: "/cdr", label: "Call records", icon: FileClock, roles: all, step: 8, group: "Insight" },
  { to: "/security", label: "Security", icon: ShieldCheck, roles: ["admin"], step: 9, group: "System" },
  { to: "/backup", label: "Backup & restore", icon: DatabaseBackup, roles: ["admin"], step: 9, group: "System" },
  { to: "/network", label: "Network", icon: Network, roles: ["admin"], step: 9, group: "System" },
];
