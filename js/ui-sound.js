/* ui-sound.js - soft, satisfying button sounds for the planner and Focus Mode.
   (The museums use their own 8-bit sounds in sfx.js.) Everything is synthesised; no audio files. */

const UiSound = (() => {
  const KEY = "plannerUiSound";
  let ctx = null;
  let enabled = (() => {
    try {
      return localStorage.getItem(KEY) !== "off";
    } catch {
      return true;
    }
  })();

  function audio() {
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  /** One soft voice: a pitch that glides from `from` to `to`, with a gentle fade. */
  function voice(ac, { from, to = from, start = 0, length = 0.12, volume = 0.08, wave = "sine" }) {
    const t = ac.currentTime + 0.005 + start;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const soften = ac.createBiquadFilter();
    osc.type = wave;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + length * 0.6);
    soften.type = "lowpass";
    soften.frequency.value = 2400;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(soften).connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  /** A short breath of filtered noise, for removing things. */
  function swish(ac, { length = 0.16, volume = 0.05 }) {
    const t = ac.currentTime + 0.005;
    const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * length), ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ac.createBufferSource();
    noise.buffer = buffer;
    const band = ac.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.2;
    band.frequency.setValueAtTime(2200, t);
    band.frequency.exponentialRampToValueAtTime(500, t + length);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    noise.connect(band).connect(gain).connect(ac.destination);
    noise.start(t);
  }

  const SOUNDS = {
    pop: (ac) => voice(ac, { from: 520, to: 300, length: 0.11, volume: 0.09 }),
    tick: (ac) => voice(ac, { from: 1400, to: 1100, length: 0.05, volume: 0.035 }),
    bright: (ac) => voice(ac, { from: 760, to: 900, length: 0.1, volume: 0.07, wave: "triangle" }),
    check: (ac) => {
      voice(ac, { from: 660, length: 0.16, volume: 0.06, wave: "triangle" });
      voice(ac, { from: 990, start: 0.07, length: 0.28, volume: 0.06, wave: "triangle" });
    },
    uncheck: (ac) => voice(ac, { from: 520, to: 380, length: 0.14, volume: 0.06, wave: "triangle" }),
    add: (ac) => {
      voice(ac, { from: 300, to: 520, length: 0.12, volume: 0.09 });
      voice(ac, { from: 780, start: 0.08, length: 0.2, volume: 0.05, wave: "triangle" });
    },
    remove: (ac) => swish(ac, { length: 0.16, volume: 0.06 }),
    open: (ac) => {
      voice(ac, { from: 440, to: 660, length: 0.14, volume: 0.06 });
    },
    close: (ac) => voice(ac, { from: 600, to: 360, length: 0.12, volume: 0.055 }),
  };

  function play(name) {
    if (!enabled || !SOUNDS[name]) return;
    const ac = audio();
    if (ac) SOUNDS[name](ac);
  }

  function soundFor(el) {
    if (el.id === "addTaskBtn") return "add";
    if (el.matches(".task-action")) return "remove";
    if (el.matches(".day-cell")) return "tick";
    if (el.matches(".accent-swatch")) return "bright";
    if (el.matches(".dialog-close, [data-close]")) return "close";
    if (el.matches("#settingsBtn, #agendaBtn")) return "open";
    if (el.matches(".nav-btn, #todayBtn, .search-results button")) return "tick";
    return "pop";
  }

  document.addEventListener("click", (event) => {
    const el = event.target.closest("button, a[href], [role='button']");
    if (!el || el.disabled) return;
    play(soundFor(el));
  }, true);

  // ticking a task (or any checkbox / switch) off and on
  document.addEventListener("change", (event) => {
    const el = event.target;
    if (el.matches && el.matches('input[type="checkbox"]')) play(el.checked ? "check" : "uncheck");
  }, true);

  // adding a task with the Enter key
  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.id === "taskInput" && event.target.value.trim()) play("add");
  }, true);

  // Let link sounds finish before the page changes (pages that cancel a link, like a locked
  // Focus Mode, are respected because this runs after their own handlers).
  window.addEventListener("click", (event) => {
    const link = event.target.closest && event.target.closest("a[href]");
    if (!enabled || !link || event.defaultPrevented) return;
    if (link.target || link.origin !== location.origin) return;
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setTimeout(() => { location.href = link.href; }, 110);
  });

  function setEnabled(on) {
    enabled = !!on;
    try {
      localStorage.setItem(KEY, enabled ? "on" : "off");
    } catch {}
    if (enabled) play("check");
  }

  return { play, setEnabled, isEnabled: () => enabled };
})();
