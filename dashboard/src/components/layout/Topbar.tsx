import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  ChevronDown,
  CircleUserRound,
  ExternalLink,
  LogOut,
  Menu,
  RefreshCw,
  ServerCog,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useInterval } from "../../hooks/useInterval";
import type { MonitoringStatus } from "../../lib/types";
import { cx } from "../../lib/utils";
import { Badge } from "../ui/Badge";
import { IconButton } from "../ui/Button";

const TITLES: Array<[string, string]> = [
  ["/extensions", "Extensions"],
  ["/dialplan", "Dialplan"],
  ["/voicemail", "Voicemail"],
  ["/queues", "Queues"],
  ["/ivr", "IVR menus"],
  ["/conferences", "Conferences"],
  ["/cdr", "Call records"],
  ["/monitoring", "Monitoring"],
  ["/backups", "Backups"],
  ["/users", "Users"],
  ["/settings", "Settings"],
  ["/audit", "Audit log"],
  ["/account", "Account"],
];

function currentTitle(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  const match = TITLES.find(([prefix]) => pathname.startsWith(prefix));
  return match ? match[1] : "Control Center";
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const statusQuery = useApiQuery<MonitoringStatus>("/api/v1/monitoring/status");
  useInterval(() => statusQuery.refresh(), 30000);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const status = statusQuery.data;
  const dbUp = status?.database.connected ?? false;
  const ami = status?.asterisk.ami;
  const ari = status?.asterisk.ari;
  const asteriskConfigured = Boolean(ami?.configured || ari?.configured);
  const asteriskConnected = Boolean(ami?.connected || ari?.connected);

  const pbxTone = !asteriskConfigured
    ? "neutral"
    : asteriskConnected
      ? "success"
      : "danger";
  const pbxLabel = !asteriskConfigured
    ? "PBX off"
    : asteriskConnected
      ? "PBX live"
      : "PBX error";

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#17191c]/55 shadow-[0_1px_0_0_rgb(255_255_255/0.03)] backdrop-blur-2xl">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onMenu}
          className="rounded-lg p-2 text-neutral-400 transition hover:bg-white/[0.07] hover:text-white lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
            <span>Control Center</span>
            <span className="text-neutral-600">/</span>
            <span className="truncate text-neutral-400">{currentTitle(location.pathname)}</span>
          </div>
          <h1 className="truncate text-sm font-semibold text-neutral-100 sm:text-base">
            {currentTitle(location.pathname)}
          </h1>
        </div>

        <div className="hidden items-center gap-1.5 md:flex">
          <Link
            to="/monitoring"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-neutral-400 shadow-[inset_0_1px_0_rgb(255_255_255/0.05)] backdrop-blur-xl transition hover:border-white/20 hover:bg-white/[0.07] hover:text-neutral-200"
            title="Database status"
          >
            <span
              className={cx(
                "h-1.5 w-1.5 rounded-full",
                dbUp ? "bg-neutral-400" : "bg-neutral-400",
              )}
            />
            PostgreSQL
          </Link>
          <Link to="/monitoring">
            <Badge tone={pbxTone} dot>
              {pbxLabel}
            </Badge>
          </Link>
          <IconButton
            label="Refresh status"
            onClick={statusQuery.refresh}
            className={statusQuery.refreshing ? "animate-spin" : undefined}
          >
            <RefreshCw className="h-4 w-4" />
          </IconButton>
        </div>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            className="flex items-center gap-2 rounded-xl border border-transparent px-1.5 py-1 transition hover:border-white/10 hover:bg-white/[0.05]"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-400/30 bg-neutral-500/15 text-[11px] font-bold text-neutral-200 shadow-[0_0_20px_-8px_rgb(255_255_255/0.25)]">
              {(user?.username ?? "?").slice(0, 2).toUpperCase()}
            </span>
            <span className="hidden text-left sm:block">
              <span className="block max-w-[130px] truncate text-xs font-semibold text-neutral-200">
                {user?.full_name || user?.username}
              </span>
              <span className="block text-[10px] uppercase tracking-wider text-neutral-500">
                {user?.role}
              </span>
            </span>
            <ChevronDown className="hidden h-3.5 w-3.5 text-neutral-500 sm:block" />
          </button>

          {menuOpen ? (
            <div
              role="menu"
              className="animate-scale-in absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-white/10 bg-[#24272b]/85 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.95),inset_0_1px_0_rgb(255_255_255/0.08)] backdrop-blur-2xl"
            >
              <div className="border-b border-white/10 px-3.5 py-3">
                <p className="truncate text-sm font-semibold text-neutral-100">
                  {user?.full_name || user?.username}
                </p>
                <p className="truncate text-[11px] text-neutral-500">{user?.email}</p>
              </div>
              <div className="p-1.5">
                <Link
                  to="/account"
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-neutral-300 transition hover:bg-white/[0.07]"
                  role="menuitem"
                >
                  <CircleUserRound className="h-4 w-4 text-neutral-500" />
                  Account &amp; sessions
                </Link>
                <Link
                  to="/monitoring"
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-neutral-300 transition hover:bg-white/[0.07]"
                  role="menuitem"
                >
                  <Activity className="h-4 w-4 text-neutral-500" />
                  System monitoring
                </Link>
                <a
                  href="/api/v1/docs"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-neutral-300 transition hover:bg-white/[0.07]"
                  role="menuitem"
                >
                  <ServerCog className="h-4 w-4 text-neutral-500" />
                  API documentation
                  <ExternalLink className="ml-auto h-3 w-3 text-neutral-600" />
                </a>
              </div>
              <div className="border-t border-white/10 p-1.5">
                <button
                  type="button"
                  onClick={async () => {
                    setMenuOpen(false);
                    await logout();
                    navigate("/login", { replace: true });
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-neutral-300 transition hover:bg-neutral-500/10"
                  role="menuitem"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
