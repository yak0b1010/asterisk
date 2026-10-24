import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Cpu,
  Database,
  GitBranch,
  Headphones,
  LayoutGrid,
  ListTree,
  Phone,
  PhoneCall,
  Presentation,
  RadioTower,
  RefreshCw,
  Server,
  UsersRound,
  Voicemail,
  WifiOff,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useApiQuery } from "../hooks/useApiQuery";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useInterval } from "../hooks/useInterval";
import type {
  CDR,
  CDRStats,
  DashboardStats,
  MonitoringStatus,
} from "../lib/types";
import {
  dispositionTone,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatUptime,
} from "../lib/format";
import { Badge, LiveDot } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { DataTable, type Column } from "../components/ui/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorPanel } from "../components/ErrorPanel";
import { Meter, RadialGauge } from "../components/ui/Meter";
import { PageHeader } from "../components/ui/PageHeader";
import { SparkBars } from "../components/ui/SparkBars";
import { StatCard } from "../components/ui/StatCard";
import { Alert } from "../components/ui/Alert";

const recentColumns: Column<CDR>[] = [
  {
    key: "calldate",
    header: "Started",
    render: (row) => (
      <span className="whitespace-nowrap text-xs text-neutral-300">
        {formatDateTime(row.calldate)}
      </span>
    ),
  },
  {
    key: "src",
    header: "From",
    render: (row) => (
      <div className="min-w-0">
        <p className="mono text-xs font-medium text-neutral-200">{row.src || "—"}</p>
        <p className="truncate text-[10px] text-neutral-600">{row.clid || "no caller ID"}</p>
      </div>
    ),
  },
  {
    key: "dst",
    header: "To",
    render: (row) => (
      <div className="min-w-0">
        <p className="mono text-xs font-medium text-neutral-200">{row.dst || "—"}</p>
        <p className="truncate text-[10px] text-neutral-600">{row.dcontext || "—"}</p>
      </div>
    ),
  },
  {
    key: "disposition",
    header: "Result",
    render: (row) => (
      <Badge tone={dispositionTone(row.disposition)}>
        {row.disposition || "UNKNOWN"}
      </Badge>
    ),
  },
  {
    key: "billsec",
    header: "Talk time",
    align: "right",
    render: (row) => (
      <span className="mono text-xs text-neutral-400">{formatDuration(row.billsec)}</span>
    ),
  },
];

