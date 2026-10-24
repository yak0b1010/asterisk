import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Download,
  Mic,
  MicOff,
  Pencil,
  Plus,
  Presentation,
  RefreshCw,
  Trash2,
  WifiOff,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useApiQuery } from "../hooks/useApiQuery";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useInterval } from "../hooks/useInterval";
import { useToast } from "../context/ToastContext";
import {
  apiDelete,
  apiDownload,
  apiPatch,
  apiPost,
  buildQuery,
  errorMessage,
} from "../lib/api";
import type { ConferenceLiveStatus, ConferenceRoom } from "../lib/types";
import { formatNumber } from "../lib/format";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { Button, IconButton } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { DataTable, type Column } from "../components/ui/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorPanel } from "../components/ErrorPanel";
import { Field, Input, Select, Toggle } from "../components/ui/Field";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { Pagination } from "../components/ui/Pagination";
import { SearchInput } from "../components/ui/SearchInput";
import { Tabs } from "../components/ui/Tabs";

const LIMIT = 20;

interface LiveMember {
  channel?: string;
  caller_id_num?: string;
  caller_id_name?: string;
  admin?: boolean;
  marked?: boolean;
  muted?: boolean;
  answered_time?: string;
  join_time?: string;
}

interface LiveRoom {
  room: string;
  members?: LiveMember[];
}

interface ConferenceForm {
  number: string;
  name: string;
  pin: string;
  max_members: string;
  muted: boolean;
  record: boolean;
  active: boolean;
  description: string;
}

const EMPTY_FORM: ConferenceForm = {
  number: "",
  name: "",
  pin: "",
  max_members: "10",
  muted: false,
  record: false,
  active: true,
  description: "",
};

