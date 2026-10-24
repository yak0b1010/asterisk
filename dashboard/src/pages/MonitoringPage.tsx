import { useMemo, useState } from "react";
import {
  Activity,
  Clock3,
  Cpu,
  Database,
  Globe,
  HardDrive,
  Headphones,
  MemoryStick,
  Network,
  PhoneCall,
  Presentation,
  RadioTower,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  Users,
  WifiOff,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useApiQuery } from "../hooks/useApiQuery";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useInterval } from "../hooks/useInterval";
import type {
  MonitoringAsterisk,
  MonitoringStatus,
  MonitoringSystem,
  TelephonyCollection,
  TelephonyRow,
} from "../lib/types";
import {
  formatBytes,
  formatClock,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatUptime,
  statusTone,
  titleCase,
} from "../lib/format";
import { displayValue, rowNumber, rowString } from "../lib/utils";
import { Alert } from "../components/ui/Alert";
import { Badge, LiveDot } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { DataTable, type Column } from "../components/ui/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorPanel } from "../components/ErrorPanel";
import { KeyValue } from "../components/ui/KeyValue";
import { Meter, RadialGauge } from "../components/ui/Meter";
import { PageHeader } from "../components/ui/PageHeader";
import { StatCard } from "../components/ui/StatCard";
import { Tabs } from "../components/ui/Tabs";

type LiveTab = "calls" | "endpoints" | "registrations" | "queues" | "conferences";

function telephonyRows(data: TelephonyCollection | null, key: string): TelephonyRow[] {
  if (!data) return [];
  const value = data[key];
  return Array.isArray(value) ? (value as TelephonyRow[]) : [];
}

const callColumns: Column<TelephonyRow>[] = [
  {
    key: "channel",
    header: "Channel",
    render: (row) => (
      <span className="mono text-xs text-neutral-200">
        {rowString(row, "channel", "name")}
      </span>
    ),
  },
  {
    key: "caller",
    header: "Caller",
    render: (row) => (
      <div>
        <p className="mono text-xs text-neutral-300">{rowString(row, "caller_id_num", "caller")}</p>
        <p className="text-[10px] text-neutral-600">{rowString(row, "caller_id_name")}</p>
      </div>
    ),
  },
  {
    key: "connected",
    header: "Connected to",
    render: (row) => (
      <div>
        <p className="mono text-xs text-neutral-300">
          {rowString(row, "connected_num", "extension", "destination")}
        </p>
        <p className="text-[10px] text-neutral-600">{rowString(row, "context")}</p>
      </div>
    ),
  },
  {
    key: "state",
    header: "State",
    render: (row) => {
      const state = rowString(row, "state");
      return <Badge tone={statusTone(state)}>{titleCase(state)}</Badge>;
    },
  },
  {
    key: "application",
    header: "Application",
    render: (row) => (
      <span className="mono text-xs text-neutral-400">
        {rowString(row, "application", "app")}
      </span>
    ),
  },
  {
    key: "duration",
    header: "Duration",
    align: "right",
    render: (row) => {
      const duration = rowNumber(row, "duration");
      return (
        <span className="mono text-xs text-neutral-400">
          {duration !== null ? formatClock(duration) : rowString(row, "duration")}
        </span>
      );
    },
  },
  {
    key: "source",
    header: "Source",
    render: (row) => <span className="text-[10px] uppercase text-neutral-600">{rowString(row, "source")}</span>,
  },
];

const endpointColumns: Column<TelephonyRow>[] = [
  {
    key: "resource",
    header: "Endpoint",
    render: (row) => (
      <span className="mono text-xs font-medium text-neutral-200">
        {rowString(row, "resource", "endpoint")}
      </span>
    ),
  },
  {
    key: "state",
    header: "Device state",
    render: (row) => {
      const state = rowString(row, "state", "device_state");
      return <Badge tone={statusTone(state)}>{titleCase(state)}</Badge>;
    },
  },
  {
    key: "channels",
    header: "Channels",
    render: (row) => {
      const channels = row.channel_ids;
      if (Array.isArray(channels) && channels.length > 0) {
        return (
          <div className="flex flex-wrap gap-1">
            {channels.map((channel, index) => (
              <span
                key={`${String(channel)}-${index}`}
                className="mono rounded border border-line/70 bg-white/[0.035] px-1.5 py-0.5 text-[10px] text-neutral-400"
              >
                {String(channel)}
              </span>
            ))}
          </div>
        );
      }
      return <span className="text-xs text-neutral-600">—</span>;
    },
  },
  {
    key: "source",
    header: "Source",
    render: (row) => (
      <span className="text-[10px] uppercase text-neutral-600">{rowString(row, "source")}</span>
    ),
  },
];

