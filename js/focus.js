/* focus.js - the Focus Mode page (focus.html).
   Needs shared.js and planner-core.js loaded first. */

(() => {
  "use strict";

  const KEYS = {
    settings: "plannerFocusSettings",
    sessions: "plannerFocusSessions",
    days: "plannerData",
    rules: "plannerRepeats",
    ownBackground: "plannerFocusBackground",
    plannerBackground: "plannerBackground",
  };

  const $ = (id) => document.getElementById(id);
  const focusInput = $("focusMinutes");
  const restInput = $("restMinutes");

  const LIMITS = { focus: 240, rest: 60 };

  let phase = "focus";
  let running = false;
  let remainingMs = 0;
  let totalMs = 0;
  let endTime = 0;
  let ticker = null;

  function todayKey() {
    const d = new Date();
    return PlannerCore.dateKey(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function clampMinutes(value, min, max) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  /* ---------- Settings ---------- */

  function readSettings() {
    return {
      focus: clampMinutes(focusInput.value, 1, LIMITS.focus),
      rest: clampMinutes(restInput.value, 1, LIMITS.rest),
    };
  }

  function loadSettings() {
    const saved = Store.read(KEYS.settings, null);
    if (!saved) return;
    focusInput.value = clampMinutes(saved.focus, 1, LIMITS.focus);
    restInput.value = clampMinutes(saved.rest, 1, LIMITS.rest);
  }

  function phaseDurationMs() {
    const s = readSettings();
    return (phase === "focus" ? s.focus : s.rest) * 60 * 1000;
  }

  function onSettingsChanged() {
    Store.write(KEYS.settings, readSettings());
    if (!running) {
      totalMs = phaseDurationMs();
      remainingMs = totalMs;
      render();
    }
  }

  document.querySelectorAll(".step-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const input = $(button.dataset.target);
      const max = input === focusInput ? LIMITS.focus : LIMITS.rest;
      input.value = clampMinutes(Number(input.value) + Number(button.dataset.delta), 1, max);
      onSettingsChanged();
    });
  });

  document.querySelectorAll(".preset-btn").forEach((button) => {
    button.addEventListener("click", () => {
      focusInput.value = button.dataset.focus;
      restInput.value = button.dataset.rest;
      onSettingsChanged();
    });
  });

  [focusInput, restInput].forEach((input) => {
    input.addEventListener("change", () => {
      input.value = clampMinutes(input.value, 1, input === focusInput ? LIMITS.focus : LIMITS.rest);
      onSettingsChanged();
    });
  });

  /* ---------- Sessions ---------- */

  function sessionsToday() {
    return Store.read(KEYS.sessions, {})[todayKey()] || 0;
  }

  function addSession() {
    const all = Store.read(KEYS.sessions, {});
    all[todayKey()] = (all[todayKey()] || 0) + 1;
    Store.write(KEYS.sessions, all);
  }

  /* ---------- Timer ---------- */

  function formatTime(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function render() {
    const label = phase === "focus" ? "Focus" : "Rest";
    $("phaseLabel").textContent = label;
    $("timeDisplay").textContent = formatTime(remainingMs);
    $("progressFill").style.width = totalMs ? `${((totalMs - remainingMs) / totalMs) * 100}%` : "0%";
    $("startBtn").textContent = running ? "Pause" : remainingMs < totalMs ? "Resume" : "Start";
    $("sessionCount").textContent = `Sessions today: ${sessionsToday()}`;

    document.body.classList.toggle("phase-focus", phase === "focus");
    document.body.classList.toggle("phase-rest", phase === "rest");
    document.body.classList.toggle("running", running);

    const locked = running && phase === "focus";
    $("lockNote").hidden = !locked;
    $("backLink").classList.toggle("disabled", locked);
    document.querySelectorAll("#settingsPanel input, #settingsPanel button").forEach((node) => {
      node.disabled = running;
    });

    document.title = running ? `${formatTime(remainingMs)} - ${label}` : "Focus Mode";
  }

  function stopTicker() {
    if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  function setPhase(next, autoStart) {
    phase = next;
    totalMs = phaseDurationMs();
    remainingMs = totalMs;
    if (autoStart) {
      startTimer();
    } else {
      running = false;
      stopTicker();
      render();
    }
  }

  function startTimer() {
    running = true;
    endTime = Date.now() + remainingMs;
    stopTicker();
    ticker = setInterval(tick, 250);
    render();
  }

  function pauseTimer() {
    running = false;
    stopTicker();
    render();
  }

  function tick() {
    remainingMs = Math.max(0, endTime - Date.now());
    if (remainingMs <= 0) finishPhase(); else render();
  }

  function finishPhase() {
    stopTicker();
    running = false;
    chime();
    if (phase === "focus") {
      addSession();
      setPhase("rest", true);
    } else {
      setPhase("focus", false);
    }
  }

  function chime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.35, 0.7].forEach((offset, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = i === 2 ? 880 : 660;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + offset + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + offset);
        osc.stop(ctx.currentTime + offset + 0.32);
      });
    } catch {}
  }

  $("startBtn").addEventListener("click", () => {
    if (running) pauseTimer(); else startTimer();
  });

  $("resetBtn").addEventListener("click", () => {
    pauseTimer();
    setPhase(phase, false);
  });

  $("skipBtn").addEventListener("click", () => {
    pauseTimer();
    setPhase(phase === "focus" ? "rest" : "focus", false);
  });

  const lockedIn = () => running && phase === "focus";

  window.addEventListener("beforeunload", (event) => {
    if (lockedIn()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  $("backLink").addEventListener("click", (event) => {
    if (lockedIn()) event.preventDefault();
  });

  /* ---------- Suggestions: today's open tasks, including repeating ones ---------- */

  function loadTodayTasks() {
    const days = Store.read(KEYS.days, {});
    const rules = Store.read(KEYS.rules, []);
    const list = $("todayTasks");
    PlannerCore.itemsFor(days, Array.isArray(rules) ? rules : [], todayKey())
      .filter((item) => !item.done)
      .forEach((item) => {
        const option = document.createElement("option");
        option.value = item.text;
        list.appendChild(option);
      });
  }

  /* ---------- Background: the timer's own, else the planner's ---------- */

  const bgInput = $("bgInput");

  function applyBackground() {
    const own = Store.readText(KEYS.ownBackground);
    const shown = own || Store.readText(KEYS.plannerBackground);
    document.body.style.backgroundImage = shown ? `url("${shown}")` : "";
    document.body.classList.toggle("has-bg", !!shown);
    $("bgResetBtn").hidden = !own;
  }

  $("bgChangeBtn").addEventListener("click", () => bgInput.click());
  $("bgResetBtn").addEventListener("click", () => {
    Store.remove(KEYS.ownBackground);
    applyBackground();
  });
  bgInput.addEventListener("change", async () => {
    const file = bgInput.files[0];
    bgInput.value = "";
    if (!file) return;
    try {
      const dataUrl = await downscaleImage(file, 1920);
      if (!Store.write(KEYS.ownBackground, dataUrl)) {
        showToast(TOO_BIG_MESSAGE);
        return;
      }
      applyBackground();
    } catch (err) {
      showToast(err.message);
    }
  });

  /* ---------- Start ---------- */

  applyBackground();
  loadSettings();
  loadTodayTasks();
  setPhase("focus", false);
})();
