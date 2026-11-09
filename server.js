const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const dns = require("dns").promises;
const net = require("net");
const tls = require("tls");
const os = require("os");
const path = require("path");
const si = require("systeminformation");
const Parser = require("rss-parser");
const rawFetch = require("node-fetch");
const checkDiskSpace = require("check-disk-space").default;
const unixpass = require("unixpass");
const helmet = require("helmet");

const app = express();
const PORT = process.env.PORT || 8080;
const HOST_DISK_PATH = process.env.HOST_DISK_PATH || "/hostfs";

const DATA_DIR = path.join(__dirname, "data");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");
const DEFAULT_CONFIG_PATH = path.join(__dirname, "config", "config.default.json");
const UPTIME_PATH = path.join(DATA_DIR, "service-uptime.json");
const LOCAL_PROBE_MS = 5 * 60 * 1000;
const REMOTE_PROBE_MS = 30 * 60 * 1000;
const PROBE_TIMEOUT = 6000;

const rssParser = new Parser({ timeout: 8000 });

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "img-src": ["'self'", "data:", "http:", "https:"],
      "connect-src": ["'self'", "http:", "https:"],
      "upgrade-insecure-requests": null,
    },
  },
}));
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

const authSessions = new Map();
const loginAttempts = new Map();
const outboundDnsCache = new Map();

function blockedHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal") return true;
  if (net.isIP(host) === 4) {
    const octets = host.split(".").map(Number);
    return octets[0] === 0 || octets[0] === 127 || (octets[0] === 169 && octets[1] === 254);
  }
  if (net.isIP(host) === 6) return host === "::" || host === "::1" || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb");
  return false;
}

async function assertSafeOutboundUrl(value) {
  const parsed = new URL(String(value));
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || blockedHost(parsed.hostname)) {
    throw new Error("outbound URL is not allowed");
  }
  const key = parsed.hostname.toLowerCase();
  const cached = outboundDnsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.blocked) throw new Error("outbound URL resolves to a restricted address");
    return;
  }
  let addresses = [];
  try {
    addresses = (await dns.lookup(key, { all: true })).map((entry) => entry.address);
  } catch {}
  const restricted = addresses.some((address) => blockedHost(address));
  outboundDnsCache.set(key, { blocked: restricted, expiresAt: Date.now() + 60 * 1000 });
  if (restricted) throw new Error("outbound URL resolves to a restricted address");
}

async function fetch(url, options = {}) {
  await assertSafeOutboundUrl(url);
  return rawFetch(url, { ...options, redirect: options.redirect || "error" });
}

function authState(cfg) {
  const auth = cfg?.auth || {};
  return {
    enabled: auth.enabled === true && !!auth.username && !!auth.passwordHash,
    username: String(auth.username || ""),
    passwordHash: String(auth.passwordHash || "")
  };
}

