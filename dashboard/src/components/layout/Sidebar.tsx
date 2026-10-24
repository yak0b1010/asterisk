import { NavLink } from "react-router-dom";
import {
  Activity,
  DatabaseBackup,
  GitBranch,
  Headphones,
  LayoutDashboard,
  ListTree,
  LogOut,
  Phone,
  PhoneCall,
  Presentation,
  Radio,
  ScrollText,
  Settings2,
  ShieldCheck,
  UserCog,
  UsersRound,
  Voicemail,
  X,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { cx } from "../../lib/utils";
import { Badge } from "../ui/Badge";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission: string;
  end?: boolean;
}

const GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Overview",
    items: [
      {
        to: "/",
        label: "Dashboard",
        icon: LayoutDashboard,
        permission: "dashboard.read",
        end: true,
      },
    ],
  },
  {
    label: "Telephony",
    items: [
      { to: "/extensions", label: "Extensions", icon: Phone, permission: "extensions.read" },
      { to: "/dialplan", label: "Dialplan", icon: GitBranch, permission: "dialplan.read" },
      { to: "/voicemail", label: "Voicemail", icon: Voicemail, permission: "voicemail.read" },
      { to: "/queues", label: "Queues", icon: Headphones, permission: "queues.read" },
      { to: "/ivr", label: "IVR menus", icon: ListTree, permission: "ivr.read" },
      { to: "/conferences", label: "Conferences", icon: Presentation, permission: "conferences.read" },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/cdr", label: "Call records", icon: PhoneCall, permission: "cdr.read" },
      { to: "/monitoring", label: "Monitoring", icon: Activity, permission: "monitoring.read" },
      { to: "/backups", label: "Backups", icon: DatabaseBackup, permission: "backups.read" },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/users", label: "Users", icon: UsersRound, permission: "users.read" },
      { to: "/settings", label: "Settings", icon: Settings2, permission: "settings.read" },
      { to: "/audit", label: "Audit log", icon: ScrollText, permission: "audit.read" },
    ],
  },
];

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function Sidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { user, can, logout } = useAuth();

  return (
    <>
      <div
        className={cx(
          "fixed inset-0 z-40 bg-[#0f1113]/70 backdrop-blur-md transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-50 flex w-[268px] flex-col border-r border-white/10 bg-[#17191c]/95 shadow-[inset_-1px_0_0_rgb(255_255_255/0.03),20px_0_60px_-40px_rgb(0_0_0/0.9)] backdrop-blur-2xl transition-transform duration-200 lg:bg-[#17191c]/60 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between gap-2 border-b border-white/10 px-4">
          <NavLink to="/" className="flex min-w-0 items-center gap-2.5" onClick={onClose}>
            <img
              src="/logo.svg"
              alt=""
              className="h-9 w-9 rounded-xl drop-shadow-[0_0_18px_rgb(255_255_255/0.15)]"
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-bold tracking-[0.18em] text-white">
                ASTERISK
              </span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.2em] text-neutral-500">
                Control Center
              </span>
            </span>
          </NavLink>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-500 transition hover:bg-white/[0.07] hover:text-neutral-200 lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {GROUPS.map((group) => {
            const visible = group.items.filter((item) => can(item.permission));
            if (visible.length === 0) return null;
            return (
              <div key={group.label} className="mb-5">
                <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                  {group.label}
                </p>
                <div className="space-y-1">
                  {visible.map((item) => {
                    const Icon = item.icon;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        onClick={onClose}
                        className={({ isActive }) =>
                          cx(
                            "group relative flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium transition-all",
                            isActive
                              ? "border border-white/10 bg-gradient-to-r from-neutral-500/[0.16] to-white/[0.035] text-neutral-200 shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_8px_24px_-18px_rgb(255_255_255/0.3)]"
                              : "border border-transparent text-neutral-400 hover:bg-white/[0.05] hover:text-neutral-100",
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive ? (
                              <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-gradient-to-b from-neutral-300 to-neutral-400" />
                            ) : null}
                            <Icon
                              className={cx(
                                "h-4 w-4 shrink-0",
                                isActive
                                  ? "text-neutral-300"
                                  : "text-neutral-500 group-hover:text-neutral-300",
                              )}
                            />
                            <span className="truncate">{item.label}</span>
                          </>
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-3">
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 text-[10px] text-neutral-500 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] backdrop-blur-xl">
            <Radio className="h-3.5 w-3.5 text-neutral-400/80" />
            <span className="flex-1">PostgreSQL source of truth</span>
            <ShieldCheck className="h-3.5 w-3.5 text-neutral-500" />
          </div>
          {user ? (
            <div className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-neutral-400/30 bg-neutral-500/15 text-[11px] font-bold text-neutral-200 shadow-[0_0_20px_-8px_rgb(255_255_255/0.25)]">
                {user.username.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-neutral-200">
                  {user.full_name || user.username}
                </p>
                <Badge tone="neutral" className="mt-0.5 px-1.5 py-0 text-[9px]">
                  {roleLabel(user.role)}
                </Badge>
              </div>
              <button
                type="button"
                onClick={() => void logout()}
                className="rounded-lg p-1.5 text-neutral-500 transition hover:bg-white/[0.07] hover:text-neutral-300"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : null}
          <NavLink
            to="/account"
            className="mt-1 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] text-neutral-500 transition hover:bg-white/[0.05] hover:text-neutral-300"
          >
            <UserCog className="h-3.5 w-3.5" />
            Account &amp; sessions
          </NavLink>
        </div>
      </aside>
    </>
  );
}
