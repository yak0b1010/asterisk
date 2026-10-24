import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Clock3,
  Download,
  Eye,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  SlidersHorizontal,
  UsersRound,
  X,
} from "lucide-react";
import { useApiQuery } from "../hooks/useApiQuery";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { buildQuery } from "../lib/api";
import type { AuditEntry } from "../lib/types";
import {
  formatDateTime,
  formatRelative,
  initials,
  todayInput,
  type Tone,
} from "../lib/format";
import { downloadText } from "../lib/utils";
import { Badge } from "../components/ui/Badge";
import { Button, IconButton } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { CopyButton } from "../components/ui/CopyButton";
import { DataTable, type Column } from "../components/ui/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorPanel } from "../components/ErrorPanel";
import { Field, Input, Select } from "../components/ui/Field";
import { KeyValue } from "../components/ui/KeyValue";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { Pagination } from "../components/ui/Pagination";
import { SearchInput } from "../components/ui/SearchInput";
import { StatCard } from "../components/ui/StatCard";

const LIMIT = 25;

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const STATUS_CODES = [200, 201, 204, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503];

const ENTITY_TYPES = [
  "auth",
  "users",
  "extensions",
  "dialplan",
  "voicemail",
  "queues",
  "ivr",
  "conferences",
  "cdr",
  "settings",
  "backups",
];

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No content",
  400: "Bad request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not found",
  405: "Method not allowed",
  409: "Conflict",
  422: "Validation failed",
  429: "Rate limited",
  500: "Server error",
  502: "Bad gateway",
  503: "Unavailable",
};

function statusToneFor(code: number): Tone {
  if (code >= 500) return "danger";
  if (code >= 400) return "warning";
  if (code >= 300) return "info";
  if (code >= 200) return "success";
  return "neutral";
}

function actionTone(action: string): Tone {
  const value = action.toLowerCase();
  if (
    value.includes("fail") ||
    value.includes("delete") ||
    value.includes("revoke") ||
    value.includes("block")
  ) {
    return "danger";
  }
  if (value.includes("login") || value.includes("logout")) return "info";
  if (value.includes("create") || value.includes("restore")) return "accent";
  if (
    value.includes("update") ||
    value.includes("reload") ||
    value.includes("password")
  ) {
    return "warning";
  }
  return "neutral";
}