function hashPassword(password, salt = crypto.randomBytes(16)) {
  const derived = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

function verifyPassword(password, encoded) {
  try {
    const [, saltText, hashText] = String(encoded || "").split("$");
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(hashText, "base64url");
    const actual = crypto.scryptSync(String(password), salt, expected.length);
    return expected.length > 0 && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function cookieValue(req, name) {
  const cookies = String(req.headers.cookie || "").split(";");
  const entry = cookies.find((part) => part.trim().startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.trim().slice(name.length + 1)) : "";
}

function issueAuthSession(res) {
  const token = crypto.randomBytes(32).toString("base64url");
  authSessions.set(token, Date.now() + 12 * 60 * 60 * 1000);
  res.setHeader("Set-Cookie", `hdash_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
}

function publicService(svc) {
  const safe = { ...svc, credentialState: {
    apiKey: !!svc.apiKey,
    npm: !!(svc.npmEmail && svc.npmPassword),
    widget: {
      authValue: !!svc.widgetConfig?.authValue,
      username: !!svc.widgetConfig?.username,
      password: !!svc.widgetConfig?.password,
      token: !!svc.widgetConfig?.token
    }
  }};
  delete safe.apiKey;
  delete safe.npmEmail;
  delete safe.npmPassword;
  safe.widgetConfig = { ...safe.widgetConfig };
  ["authValue", "username", "password", "token"].forEach((key) => delete safe.widgetConfig[key]);
  return safe;
}

function publicConfig(cfg) {
  const auth = authState(cfg);
  return {
    ...cfg,
    auth: { enabled: auth.enabled, username: auth.username },
    pihole: { enabled: !!cfg.pihole?.enabled, url: cfg.pihole?.url || "", credentialConfigured: !!cfg.pihole?.apiKey },
    adguard: { enabled: !!cfg.adguard?.enabled, url: cfg.adguard?.url || "", authMode: cfg.adguard?.authMode || "basic", credentialConfigured: !!(cfg.adguard?.username && cfg.adguard?.password) },
    proxmox: { enabled: !!cfg.proxmox?.enabled, url: cfg.proxmox?.url || "", credentialConfigured: !!(cfg.proxmox?.tokenId && cfg.proxmox?.tokenSecret) },
    services: (cfg.services || []).map(publicService)
  };
}

app.post("/api/login", (req, res) => {
  const state = authState(readConfig());
  if (!state.enabled) return res.json({ ok: true });
  const ip = req.socket.remoteAddress || "unknown";
  const attempt = loginAttempts.get(ip) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
  if (attempt.resetAt <= Date.now()) { attempt.count = 0; attempt.resetAt = Date.now() + 15 * 60 * 1000; }
  if (attempt.count >= 10) return res.status(429).json({ error: "too many login attempts" });
  attempt.count++;
  loginAttempts.set(ip, attempt);
  if (req.body?.username !== state.username || !verifyPassword(req.body?.password, state.passwordHash)) {
    return res.status(401).json({ error: "invalid credentials" });
  }
  loginAttempts.delete(ip);
  issueAuthSession(res);
  res.json({ ok: true });
});

app.use("/api", (req, res, next) => {
  if (req.path === "/login") return next();
  const state = authState(readConfig());
  if (!state.enabled) return next();
  const token = cookieValue(req, "hdash_session");
  const expiresAt = authSessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    authSessions.delete(token);
    return res.status(401).json({ error: "authentication required" });
  }
  authSessions.set(token, Date.now() + 12 * 60 * 60 * 1000);
  next();
});

function ensureConfig() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaults = JSON.parse(fs.readFileSync(DEFAULT_CONFIG_PATH, "utf-8"));
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2));
  }
}

function readConfig() {
  ensureConfig();
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  return cfg;
}

function authFromInput(input, existing = {}) {
  const requested = input || {};
  if (requested.enabled !== true) return { enabled: false, username: "", passwordHash: "" };
  const username = String(requested.username || existing.username || "").trim().slice(0, 100);
  const password = String(requested.password || "");
  if (!username) throw Object.assign(new Error("Dashboard authentication requires a username."), { status: 422 });
  if (!password && existing.passwordHash) return { enabled: true, username, passwordHash: existing.passwordHash };
  if (password.length < 8) throw Object.assign(new Error("Dashboard password must be at least 8 characters."), { status: 422 });
  return { enabled: true, username, passwordHash: hashPassword(password) };
}

function mergeService(existing, incoming) {
  const oldWidget = existing?.widgetConfig || {};
  const newWidget = incoming?.widgetConfig || {};
  const merged = { ...(existing || {}), ...(incoming || {}) };
  for (const key of ["apiKey", "npmEmail", "npmPassword"]) {
    if (!String(incoming?.[key] || "").trim() && existing?.[key]) merged[key] = existing[key];
  }
  merged.widgetConfig = { ...oldWidget, ...newWidget };
  for (const key of ["authValue", "username", "password", "token"]) {
    if (!String(newWidget[key] || "").trim() && oldWidget[key]) merged.widgetConfig[key] = oldWidget[key];
  }
  return cleanService(merged);
}

function normalizeUrl(url) {
  const u = String(url || "").trim();
  if (!u) return "";
  return /^https?:\/\//i.test(u) ? u : `http://${u}`;
}

function normalizeSize(size, defaultSize = 1) {
  if (size === undefined || size === null || size === "") return normalizeSize(defaultSize);
  if (size === "sm") return 1;
  if (size === "md") return 2;
  if (size === "lg") return 3;
  const n = parseInt(size, 10);
  return Number.isFinite(n) ? Math.min(24, Math.max(1, n)) : normalizeSize(defaultSize);
}

function normalizeRows(rows) {
  const n = parseInt(rows, 10);
  return Number.isFinite(n) ? Math.min(8, Math.max(1, n)) : 1;
}

function cleanWidgetConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const metrics = Array.isArray(value.metrics)
    ? value.metrics.slice(0, 8).map((metric) => ({
        label: String(metric?.label || "").trim().slice(0, 40),
        path: String(metric?.path || "").trim().slice(0, 160)
      })).filter((metric) => metric.label && metric.path)
    : [];
  return {
    endpoint: String(value.endpoint || "").trim().slice(0, 500),
    authHeader: String(value.authHeader || "").trim().slice(0, 80),
    authValue: String(value.authValue || "").trim().slice(0, 500),
    username: String(value.username || "").trim().slice(0, 200),
    password: String(value.password || "").slice(0, 500),
    token: String(value.token || "").trim().slice(0, 500),
    metrics
  };
}

function cleanService(s) {
  return {
    id: s.id || crypto.randomUUID(),
    name: String(s.name || "").trim().slice(0, 120),
    url: String(s.url || "").trim().slice(0, 500),
    icon: String(s.icon || "").trim().slice(0, 500) || null,
    category: String(s.category || "Other").trim().slice(0, 80) || "Other",
    size: normalizeSize(s.size, s.type === "jellyfin" ? 6 : 1),
    rows: normalizeRows(s.rows),
    docker: String(s.docker || "").trim().slice(0, 200),
    type: ["jellyfin", "emby", "plex", "nginx-proxy-manager", "immich", "custom-api", "nextcloud", "sonarr", "radarr", "lidarr", "prowlarr", "qbittorrent", "overseerr", "portainer"].includes(s.type) ? s.type : null,
    details: !!s.details,
    apiKey: String(s.apiKey || "").slice(0, 500),
    widgetFields: Array.isArray(s.widgetFields) ? s.widgetFields.filter((x) => typeof x === "string") : [],
    widgetConfig: cleanWidgetConfig(s.widgetConfig),
    npmEmail: String(s.npmEmail || "").trim().slice(0, 200),
    npmPassword: String(s.npmPassword || "").slice(0, 500)
  };
}

function serviceCredentialError(svc) {
  const type = svc?.type;
  const apiKeyTypes = ["jellyfin", "emby", "plex", "immich", "sonarr", "radarr", "lidarr", "prowlarr", "overseerr", "portainer"];
  if (apiKeyTypes.includes(type) && svc.details && !String(svc.apiKey || "").trim()) {
    const labels = { jellyfin: "Jellyfin", emby: "Emby", plex: "Plex", immich: "Immich", overseerr: "Overseerr", portainer: "Portainer" };
    return `${labels[type] || type} requires an API key or token.`;
  }
  if (type === "nginx-proxy-manager" && (!String(svc.npmEmail || "").trim() || !String(svc.npmPassword || ""))) {
    return "Nginx Proxy Manager requires both login email and password.";
  }
  if (type === "nextcloud") {
    const cfg = svc.widgetConfig || {};
    if (!String(cfg.token || "").trim() && (!String(cfg.username || "").trim() || !String(cfg.password || ""))) {
      return "Nextcloud requires an NC-Token or both username and password.";
    }
  }
  if (type === "qbittorrent") {
    const cfg = svc.widgetConfig || {};
    if (!String(cfg.username || "").trim() || !String(cfg.password || "")) {
      return "qBittorrent requires both WebUI username and password.";
    }
  }
  return null;
}



app.get("/api/config", (req, res) => {
  res.json(publicConfig(readConfig()));
});

app.post("/api/setup", (req, res) => {
  const cfg = readConfig();
  const { profile, services, weather, rss, pihole, adguard, system, proxmox } = req.body || {};

  if (profile) cfg.profile = { ...cfg.profile, ...profile };
  if (Array.isArray(services)) {
    cfg.services = services.map(cleanService);
    const invalid = cfg.services.map(serviceCredentialError).find(Boolean);
    if (invalid) return res.status(422).json({ error: "validation", message: invalid });
  }
  if (weather) cfg.weather = { ...cfg.weather, ...weather };
  if (rss && Array.isArray(rss.feeds)) cfg.rss.feeds = rss.feeds;
  if (pihole) cfg.pihole = { ...cfg.pihole, ...pihole, apiKey: pihole.apiKey || cfg.pihole?.apiKey || "", url: normalizeUrl(pihole.url) };
  if (adguard) cfg.adguard = { ...cfg.adguard, ...adguard, username: adguard.username || cfg.adguard?.username || "", password: adguard.password || cfg.adguard?.password || "", url: normalizeUrl(adguard.url) };
  if (system) cfg.system = { ...cfg.system, ...system };
  if (proxmox) cfg.proxmox = { ...cfg.proxmox, ...proxmox, tokenId: proxmox.tokenId || cfg.proxmox?.tokenId || "", tokenSecret: proxmox.tokenSecret || cfg.proxmox?.tokenSecret || "", url: normalizeUrl(proxmox.url) };
  if (req.body?.auth) cfg.auth = authFromInput(req.body.auth, cfg.auth);

  cfg.setupComplete = true;
  writeConfig(cfg);
  if (authState(cfg).enabled) issueAuthSession(res);
  res.json(publicConfig(cfg));
});

app.put("/api/settings", (req, res) => {
  const cfg = readConfig();
  const { profile, weather, rss, pihole, adguard, system, services, proxmox } = req.body || {};
  if (profile) cfg.profile = { ...cfg.profile, ...profile };
  if (weather) cfg.weather = { ...cfg.weather, ...weather };
  if (rss && Array.isArray(rss.feeds)) cfg.rss.feeds = rss.feeds;
  if (pihole) cfg.pihole = { ...cfg.pihole, ...pihole, apiKey: pihole.apiKey || cfg.pihole?.apiKey || "", url: normalizeUrl(pihole.url) };
  if (adguard) cfg.adguard = { ...cfg.adguard, ...adguard, username: adguard.username || cfg.adguard?.username || "", password: adguard.password || cfg.adguard?.password || "", url: normalizeUrl(adguard.url) };
  if (system) cfg.system = { ...cfg.system, ...system };
  if (Array.isArray(services)) {
    const byId = new Map(cfg.services.map((s) => [s.id, s]));
    const nextServices = services.map((s) =>
      byId.has(s.id) ? mergeService(byId.get(s.id), s) : cleanService(s)
    );
    const invalid = nextServices.map(serviceCredentialError).find(Boolean);
    if (invalid) return res.status(422).json({ error: "validation", message: invalid });
    cfg.services = nextServices;
  }
  if (proxmox) cfg.proxmox = { ...cfg.proxmox, ...proxmox, tokenId: proxmox.tokenId || cfg.proxmox?.tokenId || "", tokenSecret: proxmox.tokenSecret || cfg.proxmox?.tokenSecret || "", url: normalizeUrl(proxmox.url) };
  if (req.body?.auth) cfg.auth = authFromInput(req.body.auth, cfg.auth);
  writeConfig(cfg);
  if (authState(cfg).enabled) issueAuthSession(res);
  res.json(publicConfig(cfg));
});

app.post("/api/services", (req, res) => {
  const cfg = readConfig();
  const svc = cleanService({
    id: crypto.randomUUID(),
    name: req.body.name,
    url: req.body.url,
    icon: req.body.icon || null,
    category: req.body.category || "Other",
    size: req.body.size,
    rows: req.body.rows,
    docker: req.body.docker,
    type: req.body.type,
    details: req.body.details,
    apiKey: req.body.apiKey,
    widgetFields: req.body.widgetFields,
    widgetConfig: req.body.widgetConfig,
    npmEmail: req.body.npmEmail,
    npmPassword: req.body.npmPassword
  });
  const credentialError = serviceCredentialError(svc);
  if (credentialError) return res.status(422).json({ error: "validation", message: credentialError });
  cfg.services.push(svc);
  writeConfig(cfg);
  res.json(publicService(svc));
});

app.put("/api/services/:id", (req, res) => {
  const cfg = readConfig();
  const idx = cfg.services.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "not found" });
  const updated = mergeService(cfg.services[idx], { ...req.body, id: req.params.id });
  const credentialError = serviceCredentialError(updated);
  if (credentialError) return res.status(422).json({ error: "validation", message: credentialError });
  cfg.services[idx] = updated;
  writeConfig(cfg);
  res.json(publicService(cfg.services[idx]));
});

function safeSettingsBackup(cfg) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: cfg.profile || {},
    weather: cfg.weather || {},
    rss: cfg.rss || {},
    system: cfg.system || {},
    pihole: { enabled: !!cfg.pihole?.enabled, url: cfg.pihole?.url || "" },
    adguard: { enabled: !!cfg.adguard?.enabled, url: cfg.adguard?.url || "", authMode: cfg.adguard?.authMode || "basic" },
    proxmox: { enabled: !!cfg.proxmox?.enabled, url: cfg.proxmox?.url || "" },
    services: (Array.isArray(cfg.services) ? cfg.services : []).map((svc) => {
      const safe = { ...svc };
      delete safe.apiKey;
      delete safe.npmEmail;
      delete safe.npmPassword;
      if (safe.widgetConfig) {
        safe.widgetConfig = { ...safe.widgetConfig };
        ["authValue", "username", "password", "token"].forEach((key) => delete safe.widgetConfig[key]);
      }
      return safe;
    })
  };
}

