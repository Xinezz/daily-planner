/* spotify.js - the record-player music widget in Focus Mode.
   Needs spotify-config.js and spotify-core.js loaded first. Signs in with Spotify (PKCE, no server),
   shows what is playing on any of your Spotify devices, and controls it (control needs Premium). */

(() => {
  "use strict";

  const KEYS = { auth: "spotifyAuth", verifier: "spotifyVerifier", state: "spotifyState", open: "spotifyPanelOpen" };
  const TOKEN_URL = "https://accounts.spotify.com/api/token";
  const API = "https://api.spotify.com/v1";
  const POLL_OPEN_MS = 4000;
  const POLL_CLOSED_MS = 15000;

  const clientId = typeof SPOTIFY_CLIENT_ID !== "undefined" ? (SPOTIFY_CLIENT_ID || "").trim() : "";
  const redirectUri = SpotifyCore.redirectUriFor(location.href);
  const $ = (id) => document.getElementById(id);
  const player = $("spotifyPlayer");
  const toggle = $("spotifyToggle");
  if (!player || !toggle) return;
  const home = player.parentNode;

  let auth = readJson(KEYS.auth);
  let track = null;
  let polledAt = 0;
  let pollTimer = null;
  let pipWindow = null;
  let message = "";

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }

  function saveAuth() {
    try {
      if (auth) localStorage.setItem(KEYS.auth, JSON.stringify(auth));
      else localStorage.removeItem(KEYS.auth);
    } catch {}
  }

  const isOpen = () => !player.hidden || !!pipWindow;

  /* ---------- drawing ---------- */

  const ICONS = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
  };

  function currentProgress() {
    if (!track) return 0;
    const extra = track.isPlaying ? Date.now() - polledAt : 0;
    return Math.min(track.duration, track.progress + extra);
  }

  function drawProgress() {
    const done = currentProgress();
    $("spProgress").style.width = track && track.duration ? `${(done / track.duration) * 100}%` : "0%";
    $("spElapsed").textContent = SpotifyCore.formatTime(done);
    $("spDuration").textContent = SpotifyCore.formatTime(track ? track.duration : 0);
  }

  function render() {
    const playing = !!(track && track.isPlaying);
    player.classList.toggle("is-unconfigured", !clientId);
    player.classList.toggle("is-connected", !!auth);
    player.classList.toggle("has-track", !!track);
    player.classList.toggle("is-playing", playing);
    toggle.classList.toggle("is-playing", playing);

    let song = "Nothing playing";
    let artist = "Start a song in Spotify on any device.";
    if (!clientId) {
      song = "Music player not set up";
      artist = "Add your Spotify app's Client ID to switch it on.";
    } else if (!auth) {
      song = "Spotify not connected";
      artist = "Connect to see and control your music here.";
    } else if (track) {
      song = track.title;
      artist = track.artists + (track.device ? ` · on ${track.device}` : "");
    }
    $("spSong").textContent = song;
    $("spSong").title = song;
    $("spArtist").textContent = artist;

    const art = $("spArt");
    if (track && track.art) {
      if (art.getAttribute("src") !== track.art) art.src = track.art;
      art.hidden = false;
      art.alt = `${track.title} cover`;
    } else {
      art.hidden = true;
      art.removeAttribute("src");
    }
    $("spRecord").classList.toggle("has-art", !!(track && track.art));

    $("spPlay").innerHTML = playing ? ICONS.pause : ICONS.play;
    $("spPlay").setAttribute("aria-label", playing ? "Pause" : "Play");
    ["spPrev", "spPlay", "spNext"].forEach((id) => { $(id).disabled = !auth; });

    $("spConnectRow").hidden = !clientId || !!auth;
    $("spDisconnect").hidden = !auth;
    $("spotifyPopOut").hidden = !("documentPictureInPicture" in window) || !!pipWindow;
    $("spMessage").textContent = message;
    $("spMessage").hidden = !message;
    toggle.setAttribute("aria-label", playing ? `Music player: playing ${track.title}` : "Open music player");
    drawProgress();
  }

  function say(text) {
    message = text || "";
    render();
  }

  /* ---------- Spotify sign-in ---------- */

  async function connect() {
    if (!clientId) return;
    if (document.body.classList.contains("running")) {
      say("Pause the timer first: connecting briefly leaves this page.");
      return;
    }
    const verifier = SpotifyCore.randomVerifier();
    const state = SpotifyCore.randomVerifier(16);
    sessionStorage.setItem(KEYS.verifier, verifier);
    sessionStorage.setItem(KEYS.state, state);
    const challenge = await SpotifyCore.challengeFor(verifier);
    location.href = SpotifyCore.authUrl({ clientId, redirectUri, challenge, state });
  }

  async function tokenRequest(fields) {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, ...fields }),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, body };
  }

  function storeTokens(body, previousRefresh) {
    auth = {
      access: body.access_token,
      refresh: body.refresh_token || previousRefresh,
      expires: Date.now() + Math.max(60, (body.expires_in || 3600) - 60) * 1000,
    };
    saveAuth();
  }

  /** Finishes sign-in when Spotify sends you back with ?code=... */
  async function finishSignIn() {
    const params = new URLSearchParams(location.search);
    if (!params.has("code") && !params.has("error")) return;
    history.replaceState(null, "", redirectUri);

    const expectedState = sessionStorage.getItem(KEYS.state);
    const verifier = sessionStorage.getItem(KEYS.verifier);
    sessionStorage.removeItem(KEYS.state);
    sessionStorage.removeItem(KEYS.verifier);
    openPanel();

    if (params.has("error")) {
      say(params.get("error") === "access_denied" ? "Spotify connection was cancelled." : `Spotify said: ${params.get("error")}`);
      return;
    }
    if (!verifier || params.get("state") !== expectedState) {
      say("That Spotify sign-in didn't match this page. Please press Connect again.");
      return;
    }
    try {
      const { ok, body } = await tokenRequest({
        grant_type: "authorization_code",
        code: params.get("code"),
        redirect_uri: redirectUri,
        code_verifier: verifier,
      });
      if (!ok) {
        say(`Couldn't connect Spotify: ${body.error_description || body.error || "unknown error"}.`);
        return;
      }
      storeTokens(body);
      say("");
    } catch {
      say(SpotifyCore.explain(0));
    }
  }

  async function accessToken() {
    if (!auth) return null;
    if (Date.now() < auth.expires) return auth.access;
    try {
      const { ok, body } = await tokenRequest({ grant_type: "refresh_token", refresh_token: auth.refresh });
      if (!ok) {
        auth = null;
        saveAuth();
        track = null;
        say(SpotifyCore.explain(401));
        return null;
      }
      storeTokens(body, auth.refresh);
      return auth.access;
    } catch {
      return null;
    }
  }

  async function call(method, path, retried = false) {
    const token = await accessToken();
    if (!token) return { status: auth ? 0 : 401 };
    let res;
    try {
      res = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
    } catch {
      return { status: 0 };
    }
    if (res.status === 401 && !retried) {
      auth.expires = 0;
      return call(method, path, true);
    }
    let body = null;
    if (res.status !== 204) body = await res.json().catch(() => null);
    return { status: res.status, body };
  }

  /* ---------- reading and controlling playback ---------- */

  async function poll() {
    clearTimeout(pollTimer);
    if (auth && !document.hidden) {
      const res = await call("GET", "/me/player?additional_types=episode");
      if (res.status === 200) {
        track = SpotifyCore.parsePlayer(res.body);
        polledAt = Date.now();
        if (message && /active Spotify device|internet|slow down/.test(message)) message = "";
      } else if (res.status === 204) {
        track = null;
      } else if (res.status && res.status !== 200) {
        message = SpotifyCore.explain(res.status, res.body && res.body.error && res.body.error.reason);
      }
      render();
    }
    if (auth) pollTimer = setTimeout(poll, isOpen() ? POLL_OPEN_MS : POLL_CLOSED_MS);
  }

  const ACTIONS = {
    play: ["PUT", "/me/player/play"],
    pause: ["PUT", "/me/player/pause"],
    next: ["POST", "/me/player/next"],
    previous: ["POST", "/me/player/previous"],
  };

  async function control(action) {
    if (!auth) return;
    const before = track ? { ...track } : null;
    if (track && (action === "play" || action === "pause")) {
      track.progress = currentProgress();
      polledAt = Date.now();
      track.isPlaying = action === "play";
      render();
    }
    const [method, path] = ACTIONS[action];
    const res = await call(method, path);
    if (res.status >= 400 || res.status === 0) {
      track = before;
      say(SpotifyCore.explain(res.status, res.body && res.body.error && res.body.error.reason));
    } else {
      message = "";
    }
    setTimeout(poll, 450);
  }

  /* ---------- opening, closing and popping out ---------- */

  function openPanel() {
    player.hidden = false;
    restorePosition();
    toggle.setAttribute("aria-expanded", "true");
    try { localStorage.setItem(KEYS.open, "1"); } catch {}
    render();
    poll();
  }

  function closePanel() {
    if (pipWindow) {
      pipWindow.close();
      return;
    }
    player.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    try { localStorage.removeItem(KEYS.open); } catch {}
  }

  async function popOut() {
    if (!("documentPictureInPicture" in window) || pipWindow) return;
    try {
      pipWindow = await window.documentPictureInPicture.requestWindow({ width: 320, height: 470 });
    } catch {
      return;
    }
    const doc = pipWindow.document;
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
      const copy = doc.importNode(node, true);
      if (copy.tagName === "LINK") copy.href = node.href;
      doc.head.appendChild(copy);
    });
    doc.documentElement.setAttribute("style", document.documentElement.getAttribute("style") || "");
    doc.title = "Now playing";
    doc.body.className = "pip-body";
    player.hidden = false;
    player.classList.add("in-pip");
    doc.body.appendChild(player);
    toggle.hidden = true;
    render();

    pipWindow.addEventListener("pagehide", () => {
      player.classList.remove("in-pip");
      home.appendChild(player);
      pipWindow = null;
      toggle.hidden = false;
      render();
    });
  }

  /* ---------- dragging the player by its "Now playing" bar ---------- */

  const POS_KEY = "spotifyPanelPos";
  const canDrag = () => !pipWindow && window.innerWidth > 480;

  function placeAt(x, y) {
    const maxX = window.innerWidth - player.offsetWidth - 8;
    const maxY = window.innerHeight - player.offsetHeight - 8;
    const left = Math.max(8, Math.min(maxX, x));
    const top = Math.max(8, Math.min(maxY, y));
    player.style.left = `${left}px`;
    player.style.top = `${top}px`;
    player.style.bottom = "auto";
    return { x: left, y: top };
  }

  function restorePosition() {
    const saved = readJson(POS_KEY);
    if (saved && canDrag()) placeAt(saved.x, saved.y);
    else ["left", "top", "bottom"].forEach((side) => player.style.removeProperty(side));
  }

  const head = player.querySelector(".sp-head");
  head.addEventListener("pointerdown", (event) => {
    if (!canDrag() || event.button !== 0 || event.target.closest("button")) return;
    const box = player.getBoundingClientRect();
    const dx = event.clientX - box.left;
    const dy = event.clientY - box.top;
    head.setPointerCapture(event.pointerId);
    player.classList.add("is-dragging");
    const move = (e) => placeAt(e.clientX - dx, e.clientY - dy);
    const stop = (e) => {
      head.removeEventListener("pointermove", move);
      head.removeEventListener("pointerup", stop);
      head.removeEventListener("pointercancel", stop);
      player.classList.remove("is-dragging");
      const spot = placeAt(e.clientX - dx, e.clientY - dy);
      try { localStorage.setItem(POS_KEY, JSON.stringify(spot)); } catch {}
    };
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", stop);
    head.addEventListener("pointercancel", stop);
  });

  head.addEventListener("dblclick", (event) => {
    if (event.target.closest("button")) return;
    try { localStorage.removeItem(POS_KEY); } catch {}
    restorePosition();
  });

  window.addEventListener("resize", () => { if (!player.hidden) restorePosition(); });

  toggle.addEventListener("click", () => (player.hidden ? openPanel() : closePanel()));
  $("spotifyClose").addEventListener("click", closePanel);
  $("spotifyPopOut").addEventListener("click", popOut);
  $("spConnect").addEventListener("click", connect);
  $("spDisconnect").addEventListener("click", () => {
    auth = null;
    track = null;
    saveAuth();
    say("Disconnected from Spotify.");
  });
  $("spPlay").addEventListener("click", () => control(track && track.isPlaying ? "pause" : "play"));
  $("spPrev").addEventListener("click", () => control("previous"));
  $("spNext").addEventListener("click", () => control("next"));

  document.addEventListener("visibilitychange", () => { if (!document.hidden && auth) poll(); });
  setInterval(() => { if (track && track.isPlaying && isOpen()) drawProgress(); }, 500);

  /* ---------- start ---------- */

  (async () => {
    await finishSignIn();
    if (localStorage.getItem(KEYS.open) === "1") {
      player.hidden = false;
      restorePosition();
    }
    toggle.setAttribute("aria-expanded", String(!player.hidden));
    render();
    poll();
  })();
})();
