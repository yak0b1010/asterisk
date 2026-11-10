// Exercise the page's actual script with a small DOM/API harness, not a browser.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

class Element {
  constructor() {
    this.value = "";
    this.textContent = "";
    this.children = [];
    this.listeners = {};
    this.style = {};
  }
  set innerHTML(value) {
    assert.equal(value, "", "endpoint data must not be interpolated as HTML");
    this.children = [];
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); }
  addEventListener(event, callback) { this.listeners[event] = callback; }
  async fire(event) { await this.listeners[event]({ preventDefault() {} }); }
}

const elements = new Map();
const document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  },
  createElement() { return new Element(); },
};
const el = id => document.getElementById(id);
el("ext-form").reset = () => {
  for (const element of elements.values()) {
    element.value = "";
    element.checked = false;
  }
  el("ext-context").value = "internal";
};
const endpoint = {
  id: "0017", extension: "0017", callerid: '"<Office>" <0017>',
  context: "internal", mailboxes: "0017@default",
};
const calls = [];
const context = vm.createContext({
  document, confirm: () => true, encodeURIComponent,
  get: async path => {
    calls.push(["GET", path]);
    return { items: [endpoint], total: 51 };
  },
  post: async (path, payload) => calls.push(["POST", path, payload]),
  put: async (path, payload) => calls.push(["PUT", path, payload]),
  del: async path => {
    calls.push(["DELETE", path]);
    return {
      message: "extension deleted", retained_shared_objects: ["ps_auths"],
      remaining_references: { queue_members: 1 }, warning: "Review routing",
    };
  },
});
const html = fs.readFileSync(new URL("../extensions.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 1);
vm.runInContext(scripts[0][1].replace(/^\s*import .*?;\s*$/m, ""), context);
const settle = () => new Promise(resolve => setImmediate(resolve));
await settle();

const row = el("ext-table-body").children[0];
assert.equal(row.children[0].textContent, "0017");
assert.equal(row.children[1].textContent, endpoint.callerid);
assert.equal(row.children.length, 6, "no active/off column");
await row.children[5].children[0].fire("click");
assert.equal(el("ext-number").value, "0017");
assert.equal(el("ext-number").readOnly, true);
assert.equal(el("ext-secret").value, "");
await el("ext-form").fire("submit");
const update = calls.find(call => call[0] === "PUT");
assert.equal(update[1], "/extensions/0017");
assert.equal(update[2].mailboxes, "0017@default");
assert.equal(update[2].secret, "");
assert.ok(!("is_active" in update[2]));
assert.ok(!("email" in update[2]));
assert.equal(el("ext-number").readOnly, false);

el("ext-number").value = " 101 ";
el("ext-name").value = "Alice";
el("ext-secret").value = "test-password";
await el("ext-number").fire("input");
el("ext-voicemail").checked = true;
await el("ext-voicemail").fire("change");
assert.equal(el("ext-voicemail-fields").hidden, false);
assert.equal(el("ext-pin").value, "0101");
el("ext-pin").value = "00123";
await el("ext-pin").fire("input");
el("ext-number").value = "102";
await el("ext-number").fire("input");
assert.equal(el("ext-pin").value, "00123", "do not overwrite an edited PIN");
el("ext-email").value = "alice@example.test";
await el("ext-form").fire("submit");
const created = calls.find(call => call[0] === "POST")[2];
assert.equal(created.extension, "102");
assert.equal(created.display_name, "Alice");
assert.equal(created.voicemail.pin, "00123");
assert.equal(created.voicemail.email, "alice@example.test");
assert.ok(!("context" in created));
assert.ok(!("mailboxes" in created));
assert.equal(el("ext-pin").value, "");
assert.equal(el("ext-voicemail-fields").hidden, true);

el("ext-number").value = "103";
el("ext-name").value = "Bob";
el("ext-secret").value = "other-password";
await el("ext-form").fire("submit");
const withoutVoicemail = calls.filter(call => call[0] === "POST")[1][2];
assert.ok(!("voicemail" in withoutVoicemail));
await el("ext-next").fire("click");
await settle();
assert.ok(calls.some(call => call[1].includes("page=2")));
await el("ext-table-body").children[0].children[5].children[1].fire("click");
assert.ok(calls.some(call => call[0] === "DELETE" && call[1] === "/extensions/0017"));
assert.match(el("ext-alert").textContent, /ps_auths/);
assert.match(el("ext-alert").textContent, /queue_members/);
console.log("PASS: extension page creates with/without voicemail, preserves editable PIN defaults, edits/deletes and paginates");
