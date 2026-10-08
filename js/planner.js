/* planner.js - the main planner page (index.html).
   Needs shared.js and planner-core.js loaded first. */

(() => {
  "use strict";

  const { dateKey, parseKey, itemsFor, dayStatus, isWeekendKey } = PlannerCore;

  const KEYS = {
    days: "plannerData",
    rules: "plannerRepeats",
    displayPicture: "plannerDisplayPicture",
    pageBackground: "plannerBackground",
    settings: "plannerSettings",
    calendarDefault: "plannerCalendarBackground",
    calendarMonths: "plannerCalendarBackgrounds",
    notesBackground: "plannerNotesBackground",
  };

  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const REPEAT_LABELS = { daily: "every day", weekdays: "weekdays", weekly: "weekly", monthly: "monthly" };

  const $ = (id) => document.getElementById(id);

  /* ---------- State ---------- */

  const savedDays = Store.read(KEYS.days, {});
  const savedRules = Store.read(KEYS.rules, []);
  const days = savedDays && typeof savedDays === "object" && !Array.isArray(savedDays) ? savedDays : {};
  const rules = Array.isArray(savedRules) ? savedRules : [];

  const now = new Date();
  const view = { year: now.getFullYear(), month: now.getMonth() };
  let selectedKey = null;

  function todayKey() {
    const d = new Date();
    return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function longDate(key) {
    const { y, m, d } = parseKey(key);
    const date = new Date(y, m - 1, d);
    return `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[m - 1]} ${d}, ${y}`;
  }

  function shortDate(key) {
    const { y, m, d } = parseKey(key);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: "short", month: "short", day: "numeric", year: "numeric",
    });
  }

  function saveAll() {
    const ok = Store.write(KEYS.days, days) && Store.write(KEYS.rules, rules);
    if (!ok) showToast("Could not save. Your browser storage may be full.");
  }

  /* ---------- Header clock ---------- */

  function updateHeader() {
    const date = new Date();
    const hour = date.getHours();
    const header = $("greetingHeader");
    $("greetingText").textContent = hour < 12 ? "Good Morning" : hour < 18 ? "Good Afternoon" : "Good Evening";
    $("dateBox").textContent = date.toLocaleDateString();
    $("timeBox").textContent = date.toLocaleTimeString();
    $("dayBox").textContent = DAY_NAMES[date.getDay()];

    const weekend = date.getDay() === 0 || date.getDay() === 6;
    header.classList.toggle("is-weekend", weekend);
    header.classList.toggle("is-weekday", !weekend);
  }

  /* ---------- Calendar ---------- */

  function renderCalendar() {
    const grid = $("calendarGrid");
    const focusedKey = grid.contains(document.activeElement) ? document.activeElement.dataset.key : null;

    grid.replaceChildren();
    $("monthLabel").textContent = `${MONTH_NAMES[view.month]} ${view.year}`;

    const leadingBlanks = new Date(view.year, view.month, 1).getDay();
    const dayCount = new Date(view.year, view.month + 1, 0).getDate();
    const today = todayKey();

    for (let i = 0; i < leadingBlanks; i++) {
      const blank = document.createElement("div");
      blank.className = "day-cell empty";
      blank.setAttribute("aria-hidden", "true");
      grid.appendChild(blank);
    }

    for (let d = 1; d <= dayCount; d++) {
      const key = dateKey(view.year, view.month, d);
      const items = itemsFor(days, rules, key);
      const status = dayStatus(items);

      const cell = document.createElement("button");
      cell.type = "button";
      cell.dataset.key = key;
      cell.className = `day-cell ${status || (isWeekendKey(key) ? "weekend" : "weekday")}`;
      if (key === today) cell.classList.add("today");
      if (key === selectedKey) cell.classList.add("selected");

      const count = items.length;
      cell.setAttribute(
        "aria-label",
        `${longDate(key)}, ${count === 0 ? "no tasks" : status === "done" ? "all tasks done" : `${count} task${count > 1 ? "s" : ""}`}`
      );

      const number = document.createElement("div");
      number.className = "day-number";
      number.textContent = d;
      cell.appendChild(number);

      if (count > 0) {
        const label = document.createElement("div");
        label.className = "day-task-count";
        label.textContent = status === "done" ? "done" : `${count} task${count > 1 ? "s" : ""}`;
        cell.appendChild(label);
      }

      cell.addEventListener("click", () => selectDay(key));
      grid.appendChild(cell);
    }

    if (focusedKey) {
      const again = grid.querySelector(`[data-key="${focusedKey}"]`);
      if (again) again.focus();
    }
    applyCalendarBg();
  }

  $("calendarGrid").addEventListener("keydown", (event) => {
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const cell = event.target.closest(".day-cell");
    if (!cell || !cell.dataset.key || !(event.key in steps)) return;
    const wanted = PlannerCore.addDays(cell.dataset.key, steps[event.key]);
    const next = $("calendarGrid").querySelector(`[data-key="${wanted}"]`);
    if (next) {
      event.preventDefault();
      next.focus();
    }
  });

  /* ---------- Month changes (page-flip animation) ---------- */

  let flipping = false;
  const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setNavDisabled(disabled) {
    $("prevMonth").disabled = disabled;
    $("nextMonth").disabled = disabled;
  }

  async function flipTo(year, month, direction) {
    if (flipping) return;
    if (year === view.year && month === view.month) {
      renderCalendar();
      return;
    }
    flipping = true;
    setNavDisabled(true);
    const page = $("calendarFlip");
    const suffix = direction === "next" ? "Next" : "Prev";

    try {
      if (!prefersReducedMotion()) {
        page.style.animation = `flipOut${suffix} 0.2s ease forwards`;
        await waitForAnimation(page, 350);
      }
      view.year = year;
      view.month = month;
      renderCalendar();
      if (!prefersReducedMotion()) {
        page.style.animation = `flipIn${suffix} 0.25s ease forwards`;
        await waitForAnimation(page, 400);
      }
    } finally {
      page.style.animation = "";
      flipping = false;
      setNavDisabled(false);
    }
  }

  function stepMonth(delta) {
    const target = new Date(view.year, view.month + delta, 1);
    return flipTo(target.getFullYear(), target.getMonth(), delta > 0 ? "next" : "prev");
  }

  async function goToDate(key) {
    const { y, m } = parseKey(key);
    const sameMonth = y === view.year && m - 1 === view.month;
    if (!sameMonth) {
      const direction = y * 12 + (m - 1) > view.year * 12 + view.month ? "next" : "prev";
      await flipTo(y, m - 1, direction);
    }
    selectDay(key);
  }

  $("prevMonth").addEventListener("click", () => stepMonth(-1));
  $("nextMonth").addEventListener("click", () => stepMonth(1));
  $("todayBtn").addEventListener("click", () => goToDate(todayKey()));

  /* ---------- Notes and tasks for the selected day ---------- */

  function selectDay(key) {
    selectedKey = key;
    $("notesDate").textContent = longDate(key);
    $("notesText").value = (days[key] && days[key].notes) || "";
    renderTaskList();
    renderCalendar();
  }

  function renderTaskList() {
    const list = $("taskList");
    list.replaceChildren();
    if (!selectedKey) return;

    itemsFor(days, rules, selectedKey).forEach((item) => {
      const li = document.createElement("li");
      if (item.done) li.classList.add("done");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.done;
      checkbox.setAttribute("aria-label", `Mark "${item.text}" as done`);
      checkbox.addEventListener("change", () => {
        PlannerCore.setDone(days, rules, selectedKey, item, checkbox.checked);
        saveAll();
        renderTaskList();
        renderCalendar();
      });

      const text = document.createElement("span");
      text.className = "task-text";
      text.textContent = item.text;

      li.append(checkbox, text);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "task-action";
      remove.textContent = "✕";
      remove.title = item.repeat ? "Skip this day only" : "Delete task";
      remove.setAttribute("aria-label", `${item.repeat ? "Skip today for" : "Delete"} "${item.text}"`);
      remove.addEventListener("click", () => {
        PlannerCore.removeItem(days, rules, selectedKey, item);
        saveAll();
        renderTaskList();
        renderCalendar();
      });
      li.appendChild(remove);

      if (item.repeat) {
        const meta = document.createElement("div");
        meta.className = "task-meta";

        const tag = document.createElement("span");
        tag.className = "repeat-tag";
        tag.textContent = `repeats ${REPEAT_LABELS[item.repeat]}`;

        const stop = document.createElement("button");
        stop.type = "button";
        stop.className = "task-action text";
        stop.textContent = "stop repeating";
        stop.title = "Keep this day, but stop repeating after it";
        stop.addEventListener("click", () => {
          PlannerCore.stopRepeating(rules, selectedKey, item.ruleId);
          saveAll();
          renderTaskList();
          renderCalendar();
        });

        meta.append(tag, stop);
        li.appendChild(meta);
      }

      list.appendChild(li);
    });
  }

  function addTask() {
    if (!selectedKey) return;
    const input = $("taskInput");
    const repeat = $("repeatSelect").value;
    if (!PlannerCore.addTask(days, rules, selectedKey, input.value, repeat)) return;
    input.value = "";
    $("repeatSelect").value = "";
    saveAll();
    renderTaskList();
    renderCalendar();
  }

  $("addTaskBtn").addEventListener("click", addTask);
  $("taskInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") addTask();
  });

  $("notesText").addEventListener("input", (event) => {
    if (!selectedKey) return;
    PlannerCore.ensureDay(days, selectedKey).notes = event.target.value;
    PlannerCore.pruneDay(days, selectedKey);
    saveAll();
  });

  /* ---------- Search ---------- */

  const searchInput = $("searchInput");
  const searchResults = $("searchResults");

  function hideSearch() {
    searchResults.hidden = true;
    searchResults.replaceChildren();
  }

  function runSearch() {
    if (!searchInput.value.trim()) {
      hideSearch();
      return;
    }
    const hits = PlannerCore.search(days, rules, searchInput.value);
    searchResults.replaceChildren();

    if (hits.length === 0) {
      const empty = document.createElement("li");
      empty.className = "search-empty";
      empty.textContent = "Nothing found.";
      searchResults.appendChild(empty);
    }

    hits.forEach((hit) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";

      const when = document.createElement("div");
      when.className = "hit-date";
      const kind = hit.kind === "note" ? "note" : hit.kind === "repeat" ? `repeats ${REPEAT_LABELS[hit.repeat]}` : "task";
      when.textContent = `${shortDate(hit.key)} · ${kind}`;

      const what = document.createElement("div");
      what.textContent = hit.text;

      button.append(when, what);
      button.addEventListener("click", () => {
        hideSearch();
        searchInput.value = "";
        goToDate(hit.key);
      });
      li.appendChild(button);
      searchResults.appendChild(li);
    });
    searchResults.hidden = false;
  }

  searchInput.addEventListener("input", runSearch);
  searchInput.addEventListener("focus", runSearch);
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      searchInput.value = "";
      hideSearch();
    }
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-box")) hideSearch();
  });

  /* ---------- Agenda ---------- */

  function renderAgendaSection(title, entries, container) {
    const section = document.createElement("section");
    section.className = "agenda-section";
    const heading = document.createElement("h3");
    heading.textContent = title;
    section.appendChild(heading);

    entries.forEach(({ key, items }) => {
      const box = document.createElement("div");
      box.className = "agenda-day";

      const dayButton = document.createElement("button");
      dayButton.type = "button";
      dayButton.className = "agenda-day-title";
      dayButton.textContent = key === todayKey() ? `Today · ${shortDate(key)}` : shortDate(key);
      dayButton.addEventListener("click", () => {
        $("agendaDialog").close();
        goToDate(key);
      });
      box.appendChild(dayButton);

      items.forEach((item) => {
        const label = document.createElement("label");
        if (item.done) label.className = "is-done";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = item.done;
        checkbox.addEventListener("change", () => {
          PlannerCore.setDone(days, rules, key, item, checkbox.checked);
          saveAll();
          renderAgenda();
          renderCalendar();
          if (key === selectedKey) renderTaskList();
        });
        const text = document.createElement("span");
        text.textContent = item.repeat ? `${item.text} (repeats ${REPEAT_LABELS[item.repeat]})` : item.text;
        label.append(checkbox, text);
        box.appendChild(label);
      });
      section.appendChild(box);
    });
    container.appendChild(section);
  }

  function renderAgenda() {
    const body = $("agendaBody");
    body.replaceChildren();
    const { overdue, upcoming } = PlannerCore.agenda(days, rules, todayKey());

    if (overdue.length) renderAgendaSection("Overdue", overdue, body);
    if (upcoming.length) renderAgendaSection("Today and the next two weeks", upcoming, body);
    if (!overdue.length && !upcoming.length) {
      const empty = document.createElement("p");
      empty.className = "agenda-empty";
      empty.textContent = "Nothing planned yet. Pick a day and add a task.";
      body.appendChild(empty);
    }
  }

  $("agendaBtn").addEventListener("click", () => {
    renderAgenda();
    $("agendaDialog").showModal();
  });

  /* ---------- Display picture ---------- */

  const dpInput = $("dpInput");

  function showDisplayPicture(dataUrl) {
    $("dpImage").src = dataUrl;
    $("dpImage").hidden = false;
    $("dpPlaceholder").hidden = true;
  }

  $("displayPicture").addEventListener("click", () => dpInput.click());
  $("displayPicture").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      dpInput.click();
    }
  });
  dpInput.addEventListener("change", async () => {
    const file = dpInput.files[0];
    dpInput.value = "";
    if (!file) return;
    try {
      const dataUrl = await downscaleImage(file, 1200);
      if (!Store.write(KEYS.displayPicture, dataUrl)) {
        showToast(TOO_BIG_MESSAGE);
        return;
      }
      showDisplayPicture(dataUrl);
    } catch (err) {
      showToast(err.message);
    }
  });

  const savedPicture = Store.readText(KEYS.displayPicture);
  if (savedPicture) showDisplayPicture(savedPicture);

  /* ---------- Page background ---------- */

  const bgInput = $("bgInput");

  function applyPageBackground(dataUrl) {
    if (dataUrl) document.body.style.setProperty("--page-bg", `url("${dataUrl}")`);
    else document.body.style.removeProperty("--page-bg");
    document.body.classList.toggle("has-bg", !!dataUrl);
    $("bgResetBtn").hidden = !dataUrl;
  }

  $("bgChangeBtn").addEventListener("click", () => bgInput.click());
  $("bgResetBtn").addEventListener("click", () => {
    Store.remove(KEYS.pageBackground);
    applyPageBackground("");
  });
  bgInput.addEventListener("change", async () => {
    const file = bgInput.files[0];
    bgInput.value = "";
    if (!file) return;
    try {
      const dataUrl = await downscaleImage(file, 1920);
      if (!Store.write(KEYS.pageBackground, dataUrl)) {
        showToast(TOO_BIG_MESSAGE);
        return;
      }
      applyPageBackground(dataUrl);
    } catch (err) {
      showToast(err.message);
    }
  });

  applyPageBackground(Store.readText(KEYS.pageBackground));

  /* ---------- Calendar and notes backgrounds, and the Settings dialog ---------- */

  const DEFAULT_SETTINGS = {
    calBgOn: true,
    notesBgOn: true,
    calTransparency: 0,
    notesTransparency: 0,
    perMonth: false,
  };

  const settings = { ...DEFAULT_SETTINGS, ...Store.read(KEYS.settings, {}) };
  let calendarDefaultBg = Store.readText(KEYS.calendarDefault);
  let notesBg = Store.readText(KEYS.notesBackground);
  const monthBackgrounds = Store.read(KEYS.calendarMonths, {});

  const calPanel = $("calendarPanel");
  const notesPanel = document.querySelector(".notes-panel");
  const painted = new WeakMap();

  function saveSettings() {
    Store.write(KEYS.settings, settings);
  }

  /** Paints a picture behind a panel, faded toward the panel colour by the transparency setting. */
  function paintPanel(panel, image, on, transparency) {
    const show = on && image;
    const alpha = (0.35 + 0.65 * (transparency / 100)).toFixed(3);
    const signature = show ? `${image.length}|${image.slice(-24)}|${alpha}` : "";
    if (painted.get(panel) === signature) return;
    painted.set(panel, signature);

    if (!show) {
      panel.style.backgroundImage = "";
      panel.style.backgroundSize = "";
      panel.style.backgroundPosition = "";
      return;
    }
    panel.style.backgroundImage =
      `linear-gradient(rgba(20, 17, 10, ${alpha}), rgba(20, 17, 10, ${alpha})), url("${image}")`;
    panel.style.backgroundSize = "cover";
    panel.style.backgroundPosition = "center";
  }

  const viewMonthKey = () => `${view.year}-${String(view.month + 1).padStart(2, "0")}`;
  const viewMonthLabel = () => `${MONTH_NAMES[view.month]} ${view.year}`;

  function calendarImage() {
    if (settings.perMonth && monthBackgrounds[viewMonthKey()]) return monthBackgrounds[viewMonthKey()];
    return calendarDefaultBg;
  }

  function applyCalendarBg() {
    paintPanel(calPanel, calendarImage(), settings.calBgOn, settings.calTransparency);
  }

  function applyNotesBg() {
    paintPanel(notesPanel, notesBg, settings.notesBgOn, settings.notesTransparency);
  }

  function refreshSettingsUI() {
    $("optCalOn").checked = settings.calBgOn;
    $("optNotesOn").checked = settings.notesBgOn;
    $("optPerMonth").checked = settings.perMonth;
    $("optCalTrans").value = settings.calTransparency;
    $("optNotesTrans").value = settings.notesTransparency;
    $("calTransVal").textContent = `${settings.calTransparency}%`;
    $("notesTransVal").textContent = `${settings.notesTransparency}%`;

    const own = monthBackgrounds[viewMonthKey()];
    if (settings.perMonth) {
      $("calPickBtn").textContent = `Choose picture for ${viewMonthLabel()}`;
      $("calClearBtn").disabled = !own;
      $("calStatus").textContent = own
        ? `${viewMonthLabel()} has its own picture.`
        : calendarDefaultBg
          ? `${viewMonthLabel()} uses the default picture.`
          : `${viewMonthLabel()} has no picture yet.`;
    } else {
      $("calPickBtn").textContent = "Choose picture";
      $("calClearBtn").disabled = !calendarDefaultBg;
      $("calStatus").textContent = calendarDefaultBg
        ? "One picture is used for every month."
        : "No picture chosen yet.";
    }

    $("notesClearBtn").disabled = !notesBg;
    $("notesStatus").textContent = notesBg ? "A notes picture is set." : "No picture chosen yet.";
  }

  function settingsMessage(text) {
    const box = $("settingsMsg");
    box.textContent = text || "";
    box.hidden = !text;
  }

  $("settingsBtn").addEventListener("click", () => {
    settingsMessage("");
    $("backupStatus").textContent = "";
    $("optUiSound").checked = UiSound.isEnabled();
    refreshAccentUI();
    refreshSettingsUI();
    $("settingsDialog").showModal();
  });

  $("optCalOn").addEventListener("change", (event) => {
    settings.calBgOn = event.target.checked;
    saveSettings();
    applyCalendarBg();
  });

  $("optNotesOn").addEventListener("change", (event) => {
    settings.notesBgOn = event.target.checked;
    saveSettings();
    applyNotesBg();
  });

  $("optPerMonth").addEventListener("change", (event) => {
    settings.perMonth = event.target.checked;
    saveSettings();
    applyCalendarBg();
    refreshSettingsUI();
  });

  $("optCalTrans").addEventListener("input", (event) => {
    settings.calTransparency = Number(event.target.value);
    $("calTransVal").textContent = `${settings.calTransparency}%`;
    saveSettings();
    applyCalendarBg();
  });

  $("optNotesTrans").addEventListener("input", (event) => {
    settings.notesTransparency = Number(event.target.value);
    $("notesTransVal").textContent = `${settings.notesTransparency}%`;
    saveSettings();
    applyNotesBg();
  });

  $("calPickBtn").addEventListener("click", () => $("calFile").click());
  $("notesPickBtn").addEventListener("click", () => $("notesFile").click());

  $("calFile").addEventListener("change", async () => {
    const file = $("calFile").files[0];
    $("calFile").value = "";
    if (!file) return;

    let dataUrl;
    try {
      dataUrl = await downscaleImage(file, 1400);
    } catch (err) {
      settingsMessage(err.message);
      return;
    }

    let saved;
    if (settings.perMonth) {
      const key = viewMonthKey();
      const previous = monthBackgrounds[key];
      monthBackgrounds[key] = dataUrl;
      saved = Store.write(KEYS.calendarMonths, monthBackgrounds);
      if (!saved) {
        if (previous) monthBackgrounds[key] = previous; else delete monthBackgrounds[key];
      }
    } else {
      saved = Store.write(KEYS.calendarDefault, dataUrl);
      if (saved) calendarDefaultBg = dataUrl;
    }
    if (!saved) {
      settingsMessage(TOO_BIG_MESSAGE);
      return;
    }

    settingsMessage("");
    if (!settings.calBgOn) {
      settings.calBgOn = true;
      saveSettings();
    }
    applyCalendarBg();
    refreshSettingsUI();
  });

  $("notesFile").addEventListener("change", async () => {
    const file = $("notesFile").files[0];
    $("notesFile").value = "";
    if (!file) return;

    let dataUrl;
    try {
      dataUrl = await downscaleImage(file, 1000);
    } catch (err) {
      settingsMessage(err.message);
      return;
    }
    if (!Store.write(KEYS.notesBackground, dataUrl)) {
      settingsMessage(TOO_BIG_MESSAGE);
      return;
    }

    notesBg = dataUrl;
    settingsMessage("");
    if (!settings.notesBgOn) {
      settings.notesBgOn = true;
      saveSettings();
    }
    applyNotesBg();
    refreshSettingsUI();
  });

  $("calClearBtn").addEventListener("click", () => {
    if (settings.perMonth) {
      delete monthBackgrounds[viewMonthKey()];
      Store.write(KEYS.calendarMonths, monthBackgrounds);
    } else {
      Store.remove(KEYS.calendarDefault);
      calendarDefaultBg = "";
    }
    applyCalendarBg();
    refreshSettingsUI();
  });

  $("notesClearBtn").addEventListener("click", () => {
    Store.remove(KEYS.notesBackground);
    notesBg = "";
    applyNotesBg();
    refreshSettingsUI();
  });

  /* ---------- Outline (accent) color ---------- */

  function refreshAccentUI() {
    const current = Theme.current();
    $("accentPicker").value = current;
    $("accentSwatches").querySelectorAll(".accent-swatch").forEach((swatch) => {
      swatch.setAttribute("aria-pressed", String(swatch.dataset.hex === current));
    });
  }

  Theme.PRESETS.forEach((preset) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "accent-swatch";
    swatch.dataset.hex = preset.hex;
    swatch.style.background = preset.hex;
    swatch.title = preset.name;
    swatch.setAttribute("aria-label", preset.name);
    swatch.addEventListener("click", () => {
      Theme.set(preset.hex);
      refreshAccentUI();
    });
    $("accentSwatches").appendChild(swatch);
  });

  $("accentPicker").addEventListener("input", (event) => {
    Theme.set(event.target.value);
    refreshAccentUI();
  });

  $("accentReset").addEventListener("click", () => {
    Theme.reset();
    refreshAccentUI();
  });

  /* ---------- Soft button sounds switch ---------- */

  $("optUiSound").addEventListener("change", (event) => UiSound.setEnabled(event.target.checked));

  /* ---------- Backup: export and import ---------- */

  let importTimer = null;

  function disarmImport() {
    clearTimeout(importTimer);
    importTimer = null;
    $("importBtn").textContent = "Import backup";
    $("importBtn").classList.remove("armed");
  }

  $("exportBtn").addEventListener("click", () => {
    const count = downloadBackup();
    $("backupStatus").textContent = `Saved ${count} item${count === 1 ? "" : "s"} to a backup file in your downloads.`;
  });

  $("importBtn").addEventListener("click", () => {
    if (!importTimer) {
      $("importBtn").textContent = "This replaces everything. Click again";
      $("importBtn").classList.add("armed");
      importTimer = setTimeout(disarmImport, 4000);
      return;
    }
    disarmImport();
    $("importFile").click();
  });

  $("importFile").addEventListener("change", async () => {
    const file = $("importFile").files[0];
    $("importFile").value = "";
    if (!file) return;
    try {
      const count = await restoreBackup(file);
      $("backupStatus").textContent = `Restored ${count} item${count === 1 ? "" : "s"}. Reloading...`;
      setTimeout(() => location.reload(), 700);
    } catch (err) {
      $("backupStatus").textContent = err.message;
    }
  });

  /* ---------- Dialogs: close buttons and clicking outside ---------- */

  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => $(button.dataset.close).close());
  });

  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  /* ---------- Start ---------- */

  updateHeader();
  setInterval(updateHeader, 1000);
  applyNotesBg();
  selectDay(todayKey());
})();
