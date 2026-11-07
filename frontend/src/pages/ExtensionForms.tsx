import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, Download, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ApiError } from "../api/client";
import { useBulkExtensions, useSaveExtension, useUsers } from "../api/directory";
import { Button, Dropdown, Field, Modal } from "../components/ui";
import type { Extension } from "../types";
import { departmentLabel, departmentOf, downloadCsv, generateSecret } from "../utils/sip";

const number = z.string().regex(/^[1-5]\d\d$/, "Use a 3-digit number from 100 to 599");

/* ── Single extension ─────────────────────────────────── */
const singleSchema = (isEdit: boolean) =>
  z.object({
    number,
    userId: z.string(),
    secret: isEdit
      ? z.string().refine((v) => v === "" || (v.length >= 8 && !/\s/.test(v)), "At least 8 characters, no spaces")
      : z.string().min(8, "At least 8 characters").regex(/^\S+$/, "No spaces"),
    enabled: z.boolean(),
  });
type SingleValues = z.infer<ReturnType<typeof singleSchema>>;

export function ExtensionModal({ extension, onClose }: { extension: Extension | null; onClose: () => void }) {
  const isEdit = !!extension;
  const users = useUsers();
  const save = useSaveExtension(isEdit);
  const { register, handleSubmit, setValue, getValues, watch, setError, formState: { errors, isSubmitting } } = useForm<SingleValues>({
    resolver: zodResolver(singleSchema(isEdit)),
    mode: "onSubmit",
    defaultValues: { number: extension?.number ?? "", userId: extension?.userId ?? "", secret: isEdit ? "" : generateSecret(), enabled: extension?.enabled ?? true },
  });

  const onSubmit = handleSubmit(async (v) => {
    try {
      await save.mutateAsync({ ...v, userId: v.userId || null });
      onClose();
    } catch (e) {
      setError("root", { message: e instanceof ApiError ? e.message : "Could not save the extension" });
    }
  });

  return (
    <Modal open title={isEdit ? `Edit extension ${extension.number}` : "New extension"} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <Field label="Extension number" inputMode="numeric" maxLength={3} readOnly={isEdit} {...register("number")} error={errors.number?.message}
          className={isEdit ? "bg-[#ffe6d9]" : undefined} />
        <Dropdown
          triggerLabel={watch("userId") || "Assigned user"}
          value={watch("userId") || ""}
          onChange={(val) => setValue("userId", val)}
          items={[
            { label: "Unassigned", value: "" },
            ...(users.data?.slice().sort((a, b) => a.fullName.localeCompare(b.fullName)) || []).map((u) => ({
              label: `${u.fullName} (${departmentLabel(u.department)})`,
              value: u.id,
            })),
          ]}
          size="sm"
        />
        <div className="flex items-end gap-4">
          <Field className="flex-1" label="SIP password" autoComplete="off" spellCheck={false} placeholder={isEdit ? "Leave empty to keep the current password" : undefined}
            {...register("secret")} error={errors.secret?.message} />
          <Button type="button" variant="secondary" size="sm" aria-label="Generate password" title="Generate" onClick={() => setValue("secret", generateSecret(), { shouldValidate: true })}><RefreshCw size={16} /></Button>
          <Button type="button" variant="secondary" size="sm" aria-label="Copy password" title="Copy" onClick={() => navigator.clipboard?.writeText(getValues("secret"))}><Copy size={16} /></Button>
        </div>
        <label className="flex items-center gap-3 text-sm font-bold text-ink cursor-pointer"><input type="checkbox" {...register("enabled")} /> Enabled</label>
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

/* ── Bulk create a range ──────────────────────────────── */
const MAX_BULK = 100;
const bulkSchema = z
  .object({ from: number, to: number, enabled: z.boolean() })
  .refine((v) => Number(v.to) >= Number(v.from), { path: ["to"], message: "Must be greater than or equal to the start" })
  .refine((v) => Number(v.to) - Number(v.from) + 1 <= MAX_BULK, { path: ["to"], message: `At most ${MAX_BULK} extensions at once` });
type BulkValues = z.infer<typeof bulkSchema>;

export function BulkModal({ onClose }: { onClose: () => void }) {
  const bulk = useBulkExtensions();
  const [result, setResult] = useState<{ created: string[]; skipped: string[]; secrets: Map<string, string> } | null>(null);
  const { register, handleSubmit, watch, setError, formState: { errors, isSubmitting } } = useForm<BulkValues>({
    resolver: zodResolver(bulkSchema),
    mode: "onSubmit",
    defaultValues: { from: "", to: "", enabled: true },
  });
  const [from, to] = watch(["from", "to"]);
  const count = /^[1-5]\d\d$/.test(from) && /^[1-5]\d\d$/.test(to) && Number(to) >= Number(from) ? Number(to) - Number(from) + 1 : 0;

  const onSubmit = handleSubmit(async (v) => {
    const secrets = new Map<string, string>();
    for (let n = Number(v.from); n <= Number(v.to); n++) secrets.set(String(n), generateSecret());
    try {
      const res = await bulk.mutateAsync({ enabled: v.enabled, extensions: [...secrets].map(([number, secret]) => ({ number, secret })) });
      setResult({ ...res, secrets });
    } catch (e) {
      setError("root", { message: e instanceof ApiError ? e.message : "Bulk creation failed" });
    }
  });

  if (result) {
    return (
      <Modal open title="Extensions created" onClose={onClose}>
        <div className="space-y-5">
          <p className="text-sm font-bold text-ink">Created <strong className="text-brand">{result.created.length}</strong>{result.skipped.length > 0 && <>, skipped {result.skipped.length} that already existed ({result.skipped.slice(0, 6).join(", ")}{result.skipped.length > 6 ? "…" : ""})</>}.</p>
          <p className="text-xs font-bold text-ink-2">Passwords are shown only now. Download them before closing.</p>
          <div className="flex justify-end gap-4">
            <Button variant="secondary" size="sm" disabled={result.created.length === 0} onClick={() => downloadCsv("extensions.csv", [["extension", "department", "password"], ...result.created.map((n) => [n, departmentLabel(departmentOf(n)!), result.secrets.get(n)!])])}>
              <Download size={16} /> Download CSV
            </Button>
            <Button size="sm" onClick={onClose}>Done</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open title="Create a range of extensions" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <div className="grid grid-cols-2 gap-4">
          <Field label="From" inputMode="numeric" maxLength={3} placeholder="100" {...register("from")} error={errors.from?.message} />
          <Field label="To" inputMode="numeric" maxLength={3} placeholder="119" {...register("to")} error={errors.to?.message} />
        </div>
        <label className="flex items-center gap-3 text-sm font-bold text-ink cursor-pointer"><input type="checkbox" {...register("enabled")} /> Enabled</label>
        <p className="text-xs font-bold text-ink-2">{count ? `Creates ${count} extension${count > 1 ? "s" : ""}, each with a random password. Existing numbers are skipped.` : "Passwords are generated for you."}</p>
        {errors.root && (
          <div className="nb-card p-3 bg-[#fee2e2] border-4 border-red-600 shadow-[4px_4px_0_#b91c1c]">
            <p className="text-xs font-bold text-red-800">{errors.root.message}</p>
          </div>
        )}
        <div className="flex justify-end gap-4">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Creating…" : "Create"}</Button>
        </div>
      </form>
    </Modal>
  );
}