export default function DashboardPage() {
  useDocumentTitle("Dashboard");
  const { user, can } = useAuth();

  const stats = useApiQuery<DashboardStats>("/api/v1/dashboard/stats");
  const status = useApiQuery<MonitoringStatus>("/api/v1/monitoring/status");
  const recent = useApiQuery<CDR[]>("/api/v1/dashboard/recent-calls?limit=6");
  const callStats = useApiQuery<CDRStats>(can("cdr.read") ? "/api/v1/cdr/stats" : null);

  useInterval(() => {
    stats.refresh();
    status.refresh();
    recent.refresh();
  }, 30000);

  const refreshAll = () => {
    stats.refresh();
    status.refresh();
    recent.refresh();
    callStats.refresh();
  };

  if (stats.error && !stats.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Operations overview" description="Live status of the appliance." />
        <ErrorPanel message={stats.error.message} onRetry={stats.refresh} />
      </div>
    );
  }

  const data = stats.data;
  const monitor = status.data;
  const ami = monitor?.asterisk.ami;
  const ari = monitor?.asterisk.ari;
  const asteriskConfigured = Boolean(ami?.configured || ari?.configured);
  const asteriskConnected = Boolean(ami?.connected || ari?.connected);
  const answerRate =
    data && data.calls.today > 0
      ? (data.calls.answered_today / data.calls.today) * 100
      : 0;

  const chart = (callStats.data?.by_day ?? [])
    .slice()
    .reverse()
    .map((day) => ({
      label: day.day,
      value: day.count,
      secondary: day.answered,
    }));

  const activeExtensions = data?.extensions.enabled ?? 0;
  const totalExtensions = data?.extensions.total ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Control Center"
        title={
          <span className="flex flex-wrap items-center gap-2">
            Operations overview
            <LiveDot active={Boolean(monitor?.database.connected)} />
          </span>
        }
        description={
          user
            ? `Welcome back, ${user.full_name || user.username}. Here is what is happening on the appliance.`
            : "Live status of the appliance."
        }
        actions={
          <>
            <Button
              variant="secondary"
              icon={<RefreshCw className={status.refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />}
              onClick={refreshAll}
              disabled={stats.refreshing}
            >
              Refresh
            </Button>
            {can("cdr.read") ? (
              <Link to="/cdr">
                <Button variant="primary" icon={<PhoneCall className="h-4 w-4" />}>
                  Call records
                </Button>
              </Link>
            ) : null}
          </>
        }
      />

      {!asteriskConfigured ? (
        <Alert
          tone="info"
          title="Asterisk control plane is not configured"
          action={
            <Link to="/monitoring">
              <Button size="sm" variant="secondary">
                Open monitoring
              </Button>
            </Link>
          }
        >
          The API is running on PostgreSQL only. Configuration changes are stored in the
          database and mirrored to realtime tables; live call, endpoint and queue data
          will appear once AMI or ARI is configured.
        </Alert>
      ) : !asteriskConnected ? (
        <Alert
          tone="danger"
          title="Asterisk is configured but unreachable"
          action={
            <Link to="/monitoring">
              <Button size="sm" variant="secondary">
                Diagnose
              </Button>
            </Link>
          }
        >
          AMI/ARI credentials exist but the PBX connection failed. Configuration is still
          saved in PostgreSQL; live telephony data is unavailable.
        </Alert>
      ) : null}

      <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Extensions"
          value={formatNumber(totalExtensions)}
          sub={`${formatNumber(activeExtensions)} enabled · ${formatNumber(
            data?.extensions.voicemail_enabled ?? 0,
          )} with voicemail`}
          icon={<Phone className="h-4.5 w-4.5" />}
          tone="accent"
          footer={
            <Link
              to="/extensions"
              className="inline-flex items-center gap-1 text-neutral-400 transition hover:text-neutral-300"
            >
              Manage extensions <ArrowRight className="h-3 w-3" />
            </Link>
          }
        />
        <StatCard
          label="Calls today"
          value={formatNumber(data?.calls.today ?? 0)}
          sub={`${formatNumber(data?.calls.answered_today ?? 0)} answered · ${formatPercent(
            answerRate,
            0,
          )} answer rate`}
          icon={<PhoneCall className="h-4.5 w-4.5" />}
          tone="success"
          footer={
            <Link
              to="/cdr"
              className="inline-flex items-center gap-1 text-neutral-400 transition hover:text-neutral-300"
            >
              View call records <ArrowRight className="h-3 w-3" />
            </Link>
          }
        />
        <StatCard
          label="Active calls"
          value={data?.calls.asterisk_configured ? formatNumber(data.calls.active) : "—"}
          sub={
            data?.calls.asterisk_configured
              ? data.calls.active_calls_error || "Live channels via AMI/ARI"
              : "Requires a configured PBX"
          }
          icon={<RadioTower className="h-4.5 w-4.5" />}
          tone={data?.calls.active ? "success" : "neutral"}
          footer={
            <Link
              to="/monitoring"
              className="inline-flex items-center gap-1 text-neutral-400 transition hover:text-neutral-300"
            >
              Live monitoring <ArrowRight className="h-3 w-3" />
            </Link>
          }
        />
        <StatCard
          label="System load"
          value={formatPercent(data?.system.cpu_percent ?? 0, 0)}
          sub={`Memory ${formatPercent(data?.system.memory_percent ?? 0, 0)} · Disk ${formatPercent(
            data?.system.disk_percent ?? 0,
            0,
          )}`}
          icon={<Activity className="h-4.5 w-4.5" />}
          tone={
            (data?.system.cpu_percent ?? 0) >= 85
              ? "danger"
              : (data?.system.cpu_percent ?? 0) >= 65
                ? "warning"
                : "info"
          }
          footer={`Up ${formatUptime(data?.system.uptime_seconds ?? 0)} · load ${
            data ? data.system.load_1.toFixed(2) : "—"
          }`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card className="min-w-0">
          <CardHeader
            title="Recent calls"
            description="Latest call detail records across all contexts."
            icon={<PhoneCall className="h-4 w-4" />}
            action={
              can("cdr.read") ? (
                <Link to="/cdr">
                  <Button size="sm" variant="ghost">
                    View all <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              ) : undefined
            }
          />
          <DataTable
            columns={recentColumns}
            rows={recent.data ?? []}
            rowKey={(row) => row.id}
            loading={recent.loading}
            dense
            empty={
              <EmptyState
                icon={<PhoneCall className="h-6 w-6" />}
                title="No calls recorded yet"
                description="Call detail records appear here as Asterisk writes them to the PostgreSQL CDR table."
              />
            }
          />
        </Card>

        <Card>
          <CardHeader
            title="System health"
            description="Host resources sampled by the backend monitor."
            icon={<Server className="h-4 w-4" />}
          />
          <CardBody>
            <div className="grid grid-cols-3 gap-2">
              <RadialGauge
                value={data?.system.cpu_percent ?? 0}
                label="CPU"
                size={100}
              />
              <RadialGauge
                value={data?.system.memory_percent ?? 0}
                label="Memory"
                size={100}
              />
              <RadialGauge
                value={data?.system.disk_percent ?? 0}
                label="Disk"
                size={100}
              />
            </div>

            <div className="mt-5 space-y-3">
              <Meter
                label="PostgreSQL pool"
                value={
                  monitor && monitor.database.pool.max_open > 0
                    ? (monitor.database.pool.in_use / monitor.database.pool.max_open) * 100
                    : 0
                }
                detail={
                  monitor
                    ? `${monitor.database.pool.in_use} in use of ${monitor.database.pool.max_open} connections`
                    : "Waiting for status…"
                }
              />
              <Meter
                label="Asterisk control plane"
                value={asteriskConfigured ? (asteriskConnected ? 100 : 0) : 0}
                tone={asteriskConfigured ? (asteriskConnected ? "success" : "danger") : "neutral"}
                detail={
                  !asteriskConfigured
                    ? "Not configured — database-only mode"
                    : asteriskConnected
                      ? "AMI/ARI connection healthy"
                      : "Configured but unreachable"
                }
              />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line/60 pt-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                  Database
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-neutral-200">
                  <Database className="h-3.5 w-3.5 text-neutral-500" />
                  {monitor?.database.connected ? "Connected" : "Unavailable"}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                  API uptime
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-neutral-200">
                  <CalendarClock className="h-3.5 w-3.5 text-neutral-500" />
                  {formatUptime(monitor?.uptime_seconds ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                  PBX mode
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-neutral-200">
                  {asteriskConnected ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-neutral-400" />
                  ) : (
                    <WifiOff className="h-3.5 w-3.5 text-neutral-500" />
                  )}
                  {asteriskConnected ? "Live" : asteriskConfigured ? "Degraded" : "Database only"}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
                  Load (1m)
                </p>
                <p className="mono mt-1 flex items-center gap-1.5 text-xs font-medium text-neutral-200">
                  <Cpu className="h-3.5 w-3.5 text-neutral-500" />
                  {data ? data.system.load_1.toFixed(2) : "—"}
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader
            title="Call volume"
            description="Daily totals for the most recent records (up to 31 days)."
            icon={<Activity className="h-4 w-4" />}
            action={
              callStats.data ? (
                <div className="flex items-center gap-3 text-[11px] text-neutral-500">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-white/20" /> Total
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-neutral-400" /> Answered
                  </span>
                </div>
              ) : undefined
            }
          />
          <CardBody>
            {callStats.loading ? (
              <div className="skeleton" style={{ height: 140 }} />
            ) : (
              <SparkBars data={chart} height={150} />
            )}
            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-line/60 pt-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-neutral-600">Total calls</p>
                <p className="mt-0.5 text-lg font-semibold text-white">
                  {formatNumber(callStats.data?.total ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-neutral-600">Answer rate</p>
                <p className="mt-0.5 text-lg font-semibold text-white">
                  {formatPercent(callStats.data?.answer_rate ?? 0, 1)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-neutral-600">Talk time</p>
                <p className="mt-0.5 text-lg font-semibold text-white">
                  {formatDuration(callStats.data?.total_billsec_seconds ?? 0)}
                </p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Configuration"
            description="Stored in PostgreSQL and mirrored to Asterisk realtime."
            icon={<LayoutGrid className="h-4 w-4" />}
          />
          <CardBody className="space-y-1.5">
            {[
              {
                to: "/extensions",
                label: "Extensions",
                value: data?.extensions.total ?? 0,
                icon: Phone,
                permission: "extensions.read",
              },
              {
                to: "/dialplan",
                label: "Enabled dialplan rules",
                value: data?.dialplan.enabled_rules ?? 0,
                icon: GitBranch,
                permission: "dialplan.read",
              },
              {
                to: "/voicemail",
                label: "Voicemail boxes",
                value: data?.voicemail.boxes ?? 0,
                icon: Voicemail,
                permission: "voicemail.read",
              },
              {
                to: "/queues",
                label: "Call queues",
                value: data?.queues.total ?? 0,
                icon: Headphones,
                permission: "queues.read",
              },
              {
                to: "/ivr",
                label: "IVR menus",
                value: data?.ivr.total ?? 0,
                icon: ListTree,
                permission: "ivr.read",
              },
              {
                to: "/conferences",
                label: "Conference rooms",
                value: data?.conferences.total ?? 0,
                icon: Presentation,
                permission: "conferences.read",
              },
              {
                to: "/users",
                label: "Users",
                value: data?.users.total ?? 0,
                icon: UsersRound,
                permission: "users.read",
              },
            ]
              .filter((item) => can(item.permission))
              .map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="group flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-white/[0.04]"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-md border border-line/70 bg-white/[0.035] text-neutral-400 group-hover:text-neutral-300">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="flex-1 text-xs text-neutral-400 group-hover:text-neutral-200">
                      {item.label}
                    </span>
                    <span className="mono text-xs font-semibold text-neutral-200">
                      {formatNumber(item.value)}
                    </span>
                    <ArrowRight className="h-3 w-3 text-neutral-700 transition group-hover:text-neutral-400" />
                  </Link>
                );
              })}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
