import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useSaveTransfer, useTransfer } from "../../api/dialplan";
import { Button, Field } from "../../components/ui";
import type { TransferSettings } from "../../types";
import { errorMessage } from "../../utils/errors";

const code = z.string().regex(/^[0-9*#]{1,4}$/, "1 to 4 characters: digits, * or #");
const schema = z
  .object({
    blindEnabled: z.boolean(),
    blindCode: code,
    attendedEnabled: z.boolean(),
    attendedCode: code,
    timeoutSec: z.number({ error: "Enter a number of seconds" }).int().min(5, "At least 5 seconds").max(60, "At most 60 seconds"),
  })
  .refine((v) => v.blindCode !== v.attendedCode, { path: ["attendedCode"], message: "Must differ from the blind transfer code" });

export default function TransferTab() {
  const query = useTransfer();
  const save = useSaveTransfer();
  const { register, handleSubmit, setError, formState: { errors, isSubmitting, isDirty } } = useForm<TransferSettings>({
    resolver: zodResolver(schema),
    values: query.data, // refills the form when the server data arrives or changes
  });

  const onSubmit = handleSubmit(async (v) => {
    try {
      await save.mutateAsync(v);
    } catch (e) {
      setError("root", { message: errorMessage(e, "Could not save the settings") });
    }
  });

  if (query.isLoading) return <p className="text-sm text-ink/60">Loading…</p>;
  if (query.error) return <p role="alert" className="rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">{query.error.message}</p>;

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-6" noValidate>
      <p className="text-sm text-ink/60">
        Feature codes are typed on the phone during a call. With a blind transfer the call is handed over immediately; with an attended transfer the caller speaks to the target first.
      </p>

      <fieldset className="space-y-3 rounded-lg border border-line bg-white p-4">
        <legend className="px-1 text-sm font-semibold">Blind transfer</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("blindEnabled")} /> Enabled</label>
        <Field label="Feature code" className="w-40" {...register("blindCode")} error={errors.blindCode?.message} />
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border border-line bg-white p-4">
        <legend className="px-1 text-sm font-semibold">Attended transfer</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("attendedEnabled")} /> Enabled</label>
        <Field label="Feature code" className="w-40" {...register("attendedCode")} error={errors.attendedCode?.message} />
      </fieldset>

      <Field label="Ring time before the call returns (seconds)" type="number" className="w-56" {...register("timeoutSec", { valueAsNumber: true })} error={errors.timeoutSec?.message} />

      {errors.root && <p role="alert" className="rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">{errors.root.message}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isSubmitting || !isDirty}>{isSubmitting ? "Applying…" : "Save changes"}</Button>
        {save.isSuccess && !isDirty && <span className="text-sm text-ok" aria-live="polite">Saved and applied</span>}
      </div>
    </form>
  );
}
