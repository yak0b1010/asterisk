import { useMemo, useState, type FormEvent } from "react";
import {
  Braces,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileJson,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useApiQuery } from "../hooks/useApiQuery";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useToast } from "../context/ToastContext";
import { apiDelete, apiPut, errorMessage } from "../lib/api";
import type { Setting } from "../lib/types";
import { formatDateTime, formatRelative, type Tone } from "../lib/format";
import { displayValue, parseJsonValue } from "../lib/utils";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { Button, IconButton } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { CopyButton } from "../components/ui/CopyButton";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorPanel } from "../components/ErrorPanel";
import { Field, Input, Select, Textarea } from "../components/ui/Field";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { SearchInput } from "../components/ui/SearchInput";

type JsonType = "object" | "array" | "string" | "number" | "boolean" | "null";

const TYPE_TONES: Record<JsonType, Tone> = {
  object: "accent",
  array: "info",
  string: "success",
  number: "warning",
  boolean: "neutral",
  null: "neutral",
};

function jsonType(value: unknown): JsonType {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value as JsonType;
}

function prettyValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function SettingsPage() {
  useDocumentTitle("Settings");
  const { can } = useAuth();
  const toast = useToast();

  const list = useApiQuery<Setting[]>("/api/v1/settings");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Setting | null>(null);
  const [formKey, setFormKey] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formValue, setFormValue] = useState("{}");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [deleteTarget, setDeleteTarget] = useState<Setting | null>(null);
  const [deleting, setDeleting] = useState(false);

  const settings = list.data ?? [];

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return settings
      .filter((setting) => {
        if (typeFilter && jsonType(setting.value) !== typeFilter) return false;
        if (!needle) return true;
        return (
          setting.key.toLowerCase().includes(needle) ||
          (setting.description ?? "").toLowerCase().includes(needle) ||
          displayValue(setting.value).toLowerCase().includes(needle)
        );
      })
      .slice()
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [settings, search, typeFilter]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const setting of settings) {
      const type = jsonType(setting.value);
      counts[type] = (counts[type] ?? 0) + 1;
    }
    return counts;
  }, [settings]);

  const lastUpdated = useMemo(() => {
    let latest: Setting | null = null;
    for (const setting of settings) {
      if (!latest || new Date(setting.updated_at).getTime() > new Date(latest.updated_at).getTime()) {
        latest = setting;
      }
    }
    return latest;
  }, [settings]);

  const openCreate = () => {
    setEditing(null);
    setFormKey("");
    setFormDescription("");
    setFormValue("{}");
    setFormError("");
    setFieldErrors({});
    setFormOpen(true);
  };

  const openEdit = (setting: Setting) => {
    setEditing(setting);
    setFormKey(setting.key);
    setFormDescription(setting.description ?? "");
    setFormValue(prettyValue(setting.value));
    setFormError("");
    setFieldErrors({});
    setFormOpen(true);
  };

  const existing = !editing
    ? settings.find((setting) => setting.key === formKey.trim())
    : undefined;

  const formatValue = () => {
    const parsed = parseJsonValue(formValue);
    if (!parsed.ok) {
      setFieldErrors((current) => ({
        ...current,
        value: parsed.error ?? "Invalid JSON.",
      }));
      return;
    }
    setFormValue(prettyValue(parsed.value));
    setFieldErrors((current) => {
      if (!current.value) return current;
      const next = { ...current };
      delete next.value;
      return next;
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(formKey.trim())) {
      errors.key = "1–120 letters, digits, dot, underscore or hyphen.";
    }
    const parsed = parseJsonValue(formValue);
    if (!parsed.ok) errors.value = parsed.error ?? "Invalid JSON.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    setFormError("");
    try {
      const saved = await apiPut<Setting>(
        `/api/v1/settings/${encodeURIComponent(formKey.trim())}`,
        {
          value: parsed.value,
          description: formDescription.trim(),
        },
      );
      toast.success(
        editing ? "Setting updated" : "Setting saved",
        `${saved.key} now holds ${jsonType(saved.value)} JSON.`,
      );
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
      await apiDelete(`/api/v1/settings/${encodeURIComponent(deleteTarget.key)}`);
      toast.success("Setting deleted", `${deleteTarget.key} was removed.`);
      setDeleteTarget(null);
      if (expanded === deleteTarget.key) setExpanded(null);
      list.refresh();
    } catch (caught) {
      toast.error("Could not delete setting", errorMessage(caught));
    } finally {
      setDeleting(false);
    }
  };

  const byteSize = new TextEncoder().encode(formValue).length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="System"
        title="Runtime settings"
        description="Arbitrary JSON values consumed by integrations, stored in PostgreSQL and included in backups."
        actions={
          <>
            <Button
              variant="secondary"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={list.refresh}
              loading={list.refreshing}
            >
              Refresh
            </Button>
            {can("settings.write") ? (
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                New setting
              </Button>
            ) : null}
          </>
        }
      />

      <Alert tone="info" title="Settings are free-form JSON">
        Keys are namespaced strings such as <span className="mono">asterisk.default_context</span>.
        Values can be objects, arrays, strings, numbers or booleans and are limited to 64 KiB.
        Changes are audited and applied immediately by API consumers.
      </Alert>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Settings", value: settings.length, tone: "accent" as Tone },
          { label: "Objects", value: typeCounts.object ?? 0, tone: "info" as Tone },
          { label: "Arrays", value: typeCounts.array ?? 0, tone: "success" as Tone },
          { label: "Scalars", value: (typeCounts.string ?? 0) + (typeCounts.number ?? 0) + (typeCounts.boolean ?? 0) + (typeCounts.null ?? 0), tone: "neutral" as Tone },
        ].map((item) => (
          <div key={item.label} className="panel-muted px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
              {item.label}
            </p>
            <p className="mt-1 text-xl font-semibold text-white">{item.value}</p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
              <div
                className={
                  item.tone === "accent"
                    ? "h-full bg-neutral-400"
                    : item.tone === "info"
                      ? "h-full bg-neutral-400"
                      : item.tone === "success"
                        ? "h-full bg-neutral-400"
                        : "h-full bg-neutral-400"
                }
                style={{
                  width:
                    settings.length > 0 && item.value > 0
                      ? `${Math.max(3, (item.value / settings.length) * 100)}%`
                      : "0%",
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <Card>
        <div className="flex flex-col gap-2 border-b border-line/70 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search key, description or value…"
              className="sm:w-80"
            />
            <Select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="h-9.5 sm:w-40"
              aria-label="Filter by value type"
            >
              <option value="">All types</option>
              {(["object", "array", "string", "number", "boolean", "null"] as JsonType[]).map(
                (type) => (
                  <option key={type} value={type}>
                    {type} ({typeCounts[type] ?? 0})
                  </option>
                ),
              )}
            </Select>
          </div>
          <p className="flex items-center gap-1.5 px-1 text-[11px] text-neutral-600">
            <Clock3 className="h-3.5 w-3.5" />
            {lastUpdated
              ? `Last change ${formatRelative(lastUpdated.updated_at)} by ${lastUpdated.updated_by || "unknown"}`
              : "No changes recorded"}
          </p>
        </div>

        {list.error && !list.data ? (
          <ErrorPanel message={list.error.message} onRetry={list.refresh} />
        ) : list.loading && !list.data ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="skeleton h-16" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Settings2 className="h-6 w-6" />}
            title={settings.length === 0 ? "No settings yet" : "No matching settings"}
            description={
              settings.length === 0
                ? "Create a key to store runtime configuration shared with API consumers."
                : "Try a different search or clear the type filter."
            }
            action={
              can("settings.write") && settings.length === 0 ? (
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                  New setting
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="divide-y divide-line/50">
            {filtered.map((setting) => {
              const type = jsonType(setting.value);
              const isOpen = expanded === setting.key;
              return (
                <div key={setting.key} className="group">
                  <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : setting.key)}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left"
                      aria-expanded={isOpen}
                    >
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-white/[0.04] text-neutral-300">
                        <FileJson className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="mono text-sm font-semibold text-neutral-100">
                            {setting.key}
                          </span>
                          <Badge tone={TYPE_TONES[type]}>{type}</Badge>
                        </span>
                        {setting.description ? (
                          <span className="mt-0.5 block text-xs leading-relaxed text-neutral-500">
                            {setting.description}
                          </span>
                        ) : null}
                        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-neutral-600">
                          <span>Updated {formatRelative(setting.updated_at)}</span>
                          {setting.updated_by ? <span>by {setting.updated_by}</span> : null}
                          <span className="mono">{formatDateTime(setting.updated_at)}</span>
                        </span>
                      </span>
                    </button>

                    <div className="flex shrink-0 items-center gap-1 self-end sm:self-start">
                      <CopyButton
                        value={prettyValue(setting.value)}
                        iconOnly
                        label="Copy value"
                      />
                      {can("settings.write") ? (
                        <>
                          <IconButton label="Edit setting" onClick={() => openEdit(setting)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </IconButton>
                          <IconButton
                            label="Delete setting"
                            className="hover:bg-neutral-500/10 hover:text-neutral-300"
                            onClick={() => setDeleteTarget(setting)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </IconButton>
                        </>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : setting.key)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-white/[0.07] hover:text-neutral-200"
                        aria-label={isOpen ? "Collapse value" : "Expand value"}
                      >
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {isOpen ? (
                    <div className="border-t border-line/40 bg-white/[0.035] px-4 py-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                          <Braces className="h-3 w-3" />
                          JSON value
                        </span>
                        <span className="mono text-[10px] text-neutral-600">
                          {new TextEncoder().encode(prettyValue(setting.value)).length} bytes
                        </span>
                      </div>
                      <pre className="max-h-72 overflow-auto rounded-lg border border-line/60 bg-black/25 p-3 font-mono text-[11px] leading-relaxed text-neutral-300">
                        {prettyValue(setting.value)}
                      </pre>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit ${editing.key}` : "New setting"}
        description="Values are parsed as JSON before they are stored. Strings must be quoted."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="setting-form"
              variant="primary"
              loading={saving}
              icon={!saving ? <Braces className="h-4 w-4" /> : undefined}
            >
              {editing ? "Save value" : "Create setting"}
            </Button>
          </>
        }
      >
        <form id="setting-form" onSubmit={submit} className="space-y-4">
          {formError ? (
            <Alert tone="danger" title="Could not save setting">
              {formError}
            </Alert>
          ) : null}

          {existing ? (
            <Alert tone="warning" title="This key already exists">
              Saving will overwrite the current value of{" "}
              <span className="mono">{existing.key}</span>.
            </Alert>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Key"
              required
              error={fieldErrors.key}
              hint={
                editing
                  ? "Keys are immutable. Create a new key to rename this setting."
                  : "Dot-separated namespaces are recommended."
              }
            >
              <Input
                value={formKey}
                onChange={(event) => {
                  setFormKey(event.target.value);
                  setFieldErrors((current) => {
                    if (!current.key) return current;
                    const next = { ...current };
                    delete next.key;
                    return next;
                  });
                }}
                placeholder="asterisk.default_context"
                disabled={Boolean(editing)}
                className="mono"
                autoComplete="off"
              />
            </Field>
            <Field label="Description" hint="Shown in this list; stored with the setting.">
              <Input
                value={formDescription}
                onChange={(event) => setFormDescription(event.target.value)}
                placeholder="Default context for generated dialplan"
                maxLength={255}
              />
            </Field>
          </div>

          <Field
            label="JSON value"
            required
            error={fieldErrors.value}
            hint={`${byteSize} bytes · maximum 64 KiB`}
          >
            <Textarea
              value={formValue}
              onChange={(event) => {
                setFormValue(event.target.value);
                setFieldErrors((current) => {
                  if (!current.value) return current;
                  const next = { ...current };
                  delete next.value;
                  return next;
                });
              }}
              spellCheck={false}
              className="mono min-h-[240px] text-[12px]"
              placeholder={'{\n  "key": "value"\n}'}
            />
          </Field>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<Braces className="h-3.5 w-3.5" />}
              onClick={formatValue}
            >
              Format JSON
            </Button>
            <span className="text-[11px] text-neutral-600">
              {formValue.trim() === "" ? "Value is empty" : `Detected ${jsonType(parseJsonValue(formValue).value)}`}
            </span>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
        title={`Delete ${deleteTarget?.key ?? "setting"}?`}
        description="Consumers relying on this key will fall back to their defaults. This cannot be undone."
        confirmLabel="Delete setting"
        loading={deleting}
        requireText={deleteTarget?.key}
      />
    </div>
  );
}
