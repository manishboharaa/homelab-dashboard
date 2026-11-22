"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { normalizeTheme, nextTheme } = require("../public/js/theme.js");

assert.equal(normalizeTheme(null), "dark");
assert.equal(normalizeTheme(undefined), "dark");
assert.equal(normalizeTheme("light"), "light");
assert.equal(normalizeTheme("dark"), "dark");
assert.equal(normalizeTheme("garbage"), "dark");
assert.equal(nextTheme("dark"), "light");
assert.equal(nextTheme("light"), "dark");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
const scriptAt = html.indexOf('<script src="/js/theme.js"></script>');
const cssAt = html.indexOf('<link rel="stylesheet" href="/css/style.css">');
assert.ok(scriptAt !== -1, "theme.js must be loaded");
assert.ok(cssAt !== -1, "stylesheet link must exist");
assert.ok(scriptAt < cssAt, "theme.js must run before CSS paints");
assert.ok(html.includes('id="themeBtn"'), "top-bar toggle must exist");

console.log("theme tests passed");
