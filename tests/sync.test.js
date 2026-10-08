// Run with: node tests/sync.test.js
// Part 1 checks the sync decision rules. Part 2 runs the real sync.js on two pretend devices
// (a "computer" and a "phone") that share one pretend Firebase database.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("../js/sync-core.js");

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}\n     ${err.stack || err.message}`);
    process.exitCode = 1;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await sleep(25);
  }
  throw new Error("timed out waiting");
}

/* ---------------- pretend Firebase ---------------- */

const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function makeCloud() {
  return { tree: {}, subs: [] };
}

function fakeFirebase(cloud, uid) {
  const user = { uid, email: `${uid}@example.com` };
  const at = (p) => p.split("/").reduce((o, k) => (o ? o[k] : undefined), cloud.tree);
  const unsubscribe = (sub) => () => cloud.subs.splice(cloud.subs.indexOf(sub), 1);

  return {
    initializeApp: () => ({}),
    getAuth: () => ({}),
    getDatabase: () => ({}),
    ref: (db, p) => ({ path: p }),
    onValue: (r, cb) => { cb({ val: () => 0 }); return () => {}; },
    onAuthStateChanged: (a, cb) => { setTimeout(() => cb(user), 0); },
    get: async (r) => ({ val: () => { const v = copy(at(r.path)); return v === undefined ? null : v; } }),
    set: async (r, value) => {
      const parts = r.path.split("/");
      let node = cloud.tree;
      parts.slice(0, -1).forEach((k) => { node[k] = node[k] || {}; node = node[k]; });
      const key = parts[parts.length - 1];
      const existed = key in node;
      node[key] = copy(value);
      const parent = parts.slice(0, -1).join("/");
      cloud.subs
        .filter((s) => s.path === parent && (s.type === "changed") === existed)
        .forEach((s) => setTimeout(() => s.cb({ key, val: () => copy(node[key]) }), 0));
    },
    onChildAdded: (r, cb) => {
      const current = at(r.path) || {};
      Object.keys(current).forEach((k) => setTimeout(() => cb({ key: k, val: () => copy(current[k]) }), 0));
      const sub = { path: r.path, type: "added", cb };
      cloud.subs.push(sub);
      return unsubscribe(sub);
    },
    onChildChanged: (r, cb) => {
      const sub = { path: r.path, type: "changed", cb };
      cloud.subs.push(sub);
      return unsubscribe(sub);
    },
  };
}

/* ---------------- pretend browser device ---------------- */

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    dump: () => Object.fromEntries(map),
  };
}

const coreSource = fs.readFileSync(path.join(__dirname, "..", "js", "sync-core.js"), "utf8");
const syncSource = fs.readFileSync(path.join(__dirname, "..", "js", "sync.js"), "utf8");
const devices = [];

function makeDevice(cloud, uid, initial = {}) {
  const storage = fakeStorage(initial);
  const device = { storage, reloads: 0 };
  const context = {
    localStorage: storage,
    location: { reload: () => { device.reloads++; } },
    document: {
      addEventListener() {},
      getElementById: () => null,
      querySelector: () => null,
      activeElement: null,
      body: { classList: { contains: () => false } },
    },
    setTimeout, clearTimeout, setInterval, clearInterval, console, Date, Math, JSON, Promise,
    FIREBASE_CONFIG: {},
  };
  context.window = context;
  context.addEventListener = () => {};
  context.__SYNC_TEST_MODULES = fakeFirebase(cloud, uid);
  vm.createContext(context);
  vm.runInContext(coreSource, context);
  vm.runInContext(syncSource, context);
  device.sync = vm.runInContext("CloudSync", context);
  device.status = () => {
    let s;
    device.sync.onChange((st) => { s = st; });
    return s.status;
  };
  device.data = () => Object.fromEntries(Object.entries(storage.dump()).filter(([k]) => core.isSyncedKey(k)));
  devices.push(device);
  return device;
}

(async () => {
  /* ---------------- Part 1: rules ---------------- */

  await test("only planner items sync, never sync bookkeeping or other sites' data", () => {
    assert.equal(core.isSyncedKey("plannerData"), true);
    assert.equal(core.isSyncedKey("plannerSyncMeta"), false);
    assert.equal(core.isSyncedKey("someOtherSite"), false);
  });

  await test("first link: upload, download, nothing, or ask", () => {
    const r = (v) => ({ v, t: 5, d: "x" });
    assert.equal(core.firstLinkPlan({}, {}), "nothing");
    assert.equal(core.firstLinkPlan({ plannerData: "a" }, {}), "upload");
    assert.equal(core.firstLinkPlan({}, { plannerData: r("a") }), "download");
    assert.equal(core.firstLinkPlan({ plannerData: "a" }, { plannerData: r("a") }), "nothing");
    assert.equal(core.firstLinkPlan({ plannerData: "a" }, { plannerData: r("b") }), "choose");
  });

  await test("reconnect: newest copy of each item wins", () => {
    const remote = { plannerData: { v: "cloud", t: 200 }, plannerRepeats: { v: "old", t: 50 } };
    const local = { plannerData: "device", plannerRepeats: "new", plannerAccent: "#fff" };
    const plan = core.mergePlan(local, remote, { plannerData: 100, plannerRepeats: 300 });
    assert.deepEqual(plan.pull, ["plannerData"]);
    assert.deepEqual(plan.push.sort(), ["plannerAccent", "plannerRepeats"]);
  });

  await test("cloud updates apply only when newer, and never echo back to their own device", () => {
    assert.equal(core.shouldApply({ v: "a", t: 10, d: "other" }, 5, "me"), true);
    assert.equal(core.shouldApply({ v: "a", t: 10, d: "other" }, 10, "me"), false);
    assert.equal(core.shouldApply({ v: "a", t: 10, d: "me" }, 10, "me"), false);
    assert.equal(core.shouldApply(null, 0, "me"), false);
  });

  /* ---------------- Part 2: two devices ---------------- */

  await test("computer with data joins an empty cloud and uploads everything (but not sync bookkeeping)", async () => {
    const cloud = makeCloud();
    const computer = makeDevice(cloud, "u1", { plannerData: '{"2026-10-08":{"notes":"hi"}}', plannerAccent: "#e8638f", other: "x" });
    await until(() => computer.status() === "on");
    const items = cloud.tree.users.u1.items;
    assert.deepEqual(Object.keys(items).sort(), ["plannerAccent", "plannerData"]);
    assert.equal(items.plannerData.v, '{"2026-10-08":{"notes":"hi"}}');
  });

  await test("an empty phone joins and receives everything, then refreshes", async () => {
    const cloud = makeCloud();
    const computer = makeDevice(cloud, "u2", { plannerData: "DATA", plannerProjects: "PROJECTS" });
    await until(() => computer.status() === "on");
    const phone = makeDevice(cloud, "u2", {});
    await until(() => phone.status() === "on");
    assert.deepEqual(phone.data(), { plannerData: "DATA", plannerProjects: "PROJECTS" });
    await until(() => phone.reloads > 0);
  });

  await test("a change on one device reaches the other live, including deletions", async () => {
    const cloud = makeCloud();
    const computer = makeDevice(cloud, "u3", { plannerData: "v1", plannerAccent: "#fff" });
    await until(() => computer.status() === "on");
    const phone = makeDevice(cloud, "u3", {});
    await until(() => phone.status() === "on" && phone.data().plannerData === "v1");

    computer.storage.setItem("plannerData", "v2");
    computer.storage.removeItem("plannerAccent");
    computer.sync._checkNow();
    await until(() => phone.data().plannerData === "v2" && !("plannerAccent" in phone.data()));

    phone.storage.setItem("plannerRepeats", "from phone");
    phone.sync._checkNow();
    await until(() => computer.data().plannerRepeats === "from phone");
    assert.equal(computer.data().plannerData, "v2");
  });

  await test("both sides already have different data: it asks, then 'use the cloud copy' replaces this device", async () => {
    const cloud = makeCloud();
    const computer = makeDevice(cloud, "u4", { plannerData: "COMPUTER", plannerProjects: "P" });
    await until(() => computer.status() === "on");
    const phone = makeDevice(cloud, "u4", { plannerData: "PHONE", plannerNotesBackground: "phone-only" });
    await until(() => phone.status() === "choose");
    assert.equal(phone.data().plannerData, "PHONE", "nothing changes until you choose");

    await phone.sync.choose("cloud");
    await until(() => phone.status() === "on");
    assert.deepEqual(phone.data(), { plannerData: "COMPUTER", plannerProjects: "P" });
    assert.equal(cloud.tree.users.u4.items.plannerData.v, "COMPUTER");
  });

  await test("'use this device's data' replaces the cloud, and the other device follows", async () => {
    const cloud = makeCloud();
    const computer = makeDevice(cloud, "u5", { plannerData: "COMPUTER", plannerProjects: "P" });
    await until(() => computer.status() === "on");
    const phone = makeDevice(cloud, "u5", { plannerData: "PHONE" });
    await until(() => phone.status() === "choose");

    await phone.sync.choose("device");
    await until(() => phone.status() === "on");
    assert.equal(cloud.tree.users.u5.items.plannerData.v, "PHONE");
    assert.equal(cloud.tree.users.u5.items.plannerProjects.v, null);
    await until(() => computer.data().plannerData === "PHONE" && !("plannerProjects" in computer.data()));
  });

  await test("a device that was offline keeps its newer edits and takes newer cloud edits", async () => {
    const cloud = makeCloud();
    const computer = makeDevice(cloud, "u6", { plannerData: "start", plannerRepeats: "start" });
    await until(() => computer.status() === "on");
    const linked = makeDevice(cloud, "u6", {});
    await until(() => linked.status() === "on");

    // the phone goes offline and edits plannerData; meanwhile the computer edits plannerRepeats
    const phoneStorage = linked.storage.dump();
    const meta = JSON.parse(phoneStorage.plannerSyncMeta);
    phoneStorage.plannerData = "edited offline";
    meta.plannerData = Date.now() + 5000;
    phoneStorage.plannerSyncMeta = JSON.stringify(meta);
    computer.storage.setItem("plannerRepeats", "edited on computer");
    computer.sync._checkNow();
    await until(() => cloud.tree.users.u6.items.plannerRepeats.v === "edited on computer");

    // the phone comes back online (a fresh page load with its saved storage)
    const phoneAgain = makeDevice(cloud, "u6", phoneStorage);
    await until(() => phoneAgain.status() === "on");
    await until(() => phoneAgain.data().plannerRepeats === "edited on computer");
    assert.equal(cloud.tree.users.u6.items.plannerData.v, "edited offline");
    await until(() => computer.data().plannerData === "edited offline");
  });

  console.log(`\n${passed} passed`);
  process.exit(process.exitCode || 0);
})();
