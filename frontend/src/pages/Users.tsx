import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ApiError } from "../api/client";
import { useDeleteUser, useExtensions, useSaveUser, useUsers } from "../api/directory";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog, Pagination } from "../components/controls";
import { Badge, Button, DataTable, Dropdown, Field, Modal, PageHeader, type Column } from "../components/ui";
import type { DepartmentId, DirectoryUser } from "../types";
import { DEPARTMENTS, departmentLabel } from "../utils/sip";

const PAGE_SIZE = 25;

const schema = z.object({
  fullName: z.string().trim().min(2, "Enter the full name"),
  email: z.string().email("Enter a valid email address"),
  department: z.enum(DEPARTMENTS.map((d) => d.id) as [DepartmentId, ...DepartmentId[]]),
});
type FormValues = z.infer<typeof schema>;

function UserModal({ user, onClose }: { user: DirectoryUser | null; onClose: () => void }) {
  const save = useSaveUser();
  const { register, handleSubmit, setError, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onSubmit",
    defaultValues: { fullName: user?.fullName ?? "", email: user?.email ?? "", department: user?.department ?? "administration" },
  });

  const departmentValue = watch("department");

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
      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <Field label="Full name" {...register("fullName")} error={errors.fullName?.message} />
        <Field label="Email" type="email" {...register("email")} error={errors.email?.message} />
        <Dropdown
          triggerLabel={departmentValue || "Department"}
          value={watch("department") || ""}
          onChange={(val) => setValue("department", val as DepartmentId)}
          items={[
            ...(DEPARTMENTS.slice().sort((a, b) => a.label.localeCompare(b.label)) || []).map((d) => ({
              label: d.label,
              value: d.id,
            })),
          ]}
          size="sm"
        />
        {errors.root && (
          <div className="nb-card p-3 bg-[#fee2e2] border-4 border-red-600 shadow-[4px_4px_0_#b91c1c]">
            <p className="text-xs font-bold text-red-800">{errors.root.message}</p>
          </div>
        )}
        <div className="flex justify-end gap-4">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
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
    { header: "Name", cell: (u) => (<><p className="font-black text-sm">{u.fullName}</p><p className="text-xs font-bold text-ink-2">{u.email}</p></>) },
    { header: "Department", cell: (u) => (
      <Badge tone={u.department === "administration" ? "dept-admin" : u.department === "finance" ? "dept-finance" : u.department === "it" ? "dept-it" : u.department === "support" ? "dept-support" : "dept-management"}>
        {departmentLabel(u.department)}
      </Badge>
    ) },
    {
      header: "Extensions",
      cell: (u) => {
        const list = extByUser.get(u.id) ?? [];
        return list.length ? <span className="tabular-nums text-sm font-black">{list.slice(0, 3).join(", ")}{list.length > 3 && ` +${list.length - 3}`}</span> : <span className="text-xs font-bold text-ink-2">None</span>;
      },
    },
    { header: "Created", cell: (u) => new Date(u.createdAt).toLocaleDateString("en-GB"), className: "tabular-nums text-sm font-black" },
    {
      header: "",
      className: "w-24 text-right",
      cell: (u) => (
        <div className="flex justify-end gap-4">
          <button className="nb-btn secondary size sm p-1.5 border-4 border-black shadow-[4px_4px_0_#000] hover:bg-[#ffe6d9]" aria-label={`Edit ${u.fullName}`} onClick={() => setEditing(u)}><Pencil size={14} /></button>
          {isAdmin && <button className="nb-btn danger p-1.5" aria-label={`Delete ${u.fullName}`} onClick={() => setDeleting(u)}><Trash2 size={14} /></button>}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        description={users.data ? `${users.data.length} directory users` : "Loading…"}
        actions={<Button size="sm" onClick={() => setEditing("new")}><Plus size={16} /> New user</Button>}
      />

      <div className="mb-8 flex flex-wrap gap-4">
        <input
          aria-label="Search users" placeholder="Search name or email" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-72 nb-input"
        />
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
      </div>

      {users.error && (
        <div className="mb-8 nb-card p-4 bg-[#fee2e2] border-4 border-red-600 shadow-[4px_4px_0_#b91c1c]">
          <p className="text-xs font-bold text-red-800">⚠ Could not load users: {users.error.message}</p>
        </div>
      )}
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
