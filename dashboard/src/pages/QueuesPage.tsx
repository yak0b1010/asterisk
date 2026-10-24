import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Headphones,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Trash2,
  UserPlus,
  Users,
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
  apiPatch,
  apiPost,
  buildQuery,
  errorMessage,
} from "../lib/api";
import type { Queue, QueueLiveStatus, QueueMember } from "../lib/types";
import { formatClock, formatNumber, statusTone, titleCase } from "../lib/format";
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

const STRATEGIES = [
  "ringall",
  "leastrecent",
  "fewestcalls",
  "random",
  "rrmemory",
  "linear",
  "wrandom",
  "rrordered",
];

interface ReloadResult {
  reloaded: boolean;
  component: string;
  configured: boolean;
  message?: string;
}

interface QueueForm {
  name: string;
  strategy: string;
  timeout: string;
  max_wait: string;
  announce_frequency: string;
  music_on_hold: string;
  announce: string;
  ring_in_use: boolean;
  description: string;
  active: boolean;
}

const EMPTY_FORM: QueueForm = {
  name: "",
  strategy: "ringall",
  timeout: "30",
  max_wait: "0",
  announce_frequency: "0",
  music_on_hold: "",
  announce: "",
  ring_in_use: false,
  description: "",
  active: true,
};

interface LiveMember {
  name?: string;
  location?: string;
  membership?: string;
  status?: string;
  paused?: boolean;
  penalty?: number;
  calls_taken?: number;
  in_call?: boolean;
}

interface LiveEntry {
  position?: number;
  channel?: string;
  caller_id_num?: string;
  caller_id_name?: string;
  wait?: string;
}

interface LiveQueue {
  name: string;
  strategy?: string;
  max?: number;
  calls?: number;
  hold_time?: number;
  talk_time?: number;
  completed?: number;
  abandoned?: number;
  service_level?: number;
  service_level_perf?: string;
  members?: LiveMember[];
  entries?: LiveEntry[];
}