function mergeRestoredService(existing, incoming) {
  const oldConfig = existing?.widgetConfig || {};
  const nextConfig = incoming?.widgetConfig || {};
  return cleanService({
    ...(existing || {}),
    ...incoming,
    apiKey: incoming?.apiKey || existing?.apiKey || "",
    npmEmail: incoming?.npmEmail || existing?.npmEmail || "",
    npmPassword: incoming?.npmPassword || existing?.npmPassword || "",
    widgetConfig: { ...oldConfig, ...nextConfig,
      authValue: nextConfig.authValue || oldConfig.authValue || "",
      username: nextConfig.username || oldConfig.username || "",
      password: nextConfig.password || oldConfig.password || "",
      token: nextConfig.token || oldConfig.token || ""
    }
  });
}

app.get("/api/settings/backup", (req, res) => {
  res.json(safeSettingsBackup(readConfig()));
});

app.post("/api/settings/restore", (req, res) => {
  const backup = req.body;
  if (!backup || typeof backup !== "object" || backup.version !== 1 || !Array.isArray(backup.services)) {
    return res.status(422).json({ error: "validation", message: "Invalid dashboard backup file." });
  }
  if (backup.services.some((svc) => !svc || typeof svc !== "object" || !String(svc.name || "").trim() || !String(svc.url || "").trim())) {
    return res.status(422).json({ error: "validation", message: "Backup contains a service without a name or URL." });
  }
  const cfg = readConfig();
  const byId = new Map(cfg.services.map((svc) => [svc.id, svc]));
  cfg.profile = { ...cfg.profile, ...(backup.profile || {}) };
  cfg.weather = { ...cfg.weather, ...(backup.weather || {}) };
  cfg.rss = { ...cfg.rss, ...(backup.rss || {}) };
  cfg.system = { ...cfg.system, ...(backup.system || {}) };
  cfg.pihole = { ...cfg.pihole, ...(backup.pihole || {}) };
  cfg.adguard = { ...cfg.adguard, ...(backup.adguard || {}) };
  cfg.proxmox = { ...cfg.proxmox, ...(backup.proxmox || {}) };
  cfg.services = backup.services.map((svc) => mergeRestoredService(byId.get(svc.id), svc));
  const invalid = cfg.services.map(serviceCredentialError).find(Boolean);
  if (invalid) return res.status(422).json({ error: "validation", message: invalid });
  writeConfig(cfg);
  res.json(publicConfig(cfg));
});

app.delete("/api/services/:id", (req, res) => {
  const cfg = readConfig();
  cfg.services = cfg.services.filter((s) => s.id !== req.params.id);
  writeConfig(cfg);
  res.json({ ok: true });
});

let serviceUptime = {};
try {
  serviceUptime = JSON.parse(fs.readFileSync(UPTIME_PATH, "utf-8")) || {};
} catch {
  serviceUptime = {};
}

function saveUptime() {
  try {
    fs.writeFileSync(UPTIME_PATH, JSON.stringify(serviceUptime, null, 2));
  } catch {}
}

function isLocalUrl(url) {
  try {
    const host = new URL(normalizeUrl(url)).hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".local")) return true;
    if (/^\d/.test(host)) {
      const parts = host.split(".").map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
      return (
        parts[0] === 10 ||
        parts[0] === 127 ||
        (parts[0] === 169 && parts[1] === 254) ||
        (parts[0] === 192 && parts[1] === 168) ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      );
    }
    return !host.includes(".");
  } catch {
    return true;
  }
}

const probeAgent = new https.Agent({ rejectUnauthorized: false });

function probeResponseIsAvailable(status) {
  return status >= 200 && status < 500;
}

async function probeUrl(url) {
  const target = normalizeUrl(url);
  if (!target) return false;
  const options = { timeout: PROBE_TIMEOUT };
  if (/^https:/i.test(target)) options.agent = probeAgent;
  try {
    const r = await fetch(target, { ...options, redirect: "manual" });
    return probeResponseIsAvailable(r.status);
  } catch {
    return false;
  }
}

let dockerCache = { at: 0, list: null };

async function getDockerContainers() {
  if (Date.now() - dockerCache.at < 60000 && dockerCache.list) return dockerCache.list;
  const containers = await si.dockerContainers(true);
  dockerCache = { at: Date.now(), list: containers };
  return containers;
}

const TLS_CA_FILE = process.env.TLS_CA_FILE || "";
const ALLOW_INSECURE_TLS = process.env.ALLOW_INSECURE_TLS === "true";
let trustedCa = null;
try { if (TLS_CA_FILE) trustedCa = fs.readFileSync(TLS_CA_FILE); } catch { trustedCa = null; }
function createHttpsAgent() {
  if (trustedCa) return new https.Agent({ ca: [...tls.rootCertificates, trustedCa.toString()], rejectUnauthorized: true });
  if (ALLOW_INSECURE_TLS) return new https.Agent({ rejectUnauthorized: false });
  return undefined;
}

const jellyfinAgent = createHttpsAgent();

function jellyfinRequest(baseUrl, apiKey, agent, tokenHeader = "Authorization") {
  const o = { timeout: PROBE_TIMEOUT };
  if (/^https:/i.test(baseUrl)) o.agent = agent;
  if (apiKey) o.headers = tokenHeader === "X-Emby-Token"
    ? { "X-Emby-Token": apiKey }
    : { Authorization: `MediaBrowser Token=${apiKey}` };
  return o;
}

async function fetchJellyfinInfo(baseUrl, apiKey, span, type = "jellyfin") {
  const base = normalizeUrl(baseUrl).replace(/\/$/, "");
  if (!base) return {};
  const wantLibs = span >= 5;
  const tokenHeader = type === "emby" ? "X-Emby-Token" : "Authorization";
  const out = {};
  const settled = await Promise.allSettled([
    fetch(`${base}/System/Info/Public`, jellyfinRequest(base, apiKey, jellyfinAgent, tokenHeader)),
    apiKey
       ? fetch(`${base}/Items/Counts`, jellyfinRequest(base, apiKey, jellyfinAgent, tokenHeader))
      : Promise.resolve(null),
    apiKey
       ? fetch(`${base}/Sessions`, jellyfinRequest(base, apiKey, jellyfinAgent, tokenHeader))
      : Promise.resolve(null),
    apiKey
       ? fetch(`${base}/Library/MediaFolders`, jellyfinRequest(base, apiKey, jellyfinAgent, tokenHeader))
      : Promise.resolve(null),
     apiKey ? fetch(`${base}/Users`, jellyfinRequest(base, apiKey, jellyfinAgent, tokenHeader)) : Promise.resolve(null)
  ]);
  const [pub, counts, sessions, folders, users] = settled;

  if (pub.status === "fulfilled" && pub.value && pub.value.ok) {
    const p = await pub.value.json();
    out.serverName = p.ServerName || null;
    out.version = p.Version || null;
    out.os = p.OperatingSystem || null;
    out.arch = p.SystemArchitecture || null;
  }
  if (apiKey && counts.status === "fulfilled" && counts.value && counts.value.ok) {
    const c = await counts.value.json();
    out.movies = c.MovieCount != null ? c.MovieCount : null;
    out.series = c.SeriesCount != null ? c.SeriesCount : null;
    out.episodes = c.EpisodeCount != null ? c.EpisodeCount : null;
    out.artists = c.ArtistCount != null ? c.ArtistCount : null;
    out.albums = c.AlbumCount != null ? c.AlbumCount : null;
    out.songs = c.SongCount != null ? c.SongCount : null;
  }
  if (apiKey && sessions.status === "fulfilled" && sessions.value && sessions.value.ok) {
    const s = await sessions.value.json();
    const playing = Array.isArray(s) ? s.filter((x) => x && x.NowPlayingItem) : [];
    out.activeSessions = Array.isArray(s) ? playing.length : null;
    out.nowPlaying = playing.slice(0, 3).map((x) => {
      const item = x.NowPlayingItem || {};
      const ticks = Number(item.RunTimeTicks);
      const position = Number(x.PlayState?.PositionTicks);
      const progressPct = Number.isFinite(ticks) && ticks > 0 && Number.isFinite(position)
        ? Math.min(100, Math.max(0, Math.round((position / ticks) * 100)))
        : null;
      return {
        title: item.Name || null,
        seriesName: item.SeriesName || null,
        user: x.UserName || null,
        type: item.Type || null,
        progressPct,
        paused: !!x.PlayState?.IsPaused
      };
    });
  }
  if (apiKey && [counts, sessions, folders, users].some((r) => r.status === "fulfilled" && r.value?.status === 401)) {
    out.authError = "invalid-api-key";
  } else if (!apiKey) {
    out.authError = "missing-api-key";
  }
  if (apiKey && users.status === "fulfilled" && users.value && users.value.ok) {
    const u = await users.value.json();
    out.users = Array.isArray(u) ? u.length : null;
  }  let folderItems = [];
  if (apiKey && folders.status === "fulfilled" && folders.value && folders.value.ok) {
    const f = await folders.value.json();
    out.libraries = Array.isArray(f.Items) ? f.Items.length : null;
    if (Array.isArray(f.Items)) folderItems = f.Items;
  }

  if (apiKey && wantLibs && folderItems.length) {
    const libs = folderItems.slice(0, 8).filter((x) => x && x.Id);
    const tot = await Promise.allSettled(
      libs.map((x) =>
        fetch(`${base}/Items?ParentId=${encodeURIComponent(x.Id)}&Recursive=true&Limit=1`, jellyfinRequest(base, apiKey, jellyfinAgent, tokenHeader))
      )
    );
    out.libraryTotals = [];
    for (let i = 0; i < libs.length; i++) {
      const r = tot[i];
      if (r.status !== "fulfilled" || !r.value || !r.value.ok) continue;
      try {
        const d = await r.value.json();
        out.libraryTotals.push({
          name: libs[i].Name || null,
          type: libs[i].CollectionType || null,
          count: d.TotalRecordCount != null ? d.TotalRecordCount : null
        });
      } catch {}
    }
  }
  return out;
}

