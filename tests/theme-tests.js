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

const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "style.css"), "utf8");
const lightAt = css.indexOf('[data-theme="light"]');
assert.ok(lightAt !== -1, "light theme block must exist");
const lightBlock = css.slice(lightAt);
assert.ok(lightBlock.includes("#F1ECE3"), "linen surface");
assert.ok(lightBlock.includes("#14213D"), "navy text");
assert.ok(lightBlock.includes("#FFB020"), "amber accent");
assert.ok(!css.includes("color: var(--onyx)"), "no hardcoded onyx text");
assert.ok(css.includes("--on-accent"), "on-accent token must exist");
assert.ok(lightBlock.includes("--on-accent: #14213D"), "light on-accent");
assert.ok(lightBlock.includes("--accent-fill: #FFB020"), "amber fills");

const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
assert.ok(readme.includes("top bar"), "README must mention the theme toggle");

console.log("theme tests passed");
