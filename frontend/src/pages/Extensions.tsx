import { Pencil, Plus, Rows3, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useDeleteExtension, useExtensions, useToggleExtension, useUsers } from "../api/directory";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog, Pagination, Switch } from "../components/controls";
import { Badge, Button, DataTable, Dropdown, PageHeader, type Column } from "../components/ui";
import type { Extension } from "../types";
import { DEPARTMENTS, departmentLabel, departmentOf } from "../utils/sip";
import { BulkModal, ExtensionModal } from "./ExtensionForms";

const PAGE_SIZE = 25;
type Status = "registered" | "offline" | "disabled";
const statusOf = (e: Extension): Status => (!e.enabled ? "disabled" : e.registered ? "registered" : "offline");

export default function Extensions() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const extensions = useExtensions();
  const users = useUsers();
  const toggle = useToggleExtension();
  const remove = useDeleteExtension();

  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<Extension | "new" | "bulk" | null>(null);
  const [deleting, setDeleting] = useState<Extension | null>(null);

  const names = useMemo(() => new Map((users.data ?? []).map((u) => [u.id, u.fullName])), [users.data]);
  const all = extensions.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter(
      (e) =>
        (!department || departmentOf(e.number) === department) &&
        (!status || statusOf(e) === status) &&
        (!q || e.number.includes(q) || (e.userId && names.get(e.userId)?.toLowerCase().includes(q))),
    );
  }, [all, names, search, department, status]);
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const columns: Column<Extension>[] = [
    { header: "Extension", cell: (e) => <span className="font-black text-sm tabular-nums">{e.number}</span> },
    { header: "User", cell: (e) => (e.userId ? names.get(e.userId) ?? "…" : <span className="text-xs font-bold text-ink-2">Unassigned</span>) },
    { header: "Department", cell: (e) => departmentLabel(departmentOf(e.number)!) },
    {
      header: "Status",
      cell: (e) => {
        const s = statusOf(e);
        return (
          <div className="flex items-center gap-3">
            <Badge tone={s === "registered" ? "status-running" : s === "disabled" ? "status-stopped" : "status-degraded"}>{s}</Badge>
            {e.contactIp && <span className="text-xs font-bold tabular-nums text-ink-2">{e.contactIp}</span>}
          </div>
        );
      },
    },
    { header: "Enabled", cell: (e) => <Switch checked={e.enabled} label={`Enable extension ${e.number}`} disabled={toggle.isPending} onChange={(enabled) => toggle.mutate({ number: e.number, enabled })} /> },
    {
      header: "",
      className: "w-24 text-right",
      cell: (e) => (
        <div className="flex justify-end gap-4">
          <button className="nb-btn secondary size sm p-1.5 border-4 border-black shadow-[4px_4px_0_#000] hover:bg-[#ffe6d9]" aria-label={`Edit extension ${e.number}`} onClick={() => setModal(e)}><Pencil size={14} /></button>
          {isAdmin && <button className="nb-btn danger p-1.5" aria-label={`Delete extension ${e.number}`} onClick={() => setDeleting(e)}><Trash2 size={14} /></button>}
        </div>
      ),
    },
  ];

  const reset = (fn: () => void) => { fn(); setPage(1); };

  return (
    <>
      <PageHeader
        title="Extensions"
        description={extensions.data ? `${all.length} extensions · ${all.filter((e) => e.registered).length} registered now` : "Loading…"}
        actions={
          <div className="flex gap-4">
            {isAdmin && <Button variant="secondary" size="sm" onClick={() => setModal("bulk")}><Rows3 size={16} /> Create range</Button>}
            <Button size="sm" onClick={() => setModal("new")}><Plus size={16} /> New extension</Button>
          </div>
        }
      />

      <div className="mb-8 flex flex-wrap gap-4">
        <input aria-label="Search extensions" placeholder="Search number or user" value={search} onChange={(e) => reset(() => setSearch(e.target.value))} className="w-72 nb-input" />
        <Dropdown
          triggerLabel={department || "Department"}
          value={department || ""}
          onChange={(val) => setDepartment(val)}
          items={[
            { label: "All departments", value: "" },
            ...DEPARTMENTS.map((d) => ({
              label: d.label,
              value: d.id,
            })),
          ]}
          size="sm"
        />
        <Dropdown
          triggerLabel={status || "Status"}
          value={status || ""}
          onChange={(val) => setStatus(val)}
          items={[
            { label: "Any status", value: "" },
            { label: "Registered", value: "registered" },
            { label: "Offline", value: "offline" },
            { label: "Disabled", value: "disabled" },
          ]}
          size="sm"
        />
      </div>

      {(extensions.error || toggle.error) && (
        <div className="mb-8 nb-card p-4 bg-[#fee2e2] border-4 border-red-600 shadow-[4px_4px_0_#b91c1c]">
          <p className="text-xs font-bold text-red-800">⚠ {(extensions.error ?? toggle.error)!.message}</p>
        </div>
      )}
      <DataTable columns={columns} rows={rows} rowKey={(e) => e.number} empty={extensions.isLoading ? "Loading…" : "No extensions match."} />
      <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />

      {modal === "bulk" && <BulkModal onClose={() => setModal(null)} />}
      {modal && modal !== "bulk" && <ExtensionModal key={modal === "new" ? "new" : modal.number} extension={modal === "new" ? null : modal} onClose={() => setModal(null)} />}

      <ConfirmDialog
        open={!!deleting} title="Delete extension" busy={remove.isPending} error={remove.error?.message}
        onClose={() => { setDeleting(null); remove.reset(); }}
        onConfirm={() => deleting && remove.mutate(deleting.number, { onSuccess: () => setDeleting(null) })}
      >
        Delete extension <strong>{deleting?.number}</strong>? The phone will no longer be able to register.
      </ConfirmDialog>
    </>
  );
}
