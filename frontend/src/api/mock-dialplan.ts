import type { DialRange, ForwardRule, QueueRef, Restrictions, ServiceNumber, TransferSettings } from "../types";
import { MockHttpError } from "./mock-errors";

const bad = (status: number, msg: string): never => { throw new MockHttpError(status, msg); };

const queues: QueueRef[] = [
  { id: "q-admin", name: "Administration" }, { id: "q-finance", name: "Finance" }, { id: "q-it", name: "IT" },
  { id: "q-support", name: "Customer service" }, { id: "q-management", name: "Management" },
];

const ranges: DialRange[] = [
  { id: "r-admin", name: "Administration", from: 100, to: 199, routing: "person", queue: null, ringTimeoutSec: 20, voicemailFallback: true },
  { id: "r-finance", name: "Finance", from: 200, to: 299, routing: "person", queue: null, ringTimeoutSec: 20, voicemailFallback: true },
  { id: "r-it", name: "IT", from: 300, to: 399, routing: "person", queue: null, ringTimeoutSec: 20, voicemailFallback: true },
  { id: "r-support", name: "Customer service", from: 400, to: 499, routing: "queue", queue: "q-support", ringTimeoutSec: 20, voicemailFallback: true },
  { id: "r-management", name: "Management", from: 500, to: 599, routing: "person", queue: null, ringTimeoutSec: 20, voicemailFallback: true },
];

const services: ServiceNumber[] = [
  ...queues.map((q, i): ServiceNumber => ({ id: `s-q${i}`, number: `01${i}`, label: `${q.name} call-center queue`, kind: "queue", queue: q.id })),
  { id: "s-vm", number: "020", label: "Voicemail main", kind: "voicemail-main", queue: null },
  { id: "s-vmd", number: "021", label: "Voicemail deposit", kind: "voicemail-deposit", queue: null },
];

const forwarding: ForwardRule[] = [
  { id: "f1", extension: "101", type: "no-answer", destination: "102", enabled: true },
  { id: "f2", extension: "205", type: "unconditional", destination: "0550123456", enabled: false },
];

let restrictions: Restrictions = { blocked: [{ fromRangeId: "r-support", toRangeId: "r-management" }] };
let transfer: TransferSettings = { blindEnabled: true, blindCode: "#1", attendedEnabled: true, attendedCode: "*2", timeoutSec: 15 };

type Item = { id: string };
const store: Record<string, Item[]> = { ranges, "service-numbers": services, forwarding };

function validate(kind: string, item: Record<string, unknown>, others: Item[]) {
  if (kind === "ranges") {
    const r = item as unknown as DialRange;
    if (r.from > r.to) bad(400, "Start must not be greater than end");
    const clash = (others as DialRange[]).find((o) => r.from <= o.to && r.to >= o.from);
    if (clash) bad(409, `Overlaps the ${clash.name} range (${clash.from}–${clash.to})`);
  } else if (kind === "service-numbers") {
    const s = item as unknown as ServiceNumber;
    if ((others as ServiceNumber[]).some((o) => o.number === s.number)) bad(409, `Number ${s.number} is already a service number`);
    const n = Number(s.number);
    const range = ranges.find((r) => n >= r.from && n <= r.to);
    if (range) bad(409, `${s.number} belongs to the ${range.name} range`);
  } else {
    const f = item as unknown as ForwardRule;
    if (f.destination === f.extension) bad(400, "An extension cannot forward to itself");
    if ((others as ForwardRule[]).some((o) => o.extension === f.extension && o.type === f.type)) bad(409, `Extension ${f.extension} already has a "${f.type}" rule`);
  }
}

export function mockDialplan<T>(method: string, path: string, body: unknown): T {
  const p = path.split("?")[0];
  let m: RegExpMatchArray | null;

  if (p === "/queues" && method === "GET") return queues as T;
  if (p === "/dialplan/restrictions") {
    if (method === "PUT") restrictions = body as Restrictions;
    return restrictions as T;
  }
  if (p === "/dialplan/transfer") {
    if (method === "PUT") transfer = body as TransferSettings;
    return transfer as T;
  }

  if ((m = p.match(/^\/dialplan\/(ranges|service-numbers|forwarding)(?:\/([\w-]+))?$/))) {
    const [, kind, id] = m;
    const items = store[kind];
    if (!id) {
      if (method === "GET") return items as T;
      if (method === "POST") {
        validate(kind, body as Record<string, unknown>, items);
        const created = { ...(body as object), id: `${kind[0]}${Date.now()}` };
        items.push(created);
        return created as T;
      }
    } else {
      const i = items.findIndex((x) => x.id === id);
      if (i < 0) bad(404, "Not found");
      if (method === "PUT") {
        validate(kind, body as Record<string, unknown>, items.filter((x) => x.id !== id));
        items[i] = { ...(body as object), id };
        return items[i] as T;
      }
      if (method === "DELETE") {
        if (kind === "ranges") {
          const r = items[i] as DialRange;
          restrictions = { blocked: restrictions.blocked.filter((b) => b.fromRangeId !== r.id && b.toRangeId !== r.id) };
        }
        items.splice(i, 1);
        return undefined as T;
      }
    }
  }
  return bad(404, `Mock endpoint not implemented: ${method} ${p}`);
}
