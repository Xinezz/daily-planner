/* loader.js - game-style loading screen with a progress bar.
   Loaded in the <head>; the screen itself is the #loader element at the top of each page's <body>.
   It follows real progress (pictures and the font), hides once the page has loaded, and shows again
   straight away when you follow a link, so page changes never look frozen. */

const PageLoader = (() => {
  const MIN_VISIBLE_MS = 350;
  const SAFETY_MS = 8000;
  const startedAt = Date.now();

  let screen = null;
  let fill = null;
  let percent = null;
  let progress = 0;
  let finished = false;
  let trickle = null;

  function render() {
    if (!fill) return;
    fill.style.width = `${Math.round(progress * 100)}%`;
    percent.textContent = `${Math.round(progress * 100)}%`;
    screen.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
  }

  function advance(value) {
    progress = Math.max(progress, Math.min(1, value));
    render();
  }

  /** Creeps slowly toward a ceiling so the bar never looks stuck while something big loads. */
  function startTrickle(ceiling) {
    clearInterval(trickle);
    trickle = setInterval(() => {
      if (progress < ceiling) advance(progress + (ceiling - progress) * 0.08);
    }, 120);
  }

  function hide() {
    if (!screen) return;
    screen.classList.add("loader-hide");
    setTimeout(() => {
      if (screen.classList.contains("loader-hide")) screen.hidden = true;
    }, 450);
  }

  function finish() {
    if (finished) return;
    finished = true;
    clearInterval(trickle);
    advance(1);
    const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - startedAt));
    setTimeout(hide, wait + 120);
  }

  function track() {
    screen = document.getElementById("loader");
    if (!screen) return;
    fill = screen.querySelector(".loader-fill");
    percent = screen.querySelector(".loader-pct");

    const waits = [...document.images].map((img) =>
      img.complete ? Promise.resolve() : new Promise((resolve) => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      })
    );
    if (document.fonts && document.fonts.ready) waits.push(document.fonts.ready);

    const total = waits.length + 1; // +1 for the page's own load event
    let done = 0;
    advance(0.08);
    waits.forEach((wait) => wait.then(() => { done++; advance(0.08 + (done / total) * 0.82); }));
    startTrickle(0.9);
  }

  /** Shows the loading screen again while the browser goes to another page. */
  function leave() {
    if (!screen) return;
    finished = false;
    progress = 0;
    screen.hidden = false;
    screen.classList.remove("loader-hide");
    render();
    advance(0.15);
    startTrickle(0.92);
  }

  document.addEventListener("DOMContentLoaded", track);
  window.addEventListener("load", finish);
  setTimeout(finish, SAFETY_MS);

  // Coming back with the browser's Back button can restore a page that was mid-"leave"
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      finished = false;
      finish();
    }
  });

  // Plain clicks on links to our own pages show the loader. Bubble phase on window, so pages that
  // cancel a link (like Focus Mode while locked in) are respected.
  window.addEventListener("click", (event) => {
    const link = event.target.closest && event.target.closest("a[href]");
    if (!link || event.defaultPrevented) return;
    if (link.target || link.origin !== location.origin || link.hasAttribute("download")) return;
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const to = new URL(link.href);
    if (to.pathname === location.pathname && to.search === location.search) return;
    leave();
  });

  return { leave, finish };
})();
