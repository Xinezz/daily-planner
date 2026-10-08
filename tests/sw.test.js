// Run with: node tests/sw.test.js
// Runs sw.js against a small pretend browser (caches + fetch) to check install, update and offline behavior.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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

function makeBrowser({ online = true, files = {} } = {}) {
  const handlers = {};
  const stores = new Map();
  const state = { online, fetched: [], skipWaiting: 0, claimed: 0 };

  const makeResponse = (body, ok = true) => ({ ok, body, clone() { return makeResponse(body, ok); } });

  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      const normalise = (req, ignoreSearch) => {
        const url = new URL(typeof req === "string" ? req : req.url, "https://site.test/daily-planner/");
        return ignoreSearch ? url.origin + url.pathname : url.href;
      };
      return {
        async addAll(list) {
          for (const item of list) {
            const response = await fakeFetch(item);
            if (!response.ok) throw new Error(`could not cache ${item}`);
            store.set(normalise(item), response);
          }
        },
        async put(request, response) { store.set(normalise(request), response); },
        async match(request, options = {}) {
          const wanted = normalise(request, options.ignoreSearch);
          for (const [key, value] of store) {
            if ((options.ignoreSearch ? key.split("?")[0] : key) === wanted) return value;
          }
          return undefined;
        },
        async keys() { return [...store.keys()]; },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match(request, options = {}) {
      for (const name of stores.keys()) {
        const found = await (await caches.open(name)).match(request, options);
        if (found) return found;
      }
      return undefined;
    },
  };

  async function fakeFetch(request) {
    const url = new URL(typeof request === "string" ? request : request.url, "https://site.test/daily-planner/");
    state.fetched.push(url.pathname);
    if (!state.online) throw new TypeError("offline");
    const key = url.pathname.replace("/daily-planner/", "") || "./";
    if (key in files) return makeResponse(files[key]);
    return makeResponse("missing", false);
  }

  const self = {
    location: { origin: "https://site.test" },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: () => { state.skipWaiting++; return Promise.resolve(); },
    clients: { claim: () => { state.claimed++; return Promise.resolve(); } },
  };

  const source = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  vm.runInNewContext(source, { self, caches, fetch: fakeFetch, URL, Promise });

  const dispatch = async (type, extra = {}) => {
    let promise;
    const event = { waitUntil: (p) => { promise = p; }, respondWith: (p) => { promise = p; }, ...extra };
    handlers[type](event);
    return promise;
  };

  return { state, caches, dispatch, makeResponse };
}

const siteFiles = () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  const list = [...source.slice(source.indexOf("const FILES"), source.indexOf("];")).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  return Object.fromEntries(list.map((file) => [file, `content of ${file}`]));
};

const CACHE = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8").match(/CACHE_NAME = "([^"]+)"/)[1];

const request = (url, method = "GET") => ({ url: new URL(url, "https://site.test/daily-planner/").href, method });

(async () => {
  await test("install saves every site file and activates straight away", async () => {
    const browser = makeBrowser({ files: siteFiles() });
    await browser.dispatch("install");
    const cache = await browser.caches.open(CACHE);
    const saved = await cache.keys();
    assert.equal(saved.length, Object.keys(siteFiles()).length);
    assert.equal(browser.state.skipWaiting, 1);
  });

  await test("install fails loudly if any listed file is missing, instead of half-caching", async () => {
    const files = siteFiles();
    delete files["css/base.css"];
    const browser = makeBrowser({ files });
    await assert.rejects(browser.dispatch("install"), /could not cache/);
  });

  await test("activate removes old caches and takes control", async () => {
    const browser = makeBrowser({ files: siteFiles() });
    await browser.caches.open("daily-planner-v0");
    await browser.dispatch("install");
    await browser.dispatch("activate");
    assert.deepEqual(await browser.caches.keys(), [CACHE]);
    assert.equal(browser.state.claimed, 1);
  });

  await test("online: the newest copy is served and kept for later", async () => {
    const files = { ...siteFiles(), "index.html": "NEW VERSION" };
    const browser = makeBrowser({ files });
    const response = await browser.dispatch("fetch", { request: request("index.html") });
    assert.equal(response.body, "NEW VERSION");
    const cache = await browser.caches.open(CACHE);
    assert.equal((await cache.match(request("index.html"))).body, "NEW VERSION");
  });

  await test("offline: the saved copy is served, including pages with a ?query", async () => {
    const browser = makeBrowser({ files: siteFiles() });
    await browser.dispatch("install");
    browser.state.online = false;
    const page = await browser.dispatch("fetch", { request: request("museum.html?wing=projects") });
    assert.equal(page.body, "content of museum.html");
    const script = await browser.dispatch("fetch", { request: request("js/planner.js") });
    assert.equal(script.body, "content of js/planner.js");
  });

  await test("offline: an unknown page falls back to the planner", async () => {
    const browser = makeBrowser({ files: siteFiles() });
    await browser.dispatch("install");
    browser.state.online = false;
    const response = await browser.dispatch("fetch", { request: request("somewhere-new.html") });
    assert.equal(response.body, "content of index.html");
  });

  await test("it ignores saves (POST) and other websites", async () => {
    const browser = makeBrowser({ files: siteFiles() });
    const ignored = [request("index.html", "POST"), { url: "https://other.example/x.js", method: "GET" }];
    for (const req of ignored) {
      let responded = false;
      await browser.dispatch("fetch", { request: req, respondWith: () => { responded = true; } });
      assert.equal(responded, false, `should have left ${req.method} ${req.url} alone`);
    }
    assert.equal(browser.state.fetched.length, 0);
  });

  console.log(`\n${passed} passed`);
})();
