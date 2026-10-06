/* planner-core.js - the planner's data rules, with no DOM access so it can be tested in Node.

   days:  { "YYYY-MM-DD": { notes: string, tasks: [{ text, done }] } }
   rules: [{ id, text, freq, start, end, skip: [keys], done: { key: true } }]
          freq is "daily" | "weekdays" | "weekly" | "monthly"
   item:  { kind: "day", index, text, done, repeat: null }
        | { kind: "rule", ruleId, text, done, repeat: freq }                         */

(function (root) {
  const FREQUENCIES = ["daily", "weekdays", "weekly", "monthly"];

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function dateKey(year, monthIndex, day) {
    return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
  }

  function parseKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return { y, m, d };
  }

  function weekdayOf(key) {
    const { y, m, d } = parseKey(key);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }

  function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  function addDays(key, n) {
    const { y, m, d } = parseKey(key);
    const date = new Date(Date.UTC(y, m - 1, d + n));
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }

  function isWeekendKey(key) {
    const dow = weekdayOf(key);
    return dow === 0 || dow === 6;
  }

  function occursOn(rule, key) {
    if (key < rule.start) return false;
    if (rule.end && key > rule.end) return false;
    if (rule.skip && rule.skip.includes(key)) return false;

    switch (rule.freq) {
      case "daily":
        return true;
      case "weekdays": {
        const dow = weekdayOf(key);
        return dow >= 1 && dow <= 5;
      }
      case "weekly":
        return weekdayOf(key) === weekdayOf(rule.start);
      case "monthly": {
        const { y, m, d } = parseKey(key);
        const wanted = Math.min(parseKey(rule.start).d, daysInMonth(y, m));
        return d === wanted;
      }
      default:
        return false;
    }
  }

  function itemsFor(days, rules, key) {
    const items = [];
    const entry = days[key];
    if (entry && entry.tasks) {
      entry.tasks.forEach((task, index) => {
        items.push({ kind: "day", index, text: task.text, done: !!task.done, repeat: null });
      });
    }
    rules.forEach((rule) => {
      if (occursOn(rule, key)) {
        items.push({
          kind: "rule",
          ruleId: rule.id,
          text: rule.text,
          done: !!(rule.done && rule.done[key]),
          repeat: rule.freq,
        });
      }
    });
    return items;
  }

  /** "done" when every item is finished, "busy" when any is open, null for an empty day. */
  function dayStatus(items) {
    if (items.length === 0) return null;
    return items.every((item) => item.done) ? "done" : "busy";
  }

  function ensureDay(days, key) {
    if (!days[key]) days[key] = { notes: "", tasks: [] };
    if (!days[key].tasks) days[key].tasks = [];
    return days[key];
  }

  function pruneDay(days, key) {
    const entry = days[key];
    if (entry && (!entry.tasks || entry.tasks.length === 0) && !entry.notes) delete days[key];
  }

  function newRuleId() {
    return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function addTask(days, rules, key, text, repeat) {
    const clean = (text || "").trim();
    if (!clean) return false;
    if (repeat && FREQUENCIES.includes(repeat)) {
      rules.push({ id: newRuleId(), text: clean, freq: repeat, start: key, end: null, skip: [], done: {} });
    } else {
      ensureDay(days, key).tasks.push({ text: clean, done: false });
    }
    return true;
  }

  function setDone(days, rules, key, item, done) {
    if (item.kind === "day") {
      const task = days[key] && days[key].tasks[item.index];
      if (task) task.done = !!done;
      return;
    }
    const rule = rules.find((r) => r.id === item.ruleId);
    if (!rule) return;
    rule.done = rule.done || {};
    if (done) rule.done[key] = true; else delete rule.done[key];
  }

  /** Removes a one-off task, or skips just this day of a repeating one. */
  function removeItem(days, rules, key, item) {
    if (item.kind === "day") {
      if (days[key]) days[key].tasks.splice(item.index, 1);
      pruneDay(days, key);
      return;
    }
    const rule = rules.find((r) => r.id === item.ruleId);
    if (!rule) return;
    rule.skip = rule.skip || [];
    if (!rule.skip.includes(key)) rule.skip.push(key);
    if (rule.done) delete rule.done[key];
  }

  /** Ends a repeating task after the given day (that day keeps its occurrence). */
  function stopRepeating(rules, key, ruleId) {
    const rule = rules.find((r) => r.id === ruleId);
    if (rule) rule.end = key;
  }

  function snippet(text, query, radius = 28) {
    const at = text.toLowerCase().indexOf(query);
    if (at < 0 || text.length <= radius * 2) return text;
    const start = Math.max(0, at - radius);
    const end = Math.min(text.length, at + query.length + radius);
    return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
  }

  /** Finds notes and tasks containing the query. Newest dates first. */
  function search(days, rules, query, limit = 30) {
    const q = (query || "").trim().toLowerCase();
    if (!q) return [];
    const hits = [];

    Object.keys(days).forEach((key) => {
      const entry = days[key];
      if (entry.notes && entry.notes.toLowerCase().includes(q)) {
        hits.push({ key, kind: "note", text: snippet(entry.notes.replace(/\s+/g, " "), q) });
      }
      (entry.tasks || []).forEach((task) => {
        if (task.text.toLowerCase().includes(q)) {
          hits.push({ key, kind: "task", text: task.text, done: !!task.done });
        }
      });
    });

    rules.forEach((rule) => {
      if (rule.text.toLowerCase().includes(q)) {
        hits.push({ key: rule.start, kind: "repeat", text: rule.text, repeat: rule.freq });
      }
    });

    hits.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
    return hits.slice(0, limit);
  }

  /** Unfinished one-off tasks from past days, plus every task from today onward. */
  function agenda(days, rules, todayKey, options = {}) {
    const pastDays = options.pastDays ?? 60;
    const aheadDays = options.aheadDays ?? 14;
    const overdue = [];
    const upcoming = [];

    for (let n = pastDays; n >= 1; n--) {
      const key = addDays(todayKey, -n);
      const open = itemsFor(days, rules, key).filter((item) => item.kind === "day" && !item.done);
      if (open.length) overdue.push({ key, items: open });
    }
    for (let n = 0; n <= aheadDays; n++) {
      const key = addDays(todayKey, n);
      const items = itemsFor(days, rules, key);
      if (items.length) upcoming.push({ key, items });
    }
    return { overdue, upcoming };
  }

  const api = {
    FREQUENCIES, dateKey, parseKey, weekdayOf, addDays, isWeekendKey,
    occursOn, itemsFor, dayStatus, addTask, setDone, removeItem, stopRepeating,
    pruneDay, ensureDay, search, agenda,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PlannerCore = api;
})(typeof window !== "undefined" ? window : globalThis);
