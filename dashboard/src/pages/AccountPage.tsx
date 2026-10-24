import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  BadgeCheck,
  CalendarClock,
  CircleUserRound,
  Clock3,
  Eye,
  EyeOff,
  Fingerprint,
  Globe,
  KeyRound,
  Laptop,
  LockKeyhole,
  LogOut,
  Mail,
  MonitorSmartphone,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  UserCog,
} from "lucide-react";
import { FullPageLoader } from "../components/RequirePermission";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { Button, IconButton } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { DataTable, type Column } from "../components/ui/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorPanel } from "../components/ErrorPanel";
import { Field, Input } from "../components/ui/Field";
import { KeyValue } from "../components/ui/KeyValue";
import { PageHeader } from "../components/ui/PageHeader";
import { Tabs } from "../components/ui/Tabs";
import { useAuth } from "../context/AuthContext";
import { useApiQuery } from "../hooks/useApiQuery";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useToast } from "../context/ToastContext";
import {
  apiDelete,
  apiPatch,
  apiPut,
  errorMessage,
} from "../lib/api";
import type { Role, Session, User } from "../lib/types";
import {
  formatDate,
  formatDateTime,
  formatRelative,
  initials,
  titleCase,
  type Tone,
} from "../lib/format";

type TabId = "profile" | "security" | "sessions" | "permissions";

const ROLE_INFO: Record<
  Role,
  { label: string; tone: Tone; description: string }
> = {
  admin: {
    label: "Administrator",
    tone: "accent",
    description:
      "Full access to every configuration area, user account, backup and audit event.",
  },
  supervisor: {
    label: "Supervisor",
    tone: "info",
    description:
      "Manages telephony configuration, call records and backups; account administration is read-only.",
  },
  agent: {
    label: "Agent",
    tone: "success",
    description:
      "Reads telephony configuration, manages voicemail and reviews call records for daily work.",
  },
  viewer: {
    label: "Viewer",
    tone: "neutral",
    description:
      "Read-only access to dashboards, configuration, call records, backups and the audit trail.",
  },
};

const PERMISSION_AREAS: Record<string, string> = {
  dashboard: "Dashboard",
  users: "Users",
  extensions: "Extensions",
  dialplan: "Dialplan",
  voicemail: "Voicemail",
  queues: "Queues",
  ivr: "IVR menus",
  conferences: "Conferences",
  cdr: "Call records",
  monitoring: "Monitoring",
  audit: "Audit log",
  settings: "Settings",
  backups: "Backups",
};

const ACTION_ORDER = ["read", "write", "credentials", "export", "delete"];

function actionTone(action: string): Tone {
  switch (action) {
    case "write":
      return "warning";
    case "credentials":
      return "accent";
    case "export":
      return "success";
    case "delete":
      return "danger";
    default:
      return "info";
  }
}

function clientLabel(userAgent: string): string {
  if (!userAgent) return "Unknown client";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";
  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone|iPad|iPod/.test(userAgent)
        ? "iOS"
        : /Mac OS X/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}

function isMobileClient(userAgent: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/.test(userAgent);
}