function prettyDetails(details?: string): string {
  if (!details) return "";
  try {
    return JSON.stringify(JSON.parse(details), null, 2);
  } catch {
    return details;
  }
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default function AuditPage() {
  useDocumentTitle("Audit log");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState("");
  const [statusCode, setStatusCode] = useState("");
  const [entityType, setEntityType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [username, setUsername] = useState("");
  const [action, setAction] = useState("");
  const [entityId, setEntityId] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const debouncedSearch = useDebouncedValue(search);

  const list = useApiQuery<AuditEntry[]>(
    `/api/v1/audit${buildQuery({
      page,
      limit: LIMIT,
      search: debouncedSearch,
      method,
      status_code: statusCode,
      entity_type: entityType,
      username: username.trim(),
      action: action.trim(),
      entity_id: entityId.trim(),
      from,
      to,
    })}`,
  );

  const summary = useApiQuery<AuditEntry[]>("/api/v1/audit?limit=200");

  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const detail = useApiQuery<AuditEntry>(
    selected ? `/api/v1/audit/${selected.id}` : null,
  );

  useEffect(() => {
    if (page > 1 && list.meta && page > list.meta.pages && list.meta.pages > 0) {
      setPage(list.meta.pages);
    }
  }, [list.meta, page]);

  const summaryEntries = summary.data ?? [];
  const totalEvents = summary.meta?.total ?? summaryEntries.length;
  const failures = summaryEntries.filter((entry) => entry.status_code >= 400).length;
  const actors = useMemo(() => {
    const names = new Set<string>();
    for (const entry of summaryEntries) {
      if (entry.username) names.add(entry.username);
    }
    return names.size;
  }, [summaryEntries]);
  const latest = summaryEntries[0];

  const entityOptions = useMemo(() => {
    const names = new Set(ENTITY_TYPES);
    for (const entry of summaryEntries) {
      if (entry.entity_type) names.add(entry.entity_type);
    }
    return Array.from(names).sort();
  }, [summaryEntries]);

  const filtersActive = Boolean(
    search ||
      method ||
      statusCode ||
      entityType ||
      from ||
      to ||
      username ||
      action ||
      entityId,
  );

  const clearFilters = () => {
    setSearch("");
    setMethod("");
    setStatusCode("");
    setEntityType("");
    setFrom("");
    setTo("");
    setUsername("");
    setAction("");
    setEntityId("");
    setPage(1);
  };

  const exportCsv = () => {
    const rows = list.data ?? [];
    if (rows.length === 0) return;
    const header = [
      "created_at",
      "username",
      "action",
      "entity_type",
      "entity_id",
      "method",
      "path",
      "status_code",
      "ip",
      "user_agent",
      "details",
    ];
    const body = rows.map((entry) =>
      [
        entry.created_at,
        entry.username,
        entry.action,
        entry.entity_type,
        entry.entity_id ?? "",
        entry.method,
        entry.path,
        entry.status_code,
        entry.ip,
        entry.user_agent ?? "",
        entry.details ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
    downloadText(
      [header.join(","), ...body].join("\n"),
      `audit-${todayInput()}.csv`,
      "text/csv;charset=utf-8",
    );
  };

  const columns: Column<AuditEntry>[] = [
    {
      key: "time",
      header: "When",
      render: (row) => (
        <div className="whitespace-nowrap">
          <p className="text-xs text-neutral-300">{formatDateTime(row.created_at)}</p>
          <p className="text-[10px] text-neutral-600">{formatRelative(row.created_at)}</p>
        </div>
      ),
    },
    {
      key: "actor",
      header: "Actor",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-[10px] font-bold text-neutral-300">
            {initials(row.username || "system")}
          </span>
          <div className="min-w-0">
            <p className="max-w-[150px] truncate text-xs font-semibold text-neutral-200">
              {row.username || "anonymous"}
            </p>
            <p className="mono text-[10px] text-neutral-600">{row.ip || "—"}</p>
          </div>
        </div>
      ),
    },
    {
      key: "action",
      header: "Action",
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={actionTone(row.action)}>{row.action || "unknown"}</Badge>
          <span className="mono text-[10px] text-neutral-600">{row.entity_type || "—"}</span>
        </div>
      ),
    },
    {
      key: "request",
      header: "Request",
      render: (row) => (
        <div className="min-w-0">
          <p className="flex items-center gap-1.5">
            <span className="mono rounded bg-white/[0.08] px-1.5 py-0.5 text-[9px] font-bold text-neutral-400">
              {row.method}
            </span>
            <span
              className="mono max-w-[280px] truncate text-[11px] text-neutral-300"
              title={row.path}
            >
              {row.path}
            </span>
          </p>
          {row.entity_id ? (
            <p className="mono mt-1 max-w-[280px] truncate text-[10px] text-neutral-600">
              id: {row.entity_id}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: (row) => (
        <Badge tone={statusToneFor(row.status_code)}>
          {row.status_code}
          <span className="hidden font-normal opacity-70 sm:inline">
            {STATUS_TEXT[row.status_code] ?? ""}
          </span>
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <IconButton label="View audit entry" onClick={() => setSelected(row)}>
          <Eye className="h-3.5 w-3.5" />
        </IconButton>
      ),
    },
  ];

  const meta = list.meta;
  const entry = detail.data ?? selected;
  const detailsText = entry ? prettyDetails(entry.details) : "";

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Security"
        title="Audit trail"
        description="Every mutating API request, sign-in and restore is recorded with the acting account, client address and outcome."
        actions={
          <>
            <Button
              variant="secondary"
              icon={<Download className="h-4 w-4" />}
              onClick={exportCsv}
              disabled={!list.data || list.data.length === 0}
            >
              Export page
            </Button>
            <Button
              variant="primary"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={() => {
                list.refresh();
                summary.refresh();
              }}
              loading={list.refreshing || summary.refreshing}
            >
              Refresh
            </Button>
          </>
        }
      />

      <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Audit events"
          value={totalEvents.toLocaleString()}
          sub="Matching the current filters"
          icon={<ScrollText className="h-4.5 w-4.5" />}
          tone="accent"
        />
        <StatCard
          label="Recent failures"
          value={failures}
          sub="4xx and 5xx in the latest 200 events"
          icon={<ShieldAlert className="h-4.5 w-4.5" />}
          tone={failures > 0 ? "warning" : "success"}
        />
        <StatCard
          label="Active actors"
          value={actors}
          sub="Distinct accounts in the latest 200 events"
          icon={<UsersRound className="h-4.5 w-4.5" />}
          tone="info"
        />
        <StatCard
          label="Last event"
          value={latest ? formatRelative(latest.created_at) : "—"}
          sub={latest ? `${latest.action} · ${latest.username || "anonymous"}` : "No events recorded yet"}
          icon={<Clock3 className="h-4.5 w-4.5" />}
          tone="neutral"
        />
      </div>

      <Card>
        <div className="space-y-2 border-b border-line/70 p-3">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
            <SearchInput
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              placeholder="Search user, path or details…"
              className="xl:w-80"
            />
            <Select
              value={method}
              onChange={(event) => {
                setMethod(event.target.value);
                setPage(1);
              }}
              className="h-9.5 xl:w-32"
              aria-label="Filter by HTTP method"
            >
              <option value="">All methods</option>
              {METHODS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
            <Select
              value={statusCode}
              onChange={(event) => {
                setStatusCode(event.target.value);
                setPage(1);
              }}
              className="h-9.5 xl:w-40"
              aria-label="Filter by HTTP status"
            >
              <option value="">All statuses</option>
              {STATUS_CODES.map((code) => (
                <option key={code} value={code}>
                  {code} {STATUS_TEXT[code] ?? ""}
                </option>
              ))}
            </Select>
            <Select
              value={entityType}
              onChange={(event) => {
                setEntityType(event.target.value);
                setPage(1);
              }}
              className="h-9.5 xl:w-40"
              aria-label="Filter by entity type"
            >
              <option value="">All entities</option>
              {entityOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setPage(1);
                }}
                className="h-9.5 w-36 text-xs"
                aria-label="From date"
                title="From date (inclusive)"
              />
              <span className="text-[10px] text-neutral-600">to</span>
              <Input
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  setPage(1);
                }}
                className="h-9.5 w-36 text-xs"
                aria-label="To date"
                title="To date (inclusive)"
              />
            </div>
            <div className="flex items-center gap-1.5 xl:ml-auto">
              <Button
                size="sm"
                variant={advanced ? "outline" : "ghost"}
                icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
                onClick={() => setAdvanced((value) => !value)}
              >
                More filters
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<X className="h-3.5 w-3.5" />}
                onClick={clearFilters}
                disabled={!filtersActive}
              >
                Clear
              </Button>
            </div>
          </div>

          {advanced ? (
            <div className="grid grid-cols-1 gap-2 rounded-lg border border-line/60 bg-white/[0.03] p-2.5 sm:grid-cols-3">
              <Field label="Username" hint="Exact match">
                <Input
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setPage(1);
                  }}
                  placeholder="admin"
                  className="mono h-9 text-xs"
                  autoComplete="off"
                />
              </Field>
              <Field label="Action" hint="Exact match, for example restore">
                <Input
                  value={action}
                  onChange={(event) => {
                    setAction(event.target.value);
                    setPage(1);
                  }}
                  placeholder="restore"
                  className="mono h-9 text-xs"
                  autoComplete="off"
                />
              </Field>
              <Field label="Entity ID" hint="Exact match">
                <Input
                  value={entityId}
                  onChange={(event) => {
                    setEntityId(event.target.value);
                    setPage(1);
                  }}
                  placeholder="UUID or setting key"
                  className="mono h-9 text-xs"
                  autoComplete="off"
                />
              </Field>
            </div>
          ) : null}
        </div>

        {list.error && !list.data ? (
          <ErrorPanel message={list.error.message} onRetry={list.refresh} />
        ) : (
          <DataTable
            columns={columns}
            rows={list.data ?? []}
            rowKey={(row) => row.id}
            loading={list.loading}
            onRowClick={(row) => setSelected(row)}
            empty={
              <EmptyState
                icon={<ScrollText className="h-6 w-6" />}
                title={filtersActive ? "No matching audit events" : "No audit events yet"}
                description={
                  filtersActive
                    ? "Try a wider date range or clear the exact-match filters."
                    : "Sign-ins and configuration changes will appear here as they happen."
                }
                action={
                  filtersActive ? (
                    <Button variant="secondary" onClick={clearFilters}>
                      Clear filters
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

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-neutral-600">
        <span className="inline-flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" />
          GET requests are not audited; mutating requests and sign-in events are
        </span>
        <span>Timestamps are stored in UTC and shown in your local timezone</span>
      </div>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Audit event"
        description={entry ? `${entry.action} · ${entry.entity_type || "unknown entity"}` : undefined}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSelected(null)}>
              Close
            </Button>
            {entry ? (
              <CopyButton
                value={JSON.stringify(entry, null, 2)}
                label="Copy event JSON"
                className="rounded-lg border border-line px-3 py-2"
              />
            ) : null}
          </>
        }
      >
        {detail.error && !detail.data ? (
          <ErrorPanel
            message={detail.error.message}
            onRetry={detail.refresh}
            title="Could not load audit entry"
          />
        ) : entry ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={actionTone(entry.action)}>{entry.action}</Badge>
              <Badge tone={statusToneFor(entry.status_code)}>
                {entry.method} {entry.status_code} {STATUS_TEXT[entry.status_code] ?? ""}
              </Badge>
              <Badge tone="neutral">{entry.entity_type || "unknown entity"}</Badge>
              {detail.loading ? (
                <span className="text-[10px] text-neutral-600">Refreshing…</span>
              ) : null}
            </div>

            <KeyValue
              columns={2}
              items={[
                { label: "Timestamp", value: formatDateTime(entry.created_at) },
                { label: "Relative", value: formatRelative(entry.created_at) },
                { label: "Actor", value: entry.username || "anonymous" },
                { label: "User ID", value: entry.user_id || "—", mono: true },
                { label: "Action", value: entry.action || "—" },
                { label: "Entity type", value: entry.entity_type || "—" },
                { label: "Entity ID", value: entry.entity_id || "—", mono: true },
                { label: "Status", value: `${entry.status_code} ${STATUS_TEXT[entry.status_code] ?? ""}` },
                { label: "IP address", value: entry.ip || "—", mono: true },
                { label: "Entry ID", value: String(entry.id), mono: true },
              ]}
            />

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                  Request path
                </p>
                <CopyButton value={entry.path} iconOnly label="Copy request path" />
              </div>
              <pre className="mono overflow-x-auto rounded-lg border border-line/60 bg-white/[0.045] px-3 py-2 text-[11px] text-neutral-300">
                {entry.method} {entry.path}
              </pre>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                  Details
                </p>
                {detailsText ? (
                  <CopyButton value={detailsText} iconOnly label="Copy details" />
                ) : null}
              </div>
              {detailsText ? (
                <pre className="mono max-h-72 overflow-auto rounded-lg border border-line/60 bg-white/[0.045] p-3 text-[11px] leading-relaxed text-neutral-300">
                  {detailsText}
                </pre>
              ) : (
                <p className="rounded-lg border border-line/60 bg-white/[0.03] px-3 py-2 text-xs text-neutral-600">
                  No additional details were recorded for this event.
                </p>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                Client
              </p>
              <p className="mono break-all rounded-lg border border-line/60 bg-white/[0.03] px-3 py-2 text-[11px] leading-relaxed text-neutral-400">
                {entry.user_agent || "No user agent recorded"}
              </p>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
