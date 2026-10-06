/* museum.js - the Update Museum and the Museum of Projects (museum.html?wing=updates|projects).
   Needs shared.js and museum-data.js loaded first. */

(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const wingName = params.get("wing") === "projects" ? "projects" : "updates";
  const wing = WINGS[wingName];
  const REMOVED_KEY = `${wing.storeKey}Removed`;
  const SIZE_CYCLE = ["a", "b", "c", "b", "a", "c"];

  const $ = (id) => document.getElementById(id);

  let works = loadWorks();
  let currentId = null;
  let editingId = null;
  let pendingFile = null;
  let previewUrl = null;
  let removeTimer = null;

  /* ---------- Storage: saved works plus any built-in works not yet removed ---------- */

  function loadWorks() {
    const stored = Store.read(wing.storeKey, []);
    const list = Array.isArray(stored) ? stored : [];
    const removed = Store.read(REMOVED_KEY, []);
    const have = new Set(list.map((work) => work.id));
    wing.seeds.forEach((seed) => {
      if (!have.has(seed.id) && !removed.includes(seed.id)) list.push({ ...seed });
    });
    return list;
  }

  const saveWorks = () => Store.write(wing.storeKey, works);

  function safeUrl(value) {
    const v = (value || "").trim();
    if (!v) return "";
    if (/^(https?:\/\/|\/|\.\/|[\w-]+\.html?(\?|#|$))/i.test(v)) return v;
    if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(v)) return `https://${v}`;
    return "";
  }

  const metaLine = (work) => [work.year, work.medium].filter(Boolean).join(" · ");

  /* ---------- The hall ---------- */

  function buildImage(work, className) {
    const box = document.createElement("div");
    box.className = className;

    if (work.image) {
      const img = document.createElement("img");
      img.src = work.image;
      img.alt = work.title;
      if (work.pixel) img.classList.add("pixel");
      if (work.backdrop) box.style.background = work.backdrop;
      box.appendChild(img);
    } else {
      const blank = document.createElement("span");
      blank.className = "blank-canvas";
      blank.textContent = work.glyph || (work.title || "?").trim().charAt(0).toUpperCase();
      if (work.bg) blank.style.background = work.bg;
      box.appendChild(blank);
    }
    return box;
  }

  /** Sizes the frame to the picture's own shape so nothing is cropped. */
  function fitToPicture(img, exhibit, box) {
    const apply = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) return;
      const width = Math.round(Math.min(400, Math.max(210, Math.sqrt(78400 * (w / h)))));
      exhibit.style.width = `${width}px`;
      box.style.aspectRatio = `${w} / ${h}`;
    };
    if (img.complete) apply(); else img.addEventListener("load", apply, { once: true });
  }

  function renderHall() {
    const hall = $("hall");
    hall.replaceChildren();

    if (works.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-hall";
      empty.textContent = wing.empty;
      hall.appendChild(empty);
      return;
    }

    works.forEach((work, i) => {
      const exhibit = document.createElement("article");
      exhibit.className = `exhibit size-${SIZE_CYCLE[i % SIZE_CYCLE.length]}`;

      const spot = document.createElement("div");
      spot.className = "spot";
      const lamp = document.createElement("div");
      lamp.className = "lamp";

      const frame = document.createElement("button");
      frame.type = "button";
      frame.className = "frame";
      frame.setAttribute("aria-label", `View ${work.title}`);
      const mat = document.createElement("div");
      mat.className = "mat";
      const canvas = buildImage(work, "canvas");
      mat.appendChild(canvas);
      const picture = canvas.querySelector("img");
      if (picture) fitToPicture(picture, exhibit, canvas);
      frame.appendChild(mat);
      frame.addEventListener("click", () => openView(work.id));

      const plaque = document.createElement("div");
      plaque.className = "plaque";
      const title = document.createElement("div");
      title.className = "plaque-title";
      title.textContent = work.title;
      const meta = document.createElement("div");
      meta.className = "plaque-meta";
      meta.textContent = metaLine(work);
      plaque.append(title, meta);

      exhibit.append(spot, lamp, frame, plaque);
      hall.appendChild(exhibit);
    });
  }

  /* ---------- Zoomed view, with two-step remove ---------- */

  function disarmRemove() {
    clearTimeout(removeTimer);
    removeTimer = null;
    $("removeBtn").textContent = "Remove";
    $("removeBtn").classList.remove("armed");
  }

  function openView(id) {
    const work = works.find((w) => w.id === id);
    if (!work) return;
    currentId = id;
    disarmRemove();

    const canvas = $("viewCanvas");
    canvas.replaceChildren();
    canvas.style.background = work.backdrop || "";
    canvas.classList.toggle("natural", !!work.image);
    canvas.appendChild(buildImage(work, "view-image").firstChild);

    $("viewTitle").textContent = work.title;
    $("viewMeta").textContent = metaLine(work);
    $("viewDesc").textContent = work.description || "";

    const link = $("viewLink");
    const href = safeUrl(work.link);
    link.hidden = !href;
    link.textContent = wing.visitLabel;
    if (href) link.href = href;

    $("viewDialog").showModal();
  }

  $("removeBtn").addEventListener("click", () => {
    const work = works.find((w) => w.id === currentId);
    if (!work) return;

    if (!removeTimer) {
      $("removeBtn").textContent = "Click again to remove";
      $("removeBtn").classList.add("armed");
      removeTimer = setTimeout(disarmRemove, 4000);
      return;
    }
    disarmRemove();

    if (wing.seeds.some((seed) => seed.id === work.id)) {
      const removed = Store.read(REMOVED_KEY, []);
      removed.push(work.id);
      Store.write(REMOVED_KEY, removed);
    }
    works = works.filter((w) => w.id !== currentId);
    saveWorks();
    $("viewDialog").close();
    renderHall();
  });

  $("editBtn").addEventListener("click", () => {
    const work = works.find((w) => w.id === currentId);
    $("viewDialog").close();
    if (work) openForm(work);
  });

  /* ---------- Add / edit form, with paste-from-clipboard ---------- */

  function setPendingFile(file) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    pendingFile = file || null;

    const preview = $("pastePreview");
    preview.hidden = !pendingFile;
    $("pasteHint").hidden = !!pendingFile;
    if (pendingFile) {
      previewUrl = URL.createObjectURL(pendingFile);
      preview.src = previewUrl;
    } else {
      preview.removeAttribute("src");
    }
  }

  function showFormError(message) {
    const box = $("formError");
    box.textContent = message;
    box.hidden = false;
  }

  function openForm(work) {
    editingId = work ? work.id : null;
    $("formHeading").textContent = work ? wing.editHeading : wing.formHeading;
    $("saveBtn").textContent = work ? "Save changes" : "Hang it";
    $("fTitle").value = work ? work.title : "";
    $("fYear").value = work ? work.year || "" : wing.ph.year;
    $("fMedium").value = work ? work.medium || "" : "";
    $("fDesc").value = work ? work.description || "" : "";
    $("fLink").value = work ? work.link || "" : "";
    $("fImage").value = "";
    setPendingFile(null);
    $("pasteHint").textContent = work
      ? "Leave this empty to keep the current picture, or press Ctrl+V to paste a new one"
      : "Or copy a screenshot with Snipping Tool, then press Ctrl+V here";
    $("formError").hidden = true;
    $("formDialog").showModal();
  }

  $("addWorkBtn").addEventListener("click", () => openForm(null));

  $("fImage").addEventListener("change", () => {
    const file = $("fImage").files[0];
    if (file) setPendingFile(file);
  });

  document.addEventListener("paste", (event) => {
    if (!$("formDialog").open || !event.clipboardData) return;
    const item = [...event.clipboardData.items].find((i) => i.kind === "file" && i.type.startsWith("image/"));
    const file = item && item.getAsFile();
    if (!file) return;
    event.preventDefault();
    $("fImage").value = "";
    $("formError").hidden = true;
    setPendingFile(file);
  });

  $("workForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = $("fTitle").value.trim();
    if (!title) return;

    const existing = editingId ? works.find((w) => w.id === editingId) : null;
    const before = existing ? { ...existing } : null;

    let image = existing ? existing.image : "";
    let pixel = existing ? existing.pixel : false;
    if (pendingFile) {
      try {
        image = await downscaleImage(pendingFile, 1200);
        pixel = false;
      } catch (err) {
        showFormError(err.message);
        return;
      }
    }

    const fields = {
      title,
      year: $("fYear").value.trim(),
      medium: $("fMedium").value.trim(),
      description: $("fDesc").value.trim(),
      link: $("fLink").value.trim(),
      image,
      pixel,
    };

    if (existing) Object.assign(existing, fields);
    else works.push({ id: `w-${Date.now()}`, ...fields });

    if (!saveWorks()) {
      if (existing) Object.assign(existing, before); else works.pop();
      showFormError(TOO_BIG_MESSAGE);
      return;
    }

    $("formDialog").close();
    renderHall();
  });

  /* ---------- Dialogs ---------- */

  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => $(button.dataset.close).close());
  });

  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  /* ---------- Start: fill in this wing's wording ---------- */

  document.title = wing.pageTitle;
  $("signSmall").textContent = wing.small;
  $("signTitle").textContent = wing.title;
  $("signSub").textContent = wing.sub;
  $("addWorkBtn").textContent = wing.addLabel;
  $("lblYear").textContent = wing.lblYear;
  $("lblMedium").textContent = wing.lblMedium;
  $("fTitle").placeholder = wing.ph.title;
  $("fYear").placeholder = wing.ph.year;
  $("fMedium").placeholder = wing.ph.medium;
  $("fDesc").placeholder = wing.ph.desc;
  $(wingName === "updates" ? "navUpdates" : "navProjects").classList.add("current");

  renderHall();
})();
