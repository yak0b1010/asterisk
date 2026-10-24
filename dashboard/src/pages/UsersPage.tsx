import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CalendarClock,
  CircleUserRound,
  Eye,
  KeyRound,
  Mail,
  Pencil,
  Phone,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useApiQuery } from "../hooks/useApiQuery";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useToast } from "../context/ToastContext";
import {
  apiDelete,
  apiPatch,
  apiPost,
  buildQuery,
  errorMessage,
} from "../lib/api";
import type { Extension, Role, User } from "../lib/types";
import {
  formatDateTime,
  formatRelative,
  initials,
  type Tone,
} from "../lib/format";
import { randomPassword } from "../lib/utils";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { Button, IconButton } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { CopyButton } from "../components/ui/CopyButton";
import { DataTable, type Column } from "../components/ui/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorPanel } from "../components/ErrorPanel";
import { Field, Input, Select, Toggle } from "../components/ui/Field";
import { KeyValue } from "../components/ui/KeyValue";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { Pagination } from "../components/ui/Pagination";
import { SearchInput } from "../components/ui/SearchInput";
import { StatCard } from "../components/ui/StatCard";

const LIMIT = 20;

const ROLES: Array<{
  value: Role;
  label: string;
  tone: Tone;
  description: string;
}> = [
  {
    value: "admin",
    label: "Administrator",
    tone: "accent",
    description: "Full access to every configuration area, user and backup.",
  },
  {
    value: "supervisor",
    label: "Supervisor",
    tone: "info",
    description:
      "Manages telephony, users directory, backups and audit; cannot administer accounts.",
  },
  {
    value: "agent",
    label: "Agent",
    tone: "success",
    description:
      "Reads telephony configuration, manages voicemail and views call records.",
  },
  {
    value: "viewer",
    label: "Viewer",
    tone: "neutral",
    description:
      "Read-only access to dashboards, configuration, call records and audit.",
  },
];

const ROLE_TONES: Record<Role, Tone> = {
  admin: "accent",
  supervisor: "info",
  agent: "success",
  viewer: "neutral",
};

interface UserForm {
  username: string;
  email: string;
  full_name: string;
  password: string;
  role: Role;
  active: boolean;
}

const EMPTY_FORM: UserForm = {
  username: "",
  email: "",
  full_name: "",
  password: "",
  role: "agent",
  active: true,
};

function roleLabel(role: Role): string {
  return ROLES.find((item) => item.value === role)?.label ?? role;
}

