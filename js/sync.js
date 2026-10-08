/* sync.js - Cloud sync through Firebase (sign-in + Realtime Database).
   Needs firebase-config.js and sync-core.js loaded first. Runs on every page; the controls live in
   the planner's Settings dialog (#syncPanel).

   How it works: this browser's saved data stays the main copy. Every couple of seconds changed items
   are uploaded to users/<your id>/items/<name> as { v: text, t: time, d: device }. Changes from your
   other devices arrive instantly, are saved here, and the page refreshes itself when you are not busy. */

const CloudSync = (() => {
  "use strict";

  const FIREBASE_VERSION = "13.0.0";
  const KEYS = { meta: "plannerSyncMeta", linked: "plannerSyncLinked", device: "plannerSyncDevice" };
  const CHECK_EVERY_MS = 2000;

  const testModules = typeof window !== "undefined" ? window.__SYNC_TEST_MODULES : null;
  const rawConfig = typeof FIREBASE_CONFIG !== "undefined" ? FIREBASE_CONFIG : null;
  const config = rawConfig && rawConfig.apiKey && rawConfig.databaseURL ? rawConfig : null;

  let fb = null;
  let auth = null;
  let db = null;
  let user = null;
  let status = config ? "loading" : "unconfigured";
  let message = "";
  let choosingFrom = null;
  let lastSynced = {};
  let clockOffset = 0;
  let checkTimer = null;
  let unsubscribers = [];
  let refreshTimer = null;
  const listeners = [];

  const meta = readJson(KEYS.meta, {});
  const deviceId = (() => {
    let id = readText(KEYS.device);
    if (!id) {
      id = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      writeText(KEYS.device, id);
    }
    return id;
  })();

  /* ---------- small storage helpers ---------- */

  function readText(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function writeText(key, value) {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  }
  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
  }
  const saveMeta = () => writeText(KEYS.meta, JSON.stringify(meta));
  const now = () => Date.now() + clockOffset;

  function snapshot() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (SyncCore.isSyncedKey(key)) out[key] = localStorage.getItem(key);
    }
    return out;
  }

  /* ---------- status for the Settings panel ---------- */

  function state() {
    return {
      status,
      message,
      account: user ? user.email || user.displayName || "your account" : "",
    };
  }

  function setStatus(next, text = "") {
    status = next;
    message = text;
    listeners.forEach((fn) => fn(state()));
  }

  function friendly(error) {
    const code = (error && (error.code || error.message)) || "";
    if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(code)) return "That email or password is not right.";
    if (/email-already-in-use/.test(code)) return "That email already has an account. Use Sign in instead.";
    if (/weak-password/.test(code)) return "Use a password with at least 6 characters.";
    if (/invalid-email/.test(code)) return "That email address doesn't look right.";
    if (/missing-password/.test(code)) return "Type a password first.";
    if (/popup-closed|cancelled-popup/.test(code)) return "Sign-in was cancelled.";
    if (/unauthorized-domain/.test(code)) return "This web address isn't allowed in Firebase yet. Add it under Authentication > Settings > Authorized domains.";
    if (/operation-not-allowed/.test(code)) return "This sign-in method is switched off in Firebase. Turn it on under Authentication > Sign-in method.";
    if (/network/i.test(code)) return "No internet connection right now. Sync will catch up when you're back online.";
    if (/PERMISSION_DENIED|permission/i.test(code)) return "Firebase refused access. Check the database rules from the setup steps.";
    if (/quota|QuotaExceeded/i.test(code)) return "This device's storage is full, so a synced item couldn't be saved.";
    return `Sync problem: ${error && error.message ? error.message : code}`;
  }

  /* ---------- applying and sending items ---------- */

  function applyRemote(key, entry) {
    const value = entry && entry.v !== undefined ? entry.v : null;
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (err) {
      setStatus("error", friendly({ code: "quota" }));
      return false;
    }
    meta[key] = (entry && entry.t) || now();
    lastSynced[key] = value;
    return true;
  }

  async function pushKeys(keys, values, { keepTimes = false } = {}) {
    for (const key of keys) {
      const value = key in values ? values[key] : null;
      const time = keepTimes && meta[key] ? meta[key] : now();
      meta[key] = time;
      lastSynced[key] = value;
      await fb.set(fb.ref(db, `users/${user.uid}/items/${key}`), { v: value, t: time, d: deviceId });
    }
    saveMeta();
  }

  function checkLocal() {
    if (!user || status !== "on") return;
    const current = snapshot();
    const changed = SyncCore.changedKeys(current, lastSynced);
    if (!changed.length) return;
    pushKeys(changed, current).catch((err) => setStatus("error", friendly(err)));
  }

  /* ---------- refreshing the page after updates from another device ---------- */

  function busy() {
    if (typeof document === "undefined") return false;
    const active = document.activeElement;
    const typing = active && active.matches && active.matches("input, textarea, select, [contenteditable='true']");
    const dialogOpen = !!document.querySelector("dialog[open]");
    const timerRunning = document.body && document.body.classList.contains("running");
    return typing || dialogOpen || timerRunning;
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function attempt() {
      if (busy()) {
        refreshTimer = setTimeout(attempt, 1500);
        return;
      }
      if (typeof showToast === "function") showToast("Updated from your other device");
      setTimeout(() => location.reload(), 500);
    }, 700);
  }

  /* ---------- live syncing ---------- */

  function stopLive() {
    unsubscribers.forEach((off) => off());
    unsubscribers = [];
    clearInterval(checkTimer);
    checkTimer = null;
  }

  function startLive() {
    stopLive();
    lastSynced = snapshot();
    const items = fb.ref(db, `users/${user.uid}/items`);
    const onItem = (snap) => {
      const key = snap.key;
      if (!SyncCore.isSyncedKey(key)) return;
      const entry = snap.val();
      if (!SyncCore.shouldApply(entry, meta[key] || 0, deviceId)) return;
      const value = entry.v === undefined ? null : entry.v;
      if (value === readText(key)) {
        meta[key] = entry.t;
        lastSynced[key] = value;
        saveMeta();
        return;
      }
      if (applyRemote(key, entry)) {
        saveMeta();
        scheduleRefresh();
      }
    };
    unsubscribers.push(fb.onChildAdded(items, onItem), fb.onChildChanged(items, onItem));
    checkTimer = setInterval(checkLocal, CHECK_EVERY_MS);
  }

  /* ---------- connecting an account ---------- */

  async function connect() {
    setStatus("syncing");
    try {
      const snap = await fb.get(fb.ref(db, `users/${user.uid}/items`));
      const remote = snap.val() || {};
      const local = snapshot();

      if (readText(KEYS.linked) !== user.uid) {
        const plan = SyncCore.firstLinkPlan(local, remote);
        if (plan === "choose") {
          choosingFrom = remote;
          setStatus("choose");
          return;
        }
        if (plan === "download") {
          Object.keys(remote).filter(SyncCore.isSyncedKey).forEach((k) => applyRemote(k, remote[k]));
          saveMeta();
          scheduleRefresh();
        }
        if (plan === "upload") await pushKeys(Object.keys(local), local);
        writeText(KEYS.linked, user.uid);
      } else {
        const { push, pull } = SyncCore.mergePlan(local, remote, meta);
        pull.forEach((k) => applyRemote(k, remote[k]));
        saveMeta();
        await pushKeys(push, local, { keepTimes: true });
        if (pull.length) scheduleRefresh();
      }

      startLive();
      setStatus("on");
    } catch (err) {
      setStatus("error", friendly(err));
    }
  }

  /** First link with data on both sides: "cloud" replaces this device's data, "device" replaces the cloud's. */
  async function choose(which) {
    if (!choosingFrom || !user) return;
    const remote = choosingFrom;
    choosingFrom = null;
    setStatus("syncing");
    try {
      const local = snapshot();
      if (which === "cloud") {
        Object.keys(local).forEach((k) => {
          if (!remote[k] || remote[k].v === null || remote[k].v === undefined) localStorage.removeItem(k);
        });
        Object.keys(remote).filter(SyncCore.isSyncedKey).forEach((k) => applyRemote(k, remote[k]));
        saveMeta();
        scheduleRefresh();
      } else {
        const keys = [...new Set([...Object.keys(local), ...Object.keys(remote)])].filter(SyncCore.isSyncedKey);
        await pushKeys(keys, local);
      }
      writeText(KEYS.linked, user.uid);
      startLive();
      setStatus("on");
    } catch (err) {
      setStatus("error", friendly(err));
    }
  }

  function disconnect() {
    stopLive();
    choosingFrom = null;
    setStatus("signedout");
  }

  /* ---------- start-up ---------- */

  async function load() {
    if (!config && !testModules) {
      setStatus("unconfigured");
      return;
    }
    try {
      if (testModules) {
        fb = testModules;
      } else {
        const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
        const [appMod, authMod, dbMod] = await Promise.all([
          import(`${base}/firebase-app.js`),
          import(`${base}/firebase-auth.js`),
          import(`${base}/firebase-database.js`),
        ]);
        fb = { ...appMod, ...authMod, ...dbMod };
      }
      const app = fb.initializeApp(config || {});
      auth = fb.getAuth(app);
      db = fb.getDatabase(app);
      fb.onValue(fb.ref(db, ".info/serverTimeOffset"), (snap) => { clockOffset = snap.val() || 0; });
      if (fb.getRedirectResult) fb.getRedirectResult(auth).catch((err) => setStatus("error", friendly(err)));
      fb.onAuthStateChanged(auth, (signedIn) => {
        user = signedIn;
        if (user) connect(); else disconnect();
      });
    } catch (err) {
      setStatus("error", "Couldn't reach the sync service. Check your internet connection and reload.");
    }
  }

  /* ---------- sign-in actions ---------- */

  async function signInGoogle() {
    const provider = new fb.GoogleAuthProvider();
    try {
      await fb.signInWithPopup(auth, provider);
    } catch (err) {
      if (/popup-blocked|operation-not-supported/.test(err.code || "")) {
        await fb.signInWithRedirect(auth, provider);
        return;
      }
      throw new Error(friendly(err));
    }
  }

  async function withFriendlyErrors(task) {
    try {
      await task();
    } catch (err) {
      throw new Error(err.code ? friendly(err) : err.message);
    }
  }

  const api = {
    onChange(fn) {
      listeners.push(fn);
      fn(state());
    },
    signInGoogle: () => signInGoogle(),
    signInEmail: (email, password) => withFriendlyErrors(() => fb.signInWithEmailAndPassword(auth, email, password)),
    createAccount: (email, password) => withFriendlyErrors(() => fb.createUserWithEmailAndPassword(auth, email, password)),
    signOut: () => fb.signOut(auth),
    syncNow: () => { checkLocal(); if (user && status === "on") connect(); },
    choose,
    _checkNow: checkLocal,
  };

  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("pagehide", checkLocal);
    document.addEventListener("visibilitychange", checkLocal);
  }

  load();
  return api;
})();