const npmTokenCache = new Map();

async function getNpmToken(baseUrl, email, password) {
  const cacheKey = baseUrl;
  const cached = npmTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const base = normalizeUrl(baseUrl).replace(/\/$/, "");
  const r = await fetch(`${base}/api/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: email, secret: password })
  });
  if (!r.ok) return null;
  const d = await r.json();
  if (!d.token) return null;
  npmTokenCache.set(cacheKey, { token: d.token, expiresAt: Date.now() + 50 * 60 * 1000 });
  return d.token;
}

async function fetchNginxInfo(baseUrl, email, password, span) {
  const base = normalizeUrl(baseUrl).replace(/\/$/, "");
  if (!base || !email || !password) return {};
  const token = await getNpmToken(baseUrl, email, password);
  if (!token) return {};
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const out = {};
  const [hostsR, streamsR, certsR, deadR, auditR] = await Promise.allSettled([
    fetch(`${base}/api/nginx/proxy-hosts`, { headers }),
    fetch(`${base}/api/nginx/streams`, { headers }),
    fetch(`${base}/api/nginx/certificates`, { headers }),
    fetch(`${base}/api/nginx/dead-hosts`, { headers }),
    fetch(`${base}/api/audit-log?limit=1`, { headers })
  ]);
  if (hostsR.status === "fulfilled" && hostsR.value?.ok) {
    const hosts = await hostsR.value.json();
    if (Array.isArray(hosts)) {
      out.proxyHosts = hosts.length;
      out.proxyHostsEnabled = hosts.filter((h) => h.enabled).length;
    }
  }
  if (streamsR.status === "fulfilled" && streamsR.value?.ok) {
    const s = await streamsR.value.json();
    out.streams = Array.isArray(s) ? s.length : 0;
  }
  if (certsR.status === "fulfilled" && certsR.value?.ok) {
    const c = await certsR.value.json();
    out.certificates = Array.isArray(c) ? c.length : 0;
  }
  if (deadR.status === "fulfilled" && deadR.value?.ok) {
    const d = await deadR.value.json();
    out.deadHosts = Array.isArray(d) ? d.length : 0;
  }
  if (auditR.status === "fulfilled" && auditR.value?.ok) {
    const a = await auditR.value.json();
    if (Array.isArray(a) && a.length) {
      out.lastAction = a[0].action || null;
      out.lastActionAt = a[0].created_on || null;
    }
  }
  return out;
}

async function fetchImmichInfo(baseUrl, apiKey) {
  const base = normalizeUrl(baseUrl).replace(/\/$/, "");
  if (!base) return {};
  if (!apiKey) return { authError: "missing-api-key" };
  const r = await fetch(`${base}/api/server/statistics`, {
    headers: { "x-api-key": apiKey },
    timeout: PROBE_TIMEOUT
  });
  if (r.status === 401 || r.status === 403) return { authError: "invalid-api-key" };
  if (!r.ok) return { error: `Immich returned HTTP ${r.status}` };
  const d = await r.json();
  return {
    users: d.users != null ? d.users : null,
    photos: d.photos != null ? d.photos : null,
    videos: d.videos != null ? d.videos : null,
    storageBytes: d.usage != null ? Number(d.usage) : null
  };
}

function readJsonPath(value, path) {
  return String(path || "").split(".").filter(Boolean).reduce((current, key) => current == null ? undefined : current[key], value);
}

async function fetchCustomApiInfo(baseUrl, widgetConfig) {
  const base = normalizeUrl(baseUrl).replace(/\/$/, "");
  const endpoint = String(widgetConfig?.endpoint || "").trim();
  if (!base || !endpoint) return { error: "Custom API endpoint is not configured" };
  const target = /^https?:\/\//i.test(endpoint) ? endpoint : `${base}/${endpoint.replace(/^\//, "")}`;
  const headers = {};
  if (widgetConfig.authHeader && widgetConfig.authValue) headers[widgetConfig.authHeader] = widgetConfig.authValue;
  const response = await fetch(target, { headers, timeout: PROBE_TIMEOUT });
  if (response.status === 401 || response.status === 403) return { authError: "invalid-credentials" };
  if (!response.ok) return { error: `Custom API returned HTTP ${response.status}` };
  const payload = await response.json();
  return {
    metrics: (widgetConfig.metrics || []).map((metric) => ({
      label: metric.label,
      value: readJsonPath(payload, metric.path)
    }))
  };
}

function mapNextcloudInfo(data) {
  const nextcloud = data?.nextcloud || {};
  const system = nextcloud.system || {};
  const storage = nextcloud.storage || {};
  const shares = nextcloud.shares || {};
  const activeUsers = data?.activeUsers ?? data?.activeusers ?? null;
  return {
    cpuLoad: system.cpuload ?? data?.cpuload ?? data?.cpuLoad ?? null,
    memoryUsage: system.mem_total != null && system.mem_free != null
      ? system.mem_total - system.mem_free
      : data?.memoryusage ?? data?.memoryUsage ?? null,
    freeSpace: system.freespace ?? data?.freespace ?? data?.freeSpace ?? null,
    activeUsers: typeof activeUsers === "number"
      ? activeUsers
      : activeUsers && typeof activeUsers === "object"
        ? Number(activeUsers.last24hours ?? activeUsers.last1hour ?? activeUsers.last5minutes) || 0
        : null,
    files: storage.num_files ?? data?.numFiles ?? data?.numfiles ?? null,
    shares: shares.num_shares ?? data?.numShares ?? data?.numshares ?? null
  };
}

async function fetchNextcloudInfo(baseUrl, widgetConfig) {
  const base = normalizeUrl(baseUrl).replace(/\/$/, "");
  if (!base) return {};
  const headers = { "OCS-APIRequest": "true", Accept: "application/json" };
  if (widgetConfig.token) headers["NC-Token"] = widgetConfig.token;
  else if (widgetConfig.username && widgetConfig.password) {
    headers.Authorization = `Basic ${Buffer.from(`${widgetConfig.username}:${widgetConfig.password}`).toString("base64")}`;
  } else return { authError: "missing-credentials" };
  const response = await fetch(`${base}/ocs/v2.php/apps/serverinfo/api/v1/info`, { headers, timeout: PROBE_TIMEOUT });
  if (response.status === 401 || response.status === 403) return { authError: "invalid-credentials" };
  if (!response.ok) return { error: `Nextcloud returned HTTP ${response.status}` };
  const payload = await response.json();
  return mapNextcloudInfo(payload?.ocs?.data || payload?.data || {});
}

async function fetchArrInfo(baseUrl, apiKey, type) {
  const base = normalizeUrl(baseUrl).replace(/\/$/, "");
  if (!base || !apiKey) return { authError: apiKey ? null : "missing-api-key" };
  const headers = { "X-Api-Key": apiKey };
  if (type === "prowlarr") {
    const response = await fetch(`${base}/api/v1/indexer`, { headers, timeout: PROBE_TIMEOUT });
    if (response.status === 401 || response.status === 403) return { authError: "invalid-api-key" };
    if (!response.ok) return { error: `Prowlarr returned HTTP ${response.status}` };
    const indexers = await response.json();
    return { indexers: Array.isArray(indexers) ? indexers.length : null, libraryLabel: "Indexers" };
  }
  const resource = type === "sonarr" ? "series" : type === "radarr" ? "movie" : "artist";
  const [wanted, queue, library] = await Promise.allSettled([
    fetch(`${base}/api/v3/wanted/missing?page=1&pageSize=1`, { headers, timeout: PROBE_TIMEOUT }),
    fetch(`${base}/api/v3/queue?page=1&pageSize=1`, { headers, timeout: PROBE_TIMEOUT }),
    fetch(`${base}/api/v3/${resource}`, { headers, timeout: PROBE_TIMEOUT })
  ]);
  if ([wanted, queue, library].some((item) => item.status === "fulfilled" && [401, 403].includes(item.value.status))) {
    return { authError: "invalid-api-key" };
  }
  const readJson = async (item) => item.status === "fulfilled" && item.value.ok ? item.value.json() : null;
  const [wantedData, queueData, libraryData] = await Promise.all([readJson(wanted), readJson(queue), readJson(library)]);
  return {
    wanted: wantedData?.totalRecords ?? null,
    queued: queueData?.totalRecords ?? (Array.isArray(queueData) ? queueData.length : null),
    library: Array.isArray(libraryData) ? libraryData.length : null,
    libraryLabel: type === "sonarr" ? "Series" : type === "radarr" ? "Movies" : "Artists"
  };
}

async function fetchQbittorrentInfo(baseUrl, widgetConfig) {
  const base = normalizeUrl(baseUrl).replace(/\/$/, "");
  if (!base || !widgetConfig.username || !widgetConfig.password) return { authError: "missing-credentials" };
  const login = await fetch(`${base}/api/v2/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: widgetConfig.username, password: widgetConfig.password }).toString(),
    timeout: PROBE_TIMEOUT
  });
  if (!login.ok) return { authError: "invalid-credentials" };
  const cookie = login.headers.get("set-cookie");
  const headers = cookie ? { Cookie: cookie.split(";")[0] } : {};
  const [transfer, torrents] = await Promise.all([
    fetch(`${base}/api/v2/transfer/info`, { headers, timeout: PROBE_TIMEOUT }),
    fetch(`${base}/api/v2/torrents/info`, { headers, timeout: PROBE_TIMEOUT })
  ]);
  if ([transfer, torrents].some((response) => response.status === 401 || response.status === 403)) return { authError: "invalid-credentials" };
  if (!transfer.ok || !torrents.ok) return { error: "qBittorrent API request failed" };
  const [t, list] = await Promise.all([transfer.json(), torrents.json()]);
  return {
    download: t.dl_info_speed ?? null,
    upload: t.up_info_speed ?? null,
    seed: Array.isArray(list) ? list.filter((item) => item.state === "uploading" || item.state === "stalledup").length : null,
    leech: Array.isArray(list) ? list.filter((item) => item.state === "downloading" || item.state === "stalledDL").length : null
  };
}

async function fetchPlexInfo(baseUrl, apiKey) {
  const base = normalizeUrl(baseUrl).replace(/\/$/, "");
  if (!base || !apiKey) return { authError: apiKey ? null : "missing-api-key" };
  const headers = { "X-Plex-Token": apiKey, Accept: "application/xml" };
  const [sessions, libraries] = await Promise.all([
    fetch(`${base}/status/sessions`, { headers, timeout: PROBE_TIMEOUT }),
    fetch(`${base}/library/sections`, { headers, timeout: PROBE_TIMEOUT })
  ]);
  if ([sessions, libraries].some((response) => response.status === 401 || response.status === 403)) return { authError: "invalid-api-key" };
  if (!sessions.ok || !libraries.ok) return { error: "Plex API request failed" };
  const [sessionXml, libraryXml] = await Promise.all([sessions.text(), libraries.text()]);
  return {
    streaming: (sessionXml.match(/<Video\b/g) || []).length,
    libraries: (libraryXml.match(/<Directory\b/g) || []).length
  };
}

async function fetchOverseerrInfo(baseUrl, apiKey) {
  const base = normalizeUrl(baseUrl).replace(/\/$/, "");
  if (!base || !apiKey) return { authError: apiKey ? null : "missing-api-key" };
  const response = await fetch(`${base}/api/v1/request?take=1&skip=0`, { headers: { "X-Api-Key": apiKey }, timeout: PROBE_TIMEOUT });
  if (response.status === 401 || response.status === 403) return { authError: "invalid-api-key" };
  if (!response.ok) return { error: `Overseerr returned HTTP ${response.status}` };
  const data = await response.json();
  return { requests: data.pageInfo?.results ?? data.totalResults ?? null };
}

async function fetchPortainerInfo(baseUrl, apiKey) {
  const base = normalizeUrl(baseUrl).replace(/\/$/, "");
  if (!base || !apiKey) return { authError: apiKey ? null : "missing-api-key" };
  const headers = { Authorization: `Bearer ${apiKey}` };
  const [endpoints, stacks] = await Promise.all([
    fetch(`${base}/api/endpoints`, { headers, timeout: PROBE_TIMEOUT }),
    fetch(`${base}/api/stacks`, { headers, timeout: PROBE_TIMEOUT })
  ]);
  if ([endpoints, stacks].some((response) => response.status === 401 || response.status === 403)) return { authError: "invalid-api-key" };
  if (!endpoints.ok || !stacks.ok) return { error: "Portainer API request failed" };
  const [endpointData, stackData] = await Promise.all([endpoints.json(), stacks.json()]);
  return { endpoints: Array.isArray(endpointData) ? endpointData.length : null, stacks: Array.isArray(stackData) ? stackData.length : null };
}

app.get("/api/services/:id/info", async (req, res) => {
  const cfg = readConfig();
  const svc = cfg.services.find((s) => s.id === req.params.id);
  if (!svc) return res.status(404).json({ error: "service not found" });
  try {
    const statusOnly = req.query.statusOnly === "1";
    const result = { id: svc.id, source: "ping", up: false, uptimeSec: 0, state: null, checkedAt: Date.now() };

    if (svc.docker) {
      try {
        const containers = await getDockerContainers();
        const c = (containers || []).find((x) => x.name === svc.docker);
        if (c) {
          result.source = "docker";
          result.state = c.state;
          result.up = c.state === "running";
          result.uptimeSec = c.startedTime ? Math.max(0, Math.floor((Date.now() - c.startedTime) / 1000)) : 0;
        }
      } catch {}
    }

    if (result.source !== "docker") {
      if (svc.url) {
        const entry = serviceUptime[svc.url] || (serviceUptime[svc.url] = { firstSeenAt: null, lastProbeAt: 0 });
        const interval = isLocalUrl(svc.url) ? LOCAL_PROBE_MS : REMOTE_PROBE_MS;
        if (Date.now() - entry.lastProbeAt >= interval) {
          entry.lastProbeAt = Date.now();
          const probeStarted = Date.now();
          const ok = await probeUrl(svc.url);
          result.ms = Date.now() - probeStarted;
          if (ok) {
            if (!entry.firstSeenAt) entry.firstSeenAt = Date.now();
          } else {
            delete entry.firstSeenAt;
          }
          saveUptime();
        }
        result.up = !!entry.firstSeenAt;
        result.uptimeSec = result.up ? Math.max(0, Math.floor((Date.now() - entry.firstSeenAt) / 1000)) : 0;
      }
    }

    if (statusOnly) return res.json(result);

    if (svc.type === "jellyfin" && svc.details && svc.url) {
      const span = parseInt(req.query.span, 10) || 1;
      const rows = parseInt(req.query.rows, 10) || 1;
      const level = Math.min(6, Math.max(1, span + rows - 1));
      result.jellyfin = await fetchJellyfinInfo(svc.url, svc.apiKey, level);
    }
    if (svc.type === "emby" && svc.details && svc.url) {
      const span = parseInt(req.query.span, 10) || 1;
      const rows = parseInt(req.query.rows, 10) || 1;
      const level = Math.min(6, Math.max(1, span + rows - 1));
      result.emby = await fetchJellyfinInfo(svc.url, svc.apiKey, level, "emby");
    }
    if (svc.type === "plex" && svc.details && svc.url) result.plex = await fetchPlexInfo(svc.url, svc.apiKey);
    if (svc.type === "nginx-proxy-manager" && svc.npmEmail && svc.npmPassword && svc.url) {
      result.nginx = await fetchNginxInfo(svc.url, svc.npmEmail, svc.npmPassword);
    }
    if (svc.type === "immich" && svc.details && svc.url) {
      result.immich = await fetchImmichInfo(svc.url, svc.apiKey);
    }
    if (svc.type === "custom-api" && svc.details && svc.url) {
      result.customApi = await fetchCustomApiInfo(svc.url, svc.widgetConfig);
    }
    if (svc.type === "nextcloud" && svc.details && svc.url) {
      result.nextcloud = await fetchNextcloudInfo(svc.url, svc.widgetConfig);
    }
    if ((svc.type === "sonarr" || svc.type === "radarr") && svc.details && svc.url) {
      result.arr = await fetchArrInfo(svc.url, svc.apiKey, svc.type);
    }
    if ((svc.type === "lidarr" || svc.type === "prowlarr") && svc.details && svc.url) {
      result.arr = await fetchArrInfo(svc.url, svc.apiKey, svc.type);
    }
    if (svc.type === "qbittorrent" && svc.details && svc.url) {
      result.qbittorrent = await fetchQbittorrentInfo(svc.url, svc.widgetConfig);
    }
    if (svc.type === "overseerr" && svc.details && svc.url) result.overseerr = await fetchOverseerrInfo(svc.url, svc.apiKey);
    if (svc.type === "portainer" && svc.details && svc.url) result.portainer = await fetchPortainerInfo(svc.url, svc.apiKey);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "failed to read service info" });
  }
});



app.get("/api/system", async (req, res) => {
  try {
    const [cpu, mem, temp, osInfo, currentLoad, time, netStatsArr, netIfaces] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.cpuTemperature(),
      si.osInfo(),
      si.currentLoad(),
      si.time(),
      si.networkStats().catch(() => []),
      si.networkInterfaces().catch(() => [])
    ]);

    let disk = null;
    try {
      const space = await checkDiskSpace(HOST_DISK_PATH);
      disk = {
        mount: HOST_DISK_PATH,
        free: space.free,
        size: space.size,
        used: space.size - space.free,
        usedPct: Math.round(((space.size - space.free) / space.size) * 1000) / 10
      };
    } catch (e) {
      disk = null;
    }

    
    let docker = null;
    try {
      const containers = await si.dockerContainers(true);
      docker = {
        total: containers.length,
        running: containers.filter((c) => c.state === "running").length
      };
    } catch {
      docker = null;
    }

    const net = netStatsArr && netStatsArr[0] ? netStatsArr[0] : null;
    const defaultIface = (Array.isArray(netIfaces) ? netIfaces : []).find(
      (i) => i.ip4 && !i.internal && i.operstate === "up"
    );

    const loadAvg = os.loadavg(); 

    res.json({
      cpu: {
        manufacturer: cpu.manufacturer,
        brand: cpu.brand,
        cores: cpu.cores,
        physicalCores: cpu.physicalCores,
        speed: cpu.speed,
        loadPct: Math.round(currentLoad.currentLoad * 10) / 10
      },
      loadAvg: {
        "1m": Math.round(loadAvg[0] * 100) / 100,
        "5m": Math.round(loadAvg[1] * 100) / 100,
        "15m": Math.round(loadAvg[2] * 100) / 100
      },
      mem: {
        total: mem.total,
        used: mem.active,
        free: mem.available,
        usedPct: Math.round((mem.active / mem.total) * 1000) / 10
      },
      swap: {
        total: mem.swaptotal,
        used: mem.swapused,
        usedPct: mem.swaptotal > 0 ? Math.round((mem.swapused / mem.swaptotal) * 1000) / 10 : 0
      },
      temp: {
        main: temp.main,
        cores: temp.cores
      },
      disk,
      network: net
        ? {
            iface: net.iface,
            rxSec: net.rx_sec,
            txSec: net.tx_sec
          }
        : null,
      localIp: defaultIface ? defaultIface.ip4 : null,
      docker,
      uptimeSec: time.uptime,
      os: `${osInfo.distro} ${osInfo.release}`,
      kernel: osInfo.kernel,
      hostname: osInfo.hostname
    });
  } catch (err) {
    res.status(500).json({ error: "failed to read system stats" });
  }
});







function parseDockerPort(entry) {
  if (typeof entry === "string") {
    const match = entry.match(/(?:^|,\s*)(?:[^:]+:)?(\d+)->(\d+)\/(tcp|udp)/i);
    if (!match) return null;
    return { hostPort: Number(match[1]), containerPort: Number(match[2]), protocol: match[3].toLowerCase() };
  }
  if (!entry || typeof entry !== "object") return null;
  const hostPort = Number(entry.publicPort ?? entry.hostPort ?? entry.host ?? 0) || null;
  const containerPort = Number(entry.privatePort ?? entry.containerPort ?? entry.port ?? 0) || hostPort;
  if (!containerPort) return null;
  return {
    hostPort,
    containerPort,
    protocol: String(entry.type || entry.protocol || "tcp").toLowerCase()
  };
}

app.get("/api/ports", async (req, res) => {
  try {
    const connections = await si.networkConnections();
    const listening = connections.filter((c) => c.state === "LISTEN");

    const seen = new Map();
    listening.forEach((c) => {
      const key = `${c.protocol}:${c.localPort}`;
      if (!seen.has(key)) {
        seen.set(key, {
          port: c.localPort,
          protocol: c.protocol,
          process: c.process || null,
          pid: c.pid || null
        });
      }
    });

    const system = Array.from(seen.values()).sort((a, b) => a.port - b.port);
    let docker = [];
    let dockerAvailable = false;
    try {
      const containers = await getDockerContainers();
      dockerAvailable = true;
      const dockerSeen = new Set();
      (Array.isArray(containers) ? containers : []).forEach((container) => {
        const entries = Array.isArray(container.ports) ? container.ports : [];
        let addedPort = false;
        entries.forEach((entry) => {
          const parsed = parseDockerPort(entry);
          if (!parsed) return;
          const key = `${container.id || container.name}:${parsed.hostPort}:${parsed.containerPort}:${parsed.protocol}`;
          if (dockerSeen.has(key)) return;
          dockerSeen.add(key);
          docker.push({
            port: parsed.hostPort || parsed.containerPort,
            containerPort: parsed.containerPort,
            protocol: parsed.protocol,
            service: container.name || container.id?.slice(0, 12) || "unknown",
            containerId: container.id ? container.id.slice(0, 12) : null,
            state: container.state || "unknown",
            image: container.image || "unknown"
          });
          addedPort = true;
        });
        if (!addedPort) docker.push({
          port: null,
          containerPort: null,
          protocol: null,
          service: container.name || container.id?.slice(0, 12) || "unknown",
          containerId: container.id ? container.id.slice(0, 12) : null,
          state: container.state || "unknown",
          image: container.image || "unknown"
        });
      });
      docker.sort((a, b) => a.port - b.port || String(a.service).localeCompare(String(b.service)));
    } catch {
      dockerAvailable = false;
    }
    res.json({ system, docker, dockerAvailable });
  } catch (err) {
    res.status(500).json({ error: "failed to read listening ports" });
  }
});



app.get("/api/geocode", async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: "missing q" });
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
    const r = await fetch(url);
    const data = await r.json();
    res.json(data.results || []);
  } catch (err) {
    res.status(500).json({ error: "geocode failed" });
  }
});

app.get("/api/weather", async (req, res) => {
  const cfg = readConfig();
  const { latitude, longitude, unit } = cfg.weather || {};
  if (latitude == null || longitude == null) {
    return res.status(400).json({ error: "weather location not configured" });
  }
  try {
    const tempUnit = unit === "celsius" ? "celsius" : "fahrenheit";
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=7&temperature_unit=${tempUnit}&timezone=auto`;
    const r = await fetch(url);
    const data = await r.json();
    const forecast = (data.daily?.time || []).map((t, i) => ({
      date: t,
      high: data.daily?.temperature_2m_max?.[i],
      low: data.daily?.temperature_2m_min?.[i],
      code: data.daily?.weather_code?.[i]
    }));
    res.json({
      locationName: cfg.weather.locationName,
      current: data.current,
      todayHigh: forecast[0]?.high,
      todayLow: forecast[0]?.low,
      forecast,
      unit: tempUnit
    });
  } catch (err) {
    res.status(500).json({ error: "weather fetch failed" });
  }
});



app.get("/api/rss", async (req, res) => {
  const cfg = readConfig();
  const feeds = cfg.rss?.feeds?.length ? cfg.rss.feeds : [];
  try {
    const allowedFeeds = (await Promise.all(feeds.map(async (feed) => {
      try { await assertSafeOutboundUrl(feed); return feed; } catch { return null; }
    }))).filter(Boolean);
    const results = await Promise.allSettled(allowedFeeds.map((f) => rssParser.parseURL(f)));
    const items = [];
    results.forEach((r) => {
      if (r.status === "fulfilled") {
        const feedTitle = r.value.title;
        (r.value.items || []).slice(0, 6).forEach((it) => {
          items.push({
            title: it.title,
            link: it.link,
            source: feedTitle,
            pubDate: it.pubDate || it.isoDate
          });
        });
      }
    });
    items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    res.json(items.slice(0, 25));
  } catch (err) {
    res.status(500).json({ error: "rss fetch failed" });
  }
});




function toTopList(obj) {
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj)
    .map(([name, count]) => ({ name, count: Number(count) || 0 }))
    .sort((a, b) => b.count - a.count);
}




function parseTopList(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    if (item.host != null && typeof item.count === "number") {
      out.push({ name: String(item.host), count: item.count });
    } else {
      for (const [k, v] of Object.entries(item)) {
        if (typeof v === "number") out.push({ name: k, count: v });
      }
    }
  }
  return out.sort((a, b) => b.count - a.count);
}


