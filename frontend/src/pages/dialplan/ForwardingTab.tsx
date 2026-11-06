import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { forwarding } from "../../api/dialplan";
import { ConfirmDialog, Select, Switch } from "../../components/controls";
import { Button, DataTable, Field, Modal, type Column } from "../../components/ui";
import type { ForwardRule, ForwardType } from "../../types";
import { errorMessage } from "../../utils/errors";

const typeLabel: Record<ForwardType, string> = { unconditional: "Always", busy: "When busy", "no-answer": "When unanswered" };

const schema = z.object({
  extension: z.string().regex(/^[1-5]\d\d$/, "Use a 3-digit extension from 100 to 599"),
  type: z.enum(["unconditional", "busy", "no-answer"]),
  destination: z.string().regex(/^\+?\d{3,15}$/, "Enter an extension or phone number (digits only)"),
  enabled: z.boolean(),
});
type Values = z.infer<typeof schema>;

function RuleModal({ rule, onClose }: { rule: ForwardRule | null; onClose: () => void }) {
  const save = forwarding.useSave();
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { extension: rule?.extension ?? "", type: rule?.type ?? "no-answer", destination: rule?.destination ?? "", enabled: rule?.enabled ?? true },
  });

  const onSubmit = handleSubmit(async (v) => {
    try {
      await save.mutateAsync({ ...v, id: rule?.id });
      onClose();
    } catch (e) {
      setError("root", { message: errorMessage(e, "Could not save the rule") });
    }
  });

  return (
    <Modal open title={rule ? "Edit forwarding rule" : "New forwarding rule"} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Extension to forward" inputMode="numeric" maxLength={3} {...register("extension")} error={errors.extension?.message} autoFocus />
        <Select label="Forward" {...register("type")}>
          {Object.entries(typeLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Field label="Destination" inputMode="tel" placeholder="102 or 0550123456" {...register("destination")} error={errors.destination?.message} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("enabled")} /> Enabled</label>
        {errors.root && <p role="alert" className="rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">{errors.root.message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function ForwardingTab() {
  const list = forwarding.useList();
  const save = forwarding.useSave();
  const remove = forwarding.useDelete();
  const [modal, setModal] = useState<ForwardRule | "new" | null>(null);
  const [deleting, setDeleting] = useState<ForwardRule | null>(null);

  const columns: Column<ForwardRule>[] = [
    { header: "Extension", cell: (r) => <span className="font-semibold tabular-nums">{r.extension}</span> },
    { header: "Forward", cell: (r) => typeLabel[r.type] },
    { header: "To", cell: (r) => r.destination, className: "tabular-nums" },
    { header: "Enabled", cell: (r) => <Switch checked={r.enabled} label={`Enable forwarding for ${r.extension}`} disabled={save.isPending} onChange={(enabled) => save.mutate({ ...r, enabled })} /> },
    {
      header: "", className: "w-24 text-right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <button className="rounded p-1.5 hover:bg-paper" aria-label={`Edit forwarding for ${r.extension}`} onClick={() => setModal(r)}><Pencil size={15} /></button>
          <button className="rounded p-1.5 text-bad hover:bg-bad/10" aria-label={`Delete forwarding for ${r.extension}`} onClick={() => setDeleting(r)}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-ink/60">Redirect calls for an extension to another extension or an outside number.</p>
        <Button onClick={() => setModal("new")}><Plus size={16} /> New rule</Button>
      </div>
      {(list.error || save.error) && <p role="alert" className="mb-3 rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">{(list.error ?? save.error)!.message}</p>}
      <DataTable columns={columns} rows={(list.data ?? []).slice().sort((a, b) => a.extension.localeCompare(b.extension))} rowKey={(r) => r.id} empty={list.isLoading ? "Loading…" : "No forwarding rules."} />

      {modal && <RuleModal key={modal === "new" ? "new" : modal.id} rule={modal === "new" ? null : modal} onClose={() => setModal(null)} />}
      <ConfirmDialog
        open={!!deleting} title="Delete forwarding rule" busy={remove.isPending} error={remove.error?.message}
        onClose={() => { setDeleting(null); remove.reset(); }}
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
      >
        Stop forwarding calls for extension <strong>{deleting?.extension}</strong> ({deleting && typeLabel[deleting.type].toLowerCase()})?
      </ConfirmDialog>
    </div>
  );
}
