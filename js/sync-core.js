/* sync-core.js - the decisions Cloud sync makes, with no browser or Firebase code, so they can be tested.

   local:  { key: "stored text" }                     what this device has
   remote: { key: { v: "stored text" | null, t, d } } what the cloud has (v null = deleted, t = time, d = device)
   meta:   { key: time }                              when this device last changed or received each key */

(function (root) {
  const SYNCED = /^planner[A-Za-z]*$/;
  const LOCAL_ONLY = /^plannerSync/;

  const isSyncedKey = (key) => SYNCED.test(key) && !LOCAL_ONLY.test(key);
  const remoteValue = (remote, key) => (remote[key] && remote[key].v !== undefined ? remote[key].v : null);
  const localValue = (local, key) => (key in local ? local[key] : null);
  const allKeys = (...maps) => [...new Set(maps.flatMap((m) => Object.keys(m)))].filter(isSyncedKey);

  /** First time a device joins an account: what to do with the two sets of data. */
  function firstLinkPlan(local, remote) {
    const remoteHas = Object.keys(remote).some((k) => isSyncedKey(k) && remoteValue(remote, k) !== null);
    const localHas = Object.keys(local).some(isSyncedKey);
    if (!remoteHas && !localHas) return "nothing";
    if (!remoteHas) return "upload";
    if (!localHas) return "download";
    const differs = allKeys(local, remote).some((k) => localValue(local, k) !== remoteValue(remote, k));
    return differs ? "choose" : "nothing";
  }

  /** A device that has synced before reconnects: newest copy of each item wins. */
  function mergePlan(local, remote, meta) {
    const push = [];
    const pull = [];
    allKeys(local, remote).forEach((key) => {
      if (localValue(local, key) === remoteValue(remote, key)) return;
      const remoteTime = (remote[key] && remote[key].t) || 0;
      const localTime = meta[key] || 0;
      if (remoteTime > localTime) pull.push(key); else push.push(key);
    });
    return { push, pull };
  }

  /** Items this device changed since they were last synced. */
  function changedKeys(current, lastSynced) {
    return allKeys(current, lastSynced).filter((k) => localValue(current, k) !== localValue(lastSynced, k));
  }

  /** Should an update arriving from the cloud replace what this device has? */
  function shouldApply(entry, localTime, deviceId) {
    if (!entry || typeof entry.t !== "number") return false;
    if (entry.d === deviceId && entry.t <= localTime) return false;
    return entry.t > localTime;
  }

  const api = { isSyncedKey, firstLinkPlan, mergePlan, changedKeys, shouldApply };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SyncCore = api;
})(typeof window !== "undefined" ? window : globalThis);