export default function QueuesPage() {
  useDocumentTitle("Queues");
  const { can } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState("queues");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [strategy, setStrategy] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const debouncedSearch = useDebouncedValue(search);

  const list = useApiQuery<Queue[]>(
    `/api/v1/queues${buildQuery({
      page,
      limit: LIMIT,
      search: debouncedSearch,
      strategy,
      active: activeFilter,
    })}`,
  );
  const live = useApiQuery<QueueLiveStatus>("/api/v1/queues/status");

  useInterval(() => {
    if (tab === "live") live.refresh();
  }, 15000);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Queue | null>(null);
  const [form, setForm] = useState<QueueForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<Queue | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reloading, setReloading] = useState(false);

  const [membersQueue, setMembersQueue] = useState<Queue | null>(null);
  const members = useApiQuery<QueueMember[]>(
    membersQueue ? `/api/v1/queues/${membersQueue.id}/members` : null,
  );
  const [memberForm, setMemberForm] = useState({
    interface: "",
    member_name: "",
    penalty: "0",
    paused: false,
  });
  const [addingMember, setAddingMember] = useState(false);
  const [memberError, setMemberError] = useState("");
  const [memberEdit, setMemberEdit] = useState<QueueMember | null>(null);
  const [memberEditForm, setMemberEditForm] = useState({
    member_name: "",
    penalty: "0",
    paused: false,
  });
  const [savingMember, setSavingMember] = useState(false);
  const [removeMemberTarget, setRemoveMemberTarget] = useState<QueueMember | null>(null);
  const [removingMember, setRemovingMember] = useState(false);

  useEffect(() => {
    if (page > 1 && list.meta && page > list.meta.pages && list.meta.pages > 0) {
      setPage(list.meta.pages);
    }
  }, [list.meta, page]);

  const liveQueues = useMemo(
    () => (live.data?.queues ?? []) as unknown as LiveQueue[],
    [live.data],
  );

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setFieldErrors({});
    setFormOpen(true);
  };

  const openEdit = (queue: Queue) => {
    setEditing(queue);
    setForm({
      name: queue.name,
      strategy: queue.strategy,
      timeout: String(queue.timeout),
      max_wait: String(queue.max_wait),
      announce_frequency: String(queue.announce_frequency),
      music_on_hold: queue.music_on_hold ?? "",
      announce: queue.announce ?? "",
      ring_in_use: queue.ring_in_use,
      description: queue.description ?? "",
      active: queue.active,
    });
    setFormError("");
    setFieldErrors({});
    setFormOpen(true);
  };

  const update = <K extends keyof QueueForm>(key: K, value: QueueForm[K]) => {
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
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(form.name.trim())) {
      errors.name = "1–128 letters, digits, dot, underscore or hyphen.";
    }
    const timeout = Number(form.timeout);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 3600) {
      errors.timeout = "1–3600 seconds.";
    }
    const maxWait = Number(form.max_wait);
    if (!Number.isInteger(maxWait) || maxWait < 0 || maxWait > 86400) {
      errors.max_wait = "0–86400 seconds.";
    }
    const announce = Number(form.announce_frequency);
    if (!Number.isInteger(announce) || announce < 0 || announce > 3600) {
      errors.announce_frequency = "0–3600 seconds.";
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
        strategy: form.strategy,
        timeout: Number(form.timeout),
        max_wait: Number(form.max_wait),
        announce_frequency: Number(form.announce_frequency),
        music_on_hold: form.music_on_hold.trim(),
        announce: form.announce.trim(),
        ring_in_use: form.ring_in_use,
        description: form.description.trim(),
        active: form.active,
      };
      if (editing) {
        await apiPatch<Queue>(`/api/v1/queues/${editing.id}`, payload);
        toast.success("Queue updated", `Queue ${form.name} was saved.`);
      } else {
        await apiPost<Queue>("/api/v1/queues", payload);
        toast.success("Queue created", `Queue ${form.name} was added.`);
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
      await apiDelete(`/api/v1/queues/${deleteTarget.id}`);
      toast.success("Queue deleted");
      setDeleteTarget(null);
      list.refresh();
    } catch (caught) {
      toast.error("Could not delete queue", errorMessage(caught));
    } finally {
      setDeleting(false);
    }
  };

  const reload = async () => {
    setReloading(true);
    try {
      const result = await apiPost<ReloadResult>("/api/v1/queues/reload");
      if (result.configured) {
        toast.success("Queue reload requested");
      } else {
        toast.info("Stored in PostgreSQL only", result.message ?? "Asterisk is not configured.");
      }
    } catch (caught) {
      toast.error("Reload failed", errorMessage(caught));
    } finally {
      setReloading(false);
    }
  };

  const openMembers = (queue: Queue) => {
    setMembersQueue(queue);
    setMemberForm({ interface: "", member_name: "", penalty: "0", paused: false });
    setMemberError("");
  };

  const addMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!membersQueue) return;
    const iface = memberForm.interface.trim();
    if (!iface || !iface.includes("/")) {
      setMemberError("Interface is required, for example PJSIP/1001.");
      return;
    }
    const penalty = Number(memberForm.penalty);
    if (!Number.isInteger(penalty) || penalty < 0 || penalty > 100) {
      setMemberError("Penalty must be between 0 and 100.");
      return;
    }
    setAddingMember(true);
    setMemberError("");
    try {
      await apiPost<QueueMember>(`/api/v1/queues/${membersQueue.id}/members`, {
        interface: iface,
        member_name: memberForm.member_name.trim(),
        penalty,
        paused: memberForm.paused,
      });
      toast.success("Member added", `${iface} joined ${membersQueue.name}.`);
      setMemberForm({ interface: "", member_name: "", penalty: "0", paused: false });
      members.refresh();
      list.refresh();
    } catch (caught) {
      setMemberError(errorMessage(caught));
    } finally {
      setAddingMember(false);
    }
  };

  const toggleMemberPaused = async (member: QueueMember) => {
    if (!membersQueue) return;
    try {
      await apiPatch<QueueMember>(
        `/api/v1/queues/${membersQueue.id}/members/${member.id}`,
        { paused: !member.paused },
      );
      members.refresh();
      toast.success(
        member.paused ? "Member resumed" : "Member paused",
        `${member.interface} is now ${member.paused ? "available" : "paused"}.`,
      );
    } catch (caught) {
      toast.error("Could not update member", errorMessage(caught));
    }
  };

  const openMemberEdit = (member: QueueMember) => {
    setMemberEdit(member);
    setMemberEditForm({
      member_name: member.member_name ?? "",
      penalty: String(member.penalty),
      paused: member.paused,
    });
  };

  const saveMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!membersQueue || !memberEdit) return;
    const penalty = Number(memberEditForm.penalty);
    if (!Number.isInteger(penalty) || penalty < 0 || penalty > 100) {
      toast.error("Invalid penalty", "Use a number between 0 and 100.");
      return;
    }
    setSavingMember(true);
    try {
      await apiPatch<QueueMember>(
        `/api/v1/queues/${membersQueue.id}/members/${memberEdit.id}`,
        {
          member_name: memberEditForm.member_name.trim(),
          penalty,
          paused: memberEditForm.paused,
        },
      );
      toast.success("Member updated");
      setMemberEdit(null);
      members.refresh();
    } catch (caught) {
      toast.error("Could not update member", errorMessage(caught));
    } finally {
      setSavingMember(false);
    }
  };

  const removeMember = async () => {
    if (!membersQueue || !removeMemberTarget) return;
    setRemovingMember(true);
    try {
      await apiDelete(
        `/api/v1/queues/${membersQueue.id}/members/${removeMemberTarget.id}`,
      );
      toast.success("Member removed");
      setRemoveMemberTarget(null);
      members.refresh();
      list.refresh();
    } catch (caught) {
      toast.error("Could not remove member", errorMessage(caught));
    } finally {
      setRemovingMember(false);
    }
  };

  const columns: Column<Queue>[] = [
    {
      key: "name",
      header: "Queue",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-white/[0.04] text-neutral-300">
            <Headphones className="h-3.5 w-3.5" />
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
      key: "strategy",
      header: "Strategy",
      render: (row) => <Badge tone="accent">{titleCase(row.strategy)}</Badge>,
    },
    {
      key: "timeout",
      header: "Ring timeout",
      align: "right",
      render: (row) => <span className="mono text-xs text-neutral-400">{row.timeout}s</span>,
    },
    {
      key: "max_wait",
      header: "Max wait",
      align: "right",
      render: (row) => (
        <span className="mono text-xs text-neutral-400">
          {row.max_wait > 0 ? formatClock(row.max_wait) : "Unlimited"}
        </span>
      ),
    },
    {
      key: "members",
      header: "Members",
      align: "center",
      render: (row) => (
        <button
          type="button"
          onClick={() => openMembers(row)}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold text-neutral-300 transition hover:border-neutral-500/40 hover:text-neutral-300"
        >
          <Users className="h-3 w-3" />
          {row.members_count}
        </button>
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
          <IconButton label="Manage members" onClick={() => openMembers(row)}>
            <Users className="h-3.5 w-3.5" />
          </IconButton>
          {can("queues.write") ? (
            <>
              <IconButton label="Edit queue" onClick={() => openEdit(row)}>
                <Pencil className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                label="Delete queue"
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

  const memberColumns: Column<QueueMember>[] = [
    {
      key: "interface",
      header: "Interface",
      render: (row) => (
        <div>
          <p className="mono text-xs font-medium text-neutral-200">{row.interface}</p>
          <p className="text-[10px] text-neutral-500">{row.member_name || "Unnamed member"}</p>
        </div>
      ),
    },
    {
      key: "penalty",
      header: "Penalty",
      align: "center",
      render: (row) => <span className="mono text-xs text-neutral-400">{row.penalty}</span>,
    },
    {
      key: "paused",
      header: "Status",
      render: (row) => (
        <Badge tone={row.paused ? "warning" : "success"} dot>
          {row.paused ? "Paused" : "Available"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) =>
        can("queues.write") ? (
          <div className="flex items-center justify-end gap-0.5">
            <IconButton
              label={row.paused ? "Resume member" : "Pause member"}
              onClick={() => void toggleMemberPaused(row)}
            >
              {row.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </IconButton>
            <IconButton label="Edit member" onClick={() => openMemberEdit(row)}>
              <Pencil className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              label="Remove member"
              className="hover:bg-neutral-500/10 hover:text-neutral-300"
              onClick={() => setRemoveMemberTarget(row)}
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
        title="Call queues"
        description="Ring strategies, members and live queue activity for the contact center."
        actions={
          <>
            {can("queues.write") ? (
              <Button
                variant="secondary"
                icon={<RotateCw className="h-4 w-4" />}
                onClick={() => void reload()}
                loading={reloading}
              >
                Reload
              </Button>
            ) : null}
            {can("queues.write") ? (
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                New queue
              </Button>
            ) : null}
          </>
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-line/70 p-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            items={[
              { id: "queues", label: "Queues", count: meta?.total },
              {
                id: "live",
                label: "Live status",
                count: live.data?.configured ? liveQueues.length : undefined,
              },
            ]}
            active={tab}
            onChange={setTab}
            className="border-0 pb-0"
          />
          {tab === "queues" ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <SearchInput
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setPage(1);
                }}
                placeholder="Search queues…"
                className="sm:w-56"
              />
              <Select
                value={strategy}
                onChange={(event) => {
                  setStrategy(event.target.value);
                  setPage(1);
                }}
                className="h-9.5 sm:w-40"
                aria-label="Filter by strategy"
              >
                <option value="">All strategies</option>
                {STRATEGIES.map((item) => (
                  <option key={item} value={item}>
                    {titleCase(item)}
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

        {tab === "queues" ? (
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
                    icon={<Headphones className="h-6 w-6" />}
                    title={search || strategy || activeFilter ? "No matching queues" : "No queues yet"}
                    description={
                      search || strategy || activeFilter
                        ? "Adjust the filters to see more queues."
                        : "Create a queue to distribute incoming calls across agents."
                    }
                    action={
                      can("queues.write") && !search && !strategy && !activeFilter ? (
                        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                          New queue
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
            title="Live queue data requires Asterisk"
            description="AMI/ARI is not configured. Queue configuration is still fully managed in PostgreSQL; live callers and member states appear when the PBX is connected."
          />
        ) : liveQueues.length === 0 ? (
          <EmptyState
            icon={<Headphones className="h-6 w-6" />}
            title="No live queues"
            description="Asterisk reports no active queues. Make sure queues are loaded in the PBX."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-2">
            {liveQueues.map((queue) => (
              <div key={queue.name} className="panel-muted overflow-hidden">
                <div className="flex items-start justify-between gap-3 border-b border-line/60 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{queue.name}</p>
                    <p className="text-[11px] text-neutral-500">
                      {titleCase(queue.strategy || "unknown")} strategy
                    </p>
                  </div>
                  <Badge tone={statusTone(queue.calls ? "active" : "idle")} dot>
                    {formatNumber(queue.calls ?? 0)} waiting
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 border-b border-line/60 px-4 py-3 text-center">
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-neutral-600">Hold</p>
                    <p className="mono mt-0.5 text-sm font-semibold text-neutral-200">
                      {formatClock(queue.hold_time ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-neutral-600">Talk</p>
                    <p className="mono mt-0.5 text-sm font-semibold text-neutral-200">
                      {formatClock(queue.talk_time ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-neutral-600">Completed</p>
                    <p className="mono mt-0.5 text-sm font-semibold text-neutral-200">
                      {formatNumber(queue.completed ?? 0)}
                    </p>
                  </div>
                </div>

                <div className="px-4 py-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                    Members
                  </p>
                  {(queue.members ?? []).length === 0 ? (
                    <p className="text-xs text-neutral-600">No members reported.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {(queue.members ?? []).map((member, index) => (
                        <div
                          key={`${member.location}-${index}`}
                          className="flex items-center justify-between gap-2 rounded-md border border-line/50 bg-white/[0.03] px-2.5 py-1.5"
                        >
                          <div className="min-w-0">
                            <p className="mono truncate text-[11px] text-neutral-300">
                              {member.name || member.location || "—"}
                            </p>
                            <p className="text-[10px] text-neutral-600">
                              {member.calls_taken ?? 0} calls · penalty {member.penalty ?? 0}
                            </p>
                          </div>
                          <Badge
                            tone={
                              member.in_call
                                ? "info"
                                : member.paused
                                  ? "warning"
                                  : statusTone(member.status || "unknown")
                            }
                          >
                            {member.in_call
                              ? "On call"
                              : member.paused
                                ? "Paused"
                                : titleCase(member.status || "unknown")}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {(queue.entries ?? []).length > 0 ? (
                  <div className="border-t border-line/60 px-4 py-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                      Waiting callers
                    </p>
                    <div className="space-y-1">
                      {(queue.entries ?? []).map((entry, index) => (
                        <div
                          key={`${entry.channel}-${index}`}
                          className="flex items-center justify-between gap-2 text-[11px]"
                        >
                          <span className="mono text-neutral-400">
                            #{entry.position ?? index + 1} · {entry.caller_id_num || "unknown"}
                          </span>
                          <span className="text-neutral-600">{entry.wait || "—"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit queue ${editing.name}` : "New call queue"}
        description="Members are managed separately after the queue is created."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="queue-form" variant="primary" loading={saving}>
              {editing ? "Save changes" : "Create queue"}
            </Button>
          </>
        }
      >
        <form id="queue-form" onSubmit={submit} className="space-y-4">
          {formError ? (
            <Alert tone="danger" title="Could not save queue">
              {formError}
            </Alert>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Queue name" required error={fieldErrors.name}>
              <Input
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
                placeholder="support"
                className="mono"
              />
            </Field>
            <Field label="Strategy">
              <Select
                value={form.strategy}
                onChange={(event) => update("strategy", event.target.value)}
              >
                {STRATEGIES.map((item) => (
                  <option key={item} value={item}>
                    {titleCase(item)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Ring timeout" required error={fieldErrors.timeout} hint="Seconds per member.">
              <Input
                value={form.timeout}
                onChange={(event) => update("timeout", event.target.value)}
                inputMode="numeric"
                className="mono"
              />
            </Field>
            <Field label="Max wait" error={fieldErrors.max_wait} hint="0 means unlimited.">
              <Input
                value={form.max_wait}
                onChange={(event) => update("max_wait", event.target.value)}
                inputMode="numeric"
                className="mono"
              />
            </Field>
            <Field label="Music on hold">
              <Input
                value={form.music_on_hold}
                onChange={(event) => update("music_on_hold", event.target.value)}
                placeholder="default"
                className="mono"
              />
            </Field>
            <Field
              label="Announce frequency"
              error={fieldErrors.announce_frequency}
              hint="Seconds between position announcements; 0 disables."
            >
              <Input
                value={form.announce_frequency}
                onChange={(event) => update("announce_frequency", event.target.value)}
                inputMode="numeric"
                className="mono"
              />
            </Field>
            <Field label="Announcement sound">
              <Input
                value={form.announce}
                onChange={(event) => update("announce", event.target.value)}
                placeholder="queue-thankyou"
                className="mono"
              />
            </Field>
            <Field label="Description">
              <Input
                value={form.description}
                onChange={(event) => update("description", event.target.value)}
                placeholder="Customer support line"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Toggle
              checked={form.active}
              onChange={(value) => update("active", value)}
              label="Queue active"
              description="Inactive queues are removed from live routing."
            />
            <Toggle
              checked={form.ring_in_use}
              onChange={(value) => update("ring_in_use", value)}
              label="Ring members already on a call"
              description="Also known as ringinuse."
            />
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(membersQueue)}
        onClose={() => setMembersQueue(null)}
        title={membersQueue ? `Members of ${membersQueue.name}` : "Queue members"}
        description="Members can be paused without removing them from the queue."
        size="xl"
        footer={
          <Button variant="secondary" onClick={() => setMembersQueue(null)}>
            Close
          </Button>
        }
      >
        <div className="space-y-5">
          {can("queues.write") ? (
            <form
              onSubmit={addMember}
              className="rounded-xl border border-line/70 bg-white/[0.03] p-3.5"
            >
              <div className="mb-2.5 flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-neutral-300" />
                <p className="text-xs font-semibold text-neutral-200">Add a member</p>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1.2fr_1fr_0.6fr_auto] sm:items-end">
                <Field label="Interface" required>
                  <Input
                    value={memberForm.interface}
                    onChange={(event) =>
                      setMemberForm((current) => ({ ...current, interface: event.target.value }))
                    }
                    placeholder="PJSIP/1001"
                    className="mono"
                  />
                </Field>
                <Field label="Display name">
                  <Input
                    value={memberForm.member_name}
                    onChange={(event) =>
                      setMemberForm((current) => ({ ...current, member_name: event.target.value }))
                    }
                    placeholder="Reception"
                  />
                </Field>
                <Field label="Penalty">
                  <Input
                    value={memberForm.penalty}
                    onChange={(event) =>
                      setMemberForm((current) => ({ ...current, penalty: event.target.value }))
                    }
                    inputMode="numeric"
                    className="mono"
                  />
                </Field>
                <Button
                  type="submit"
                  variant="primary"
                  loading={addingMember}
                  icon={<Plus className="h-4 w-4" />}
                >
                  Add
                </Button>
              </div>
              <div className="mt-2.5">
                <Toggle
                  checked={memberForm.paused}
                  onChange={(value) => setMemberForm((current) => ({ ...current, paused: value }))}
                  label="Start paused"
                  description="Add the member without making them available for calls."
                />
              </div>
              {memberError ? (
                <p className="mt-2 text-xs font-medium text-neutral-400">{memberError}</p>
              ) : null}
            </form>
          ) : null}

          {members.error && !members.data ? (
            <ErrorPanel message={members.error.message} onRetry={members.refresh} />
          ) : (
            <div className="overflow-hidden rounded-xl border border-line/70">
              <DataTable
                columns={memberColumns}
                rows={members.data ?? []}
                rowKey={(row) => row.id}
                loading={members.loading}
                dense
                empty={
                  <EmptyState
                    icon={<Users className="h-6 w-6" />}
                    title="No members in this queue"
                    description="Add an endpoint interface such as PJSIP/1001 to distribute calls."
                  />
                }
              />
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(memberEdit)}
        onClose={() => setMemberEdit(null)}
        title={memberEdit ? `Edit ${memberEdit.interface}` : "Edit member"}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMemberEdit(null)} disabled={savingMember}>
              Cancel
            </Button>
            <Button type="submit" form="member-form" variant="primary" loading={savingMember}>
              Save member
            </Button>
          </>
        }
      >
        <form id="member-form" onSubmit={saveMember} className="space-y-4">
          <Field label="Display name">
            <Input
              value={memberEditForm.member_name}
              onChange={(event) =>
                setMemberEditForm((current) => ({ ...current, member_name: event.target.value }))
              }
              placeholder="Reception"
            />
          </Field>
          <Field label="Penalty" hint="Lower values are tried first.">
            <Input
              value={memberEditForm.penalty}
              onChange={(event) =>
                setMemberEditForm((current) => ({ ...current, penalty: event.target.value }))
              }
              inputMode="numeric"
              className="mono"
            />
          </Field>
          <Toggle
            checked={memberEditForm.paused}
            onChange={(value) => setMemberEditForm((current) => ({ ...current, paused: value }))}
            label="Paused"
            description="Paused members stay in the queue but receive no calls."
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
        title={`Delete queue ${deleteTarget?.name ?? ""}?`}
        description="The queue and all of its member assignments will be removed."
        confirmLabel="Delete queue"
        loading={deleting}
        requireText={deleteTarget?.name}
      />

      <ConfirmDialog
        open={Boolean(removeMemberTarget)}
        onClose={() => setRemoveMemberTarget(null)}
        onConfirm={() => void removeMember()}
        title={`Remove ${removeMemberTarget?.interface ?? "member"}?`}
        description="The member will no longer receive calls from this queue."
        confirmLabel="Remove member"
        loading={removingMember}
      />
    </div>
  );
}
