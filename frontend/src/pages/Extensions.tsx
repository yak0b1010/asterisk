import { Pencil, Plus, Rows3, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useDeleteExtension, useExtensions, useToggleExtension, useUsers } from "../api/directory";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog, Pagination, Switch } from "../components/controls";
import { Badge, Button, DataTable, PageHeader, type Column } from "../components/ui";
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
    { header: "Extension", cell: (e) => <span className="font-semibold tabular-nums">{e.number}</span> },
    { header: "User", cell: (e) => (e.userId ? names.get(e.userId) ?? "…" : <span className="text-ink/40">Unassigned</span>) },
    { header: "Department", cell: (e) => departmentLabel(departmentOf(e.number)!) },
    {
      header: "Status",
      cell: (e) => {
        const s = statusOf(e);
        return (
          <div className="flex items-center gap-2">
            <Badge tone={s === "registered" ? "ok" : s === "disabled" ? "warn" : "neutral"}>{s}</Badge>
            {e.contactIp && <span className="text-xs tabular-nums text-ink/50">{e.contactIp}</span>}
          </div>
        );
      },
    },
    { header: "Enabled", cell: (e) => <Switch checked={e.enabled} label={`Enable extension ${e.number}`} disabled={toggle.isPending} onChange={(enabled) => toggle.mutate({ number: e.number, enabled })} /> },
    {
      header: "",
      className: "w-24 text-right",
      cell: (e) => (
        <div className="flex justify-end gap-1">
          <button className="rounded p-1.5 hover:bg-paper" aria-label={`Edit extension ${e.number}`} onClick={() => setModal(e)}><Pencil size={15} /></button>
          {isAdmin && <button className="rounded p-1.5 text-bad hover:bg-bad/10" aria-label={`Delete extension ${e.number}`} onClick={() => setDeleting(e)}><Trash2 size={15} /></button>}
        </div>
      ),
    },
  ];

  const reset = (fn: () => void) => { fn(); setPage(1); };
  const selectCls = "rounded-md border border-line bg-white px-3 py-2 text-sm";

  return (
    <>
      <PageHeader
        title="Extensions"
        description={extensions.data ? `${all.length} extensions · ${all.filter((e) => e.registered).length} registered now` : "Loading…"}
        actions={
          <div className="flex gap-2">
            {isAdmin && <Button variant="secondary" onClick={() => setModal("bulk")}><Rows3 size={16} /> Create range</Button>}
            <Button onClick={() => setModal("new")}><Plus size={16} /> New extension</Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <input aria-label="Search extensions" placeholder="Search number or user" value={search} onChange={(e) => reset(() => setSearch(e.target.value))} className="w-64 rounded-md border border-line bg-white px-3 py-2 text-sm" />
        <select aria-label="Filter by department" value={department} onChange={(e) => reset(() => setDepartment(e.target.value))} className={selectCls}>
          <option value="">All departments</option>
          {DEPARTMENTS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        <select aria-label="Filter by status" value={status} onChange={(e) => reset(() => setStatus(e.target.value))} className={selectCls}>
          <option value="">Any status</option>
          <option value="registered">Registered</option>
          <option value="offline">Offline</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>

      {(extensions.error || toggle.error) && (
        <p role="alert" className="mb-4 rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">{(extensions.error ?? toggle.error)!.message}</p>
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
