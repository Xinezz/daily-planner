/* sfx.js - 8-bit game sound effects for the museum pages (Grand Hall and both museums).
   Sounds are synthesised with square/triangle waves, so there are no audio files. */

(() => {
  "use strict";

  const KEY = "plannerSfx";
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

  /** Plays notes one after another: [[frequency, seconds], ...] with a chiptune envelope. */
  function play(notes, { wave = "square", volume = 0.05 } = {}) {
    if (!enabled) return;
    const ac = audio();
    if (!ac) return;
    let t = ac.currentTime + 0.005;
    notes.forEach(([freq, length]) => {
      if (freq > 0) {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = wave;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(volume, t);
        gain.gain.setValueAtTime(volume, t + length * 0.7);
        gain.gain.linearRampToValueAtTime(0.0001, t + length);
        osc.connect(gain).connect(ac.destination);
        osc.start(t);
        osc.stop(t + length + 0.01);
      }
      t += length;
    });
    return t - ac.currentTime;
  }

  const SOUNDS = {
    blip: () => play([[880, 0.05], [1320, 0.05]]),
    nav: () => play([[660, 0.06], [990, 0.08]]),
    door: () => play([[392, 0.06], [523, 0.06], [659, 0.06], [784, 0.12]]),
    open: () => play([[523, 0.05], [784, 0.05], [1047, 0.09]], { wave: "triangle", volume: 0.09 }),
    close: () => play([[880, 0.05], [587, 0.07]]),
    save: () => play([[523, 0.07], [659, 0.07], [784, 0.07], [1047, 0.16]]),
    warn: () => play([[220, 0.07], [0, 0.03], [220, 0.07]], { volume: 0.06 }),
    remove: () => play([[440, 0.06], [330, 0.06], [220, 0.06], [110, 0.14]], { volume: 0.06 }),
    pickup: () => play([[988, 0.05], [1319, 0.1]]),
  };

  function soundFor(el) {
    if (el.matches(".door")) return "door";
    if (el.matches(".frame")) return "open";
    if (el.matches(".dialog-close, [data-close]")) return "close";
    if (el.id === "saveBtn") return "save";
    if (el.id === "removeBtn") return el.classList.contains("armed") ? "remove" : "warn";
    if (el.matches("a[href]")) return "nav";
    return "blip";
  }

  // Play on every button and link press. Links wait a moment so the sound isn't cut off by the page change.
  document.addEventListener("click", (event) => {
    const el = event.target.closest("button, a[href]");
    if (!el || el.disabled || el.id === "sfxToggle") return;
    const duration = SOUNDS[soundFor(el)]() || 0;

    const isSamePageLink = el.matches("a[href]") && !el.target && el.origin === location.origin;
    const plainClick = event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
    if (enabled && isSamePageLink && plainClick && !event.defaultPrevented) {
      event.preventDefault();
      if (typeof PageLoader !== "undefined") PageLoader.leave();
      setTimeout(() => { location.href = el.href; }, Math.min(260, duration * 1000 + 30));
    }
  }, true);

  document.addEventListener("paste", (event) => {
    const form = document.getElementById("formDialog");
    if (form && form.open && event.clipboardData && [...event.clipboardData.items].some((i) => i.type.startsWith("image/"))) {
      SOUNDS.pickup();
    }
  });

  // Sound on/off switch in the page's top navigation
  const nav = document.querySelector(".gallery-nav");
  if (nav) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.id = "sfxToggle";
    toggle.className = "page-link sfx-toggle";
    const label = () => {
      toggle.textContent = enabled ? "Sound: on" : "Sound: off";
      toggle.setAttribute("aria-pressed", String(enabled));
    };
    label();
    toggle.addEventListener("click", () => {
      enabled = !enabled;
      try {
        localStorage.setItem(KEY, enabled ? "on" : "off");
      } catch {}
      label();
      if (enabled) SOUNDS.pickup();
    });
    nav.appendChild(toggle);
  }

  window.MuseumSfx = { play: (name) => SOUNDS[name] && SOUNDS[name]() };
})();
