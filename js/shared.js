/* shared.js - small helpers used by every page. Loaded before page scripts. */

// Lets the site be installed on a phone and opened offline (see sw.js)
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

const Store = {
  read(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value === null || value === undefined ? fallback : value;
    } catch {
      return fallback;
    }
  },

  readText(key) {
    try {
      return localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  },

  write(key, value) {
    try {
      localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

/** Shrinks an image file and resolves with a JPEG data URL. */
function downscaleImage(file, maxSize, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as an image."));
    };
    img.src = url;
  });
}

let toastTimer = null;

/** Shows a short message at the bottom of the page (alert() is blocked in some browsers). */
function showToast(message) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4000);
}

const TOO_BIG_MESSAGE = "That picture is too large to keep. Try a smaller one.";

/* ---------- Backup: everything the site keeps in this browser, as one file ---------- */

const BACKUP_APP = "daily-planner";
const BACKUP_KEY_PATTERN = /^planner[A-Za-z]*$/;

function plannerStorageKeys() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (BACKUP_KEY_PATTERN.test(key)) keys.push(key);
  }
  return keys;
}

/** Downloads every planner setting, task, note, picture and museum entry as a JSON file. Returns how many items. */
function downloadBackup() {
  const data = {};
  plannerStorageKeys().forEach((key) => { data[key] = localStorage.getItem(key); });

  const backup = { app: BACKUP_APP, version: 1, exportedAt: new Date().toISOString(), data };
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `planner-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return Object.keys(data).length;
}

/** Replaces everything with the contents of a backup file. Throws a readable error if it is not a valid backup. */
async function restoreBackup(file) {
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    throw new Error("That file is not a planner backup.");
  }

  const data = backup && backup.app === BACKUP_APP ? backup.data : null;
  const entries = data && typeof data === "object" && !Array.isArray(data) ? Object.entries(data) : null;
  if (!entries || !entries.every(([key, value]) => BACKUP_KEY_PATTERN.test(key) && typeof value === "string")) {
    throw new Error("That file is not a planner backup.");
  }

  const previous = plannerStorageKeys().map((key) => [key, localStorage.getItem(key)]);
  try {
    plannerStorageKeys().forEach((key) => localStorage.removeItem(key));
    entries.forEach(([key, value]) => localStorage.setItem(key, value));
  } catch {
    plannerStorageKeys().forEach((key) => localStorage.removeItem(key));
    previous.forEach(([key, value]) => { try { localStorage.setItem(key, value); } catch {} });
    throw new Error("There is not enough browser storage to restore that backup. Nothing was changed.");
  }
  return entries.length;
}

/** Waits for an element's CSS animation to end, with a timer fallback (background tabs, reduced motion). */
function waitForAnimation(element, fallbackMs) {
  return new Promise((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      element.removeEventListener("animationend", onEnd);
      resolve();
    };
    const onEnd = (event) => {
      if (event.target === element) done();
    };
    element.addEventListener("animationend", onEnd);
    setTimeout(done, fallbackMs);
  });
}