function deriveAllowed(topQueried, topBlocked) {
  if (!Array.isArray(topQueried) || !topQueried.length) return [];
  const blocked = new Map((topBlocked || []).map((b) => [b.name, b.count]));
  return topQueried
    .map((d) => ({
      name: d.name,
      count: Math.max((d.count || 0) - (blocked.get(d.name) || 0), 0)
    }))
    .filter((d) => d.count > 0)
    .slice(0, 10);
}


function mergeClients(all, blockedList) {
  const blockedMap = new Map((blockedList || []).map((c) => [c.name, c.count]));
  return (all || []).map((c) => ({ ...c, blocked: blockedMap.get(c.name) || 0 }));
}


function hourLabels() {
  const labels = [];
  const now = new Date();
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600000);
    labels.push(`${String(d.getHours()).padStart(2, "0")}:00`);
  }
  return labels;
}



function buildGraph(queriesObj, blockedObj) {
  const queries = Array(24).fill(0);
  const blocked = Array(24).fill(0);
  if (!queriesObj || typeof queriesObj !== "object") {
    return { labels: hourLabels(), queries: null, blocked: null };
  }
  const now = Date.now() / 1000;
  const fill = (obj, out) => {
    for (const [ts, count] of Object.entries(obj)) {
      const ageHours = Math.floor((now - Number(ts)) / 3600);
      if (ageHours >= 0 && ageHours < 24) out[23 - ageHours] += Number(count) || 0;
    }
  };
  fill(queriesObj, queries);
  if (blockedObj && typeof blockedObj === "object") fill(blockedObj, blocked);
  return { labels: hourLabels(), queries, blocked };
}



