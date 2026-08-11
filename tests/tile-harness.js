const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeEl() {
  const el = {
    _storage: "",
    children: [],
    style: { setProperty(k, v) { this[k] = String(v); } },
    dataset: new Proxy({}, { set(t, k, v) { t[k] = String(v); return true; } }),
    _listeners: {},
    _qcache: {},
    className: "",
    value: "",
    tagName: "div"
  };
  el.classList = {
    _names: function () { return new Set(el.className.split(/\s+/).filter(Boolean)); },
    add: function (...c) { const s = this._names(); c.forEach((x) => s.add(x)); el.className = [...s].join(" "); },
    remove: function (...c) { const s = this._names(); c.forEach((x) => s.delete(x)); el.className = [...s].join(" "); },
    toggle: function (c, force) {
      const s = this._names();
      const has = force === undefined ? !s.has(c) : !!force;
      has ? s.add(c) : s.delete(c);
      el.className = [...s].join(" ");
      return has;
    },
    contains: function (c) { return this._names().has(c); }
  };
  el.appendChild = (child) => el.children.push(child);
  el.querySelector = (sel) => {
    if (!el._qcache[sel]) el._qcache[sel] = makeEl();
    return el._qcache[sel];
  };
  el.querySelectorAll = () => [];
  el.addEventListener = (t, fn) => { (el._listeners[t] = el._listeners[t] || []).push(fn); };
  el.removeEventListener = () => {};
  el.setPointerCapture = () => {};
  el.focus = () => {};
  el.click = () => {};
  el.matches = () => false;
  el.closest = () => null;
  el.dispatch = (t, ev) => (el._listeners[t] || []).forEach((fn) => fn(ev || { clientX: 0, preventDefault() {}, stopPropagation() {} }));
  Object.defineProperty(el, "textContent", {
    get() { return el._storage; },
    set(v) { el._storage = String(v); el.children = []; }
  });
  Object.defineProperty(el, "innerHTML", {
    get() { return el._storage; },
    set(v) { el._storage = String(v); el.children = []; }
  });
  return el;
}

const doc = {
  _byId: {},
  createElement(tag) { const e = makeEl(); e.tagName = tag || "div"; return e; },
  createTextNode(t) { return makeEl(); },
  getElementById(id) { if (!doc._byId[id]) doc._byId[id] = makeEl(); return doc._byId[id]; },
  querySelector() { return makeEl(); },
  querySelectorAll() { return []; },
  addEventListener() {}
};

const fetchCalls = [];
function fetchStub(url, opts) {
  fetchCalls.push({ url, opts: opts || {} });
  const body = (opts && opts.body) ? JSON.parse(opts.body) : null;
  let payload = {};
  if (url === "/api/config") {
    payload = {
      setupComplete: true,
      profile: { name: "" },
      services: [],
      weather: { locationName: "", latitude: null, longitude: null },
      rss: { feeds: [] },
      pihole: {}, adguard: {}, system: {}, proxmox: {}
    };
  } else if (url === "/api/system") {
    payload = { cpu: { loadPct: 0 }, mem: { usedPct: 0, active: 0, total: 1, available: 0, swaptotal: 0, swapused: 0 }, temp: { main: null }, disk: { usedPct: 0 }, loadAvg: {}, network: null, time: {} };
  } else if (url === "/api/weather") {
    payload = { current: { temperature_2m: 0 }, todayHigh: 0, todayLow: 0, unit: "celsius" };
  } else if (url === "/api/rss") {
    payload = [];
  } else if (url === "/api/ports") {
    payload = [];
  } else if (/\/api\/services\/[^/]+\/info/.test(url)) {
    payload = { up: true, uptimeSec: 123, source: "ping" };
  } else if (url.startsWith("/api/services/") && url.split("/").length === 4) {
    payload = { ...(body || {}) };
  }
  return Promise.resolve({
    ok: true,
    json: async () => payload
  });
}

const sandbox = {
  document: doc,
  window: {},
  localStorage: {
    _m: {},
    getItem(k) { return this._m[k] || null; },
    setItem(k, v) { this._m[k] = String(v); }
  },
  fetch: fetchStub,
  fetchCalls,
  performance: { now: () => Date.now() },
  AbortController: function () { this.signal = {}; this.abort = () => {}; },
  __timers: [],
  __timerId: 0,
  setTimeout: (fn, ms) => { const id = ++sandbox.__timerId; sandbox.__timers.push({ id, fn, ms }); return id; },
  clearTimeout: (id) => { const t = sandbox.__timers.find((x) => x.id === id); if (t) t.cancelled = true; },
  __tick: () => Promise.resolve().then(() => {}).then(() => {}).then(() => {}),
  __macrotick: () => new Promise((resolve) => { setTimeout(resolve, 0); }),
  addEventListener: () => {},
  removeEventListener: () => {},
  setInterval: () => 1,
  clearInterval: () => {},
  console,
  Date
};
sandbox.window = sandbox;
vm.createContext(sandbox);

const appSrc = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app.js"), "utf8");
vm.runInContext(appSrc, sandbox, { filename: "app.js" });

const test = fs.readFileSync(__filename.replace("tile-harness.js", "tile-harness-tests.js"), "utf8");
vm.runInContext(test, sandbox, { filename: "tests.js" });

Promise.resolve()
  .then(() => (sandbox.__async ? sandbox.__async : null))
  .then(() => {
    const results = sandbox.__results || [];
    let pass = 0, fail = 0;
    results.forEach((r) => {
      if (r.ok) pass++;
      else { fail++; console.log("FAIL:", r.msg); }
    });
    console.log(`${pass} PASS, ${fail} FAIL (of ${results.length})`);
    process.exit(fail ? 1 : 0);
  })
  .catch((err) => {
    console.log("HARNESS ERROR:", (err && err.stack) || err);
    process.exit(1);
  });
