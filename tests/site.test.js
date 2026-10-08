// Run with: node tests/site.test.js
// Checks that the site's files, links, element ids, manifest and offline file list all agree.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}\n     ${err.message}`);
    process.exitCode = 1;
  }
}

const pages = {
  "index.html": ["js/planner.js", "js/shared.js", "js/theme.js", "js/sync.js"],
  "focus.html": ["js/focus.js", "js/shared.js", "js/theme.js", "js/sync.js"],
  "museum.html": ["js/museum.js", "js/shared.js", "js/theme.js", "js/sync.js"],
  "gallery.html": ["js/theme.js", "js/sync.js"],
};

const withoutQuery = (url) => url.split("?")[0].split("#")[0];

test("every page links only to files that exist", () => {
  for (const page of Object.keys(pages)) {
    const html = read(page);
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const url = m[1];
      if (/^(https?:|mailto:|#|data:)/.test(url)) continue;
      assert.ok(exists(withoutQuery(url)), `${page} links to missing file ${url}`);
    }
  }
});

test("every page loads its own scripts and the theme script", () => {
  for (const [page, scripts] of Object.entries(pages)) {
    const html = read(page);
    scripts.forEach((script) => assert.ok(html.includes(`src="${script}"`), `${page} does not load ${script}`));
  }
});

test("scripts only look up element ids that exist in their page", () => {
  const checks = { "index.html": "js/planner.js", "focus.html": "js/focus.js", "museum.html": "js/museum.js" };
  for (const [page, script] of Object.entries(checks)) {
    const ids = new Set([...read(page).matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    const code = read(script);
    const used = new Set([
      ...[...code.matchAll(/\$\("([A-Za-z0-9_-]+)"\)/g)].map((m) => m[1]),
      ...[...code.matchAll(/getElementById\("([A-Za-z0-9_-]+)"\)/g)].map((m) => m[1]),
    ]);
    const missing = [...used].filter((id) => !ids.has(id));
    assert.deepEqual(missing, [], `${script} uses ids missing from ${page}`);
  }
});

test("stylesheet image and font urls exist", () => {
  for (const css of fs.readdirSync(path.join(root, "css"))) {
    const text = read(`css/${css}`);
    for (const m of text.matchAll(/url\("([^"]+)"\)/g)) {
      const target = path.normalize(path.join("css", withoutQuery(m[1])));
      assert.ok(exists(target), `css/${css} uses missing file ${m[1]}`);
    }
  }
});

test("the manifest is valid and its icons exist", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.name && manifest.short_name);
  assert.ok(exists(manifest.start_url));
  const sizes = manifest.icons.map((icon) => icon.sizes);
  assert.ok(sizes.includes("192x192") && sizes.includes("512x512"));
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
  manifest.icons.forEach((icon) => assert.ok(exists(icon.src), `missing icon ${icon.src}`));
});

test("every page declares the manifest and a phone viewport", () => {
  for (const page of Object.keys(pages)) {
    const html = read(page);
    assert.ok(html.includes('rel="manifest"'), `${page} has no manifest link`);
    assert.ok(html.includes("viewport-fit=cover"), `${page} has no phone viewport`);
    assert.ok(html.includes('rel="apple-touch-icon"'), `${page} has no apple-touch-icon`);
  }
});

test("the offline file list exists and covers every page, script, style and image the site uses", () => {
  const source = read("sw.js");
  const listed = [...source.slice(source.indexOf("const FILES"), source.indexOf("];")).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  listed.filter((file) => file !== "./").forEach((file) => assert.ok(exists(file), `sw.js lists missing file ${file}`));

  const needed = new Set();
  for (const page of Object.keys(pages)) {
    needed.add(page);
    for (const m of read(page).matchAll(/(?:src|href)="([^"]+)"/g)) {
      const url = withoutQuery(m[1]);
      if (!/^(https?:|mailto:|#|data:)/.test(url) && !url.endsWith("sw.js") && !url.endsWith(".html")) needed.add(url);
    }
  }
  for (const css of fs.readdirSync(path.join(root, "css"))) {
    needed.add(`css/${css}`);
    for (const m of read(`css/${css}`).matchAll(/url\("\.\.\/([^"]+)"\)/g)) needed.add(m[1]);
  }
  for (const file of needed) {
    if (file === "assets/picture-frame-src.png") continue;
    assert.ok(listed.includes(file), `sw.js does not cache ${file}`);
  }
});

test("every page asks search engines not to list it", () => {
  for (const page of Object.keys(pages)) {
    assert.ok(/<meta name="robots" content="[^"]*noindex/.test(read(page)), `${page} can be indexed`);
  }
});

test("a service worker is registered for http(s) only", () => {
  const shared = read("js/shared.js");
  assert.ok(shared.includes('register("sw.js")'));
  assert.ok(shared.includes("https?:"));
});

console.log(`\n${passed} passed`);