function buildAdguardGraph(stats) {
  if (!Array.isArray(stats.dns_queries) || !stats.dns_queries.length) {
    return { labels: hourLabels(), queries: null, blocked: null };
  }
  if (stats.time_units === "days") {
    const n = Math.min(7, stats.dns_queries.length);
    const labels = Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.now() - (n - 1 - i) * 86400000);
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    });
    return {
      labels,
      queries: stats.dns_queries.slice(-n),
      blocked: Array.isArray(stats.blocked_filtering)
        ? stats.blocked_filtering.slice(-n)
        : null
    };
  }
  const n = Math.min(24, stats.dns_queries.length);
  return {
    labels: hourLabels().slice(-n),
    queries: stats.dns_queries.slice(-n),
    blocked: Array.isArray(stats.blocked_filtering)
      ? stats.blocked_filtering.slice(-n)
      : null
  };
}



app.get("/api/pihole", async (req, res) => {
  const cfg = readConfig();
  const ph = cfg.pihole;
  if (!ph || !ph.enabled || !ph.url) {
    return res.status(400).json({ error: "pihole not configured" });
  }
  try {
    
    
    const base = normalizeUrl(ph.url).replace(/\/$/, "");
    const auth = ph.apiKey ? `&auth=${encodeURIComponent(ph.apiKey)}` : "";
    const phUrl = (params) => `${base}/admin/api.php?${params}${auth}`;

    const settled = await Promise.allSettled([
      fetch(phUrl("summary"), { timeout: 6000 }),
      fetch(phUrl("topItems=10"), { timeout: 6000 }),
      fetch(phUrl("topClients=10"), { timeout: 6000 }),
      fetch(phUrl("topClientsBlocked=10"), { timeout: 6000 }),
      fetch(phUrl("overTimeData10mins"), { timeout: 6000 })
    ]);
    const getJson = async (r) =>
      r.status === "fulfilled" && r.value.ok ? r.value.json() : null;
    const [summary, topItems, topClients, topClientsBlocked, overTime] = await Promise.all(
      settled.map(getJson)
    );
    if (!summary) throw new Error("pihole summary unavailable");

    const topBlocked = toTopList((topItems || {}).top_ads);
    const topQueried = toTopList((topItems || {}).top_queries);
    const topAllowed = deriveAllowed(topQueried, topBlocked);

    res.json({
      status: summary.status,
      queriesToday: summary.dns_queries_today,
      blockedToday: summary.ads_blocked_today,
      blockedPct: summary.ads_percentage_today,
      domainsOnBlocklist: summary.domains_being_blocked,
      graph: buildGraph(
        (overTime || {}).domains_over_time,
        (overTime || {}).ads_over_time
      ),
      topClients: mergeClients(
        toTopList((topClients || {}).top_sources),
        toTopList((topClientsBlocked || {}).top_sources_blocked)
      ),
      topBlocked,
      topAllowed
    });
  } catch (err) {
    res.status(500).json({ error: "pihole fetch failed" });
  }
});












