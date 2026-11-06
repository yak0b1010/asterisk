import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ApiError } from "../api/client";
import { useDeleteUser, useExtensions, useSaveUser, useUsers } from "../api/directory";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog, Pagination, Select } from "../components/controls";
import { Badge, Button, DataTable, Field, Modal, PageHeader, type Column } from "../components/ui";
import type { DepartmentId, DirectoryUser } from "../types";
import { DEPARTMENTS, departmentLabel } from "../utils/sip";

const PAGE_SIZE = 25;

const schema = z.object({
  fullName: z.string().trim().min(2, "Enter the full name"),
  email: z.email("Enter a valid email address"),
  department: z.enum(DEPARTMENTS.map((d) => d.id) as [DepartmentId, ...DepartmentId[]]),
});
type FormValues = z.infer<typeof schema>;

function UserModal({ user, onClose }: { user: DirectoryUser | null; onClose: () => void }) {
  const save = useSaveUser();
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: user?.fullName ?? "", email: user?.email ?? "", department: user?.department ?? "administration" },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await save.mutateAsync({ ...values, id: user?.id });
      onClose();
    } catch (e) {
      setError("root", { message: e instanceof ApiError ? e.message : "Could not save the user" });
    }
  });

  return (
    <Modal open title={user ? "Edit user" : "New user"} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Full name" {...register("fullName")} error={errors.fullName?.message} autoFocus />
        <Field label="Email" type="email" {...register("email")} error={errors.email?.message} />
        <Select label="Department" {...register("department")}>
          {DEPARTMENTS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </Select>
        {errors.root && <p role="alert" className="rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">{errors.root.message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function Users() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const users = useUsers();
  const extensions = useExtensions();
  const remove = useDeleteUser();

  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<DirectoryUser | "new" | null>(null);
  const [deleting, setDeleting] = useState<DirectoryUser | null>(null);

  const extByUser = useMemo(() => {
    const map = new Map<string, string[]>();
    extensions.data?.forEach((e) => e.userId && map.set(e.userId, [...(map.get(e.userId) ?? []), e.number]));
    return map;
  }, [extensions.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (users.data ?? []).filter(
      (u) => (!department || u.department === department) && (!q || u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)),
    );
  }, [users.data, search, department]);
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const columns: Column<DirectoryUser>[] = [
    { header: "Name", cell: (u) => (<><p className="font-medium">{u.fullName}</p><p className="text-xs text-ink/50">{u.email}</p></>) },
    { header: "Department", cell: (u) => <Badge>{departmentLabel(u.department)}</Badge> },
    {
      header: "Extensions",
      cell: (u) => {
        const list = extByUser.get(u.id) ?? [];
        return list.length ? <span className="tabular-nums">{list.slice(0, 3).join(", ")}{list.length > 3 && ` +${list.length - 3}`}</span> : <span className="text-ink/40">None</span>;
      },
    },
    { header: "Created", cell: (u) => new Date(u.createdAt).toLocaleDateString("en-GB"), className: "tabular-nums" },
    {
      header: "",
      className: "w-24 text-right",
      cell: (u) => (
        <div className="flex justify-end gap-1">
          <button className="rounded p-1.5 hover:bg-paper" aria-label={`Edit ${u.fullName}`} onClick={() => setEditing(u)}><Pencil size={15} /></button>
          {isAdmin && <button className="rounded p-1.5 text-bad hover:bg-bad/10" aria-label={`Delete ${u.fullName}`} onClick={() => setDeleting(u)}><Trash2 size={15} /></button>}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        description={users.data ? `${users.data.length} users` : "Loading…"}
        actions={<Button onClick={() => setEditing("new")}><Plus size={16} /> New user</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <input
          aria-label="Search users" placeholder="Search name or email" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-64 rounded-md border border-line bg-white px-3 py-2 text-sm"
        />
        <select aria-label="Filter by department" value={department} onChange={(e) => { setDepartment(e.target.value); setPage(1); }} className="rounded-md border border-line bg-white px-3 py-2 text-sm">
          <option value="">All departments</option>
          {DEPARTMENTS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </div>

      {users.error && <p role="alert" className="mb-4 rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">Could not load users: {users.error.message}</p>}
      <DataTable columns={columns} rows={rows} rowKey={(u) => u.id} empty={users.isLoading ? "Loading…" : "No users match."} />
      <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />

      {editing && <UserModal key={editing === "new" ? "new" : editing.id} user={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={!!deleting} title="Delete user" busy={remove.isPending} error={remove.error?.message}
        onClose={() => { setDeleting(null); remove.reset(); }}
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
      >
        Delete <strong>{deleting?.fullName}</strong>? Their extensions stay active but become unassigned.
      </ConfirmDialog>
    </>
  );
}
