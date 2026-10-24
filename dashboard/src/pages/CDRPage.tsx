import { useEffect, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  Filter,
  PhoneCall,
  RefreshCw,
  Search,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useApiQuery } from "../hooks/useApiQuery";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useToast } from "../context/ToastContext";
import {
  apiDelete,
  apiDownload,
  buildQuery,
  errorMessage,
} from "../lib/api";
import type { CDR, CDRStats } from "../lib/types";
import {
  daysAgoInput,
  dispositionTone,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  todayInput,
} from "../lib/format";
import { Badge } from "../components/ui/Badge";
import { Button, IconButton } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { CopyButton } from "../components/ui/CopyButton";
import { DataTable, type Column } from "../components/ui/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorPanel } from "../components/ErrorPanel";
import { Field, Input, Select } from "../components/ui/Field";
import { KeyValue } from "../components/ui/KeyValue";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { Pagination } from "../components/ui/Pagination";
import { SparkBars } from "../components/ui/SparkBars";
import { StatCard } from "../components/ui/StatCard";

const LIMIT = 25;

const DISPOSITIONS = ["ANSWERED", "NO ANSWER", "BUSY", "FAILED", "CONGESTION", "UNKNOWN"];

type Filters = {
  from: string;
  to: string;
  src: string;
  dst: string;
  disposition: string;
  search: string;
  min_billsec: string;
  sort: string;
  order: string;
};

const EMPTY_FILTERS: Filters = {
  from: "",
  to: "",
  src: "",
  dst: "",
  disposition: "",
  search: "",
  min_billsec: "",
  sort: "calldate",
  order: "desc",
};