export default function UsersPage() {
  useDocumentTitle("Users");
  const { can, user: currentUser } = useAuth();
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const debouncedSearch = useDebouncedValue(search);

  const list = useApiQuery<User[]>(
    `/api/v1/users${buildQuery({
      page,
      limit: LIMIT,
      search: debouncedSearch,
      role: roleFilter,
      active: activeFilter,
    })}`,
  );
  const summary = useApiQuery<User[]>("/api/v1/users?limit=200");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<UserForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetForm, setResetForm] = useState({ password: "", confirm: "" });
  const [resetError, setResetError] = useState("");
  const [resetShow, setResetShow] = useState(false);
  const [resetting, setResetting] = useState(false);

  const [detailTarget, setDetailTarget] = useState<User | null>(null);
  const detailExtensions = useApiQuery<Extension[]>(
    detailTarget ? `/api/v1/users/${detailTarget.id}/extensions` : null,
  );

  useEffect(() => {
    if (page > 1 && list.meta && page > list.meta.pages && list.meta.pages > 0) {
      setPage(list.meta.pages);
    }
  }, [list.meta, page]);

  const summaryUsers = summary.data ?? [];
  const totalUsers = summary.meta?.total ?? summaryUsers.length;
  const activeUsers = summaryUsers.filter((user) => user.active).length;
  const adminUsers = summaryUsers.filter((user) => user.role === "admin").length;
  const recentLogins = summaryUsers.filter((user) => {
    if (!user.last_login_at) return false;
    return Date.now() - new Date(user.last_login_at).getTime() < 7 * 86400000;
  }).length;

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const user of summaryUsers) {
      counts[user.role] = (counts[user.role] ?? 0) + 1;
    }
    return counts;
  }, [summaryUsers]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setFieldErrors({});
    setShowPassword(false);
    setFormOpen(true);
  };

  const openEdit = (user: User) => {
    setEditing(user);
    setForm({
      username: user.username,
      email: user.email,
      full_name: user.full_name,
      password: "",
      role: user.role,
      active: user.active,
    });
    setFormError("");
    setFieldErrors({});
    setShowPassword(false);
    setFormOpen(true);
  };

  const update = <K extends keyof UserForm>(key: K, value: UserForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    if (!editing) {
      if (!/^[A-Za-z0-9._-]{3,40}$/.test(form.username.trim())) {
        errors.username =
          "3–40 characters; letters, digits, dot, underscore or hyphen only.";
      }
      if (form.password.length < 8 || form.password.length > 128) {
        errors.password = "Use 8–128 characters.";
      }
    }
    if (!/^[^@\s]+@[^@\s]+$/.test(form.email.trim())) {
      errors.email = "Enter a valid email address.";
    }
    if (form.full_name.trim().length > 120) {
      errors.full_name = "Maximum 120 characters.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate()) return;
    setSaving(true);
    setFormError("");
    try {
      if (editing) {
        await apiPatch<User>(`/api/v1/users/${editing.id}`, {
          email: form.email.trim(),
          full_name: form.full_name.trim(),
          role: form.role,
          active: form.active,
        });
        toast.success("User updated", `${editing.username} was saved.`);
      } else {
        await apiPost<User>("/api/v1/users", {
          username: form.username.trim(),
          email: form.email.trim(),
          full_name: form.full_name.trim(),
          password: form.password,
          role: form.role,
          active: form.active,
        });
        toast.success("User created", `${form.username.trim()} can now sign in.`);
      }
      setFormOpen(false);
      list.refresh();
      summary.refresh();
    } catch (caught) {
      setFormError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/v1/users/${deleteTarget.id}`);
      toast.success("User deleted", `${deleteTarget.username} was removed.`);
      setDeleteTarget(null);
      list.refresh();
      summary.refresh();
    } catch (caught) {
      toast.error("Could not delete user", errorMessage(caught));
    } finally {
      setDeleting(false);
    }
  };

  const openReset = (user: User) => {
    setResetTarget(user);
    setResetForm({ password: "", confirm: "" });
    setResetError("");
    setResetShow(false);
  };

  const resetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resetTarget) return;
    if (resetForm.password.length < 8 || resetForm.password.length > 128) {
      setResetError("Use a password between 8 and 128 characters.");
      return;
    }
    if (resetForm.password !== resetForm.confirm) {
      setResetError("The passwords do not match.");
      return;
    }
    setResetting(true);
    setResetError("");
    try {
      await apiPost(`/api/v1/users/${resetTarget.id}/password`, {
        new_password: resetForm.password,
      });
      toast.success(
        "Password reset",
        `${resetTarget.username}'s existing sessions were revoked.`,
      );
      setResetTarget(null);
    } catch (caught) {
      setResetError(errorMessage(caught));
    } finally {
      setResetting(false);
    }
  };

  const columns: Column<User>[] = [
    {
      key: "user",
      header: "User",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-500/25 bg-neutral-500/10 text-[11px] font-bold text-neutral-300">
            {initials(row.full_name || row.username)}
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-neutral-100">
              <span className="truncate">{row.full_name || row.username}</span>
              {row.id === currentUser?.id ? (
                <span className="rounded bg-white/[0.07] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-neutral-400">
                  You
                </span>
              ) : null}
            </p>
            <p className="mono truncate text-[11px] text-neutral-500">@{row.username}</p>
          </div>
        </div>
      ),
    },
    {
      key: "email",
      header: "Email",
      render: (row) => (
        <span className="inline-flex max-w-[240px] items-center gap-1.5 text-xs text-neutral-400">
          <Mail className="h-3 w-3 shrink-0 text-neutral-600" />
          <span className="truncate">{row.email || "—"}</span>
        </span>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (row) => <Badge tone={ROLE_TONES[row.role]}>{roleLabel(row.role)}</Badge>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge tone={row.active ? "success" : "neutral"} dot>
          {row.active ? "Active" : "Disabled"}
        </Badge>
      ),
    },
    {
      key: "last_login",
      header: "Last sign-in",
      render: (row) => (
        <div>
          <p className="text-xs text-neutral-300">
            {row.last_login_at ? formatRelative(row.last_login_at) : "Never"}
          </p>
          <p className="text-[10px] text-neutral-600">
            {row.last_login_at ? formatDateTime(row.last_login_at) : "No session yet"}
          </p>
        </div>
      ),
    },
    {
      key: "created",
      header: "Created",
      render: (row) => (
        <span className="whitespace-nowrap text-xs text-neutral-500">
          {formatDateTime(row.created_at)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-0.5">
          <IconButton label="View user" onClick={() => setDetailTarget(row)}>
            <Eye className="h-3.5 w-3.5" />
          </IconButton>
          {can("users.write") ? (
            <>
              <IconButton label="Reset password" onClick={() => openReset(row)}>
                <KeyRound className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton label="Edit user" onClick={() => openEdit(row)}>
                <Pencil className="h-3.5 w-3.5" />
              </IconButton>
              {row.id !== currentUser?.id ? (
                <IconButton
                  label="Delete user"
                  className="hover:bg-neutral-500/10 hover:text-neutral-300"
                  onClick={() => setDeleteTarget(row)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              ) : null}
            </>
          ) : null}
        </div>
      ),
    },
  ];

  const meta = list.meta;
  const editingSelf = Boolean(editing && editing.id === currentUser?.id);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="System"
        title="Users &amp; roles"
        description="Accounts, role assignments and password controls for the control center."
        actions={
          <>
            <Button
              variant="secondary"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={() => {
                list.refresh();
                summary.refresh();
              }}
            >
              Refresh
            </Button>
            {can("users.write") ? (
              <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={openCreate}>
                New user
              </Button>
            ) : null}
          </>
        }
      />

      <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Accounts"
          value={totalUsers}
          sub="Users with access to the control center"
          icon={<UsersRound className="h-4.5 w-4.5" />}
          tone="accent"
        />
        <StatCard
          label="Active"
          value={activeUsers}
          sub={`${Math.max(0, summaryUsers.length - activeUsers)} disabled in the latest directory`}
          icon={<UserCheck className="h-4.5 w-4.5" />}
          tone="success"
        />
        <StatCard
          label="Administrators"
          value={adminUsers}
          sub="Full control plane access"
          icon={<ShieldCheck className="h-4.5 w-4.5" />}
          tone={adminUsers === 1 ? "warning" : "info"}
        />
        <StatCard
          label="Recent sign-ins"
          value={recentLogins}
          sub="Accounts active in the last 7 days"
          icon={<CalendarClock className="h-4.5 w-4.5" />}
          tone="neutral"
        />
      </div>

      <Card>
        <div className="flex flex-col gap-2 border-b border-line/70 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              placeholder="Search username, name or email…"
              className="sm:w-72"
            />
            <Select
              value={roleFilter}
              onChange={(event) => {
                setRoleFilter(event.target.value);
                setPage(1);
              }}
              className="h-9.5 sm:w-44"
              aria-label="Filter by role"
            >
              <option value="">All roles</option>
              {ROLES.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label} ({roleCounts[role.value] ?? 0})
                </option>
              ))}
            </Select>
            <Select
              value={activeFilter}
              onChange={(event) => {
                setActiveFilter(event.target.value);
                setPage(1);
              }}
              className="h-9.5 sm:w-36"
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              <option value="true">Active</option>
              <option value="false">Disabled</option>
            </Select>
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={list.refresh}
          >
            Refresh
          </Button>
        </div>

        {list.error && !list.data ? (
          <ErrorPanel message={list.error.message} onRetry={list.refresh} />
        ) : (
          <DataTable
            columns={columns}
            rows={list.data ?? []}
            rowKey={(row) => row.id}
            loading={list.loading}
            empty={
              <EmptyState
                icon={<UsersRound className="h-6 w-6" />}
                title={search || roleFilter || activeFilter ? "No matching users" : "No users yet"}
                description={
                  search || roleFilter || activeFilter
                    ? "Try a different search or clear the filters."
                    : "Create the first account to let an administrator sign in."
                }
                action={
                  can("users.write") && !search && !roleFilter && !activeFilter ? (
                    <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={openCreate}>
                      New user
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        )}

        {meta ? (
          <Pagination
            page={meta.page}
            pages={meta.pages}
            total={meta.total}
            limit={meta.limit}
            onPageChange={setPage}
          />
        ) : null}
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit ${editing.username}` : "New user"}
        description={
          editing
            ? "Profile, role and account status. Passwords are reset separately."
            : "The account can sign in immediately with the password you set."
        }
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="user-form"
              variant="primary"
              loading={saving}
              icon={!saving ? <ShieldCheck className="h-4 w-4" /> : undefined}
            >
              {editing ? "Save changes" : "Create user"}
            </Button>
          </>
        }
      >
        <form id="user-form" onSubmit={submit} className="space-y-4">
          {formError ? (
            <Alert tone="danger" title="Could not save user">
              {formError}
            </Alert>
          ) : null}

          {editingSelf ? (
            <Alert tone="info" title="You are editing your own account">
              Your role and account status are locked here to prevent locking yourself out.
              Use another administrator account to change them.
            </Alert>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Username"
              required={!editing}
              error={fieldErrors.username}
              hint={editing ? "Usernames cannot be changed." : "3–40 characters."}
            >
              <Input
                value={form.username}
                onChange={(event) => update("username", event.target.value)}
                placeholder="jane.doe"
                disabled={Boolean(editing)}
                autoComplete="off"
                className="mono"
              />
            </Field>
            <Field label="Email" required error={fieldErrors.email}>
              <Input
                type="email"
                value={form.email}
                onChange={(event) => update("email", event.target.value)}
                placeholder="jane@example.com"
                autoComplete="off"
              />
            </Field>
            <Field label="Full name" error={fieldErrors.full_name}>
              <Input
                value={form.full_name}
                onChange={(event) => update("full_name", event.target.value)}
                placeholder="Jane Doe"
                autoComplete="off"
              />
            </Field>
            <Field
              label="Role"
              required
              hint={ROLES.find((role) => role.value === form.role)?.description}
            >
              <Select
                value={form.role}
                onChange={(event) => update("role", event.target.value as Role)}
                disabled={editingSelf}
              >
                {ROLES.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {!editing ? (
            <Field
              label="Initial password"
              required
              error={fieldErrors.password}
              hint="8–128 characters. Share it securely and ask the user to change it."
            >
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(event) => update("password", event.target.value)}
                    placeholder="Minimum 8 characters"
                    autoComplete="new-password"
                    className="mono pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-500 hover:text-neutral-200"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    update("password", randomPassword(16));
                    setShowPassword(true);
                  }}
                >
                  Generate
                </Button>
              </div>
            </Field>
          ) : null}

          <Toggle
            checked={form.active}
            onChange={(value) => update("active", value)}
            label="Account active"
            description="Disabled accounts cannot sign in and existing sessions are revoked."
            disabled={editingSelf}
          />

          <div className="rounded-lg border border-line/60 bg-white/[0.03] p-3">
            <div className="flex items-start gap-2 text-[11px] leading-relaxed text-neutral-500">
              <CircleUserRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-600" />
              Role permissions are fixed by the backend. Individual permissions cannot be
              granted or revoked per user.
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(resetTarget)}
        onClose={() => setResetTarget(null)}
        title={resetTarget ? `Reset password for ${resetTarget.username}` : "Reset password"}
        description="All existing sessions for this user will be revoked immediately."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetTarget(null)} disabled={resetting}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="reset-password-form"
              variant="danger"
              loading={resetting}
            >
              Reset password
            </Button>
          </>
        }
      >
        <form id="reset-password-form" onSubmit={resetPassword} className="space-y-4">
          {resetError ? (
            <Alert tone="danger" title="Could not reset password">
              {resetError}
            </Alert>
          ) : null}

          <Field
            label="New password"
            required
            hint="8–128 characters. The user will need this to sign in again."
          >
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Input
                  type={resetShow ? "text" : "password"}
                  value={resetForm.password}
                  onChange={(event) =>
                    setResetForm((current) => ({ ...current, password: event.target.value }))
                  }
                  autoComplete="new-password"
                  className="mono pr-10"
                  placeholder="Minimum 8 characters"
                />
                <button
                  type="button"
                  onClick={() => setResetShow((value) => !value)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-500 hover:text-neutral-200"
                  aria-label={resetShow ? "Hide password" : "Show password"}
                >
                  <KeyRound className="h-3.5 w-3.5" />
                </button>
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  setResetForm((current) => ({
                    ...current,
                    password: randomPassword(16),
                    confirm: "",
                  }));
                  setResetShow(true);
                }}
              >
                Generate
              </Button>
            </div>
          </Field>

          <Field label="Confirm password" required>
            <Input
              type={resetShow ? "text" : "password"}
              value={resetForm.confirm}
              onChange={(event) =>
                setResetForm((current) => ({ ...current, confirm: event.target.value }))
              }
              autoComplete="new-password"
              className="mono"
              placeholder="Repeat the password"
            />
          </Field>

          {resetForm.password ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-line/60 bg-white/[0.035] px-3 py-2">
              <span className="mono break-all text-xs text-neutral-200">
                {resetForm.password}
              </span>
              <CopyButton value={resetForm.password} iconOnly label="Copy new password" />
            </div>
          ) : null}
        </form>
      </Modal>

      <Modal
        open={Boolean(detailTarget)}
        onClose={() => setDetailTarget(null)}
        title={detailTarget ? detailTarget.full_name || detailTarget.username : "User"}
        description={detailTarget ? `@${detailTarget.username}` : undefined}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDetailTarget(null)}>
              Close
            </Button>
            {detailTarget && can("users.write") ? (
              <Button
                variant="primary"
                icon={<Pencil className="h-4 w-4" />}
                onClick={() => {
                  const target = detailTarget;
                  setDetailTarget(null);
                  openEdit(target);
                }}
              >
                Edit user
              </Button>
            ) : null}
          </>
        }
      >
        {detailTarget ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={ROLE_TONES[detailTarget.role]}>
                {roleLabel(detailTarget.role)}
              </Badge>
              <Badge tone={detailTarget.active ? "success" : "neutral"} dot>
                {detailTarget.active ? "Active" : "Disabled"}
              </Badge>
              {detailTarget.id === currentUser?.id ? <Badge tone="info">This is you</Badge> : null}
            </div>

            <KeyValue
              columns={2}
              items={[
                { label: "Username", value: detailTarget.username, mono: true },
                { label: "Email", value: detailTarget.email || "—" },
                { label: "Full name", value: detailTarget.full_name || "—" },
                { label: "Role", value: roleLabel(detailTarget.role) },
                { label: "Created", value: formatDateTime(detailTarget.created_at) },
                { label: "Updated", value: formatDateTime(detailTarget.updated_at) },
                {
                  label: "Last sign-in",
                  value: detailTarget.last_login_at
                    ? formatDateTime(detailTarget.last_login_at)
                    : "Never",
                },
                { label: "User ID", value: detailTarget.id, mono: true },
              ]}
            />

            <div>
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-neutral-200">
                <Phone className="h-3.5 w-3.5 text-neutral-500" />
                Assigned extensions
              </p>
              {detailExtensions.error && !detailExtensions.data ? (
                <ErrorPanel
                  message={detailExtensions.error.message}
                  onRetry={detailExtensions.refresh}
                />
              ) : (
                <div className="overflow-hidden rounded-xl border border-line/70">
                  <DataTable
                    columns={[
                      {
                        key: "number",
                        header: "Extension",
                        render: (row: Extension) => (
                          <span className="mono text-xs font-semibold text-neutral-200">
                            {row.number}
                          </span>
                        ),
                      },
                      {
                        key: "name",
                        header: "Display name",
                        render: (row: Extension) => (
                          <span className="text-xs text-neutral-400">
                            {row.display_name || "—"}
                          </span>
                        ),
                      },
                      {
                        key: "context",
                        header: "Context",
                        render: (row: Extension) => (
                          <span className="mono text-xs text-neutral-400">{row.context}</span>
                        ),
                      },
                      {
                        key: "voicemail",
                        header: "Voicemail",
                        render: (row: Extension) =>
                          row.voicemail_enabled ? (
                            <Badge tone="accent">Enabled</Badge>
                          ) : (
                            <span className="text-xs text-neutral-600">—</span>
                          ),
                      },
                      {
                        key: "status",
                        header: "Status",
                        render: (row: Extension) => (
                          <Badge tone={row.enabled ? "success" : "neutral"} dot>
                            {row.enabled ? "Enabled" : "Disabled"}
                          </Badge>
                        ),
                      },
                    ]}
                    rows={detailExtensions.data ?? []}
                    rowKey={(row) => row.id}
                    loading={detailExtensions.loading}
                    dense
                    empty={
                      <EmptyState
                        icon={<Phone className="h-6 w-6" />}
                        title="No extensions assigned"
                        description="Assign extensions to this user from the Extensions page."
                      />
                    }
                  />
                </div>
              )}
            </div>

            <p className="text-[11px] leading-relaxed text-neutral-600">
              {ROLES.find((role) => role.value === detailTarget.role)?.description}
            </p>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
        title={`Delete ${deleteTarget?.username ?? "user"}?`}
        description="The account, its sessions and extension assignments will be removed. Extensions remain configured but become unassigned."
        confirmLabel="Delete user"
        loading={deleting}
        requireText={deleteTarget?.username}
      />
    </div>
  );
}
