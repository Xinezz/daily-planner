/* theme.js - the adjustable accent ("outline") color. Loaded in the <head> of every page so the
   saved color is applied before anything is drawn. */

const Theme = (() => {
  const KEY = "plannerAccent";
  const DEFAULT = "#d4af37";
  const PANEL_RGB = [20, 17, 10];
  const PRESETS = [
    { name: "Gold", hex: "#d4af37" },
    { name: "Rose", hex: "#e8638f" },
    { name: "Coral", hex: "#ff7a59" },
    { name: "Lime", hex: "#8fd14f" },
    { name: "Mint", hex: "#3ddc97" },
    { name: "Cyan", hex: "#2ec4d6" },
    { name: "Sky", hex: "#5aa9ff" },
    { name: "Violet", hex: "#a78bfa" },
    { name: "White", hex: "#f2f2f2" },
  ];

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const isHex = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(rgb) {
    return `#${rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("")}`;
  }

  function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, s, l];
  }

  function hslToRgb([h, s, l]) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const sector = Math.floor(h / 60) % 6;
    const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][sector];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }

  function luminance(rgb) {
    const channel = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  }

  function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /** From one chosen color: the outline color, a lighter one for headings, and a readable dim one for small text. */
  function paletteFor(hex) {
    const [h, s, lightness] = rgbToHsl(hexToRgb(hex));
    let l = clamp(lightness, 0.4, 0.85);
    while (contrast(hslToRgb([h, s, l]), PANEL_RGB) < 3 && l < 0.9) l += 0.02;
    let dimL = Math.max(0.38, l - 0.08);
    while (contrast(hslToRgb([h, s, dimL]), PANEL_RGB) < 4.5 && dimL < 0.95) dimL += 0.02;
    return {
      base: rgbToHex(hslToRgb([h, s, l])),
      light: rgbToHex(hslToRgb([h, s, Math.min(0.9, l + 0.18)])),
      dim: rgbToHex(hslToRgb([h, s, dimL])),
    };
  }

  function stored() {
    try {
      const value = localStorage.getItem(KEY);
      return isHex(value) ? value.toLowerCase() : DEFAULT;
    } catch {
      return DEFAULT;
    }
  }

  function apply(hex) {
    const root = document.documentElement.style;
    if (hex === DEFAULT) {
      ["--gold", "--gold-light", "--gold-dim"].forEach((name) => root.removeProperty(name));
      return;
    }
    const palette = paletteFor(hex);
    root.setProperty("--gold", palette.base);
    root.setProperty("--gold-light", palette.light);
    root.setProperty("--gold-dim", palette.dim);
  }

  function set(hex) {
    if (!isHex(hex)) return false;
    const value = hex.toLowerCase();
    try {
      localStorage.setItem(KEY, value);
    } catch {
      return false;
    }
    apply(value);
    return true;
  }

  function reset() {
    try {
      localStorage.removeItem(KEY);
    } catch {}
    apply(DEFAULT);
  }

  apply(stored());

  return { PRESETS, DEFAULT, current: stored, set, reset, paletteFor };
})();
