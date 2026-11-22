"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "style.css"), "utf8");

// Default-size tiles put .service-ping and .service-uptime side by side.
// They must share a baseline; wide/tall tiles keep their own stretch layout.
const moreRule = css.match(/^\.service-more \{[^}]*\}/m);
assert.ok(moreRule, "default .service-more rule must exist");
assert.ok(moreRule[0].includes("align-items: baseline"), "default status row aligns on baseline");

// The stale unscoped .service-ping copy added a 2px top margin and a bigger
// font, which pushed the ping text out of line with the uptime text.
const unscopedPingRules = css.match(/^\.service-ping \{/gm) || [];
assert.equal(unscopedPingRules.length, 1, "only one unscoped .service-ping rule");
assert.ok(!unscopedPingRules.length || !/^\.service-ping \{[^}]*margin-top/m.test(css), "unscoped ping has no top margin");

// Wide tiles keep the old ping typography via an explicit scoped rule.
assert.ok(css.includes(".service-tile.service-wide .service-ping"), "wide tiles keep their ping styling");
assert.ok(/\.service-tile\.service-wide \.service-ping \{[^}]*font-size: 10\.5px[^}]*margin-top: 2px/m.test(css), "wide ping styling preserved");

console.log("tile layout tests passed");
