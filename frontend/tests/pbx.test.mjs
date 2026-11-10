// Actual page scripts with DOM/API doubles; not a browser or media test.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

class Element {
  value = "";
  textContent = "";
  checked = false;
  style = {};
  children = [];
  listeners = {};
  set innerHTML(value) {
    assert.equal(value, "", "database values must not be rendered as HTML");
    this.children = [];
  }
  appendChild(child) { this.children.push(child); }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  async fire(name) { await this.listeners[name]({preventDefault() {}}); }
  reset() {}
}

const models = {
  users: {id: 8, username: "'<Admin>", email: "admin@example.invalid", role: "admin"},
  dialplan: {id: 1, pattern: "_7XXX", context: "internal", priority: 1,
             application: "Dial", destination: "${PJSIP_DIAL_CONTACTS(7002)},20"},
  voicemail: {id: 2, mailbox: "010", context: "departments", full_name: "<Shared>",
              email: "", attach: "no"},
  queues: {id: "q-'support", name: "q-'support", strategy: "rrmemory",
           timeout: 20, wrapup_time: 2, max_len: 0, member_count: 1},
};
const prefixes = {users: "user", dialplan: "dp", voicemail: "vm", queues: "q"};
const methods = {users: "editUser", dialplan: "editDp", voicemail: "editVm", queues: "editQ"};
const settle = () => new Promise(resolve => setImmediate(resolve));

for (const [page, model] of Object.entries(models)) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement() { return new Element(); },
  };
  const el = id => document.getElementById(id);
  const calls = [];
  const context = vm.createContext({
    document, confirm: () => true, alert: message => { throw new Error(message); },
    get: async path => {
      calls.push(["GET", path]);
      return path.endsWith("/members") ? [{id: 4, interface: "PJSIP/010", penalty: 0, paused: 0}] : [model];
    },
    post: async (path, payload) => calls.push(["POST", path, payload]),
    put: async (path, payload) => calls.push(["PUT", path, payload]),
    del: async path => calls.push(["DELETE", path]),
  });
  context.window = context;
  const api = fs.readFileSync(new URL("../js/api.js", import.meta.url), "utf8");
  const helper = api.slice(api.indexOf("export function tableRow"), api.indexOf("/* ── Auth helpers"));
  vm.runInContext(helper.replace("export ", ""), context);
  const html = fs.readFileSync(new URL(`../${page}.html`, import.meta.url), "utf8");
  const script = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)][0][1];
  vm.runInContext(script.replace(/^\s*import .*?;\s*$/m, ""), context);
  await settle();
  const prefix = prefixes[page];
  assert.equal(el(`${prefix}-table-body`).children.length, 1);
  await context.app[methods[page]](model.id);
  if (page === "voicemail") {
    assert.equal(el("vm-context").value, "departments");
    assert.equal(el("vm-attach").checked, false);
    assert.equal(el("vm-password").value, "");
  }
  await el(`${prefix}-form`).fire("submit");
  const update = calls.find(call => call[0] === "PUT");
  assert.equal(update[1], `/${page}/${model.id}`);
  assert.ok(!("is_active" in update[2]));
  if (page === "dialplan") assert.equal(update[2].destination, model.destination);
  if (page === "voicemail") assert.equal(update[2].context, "departments");
  if (page === "queues") {
    assert.ok(!("number" in update[2]));
    await context.app.openMembers(model.id, model.name);
    assert.equal(el("qm-table-body").children[0].children[2].textContent, "no");
    await context.app.removeMember(model.id, 4);
    assert.ok(calls.some(call => call[0] === "DELETE" && call[1] === `/queues/${model.id}/members/4`));
  }
  console.log(`PASS: ${page} rendering/edit payload matches native schema`);
}
