import { useEffect, useState, type FormEvent } from "react";
import {
  Download,
  ListTree,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Trash2,
  X,
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
  apiPut,
  buildQuery,
  errorMessage,
} from "../lib/api";
import type { IVRDestinationType, IVRMenu, IVROption } from "../lib/types";
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

const LIMIT = 20;

const DESTINATION_TYPES: Array<{ value: IVRDestinationType; label: string }> = [
  { value: "extension", label: "Extension" },
  { value: "queue", label: "Queue" },
  { value: "voicemail", label: "Voicemail" },
  { value: "ivr", label: "IVR menu" },
  { value: "conference", label: "Conference" },
  { value: "playback", label: "Playback" },
];

interface ReloadResult {
  reloaded: boolean;
  component: string;
  configured: boolean;
  message?: string;
}

interface OptionForm {
  digit: string;
  destination_type: IVRDestinationType;
  destination: string;
  description: string;
  sort_order: string;
}

interface IVRForm {
  name: string;
  description: string;
  greeting_sound: string;
  invalid_sound: string;
  timeout: string;
  max_attempts: string;
  active: boolean;
}

const EMPTY_FORM: IVRForm = {
  name: "",
  description: "",
  greeting_sound: "ivr-welcome",
  invalid_sound: "",
  timeout: "5",
  max_attempts: "3",
  active: true,
};

function newOption(index: number): OptionForm {
  return {
    digit: "",
    destination_type: "extension",
    destination: "",
    description: "",
    sort_order: String(index * 10),
  };
}

