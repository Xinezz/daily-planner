// Run with: node tests/spotify.test.js
const assert = require("node:assert/strict");
const core = require("../js/spotify-core.js");

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}\n     ${err.stack || err.message}`);
    process.exitCode = 1;
  }
}

(async () => {
  await test("PKCE challenge matches the official example (RFC 7636)", async () => {
    const challenge = await core.challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    assert.equal(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  await test("random verifiers are long, URL-safe and different each time", () => {
    const a = core.randomVerifier();
    const b = core.randomVerifier();
    assert.equal(a.length, 64);
    assert.match(a, /^[A-Za-z0-9\-._~]+$/);
    assert.notEqual(a, b);
  });

  await test("the sign-in link asks for exactly the player permissions", () => {
    const url = new URL(core.authUrl({ clientId: "abc", redirectUri: "https://xinezz.github.io/x/focus.html", challenge: "ch", state: "st" }));
    assert.equal(url.origin + url.pathname, "https://accounts.spotify.com/authorize");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("redirect_uri"), "https://xinezz.github.io/x/focus.html");
    assert.deepEqual(url.searchParams.get("scope").split(" ").sort(), core.SCOPES.slice().sort());
    assert.equal(url.searchParams.get("state"), "st");
  });

  await test("the return address is focus.html with no extras, from any page or query", () => {
    assert.equal(core.redirectUriFor("https://xinezz.github.io/zy57ugm2zvp4wg/focus.html?code=1&state=2"), "https://xinezz.github.io/zy57ugm2zvp4wg/focus.html");
    assert.equal(core.redirectUriFor("http://127.0.0.1:5173/focus.html#x"), "http://127.0.0.1:5173/focus.html");
  });

  await test("reads a playing song: title, artists, medium album art, timing", () => {
    const state = core.parsePlayer({
      is_playing: true,
      progress_ms: 61000,
      device: { name: "Phone" },
      item: {
        type: "track", id: "t1", name: "Lofi Study", duration_ms: 180000,
        artists: [{ name: "A" }, { name: "B" }],
        album: { images: [{ url: "big", width: 640 }, { url: "mid", width: 300 }, { url: "small", width: 64 }] },
      },
    });
    assert.deepEqual(state, { id: "t1", title: "Lofi Study", artists: "A, B", art: "mid", isPlaying: true, progress: 61000, duration: 180000, device: "Phone" });
  });

  await test("reads podcasts, paused songs and 'nothing playing'", () => {
    const pod = core.parsePlayer({ is_playing: false, item: { type: "episode", name: "Ep 1", duration_ms: 5, show: { name: "Show", images: [{ url: "s", width: 300 }] } } });
    assert.equal(pod.artists, "Show");
    assert.equal(pod.art, "s");
    assert.equal(pod.isPlaying, false);
    assert.equal(core.parsePlayer(null), null);
    assert.equal(core.parsePlayer({ is_playing: false, item: null }), null);
  });

  await test("times and error messages are friendly", () => {
    assert.equal(core.formatTime(0), "0:00");
    assert.equal(core.formatTime(61000), "1:01");
    assert.equal(core.formatTime(3599000), "59:59");
    assert.match(core.explain(403, "PREMIUM_REQUIRED"), /Premium/);
    assert.match(core.explain(404, "NO_ACTIVE_DEVICE"), /Open Spotify/);
    assert.match(core.explain(0), /internet/);
  });

  console.log(`\n${passed} passed`);
})();
