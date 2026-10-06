// Run with: node tests/planner-core.test.js
const assert = require("node:assert/strict");
const core = require("../js/planner-core.js");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}\n     ${err.message}`);
    process.exitCode = 1;
  }
}

const rule = (freq, start, extra = {}) => ({ id: "r1", text: "x", freq, start, end: null, skip: [], done: {}, ...extra });

test("addDays crosses month and year boundaries", () => {
  assert.equal(core.addDays("2026-01-31", 1), "2026-02-01");
  assert.equal(core.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(core.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(core.addDays("2028-03-01", -1), "2028-02-29");
});

test("weekday of a known date (2026-10-02 is a Friday)", () => {
  assert.equal(core.weekdayOf("2026-10-02"), 5);
  assert.equal(core.isWeekendKey("2026-10-03"), true);
  assert.equal(core.isWeekendKey("2026-10-02"), false);
});

test("daily rules start on their start date and not before", () => {
  const r = rule("daily", "2026-10-05");
  assert.equal(core.occursOn(r, "2026-10-04"), false);
  assert.equal(core.occursOn(r, "2026-10-05"), true);
  assert.equal(core.occursOn(r, "2027-01-01"), true);
});

test("weekdays rules skip Saturday and Sunday", () => {
  const r = rule("weekdays", "2026-10-02");
  assert.equal(core.occursOn(r, "2026-10-03"), false);
  assert.equal(core.occursOn(r, "2026-10-04"), false);
  assert.equal(core.occursOn(r, "2026-10-05"), true);
});

test("weekly rules repeat on the same weekday", () => {
  const r = rule("weekly", "2026-10-02");
  assert.equal(core.occursOn(r, "2026-10-09"), true);
  assert.equal(core.occursOn(r, "2026-10-10"), false);
  assert.equal(core.occursOn(r, "2026-09-25"), false);
});

test("monthly rules use the same day, clamped for short months", () => {
  const r = rule("monthly", "2026-01-31");
  assert.equal(core.occursOn(r, "2026-02-28"), true);
  assert.equal(core.occursOn(r, "2026-02-27"), false);
  assert.equal(core.occursOn(r, "2026-04-30"), true);
  assert.equal(core.occursOn(r, "2026-03-31"), true);
  assert.equal(core.occursOn(r, "2026-03-30"), false);
});

test("end date and skipped days are respected", () => {
  const r = rule("daily", "2026-10-01", { end: "2026-10-05", skip: ["2026-10-03"] });
  assert.equal(core.occursOn(r, "2026-10-03"), false);
  assert.equal(core.occursOn(r, "2026-10-05"), true);
  assert.equal(core.occursOn(r, "2026-10-06"), false);
});

test("addTask rejects empty text and unknown frequencies become one-off tasks", () => {
  const days = {}, rules = [];
  assert.equal(core.addTask(days, rules, "2026-10-02", "   ", null), false);
  assert.equal(core.addTask(days, rules, "2026-10-02", "one-off", "sometimes"), true);
  assert.equal(rules.length, 0);
  assert.equal(days["2026-10-02"].tasks.length, 1);
});

test("itemsFor combines one-off and repeating tasks, with per-day done state", () => {
  const days = {}, rules = [];
  core.addTask(days, rules, "2026-10-02", "write", null);
  core.addTask(days, rules, "2026-10-02", "stretch", "daily");
  let items = core.itemsFor(days, rules, "2026-10-03");
  assert.equal(items.length, 1);
  assert.equal(items[0].repeat, "daily");

  items = core.itemsFor(days, rules, "2026-10-02");
  assert.equal(items.length, 2);
  core.setDone(days, rules, "2026-10-02", items[1], true);
  assert.equal(core.itemsFor(days, rules, "2026-10-02")[1].done, true);
  assert.equal(core.itemsFor(days, rules, "2026-10-03")[0].done, false);
});

test("dayStatus: empty, open and finished days", () => {
  assert.equal(core.dayStatus([]), null);
  assert.equal(core.dayStatus([{ done: true }, { done: false }]), "busy");
  assert.equal(core.dayStatus([{ done: true }, { done: true }]), "done");
});

test("removing a one-off task prunes an otherwise empty day", () => {
  const days = {}, rules = [];
  core.addTask(days, rules, "2026-10-02", "a", null);
  core.removeItem(days, rules, "2026-10-02", core.itemsFor(days, rules, "2026-10-02")[0]);
  assert.equal("2026-10-02" in days, false);
});

test("a day with notes survives removing its last task", () => {
  const days = { "2026-10-02": { notes: "keep me", tasks: [{ text: "a", done: false }] } };
  core.removeItem(days, [], "2026-10-02", { kind: "day", index: 0 });
  assert.equal(days["2026-10-02"].notes, "keep me");
});

test("removing a repeating task only skips that day", () => {
  const days = {}, rules = [];
  core.addTask(days, rules, "2026-10-02", "daily thing", "daily");
  const item = core.itemsFor(days, rules, "2026-10-02")[0];
  core.removeItem(days, rules, "2026-10-02", item);
  assert.equal(core.itemsFor(days, rules, "2026-10-02").length, 0);
  assert.equal(core.itemsFor(days, rules, "2026-10-03").length, 1);
});

test("stopRepeating keeps the current day and ends the series after it", () => {
  const days = {}, rules = [];
  core.addTask(days, rules, "2026-10-02", "daily thing", "daily");
  core.stopRepeating(rules, "2026-10-05", rules[0].id);
  assert.equal(core.itemsFor(days, rules, "2026-10-05").length, 1);
  assert.equal(core.itemsFor(days, rules, "2026-10-06").length, 0);
});

test("search finds notes, tasks and repeating tasks, newest first", () => {
  const days = {
    "2026-10-01": { notes: "Buy MILK today", tasks: [{ text: "milk run", done: true }] },
    "2026-10-09": { notes: "", tasks: [{ text: "email boss", done: false }] },
  };
  const rules = [rule("weekly", "2026-09-01", { text: "Drink milk tea" })];
  const hits = core.search(days, rules, "milk");
  assert.deepEqual(hits.map((h) => h.kind), ["note", "task", "repeat"]);
  assert.equal(hits.length, 3);
  assert.equal(hits[0].key, "2026-10-01");
  assert.equal(hits[hits.length - 1].kind, "repeat");
  assert.deepEqual(core.search(days, rules, "   "), []);
  assert.deepEqual(core.search(days, rules, "zzz"), []);
});

test("agenda lists open one-off tasks as overdue, never missed repeats", () => {
  const days = {
    "2026-09-30": { notes: "", tasks: [{ text: "late", done: false }, { text: "finished", done: true }] },
  };
  const rules = [rule("daily", "2026-09-01", { text: "daily thing" })];
  const result = core.agenda(days, rules, "2026-10-02", { pastDays: 10, aheadDays: 2 });
  assert.equal(result.overdue.length, 1);
  assert.equal(result.overdue[0].key, "2026-09-30");
  assert.equal(result.overdue[0].items.length, 1);
  assert.equal(result.upcoming.length, 3);
  assert.equal(result.upcoming[0].key, "2026-10-02");
});

console.log(`\n${passed} passed`);
