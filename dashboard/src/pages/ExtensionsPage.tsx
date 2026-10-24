import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  KeyRound,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  Wifi,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useApiQuery } from "../hooks/useApiQuery";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useInterval } from "../hooks/useInterval";
import { useToast } from "../context/ToastContext";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  buildQuery,
  errorMessage,
} from "../lib/api";
import type {
  Extension,
  ExtensionCredentials,
  ExtensionStatuses,
  User,
} from "../lib/types";
import { statusTone, titleCase } from "../lib/format";
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
import { Tabs } from "../components/ui/Tabs";

const LIMIT = 20;

interface Registration {
  endpoint: string;
  aor: string;
  contact: string;
  status: string;
  user_agent: string;
  reg_expire: string;
}

interface RegistrationsResponse {
  configured: boolean;
  registrations: Registration[];
}

interface ContextRow {
  context: string;
  count: number;
}

interface ReloadResult {
  reloaded: boolean;
  component: string;
  configured: boolean;
  message?: string;
}

interface ExtensionForm {
  number: string;
  display_name: string;
  context: string;
  codecs: string;
  caller_id: string;
  sip_password: string;
  voicemail_enabled: boolean;
  voicemail_pin: string;
  enabled: boolean;
  description: string;
  user_id: string;
}

const EMPTY_FORM: ExtensionForm = {
  number: "",
  display_name: "",
  context: "internal",
  codecs: "ulaw,alaw,opus,g722",
  caller_id: "",
  sip_password: "",
  voicemail_enabled: false,
  voicemail_pin: "",
  enabled: true,
  description: "",
  user_id: "",
};