const registrationColumns: Column<TelephonyRow>[] = [
  {
    key: "endpoint",
    header: "Endpoint",
    render: (row) => (
      <span className="mono text-xs font-medium text-neutral-200">
        {rowString(row, "endpoint")}
      </span>
    ),
  },
  {
    key: "aor",
    header: "AOR",
    render: (row) => <span className="mono text-xs text-neutral-400">{rowString(row, "aor")}</span>,
  },
  {
    key: "contact",
    header: "Contact",
    render: (row) => (
      <span
        className="mono block max-w-[300px] truncate text-xs text-neutral-400"
        title={rowString(row, "contact")}
      >
        {rowString(row, "contact")}
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (row) => {
      const status = rowString(row, "status");
      return <Badge tone={statusTone(status)}>{status}</Badge>;
    },
  },
  {
    key: "user_agent",
    header: "User agent",
    render: (row) => (
      <span
        className="block max-w-[220px] truncate text-xs text-neutral-500"
        title={rowString(row, "user_agent")}
      >
        {rowString(row, "user_agent")}
      </span>
    ),
  },
  {
    key: "expires",
    header: "Expires",
    render: (row) => (
      <span className="text-xs text-neutral-500">{rowString(row, "reg_expire")}</span>
    ),
  },
];

const queueColumns: Column<TelephonyRow>[] = [
  {
    key: "name",
    header: "Queue",
    render: (row) => (
      <div>
        <p className="text-xs font-semibold text-neutral-200">{rowString(row, "name")}</p>
        <p className="text-[10px] text-neutral-600">{titleCase(rowString(row, "strategy"))}</p>
      </div>
    ),
  },
  {
    key: "calls",
    header: "Waiting",
    align: "right",
    render: (row) => (
      <span className="mono text-xs text-neutral-300">{formatNumber(rowNumber(row, "calls") ?? 0)}</span>
    ),
  },
  {
    key: "hold",
    header: "Longest hold",
    align: "right",
    render: (row) => (
      <span className="mono text-xs text-neutral-400">
        {formatClock(rowNumber(row, "hold_time") ?? 0)}
      </span>
    ),
  },
  {
    key: "talk",
    header: "Longest talk",
    align: "right",
    render: (row) => (
      <span className="mono text-xs text-neutral-400">
        {formatClock(rowNumber(row, "talk_time") ?? 0)}
      </span>
    ),
  },
  {
    key: "completed",
    header: "Completed",
    align: "right",
    render: (row) => (
      <span className="mono text-xs text-neutral-400">{formatNumber(rowNumber(row, "completed") ?? 0)}</span>
    ),
  },
  {
    key: "abandoned",
    header: "Abandoned",
    align: "right",
    render: (row) => (
      <span className="mono text-xs text-neutral-400">{formatNumber(rowNumber(row, "abandoned") ?? 0)}</span>
    ),
  },
  {
    key: "members",
    header: "Members",
    align: "right",
    render: (row) => {
      const members = Array.isArray(row.members) ? row.members.length : 0;
      return <span className="mono text-xs text-neutral-400">{members}</span>;
    },
  },
];

const conferenceColumns: Column<TelephonyRow>[] = [
  {
    key: "room",
    header: "Conference",
    render: (row) => (
      <span className="mono text-xs font-medium text-neutral-200">{rowString(row, "room")}</span>
    ),
  },
  {
    key: "members",
    header: "Participants",
    align: "right",
    render: (row) => {
      const members = Array.isArray(row.members) ? row.members.length : 0;
      return <span className="mono text-xs text-neutral-300">{members}</span>;
    },
  },
  {
    key: "member_names",
    header: "Callers",
    render: (row) => {
      const members = Array.isArray(row.members)
        ? (row.members as TelephonyRow[])
        : [];
      if (members.length === 0) return <span className="text-xs text-neutral-600">—</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {members.slice(0, 4).map((member, index) => (
            <span
              key={`${index}-${rowString(member, "channel")}`}
              className="rounded border border-line/70 bg-white/[0.035] px-1.5 py-0.5 text-[10px] text-neutral-400"
            >
              {rowString(member, "caller_id_name", "caller_id_num", "channel")}
            </span>
          ))}
        </div>
      );
    },
  },
];