/* ---------- Settings panel (planner page only) ---------- */
(() => {
  if (typeof document === "undefined") return;
  const panel = document.getElementById("syncPanel");
  if (!panel) return;
  const $ = (id) => document.getElementById(id);

  const TEXT = {
    unconfigured: "Cloud sync isn't set up yet. Follow the setup steps to connect your Firebase project.",
    loading: "Starting cloud sync...",
    signedout: "Sign in with the same account on your computer and phone to keep them in sync.",
    syncing: "Syncing...",
    choose: "",
    on: "",
    error: "",
  };

  function show(s) {
    $("syncSignedOut").hidden = s.status !== "signedout" && !(s.status === "error" && !s.account);
    $("syncSignedIn").hidden = !(s.status === "on" || s.status === "syncing" || (s.status === "error" && s.account));
    $("syncChoose").hidden = s.status !== "choose";
    let text = TEXT[s.status] || "";
    if (s.status === "on") text = `Synced as ${s.account}. Changes copy to your other devices automatically.`;
    if (s.status === "choose") text = `Signed in as ${s.account}.`;
    if (s.status === "error") text = s.message;
    $("syncStatus").textContent = text;
    $("syncStatus").classList.toggle("is-error", s.status === "error");
  }

  async function run(button, task) {
    button.disabled = true;
    try {
      await task();
    } catch (err) {
      $("syncStatus").textContent = err.message;
      $("syncStatus").classList.add("is-error");
    } finally {
      button.disabled = false;
    }
  }

  const credentials = () => [$("syncEmail").value.trim(), $("syncPassword").value];

  $("syncGoogle").addEventListener("click", (e) => run(e.currentTarget, () => CloudSync.signInGoogle()));
  $("syncEmailIn").addEventListener("click", (e) => run(e.currentTarget, () => CloudSync.signInEmail(...credentials())));
  $("syncEmailNew").addEventListener("click", (e) => run(e.currentTarget, () => CloudSync.createAccount(...credentials())));
  $("syncNowBtn").addEventListener("click", () => CloudSync.syncNow());
  $("syncOutBtn").addEventListener("click", (e) => run(e.currentTarget, () => CloudSync.signOut()));
  $("syncUseCloud").addEventListener("click", () => CloudSync.choose("cloud"));
  $("syncUseDevice").addEventListener("click", () => CloudSync.choose("device"));

  CloudSync.onChange(show);
})();
