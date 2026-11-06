import type { BulkExtensionsInput, DepartmentId, DirectoryUser, Extension, ExtensionInput, UserInput } from "../types";
import { departmentOf } from "../utils/sip";
import { mockDialplan } from "./mock-dialplan";
import { MockHttpError } from "./mock-errors";

const first = ["Amine", "Sara", "Yacine", "Lina", "Karim", "Nadia", "Omar", "Meriem", "Walid", "Imane", "Sofiane", "Hadjer"];
const last = ["Benali", "Haddad", "Messaoud", "Boukhalfa", "Cherif", "Djebbar", "Ferhat", "Gacem", "Hamidi", "Slimani"];
const depts: DepartmentId[] = ["administration", "finance", "it", "support", "management"];

const users: DirectoryUser[] = Array.from({ length: 60 }, (_, i) => {
  const f = first[i % first.length], l = last[(i * 7) % last.length];
  return {
    id: `u${i + 1}`,
    fullName: `${f} ${l}`,
    email: `${f}.${l}${i}@appliance.local`.toLowerCase(),
    department: depts[i % depts.length],
    createdAt: new Date(Date.now() - i * 86_400_000).toISOString(),
  };
});

// 500 extensions (100–599). Every 3rd one has no user yet; ~12% are offline, a few disabled.
const extensions: Extension[] = Array.from({ length: 500 }, (_, i) => {
  const number = String(100 + i);
  const dept = departmentOf(number)!;
  const pool = users.filter((u) => u.department === dept);
  const enabled = i % 37 !== 0;
  const registered = enabled && i % 8 !== 0;
  return {
    number,
    userId: i % 3 === 0 ? null : pool[i % pool.length].id,
    enabled,
    registered,
    contactIp: registered ? `192.168.1.${10 + (i % 200)}` : null,
  };
});

const bad = (status: number, msg: string): never => { throw new MockHttpError(status, msg); };

export function mockCrud<T>(method: string, path: string, body: unknown): T {
  const p = path.split("?")[0];
  let m: RegExpMatchArray | null;

  /* users */
  if (p === "/users" && method === "GET") return users as T;
  if (p === "/users" && method === "POST") {
    const input = body as UserInput;
    if (users.some((u) => u.email === input.email)) bad(409, "A user with this email already exists");
    const u: DirectoryUser = { ...input, id: `u${Date.now()}`, createdAt: new Date().toISOString() };
    users.unshift(u);
    return u as T;
  }
  if ((m = p.match(/^\/users\/([\w-]+)$/))) {
    const i = users.findIndex((u) => u.id === m![1]);
    if (i < 0) bad(404, "User not found");
    if (method === "PUT") {
      const input = body as UserInput;
      if (users.some((u) => u.email === input.email && u.id !== users[i].id)) bad(409, "A user with this email already exists");
      users[i] = { ...users[i], ...input };
      return users[i] as T;
    }
    if (method === "DELETE") {
      extensions.forEach((e) => { if (e.userId === users[i].id) e.userId = null; }); // unassign
      users.splice(i, 1);
      return undefined as T;
    }
  }

  /* extensions */
  if (p === "/extensions" && method === "GET") return extensions as T;
  if (p === "/extensions" && method === "POST") {
    const input = body as ExtensionInput;
    if (extensions.some((e) => e.number === input.number)) bad(409, `Extension ${input.number} already exists`);
    const e: Extension = { number: input.number, userId: input.userId, enabled: input.enabled, registered: false, contactIp: null };
    extensions.push(e);
    extensions.sort((a, b) => a.number.localeCompare(b.number));
    return e as T;
  }
  if (p === "/extensions/bulk" && method === "POST") {
    const input = body as BulkExtensionsInput;
    const created: string[] = [], skipped: string[] = [];
    for (const { number } of input.extensions) {
      if (extensions.some((e) => e.number === number)) { skipped.push(number); continue; }
      extensions.push({ number, userId: null, enabled: input.enabled, registered: false, contactIp: null });
      created.push(number);
    }
    extensions.sort((a, b) => a.number.localeCompare(b.number));
    return { created, skipped } as T;
  }
  if ((m = p.match(/^\/extensions\/(\d{3})$/))) {
    const i = extensions.findIndex((e) => e.number === m![1]);
    if (i < 0) bad(404, "Extension not found");
    if (method === "PUT" || method === "PATCH") {
      const { secret: _secret, number: _n, ...rest } = body as Partial<ExtensionInput>; // secret would be applied by the backend
      extensions[i] = { ...extensions[i], ...rest };
      if (!extensions[i].enabled) { extensions[i].registered = false; extensions[i].contactIp = null; }
      return extensions[i] as T;
    }
    if (method === "DELETE") { extensions.splice(i, 1); return undefined as T; }
  }

  return mockDialplan<T>(method, path, body);
}