export default function ExtensionsPage() {
  useDocumentTitle("Extensions");
  const { can } = useAuth();
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [context, setContext] = useState("");
  const [enabledFilter, setEnabledFilter] = useState("");
  const [tab, setTab] = useState("directory");
  const debouncedSearch = useDebouncedValue(search);

  const path = `/api/v1/extensions${buildQuery({
    page,
    limit: LIMIT,
    search: debouncedSearch,
    context,
    enabled: enabledFilter,
  })}`;
  const list = useApiQuery<Extension[]>(path);
  const statuses = useApiQuery<ExtensionStatuses>("/api/v1/extensions/status");
  const registrations = useApiQuery<RegistrationsResponse>(
    tab === "registrations" ? "/api/v1/extensions/registrations" : null,
  );
  const users = useApiQuery<User[]>(
    can("users.read") ? "/api/v1/users?limit=200" : null,
  );
  const contexts = useApiQuery<ContextRow[]>(
    can("dialplan.read") ? "/api/v1/dialplan/contexts" : null,
  );

  useInterval(() => statuses.refresh(), 15000);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Extension | null>(null);
  const [form, setForm] = useState<ExtensionForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Extension | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reloading, setReloading] = useState<string | null>(null);

  const [credentials, setCredentials] = useState<ExtensionCredentials | null>(null);
  const [credentialsOpen, setCredentialsOpen] = useState(false);

  const userMap = useMemo(() => {
    const map = new Map<string, User>();
    for (const user of users.data ?? []) map.set(user.id, user);
    return map;
  }, [users.data]);

  const liveMap = useMemo(() => {
    const map = new Map<string, ExtensionStatuses["endpoints"][number]>();
    for (const entry of statuses.data?.endpoints ?? []) map.set(entry.extension, entry);
    return map;
  }, [statuses.data]);

  useEffect(() => {
    if (page > 1 && list.meta && page > list.meta.pages && list.meta.pages > 0) {
      setPage(list.meta.pages);
    }
  }, [list.meta, page]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError("");
    setShowPassword(false);
    setFormOpen(true);
  };

  const openEdit = (extension: Extension) => {
    setEditing(extension);
    setForm({
      number: extension.number,
      display_name: extension.display_name,
      context: extension.context,
      codecs: extension.codecs,
      caller_id: extension.caller_id ?? "",
      sip_password: "",
      voicemail_enabled: extension.voicemail_enabled,
      voicemail_pin: extension.voicemail_pin ?? "",
      enabled: extension.enabled,
      description: extension.description ?? "",
      user_id: extension.user_id ?? "",
    });
    setFieldErrors({});
    setFormError("");
    setShowPassword(false);
    setFormOpen(true);
  };

  const update = <K extends keyof ExtensionForm>(key: K, value: ExtensionForm[K]) => {
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
    if (!/^\d{2,10}$/.test(form.number.trim())) {
      errors.number = "Enter 2–10 digits.";
    }
    if (!form.context.trim()) errors.context = "Context is required.";
    if (!form.codecs.trim()) errors.codecs = "At least one codec is required.";
    if (form.sip_password && (form.sip_password.length < 8 || form.sip_password.length > 128)) {
      errors.sip_password = "Use 8–128 characters.";
    }
    if (form.voicemail_enabled) {
      const needsPin =
        form.voicemail_pin.trim() !== "" ||
        !editing ||
        !editing.voicemail_enabled ||
        !editing.voicemail_pin;
      if (needsPin && !/^\d{4,8}$/.test(form.voicemail_pin.trim())) {
        errors.voicemail_pin = "Enter a 4–8 digit PIN to enable voicemail.";
      }
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
      const payload: Record<string, unknown> = {
        display_name: form.display_name.trim(),
        context: form.context.trim(),
        codecs: form.codecs.trim(),
        caller_id: form.caller_id.trim(),
        voicemail_enabled: form.voicemail_enabled,
        enabled: form.enabled,
        description: form.description.trim(),
        user_id: form.user_id,
      };
      if (form.sip_password.trim()) payload.sip_password = form.sip_password.trim();
      if (form.voicemail_enabled) {
        if (form.voicemail_pin.trim()) payload.voicemail_pin = form.voicemail_pin.trim();
      } else {
        payload.voicemail_pin = "";
      }

      if (editing) {
        await apiPatch<Extension>(`/api/v1/extensions/${editing.id}`, payload);
        toast.success("Extension updated", `Extension ${editing.number} was saved.`);
      } else {
        payload.number = form.number.trim();
        await apiPost<Extension>("/api/v1/extensions", payload);
        toast.success("Extension created", `Extension ${form.number.trim()} was added.`);
      }
      setFormOpen(false);
      list.refresh();
      statuses.refresh();
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
      await apiDelete(`/api/v1/extensions/${deleteTarget.id}`);
      toast.success("Extension deleted", `${deleteTarget.number} was removed.`);
      setDeleteTarget(null);
      list.refresh();
      statuses.refresh();
    } catch (caught) {
      toast.error("Could not delete extension", errorMessage(caught));
    } finally {
      setDeleting(false);
    }
  };

  const reload = async (extension: Extension) => {
    setReloading(extension.id);
    try {
      const result = await apiPost<ReloadResult>(
        `/api/v1/extensions/${extension.id}/reload`,
      );
      if (result.configured) {
        toast.success("Reload requested", `Asterisk is reloading PJSIP for ${extension.number}.`);
      } else {
        toast.info("Stored in PostgreSQL only", result.message ?? "Asterisk is not configured.");
      }
    } catch (caught) {
      toast.error("Reload failed", errorMessage(caught));
    } finally {
      setReloading(null);
    }
  };

  const showCredentials = async (extension: Extension) => {
    try {
      const data = await apiGet<ExtensionCredentials>(
        `/api/v1/extensions/${extension.id}/credentials`,
      );
      setCredentials(data);
      setCredentialsOpen(true);
    } catch (caught) {
      toast.error("Could not load credentials", errorMessage(caught));
    }
  };

  const columns: Column<Extension>[] = [
    {
      key: "extension",
      header: "Extension",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-white/[0.04] text-neutral-300">
            <Phone className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="mono text-sm font-semibold text-neutral-100">{row.number}</p>
            <p className="truncate text-[11px] text-neutral-500">
              {row.display_name || "No display name"}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "context",
      header: "Context",
      render: (row) => <span className="mono text-xs text-neutral-400">{row.context}</span>,
    },
    {
      key: "codecs",
      header: "Codecs",
      render: (row) => (
        <div className="flex max-w-[220px] flex-wrap gap-1">
          {row.codecs.split(",").slice(0, 3).map((codec) => (
            <span
              key={codec}
              className="rounded border border-line/70 bg-white/[0.035] px-1.5 py-0.5 text-[10px] text-neutral-400"
            >
              {codec}
            </span>
          ))}
          {row.codecs.split(",").length > 3 ? (
            <span className="text-[10px] text-neutral-600">
              +{row.codecs.split(",").length - 3}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "voicemail",
      header: "Voicemail",
      render: (row) =>
        row.voicemail_enabled ? (
          <Badge tone="accent">Enabled</Badge>
        ) : (
          <span className="text-xs text-neutral-600">—</span>
        ),
    },
    {
      key: "user",
      header: "Assigned to",
      render: (row) => {
        const user = row.user_id ? userMap.get(row.user_id) : undefined;
        return user ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-neutral-300">
            <UserRound className="h-3 w-3 text-neutral-500" />
            {user.full_name || user.username}
          </span>
        ) : (
          <span className="text-xs text-neutral-600">Unassigned</span>
        );
      },
    },
    {
      key: "live",
      header: "Live state",
      render: (row) => {
        const live = liveMap.get(row.number);
        if (!statuses.data?.configured) {
          return (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-neutral-600">
              <Wifi className="h-3 w-3" /> PBX off
            </span>
          );
        }
        return (
          <Badge tone={statusTone(live?.state ?? "unknown")}>
            {titleCase(live?.state || "unknown")}
          </Badge>
        );
      },
    },
    {
      key: "enabled",
      header: "Status",
      render: (row) => (
        <Badge tone={row.enabled ? "success" : "neutral"} dot>
          {row.enabled ? "Enabled" : "Disabled"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-0.5">
          {can("extensions.credentials") ? (
            <IconButton label="Show credentials" onClick={() => void showCredentials(row)}>
              <KeyRound className="h-3.5 w-3.5" />
            </IconButton>
          ) : null}
          {can("extensions.write") ? (
            <>
              <IconButton label="Reload PJSIP" onClick={() => void reload(row)}>
                <RotateCw
                  className={
                    reloading === row.id ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"
                  }
                />
              </IconButton>
              <IconButton label="Edit extension" onClick={() => openEdit(row)}>
                <Pencil className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                label="Delete extension"
                className="hover:bg-neutral-500/10 hover:text-neutral-300"
                onClick={() => setDeleteTarget(row)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </IconButton>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  const registrationColumns: Column<Registration>[] = [
    {
      key: "endpoint",
      header: "Endpoint",
      render: (row) => <span className="mono text-xs text-neutral-200">{row.endpoint || "—"}</span>,
    },
    {
      key: "aor",
      header: "AOR",
      render: (row) => <span className="mono text-xs text-neutral-400">{row.aor || "—"}</span>,
    },
    {
      key: "contact",
      header: "Contact",
      render: (row) => (
        <span className="mono block max-w-[320px] truncate text-xs text-neutral-400" title={row.contact}>
          {row.contact || "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge tone={statusTone(row.status)}>{row.status || "Unknown"}</Badge>,
    },
    {
      key: "user_agent",
      header: "User agent",
      render: (row) => (
        <span className="block max-w-[220px] truncate text-xs text-neutral-500" title={row.user_agent}>
          {row.user_agent || "—"}
        </span>
      ),
    },
    {
      key: "reg_expire",
      header: "Expires",
      render: (row) => <span className="text-xs text-neutral-500">{row.reg_expire || "—"}</span>,
    },
  ];

  const meta = list.meta;
  const contextsList = contexts.data ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Telephony"
        title="Extensions"
        description="SIP endpoints backed by PJSIP realtime, with optional voicemail and user assignment."
        actions={
          <>
            <Button
              variant="secondary"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={() => {
                list.refresh();
                statuses.refresh();
              }}
            >
              Refresh
            </Button>
            {can("extensions.write") ? (
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                New extension
              </Button>
            ) : null}
          </>
        }
      />

      {!statuses.data?.configured && !statuses.loading ? (
        <Alert tone="info" title="Live endpoint state is unavailable">
          Asterisk AMI/ARI is not configured. Extensions are still fully managed in
          PostgreSQL and mirrored to realtime tables; registration state will populate when
          the PBX is connected.
        </Alert>
      ) : null}

      <Card>
        <div className="flex flex-col gap-3 border-b border-line/70 p-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            items={[
              { id: "directory", label: "Directory", count: meta?.total },
              {
                id: "registrations",
                label: "Registrations",
                count: registrations.data?.registrations.length,
              },
            ]}
            active={tab}
            onChange={setTab}
            className="border-0 pb-0"
          />
          {tab === "directory" ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <SearchInput
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setPage(1);
                }}
                placeholder="Search number or name…"
                className="sm:w-64"
              />
              <Input
                value={context}
                onChange={(event) => {
                  setContext(event.target.value);
                  setPage(1);
                }}
                placeholder="Context"
                className="h-9.5 sm:w-36"
                list="extension-contexts"
              />
              <datalist id="extension-contexts">
                {contextsList.map((row) => (
                  <option key={row.context} value={row.context} />
                ))}
              </datalist>
              <Select
                value={enabledFilter}
                onChange={(event) => {
                  setEnabledFilter(event.target.value);
                  setPage(1);
                }}
                className="h-9.5 sm:w-36"
                aria-label="Filter by status"
              >
                <option value="">All statuses</option>
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </Select>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={registrations.refresh}
            >
              Refresh registrations
            </Button>
          )}
        </div>

        {tab === "directory" ? (
          <>
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
                    icon={<Phone className="h-6 w-6" />}
                    title={search || context || enabledFilter ? "No matching extensions" : "No extensions yet"}
                    description={
                      search || context || enabledFilter
                        ? "Try a different search or clear the filters."
                        : "Create the first SIP extension to start building the phone system."
                    }
                    action={
                      can("extensions.write") && !search && !context && !enabledFilter ? (
                        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                          New extension
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
          </>
        ) : registrations.error && !registrations.data ? (
          <ErrorPanel
            message={registrations.error.message}
            onRetry={registrations.refresh}
          />
        ) : (
          <DataTable
            columns={registrationColumns}
            rows={registrations.data?.registrations ?? []}
            rowKey={(row) => `${row.endpoint}-${row.aor}-${row.contact}`}
            loading={registrations.loading}
            dense
            empty={
              <EmptyState
                icon={<ShieldCheck className="h-6 w-6" />}
                title={
                  registrations.data?.configured
                    ? "No active registrations"
                    : "Asterisk is not configured"
                }
                description={
                  registrations.data?.configured
                    ? "Registered PJSIP endpoints will appear here."
                    : "Connect AMI to inspect PJSIP registrations from the PBX."
                }
              />
            }
          />
        )}
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit extension ${editing.number}` : "New extension"}
        description={
          editing
            ? "Changes are persisted in PostgreSQL and synced to the realtime table."
            : "The SIP password is generated automatically when left blank."
        }
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="extension-form"
              loading={saving}
              icon={!saving ? <ShieldCheck className="h-4 w-4" /> : undefined}
            >
              {editing ? "Save changes" : "Create extension"}
            </Button>
          </>
        }
      >
        <form id="extension-form" onSubmit={submit} className="space-y-4">
          {formError ? (
            <Alert tone="danger" title="Could not save extension">
              {formError}
            </Alert>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Extension number"
              required
              error={fieldErrors.number}
              hint={editing ? "The number cannot be changed after creation." : "2–10 digits."}
            >
              <Input
                value={form.number}
                onChange={(event) => update("number", event.target.value)}
                placeholder="1001"
                disabled={Boolean(editing)}
                className="mono"
                inputMode="numeric"
              />
            </Field>
            <Field label="Display name">
              <Input
                value={form.display_name}
                onChange={(event) => update("display_name", event.target.value)}
                placeholder="Reception desk"
              />
            </Field>
            <Field label="Context" required error={fieldErrors.context}>
              <Input
                value={form.context}
                onChange={(event) => update("context", event.target.value)}
                placeholder="internal"
                list="extension-form-contexts"
              />
              <datalist id="extension-form-contexts">
                {contextsList.map((row) => (
                  <option key={row.context} value={row.context} />
                ))}
              </datalist>
            </Field>
            <Field
              label="Codecs"
              required
              error={fieldErrors.codecs}
              hint="Comma-separated, ordered by preference."
            >
              <Input
                value={form.codecs}
                onChange={(event) => update("codecs", event.target.value)}
                placeholder="ulaw,alaw,opus,g722"
                className="mono"
              />
            </Field>
            <Field label="Caller ID">
              <Input
                value={form.caller_id}
                onChange={(event) => update("caller_id", event.target.value)}
                placeholder="Reception <1001>"
              />
            </Field>
            {can("users.read") ? (
              <Field label="Assigned user">
                <Select
                  value={form.user_id}
                  onChange={(event) => update("user_id", event.target.value)}
                >
                  <option value="">Unassigned</option>
                  {(users.data ?? []).map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.full_name || user.username} ({user.username})
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="SIP password"
              error={fieldErrors.sip_password}
              hint={
                editing
                  ? "Leave blank to keep the current password."
                  : "Leave blank to generate a secure password."
              }
            >
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={form.sip_password}
                    onChange={(event) => update("sip_password", event.target.value)}
                    placeholder={editing ? "•••••••• (unchanged)" : "Auto-generated"}
                    className="mono pr-9"
                    autoComplete="new-password"
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
                  size="md"
                  onClick={() => {
                    update("sip_password", randomPassword(16));
                    setShowPassword(true);
                  }}
                >
                  Generate
                </Button>
              </div>
            </Field>
            <Field label="Description">
              <Input
                value={form.description}
                onChange={(event) => update("description", event.target.value)}
                placeholder="Optional note"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Toggle
              checked={form.enabled}
              onChange={(value) => update("enabled", value)}
              label="Extension enabled"
              description="Disabled endpoints are excluded from live status checks."
            />
            <Toggle
              checked={form.voicemail_enabled}
              onChange={(value) => update("voicemail_enabled", value)}
              label="Voicemail enabled"
              description="Creates a matching voicemail box in the same context."
            />
          </div>

          {form.voicemail_enabled ? (
            <Field
              label="Voicemail PIN"
              error={fieldErrors.voicemail_pin}
              hint="4–8 digits. Required when enabling voicemail for the first time."
            >
              <Input
                value={form.voicemail_pin}
                onChange={(event) => update("voicemail_pin", event.target.value)}
                placeholder="1234"
                inputMode="numeric"
                className="mono sm:max-w-40"
              />
            </Field>
          ) : null}

          <div className="rounded-lg border border-line/60 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 text-[11px] text-neutral-500">
              <Users className="h-3.5 w-3.5" />
              Realtime mirroring keeps the PostgreSQL configuration and Asterisk
              <span className="mono">ps_endpoints</span> table in sync.
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        open={credentialsOpen}
        onClose={() => setCredentialsOpen(false)}
        title="Extension credentials"
        description="Handle these secrets carefully. Access is limited by the extensions.credentials permission."
        size="sm"
        footer={
          <Button variant="secondary" onClick={() => setCredentialsOpen(false)}>
            Close
          </Button>
        }
      >
        {credentials ? (
          <div className="space-y-4">
            <KeyValue
              columns={1}
              items={[
                {
                  label: "Extension",
                  value: <span className="mono text-base font-semibold">{credentials.number}</span>,
                },
                {
                  label: "SIP password",
                  mono: true,
                  value: (
                    <span className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white/[0.045] px-2.5 py-2">
                      <span className="break-all text-neutral-200">{credentials.sip_password}</span>
                      <CopyButton value={credentials.sip_password} iconOnly label="Copy SIP password" />
                    </span>
                  ),
                },
                {
                  label: "Voicemail PIN",
                  mono: true,
                  value: credentials.voicemail_pin ? (
                    <span className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white/[0.045] px-2.5 py-2">
                      <span className="text-neutral-200">{credentials.voicemail_pin}</span>
                      <CopyButton value={credentials.voicemail_pin} iconOnly label="Copy voicemail PIN" />
                    </span>
                  ) : (
                    <span className="text-neutral-500">Not configured</span>
                  ),
                },
              ]}
            />
            <p className="text-[11px] leading-relaxed text-neutral-600">
              Credentials are stored in PostgreSQL. Rotate the SIP password from the edit
              dialog if a device is lost or compromised.
            </p>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
        title={`Delete extension ${deleteTarget?.number ?? ""}?`}
        description="The endpoint, its voicemail box and realtime records will be removed."
        confirmLabel="Delete extension"
        loading={deleting}
        requireText={deleteTarget?.number}
      />
    </div>
  );
}