export default function CDRPage() {
  useDocumentTitle("Call records");
  const { can } = useAuth();
  const toast = useToast();

  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<CDR | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CDR | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const filterQuery = buildQuery(applied);
  const list = useApiQuery<CDR[]>(
    `/api/v1/cdr${buildQuery({ page, limit: LIMIT, ...applied })}`,
  );
  const stats = useApiQuery<CDRStats>(`/api/v1/cdr/stats${filterQuery}`);

  useEffect(() => {
    if (page > 1 && list.meta && page > list.meta.pages && list.meta.pages > 0) {
      setPage(list.meta.pages);
    }
  }, [list.meta, page]);

  const updateDraft = (key: keyof Filters, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const apply = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setApplied(draft);
    setPage(1);
  };

  const reset = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  };

  const applyRange = (days: number) => {
    const next = {
      ...draft,
      from: daysAgoInput(days),
      to: todayInput(),
    };
    setDraft(next);
    setApplied(next);
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await apiDownload(`/api/v1/cdr/export${filterQuery}`, "cdr-export.csv");
      toast.success("Export ready", "The CSV file was downloaded.");
    } catch (caught) {
      toast.error("Export failed", errorMessage(caught));
    } finally {
      setExporting(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/v1/cdr/${deleteTarget.id}`);
      toast.success("Call record deleted");
      setDeleteTarget(null);
      list.refresh();
      stats.refresh();
    } catch (caught) {
      toast.error("Could not delete record", errorMessage(caught));
    } finally {
      setDeleting(false);
    }
  };

  const columns: Column<CDR>[] = [
    {
      key: "calldate",
      header: "Started",
      render: (row) => (
        <div>
          <p className="whitespace-nowrap text-xs font-medium text-neutral-200">
            {formatDateTime(row.calldate)}
          </p>
          <p className="mono text-[10px] text-neutral-600">#{row.id}</p>
        </div>
      ),
    },
    {
      key: "src",
      header: "Source",
      render: (row) => (
        <div className="min-w-0">
          <p className="mono text-xs font-medium text-neutral-200">{row.src || "—"}</p>
          <p className="max-w-[180px] truncate text-[10px] text-neutral-600">
            {row.clid || "no caller ID"}
          </p>
        </div>
      ),
    },
    {
      key: "dst",
      header: "Destination",
      render: (row) => (
        <div className="min-w-0">
          <p className="mono text-xs font-medium text-neutral-200">{row.dst || "—"}</p>
          <p className="max-w-[150px] truncate text-[10px] text-neutral-600">
            {row.dcontext || "—"}
          </p>
        </div>
      ),
    },
    {
      key: "disposition",
      header: "Disposition",
      render: (row) => (
        <Badge tone={dispositionTone(row.disposition)}>{row.disposition || "UNKNOWN"}</Badge>
      ),
    },
    {
      key: "duration",
      header: "Duration",
      align: "right",
      render: (row) => (
        <span className="mono text-xs text-neutral-400">{formatDuration(row.duration)}</span>
      ),
    },
    {
      key: "billsec",
      header: "Talk time",
      align: "right",
      render: (row) => (
        <span className="mono text-xs text-neutral-300">{formatDuration(row.billsec)}</span>
      ),
    },
    {
      key: "channel",
      header: "Channel",
      render: (row) => (
        <span
          className="mono block max-w-[190px] truncate text-[11px] text-neutral-500"
          title={row.channel}
        >
          {row.channel || "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-0.5">
          <IconButton label="View record" onClick={() => setDetail(row)}>
            <Eye className="h-3.5 w-3.5" />
          </IconButton>
          {can("cdr.delete") ? (
            <IconButton
              label="Delete record"
              className="hover:bg-neutral-500/10 hover:text-neutral-300"
              onClick={() => setDeleteTarget(row)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          ) : null}
        </div>
      ),
    },
  ];

  const meta = list.meta;
  const chart = (stats.data?.by_day ?? [])
    .slice()
    .reverse()
    .map((day) => ({
      label: day.day,
      value: day.count,
      secondary: day.answered,
    }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operations"
        title="Call records"
        description="Search, analyze and export call detail records written to PostgreSQL."
        actions={
          <>
            {can("cdr.export") ? (
              <Button
                variant="secondary"
                icon={<Download className="h-4 w-4" />}
                onClick={() => void exportCsv()}
                loading={exporting}
              >
                Export CSV
              </Button>
            ) : null}
            <Button
              variant="secondary"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={() => {
                list.refresh();
                stats.refresh();
              }}
            >
              Refresh
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Matching calls"
          value={formatNumber(stats.data?.total ?? 0)}
          sub={`${formatNumber(stats.data?.answered ?? 0)} answered · ${formatNumber(
            stats.data?.no_answer ?? 0,
          )} unanswered`}
          icon={<PhoneCall className="h-4.5 w-4.5" />}
          tone="accent"
        />
        <StatCard
          label="Answer rate"
          value={formatPercent(stats.data?.answer_rate ?? 0, 1)}
          sub={`${formatNumber(stats.data?.busy ?? 0)} busy · ${formatNumber(
            stats.data?.failed ?? 0,
          )} failed`}
          icon={<CheckCircle2 className="h-4.5 w-4.5" />}
          tone={(stats.data?.answer_rate ?? 0) >= 70 ? "success" : "warning"}
        />
        <StatCard
          label="Average talk time"
          value={formatDuration(stats.data?.average_billsec_seconds ?? 0)}
          sub={`Average duration ${formatDuration(
            stats.data?.average_duration_seconds ?? 0,
          )}`}
          icon={<Timer className="h-4.5 w-4.5" />}
          tone="info"
        />
        <StatCard
          label="Total talk time"
          value={formatDuration(stats.data?.total_billsec_seconds ?? 0)}
          sub={`Total duration ${formatDuration(
            stats.data?.total_duration_seconds ?? 0,
          )}`}
          icon={<Clock3 className="h-4.5 w-4.5" />}
          tone="neutral"
        />
      </div>

      <Card>
        <CardHeader
          title="Filters"
          description="All filters are applied to both the table and the statistics above."
          icon={<Filter className="h-4 w-4" />}
          action={
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => applyRange(7)}>
                Last 7 days
              </Button>
              <Button size="sm" variant="ghost" onClick={() => applyRange(30)}>
                Last 30 days
              </Button>
              <Button size="sm" variant="ghost" onClick={reset}>
                Clear
              </Button>
            </div>
          }
        />
        <CardBody>
          <form onSubmit={apply} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="From">
                <Input
                  type="date"
                  value={draft.from}
                  onChange={(event) => updateDraft("from", event.target.value)}
                />
              </Field>
              <Field label="To">
                <Input
                  type="date"
                  value={draft.to}
                  onChange={(event) => updateDraft("to", event.target.value)}
                />
              </Field>
              <Field label="Source">
                <Input
                  value={draft.src}
                  onChange={(event) => updateDraft("src", event.target.value)}
                  placeholder="1001"
                  className="mono"
                />
              </Field>
              <Field label="Destination">
                <Input
                  value={draft.dst}
                  onChange={(event) => updateDraft("dst", event.target.value)}
                  placeholder="1002"
                  className="mono"
                />
              </Field>
              <Field label="Disposition">
                <Select
                  value={draft.disposition}
                  onChange={(event) => updateDraft("disposition", event.target.value)}
                >
                  <option value="">Any disposition</option>
                  {DISPOSITIONS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Minimum talk time" hint="Seconds.">
                <Input
                  value={draft.min_billsec}
                  onChange={(event) => updateDraft("min_billsec", event.target.value)}
                  placeholder="0"
                  inputMode="numeric"
                  className="mono"
                />
              </Field>
              <Field label="Sort by">
                <Select
                  value={draft.sort}
                  onChange={(event) => updateDraft("sort", event.target.value)}
                >
                  <option value="calldate">Call date</option>
                  <option value="duration">Duration</option>
                  <option value="billsec">Talk time</option>
                  <option value="src">Source</option>
                  <option value="dst">Destination</option>
                  <option value="disposition">Disposition</option>
                </Select>
              </Field>
              <Field label="Order">
                <Select
                  value={draft.order}
                  onChange={(event) => updateDraft("order", event.target.value)}
                >
                  <option value="desc">Newest / highest first</option>
                  <option value="asc">Oldest / lowest first</option>
                </Select>
              </Field>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field label="Free-text search" className="flex-1">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                  <Input
                    value={draft.search}
                    onChange={(event) => updateDraft("search", event.target.value)}
                    placeholder="Caller ID, source, destination, unique ID or account code…"
                    className="pl-9"
                  />
                </div>
              </Field>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" icon={<Filter className="h-4 w-4" />}>
                  Apply filters
                </Button>
              </div>
            </div>
          </form>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader
            title="Daily volume"
            description="Total calls versus answered calls for the selected filters."
            icon={<PhoneCall className="h-4 w-4" />}
            action={
              <div className="flex items-center gap-3 text-[11px] text-neutral-500">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-white/20" /> Total
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-neutral-400" /> Answered
                </span>
              </div>
            }
          />
          <CardBody>
            {stats.loading ? (
              <div className="skeleton" style={{ height: 150 }} />
            ) : (
              <SparkBars data={chart} height={160} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Dispositions"
            description="Distribution across the filtered call set."
            icon={<CheckCircle2 className="h-4 w-4" />}
          />
          <CardBody>
            {(stats.data?.by_disposition ?? []).length === 0 ? (
              <p className="py-6 text-center text-xs text-neutral-600">
                No disposition data for the current filters.
              </p>
            ) : (
              <div className="space-y-3">
                {(stats.data?.by_disposition ?? []).map((row) => {
                  const total = stats.data?.total ?? 0;
                  const percent = total > 0 ? (row.count / total) * 100 : 0;
                  return (
                    <div key={row.disposition}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <Badge tone={dispositionTone(row.disposition)}>{row.disposition}</Badge>
                        <span className="mono text-[11px] text-neutral-400">
                          {formatNumber(row.count)} · {formatPercent(percent, 1)}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                        <div
                          className={
                            row.disposition === "ANSWERED"
                              ? "h-full rounded-full bg-neutral-400"
                              : row.disposition === "NO ANSWER"
                                ? "h-full rounded-full bg-neutral-400"
                                : row.disposition === "BUSY"
                                  ? "h-full rounded-full bg-neutral-400"
                                  : "h-full rounded-full bg-neutral-400"
                          }
                          style={{ width: `${Math.max(2, percent)}%` }}
                        />
                      </div>
                      <p className="mt-1 text-[10px] text-neutral-600">
                        {formatDuration(row.total_billsec_seconds)} talk time
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        {list.error && !list.data ? (
          <ErrorPanel message={list.error.message} onRetry={list.refresh} />
        ) : (
          <DataTable
            columns={columns}
            rows={list.data ?? []}
            rowKey={(row) => row.id}
            loading={list.loading}
            dense
            empty={
              <EmptyState
                icon={<PhoneCall className="h-6 w-6" />}
                title="No call records match"
                description="Try widening the date range or clearing one of the filters."
                action={
                  <Button variant="secondary" icon={<X className="h-4 w-4" />} onClick={reset}>
                    Clear filters
                  </Button>
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
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `Call record #${detail.id}` : "Call record"}
        description={detail ? formatDateTime(detail.calldate) : undefined}
        size="lg"
        footer={
          <Button variant="secondary" onClick={() => setDetail(null)}>
            Close
          </Button>
        }
      >
        {detail ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={dispositionTone(detail.disposition)}>{detail.disposition}</Badge>
              <span className="mono text-xs text-neutral-500">{detail.uniqueid || "no unique ID"}</span>
              <CopyButton value={detail.uniqueid} label="Copy unique ID" />
            </div>

            <KeyValue
              columns={2}
              items={[
                { label: "Call date", value: formatDateTime(detail.calldate) },
                { label: "Disposition", value: detail.disposition || "UNKNOWN" },
                { label: "Source", value: detail.src || "—", mono: true },
                { label: "Destination", value: detail.dst || "—", mono: true },
                { label: "Caller ID", value: detail.clid || "—" },
                { label: "Context", value: detail.dcontext || "—", mono: true },
                { label: "Duration", value: formatDuration(detail.duration) },
                { label: "Talk time", value: formatDuration(detail.billsec) },
                { label: "Channel", value: detail.channel || "—", mono: true },
                { label: "Destination channel", value: detail.dstchannel || "—", mono: true },
                { label: "Last application", value: detail.lastapp || "—", mono: true },
                { label: "Last data", value: detail.lastdata || "—", mono: true },
                { label: "Account code", value: detail.accountcode || "—", mono: true },
                { label: "Peer account", value: detail.peeraccount || "—", mono: true },
                { label: "Linked ID", value: detail.linkedid || "—", mono: true },
                { label: "Sequence", value: String(detail.sequence) },
                { label: "AMA flags", value: String(detail.amaflags) },
                { label: "User field", value: detail.userfield || "—" },
              ]}
            />
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
        title={`Delete call record #${deleteTarget?.id ?? ""}?`}
        description="The record will be permanently removed from the CDR table."
        confirmLabel="Delete record"
        loading={deleting}
        requireText={deleteTarget ? String(deleteTarget.id) : undefined}
      />
    </div>
  );
}
