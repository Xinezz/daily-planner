/* spotify-core.js - Spotify sign-in (PKCE) helpers and reading the player state, with no page code,
   so they can be tested. Used by spotify.js on the Focus Mode page. */

(function (root) {
  const SCOPES = ["user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing"];
  const VERIFIER_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

  function base64url(bytes) {
    let text = "";
    bytes.forEach((b) => { text += String.fromCharCode(b); });
    return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function randomVerifier(length = 64) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => VERIFIER_CHARS[b % VERIFIER_CHARS.length]).join("");
  }

  async function challengeFor(verifier) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return base64url(new Uint8Array(digest));
  }

  function authUrl({ clientId, redirectUri, challenge, state }) {
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      code_challenge_method: "S256",
      code_challenge: challenge,
      scope: SCOPES.join(" "),
      state,
    });
    return `https://accounts.spotify.com/authorize?${params}`;
  }

  /** The address Spotify sends you back to: this site's focus.html, with nothing after it. */
  function redirectUriFor(pageUrl) {
    const url = new URL("focus.html", pageUrl);
    return `${url.origin}${url.pathname}`;
  }

  function pickArt(images) {
    if (!Array.isArray(images) || images.length === 0) return "";
    const sorted = images.slice().sort((a, b) => (a.width || 0) - (b.width || 0));
    const medium = sorted.find((img) => (img.width || 0) >= 250);
    return (medium || sorted[sorted.length - 1]).url || "";
  }

  /** Turns Spotify's /me/player answer into what the turntable needs, or null when nothing is loaded. */
  function parsePlayer(json) {
    if (!json || !json.item) return null;
    const item = json.item;
    const episode = item.type === "episode";
    return {
      id: item.id || item.uri || item.name,
      title: item.name || "Unknown",
      artists: episode
        ? (item.show && item.show.name) || ""
        : (item.artists || []).map((a) => a.name).join(", "),
      art: pickArt(episode ? item.images || (item.show && item.show.images) : item.album && item.album.images),
      isPlaying: !!json.is_playing,
      progress: json.progress_ms || 0,
      duration: item.duration_ms || 0,
      device: (json.device && json.device.name) || "",
    };
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.floor((ms || 0) / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  }

  /** A plain-language message for a failed Spotify request. */
  function explain(status, reason) {
    if (status === 403 && /PREMIUM/i.test(reason || "")) {
      return "Pausing and skipping from here needs Spotify Premium. You can still see what's playing.";
    }
    if (status === 403) return "Spotify didn't allow that. Check that your account is added under User Management in your Spotify app.";
    if (status === 404) return "No active Spotify device. Open Spotify on your phone or computer and start a song first.";
    if (status === 429) return "Spotify asked us to slow down. It will catch up in a moment.";
    if (status === 401) return "Your Spotify connection expired. Please connect again.";
    if (status === 0) return "Couldn't reach Spotify. Check your internet connection.";
    return `Spotify had a problem (${status}). Try again in a moment.`;
  }

  const api = { SCOPES, base64url, randomVerifier, challengeFor, authUrl, redirectUriFor, parsePlayer, formatTime, explain };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SpotifyCore = api;
})(typeof window !== "undefined" ? window : globalThis);
