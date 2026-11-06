import { Ban, Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ranges, useRestrictions, useSaveRestrictions } from "../../api/dialplan";
import { Button } from "../../components/ui";

const key = (from: string, to: string) => `${from}>${to}`;

export default function RestrictionsTab() {
  const rangesQ = ranges.useList();
  const res = useRestrictions();
  const save = useSaveRestrictions();

  const server = useMemo(() => new Set((res.data?.blocked ?? []).map((b) => key(b.fromRangeId, b.toRangeId))), [res.data]);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  useEffect(() => setBlocked(new Set(server)), [server]);

  const list = (rangesQ.data ?? []).slice().sort((a, b) => a.from - b.from);
  const dirty = blocked.size !== server.size || [...blocked].some((k) => !server.has(k));

  const toggle = (k: string) => setBlocked((prev) => { const n = new Set(prev); if (!n.delete(k)) n.add(k); return n; });
  const apply = () =>
    save.mutate({ blocked: [...blocked].map((k) => { const [fromRangeId, toRangeId] = k.split(">"); return { fromRangeId, toRangeId }; }) });

  return (
    <div>
      <p className="mb-4 max-w-2xl text-sm text-ink/60">
        Choose which services can call each other. Each row is the caller, each column is the service being called. Blocked calls are rejected by Asterisk.
      </p>

      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-paper text-ink/70">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Caller ↓ / Callee →</th>
              {list.map((r) => (
                <th key={r.id} className="px-3 py-2.5 text-center font-medium">
                  {r.name}<span className="block text-xs font-normal tabular-nums text-ink/50">{r.from}–{r.to}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((from) => (
              <tr key={from.id} className="border-b border-line last:border-0">
                <th scope="row" className="px-4 py-2.5 text-left font-medium">{from.name}</th>
                {list.map((to) => {
                  const k = key(from.id, to.id);
                  const isBlocked = blocked.has(k);
                  return (
                    <td key={to.id} className="px-3 py-2 text-center">
                      <button
                        type="button" aria-pressed={isBlocked} onClick={() => toggle(k)}
                        aria-label={`${from.name} calling ${to.name}: ${isBlocked ? "blocked" : "allowed"}`}
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${isBlocked ? "bg-bad/10 text-bad" : "bg-ok/10 text-ok"}`}
                      >
                        {isBlocked ? <Ban size={16} /> : <Check size={16} />}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            {list.length === 0 && <tr><td className="px-4 py-8 text-center text-ink/50">{rangesQ.isLoading ? "Loading…" : "Define ranges in the Numbering plan first."}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={apply} disabled={!dirty || save.isPending}>{save.isPending ? "Applying…" : "Save changes"}</Button>
        <Button variant="secondary" onClick={() => setBlocked(new Set(server))} disabled={!dirty}>Discard</Button>
        <Button variant="secondary" onClick={() => setBlocked(new Set())} disabled={blocked.size === 0}>Allow all</Button>
        <span className="text-sm text-ink/60" aria-live="polite">
          {save.error ? <span className="text-bad">{save.error.message}</span> : dirty ? "Unsaved changes" : save.isSuccess ? "Saved and applied" : `${blocked.size} blocked`}
        </span>
      </div>
    </div>
  );
}
