const results = [];
const assert = (ok, msg) => results.push({ ok: !!ok, msg });
const eq = (a, b, msg) => assert(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
function flushTimers() {
  globalThis.__timers.filter((t) => !t.cancelled).forEach((t) => t.fn());
  globalThis.__timers.length = 0;
}

globalThis.__results = results;

CONFIG = {
  services: [
    { id: "jf1", name: "Jellyfin", url: "http://10.10.8.50:8096", icon: null, category: "Media", size: "lg", docker: "", type: "jellyfin", details: true, apiKey: "k" },
    { id: "p1", name: "Plex", url: "http://10.10.8.50:32400", icon: null, category: "Media", size: "sm", docker: "", type: null, details: false, apiKey: "" },
    { id: "d1", name: "Grafana", url: "http://10.10.8.50:3000", icon: null, category: "Monitoring", size: "sm", docker: "", type: null, details: false, apiKey: "" }
  ]
};

eq(fmtUp(3 * 86400 + 4 * 3600 + 42 * 60), "3d 4h 42m", "fmtUp days/hours/min");
eq(fmtUp(4 * 3600 + 42 * 60), "4h 42m", "fmtUp hours/min");
eq(fmtUp(42 * 60), "42m", "fmtUp minutes");
eq(fmtUp(5), "just now", "fmtUp under a minute");
eq(fmtUp(null), null, "fmtUp null");

const jf = CONFIG.services[0];
serviceInfoCache.set(jf.id, {
  data: {
    source: "ping", up: true, uptimeSec: 3 * 86400 + 4 * 3600 + 42 * 60,
    jellyfin: {
      serverName: "Media-Server", version: "10.9.11", os: "Linux", arch: "x86_64",
      movies: 412, series: 67, episodes: 3400, activeSessions: 2, libraries: 3, users: 2,
      artists: 55, albums: 120, songs: 3500, genres: 42, collections: 9,
      recentPlays: { days: 14, labels: ["Aug 5", "Aug 11"], values: [3, 7], max: 7 },
      libraryTotals: [
        { name: "Movies", type: "movies", count: 412 },
        { name: "TV Shows", type: "tvshows", count: 67 },
        { name: "Music", type: "music", count: 3500 }
      ]
    }
  },
  at: Date.now(),
  level: 6
});

const tileLg = makeServiceTile(jf);
eq(tileLg.dataset.span, "3", "tile starts with span 3 for size lg");
assert(!!tileLg.querySelector(".resize-handle"), "tile has resize handle");
const moreLg = tileLg.querySelector(".service-more");
renderTileInfo(tileLg, jf, 3);
assert(moreLg.innerHTML.includes("3d 4h 42m"), "lg uptime shown");
assert(moreLg.innerHTML.includes("412"), "jellyfin movies cell");
assert(moreLg.innerHTML.includes("67"), "jellyfin series cell");
assert(moreLg.innerHTML.includes("3400"), "jellyfin episodes cell");
assert(moreLg.innerHTML.includes("Streaming"), "jellyfin streaming label");
assert(moreLg.innerHTML.includes("Users"), "jellyfin users label");
assert(!moreLg.innerHTML.includes("Libraries"), "jellyfin libraries label not in level-3 core fields");
assert(moreLg.innerHTML.includes("10.9.11"), "jellyfin version in meta");

applySpan(tileLg, jf, 1);
eq(tileLg.dataset.span, "1", "applySpan sets span 1");
assert(!tileLg.classList.contains("service-wide"), "span 1 removes service-wide");
assert(moreLg.innerHTML === "", "span 1 clears info");

applySpan(tileLg, jf, 2);
eq(tileLg.dataset.span, "2", "applySpan sets span 2");
assert(tileLg.classList.contains("service-wide"), "span 2 adds service-wide");
assert(moreLg.innerHTML.includes("3d 4h 42m"), "span 2 shows uptime");
assert(moreLg.innerHTML.includes("Media-Server"), "span 2 shows server name meta");
assert(!moreLg.innerHTML.includes("412"), "span 2 hides counts grid");

applySpan(tileLg, jf, 4);
assert(moreLg.innerHTML.includes("Libraries"), "span 4 shows libraries");
assert(moreLg.innerHTML.includes("Artists") && moreLg.innerHTML.includes("55"), "span 4 shows music artists");
assert(moreLg.innerHTML.includes("Albums") && moreLg.innerHTML.includes("120"), "span 4 shows albums");
assert(moreLg.innerHTML.includes("Songs") && moreLg.innerHTML.includes("3500"), "span 4 shows songs");
assert(moreLg.innerHTML.includes("Genres") && moreLg.innerHTML.includes("42"), "span 4 shows genres");
assert(moreLg.innerHTML.includes("Collections") && moreLg.innerHTML.includes("9"), "span 4 shows collections");
assert(!moreLg.innerHTML.includes("svc-chart"), "span 4 hides plays chart");

applySpan(tileLg, jf, 5);
assert(moreLg.innerHTML.includes("plays · last 14 days"), "span 5 shows plays chart");
assert(moreLg.innerHTML.includes("svc-bar-fill"), "span 5 renders chart bars");
assert(!moreLg.innerHTML.includes("svc-lib"), "span 5 hides library breakdown");

applySpan(tileLg, jf, 6);
assert(moreLg.innerHTML.includes("svc-lib") && moreLg.innerHTML.includes("TV Shows"), "span 6 shows library breakdown");
assert(moreLg.innerHTML.includes("Music") && moreLg.innerHTML.includes("3500"), "span 6 library totals count");
eq(tileLg.style.gridColumn, "1 / -1", "span 6 (>= mock cols 4) spans full row");
eq(tileLg.style["--tile-span"], "6", "applySpan sets --tile-span var");

eq(INFO_TIERS.meta, 2, "INFO_TIERS.meta is 2");
eq(INFO_TIERS.counts, 3, "INFO_TIERS.counts is 3");
eq(INFO_TIERS.extended, 4, "INFO_TIERS.extended is 4");
eq(INFO_TIERS.chart, 5, "INFO_TIERS.chart is 5");
eq(INFO_TIERS.libraries, 6, "INFO_TIERS.libraries is 6");

applySpan(tileLg, jf, 5);
eq(tileLg.style["--tile-span"], "5", "--tile-span tracks span changes");
applySpan(tileLg, jf, 1);
eq(tileLg.style["--tile-span"], "1", "--tile-span set even at span 1");

const jfTall = { id: "jft", name: "Jellyfin", url: "http://x", icon: null, category: "Media", size: "sm", docker: "", type: "jellyfin", details: true, apiKey: "k", rows: 4 };
serviceInfoCache.set(jfTall.id, {
  data: { source: "ping", up: true, uptimeSec: 42 * 60, jellyfin: {
    serverName: "Media-Server", version: "10.9.11", os: "Linux", arch: "x86_64",
    movies: 412, series: 67, episodes: 3400, activeSessions: 2, libraries: 3, users: 2,
    artists: 55, albums: 120, songs: 3500, genres: 42, collections: 9,
    recentPlays: { days: 14, labels: ["Aug 5"], values: [7], max: 7 },
    libraryTotals: [{ name: "Movies", type: "movies", count: 412 }]
  } },
  at: Date.now(),
  level: 6
});
const tileTall = makeServiceTile(jfTall);
eq(tileTall.dataset.span, "1", "tall tile stays narrow (span 1)");
eq(tileTall.dataset.rows, "4", "tall tile has rows 4");
renderTileInfo(tileTall, jfTall, 1);
const tallMore = tileTall.querySelector(".service-more");
assert(tallMore.innerHTML.includes("412"), "narrow tall tile (span1 rows4) shows counts");
assert(tallMore.innerHTML.includes("Artists") && tallMore.innerHTML.includes("55"), "narrow tall tile shows extended cells");
assert(!tallMore.innerHTML.includes("svc-chart"), "narrow rows4 tile stays below chart level");
applyRows(tileTall, jfTall, 6);
applySpan(tileTall, jfTall, 1);
assert(tallMore.innerHTML.includes("svc-chart"), "span1 rows6 reaches chart level");
assert(tallMore.innerHTML.includes("svc-lib"), "span1 rows6 reaches libraries level");

eq(cachedInfo(jf, 4) != null, true, "cachedInfo ok for level <= cached level");
eq(cachedInfo(jf, 7), null, "cachedInfo null for level > cached level");

const fetchBefore = fetchCalls.length;
fetchServiceInfo(CONFIG.services[1], 6);
const infoCall = fetchCalls.find((c, i) => i >= fetchBefore && /\/api\/services\/p1\/info/.test(c.url));
eq(!!infoCall && infoCall.url.endsWith("?span=6&rows=1"), true, "fetchServiceInfo sends span + rows query");

serviceInfoCache.set("d1", {
  data: { source: "docker", up: false, uptimeSec: 0, state: "exited" },
  at: Date.now()
});
const tileD = makeServiceTile(CONFIG.services[2]);
applySpan(tileD, CONFIG.services[2], 2);
assert(tileD.querySelector(".service-more").innerHTML.includes("exited"), "docker exited state shown");

serviceInfoCache.delete("d1");
serviceInfoCache.set("d1", {
  data: { source: "ping", up: false, uptimeSec: 0, state: null },
  at: Date.now()
});
const tileDown = makeServiceTile(CONFIG.services[2]);
applySpan(tileDown, CONFIG.services[2], 3);
assert(tileDown.querySelector(".service-more").innerHTML.includes("down"), "down shown on span 3");

const jfPublic = { id: "jp", name: "Jellyfin", url: "http://x", icon: null, category: "Media", size: "sm", docker: "", type: "jellyfin", details: true, apiKey: "" };
serviceInfoCache.set(jfPublic.id, {
  data: { source: "ping", up: true, uptimeSec: 10, jellyfin: { serverName: "Media-Server", version: "10.9.11", os: "Linux" } },
  at: Date.now()
});
const tileJp = makeServiceTile(jfPublic);
applySpan(tileJp, jfPublic, 3);
const jpMore = tileJp.querySelector(".service-more").innerHTML;
assert(jpMore.includes("Media-Server"), "jellyfin no-key shows server name");
assert(!jpMore.includes("Movies"), "jellyfin no-key hides counts");

serviceInfoCache.set("p1", { data: { source: "ping", up: true, uptimeSec: 42 * 60, checkedAt: Date.parse("2026-08-11T10:30:00Z") }, at: Date.now() });
const tileP = makeServiceTile(CONFIG.services[1]);
applySpan(tileP, CONFIG.services[1], 2);
eq(tileP.querySelector(".service-more").innerHTML.includes("42m"), true, "generic span 2 shows uptime");
assert(tileP.querySelector(".service-more").innerHTML.includes(">ping<"), "generic span 2 shows source cell in small expand");
assert(tileP.querySelector(".service-more").innerHTML.includes(">Checked<"), "generic span 2 shows checked cell in small expand");

applySpan(tileP, CONFIG.services[1], 3);
assert(tileP.querySelector(".service-more").innerHTML.includes("http://10.10.8.50:32400"), "generic span 3 shows url");

applyRows(tileP, CONFIG.services[1], 2);
applySpan(tileP, CONFIG.services[1], 3);
eq(tileP.querySelector(".service-more").innerHTML.includes(">Checked<"), true, "generic span3 rows2 (level 4) still shows checked");
assert(/\d{1,2}:\d{2}/.test(tileP.querySelector(".service-more").innerHTML), "generic checked shows a HH:MM time");

applyRows(tileP, CONFIG.services[1], 3);
applySpan(tileP, CONFIG.services[1], 3);
eq(tileP.querySelector(".service-more").innerHTML.includes("http://10.10.8.50:32400"), true, "generic span3 rows3 (level 5) shows url");
applyRows(tileP, CONFIG.services[1], 1);
applySpan(tileP, CONFIG.services[1], 3);

const tileSm = makeServiceTile(CONFIG.services[1]);
eq(tileSm.querySelector(".service-more").innerHTML, "", "default span 1 tile has no info");

const resizeFetchBefore = fetchCalls.length;
const handle = tileSm.querySelector(".resize-handle");
handle.dispatch("pointerdown", { clientX: 100, preventDefault() {}, stopPropagation() {}, pointerId: 1 });
handle.dispatch("pointermove", { clientX: 300, preventDefault() {}, stopPropagation() {} });
eq(tileSm.dataset.span, "2", "resize drag +200px → span 2");
assert(tileSm.classList.contains("service-wide"), "span 2 adds service-wide during drag");
handle.dispatch("pointerup", { preventDefault() {}, stopPropagation() {} });
const resizeCall = fetchCalls.find((c, i) => i >= resizeFetchBefore && c.url === "/api/services/p1" && c.opts.method === "PUT");
assert(!!resizeCall, "resize persists via PUT /api/services/:id");
eq(resizeCall && resizeCall.opts.body, JSON.stringify({ size: 2, rows: 1 }), "PUT body is {size:2,rows:1}");
eq(CONFIG.services[1].size, 2, "svc.size updated after resize");

const resizeFetchBefore2 = fetchCalls.length;
const handle2 = tileSm.querySelector(".resize-handle");
handle2.dispatch("pointerdown", { clientX: 100, preventDefault() {}, stopPropagation() {}, pointerId: 1 });
handle2.dispatch("pointermove", { clientX: 740, preventDefault() {}, stopPropagation() {} });
eq(tileSm.dataset.span, "6", "resize drag from span 2 +640px → span 6");
eq(tileSm.style.gridColumn, "1 / -1", "span >= mock cols 4 spans full row");
handle2.dispatch("pointerup", { preventDefault() {}, stopPropagation() {} });
const resizeCall2 = fetchCalls.find((c, i) => i >= resizeFetchBefore2 && c.url === "/api/services/p1" && c.opts.method === "PUT");
assert(!!resizeCall2, "resize to span 6 persists via PUT");
eq(resizeCall2 && resizeCall2.opts.body, JSON.stringify({ size: 6, rows: 1 }), "span 6 PUT body is {size:6,rows:1}");

const handle3 = tileSm.querySelector(".resize-handle");
handle3.dispatch("pointerdown", { clientX: 900, preventDefault() {}, stopPropagation() {}, pointerId: 1 });
handle3.dispatch("pointermove", { clientX: 100, preventDefault() {}, stopPropagation() {} });
eq(tileSm.dataset.span, "1", "big left drag from span 6 → span 1");
handle3.dispatch("pointercancel", { preventDefault() {}, stopPropagation() {} });
eq(CONFIG.services[1].size, 6, "pointercancel does not persist");
eq(tileSm.dataset.span, "6", "pointercancel snaps back to stored size");

const tileR = makeServiceTile(CONFIG.services[2]);
eq(tileR.dataset.rows, "1", "default rows is 1");
eq(tileR.style["--rows"], undefined, "no --rows var until applyRows/normalize");
applyRows(tileR, CONFIG.services[2], 3);
eq(tileR.dataset.rows, "3", "applyRows sets rows 3");
eq(tileR.style["--rows"], "3", "--rows var tracks rows");
assert(tileR.classList.contains("service-tall"), "rows 3 adds service-tall");
applyRows(tileR, CONFIG.services[2], 1);
assert(!tileR.classList.contains("service-tall"), "rows 1 removes service-tall");
applyRows(tileR, CONFIG.services[2], 99);
eq(tileR.dataset.rows, "8", "applyRows caps at 8");
applyRows(tileR, CONFIG.services[2], 1);

const rBefore = fetchCalls.length;
const hr = tileR.querySelector(".resize-handle");
hr.dispatch("pointerdown", { clientX: 100, clientY: 100, preventDefault() {}, stopPropagation() {}, pointerId: 9 });
hr.dispatch("pointermove", { clientX: 100, clientY: 360, preventDefault() {}, stopPropagation() {} });
eq(tileR.dataset.rows, "3", "downward drag +260px → rows 3");
eq(tileR.dataset.span, "1", "pure vertical drag keeps span 1");
assert(tileR.classList.contains("service-tall"), "vertical drag adds service-tall");
hr.dispatch("pointerup", { preventDefault() {}, stopPropagation() {} });
const rPut = fetchCalls.find((c, i) => i >= rBefore && c.url === "/api/services/d1" && c.opts.method === "PUT");
assert(!!rPut, "rows persist via PUT");
eq(rPut && rPut.opts.body, JSON.stringify({ size: 1, rows: 3 }), "PUT body {size:1,rows:3}");
eq(CONFIG.services[2].rows, 3, "svc.rows updated after resize");

const r2Before = fetchCalls.length;
hr.dispatch("pointerdown", { clientX: 100, clientY: 100, preventDefault() {}, stopPropagation() {}, pointerId: 9 });
hr.dispatch("pointermove", { clientX: 100, clientY: 300, preventDefault() {}, stopPropagation() {} });
hr.dispatch("pointermove", { clientX: 100, clientY: 180, preventDefault() {}, stopPropagation() {} });
eq(tileR.dataset.rows, "4", "from rows 3: drag +200px → 5, then up 80px → 4");
hr.dispatch("pointercancel", { preventDefault() {}, stopPropagation() {} });
eq(CONFIG.services[2].rows, 3, "pointercancel does not persist rows");
eq(tileR.dataset.rows, "3", "pointercancel snaps rows back to stored");

const jfPrev = { id: "jfp", name: "Jellyfin", url: "http://x", icon: null, category: "Media", size: "sm", docker: "", type: "jellyfin", details: true, apiKey: "k" };
serviceInfoCache.set(jfPrev.id, {
  data: { source: "ping", up: true, uptimeSec: 100, jellyfin: { serverName: "Media-Server", version: "10.9.11", os: "Linux", movies: 412, series: 67, episodes: 3400 } },
  at: Date.now(),
  level: 3
});
const tilePrev = makeServiceTile(jfPrev);

globalThis.__async = (async () => {
  const prevFetchBefore = fetchCalls.length;
  const hp = tilePrev.querySelector(".resize-handle");
  hp.dispatch("pointerdown", { clientX: 100, clientY: 100, preventDefault() {}, stopPropagation() {}, pointerId: 7 });
  hp.dispatch("pointermove", { clientX: 500, clientY: 100, preventDefault() {}, stopPropagation() {} });
  eq(tilePrev.dataset.span, "4", "preview drag reaches span 4");
  flushTimers();
  const prevFetch = fetchCalls.find((c, i) => i >= prevFetchBefore && /\/api\/services\/jfp\/info/.test(c.url));
  assert(!!prevFetch, "preview drag triggers info fetch for new level");
  eq(prevFetch && prevFetch.url, "/api/services/jfp/info?span=4&rows=1", "preview fetch targets current span+rows");
  await __macrotick();
  const prevCache = serviceInfoCache.get(jfPrev.id);
  assert(!!prevCache && (prevCache.level || 1) >= 4, "preview fetch raised cache level");
  hp.dispatch("pointerup", { preventDefault() {}, stopPropagation() {} });

  const g2 = { id: "g2", name: "Nginx", url: "http://10.10.8.50:8080", icon: null, category: "Network", size: "sm", docker: "nginx", type: null, details: false, apiKey: "" };
  serviceInfoCache.set(g2.id, { data: { source: "docker", up: false, uptimeSec: 0, state: "running", checkedAt: Date.parse("2026-08-11T11:05:00Z") }, at: Date.now(), level: 4 });
  const tileG = makeServiceTile(g2);
  const moreG = tileG.querySelector(".service-more");
  eq(moreG.innerHTML, "", "vertical preview: span1 rows1 shows no info");
  const hg = tileG.querySelector(".resize-handle");
  hg.dispatch("pointerdown", { clientX: 100, clientY: 100, preventDefault() {}, stopPropagation() {}, pointerId: 11 });
  hg.dispatch("pointermove", { clientX: 100, clientY: 364, preventDefault() {}, stopPropagation() {} });
  eq(tileG.dataset.rows, "3", "vertical preview drag rows → 3");
  eq(tileG.dataset.span, "1", "vertical preview keeps span 1");
  assert(moreG.innerHTML.includes("docker · running"), "vertical-only drag re-renders: source shown mid-drag");
  assert(moreG.innerHTML.includes(">Checked<"), "vertical-only drag re-renders: checked shown mid-drag");
  hg.dispatch("pointerup", { preventDefault() {}, stopPropagation() {} });
})();

const jfName = document.getElementById("settingsNewName");
const jfDetails = document.getElementById("settingsNewDetails");
const jfBlock = document.getElementById("settingsJellyfinAdd");
const jfApiRow = document.getElementById("settingsJellyfinApiRow");
jfName.value = "jellyfin";
jfDetails.checked = false;
updateJellyfinAddMenu();
assert(!jfBlock.classList.contains("hidden"), "add menu visible for jellyfin name");
assert(jfApiRow.classList.contains("hidden"), "api row hidden when details unchecked");
jfDetails.checked = true;
updateJellyfinAddMenu();
assert(!jfApiRow.classList.contains("hidden"), "api row visible when details checked");
jfName.value = "plex";
updateJellyfinAddMenu();
assert(jfBlock.classList.contains("hidden"), "add menu hidden for non-jellyfin");

const rowJf = makeServiceRow({ id: "r1", name: "Jellyfin", url: "http://x", icon: null, category: "Media", size: "sm", docker: "jellyfin", type: "jellyfin", details: true, apiKey: "k" });
const extraJf = rowJf.children.find((c) => c.className === "ss-row-extra");
assert(!!extraJf, "jellyfin row has extra row");
assert(extraJf.children.some((c) => c.className.includes("ss-docker-input")), "jellyfin row has docker input");
assert(extraJf.children.some((c) => c.className.includes("ss-api-input")), "jellyfin row has api key input");
assert(extraJf.children.some((c) => c.className.includes("ss-check-label")), "jellyfin row has details checkbox");
assert(!extraJf.children.some((c) => c.className.includes("ss-type-input")), "jellyfin row has NO type select");

const rowJfByName = makeServiceRow({ id: "r3", name: "jellyfin", url: "http://x", icon: null, category: "Media", size: "sm", docker: "", type: null, details: false, apiKey: "" });
assert(!!rowJfByName.children.find((c) => c.className === "ss-row-extra"), "row named jellyfin (case-insensitive) gets extras");

const jfPutBefore = fetchCalls.length;
rowJf.children.find((c) => c.className === "ss-row-bottom").children.find((c) => c.className === "ss-save").dispatch("click");
const jfPut = fetchCalls.find((c, i) => i >= jfPutBefore && c.url === "/api/services/r1" && c.opts.method === "PUT");
assert(!!jfPut, "jellyfin row save issues PUT");
assert(jfPut.opts.body.includes('"type":"jellyfin"') && jfPut.opts.body.includes('"docker":"jellyfin"'), "jellyfin save carries type + docker");

const rowP = makeServiceRow({ id: "r2", name: "Plex", url: "http://x", icon: null, category: "Media", size: "sm", docker: "", type: null, details: false, apiKey: "" });
const extraP = rowP.children.find((c) => c.className === "ss-row-extra");
assert(!extraP, "plain row has NO extra row");
assert(!rowP.children.some((c) => c.className.includes("ss-docker-input")), "plain row has NO docker input");
assert(rowP.children.some((c) => c.className === "ss-row-top"), "plain row keeps top");
assert(rowP.children.some((c) => c.className === "ss-row-bottom"), "plain row keeps bottom");

globalThis.__results = results;