export default function ConferencesPage() {
  useDocumentTitle("Conferences");
  const { can } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState("rooms");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const debouncedSearch = useDebouncedValue(search);

  const list = useApiQuery<ConferenceRoom[]>(
    `/api/v1/conferences${buildQuery({
      page,
      limit: LIMIT,
      search: debouncedSearch,
      active: activeFilter,
    })}`,
  );
  const live = useApiQuery<ConferenceLiveStatus>("/api/v1/conferences/live");

  useInterval(() => {
    if (tab === "live") live.refresh();
  }, 15000);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ConferenceRoom | null>(null);
  const [form, setForm] = useState<ConferenceForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<ConferenceRoom | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    if (page > 1 && list.meta && page > list.meta.pages && list.meta.pages > 0) {
      setPage(list.meta.pages);
    }
  }, [list.meta, page]);

  const liveRooms = useMemo(
    () => (live.data?.conferences ?? []) as unknown as LiveRoom[],
    [live.data],
  );

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setFieldErrors({});
    setFormOpen(true);
  };

  const openEdit = (room: ConferenceRoom) => {
    setEditing(room);
    setForm({
      number: room.number,
      name: room.name,
      pin: room.pin ?? "",
      max_members: String(room.max_members),
      muted: room.muted,
      record: room.record,
      active: room.active,
      description: room.description ?? "",
    });
    setFormError("");
    setFieldErrors({});
    setFormOpen(true);
  };

  const update = <K extends keyof ConferenceForm>(key: K, value: ConferenceForm[K]) => {
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
    if (form.pin.trim() && !/^\d{4,8}$/.test(form.pin.trim())) {
      errors.pin = "Use 4–8 digits or leave blank.";
    }
    const max = Number(form.max_members);
    if (!Number.isInteger(max) || max < 1 || max > 100) {
      errors.max_members = "1–100 participants.";
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
        name: form.name.trim(),
        pin: form.pin.trim(),
        max_members: Number(form.max_members),
        muted: form.muted,
        record: form.record,
        active: form.active,
        description: form.description.trim(),
      };
      if (editing) {
        await apiPatch<ConferenceRoom>(`/api/v1/conferences/${editing.id}`, payload);
        toast.success("Conference room updated");
      } else {
        payload.number = form.number.trim();
        await apiPost<ConferenceRoom>("/api/v1/conferences", payload);
        toast.success("Conference room created");
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
      await apiDelete(`/api/v1/conferences/${deleteTarget.id}`);
      toast.success("Conference room deleted");
      setDeleteTarget(null);
      list.refresh();
    } catch (caught) {
      toast.error("Could not delete room", errorMessage(caught));
    } finally {
      setDeleting(false);
    }
  };

  const download = async (room: ConferenceRoom) => {
    setDownloading(room.id);
    try {
      await apiDownload(
        `/api/v1/conferences/${room.id}/dialplan`,
        `conference-${room.number}.conf`,
      );
      toast.success("Conference dialplan downloaded");
    } catch (caught) {
      toast.error("Download failed", errorMessage(caught));
    } finally {
      setDownloading(null);
    }
  };

  const columns: Column<ConferenceRoom>[] = [
    {
      key: "room",
      header: "Conference",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-white/[0.04] text-neutral-300">
            <Presentation className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="mono text-sm font-semibold text-neutral-100">{row.number}</p>
            <p className="truncate text-[11px] text-neutral-500">
              {row.name || "Unnamed room"}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "pin",
      header: "PIN",
      render: (row) => (
        <span className="mono text-xs text-neutral-500">{row.pin ? "••••" : "Open"}</span>
      ),
    },
    {
      key: "max_members",
      header: "Capacity",
      align: "right",
      render: (row) => (
        <span className="mono text-xs text-neutral-400">{row.max_members} people</span>
      ),
    },
    {
      key: "flags",
      header: "Mode",
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          <Badge tone={row.muted ? "warning" : "neutral"}>
            {row.muted ? "Muted join" : "Unmuted"}
          </Badge>
          <Badge tone={row.record ? "danger" : "neutral"}>
            {row.record ? "Recording" : "No recording"}
          </Badge>
        </div>
      ),
    },
    {
      key: "description",
      header: "Description",
      render: (row) => (
        <span className="block max-w-[220px] truncate text-xs text-neutral-500">
          {row.description || "—"}
        </span>
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
          {can("conferences.write") ? (
            <>
              <IconButton label="Edit room" onClick={() => openEdit(row)}>
                <Pencil className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                label="Delete room"
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
        title="Conference rooms"
        description="ConfBridge rooms with PINs, participant limits and recording options."
        actions={
          can("conferences.write") ? (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
              New room
            </Button>
          ) : undefined
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-line/70 p-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            items={[
              { id: "rooms", label: "Rooms", count: meta?.total },
              {
                id: "live",
                label: "Live rooms",
                count: live.data?.configured ? liveRooms.length : undefined,
              },
            ]}
            active={tab}
            onChange={setTab}
            className="border-0 pb-0"
          />
          {tab === "rooms" ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <SearchInput
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setPage(1);
                }}
                placeholder="Search rooms…"
                className="sm:w-64"
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
          ) : (
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={live.refresh}
            >
              Refresh live data
            </Button>
          )}
        </div>

        {tab === "rooms" ? (
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
                    icon={<Presentation className="h-6 w-6" />}
                    title={search || activeFilter ? "No matching rooms" : "No conference rooms yet"}
                    description={
                      search || activeFilter
                        ? "Try a different search or clear the filter."
                        : "Create a room for team meetings and group calls."
                    }
                    action={
                      can("conferences.write") && !search && !activeFilter ? (
                        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                          New room
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
        ) : live.error && !live.data ? (
          <ErrorPanel message={live.error.message} onRetry={live.refresh} />
        ) : !live.data?.configured ? (
          <EmptyState
            icon={<WifiOff className="h-6 w-6" />}
            title="Live conference data requires Asterisk"
            description="AMI/ARI is not configured. Room configuration is still fully managed in PostgreSQL; participants appear when ConfBridge is active."
          />
        ) : liveRooms.length === 0 ? (
          <EmptyState
            icon={<Presentation className="h-6 w-6" />}
            title="No active conferences"
            description="Asterisk reports no participants in any ConfBridge room."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
            {liveRooms.map((room) => (
              <div key={room.room} className="panel-muted overflow-hidden">
                <div className="flex items-center justify-between gap-2 border-b border-line/60 px-4 py-3">
                  <div>
                    <p className="mono text-sm font-semibold text-white">{room.room}</p>
                    <p className="text-[11px] text-neutral-500">
                      {formatNumber(room.members?.length ?? 0)} participants
                    </p>
                  </div>
                  <Badge tone="success" dot>
                    Live
                  </Badge>
                </div>
                <div className="divide-y divide-line/40">
                  {(room.members ?? []).length === 0 ? (
                    <p className="px-4 py-4 text-xs text-neutral-600">No participants.</p>
                  ) : (
                    (room.members ?? []).map((member, index) => (
                      <div
                        key={`${member.channel}-${index}`}
                        className="flex items-center gap-2 px-4 py-2.5"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-white/[0.04] text-neutral-400">
                          {member.muted ? (
                            <MicOff className="h-3.5 w-3.5" />
                          ) : (
                            <Mic className="h-3.5 w-3.5" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs text-neutral-200">
                            {member.caller_id_name || member.caller_id_num || "Unknown caller"}
                          </p>
                          <p className="mono truncate text-[10px] text-neutral-600">
                            {member.channel || "—"}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          {member.admin ? <Badge tone="warning">Admin</Badge> : null}
                          {member.muted ? <Badge tone="neutral">Muted</Badge> : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Alert tone="info" title="Conference dialplan">
        Download a generated dialplan snippet for any room and include it in the PBX
        configuration. With AMI configured, rooms are also mirrored into the realtime
        conference tables.
      </Alert>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit room ${editing.number}` : "New conference room"}
        description="The room number is the dialable extension for the conference."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="conference-form" variant="primary" loading={saving}>
              {editing ? "Save changes" : "Create room"}
            </Button>
          </>
        }
      >
        <form id="conference-form" onSubmit={submit} className="space-y-4">
          {formError ? (
            <Alert tone="danger" title="Could not save room">
              {formError}
            </Alert>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Room number"
              required
              error={fieldErrors.number}
              hint={editing ? "The number cannot be changed." : undefined}
            >
              <Input
                value={form.number}
                onChange={(event) => update("number", event.target.value)}
                placeholder="8000"
                inputMode="numeric"
                disabled={Boolean(editing)}
                className="mono"
              />
            </Field>
            <Field label="Display name">
              <Input
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
                placeholder="Team standup"
              />
            </Field>
            <Field label="PIN" error={fieldErrors.pin} hint="Optional 4–8 digit participant PIN.">
              <Input
                value={form.pin}
                onChange={(event) => update("pin", event.target.value)}
                placeholder="Optional"
                inputMode="numeric"
                className="mono"
              />
            </Field>
            <Field label="Max members" required error={fieldErrors.max_members}>
              <Input
                value={form.max_members}
                onChange={(event) => update("max_members", event.target.value)}
                inputMode="numeric"
                className="mono"
              />
            </Field>
          </div>

          <Field label="Description">
            <Input
              value={form.description}
              onChange={(event) => update("description", event.target.value)}
              placeholder="Optional note"
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Toggle
              checked={form.muted}
              onChange={(value) => update("muted", value)}
              label="Muted on join"
              description="Participants join with their microphone muted."
            />
            <Toggle
              checked={form.record}
              onChange={(value) => update("record", value)}
              label="Record conference"
              description="Record the room when supported by the PBX."
            />
          </div>

          <Toggle
            checked={form.active}
            onChange={(value) => update("active", value)}
            label="Room active"
            description="Inactive rooms remain configured but are not dialable."
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
        title={`Delete room ${deleteTarget?.number ?? ""}?`}
        description="The conference room and its realtime configuration will be removed."
        confirmLabel="Delete room"
        loading={deleting}
        requireText={deleteTarget?.number}
      />
    </div>
  );
}
