import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  DatabaseBackup,
  Download,
  FileArchive,
  HardDrive,
  Plus,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useApiQuery } from "../hooks/useApiQuery";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useToast } from "../context/ToastContext";
import {
  apiDelete,
  apiDownload,
  apiPost,
  buildQuery,
  errorMessage,
} from "../lib/api";
import type { Backup, BackupRestoreResult } from "../lib/types";
import {
  formatBytes,
  formatDateTime,
  formatNumber,
  formatRelative,
  type Tone,
} from "../lib/format";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { Button, IconButton } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { DataTable, type Column } from "../components/ui/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorPanel } from "../components/ErrorPanel";
import { Toggle } from "../components/ui/Field";
import { KeyValue } from "../components/ui/KeyValue";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { Pagination } from "../components/ui/Pagination";
import { Select } from "../components/ui/Field";
import { StatCard } from "../components/ui/StatCard";

const LIMIT = 20;

const STATUS_TONES: Record<string, Tone> = {
  completed: "success",
  failed: "danger",
  running: "warning",
};

function statusTone(status: string): Tone {
  return STATUS_TONES[status] ?? "neutral";
}

function includesList(backup: Backup): string[] {
  return (backup.includes || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function BackupsPage() {
  useDocumentTitle("Backups");
  const { can, refreshUser } = useAuth();
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");

  const list = useApiQuery<Backup[]>(
    `/api/v1/backups${buildQuery({ page, limit: LIMIT, status: statusFilter })}`,
  );
  const summary = useApiQuery<Backup[]>("/api/v1/backups?limit=100");

  const [createOpen, setCreateOpen] = useState(false);
  const [includeCdr, setIncludeCdr] = useState(false);
  const [creating, setCreating] = useState(false);

  const [downloadTarget, setDownloadTarget] = useState<Backup | null>(null);

  const [restoreTarget, setRestoreTarget] = useState<Backup | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<BackupRestoreResult | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Backup | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (page > 1 && list.meta && page > list.meta.pages && list.meta.pages > 0) {
      setPage(list.meta.pages);
    }
  }, [list.meta, page]);

  const backups = summary.data ?? [];
  const completed = backups.filter((backup) => backup.status === "completed");
  const failed = backups.filter((backup) => backup.status === "failed");
  const totalBytes = completed.reduce((sum, backup) => sum + backup.size_bytes, 0);
  const latest = completed
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

  const restoreIncludesCdr = useMemo(() => {
    if (!restoreTarget) return false;
    return includesList(restoreTarget).includes("cdr");
  }, [restoreTarget]);

  const createBackup = async () => {
    setCreating(true);
    try {
      const backup = await apiPost<Backup>("/api/v1/backups", {
        include_cdr: includeCdr,
      });
      toast.success(
        "Backup created",
        `${backup.filename} · ${formatBytes(backup.size_bytes)}`,
      );
      setCreateOpen(false);
      list.refresh();
      summary.refresh();
    } catch (caught) {
      toast.error("Backup failed", errorMessage(caught));
    } finally {
      setCreating(false);
    }
  };

  const download = async (backup: Backup) => {
    setDownloadTarget(backup);
    try {
      await apiDownload(
        `/api/v1/backups/${backup.id}/download`,
        backup.filename || "backup.json.gz",
      );
      toast.success("Download started", backup.filename);
    } catch (caught) {
      toast.error("Could not download backup", errorMessage(caught));
    } finally {
      setDownloadTarget(null);
    }
  };

  const restore = async () => {
    if (!restoreTarget) return;
    setRestoring(true);
    try {
      const result = await apiPost<BackupRestoreResult>(
        `/api/v1/backups/${restoreTarget.id}/restore`,
      );
      setRestoreTarget(null);
      setRestoreResult(result);
      if (result.realtime_synced) {
        toast.success("Configuration restored", result.filename);
      } else {
        toast.error(
          "Restored with realtime warnings",
          result.realtime_error || "Asterisk realtime tables could not be synchronized.",
        );
      }
      list.refresh();
      summary.refresh();
      try {
        await refreshUser();
      } catch {
        // A restore can remove the current account; the auth layer handles sign-out.
      }
    } catch (caught) {
      toast.error("Restore failed", errorMessage(caught));
    } finally {
      setRestoring(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/v1/backups/${deleteTarget.id}`);
      toast.success("Backup deleted", deleteTarget.filename);
      setDeleteTarget(null);
      list.refresh();
      summary.refresh();
    } catch (caught) {
      toast.error("Could not delete backup", errorMessage(caught));
    } finally {
      setDeleting(false);
    }
  };

  const columns: Column<Backup>[] = [
    {
      key: "backup",
      header: "Backup",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-white/[0.04] text-neutral-300">
            <FileArchive className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="mono max-w-[320px] truncate text-xs font-semibold text-neutral-100" title={row.filename}>
              {row.filename || "Pending file…"}
            </p>
            <p className="mono text-[10px] text-neutral-600">{row.id.slice(0, 8)}</p>
          </div>
        </div>
      ),
    },
    {
      key: "created",
      header: "Created",
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
      key: "size",
      header: "Size",
      align: "right",
      render: (row) => (
        <span className="mono text-xs text-neutral-400">
          {row.status === "completed" ? formatBytes(row.size_bytes) : "—"}
        </span>
      ),
    },
    {
      key: "includes",
      header: "Contents",
      render: (row) => {
        const items = includesList(row);
        const cdr = items.includes("cdr");
        return (
          <div className="flex flex-wrap items-center gap-1" title={items.join(", ")}>
            <Badge tone="accent">{items.length - (cdr ? 1 : 0)} sections</Badge>
            {cdr ? <Badge tone="info">CDR</Badge> : null}
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <div>
          <Badge tone={statusTone(row.status)} dot>
            {row.status}
          </Badge>
          {row.error ? (
            <p className="mt-1 max-w-[220px] truncate text-[10px] text-neutral-400" title={row.error}>
              {row.error}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "created_by",
      header: "Created by",
      render: (row) => (
        <span className="text-xs text-neutral-400">{row.created_by || "system"}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-0.5">
          <IconButton
            label="Download backup"
            disabled={row.status !== "completed"}
            onClick={() => void download(row)}
          >
            <Download
              className={
                downloadTarget?.id === row.id ? "h-3.5 w-3.5 animate-pulse" : "h-3.5 w-3.5"
              }
            />
          </IconButton>
          {can("backups.write") ? (
            <>
              <IconButton
                label="Restore backup"
                disabled={row.status !== "completed"}
                onClick={() => setRestoreTarget(row)}
              >
                <RotateCw className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                label="Delete backup"
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
        eyebrow="Operations"
        title="Backups"
        description="Gzipped JSON snapshots of the PostgreSQL configuration, with optional call records."
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
            {can("backups.write") ? (
              <Button
                variant="primary"
                icon={<Plus className="h-4 w-4" />}
                onClick={() => {
                  setIncludeCdr(false);
                  setCreateOpen(true);
                }}
              >
                Create backup
              </Button>
            ) : null}
          </>
        }
      />

      <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Stored backups"
          value={formatNumber(summary.meta?.total ?? backups.length)}
          sub={`${failed.length} failed · ${backups.filter((backup) => backup.status === "running").length} running`}
          icon={<DatabaseBackup className="h-4.5 w-4.5" />}
          tone="accent"
        />
        <StatCard
          label="Completed"
          value={formatNumber(completed.length)}
          sub="Ready to download or restore"
          icon={<CheckCircle2 className="h-4.5 w-4.5" />}
          tone="success"
        />
        <StatCard
          label="Total size"
          value={formatBytes(totalBytes)}
          sub="Across the latest 100 backups"
          icon={<HardDrive className="h-4.5 w-4.5" />}
          tone="info"
        />
        <StatCard
          label="Last backup"
          value={latest ? formatRelative(latest.created_at) : "—"}
          sub={latest ? latest.filename : "No completed backup yet"}
          icon={<CalendarClock className="h-4.5 w-4.5" />}
          tone="neutral"
        />
      </div>

      <Alert
        tone="warning"
        title="Restoring replaces the live configuration"
        action={
          can("backups.write") ? (
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => {
                setIncludeCdr(false);
                setCreateOpen(true);
              }}
            >
              Back up first
            </Button>
          ) : undefined
        }
      >
        A restore rewrites users, extensions, dialplan, voicemail, queues, IVR, conferences
        and settings. Take a fresh backup before restoring. Call records are only replaced
        when the selected backup includes CDR data.
      </Alert>

      <Card>
        <div className="flex flex-col gap-2 border-b border-line/70 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
              className="h-9.5 sm:w-44"
              aria-label="Filter by backup status"
            >
              <option value="">All statuses</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="running">Running</option>
            </Select>
            <span className="text-[11px] text-neutral-600">
              {meta ? `${formatNumber(meta.total)} matching backups` : "Loading…"}
            </span>
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
                icon={<DatabaseBackup className="h-6 w-6" />}
                title={statusFilter ? "No backups with this status" : "No backups yet"}
                description={
                  statusFilter
                    ? "Clear the status filter to see every backup."
                    : "Create a snapshot before making large configuration changes."
                }
                action={
                  can("backups.write") && !statusFilter ? (
                    <Button
                      variant="primary"
                      icon={<Plus className="h-4 w-4" />}
                      onClick={() => {
                        setIncludeCdr(false);
                        setCreateOpen(true);
                      }}
                    >
                      Create backup
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
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create backup"
        description="The backend writes a gzipped JSON snapshot to its data directory and records metadata in PostgreSQL."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={creating}
              icon={!creating ? <DatabaseBackup className="h-4 w-4" /> : undefined}
              onClick={() => void createBackup()}
            >
              Create backup
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-line/70 bg-white/[0.03] p-3.5">
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-neutral-200">
              <ShieldCheck className="h-4 w-4 text-neutral-300" />
              Always included
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[
                "users",
                "extensions",
                "dialplan",
                "voicemail",
                "queues",
                "ivr",
                "conferences",
                "settings",
              ].map((item) => (
                <Badge key={item} tone="neutral">
                  {item}
                </Badge>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-neutral-600">
              Credentials such as SIP passwords and password hashes are included so the
              backup can fully restore the appliance.
            </p>
          </div>

          <Toggle
            checked={includeCdr}
            onChange={setIncludeCdr}
            label="Include call detail records"
            description="Adds the CDR table to the snapshot. This can make the backup much larger on busy systems."
          />

          {includeCdr ? (
            <Alert tone="info" title="CDR data will be included">
              Restoring this backup will replace the current call record table. Existing CDR
              rows not present in the backup are removed.
            </Alert>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(restoreResult)}
        onClose={() => setRestoreResult(null)}
        title="Restore completed"
        description="The database transaction committed successfully."
        size="sm"
        footer={
          <Button variant="secondary" onClick={() => setRestoreResult(null)}>
            Close
          </Button>
        }
      >
        {restoreResult ? (
          <div className="space-y-4">
            {restoreResult.realtime_synced ? (
              <Alert tone="success" title="Realtime tables synchronized">
                Asterisk realtime configuration was rebuilt from the restored data.
              </Alert>
            ) : (
              <Alert tone="warning" title="Realtime synchronization failed">
                {restoreResult.realtime_error ||
                  "The database was restored, but the Asterisk realtime mirror could not be updated."}
              </Alert>
            )}
            <KeyValue
              columns={1}
              items={[
                { label: "Backup", value: restoreResult.filename, mono: true },
                { label: "Restored at", value: formatDateTime(restoreResult.restored_at) },
                {
                  label: "Call records",
                  value: restoreResult.includes_cdr ? "Restored" : "Not included",
                },
                {
                  label: "Realtime mirror",
                  value: restoreResult.realtime_synced ? "Synchronized" : "Needs attention",
                },
                { label: "Backup ID", value: restoreResult.backup_id, mono: true },
              ]}
            />
            <p className="text-[11px] leading-relaxed text-neutral-600">
              If your account was created after this backup, it may no longer exist. Sign in
              again if the session is rejected.
            </p>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        onClose={() => setRestoreTarget(null)}
        onConfirm={() => void restore()}
        title="Restore this backup?"
        description={
          restoreTarget
            ? `All current configuration will be replaced by ${restoreTarget.filename}. ${
                restoreIncludesCdr
                  ? "Call records will also be replaced."
                  : "Call records will be preserved."
              }`
            : undefined
        }
        confirmLabel="Restore configuration"
        loading={restoring}
        requireText={restoreTarget?.filename}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
        title="Delete this backup?"
        description={
          deleteTarget
            ? `${deleteTarget.filename} will be permanently removed from the server.`
            : undefined
        }
        confirmLabel="Delete backup"
        loading={deleting}
        requireText={deleteTarget?.filename}
      />

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-neutral-600">
        <span className="inline-flex items-center gap-1.5">
          <TriangleAlert className="h-3.5 w-3.5 text-neutral-500/70" />
          Restores require the backups.write permission and are audited
        </span>
        <span className="inline-flex items-center gap-1.5">
          <FileArchive className="h-3.5 w-3.5" />
          Format version 2 · gzip-compressed JSON
        </span>
      </div>
    </div>
  );
}