export default function IVRPage() {
  useDocumentTitle("IVR menus");
  const { can } = useAuth();
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const debouncedSearch = useDebouncedValue(search);

  const list = useApiQuery<IVRMenu[]>(
    `/api/v1/ivr${buildQuery({
      page,
      limit: LIMIT,
      search: debouncedSearch,
      active: activeFilter,
    })}`,
  );

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<IVRMenu | null>(null);
  const [form, setForm] = useState<IVRForm>(EMPTY_FORM);
  const [options, setOptions] = useState<OptionForm[]>([newOption(1)]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<IVRMenu | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reloading, setReloading] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    if (page > 1 && list.meta && page > list.meta.pages && list.meta.pages > 0) {
      setPage(list.meta.pages);
    }
  }, [list.meta, page]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOptions([newOption(1)]);
    setFormError("");
    setFieldErrors({});
    setFormOpen(true);
  };

  const openEdit = (menu: IVRMenu) => {
    setEditing(menu);
    setForm({
      name: menu.name,
      description: menu.description ?? "",
      greeting_sound: menu.greeting_sound,
      invalid_sound: menu.invalid_sound ?? "",
      timeout: String(menu.timeout),
      max_attempts: String(menu.max_attempts),
      active: menu.active,
    });
    setOptions(
      menu.options.length > 0
        ? menu.options.map((option) => ({
            digit: option.digit,
            destination_type: option.destination_type,
            destination: option.destination,
            description: option.description ?? "",
            sort_order: String(option.sort_order ?? 0),
          }))
        : [newOption(1)],
    );
    setFormError("");
    setFieldErrors({});
    setFormOpen(true);
  };

  const update = <K extends keyof IVRForm>(key: K, value: IVRForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const updateOption = <K extends keyof OptionForm>(
    index: number,
    key: K,
    value: OptionForm[K],
  ) => {
    setOptions((current) =>
      current.map((option, optionIndex) =>
        optionIndex === index ? { ...option, [key]: value } : option,
      ),
    );
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(form.name.trim())) {
      errors.name = "1–120 letters, digits, dot, underscore or hyphen.";
    }
    if (
      !form.greeting_sound.trim() ||
      /\s|\\|\.\./.test(form.greeting_sound.trim())
    ) {
      errors.greeting_sound = "Enter a sound name without spaces or '..'.";
    }
    if (
      form.invalid_sound.trim() &&
      (/\s|\\|\.\./.test(form.invalid_sound.trim()) ||
        form.invalid_sound.trim().length > 255)
    ) {
      errors.invalid_sound = "Invalid sound path.";
    }
    const timeout = Number(form.timeout);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30) {
      errors.timeout = "1–30 seconds.";
    }
    const attempts = Number(form.max_attempts);
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) {
      errors.max_attempts = "1–10 attempts.";
    }

    const digits = new Set<string>();
    const validOptions = options.filter(
      (option) => option.digit.trim() || option.destination.trim(),
    );
    for (const option of validOptions) {
      const digit = option.digit.trim();
      if (!/^[0-9*#]$/.test(digit)) {
        errors.options = "Each option needs a single digit (0–9, * or #).";
        break;
      }
      if (digits.has(digit)) {
        errors.options = `Digit ${digit} is used more than once.`;
        break;
      }
      digits.add(digit);
      if (!option.destination.trim() || /\s/.test(option.destination.trim())) {
        errors.options = `Option ${digit} needs a destination without spaces.`;
        break;
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
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        greeting_sound: form.greeting_sound.trim(),
        invalid_sound: form.invalid_sound.trim(),
        timeout: Number(form.timeout),
        max_attempts: Number(form.max_attempts),
        active: form.active,
      };
      const optionPayload = options
        .filter((option) => option.digit.trim() && option.destination.trim())
        .map((option) => ({
          digit: option.digit.trim(),
          destination_type: option.destination_type,
          destination: option.destination.trim(),
          description: option.description.trim(),
          sort_order: Number(option.sort_order) || 0,
        }));

      if (editing) {
        await apiPatch<IVRMenu>(`/api/v1/ivr/${editing.id}`, payload);
        await apiPut<IVROption[]>(`/api/v1/ivr/${editing.id}/options`, {
          options: optionPayload,
        });
        toast.success("IVR menu updated");
      } else {
        await apiPost<IVRMenu>("/api/v1/ivr", { ...payload, options: optionPayload });
        toast.success("IVR menu created");
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
      await apiDelete(`/api/v1/ivr/${deleteTarget.id}`);
      toast.success("IVR menu deleted");
      setDeleteTarget(null);
      list.refresh();
    } catch (caught) {
      toast.error("Could not delete IVR menu", errorMessage(caught));
    } finally {
      setDeleting(false);
    }
  };

  const reload = async (menu: IVRMenu) => {
    setReloading(menu.id);
    try {
      const result = await apiPost<ReloadResult>(`/api/v1/ivr/${menu.id}/reload`);
      if (result.configured) {
        toast.success("Dialplan reload requested");
      } else {
        toast.info("Stored in PostgreSQL only", result.message ?? "Asterisk is not configured.");
      }
    } catch (caught) {
      toast.error("Reload failed", errorMessage(caught));
    } finally {
      setReloading(null);
    }
  };

  const download = async (menu: IVRMenu) => {
    setDownloading(menu.id);
    try {
      await apiDownload(`/api/v1/ivr/${menu.id}/dialplan`, `ivr-${menu.name}.conf`);
      toast.success("IVR dialplan downloaded");
    } catch (caught) {
      toast.error("Download failed", errorMessage(caught));
    } finally {
      setDownloading(null);
    }
  };

  const columns: Column<IVRMenu>[] = [
    {
      key: "name",
      header: "IVR menu",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-white/[0.04] text-neutral-300">
            <ListTree className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-neutral-100">{row.name}</p>
            <p className="truncate text-[11px] text-neutral-500">
              {row.description || "No description"}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "greeting",
      header: "Greeting",
      render: (row) => (
        <span className="mono text-xs text-neutral-400">{row.greeting_sound}</span>
      ),
    },
    {
      key: "timing",
      header: "Timeout / attempts",
      render: (row) => (
        <span className="text-xs text-neutral-500">
          {row.timeout}s · {row.max_attempts} attempts
        </span>
      ),
    },
    {
      key: "options",
      header: "Options",
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.options.length === 0 ? (
            <span className="text-xs text-neutral-600">None</span>
          ) : (
            row.options.slice(0, 5).map((option) => (
              <span
                key={option.digit}
                title={`${option.destination_type}: ${option.destination}`}
                className="rounded border border-line/70 bg-white/[0.035] px-1.5 py-0.5 font-mono text-[10px] text-neutral-300"
              >
                {option.digit} → {option.destination}
              </span>
            ))
          )}
          {row.options.length > 5 ? (
            <span className="text-[10px] text-neutral-600">+{row.options.length - 5}</span>
          ) : null}
        </div>
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
      render: (row) => (
        <div className="flex items-center justify-end gap-0.5">
          <IconButton label="Download dialplan" onClick={() => void download(row)}>
            <Download
              className={downloading === row.id ? "h-3.5 w-3.5 animate-pulse" : "h-3.5 w-3.5"}
            />
          </IconButton>
          {can("ivr.write") ? (
            <>
              <IconButton label="Reload dialplan" onClick={() => void reload(row)}>
                <RotateCw
                  className={reloading === row.id ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"}
                />
              </IconButton>
              <IconButton label="Edit IVR menu" onClick={() => openEdit(row)}>
                <Pencil className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                label="Delete IVR menu"
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

  const meta = list.meta;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Telephony"
        title="IVR menus"
        description="Digit menus with destinations for extensions, queues, voicemail and more."
        actions={
          can("ivr.write") ? (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
              New IVR menu
            </Button>
          ) : undefined
        }
      />

      <Card>
        <div className="flex flex-col gap-2 border-b border-line/70 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              placeholder="Search IVR menus…"
              className="sm:w-72"
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
                icon={<ListTree className="h-6 w-6" />}
                title={search || activeFilter ? "No matching IVR menus" : "No IVR menus yet"}
                description={
                  search || activeFilter
                    ? "Try a different search or clear the filter."
                    : "Create a menu to guide callers through self-service options."
                }
                action={
                  can("ivr.write") && !search && !activeFilter ? (
                    <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                      New IVR menu
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
        title={editing ? `Edit IVR ${editing.name}` : "New IVR menu"}
        description="Each digit routes to a destination. Invalid and timeout handling is generated automatically."
        size="xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="ivr-form" variant="primary" loading={saving}>
              {editing ? "Save changes" : "Create IVR menu"}
            </Button>
          </>
        }
      >
        <form id="ivr-form" onSubmit={submit} className="space-y-5">
          {formError ? (
            <Alert tone="danger" title="Could not save IVR menu">
              {formError}
            </Alert>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Menu name" required error={fieldErrors.name}>
              <Input
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
                placeholder="main-menu"
                className="mono"
              />
            </Field>
            <Field label="Description">
              <Input
                value={form.description}
                onChange={(event) => update("description", event.target.value)}
                placeholder="Main inbound menu"
              />
            </Field>
            <Field label="Greeting sound" required error={fieldErrors.greeting_sound}>
              <Input
                value={form.greeting_sound}
                onChange={(event) => update("greeting_sound", event.target.value)}
                placeholder="ivr-welcome"
                className="mono"
              />
            </Field>
            <Field label="Invalid sound" error={fieldErrors.invalid_sound}>
              <Input
                value={form.invalid_sound}
                onChange={(event) => update("invalid_sound", event.target.value)}
                placeholder="invalid"
                className="mono"
              />
            </Field>
            <Field label="Timeout" required error={fieldErrors.timeout} hint="Seconds to wait for a digit.">
              <Input
                value={form.timeout}
                onChange={(event) => update("timeout", event.target.value)}
                inputMode="numeric"
                className="mono"
              />
            </Field>
            <Field label="Max attempts" required error={fieldErrors.max_attempts}>
              <Input
                value={form.max_attempts}
                onChange={(event) => update("max_attempts", event.target.value)}
                inputMode="numeric"
                className="mono"
              />
            </Field>
          </div>

          <Toggle
            checked={form.active}
            onChange={(value) => update("active", value)}
            label="IVR menu active"
            description="Inactive menus remain stored but are not offered for routing."
          />

          <div className="rounded-xl border border-line/70 bg-white/[0.03] p-3.5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-neutral-200">Menu options</p>
                <p className="text-[11px] text-neutral-500">
                  Digits 0–9, * and # are supported. Duplicate digits are rejected.
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => setOptions((current) => [...current, newOption(current.length + 1)])}
              >
                Add option
              </Button>
            </div>

            {fieldErrors.options ? (
              <p className="mb-2 text-xs font-medium text-neutral-400">{fieldErrors.options}</p>
            ) : null}

            <div className="space-y-2">
              {options.map((option, index) => (
                <div
                  key={index}
                  className="grid grid-cols-1 gap-2 rounded-lg border border-line/60 bg-white/[0.03] p-2.5 sm:grid-cols-[64px_150px_1fr_1fr_64px_36px] sm:items-end"
                >
                  <Field label="Digit">
                    <Input
                      value={option.digit}
                      onChange={(event) => updateOption(index, "digit", event.target.value)}
                      placeholder="1"
                      maxLength={1}
                      className="mono text-center"
                    />
                  </Field>
                  <Field label="Type">
                    <Select
                      value={option.destination_type}
                      onChange={(event) =>
                        updateOption(
                          index,
                          "destination_type",
                          event.target.value as IVRDestinationType,
                        )
                      }
                    >
                      {DESTINATION_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Destination">
                    <Input
                      value={option.destination}
                      onChange={(event) => updateOption(index, "destination", event.target.value)}
                      placeholder="1001"
                      className="mono"
                    />
                  </Field>
                  <Field label="Description">
                    <Input
                      value={option.description}
                      onChange={(event) => updateOption(index, "description", event.target.value)}
                      placeholder="Sales"
                    />
                  </Field>
                  <Field label="Order">
                    <Input
                      value={option.sort_order}
                      onChange={(event) => updateOption(index, "sort_order", event.target.value)}
                      inputMode="numeric"
                      className="mono"
                    />
                  </Field>
                  <IconButton
                    label="Remove option"
                    className="mb-0.5 hover:bg-neutral-500/10 hover:text-neutral-300"
                    onClick={() =>
                      setOptions((current) => current.filter((_, optionIndex) => optionIndex !== index))
                    }
                  >
                    <X className="h-4 w-4" />
                  </IconButton>
                </div>
              ))}
            </div>
            {options.length === 0 ? (
              <p className="py-4 text-center text-xs text-neutral-600">
                No options yet. Add a digit to route callers.
              </p>
            ) : null}
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
        title={`Delete IVR ${deleteTarget?.name ?? ""}?`}
        description="The menu and all of its digit options will be removed."
        confirmLabel="Delete IVR menu"
        loading={deleting}
        requireText={deleteTarget?.name}
      />
    </div>
  );
}