export default function AccountPage() {
  useDocumentTitle("Account");
  const { user, permissions, logout, refreshUser } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [tab, setTab] = useState<TabId>("profile");

  const [profile, setProfile] = useState({ email: "", full_name: "" });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});

  const [password, setPassword] = useState({
    current_password: "",
    new_password: "",
    confirm: "",
  });
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});

  const [refreshing, setRefreshing] = useState(false);

  const sessions = useApiQuery<Session[]>("/api/v1/auth/sessions");
  const [revokeTarget, setRevokeTarget] = useState<Session | null>(null);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    if (!user) return;
    setProfile({ email: user.email, full_name: user.full_name });
  }, [user]);

  const sessionRows = sessions.data ?? [];

  const currentSessionId = useMemo(() => {
    if (typeof navigator === "undefined") return null;
    const agent = navigator.userAgent;
    return sessionRows.find((session) => session.user_agent === agent)?.id ?? null;
  }, [sessionRows]);

  const permissionGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const permission of permissions) {
      const [area, action] = permission.split(".", 2);
      const key = area || "other";
      const list = groups.get(key) ?? [];
      list.push(action || permission);
      groups.set(key, list);
    }
    return Array.from(groups.entries())
      .map(([area, actions]) => ({
        area,
        label: PERMISSION_AREAS[area] ?? titleCase(area),
        actions: actions.slice().sort((a, b) => {
          const left = ACTION_ORDER.indexOf(a);
          const right = ACTION_ORDER.indexOf(b);
          return (left === -1 ? 99 : left) - (right === -1 ? 99 : right);
        }),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [permissions]);

  const profileDirty = Boolean(
    user &&
      (profile.email !== user.email || profile.full_name !== user.full_name),
  );

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await refreshUser();
      sessions.refresh();
    } catch (caught) {
      toast.error("Could not refresh account", errorMessage(caught));
    } finally {
      setRefreshing(false);
    }
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors: Record<string, string> = {};
    const email = profile.email.trim();
    if (email && !/^[^@\s]+@[^@\s]+$/.test(email)) {
      errors.email = "Enter a valid email address.";
    }
    if (profile.full_name.trim().length > 120) {
      errors.full_name = "Maximum 120 characters.";
    }
    setProfileErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setProfileSaving(true);
    setProfileError("");
    try {
      await apiPatch<User>("/api/v1/auth/me", {
        email,
        full_name: profile.full_name.trim(),
      });
      await refreshUser();
      toast.success("Profile updated", "Your account details were saved.");
    } catch (caught) {
      setProfileError(errorMessage(caught));
    } finally {
      setProfileSaving(false);
    }
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!password.current_password) {
      errors.current_password = "Enter your current password.";
    }
    if (
      password.new_password.length < 8 ||
      password.new_password.length > 128
    ) {
      errors.new_password = "Use a password between 8 and 128 characters.";
    }
    if (password.new_password !== password.confirm) {
      errors.confirm = "The passwords do not match.";
    }
    setPasswordErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setPasswordSaving(true);
    setPasswordError("");
    try {
      await apiPut<{ message: string }>("/api/v1/auth/me/password", {
        current_password: password.current_password,
        new_password: password.new_password,
      });
      toast.success(
        "Password changed",
        "All sessions were revoked. Sign in again with your new password.",
      );
      await logout();
      navigate("/login", { replace: true });
    } catch (caught) {
      setPasswordError(errorMessage(caught));
    } finally {
      setPasswordSaving(false);
    }
  };

  const revokeSession = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await apiDelete(`/api/v1/auth/sessions/${revokeTarget.id}`);
      toast.success(
        "Session revoked",
        `${clientLabel(revokeTarget.user_agent)} can no longer refresh its token.`,
      );
      setRevokeTarget(null);
      sessions.refresh();
    } catch (caught) {
      toast.error("Could not revoke session", errorMessage(caught));
    } finally {
      setRevoking(false);
    }
  };

  const sessionColumns: Column<Session>[] = [
    {
      key: "client",
      header: "Client",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-white/[0.04] text-neutral-400">
            {isMobileClient(row.user_agent) ? (
              <Smartphone className="h-4 w-4" />
            ) : (
              <Laptop className="h-4 w-4" />
            )}
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-neutral-200">
              {clientLabel(row.user_agent)}
              {row.id === currentSessionId ? (
                <Badge tone="accent" className="px-1.5 py-0 text-[9px]">
                  This browser
                </Badge>
              ) : null}
            </p>
            <p
              className="mono max-w-[320px] truncate text-[10px] text-neutral-600"
              title={row.user_agent}
            >
              {row.user_agent || "No user agent recorded"}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "ip",
      header: "IP address",
      render: (row) => (
        <span className="mono inline-flex items-center gap-1.5 text-xs text-neutral-400">
          <Globe className="h-3 w-3 text-neutral-600" />
          {row.ip || "—"}
        </span>
      ),
    },
    {
      key: "created",
      header: "Signed in",
      render: (row) => (
        <div>
          <p className="whitespace-nowrap text-xs text-neutral-300">
            {formatDateTime(row.created_at)}
          </p>
          <p className="text-[10px] text-neutral-600">{formatRelative(row.created_at)}</p>
        </div>
      ),
    },
    {
      key: "expires",
      header: "Expires",
      render: (row) => (
        <div>
          <p className="whitespace-nowrap text-xs text-neutral-300">
            {formatDateTime(row.expires_at)}
          </p>
          <p className="text-[10px] text-neutral-600">{formatRelative(row.expires_at)}</p>
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <IconButton
          label="Revoke session"
          className="hover:bg-neutral-500/10 hover:text-neutral-300"
          onClick={() => setRevokeTarget(row)}
        >
          <LogOut className="h-3.5 w-3.5" />
        </IconButton>
      ),
    },
  ];

  if (!user) return <FullPageLoader label="Loading account…" />;

  const role = ROLE_INFO[user.role];

  const tabs = [
    {
      id: "profile",
      label: "Profile",
      icon: <CircleUserRound className="h-3.5 w-3.5" />,
    },
    {
      id: "security",
      label: "Security",
      icon: <KeyRound className="h-3.5 w-3.5" />,
    },
    {
      id: "sessions",
      label: "Sessions",
      icon: <MonitorSmartphone className="h-3.5 w-3.5" />,
      count: sessions.data?.length,
    },
    {
      id: "permissions",
      label: "Permissions",
      icon: <ShieldCheck className="h-3.5 w-3.5" />,
      count: permissions.length,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Personal"
        title="Account"
        description="Manage your profile, password, active sessions and the permissions granted by your role."
        actions={
          <>
            <Button
              variant="secondary"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={() => void refreshAll()}
              loading={refreshing}
            >
              Refresh
            </Button>
            <Button
              variant="ghost"
              icon={<LogOut className="h-4 w-4" />}
              onClick={() => void logout()}
            >
              Sign out
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="relative overflow-hidden border-b border-line/70 bg-gradient-to-r from-neutral-500/15 via-neutral-500/[0.06] to-transparent px-5 py-5">
          <div
            className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-neutral-500/10 blur-3xl"
            aria-hidden="true"
          />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-neutral-500/30 bg-neutral-500/15 text-xl font-bold text-neutral-200 shadow-[0_16px_40px_-20px_rgb(255_255_255/0.25)]">
                {initials(user.full_name || user.username)}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-lg font-semibold text-white">
                    {user.full_name || user.username}
                  </h2>
                  <Badge tone={role.tone}>{role.label}</Badge>
                  <Badge tone={user.active ? "success" : "neutral"} dot>
                    {user.active ? "Active" : "Disabled"}
                  </Badge>
                </div>
                <p className="mono mt-1 text-xs text-neutral-400">@{user.username}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-500">
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="h-3 w-3" />
                    {user.email || "No email address"}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarClock className="h-3 w-3" />
                    Member since {formatDate(user.created_at)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock3 className="h-3 w-3" />
                    Last sign-in{" "}
                    {user.last_login_at ? formatRelative(user.last_login_at) : "never"}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Badge tone="neutral" className="gap-1.5">
                <Fingerprint className="h-3 w-3" />
                {permissions.length} permissions
              </Badge>
              <Badge tone="neutral" className="gap-1.5">
                <MonitorSmartphone className="h-3 w-3" />
                {sessions.data ? `${sessions.data.length} active sessions` : "Sessions…"}
              </Badge>
            </div>
          </div>
        </div>

        <Tabs
          items={tabs}
          active={tab}
          onChange={(id) => setTab(id as TabId)}
          className="px-3 pt-1"
        />

        <div className="p-4 sm:p-5">
          {tab === "profile" ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <form onSubmit={saveProfile} className="space-y-4 lg:col-span-2">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-white/[0.05] text-neutral-300">
                    <CircleUserRound className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-100">Profile details</h3>
                    <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">
                      Your username and role are managed by an administrator. Email and
                      display name can be changed here.
                    </p>
                  </div>
                </div>

                {profileError ? (
                  <Alert tone="danger" title="Could not save profile">
                    {profileError}
                  </Alert>
                ) : null}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Username" hint="Usernames are immutable.">
                    <Input value={user.username} disabled className="mono" />
                  </Field>
                  <Field label="Role" hint="Assigned by an administrator.">
                    <Input value={role.label} disabled />
                  </Field>
                  <Field label="Email" error={profileErrors.email}>
                    <Input
                      type="email"
                      value={profile.email}
                      onChange={(event) => {
                        setProfile((current) => ({
                          ...current,
                          email: event.target.value,
                        }));
                        setProfileErrors((current) => {
                          if (!current.email) return current;
                          const next = { ...current };
                          delete next.email;
                          return next;
                        });
                      }}
                      placeholder="you@example.com"
                      autoComplete="email"
                    />
                  </Field>
                  <Field label="Full name" error={profileErrors.full_name}>
                    <Input
                      value={profile.full_name}
                      onChange={(event) => {
                        setProfile((current) => ({
                          ...current,
                          full_name: event.target.value,
                        }));
                        setProfileErrors((current) => {
                          if (!current.full_name) return current;
                          const next = { ...current };
                          delete next.full_name;
                          return next;
                        });
                      }}
                      placeholder="Your display name"
                      maxLength={120}
                      autoComplete="name"
                    />
                  </Field>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-4">
                  <p className="text-[11px] text-neutral-600">
                    {profileDirty ? "You have unsaved changes." : "Profile is up to date."}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setProfile({
                          email: user.email,
                          full_name: user.full_name,
                        })
                      }
                      disabled={!profileDirty || profileSaving}
                    >
                      Reset
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      icon={<Save className="h-4 w-4" />}
                      loading={profileSaving}
                      disabled={!profileDirty}
                    >
                      Save profile
                    </Button>
                  </div>
                </div>
              </form>

              <aside className="space-y-4">
                <div className="rounded-xl border border-line/70 bg-white/[0.03] p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <UserCog className="h-4 w-4 text-neutral-300" />
                    <h3 className="text-sm font-semibold text-neutral-100">Account record</h3>
                  </div>
                  <KeyValue
                    columns={1}
                    items={[
                      { label: "Account ID", value: user.id, mono: true },
                      { label: "Created", value: formatDateTime(user.created_at) },
                      { label: "Last updated", value: formatDateTime(user.updated_at) },
                      {
                        label: "Last sign-in",
                        value: user.last_login_at
                          ? formatDateTime(user.last_login_at)
                          : "Never",
                      },
                    ]}
                  />
                </div>

                <div className="rounded-xl border border-line/70 bg-white/[0.03] p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <BadgeCheck className="h-4 w-4 text-neutral-300" />
                    <h3 className="text-sm font-semibold text-neutral-100">
                      {role.label} role
                    </h3>
                  </div>
                  <p className="text-xs leading-relaxed text-neutral-500">
                    {role.description}
                  </p>
                  <button
                    type="button"
                    onClick={() => setTab("permissions")}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-300 transition hover:text-neutral-200"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    View {permissions.length} permissions
                  </button>
                </div>
              </aside>
            </div>
          ) : null}

          {tab === "security" ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <form onSubmit={changePassword} className="space-y-4 lg:col-span-2">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-white/[0.05] text-neutral-300">
                    <LockKeyhole className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-100">Change password</h3>
                    <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">
                      Changing your password revokes every refresh token, including this
                      browser. You will be asked to sign in again.
                    </p>
                  </div>
                </div>

                {passwordError ? (
                  <Alert tone="danger" title="Could not change password">
                    {passwordError}
                  </Alert>
                ) : null}

                <Alert tone="warning" title="You will be signed out">
                  The backend invalidates all active sessions immediately after the password
                  is changed. Make sure you can sign in with the new password before
                  continuing.
                </Alert>

                <div className="space-y-4">
                  <Field label="Current password" required error={passwordErrors.current_password}>
                    <div className="relative">
                      <Input
                        type={showCurrent ? "text" : "password"}
                        value={password.current_password}
                        onChange={(event) => {
                          setPassword((current) => ({
                            ...current,
                            current_password: event.target.value,
                          }));
                          setPasswordErrors((current) => {
                            if (!current.current_password) return current;
                            const next = { ...current };
                            delete next.current_password;
                            return next;
                          });
                        }}
                        autoComplete="current-password"
                        className="mono pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrent((value) => !value)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-500 hover:text-neutral-200"
                        aria-label={showCurrent ? "Hide current password" : "Show current password"}
                      >
                        {showCurrent ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </Field>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field
                      label="New password"
                      required
                      error={passwordErrors.new_password}
                      hint="8–128 characters."
                    >
                      <div className="relative">
                        <Input
                          type={showNew ? "text" : "password"}
                          value={password.new_password}
                          onChange={(event) => {
                            setPassword((current) => ({
                              ...current,
                              new_password: event.target.value,
                            }));
                            setPasswordErrors((current) => {
                              if (!current.new_password) return current;
                              const next = { ...current };
                              delete next.new_password;
                              return next;
                            });
                          }}
                          autoComplete="new-password"
                          className="mono pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNew((value) => !value)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-500 hover:text-neutral-200"
                          aria-label={showNew ? "Hide new password" : "Show new password"}
                        >
                          {showNew ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </Field>
                    <Field label="Confirm new password" required error={passwordErrors.confirm}>
                      <Input
                        type={showNew ? "text" : "password"}
                        value={password.confirm}
                        onChange={(event) => {
                          setPassword((current) => ({
                            ...current,
                            confirm: event.target.value,
                          }));
                          setPasswordErrors((current) => {
                            if (!current.confirm) return current;
                            const next = { ...current };
                            delete next.confirm;
                            return next;
                          });
                        }}
                        autoComplete="new-password"
                        className="mono"
                      />
                    </Field>
                  </div>
                </div>

                <div className="flex justify-end border-t border-line/60 pt-4">
                  <Button
                    type="submit"
                    variant="danger"
                    icon={<KeyRound className="h-4 w-4" />}
                    loading={passwordSaving}
                  >
                    Change password
                  </Button>
                </div>
              </form>

              <aside className="space-y-4">
                <div className="rounded-xl border border-line/70 bg-white/[0.03] p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-neutral-300" />
                    <h3 className="text-sm font-semibold text-neutral-100">Session security</h3>
                  </div>
                  <ul className="space-y-2 text-xs leading-relaxed text-neutral-500">
                    <li>
                      Access tokens are short-lived; refresh tokens rotate on every use and
                      are stored hashed in PostgreSQL.
                    </li>
                    <li>
                      Signing out revokes the refresh token for this browser. Other sessions
                      remain active until they are revoked or expire.
                    </li>
                    <li>
                      Password changes revoke all sessions. Role changes are applied on the
                      next request.
                    </li>
                  </ul>
                </div>

                <div className="rounded-xl border border-line/70 bg-white/[0.03] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                    Active sessions
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-white">
                    {sessions.data ? sessions.data.length : "—"}
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    Refresh tokens that have not expired or been revoked.
                  </p>
                  <button
                    type="button"
                    onClick={() => setTab("sessions")}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-300 transition hover:text-neutral-200"
                  >
                    <MonitorSmartphone className="h-3.5 w-3.5" />
                    Manage sessions
                  </button>
                </div>
              </aside>
            </div>
          ) : null}

          {tab === "sessions" ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-white/[0.05] text-neutral-300">
                    <MonitorSmartphone className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-100">Active sessions</h3>
                    <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-neutral-500">
                      Each row is a refresh token issued by a successful sign-in. Revoking a
                      session prevents that browser from renewing its access token.
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                  onClick={sessions.refresh}
                  loading={sessions.refreshing}
                >
                  Refresh
                </Button>
              </div>

              {sessions.error && !sessions.data ? (
                <ErrorPanel
                  message={sessions.error.message}
                  onRetry={sessions.refresh}
                  title="Could not load sessions"
                />
              ) : (
                <div className="overflow-hidden rounded-xl border border-line/70">
                  <DataTable
                    columns={sessionColumns}
                    rows={sessionRows}
                    rowKey={(row) => row.id}
                    loading={sessions.loading}
                    empty={
                      <EmptyState
                        icon={<MonitorSmartphone className="h-6 w-6" />}
                        title="No active sessions"
                        description="Sign in again to create a refresh token for this browser."
                      />
                    }
                  />
                </div>
              )}

              <p className="text-[11px] leading-relaxed text-neutral-600">
                Revoking this browser's session does not invalidate the current access token
                immediately; it expires on its own schedule and cannot be refreshed
                afterwards.
              </p>
            </div>
          ) : null}

          {tab === "permissions" ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-white/[0.05] text-neutral-300">
                    <ShieldCheck className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-100">Granted permissions</h3>
                    <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-neutral-500">
                      Permissions are fixed by your role. They cannot be granted or revoked
                      per account; ask an administrator to change the role instead.
                    </p>
                  </div>
                </div>
                <Badge tone={role.tone} className="self-start">
                  {role.label} · {permissions.length} permissions
                </Badge>
              </div>

              {permissions.length === 0 ? (
                <EmptyState
                  icon={<ShieldCheck className="h-6 w-6" />}
                  title="No permissions"
                  description="This account has no permissions. Ask an administrator to assign a role."
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {permissionGroups.map((group) => (
                    <div
                      key={group.area}
                      className="rounded-xl border border-line/70 bg-white/[0.025] p-3.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-neutral-200">{group.label}</p>
                        <span className="text-[10px] text-neutral-600">
                          {group.actions.length} granted
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {group.actions.map((action) => (
                          <Badge key={action} tone={actionTone(action)}>
                            {group.area}.{action}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-xl border border-line/70 bg-white/[0.03] p-4">
                <div className="flex items-start gap-2 text-[11px] leading-relaxed text-neutral-500">
                  <Fingerprint className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-600" />
                  Permissions are evaluated by the API on every request. The dashboard hides
                  navigation and actions you cannot use, but the backend remains the
                  authority.
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => void revokeSession()}
        title="Revoke this session?"
        description={
          revokeTarget
            ? `${clientLabel(revokeTarget.user_agent)} from ${revokeTarget.ip || "an unknown address"} will lose its refresh token.${
                revokeTarget.id === currentSessionId
                  ? " This appears to be your current browser; you may need to sign in again once the access token expires."
                  : ""
              }`
            : undefined
        }
        confirmLabel="Revoke session"
        loading={revoking}
      />
    </div>
  );
}