const adguardAgent = createHttpsAgent();
const proxmoxAgent = createHttpsAgent();

let glinetSession = { sid: null, touchedAt: 0 };

function glinetRpcBase(adguardUrl) {
  const host = normalizeUrl(adguardUrl)
    .replace(/^https?:\/\//, "")
    .split(":")[0];
  return `http://${host}`;
}

async function glinetRpc(rpcUrl, payload) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeout: 6000
  });
  return res.json();
}

async function glinetLogin(ag) {
  const rpc = `${glinetRpcBase(ag.url)}/rpc`;
  const username = ag.username || "root";

  const challenge = await glinetRpc(rpc, {
    jsonrpc: "2.0",
    method: "challenge",
    params: { username },
    id: 0
  });
  if (!challenge.result || !challenge.result.salt) {
    throw new Error(`GL.iNet challenge failed: ${JSON.stringify(challenge)}`);
  }
  const { alg, salt, nonce } = challenge.result;
  const cipher = unixpass.crypt(ag.password || "", `$${alg}$${salt}$`);

  let sid = null;
  let lastErr = null;
  for (const algo of ["sha256", "md5"]) {
    const hash = crypto.createHash(algo).update(`${username}:${cipher}:${nonce}`).digest("hex");
    const login = await glinetRpc(rpc, {
      jsonrpc: "2.0",
      method: "login",
      params: { username, hash },
      id: 0
    });
    if (login.result && login.result.sid) {
      sid = login.result.sid;
      break;
    }
    lastErr = new Error(`GL.iNet login (${algo}) failed: ${JSON.stringify(login)}`);
  }
  if (!sid) throw lastErr;

  
  
  await glinetRpc(rpc, {
    jsonrpc: "2.0",
    method: "call",
    params: [sid, "system", "get_status"],
    id: 1
  });

  glinetSession = { sid, touchedAt: Date.now() };
  return sid;
}

async function getGlinetToken(ag) {
  const stale = !glinetSession.sid || Date.now() - glinetSession.touchedAt > 10 * 60 * 1000;
  if (stale) return glinetLogin(ag);
  return glinetSession.sid;
}

