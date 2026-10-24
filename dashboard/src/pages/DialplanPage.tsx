import { useEffect, useState, type FormEvent } from "react";
import {
  Download,
  GitBranch,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Trash2,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useApiQuery } from "../hooks/useApiQuery";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useToast } from "../context/ToastContext";
import {
  apiDelete,
  apiDownload,
  apiPatch,
  apiPost,
  buildQuery,
  errorMessage,
} from "../lib/api";
import type { DialplanRule } from "../lib/types";
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

interface RuleForm {
  context: string;
  pattern: string;
  priority: string;
  app: string;
  app_data: string;
  description: string;
  enabled: boolean;
}

const EMPTY_FORM: RuleForm = {
  context: "internal",
  pattern: "",
  priority: "1",
  app: "Dial",
  app_data: "",
  description: "",
  enabled: true,
};

export default function DialplanPage() {
  useDocumentTitle("Dialplan");
  const { can } = useAuth();
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [context, setContext] = useState("");
  const [enabledFilter, setEnabledFilter] = useState("");
  const debouncedSearch = useDebouncedValue(search);

  const path = `/api/v1/dialplan${buildQuery({
    page,
    limit: LIMIT,
    search: debouncedSearch,
    context,
    enabled: enabledFilter,
  })}`;
  const list = useApiQuery<DialplanRule[]>(path);
  const contexts = useApiQuery<ContextRow[]>("/api/v1/dialplan/contexts");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DialplanRule | null>(null);
  const [form, setForm] = useState<RuleForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<DialplanRule | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (page > 1 && list.meta && page > list.meta.pages && list.meta.pages > 0) {
      setPage(list.meta.pages);
    }
  }, [list.meta, page]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, context: context || "internal" });
    setFormError("");
    setFieldErrors({});
    setFormOpen(true);
  };

  const openEdit = (rule: DialplanRule) => {
    setEditing(rule);
    setForm({
      context: rule.context,
      pattern: rule.pattern,
      priority: String(rule.priority),
      app: rule.app,
      app_data: rule.app_data,
      description: rule.description ?? "",
      enabled: rule.enabled,
    });
    setFormError("");
    setFieldErrors({});
    setFormOpen(true);
  };

  const update = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) => {
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
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(form.context.trim())) {
      errors.context = "1–64 letters, digits, dot, underscore or hyphen.";
    }
    if (!form.pattern.trim() || /\s/.test(form.pattern.trim())) {
      errors.pattern = "Pattern is required and cannot contain spaces.";
    }
    const priority = Number(form.priority);
    if (!Number.isInteger(priority) || priority < 1 || priority > 1000) {
      errors.priority = "Enter a whole number between 1 and 1000.";
    }
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(form.app.trim())) {
      errors.app = "Application name is required.";
    }
    if (form.app_data.length > 512 || /[\r\n]/.test(form.app_data)) {
      errors.app_data = "Maximum 512 characters, no line breaks.";
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
      const payload = {
        context: form.context.trim(),
        pattern: form.pattern.trim(),
        priority: Number(form.priority),
        app: form.app.trim(),
        app_data: form.app_data,
        description: form.description.trim(),
        enabled: form.enabled,
      };
      if (editing) {
        await apiPatch<DialplanRule>(`/api/v1/dialplan/${editing.id}`, payload);
        toast.success("Dialplan rule updated");
      } else {
        await apiPost<DialplanRule>("/api/v1/dialplan", payload);
        toast.success("Dialplan rule created");
      }
      setFormOpen(false);
      list.refresh();
      contexts.refresh();
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
      await apiDelete(`/api/v1/dialplan/${deleteTarget.id}`);
      toast.success("Dialplan rule deleted");
      setDeleteTarget(null);
      list.refresh();
      contexts.refresh();
    } catch (caught) {
      toast.error("Could not delete rule", errorMessage(caught));
    } finally {
      setDeleting(false);
    }
  };

  const reload = async () => {
    setReloading(true);
    try {
      const result = await apiPost<ReloadResult>("/api/v1/dialplan/reload");
      if (result.configured) {
        toast.success("Dialplan reload requested");
      } else {
        toast.info("Stored in PostgreSQL only", result.message ?? "Asterisk is not configured.");
      }
    } catch (caught) {
      toast.error("Reload failed", errorMessage(caught));
    } finally {
      setReloading(false);
    }
  };

  const exportDialplan = async () => {
    setExporting(true);
    try {
      await apiDownload(
        `/api/v1/dialplan/export${buildQuery({ context })}`,
        "extensions.conf",
      );
      toast.success("Dialplan exported");
    } catch (caught) {
      toast.error("Export failed", errorMessage(caught));
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<DialplanRule>[] = [
    {
      key: "context",
      header: "Context",
      render: (row) => <span className="mono text-xs text-neutral-400">{row.context}</span>,
    },
    {
      key: "pattern",
      header: "Pattern",
      render: (row) => (
        <span className="mono text-sm font-medium text-neutral-100">{row.pattern}</span>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      align: "center",
      render: (row) => <span className="mono text-xs text-neutral-400">{row.priority}</span>,
    },
    {
      key: "app",
      header: "Application",
      render: (row) => (
        <span className="rounded border border-line/70 bg-white/[0.035] px-1.5 py-0.5 font-mono text-[11px] text-neutral-300">
          {row.app}
        </span>
      ),
    },
    {
      key: "app_data",
      header: "Arguments",
      render: (row) => (
        <span
          className="mono block max-w-[300px] truncate text-xs text-neutral-400"
          title={row.app_data}
        >
          {row.app_data || "—"}
        </span>
      ),
    },
    {
      key: "description",
      header: "Description",
      render: (row) => (
        <span className="block max-w-[240px] truncate text-xs text-neutral-500">
          {row.description || "—"}
        </span>
      ),
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
      render: (row) =>
        can("dialplan.write") ? (
          <div className="flex items-center justify-end gap-0.5">
            <IconButton label="Edit rule" onClick={() => openEdit(row)}>
              <Pencil className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              label="Delete rule"
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
        title="Dialplan"
        description="Extensions and priorities stored in PostgreSQL and exported as Asterisk dialplan."
        actions={
          <>
            <Button
              variant="secondary"
              icon={<Download className="h-4 w-4" />}
              onClick={() => void exportDialplan()}
              loading={exporting}
            >
              Export
            </Button>
            {can("dialplan.write") ? (
              <>
                <Button
                  variant="secondary"
                  icon={<RotateCw className="h-4 w-4" />}
                  onClick={() => void reload()}
                  loading={reloading}
                >
                  Reload
                </Button>
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                  New rule
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <Alert tone="info" title="Generated configuration">
        The backend renders these rules into a dialplan file. With AMI configured, the
        reload action asks Asterisk to re-read the generated configuration; without AMI the
        rules remain safely stored in PostgreSQL.
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
              placeholder="Search pattern, app or arguments…"
              className="sm:w-72"
            />
            <Select
              value={context}
              onChange={(event) => {
                setContext(event.target.value);
                setPage(1);
              }}
              className="h-9.5 sm:w-44"
              aria-label="Filter by context"
            >
              <option value="">All contexts</option>
              {(contexts.data ?? []).map((row) => (
                <option key={row.context} value={row.context}>
                  {row.context} ({row.count})
                </option>
              ))}
            </Select>
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
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={() => {
              list.refresh();
              contexts.refresh();
            }}
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
                icon={<GitBranch className="h-6 w-6" />}
                title={search || context || enabledFilter ? "No matching rules" : "No dialplan rules yet"}
                description={
                  search || context || enabledFilter
                    ? "Adjust the filters to see more rules."
                    : "Add the first extension rule to define how calls are routed."
                }
                action={
                  can("dialplan.write") && !search && !context && !enabledFilter ? (
                    <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                      New rule
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
        title={editing ? "Edit dialplan rule" : "New dialplan rule"}
        description="Rules are rendered in priority order inside their context."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="dialplan-form"
              variant="primary"
              loading={saving}
            >
              {editing ? "Save changes" : "Create rule"}
            </Button>
          </>
        }
      >
        <form id="dialplan-form" onSubmit={submit} className="space-y-4">
          {formError ? (
            <Alert tone="danger" title="Could not save rule">
              {formError}
            </Alert>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Context" required error={fieldErrors.context}>
              <Input
                value={form.context}
                onChange={(event) => update("context", event.target.value)}
                placeholder="internal"
                list="dialplan-contexts"
                className="mono"
              />
              <datalist id="dialplan-contexts">
                {(contexts.data ?? []).map((row) => (
                  <option key={row.context} value={row.context} />
                ))}
              </datalist>
            </Field>
            <Field label="Pattern" required error={fieldErrors.pattern} hint="Example: 10XX or _1NXXNXXXXXX">
              <Input
                value={form.pattern}
                onChange={(event) => update("pattern", event.target.value)}
                placeholder="10XX"
                className="mono"
              />
            </Field>
            <Field label="Priority" required error={fieldErrors.priority}>
              <Input
                value={form.priority}
                onChange={(event) => update("priority", event.target.value)}
                inputMode="numeric"
                className="mono"
              />
            </Field>
            <Field label="Application" required error={fieldErrors.app}>
              <Input
                value={form.app}
                onChange={(event) => update("app", event.target.value)}
                placeholder="Dial"
                className="mono"
              />
            </Field>
          </div>

          <Field
            label="Arguments"
            error={fieldErrors.app_data}
            hint="Application data passed to Asterisk, for example PJSIP/${EXTEN}."
          >
            <Input
              value={form.app_data}
              onChange={(event) => update("app_data", event.target.value)}
              placeholder="PJSIP/${EXTEN},30"
              className="mono"
            />
          </Field>

          <Field label="Description">
            <Input
              value={form.description}
              onChange={(event) => update("description", event.target.value)}
              placeholder="Route extension calls"
            />
          </Field>

          <Toggle
            checked={form.enabled}
            onChange={(value) => update("enabled", value)}
            label="Rule enabled"
            description="Disabled rules are omitted from generated dialplan exports."
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
        title="Delete dialplan rule?"
        description={
          deleteTarget
            ? `Rule ${deleteTarget.pattern} priority ${deleteTarget.priority} in ${deleteTarget.context} will be removed.`
            : undefined
        }
        confirmLabel="Delete rule"
        loading={deleting}
      />
    </div>
  );
}