export default function MonitoringPage() {
  useDocumentTitle("Monitoring");
  const { can } = useAuth();
  const [tab, setTab] = useState("overview");
  const [liveTab, setLiveTab] = useState<LiveTab>("calls");

  const status = useApiQuery<MonitoringStatus>("/api/v1/monitoring/status");
  const system = useApiQuery<MonitoringSystem>("/api/v1/monitoring/system");
  const asterisk = useApiQuery<MonitoringAsterisk>(
    tab === "asterisk" ? "/api/v1/monitoring/asterisk" : null,
  );

  const liveEnabled = tab === "live";
  const calls = useApiQuery<TelephonyCollection>(
    liveEnabled && liveTab === "calls" ? "/api/v1/monitoring/calls" : null,
  );
  const endpoints = useApiQuery<TelephonyCollection>(
    liveEnabled && liveTab === "endpoints" ? "/api/v1/monitoring/endpoints" : null,
  );
  const registrations = useApiQuery<TelephonyCollection>(
    liveEnabled && liveTab === "registrations" ? "/api/v1/monitoring/registrations" : null,
  );
  const queues = useApiQuery<TelephonyCollection>(
    liveEnabled && liveTab === "queues" ? "/api/v1/monitoring/queues" : null,
  );
  const conferences = useApiQuery<TelephonyCollection>(
    liveEnabled && liveTab === "conferences" ? "/api/v1/monitoring/conferences" : null,
  );

  useInterval(() => {
    status.refresh();
    if (tab === "overview" || tab === "system") system.refresh();
    if (tab === "asterisk") asterisk.refresh();
    if (tab === "live") {
      if (liveTab === "calls") calls.refresh();
      if (liveTab === "endpoints") endpoints.refresh();
      if (liveTab === "registrations") registrations.refresh();
      if (liveTab === "queues") queues.refresh();
      if (liveTab === "conferences") conferences.refresh();
    }
  }, 15000);

  const liveQueries = useMemo(
    () => ({
      calls,
      endpoints,
      registrations,
      queues,
      conferences,
    }),
    [calls, endpoints, registrations, queues, conferences],
  );

  const refreshAll = () => {
    status.refresh();
    system.refresh();
    if (tab === "asterisk") asterisk.refresh();
    const active = liveQueries[liveTab];
    if (tab === "live") active.refresh();
  };

  if (status.error && !status.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Monitoring" description="API, database and Asterisk control plane health." />
        <ErrorPanel message={status.error.message} onRetry={status.refresh} />
      </div>
    );
  }

  const monitor = status.data;
  const snapshot = system.data?.system;
  const process = system.data?.process;
  const ami = monitor?.asterisk.ami;
  const ari = monitor?.asterisk.ari;
  const asteriskConfigured = Boolean(ami?.configured || ari?.configured);
  const asteriskConnected = Boolean(ami?.connected || ari?.connected);

  const activeLive = liveQueries[liveTab];
  const activeRows = (() => {
    switch (liveTab) {
      case "calls":
        return telephonyRows(calls.data, "calls");
      case "endpoints":
        return telephonyRows(endpoints.data, "endpoints");
      case "registrations":
        return telephonyRows(registrations.data, "registrations");
      case "queues":
        return telephonyRows(queues.data, "queues");
      default:
        return telephonyRows(conferences.data, "conferences");
    }
  })();

  const activeColumns =
    liveTab === "calls"
      ? callColumns
      : liveTab === "endpoints"
        ? endpointColumns
        : liveTab === "registrations"
          ? registrationColumns
          : liveTab === "queues"
            ? queueColumns
            : conferenceColumns;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operations"
        title={
          <span className="flex flex-wrap items-center gap-2">
            Monitoring
            <LiveDot active={Boolean(monitor?.database.connected)} />
          </span>
        }
        description="API health, PostgreSQL pool, host resources and live telephony state."
        actions={
          <Button
            variant="secondary"
            icon={<RefreshCw className={status.refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />}
            onClick={refreshAll}
          >
            Refresh
          </Button>
        }
      />

      {!asteriskConfigured ? (
        <Alert tone="info" title="Asterisk is not configured">
          The backend is healthy on PostgreSQL alone. AMI and ARI are optional control-plane
          integrations; live calls, endpoints, registrations, queues and conferences will
          stay empty until credentials are configured.
        </Alert>
      ) : !asteriskConnected ? (
        <Alert tone="danger" title="Asterisk is configured but unreachable">
          Check the AMI/ARI host, port, credentials and firewall. Configuration changes
          continue to be saved in PostgreSQL.
        </Alert>
      ) : (
        <Alert tone="success" title="Asterisk control plane is connected">
          AMI/ARI connections are healthy. Live telephony data is refreshed every 15 seconds.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="API status"
          value={monitor ? titleCase(monitor.status) : "—"}
          sub={`Version ${monitor?.version ?? "—"} · up ${formatUptime(monitor?.uptime_seconds ?? 0)}`}
          icon={<Server className="h-4.5 w-4.5" />}
          tone={monitor?.status === "ok" ? "success" : "warning"}
        />
        <StatCard
          label="PostgreSQL"
          value={monitor?.database.connected ? "Connected" : "Unavailable"}
          sub={
            monitor
              ? `${monitor.database.pool.in_use} in use · ${monitor.database.pool.idle} idle · max ${monitor.database.pool.max_open}`
              : "Waiting for status…"
          }
          icon={<Database className="h-4.5 w-4.5" />}
          tone={monitor?.database.connected ? "success" : "danger"}
        />
        <StatCard
          label="AMI"
          value={!ami?.configured ? "Not configured" : ami.connected ? "Connected" : "Unreachable"}
          sub={ami?.configured ? `${ami.host}:${ami.port}` : "Optional control plane"}
          icon={<Terminal className="h-4.5 w-4.5" />}
          tone={!ami?.configured ? "neutral" : ami.connected ? "success" : "danger"}
        />
        <StatCard
          label="ARI"
          value={!ari?.configured ? "Not configured" : ari.connected ? "Connected" : "Unreachable"}
          sub={ari?.configured ? ari.url : "Optional REST interface"}
          icon={<RadioTower className="h-4.5 w-4.5" />}
          tone={!ari?.configured ? "neutral" : ari.connected ? "success" : "danger"}
        />
      </div>

      <Card>
        <Tabs
          items={[
            { id: "overview", label: "Overview" },
            { id: "asterisk", label: "Asterisk" },
            { id: "live", label: "Live telephony" },
            { id: "system", label: "System" },
          ]}
          active={tab}
          onChange={setTab}
        />

        {tab === "overview" ? (
          <div className="grid grid-cols-1 gap-0 lg:grid-cols-[1.25fr_1fr]">
            <div className="border-b border-line/70 p-4 sm:p-5 lg:border-b-0 lg:border-r">
              <div className="mb-4 flex items-center gap-2">
                <Activity className="h-4 w-4 text-neutral-300" />
                <h3 className="text-sm font-semibold text-neutral-100">Host resources</h3>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <RadialGauge value={snapshot?.cpu_percent ?? 0} label="CPU" />
                <RadialGauge value={snapshot?.memory_percent ?? 0} label="Memory" />
                <RadialGauge value={snapshot?.disk_percent ?? 0} label="Disk" />
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <Meter
                  label="Memory used"
                  value={snapshot?.memory_percent ?? 0}
                  detail={
                    snapshot
                      ? `${formatBytes(snapshot.memory_used_bytes)} of ${formatBytes(
                          snapshot.memory_total_bytes,
                        )}`
                      : undefined
                  }
                />
                <Meter
                  label="Disk used"
                  value={snapshot?.disk_percent ?? 0}
                  detail={
                    snapshot
                      ? `${formatBytes(snapshot.disk_used_bytes)} of ${formatBytes(
                          snapshot.disk_total_bytes,
                        )}`
                      : undefined
                  }
                />
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3 border-t border-line/60 pt-4 text-center">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-neutral-600">Load 1m</p>
                  <p className="mono mt-0.5 text-sm font-semibold text-neutral-200">
                    {snapshot ? snapshot.load_1.toFixed(2) : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-neutral-600">Load 5m</p>
                  <p className="mono mt-0.5 text-sm font-semibold text-neutral-200">
                    {snapshot ? snapshot.load_5.toFixed(2) : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-neutral-600">Load 15m</p>
                  <p className="mono mt-0.5 text-sm font-semibold text-neutral-200">
                    {snapshot ? snapshot.load_15.toFixed(2) : "—"}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 sm:p-5">
              <div className="mb-4 flex items-center gap-2">
                <Database className="h-4 w-4 text-neutral-300" />
                <h3 className="text-sm font-semibold text-neutral-100">Service status</h3>
              </div>
              <KeyValue
                columns={1}
                items={[
                  {
                    label: "Overall status",
                    value: (
                      <Badge tone={statusTone(monitor?.status ?? "unknown")} dot>
                        {titleCase(monitor?.status ?? "unknown")}
                      </Badge>
                    ),
                  },
                  {
                    label: "Database connection",
                    value: (
                      <Badge tone={monitor?.database.connected ? "success" : "danger"} dot>
                        {monitor?.database.connected ? "Connected" : "Unavailable"}
                      </Badge>
                    ),
                  },
                  {
                    label: "Pool waiters",
                    value: `${formatNumber(monitor?.database.pool.wait_count ?? 0)} waiting · ${(
                      monitor?.database.pool.wait_duration_s ?? 0
                    ).toFixed(2)}s`,
                  },
                  {
                    label: "API uptime",
                    value: formatUptime(monitor?.uptime_seconds ?? 0),
                  },
                  {
                    label: "Process uptime",
                    value: formatUptime(process?.uptime_seconds ?? 0),
                  },
                  {
                    label: "Python",
                    value: process?.python_version ?? "—",
                    mono: true,
                  },
                  {
                    label: "Hostname",
                    value: snapshot?.hostname ?? "—",
                    mono: true,
                  },
                  {
                    label: "Operating system",
                    value: snapshot ? `${snapshot.os} · ${snapshot.arch}` : "—",
                  },
                  {
                    label: "Last sample",
                    value: formatDateTime(snapshot?.collected_at),
                  },
                ]}
              />
            </div>
          </div>
        ) : null}

        {tab === "asterisk" ? (
          asterisk.error && !asterisk.data ? (
            <ErrorPanel message={asterisk.error.message} onRetry={asterisk.refresh} />
          ) : !asterisk.data?.configured ? (
            <EmptyState
              icon={<WifiOff className="h-6 w-6" />}
              title="Asterisk is not configured"
              description="Set AMI and/or ARI credentials in the backend environment to enable live telephony monitoring. The rest of the appliance works with PostgreSQL alone."
            />
          ) : (
            <div className="grid grid-cols-1 gap-0 lg:grid-cols-2">
              <div className="border-b border-line/70 p-4 sm:p-5 lg:border-b-0 lg:border-r">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-100">
                  <RadioTower className="h-4 w-4 text-neutral-300" />
                  Connection details
                </h3>
                <KeyValue
                  columns={1}
                  items={[
                    {
                      label: "AMI",
                      value: (
                        <div className="space-y-1">
                          <Badge
                            tone={asterisk.data.status.ami.connected ? "success" : "danger"}
                            dot
                          >
                            {asterisk.data.status.ami.connected ? "Connected" : "Unreachable"}
                          </Badge>
                          <p className="mono text-[11px] text-neutral-500">
                            {asterisk.data.status.ami.host}:{asterisk.data.status.ami.port}
                          </p>
                          {asterisk.data.status.ami.error ? (
                            <p className="text-[11px] text-neutral-400">
                              {asterisk.data.status.ami.error}
                            </p>
                          ) : null}
                        </div>
                      ),
                    },
                    {
                      label: "ARI",
                      value: (
                        <div className="space-y-1">
                          <Badge
                            tone={asterisk.data.status.ari.connected ? "success" : "danger"}
                            dot
                          >
                            {asterisk.data.status.ari.connected ? "Connected" : "Unreachable"}
                          </Badge>
                          <p className="mono text-[11px] text-neutral-500">
                            {asterisk.data.status.ari.url}
                          </p>
                          {asterisk.data.status.ari.error ? (
                            <p className="text-[11px] text-neutral-400">
                              {asterisk.data.status.ari.error}
                            </p>
                          ) : null}
                        </div>
                      ),
                    },
                    {
                      label: "Version",
                      value: displayValue(asterisk.data.version),
                      mono: true,
                    },
                  ]}
                />
              </div>
              <div className="p-4 sm:p-5">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-100">
                  <Terminal className="h-4 w-4 text-neutral-300" />
                  Core status
                </h3>
                {asterisk.data.core_error ? (
                  <Alert tone="danger" title="Could not read core status">
                    {asterisk.data.core_error}
                  </Alert>
                ) : (
                  <pre className="max-h-[420px] overflow-auto rounded-lg border border-line bg-black/25 p-3 font-mono text-[11px] leading-relaxed text-neutral-400">
                    {JSON.stringify(asterisk.data.core ?? {}, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )
        ) : null}

        {tab === "live" ? (
          <div>
            <div className="flex flex-col gap-2 border-b border-line/70 px-4 pt-2 sm:flex-row sm:items-center sm:justify-between">
              <Tabs
                items={[
                  { id: "calls", label: "Calls" },
                  { id: "endpoints", label: "Endpoints" },
                  { id: "registrations", label: "Registrations" },
                  { id: "queues", label: "Queues" },
                  { id: "conferences", label: "Conferences" },
                ]}
                active={liveTab}
                onChange={(value) => setLiveTab(value as LiveTab)}
                className="border-0"
              />
              <Button
                size="sm"
                variant="ghost"
                icon={<RefreshCw className="h-3.5 w-3.5" />}
                onClick={activeLive.refresh}
                className="mb-1.5"
              >
                Refresh
              </Button>
            </div>

            {activeLive.error && !activeLive.data ? (
              <ErrorPanel message={activeLive.error.message} onRetry={activeLive.refresh} />
            ) : !activeLive.data?.configured ? (
              <EmptyState
                icon={<WifiOff className="h-6 w-6" />}
                title="Asterisk control plane is offline"
                description="Live telephony data requires AMI or ARI. Configuration stored in PostgreSQL is unaffected."
              />
            ) : (
              <DataTable
                columns={activeColumns}
                rows={activeRows}
                rowKey={(row) =>
                  `${liveTab}-${rowString(
                    row,
                    liveTab === "calls" ? "channel" : liveTab === "queues" ? "name" : liveTab === "conferences" ? "room" : "resource",
                    "endpoint",
                    "aor",
                  )}`
                }
                loading={activeLive.loading}
                dense
                empty={
                  <EmptyState
                    icon={
                      liveTab === "calls" ? (
                        <PhoneCall className="h-6 w-6" />
                      ) : liveTab === "queues" ? (
                        <Headphones className="h-6 w-6" />
                      ) : liveTab === "conferences" ? (
                        <Presentation className="h-6 w-6" />
                      ) : (
                        <Network className="h-6 w-6" />
                      )
                    }
                    title={`No ${liveTab} reported`}
                    description="Asterisk is connected but returned no entries for this view."
                  />
                }
              />
            )}
          </div>
        ) : null}

        {tab === "system" ? (
          system.error && !system.data ? (
            <ErrorPanel message={system.error.message} onRetry={system.refresh} />
          ) : (
            <div className="grid grid-cols-1 gap-0 lg:grid-cols-2">
              <div className="border-b border-line/70 p-4 sm:p-5 lg:border-b-0 lg:border-r">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-neutral-100">
                  <Cpu className="h-4 w-4 text-neutral-300" />
                  Host
                </h3>
                <KeyValue
                  columns={1}
                  items={[
                    { label: "Hostname", value: snapshot?.hostname ?? "—", mono: true },
                    { label: "Operating system", value: snapshot?.os ?? "—" },
                    { label: "Architecture", value: snapshot?.arch ?? "—" },
                    { label: "CPU cores", value: formatNumber(snapshot?.cpus ?? 0) },
                    {
                      label: "CPU usage",
                      value: formatPercent(snapshot?.cpu_percent ?? 0, 1),
                    },
                    {
                      label: "Load averages",
                      value: snapshot
                        ? `${snapshot.load_1.toFixed(2)} · ${snapshot.load_5.toFixed(2)} · ${snapshot.load_15.toFixed(2)}`
                        : "—",
                      mono: true,
                    },
                    {
                      label: "Host uptime",
                      value: formatUptime(snapshot?.uptime_seconds ?? 0),
                    },
                    {
                      label: "Last sample",
                      value: formatDateTime(snapshot?.collected_at),
                    },
                  ]}
                />
              </div>
              <div className="p-4 sm:p-5">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-neutral-100">
                  <MemoryStick className="h-4 w-4 text-neutral-300" />
                  Memory, swap and disk
                </h3>
                <div className="space-y-4">
                  <Meter
                    label="Memory"
                    value={snapshot?.memory_percent ?? 0}
                    detail={
                      snapshot
                        ? `${formatBytes(snapshot.memory_used_bytes)} used · ${formatBytes(
                            snapshot.memory_free_bytes,
                          )} free · ${formatBytes(snapshot.memory_total_bytes)} total`
                        : undefined
                    }
                  />
                  <Meter
                    label="Swap"
                    value={
                      snapshot && snapshot.swap_total_bytes > 0
                        ? (snapshot.swap_used_bytes / snapshot.swap_total_bytes) * 100
                        : 0
                    }
                    detail={
                      snapshot
                        ? `${formatBytes(snapshot.swap_used_bytes)} of ${formatBytes(
                            snapshot.swap_total_bytes,
                          )}`
                        : undefined
                    }
                  />
                  <Meter
                    label="Disk"
                    value={snapshot?.disk_percent ?? 0}
                    detail={
                      snapshot
                        ? `${formatBytes(snapshot.disk_used_bytes)} used · ${formatBytes(
                            snapshot.disk_free_bytes,
                          )} free`
                        : undefined
                    }
                  />
                  <div className="grid grid-cols-2 gap-3 border-t border-line/60 pt-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-neutral-600">
                        Process RSS
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-neutral-200">
                        <HardDrive className="h-3.5 w-3.5 text-neutral-500" />
                        {formatBytes(snapshot?.rss_bytes ?? 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-neutral-600">
                        Heap allocated
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-neutral-200">
                        <Globe className="h-3.5 w-3.5 text-neutral-500" />
                        {formatBytes(snapshot?.heap_alloc_bytes ?? 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-neutral-600">
                        Process uptime
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-neutral-200">
                        <Clock3 className="h-3.5 w-3.5 text-neutral-500" />
                        {formatUptime(process?.uptime_seconds ?? 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-neutral-600">
                        Workers
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-neutral-200">
                        <Users className="h-3.5 w-3.5 text-neutral-500" />
                        {formatNumber(snapshot?.goroutines ?? 0)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        ) : null}
      </Card>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-neutral-600">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-neutral-500/70" />
          Monitoring requires the monitoring.read permission
        </span>
        {can("audit.read") ? (
          <span className="inline-flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            Administrative actions are recorded in the audit log
          </span>
        ) : null}
      </div>
    </div>
  );
}
