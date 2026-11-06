import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ranges, services, useQueueRefs } from "../../api/dialplan";
import { ConfirmDialog, Select } from "../../components/controls";
import { Badge, Button, DataTable, Field, Modal, type Column } from "../../components/ui";
import type { DialRange, ServiceNumber } from "../../types";
import { errorMessage } from "../../utils/errors";

const rootError = (msg?: string) => msg && <p role="alert" className="rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">{msg}</p>;

/* ── Range form ───────────────────────────────────────── */
const rangeSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a name"),
    from: z.string().regex(/^\d{3}$/, "3 digits"),
    to: z.string().regex(/^\d{3}$/, "3 digits"),
    routing: z.enum(["person", "queue"]),
    queue: z.string(),
    ringTimeoutSec: z.string().regex(/^\d+$/, "Enter seconds").refine((v) => +v >= 5 && +v <= 120, "5 to 120 seconds"),
    voicemailFallback: z.boolean(),
  })
  .refine((v) => +v.to >= +v.from, { path: ["to"], message: "Must be greater than or equal to the start" })
  .refine((v) => v.routing !== "queue" || v.queue !== "", { path: ["queue"], message: "Choose a queue" });
type RangeValues = z.infer<typeof rangeSchema>;

function RangeModal({ range, onClose }: { range: DialRange | null; onClose: () => void }) {
  const save = ranges.useSave();
  const queues = useQueueRefs();
  const { register, handleSubmit, watch, setError, formState: { errors, isSubmitting } } = useForm<RangeValues>({
    resolver: zodResolver(rangeSchema),
    defaultValues: {
      name: range?.name ?? "", from: range ? String(range.from) : "", to: range ? String(range.to) : "",
      routing: range?.routing ?? "person", queue: range?.queue ?? "", ringTimeoutSec: String(range?.ringTimeoutSec ?? 20), voicemailFallback: range?.voicemailFallback ?? true,
    },
  });
  const routing = watch("routing");

  const onSubmit = handleSubmit(async (v) => {
    try {
      await save.mutateAsync({
        id: range?.id, name: v.name, from: +v.from, to: +v.to, routing: v.routing,
        queue: v.routing === "queue" ? v.queue : null, ringTimeoutSec: +v.ringTimeoutSec, voicemailFallback: v.voicemailFallback,
      });
      onClose();
    } catch (e) {
      setError("root", { message: errorMessage(e, "Could not save the range") });
    }
  });

  return (
    <Modal open title={range ? "Edit range" : "New range"} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Service name" {...register("name")} error={errors.name?.message} autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" inputMode="numeric" maxLength={3} {...register("from")} error={errors.from?.message} />
          <Field label="To" inputMode="numeric" maxLength={3} {...register("to")} error={errors.to?.message} />
        </div>
        <Select label="Calls are routed to" {...register("routing")}>
          <option value="person">The person (ring the phone)</option>
          <option value="queue">A call-center queue</option>
        </Select>
        {routing === "queue" && (
          <Select label="Queue" {...register("queue")} error={errors.queue?.message}>
            <option value="">Choose…</option>
            {queues.data?.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
          </Select>
        )}
        <Field label="Ring time (seconds)" inputMode="numeric" {...register("ringTimeoutSec")} error={errors.ringTimeoutSec?.message} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("voicemailFallback")} /> Send to voicemail when busy or unanswered</label>
        {rootError(errors.root?.message)}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Service number form ──────────────────────────────── */
const serviceSchema = z
  .object({
    number: z.string().regex(/^\d{2,3}$/, "2 or 3 digits"),
    label: z.string().trim().min(2, "Enter a label"),
    kind: z.enum(["queue", "voicemail-main", "voicemail-deposit"]),
    queue: z.string(),
  })
  .refine((v) => v.kind !== "queue" || v.queue !== "", { path: ["queue"], message: "Choose a queue" });
type ServiceValues = z.infer<typeof serviceSchema>;

function ServiceModal({ service, onClose }: { service: ServiceNumber | null; onClose: () => void }) {
  const save = services.useSave();
  const queues = useQueueRefs();
  const { register, handleSubmit, watch, setError, formState: { errors, isSubmitting } } = useForm<ServiceValues>({
    resolver: zodResolver(serviceSchema),
    defaultValues: { number: service?.number ?? "", label: service?.label ?? "", kind: service?.kind ?? "queue", queue: service?.queue ?? "" },
  });
  const kind = watch("kind");

  const onSubmit = handleSubmit(async (v) => {
    try {
      await save.mutateAsync({ id: service?.id, number: v.number, label: v.label, kind: v.kind, queue: v.kind === "queue" ? v.queue : null });
      onClose();
    } catch (e) {
      setError("root", { message: errorMessage(e, "Could not save the service number") });
    }
  });

  return (
    <Modal open title={service ? "Edit service number" : "New service number"} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Number" inputMode="numeric" maxLength={3} {...register("number")} error={errors.number?.message} autoFocus />
        <Field label="Label" {...register("label")} error={errors.label?.message} />
        <Select label="Action" {...register("kind")}>
          <option value="queue">Enter a call-center queue</option>
          <option value="voicemail-main">Voicemail main menu</option>
          <option value="voicemail-deposit">Leave a voicemail</option>
        </Select>
        {kind === "queue" && (
          <Select label="Queue" {...register("queue")} error={errors.queue?.message}>
            <option value="">Choose…</option>
            {queues.data?.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
          </Select>
        )}
        {rootError(errors.root?.message)}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Tab ──────────────────────────────────────────────── */
const kindLabel = { queue: "Queue", "voicemail-main": "Voicemail menu", "voicemail-deposit": "Voicemail deposit" } as const;

export default function NumberingTab() {
  const rangesQ = ranges.useList();
  const servicesQ = services.useList();
  const queues = useQueueRefs();
  const delRange = ranges.useDelete();
  const delService = services.useDelete();
  const [rangeModal, setRangeModal] = useState<DialRange | "new" | null>(null);
  const [serviceModal, setServiceModal] = useState<ServiceNumber | "new" | null>(null);
  const [deleting, setDeleting] = useState<{ kind: "range" | "service"; id: string; label: string } | null>(null);

  const queueName = (id: string | null) => queues.data?.find((q) => q.id === id)?.name ?? "—";
  const del = deleting?.kind === "range" ? delRange : delService;
  const actions = (edit: () => void, remove: () => void, name: string) => (
    <div className="flex justify-end gap-1">
      <button className="rounded p-1.5 hover:bg-paper" aria-label={`Edit ${name}`} onClick={edit}><Pencil size={15} /></button>
      <button className="rounded p-1.5 text-bad hover:bg-bad/10" aria-label={`Delete ${name}`} onClick={remove}><Trash2 size={15} /></button>
    </div>
  );

  const rangeCols: Column<DialRange>[] = [
    { header: "Service", cell: (r) => <span className="font-medium">{r.name}</span> },
    { header: "Range", cell: (r) => `${r.from} – ${r.to}`, className: "tabular-nums" },
    { header: "Routing", cell: (r) => (r.routing === "queue" ? <Badge tone="warn">Queue: {queueName(r.queue)}</Badge> : <Badge>Person first</Badge>) },
    { header: "Ring time", cell: (r) => `${r.ringTimeoutSec}s`, className: "tabular-nums" },
    { header: "Voicemail", cell: (r) => (r.voicemailFallback ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>) },
    { header: "", className: "w-24 text-right", cell: (r) => actions(() => setRangeModal(r), () => setDeleting({ kind: "range", id: r.id, label: r.name }), r.name) },
  ];
  const serviceCols: Column<ServiceNumber>[] = [
    { header: "Number", cell: (s) => <span className="font-semibold tabular-nums">{s.number}</span> },
    { header: "Label", cell: (s) => s.label },
    { header: "Action", cell: (s) => (s.kind === "queue" ? `Queue: ${queueName(s.queue)}` : kindLabel[s.kind]) },
    { header: "", className: "w-24 text-right", cell: (s) => actions(() => setServiceModal(s), () => setDeleting({ kind: "service", id: s.id, label: s.number }), `service ${s.number}`) },
  ];

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Extension ranges</h2>
          <Button onClick={() => setRangeModal("new")}><Plus size={16} /> New range</Button>
        </div>
        {rangesQ.error && rootError(rangesQ.error.message)}
        <DataTable columns={rangeCols} rows={(rangesQ.data ?? []).slice().sort((a, b) => a.from - b.from)} rowKey={(r) => r.id} empty={rangesQ.isLoading ? "Loading…" : "No ranges defined."} />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Service numbers</h2>
          <Button variant="secondary" onClick={() => setServiceModal("new")}><Plus size={16} /> New service number</Button>
        </div>
        {servicesQ.error && rootError(servicesQ.error.message)}
        <DataTable columns={serviceCols} rows={(servicesQ.data ?? []).slice().sort((a, b) => a.number.localeCompare(b.number))} rowKey={(s) => s.id} empty={servicesQ.isLoading ? "Loading…" : "No service numbers."} />
      </section>

      {rangeModal && <RangeModal key={rangeModal === "new" ? "new" : rangeModal.id} range={rangeModal === "new" ? null : rangeModal} onClose={() => setRangeModal(null)} />}
      {serviceModal && <ServiceModal key={serviceModal === "new" ? "new" : serviceModal.id} service={serviceModal === "new" ? null : serviceModal} onClose={() => setServiceModal(null)} />}

      <ConfirmDialog
        open={!!deleting} title={deleting?.kind === "range" ? "Delete range" : "Delete service number"} busy={del.isPending} error={del.error?.message}
        onClose={() => { setDeleting(null); del.reset(); }}
        onConfirm={() => deleting && del.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
      >
        Delete <strong>{deleting?.label}</strong>?
        {deleting?.kind === "range" && " Calls to these extensions will no longer be routed, and its restriction rules are removed."}
      </ConfirmDialog>
    </div>
  );
}
