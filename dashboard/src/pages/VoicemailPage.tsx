import { useEffect, useState, type FormEvent } from "react";
import {
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Trash2,
  Voicemail,
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
import type { VoicemailBox } from "../lib/types";
import { Badge } from "../components/ui/Badge";
import { Button, IconButton } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { DataTable, type Column } from "../components/ui/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorPanel } from "../components/ErrorPanel";
import { Alert } from "../components/ui/Alert";
import { Field, Input, Select, Toggle } from "../components/ui/Field";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { Pagination } from "../components/ui/Pagination";
import { SearchInput } from "../components/ui/SearchInput";

const LIMIT = 25;

interface ReloadResult {
  reloaded: boolean;
  component: string;
  configured: boolean;
  message?: string;
}

interface VoicemailForm {
  extension: string;
  context: string;
  name: string;
  email: string;
  pin: string;
  timezone: string;
  max_messages: string;
  active: boolean;
}

const EMPTY_FORM: VoicemailForm = {
  extension: "",
  context: "internal",
  name: "",
  email: "",
  pin: "",
  timezone: "",
  max_messages: "50",
  active: true,
};

export default function VoicemailPage() {
  useDocumentTitle("Voicemail");
  const { can } = useAuth();
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [context, setContext] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const debouncedSearch = useDebouncedValue(search);

  const list = useApiQuery<VoicemailBox[]>(
    `/api/v1/voicemail${buildQuery({
      page,
      limit: LIMIT,
      search: debouncedSearch,
      context,
      active: activeFilter,
    })}`,
  );

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<VoicemailBox | null>(null);
  const [form, setForm] = useState<VoicemailForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<VoicemailBox | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (page > 1 && list.meta && page > list.meta.pages && list.meta.pages > 0) {
      setPage(list.meta.pages);
    }
  }, [list.meta, page]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setFieldErrors({});
    setFormOpen(true);
  };

  const openEdit = (box: VoicemailBox) => {
    setEditing(box);
    setForm({
      extension: box.extension,
      context: box.context,
      name: box.name,
      email: box.email ?? "",
      pin: box.pin ?? "",
      timezone: box.timezone ?? "",
      max_messages: String(box.max_messages),
      active: box.active,
    });
    setFormError("");
    setFieldErrors({});
    setFormOpen(true);
  };

  const update = <K extends keyof VoicemailForm>(key: K, value: VoicemailForm[K]) => {
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
    if (!/^\d{2,10}$/.test(form.extension.trim())) {
      errors.extension = "Enter 2–10 digits.";
    }
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(form.context.trim())) {
      errors.context = "Context is invalid.";
    }
    if (!editing && !/^\d{4,8}$/.test(form.pin.trim())) {
      errors.pin = "A 4–8 digit PIN is required.";
    }
    if (editing && form.pin.trim() && !/^\d{4,8}$/.test(form.pin.trim())) {
      errors.pin = "Use 4–8 digits or leave blank to keep the current PIN.";
    }
    if (form.email.trim() && !/^[^@\s]+@[^@\s]+$/.test(form.email.trim())) {
      errors.email = "Enter a valid email address or leave blank.";
    }
    const max = Number(form.max_messages);
    if (!Number.isInteger(max) || max < 1 || max > 1000) {
      errors.max_messages = "Enter a number between 1 and 1000.";
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
        context: form.context.trim(),
        name: form.name.trim(),
        email: form.email.trim(),
        timezone: form.timezone.trim(),
        max_messages: Number(form.max_messages),
        active: form.active,
      };
      if (form.pin.trim()) payload.pin = form.pin.trim();
      if (editing) {
        await apiPatch<VoicemailBox>(`/api/v1/voicemail/${editing.id}`, payload);
        toast.success("Voicemail box updated");
      } else {
        payload.extension = form.extension.trim();
        await apiPost<VoicemailBox>("/api/v1/voicemail", payload);
        toast.success("Voicemail box created");
      }
      setFormOpen(false);
      list.refresh();
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
      await apiDelete(`/api/v1/voicemail/${deleteTarget.id}`);
      toast.success("Voicemail box deleted");
      setDeleteTarget(null);
      list.refresh();
    } catch (caught) {
      toast.error("Could not delete mailbox", errorMessage(caught));
    } finally {
      setDeleting(false);
    }
  };

  const reload = async () => {
    setReloading(true);
    try {
      const result = await apiPost<ReloadResult>("/api/v1/voicemail/reload");
      if (result.configured) {
        toast.success("Voicemail reload requested");
      } else {
        toast.info("Stored in PostgreSQL only", result.message ?? "Asterisk is not configured.");
      }
    } catch (caught) {
      toast.error("Reload failed", errorMessage(caught));
    } finally {
      setReloading(false);
    }
  };

  const columns: Column<VoicemailBox>[] = [
    {
      key: "extension",
      header: "Mailbox",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-white/[0.04] text-neutral-300">
            <Voicemail className="h-3.5 w-3.5" />
          </span>
          <div>
            <p className="mono text-sm font-semibold text-neutral-100">{row.extension}</p>
            <p className="text-[11px] text-neutral-500">{row.name || "Unnamed mailbox"}</p>
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
      key: "email",
      header: "Email",
      render: (row) =>
        row.email ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-neutral-300">
            <Mail className="h-3 w-3 text-neutral-500" />
            <span className="max-w-[220px] truncate">{row.email}</span>
          </span>
        ) : (
          <span className="text-xs text-neutral-600">—</span>
        ),
    },
    {
      key: "timezone",
      header: "Timezone",
      render: (row) => (
        <span className="text-xs text-neutral-500">{row.timezone || "System default"}</span>
      ),
    },
    {
      key: "max_messages",
      header: "Capacity",
      align: "right",
      render: (row) => (
        <span className="mono text-xs text-neutral-400">{row.max_messages} msgs</span>
      ),
    },
    {
      key: "pin",
      header: "PIN",
      render: (row) =>
        row.pin ? (
          <span className="mono text-xs text-neutral-500">••••</span>
        ) : (
          <span className="text-xs text-neutral-600">Hidden</span>
        ),
    },
    {
      key: "active",
      header: "Status",
      render: (row) => (
        <Badge tone={row.active ? "success" : "neutral"} dot>
          {row.active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) =>
        can("voicemail.write") ? (
          <div className="flex items-center justify-end gap-0.5">
            <IconButton label="Edit mailbox" onClick={() => openEdit(row)}>
              <Pencil className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              label="Delete mailbox"
              className="hover:bg-neutral-500/10 hover:text-neutral-300"
              onClick={() => setDeleteTarget(row)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        ) : null,
    },
  ];

  const meta = list.meta;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Telephony"
        title="Voicemail"
        description="Mailboxes with PINs, notification email and storage limits, stored in PostgreSQL."
        actions={
          <>
            {can("voicemail.write") ? (
              <Button
                variant="secondary"
                icon={<RotateCw className="h-4 w-4" />}
                onClick={() => void reload()}
                loading={reloading}
              >
                Reload
              </Button>
            ) : null}
            {can("voicemail.write") ? (
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                New mailbox
              </Button>
            ) : null}
          </>
        }
      />

      <Alert tone="info" title="Voicemail configuration">
        Mailboxes are mirrored into the Asterisk realtime voicemail tables. A reload is only
        sent to Asterisk when AMI credentials are configured.
      </Alert>

      <Card>
        <div className="flex flex-col gap-2 border-b border-line/70 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              placeholder="Search mailbox, name or email…"
              className="sm:w-72"
            />
            <Input
              value={context}
              onChange={(event) => {
                setContext(event.target.value);
                setPage(1);
              }}
              placeholder="Context"
              className="h-9.5 sm:w-36"
            />
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
              <option value="false">Inactive</option>
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
                icon={<Voicemail className="h-6 w-6" />}
                title={search || context || activeFilter ? "No matching mailboxes" : "No voicemail boxes yet"}
                description={
                  search || context || activeFilter
                    ? "Try a different search or clear the filters."
                    : "Create a mailbox to let callers leave messages for an extension."
                }
                action={
                  can("voicemail.write") && !search && !context && !activeFilter ? (
                    <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                      New mailbox
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
        title={editing ? `Edit mailbox ${editing.extension}` : "New voicemail box"}
        description="The extension and context identify the mailbox."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="voicemail-form" variant="primary" loading={saving}>
              {editing ? "Save changes" : "Create mailbox"}
            </Button>
          </>
        }
      >
        <form id="voicemail-form" onSubmit={submit} className="space-y-4">
          {formError ? (
            <Alert tone="danger" title="Could not save mailbox">
              {formError}
            </Alert>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Extension"
              required
              error={fieldErrors.extension}
              hint={editing ? "The extension cannot be changed." : undefined}
            >
              <Input
                value={form.extension}
                onChange={(event) => update("extension", event.target.value)}
                placeholder="1001"
                inputMode="numeric"
                disabled={Boolean(editing)}
                className="mono"
              />
            </Field>
            <Field label="Context" required error={fieldErrors.context}>
              <Input
                value={form.context}
                onChange={(event) => update("context", event.target.value)}
                placeholder="internal"
                className="mono"
              />
            </Field>
            <Field label="Display name">
              <Input
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
                placeholder="Reception voicemail"
              />
            </Field>
            <Field label="Notification email" error={fieldErrors.email}>
              <Input
                type="email"
                value={form.email}
                onChange={(event) => update("email", event.target.value)}
                placeholder="reception@example.com"
              />
            </Field>
            <Field
              label={editing ? "New PIN" : "PIN"}
              required={!editing}
              error={fieldErrors.pin}
              hint={editing ? "Leave blank to keep the current PIN." : "4–8 digits."}
            >
              <Input
                value={form.pin}
                onChange={(event) => update("pin", event.target.value)}
                placeholder={editing ? "••••" : "1234"}
                inputMode="numeric"
                className="mono"
              />
            </Field>
            <Field label="Timezone" hint="Optional IANA timezone, e.g. Europe/Amsterdam.">
              <Input
                value={form.timezone}
                onChange={(event) => update("timezone", event.target.value)}
                placeholder="UTC"
                className="mono"
              />
            </Field>
            <Field label="Max messages" error={fieldErrors.max_messages}>
              <Input
                value={form.max_messages}
                onChange={(event) => update("max_messages", event.target.value)}
                inputMode="numeric"
                className="mono"
              />
            </Field>
          </div>

          <Toggle
            checked={form.active}
            onChange={(value) => update("active", value)}
            label="Mailbox active"
            description="Inactive mailboxes reject new messages."
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
        title={`Delete mailbox ${deleteTarget?.extension ?? ""}?`}
        description="The voicemail box and its realtime configuration will be removed."
        confirmLabel="Delete mailbox"
        loading={deleting}
        requireText={deleteTarget?.extension}
      />
    </div>
  );
}