app.get("/api/adguard", async (req, res) => {
  const cfg = readConfig();
  const ag = cfg.adguard;
  if (!ag || !ag.enabled || !ag.url) {
    return res.status(400).json({ error: "adguard not configured" });
  }
  const base = normalizeUrl(ag.url).replace(/\/$/, "");
  const agent = /^https:/i.test(base) ? adguardAgent : undefined;
  const isGlinet = ag.authMode === "glinet";

  try {
    let headers = {};
    if (isGlinet) {
      headers = { Cookie: `Admin-Token=${await getGlinetToken(ag)}` };
    } else {
      headers = {
        Authorization:
          "Basic " +
          Buffer.from(`${ag.username || ""}:${ag.password || ""}`).toString("base64")
      };
    }

    const fetchStats = async (h) => {
      const [statusRes, statsRes, filterRes] = await Promise.all([
        fetch(`${base}/control/status`, { headers: h, timeout: 6000, agent }),
        fetch(`${base}/control/stats`, { headers: h, timeout: 6000, agent }),
        fetch(`${base}/control/filtering/status`, { headers: h, timeout: 6000, agent })
      ]);
      return { statusRes, statsRes, filterRes };
    };

    let { statusRes, statsRes, filterRes } = await fetchStats(headers);
    if (isGlinet && !statusRes.ok) {
      
      headers = { Cookie: `Admin-Token=${await glinetLogin(ag)}` };
      ({ statusRes, statsRes, filterRes } = await fetchStats(headers));
    }
    if (!statusRes.ok || !statsRes.ok || !filterRes.ok) {
      throw new Error(`AdGuard API returned ${statusRes.status}/${statsRes.status}/${filterRes.status}`);
    }
    const [status, stats, filtering] = await Promise.all([
      statusRes.json(),
      statsRes.json(),
      filterRes.json()
    ]);

    const queriesTotal = stats.num_dns_queries ?? 0;
    const blockedTotal = stats.num_blocked_filtering ?? 0;
    const blockedPct =
      queriesTotal > 0 ? Math.round((blockedTotal / queriesTotal) * 1000) / 10 : 0;

    
    
    let queriesToday = null;
    let blockedToday = null;
    if (Array.isArray(stats.dns_queries) && stats.dns_queries.length) {
      if (stats.time_units === "hours") {
        const buckets = Math.min(new Date().getHours() + 1, stats.dns_queries.length);
        queriesToday = stats.dns_queries.slice(-buckets).reduce((a, b) => a + b, 0);
        blockedToday = Array.isArray(stats.blocked_filtering)
          ? stats.blocked_filtering.slice(-buckets).reduce((a, b) => a + b, 0)
          : null;
      } else {
        queriesToday = stats.dns_queries[stats.dns_queries.length - 1];
        blockedToday = Array.isArray(stats.blocked_filtering)
          ? stats.blocked_filtering[stats.blocked_filtering.length - 1]
          : null;
      }
    }

    const blocklistSize = (filtering.filters || [])
      .filter((f) => f.enabled !== false)
      .reduce((n, f) => n + (f.rules_count || 0), 0);

    
    
    const topClients = parseTopList(stats.top_clients);
    const topBlocked = parseTopList(stats.top_blocked_domains || stats.top_blocked);
    const topQueried = parseTopList(stats.top_queried_domains);
    const topAllowed = deriveAllowed(topQueried, topBlocked);

    res.json({
      protectionEnabled: status.protection_enabled,
      version: status.version,
      queriesToday,
      blockedToday,
      queriesTotal,
      blockedTotal,
      blockedPct,
      blocklistSize,
      avgProcessingMs:
        stats.avg_processing_time != null ? Math.round(stats.avg_processing_time * 1000) : null,
      graph: buildAdguardGraph(stats),
      topClients,
      topBlocked,
      topAllowed
    });
  } catch (err) {
    res.status(500).json({ error: "adguard fetch failed" });
  }
});



function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function urlExists(url) {
  try {
    const r = await fetch(url, { method: "HEAD", timeout: 5000 });
    return r.ok;
  } catch {
    return false;
  }
}

app.get("/api/resolve-icon", async (req, res) => {
  const { name, url } = req.query;
  const slug = slugify(name || "");
  const candidates = [];

  if (slug) {
    candidates.push(`https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/${slug}.png`);
    candidates.push(`https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/${slug}.svg`);
  }

  for (const c of candidates) {
    if (await urlExists(c)) {
      return res.json({ icon: c, source: "dashboard-icons" });
    }
  }

  if (url) {
    try {
      const domain = new URL(url).hostname;
      const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
      if (await urlExists(favicon)) {
        return res.json({ icon: favicon, source: "favicon" });
      }
    } catch {
      
    }
  }

  res.json({ icon: null, source: "none" });
});







app.get("/api/proxmox", async (req, res) => {
  const pm = readConfig().proxmox || {};
  if (!pm.enabled || !pm.url || !pm.tokenId || !pm.tokenSecret) {
    return res.status(400).json({ error: "Proxmox not configured", detail: "enable it in Settings → Proxmox" });
  }

  try {
    const base = normalizeUrl(pm.url).replace(/\/$/, "");
    const options = {
      method: "GET",
      headers: { Authorization: `PVEAPIToken=${pm.tokenId}=${pm.tokenSecret}` },
      timeout: 8000
    };
    if (/^https:/i.test(base)) options.agent = proxmoxAgent;

    const r = await fetch(`${base}/api2/json/cluster/resources?type=vm`, options);
    if (!r.ok) {
      return res.status(502).json({
        error: `Proxmox API returned ${r.status}`
      });
    }
    const payload = await r.json();

    const guests = (payload.data || [])
      .filter((g) => g.vmid != null)
      .map((g) => ({
        vmid: g.vmid,
        name: g.name || "",
        type: g.type === "lxc" ? "lxc" : "qemu",
        status: g.status || "unknown",
        node: g.node || "",
        cpuPct: g.cpu != null ? Math.round(g.cpu * 100) : null,
        memUsed: g.mem || null,
        memMax: g.maxmem || null,
        disk: g.disk != null ? g.disk : null,
        maxDisk: g.maxdisk != null ? g.maxdisk : null,
        netIn: g.netin != null ? g.netin : null,
        netOut: g.netout != null ? g.netout : null,
        diskRead: g.diskread != null ? g.diskread : null,
        diskWrite: g.diskwrite != null ? g.diskwrite : null,
        uptime: g.uptime || 0
      }))
      .sort((a, b) => a.type.localeCompare(b.type) || a.vmid - b.vmid);

    const nodes = [...new Set(guests.map((g) => g.node).filter(Boolean))];

    res.json({ nodes, guests });
  } catch (err) {
    res.status(500).json({ error: "failed to read Proxmox" });
  }
});

function skipLocalIps(addr) {
  const a = String(addr).trim();
  if (!a) return true;
  if (/^127\./.test(a) || a === "::1") return true;
  if (a.toLowerCase().startsWith("fe80")) return true;
  return false;
}

function lxcInterfaceIps(data) {
  const ips = [];
  for (const iface of Array.isArray(data) ? data : []) {
    if (!iface || iface.name === "lo") continue;
    const addrs = [];
    for (const a of Array.isArray(iface["ip-addresses"]) ? iface["ip-addresses"] : []) {
      if (a && a["ip-address"]) addrs.push(String(a["ip-address"]).trim());
    }
    for (const key of ["inet", "inet6"]) {
      const v = iface[key];
      if (v == null) continue;
      for (const part of String(v).split(",")) {
        const clean = part.trim().replace(/\/\d+$/, "");
        if (clean) addrs.push(clean);
      }
    }
    for (const a of addrs) {
      if (skipLocalIps(a) || ips.includes(a)) continue;
      ips.push(a);
    }
  }
  return ips;
}

app.get("/api/proxmox/guest/:node/:type/:vmid", async (req, res) => {
  const pm = readConfig().proxmox || {};
  if (!pm.enabled || !pm.url || !pm.tokenId || !pm.tokenSecret) {
    return res.status(400).json({ error: "Proxmox not configured", detail: "enable it in Settings → Proxmox" });
  }
  const { node, type, vmid } = req.params;
  if (type !== "qemu" && type !== "lxc") {
    return res.status(400).json({ error: "invalid guest type", detail: "type must be qemu or lxc" });
  }
  if (!/^\d+$/.test(vmid)) {
    return res.status(400).json({ error: "invalid vmid", detail: "vmid must be a number" });
  }

  try {
    const base = normalizeUrl(pm.url).replace(/\/$/, "");
    const options = {
      method: "GET",
      headers: { Authorization: `PVEAPIToken=${pm.tokenId}=${pm.tokenSecret}` },
      timeout: 8000
    };
    if (/^https:/i.test(base)) options.agent = proxmoxAgent;

    let ips = [];
    if (type === "lxc") {
      const r = await fetch(`${base}/api2/json/nodes/${encodeURIComponent(node)}/lxc/${vmid}/interfaces`, options);
      if (!r.ok) {
        return res.status(502).json({
          error: `Proxmox API returned ${r.status}`
        });
      }
      const payload = await r.json();
      ips = lxcInterfaceIps(payload.data);
    } else {
      try {
        const r = await fetch(`${base}/api2/json/nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/network-get-interfaces`, options);
        if (r.ok) {
          const payload = await r.json();
          for (const iface of Array.isArray(payload.data) ? payload.data : []) {
            for (const a of Array.isArray(iface && iface["ip-addresses"]) ? iface["ip-addresses"] : []) {
              const addr = a && a["ip-address"];
              if (!addr || skipLocalIps(addr) || ips.includes(addr)) continue;
              ips.push(String(addr).trim());
            }
          }
        }
      } catch {
        
      }
    }

    res.json({ ips });
  } catch (err) {
    res.status(500).json({ error: "failed to read Proxmox guest" });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.use((req, res) => {
  res.status(404).json({ error: "not found" });
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(err.status || 500).json({
    error: err.message || "internal server error",
    ...(process.env.NODE_ENV === "production" ? {} : { detail: String(err.stack) }),
  });
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  shutdown("uncaughtException", 1);
});

let shuttingDown = false;
function shutdown(reason, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${reason} received, shutting down gracefully...`);
  const forceTimer = setTimeout(() => process.exit(code), 10000);
  forceTimer.unref();
  server?.close(() => {
    console.log("Server closed.");
    process.exit(code);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

let server;
if (require.main === module) {
  ensureConfig();
  server = app.listen(PORT, () => {
    console.log(`Homelab dashboard listening on port ${PORT}`);
  });
}

module.exports = { app, mapNextcloudInfo, parseDockerPort, probeResponseIsAvailable, serviceCredentialError, safeSettingsBackup };
