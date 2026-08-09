
let CONFIG = null;
const wizardSelected = new Map(); 
let dragServiceId = null;
let settingsPick = null;
const SERVICE_CATEGORIES = ["Media","Downloads","Network","Management","Automation","Files","Security","Monitoring","Infrastructure","Dev","Productivity","Other"];



async function boot() {
  const res = await fetch("/api/config");
  CONFIG = await res.json();

  if (!CONFIG.setupComplete) {
    document.getElementById("wizard").classList.remove("hidden");
    initWizard();
  } else {
    document.getElementById("dashboard").classList.remove("hidden");
    initDashboard();
  }
}



function initWizard() {
  let step = 1;
  const steps = document.querySelectorAll(".wizard-step");
  const rail = document.querySelectorAll(".rail-step");

  function showStep(n) {
    step = n;
    steps.forEach((s) => (s.hidden = Number(s.dataset.step) !== n));
    rail.forEach((r) => {
      const rs = Number(r.dataset.step);
      r.classList.toggle("active", rs === n);
      r.classList.toggle("done", rs < n);
    });
  }

  document.querySelectorAll("[data-next]").forEach((btn) =>
    btn.addEventListener("click", () => showStep(Math.min(step + 1, 6)))
  );
  document.querySelectorAll("[data-prev]").forEach((btn) =>
    btn.addEventListener("click", () => showStep(Math.max(step - 1, 1)))
  );

  document.querySelectorAll('input[name="hostMode"]').forEach((radio) =>
    radio.addEventListener("change", () => {
      document.getElementById("proxmoxWizardFields").classList.toggle("hidden", radio.value !== "proxmox" || !radio.checked);
    })
  );

  renderCatalog("");
  document.getElementById("catalogSearch").addEventListener("input", (e) => {
    renderCatalog(e.target.value);
  });

  document.getElementById("showCustomForm").addEventListener("click", () => {
    document.getElementById("customForm").classList.toggle("hidden");
  });
  document.getElementById("addCustomService").addEventListener("click", addCustomService);

  setupWeatherSearch("weatherSearch", "weatherResults", (chosen) => {
    const box = document.getElementById("weatherChosen");
    const unit = unitForCountry(chosen.country_code);
    box.classList.remove("hidden");
    box.textContent = `📍 ${chosen.name}${chosen.admin1 ? ", " + chosen.admin1 : ""}${chosen.country ? ", " + chosen.country : ""} · ${unitSymbol(unit)}`;
    box.dataset.lat = chosen.latitude;
    box.dataset.lon = chosen.longitude;
    box.dataset.unit = unit;
    box.dataset.name = `${chosen.name}${chosen.admin1 ? ", " + chosen.admin1 : ""}`;
  });

  renderRssEditor("rssList", CONFIG.rss.feeds);
  document.getElementById("addRssBtn").addEventListener("click", () => {
    const input = document.getElementById("rssInput");
    if (input.value.trim()) {
      CONFIG.rss.feeds.push(input.value.trim());
      input.value = "";
      renderRssEditor("rssList", CONFIG.rss.feeds);
    }
  });

  document.getElementById("piholeEnabled").addEventListener("change", (e) => {
    document.getElementById("piholeFields").classList.toggle("hidden", !e.target.checked);
  });

  document.getElementById("adguardEnabled").addEventListener("change", (e) => {
    document.getElementById("adguardFields").classList.toggle("hidden", !e.target.checked);
  });

  document.getElementById("adguardMode").addEventListener("change", (e) => {
    applyAdguardModeUi("adguard");
  });

  document.getElementById("finishSetup").addEventListener("click", finishSetup);

  showStep(1);
}

function applyAdguardModeUi(prefix) {
  const glinet = document.getElementById(prefix + "Mode").value === "glinet";
  document.getElementById(prefix + "ModeHint").textContent = glinet
    ? "GL.iNet router: AdGuard runs with --glinet, so enter the router's admin username & password (username is usually \"root\")."
    : "Standard AdGuard Home: use the username & password from AdGuard's own admin.";
  document.getElementById(prefix + "User").placeholder = glinet
    ? "Router username (usually root)"
    : "Username (e.g. admin)";
}

function renderCatalog(filter) {
  const grid = document.getElementById("catalogGrid");
  grid.innerHTML = "";
  const f = filter.toLowerCase();
  SERVICE_CATALOG.filter((s) => s.name.toLowerCase().includes(f)).forEach((s) => {
    const iconUrl = `https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/${s.slug}.png`;
    const el = document.createElement("div");
    el.className = "catalog-item" + (wizardSelected.has(s.name) ? " selected" : "");
    el.innerHTML = `<img src="${iconUrl}" onerror="this.style.display='none'" /><span>${s.name}</span>`;
    el.addEventListener("click", () => {
      if (wizardSelected.has(s.name)) {
        wizardSelected.delete(s.name);
      } else {
        wizardSelected.set(s.name, {
          name: s.name,
          url: "",
          icon: iconUrl,
          category: s.category
        });
      }
      renderCatalog(filter);
      renderSelected();
    });
    grid.appendChild(el);
  });
}

async function addCustomService() {
  const name = document.getElementById("customName").value.trim();
  const url = document.getElementById("customUrl").value.trim();
  if (!name) return;
  let icon = null;
  try {
    const r = await fetch(`/api/resolve-icon?name=${encodeURIComponent(name)}&url=${encodeURIComponent(url)}`);
    const data = await r.json();
    icon = data.icon;
  } catch {}
  wizardSelected.set(name, { name, url, icon, category: "Other" });
  document.getElementById("customName").value = "";
  document.getElementById("customUrl").value = "";
  document.getElementById("customForm").classList.add("hidden");
  renderSelected();
}

function renderSelected() {
  const list = document.getElementById("selectedList");
  const count = document.getElementById("selectedCount");
  count.textContent = `(${wizardSelected.size})`;
  list.innerHTML = "";
  wizardSelected.forEach((svc, name) => {
    const chip = document.createElement("div");
    chip.className = "selected-chip";
    chip.innerHTML = `
      ${svc.icon ? `<img src="${svc.icon}" onerror="this.style.display='none'" />` : ""}
      <span>${svc.name}</span>
      <input class="chip-url" placeholder="IP or URL" value="${svc.url || ""}" />
      <button title="Remove">✕</button>
    `;
    chip.querySelector(".chip-url").addEventListener("input", (e) => {
      svc.url = e.target.value;
    });
    chip.querySelector("button").addEventListener("click", () => {
      wizardSelected.delete(name);
      renderSelected();
      renderCatalog(document.getElementById("catalogSearch").value);
    });
    list.appendChild(chip);
  });
}

function renderRssEditor(containerId, feeds, onChange) {
  const el = document.getElementById(containerId);
  el.innerHTML = "";
  feeds.forEach((feed, idx) => {
    const row = document.createElement("div");
    row.className = "rss-edit-item";
    row.innerHTML = `<span>${escapeHtml(feed)}</span><button>✕</button>`;
    row.querySelector("button").addEventListener("click", () => {
      feeds.splice(idx, 1);
      renderRssEditor(containerId, feeds, onChange);
      if (onChange) onChange();
    });
    el.appendChild(row);
  });
}

function setupWeatherSearch(inputId, resultsId, onChoose) {
  const input = document.getElementById(inputId);
  const results = document.getElementById(resultsId);
  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) {
      results.innerHTML = "";
      return;
    }
    timer = setTimeout(async () => {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const data = await r.json();
      results.innerHTML = "";
      data.forEach((place) => {
        const item = document.createElement("div");
        item.className = "weather-result-item";
        item.textContent = `${place.name}${place.admin1 ? ", " + place.admin1 : ""}${place.country ? ", " + place.country : ""}`;
        item.addEventListener("click", () => {
          onChoose(place);
          results.innerHTML = "";
          input.value = item.textContent;
        });
        results.appendChild(item);
      });
    }, 350);
  });
}

async function finishSetup() {
  const name = document.getElementById("setupName").value.trim();
  const services = Array.from(wizardSelected.values()).filter((s) => s.name);

  const weatherBox = document.getElementById("weatherChosen");
  const weather = weatherBox.classList.contains("hidden")
    ? { locationName: "", latitude: null, longitude: null, unit: "fahrenheit" }
    : {
        locationName: weatherBox.dataset.name,
        latitude: parseFloat(weatherBox.dataset.lat),
        longitude: parseFloat(weatherBox.dataset.lon),
        unit: weatherBox.dataset.unit === "celsius" ? "celsius" : "fahrenheit"
      };

  const piholeEnabled = document.getElementById("piholeEnabled").checked;
  const pihole = {
    enabled: piholeEnabled,
    url: document.getElementById("piholeUrl").value.trim(),
    apiKey: document.getElementById("piholeKey").value.trim()
  };

  const adguardEnabled = document.getElementById("adguardEnabled").checked;
  const adguard = {
    enabled: adguardEnabled,
    url: document.getElementById("adguardUrl").value.trim(),
    username: document.getElementById("adguardUser").value.trim(),
    password: document.getElementById("adguardPass").value,
    authMode: document.getElementById("adguardMode").value
  };

  const hostMode = document.querySelector('input[name="hostMode"]:checked').value;
  const proxmox = {
    enabled: hostMode === "proxmox",
    url: document.getElementById("setupProxmoxUrl").value.trim(),
    tokenId: document.getElementById("setupProxmoxTokenId").value.trim(),
    tokenSecret: document.getElementById("setupProxmoxTokenSecret").value
  };

  const body = {
    profile: { name },
    services,
    weather,
    rss: { feeds: CONFIG.rss.feeds },
    pihole,
    adguard,
    proxmox
  };

  const res = await fetch("/api/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  CONFIG = await res.json();

  document.getElementById("wizard").classList.add("hidden");
  document.getElementById("dashboard").classList.remove("hidden");
  initDashboard();
}



function initDashboard() {
  renderGreeting();
  startClock();
  renderCalendar();
  renderServices();
  refreshStats();
  refreshWeather();
  refreshRss();
  refreshPihole();
  refreshAdguard();
  refreshProxmox();
  refreshPorts();

  setInterval(refreshStats, 5000);
  setInterval(refreshPihole, 30000);
  setInterval(refreshAdguard, 30000);
  setInterval(refreshProxmox, 60000);
  setInterval(refreshWeather, 10 * 60 * 1000);
  setInterval(refreshRss, 15 * 60 * 1000);
  setInterval(refreshPorts, 30000);
  setInterval(refreshAllStatuses, 15000);

  document.getElementById("serviceSearch").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll(".service-tile").forEach((tile) => {
      tile.style.display = tile.dataset.name.includes(q) ? "" : "none";
    });
  });

  document.getElementById("portsSearch").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll("#portsTableBody tr").forEach((row) => {
      row.style.display = row.dataset.filter.includes(q) ? "" : "none";
    });
  });

  document.getElementById("settingsBtn").addEventListener("click", openSettings);
  document.getElementById("closeSettings").addEventListener("click", closeSettings);
  document.getElementById("emptyAddBtn")?.addEventListener("click", openAddService);
  document.getElementById("addServiceBtn")?.addEventListener("click", openAddService);

  document.addEventListener("click", (e) => {
    const st = e.target.closest(".stats-toggle");
    if (st) {
      const extra = document.getElementById("statsExtra");
      const nowHidden = extra.classList.toggle("hidden");
      st.textContent = nowHidden ? "Show all ▾" : "Collapse ▴";
      localStorage.setItem("hdash.statsExpanded", nowHidden ? "0" : "1");
      return;
    }
    const btn = e.target.closest(".blocker-toggle");
    if (btn) {
      const panel = btn.closest(".blocker-panel");
      const details = panel?.querySelector(".blocker-details");
      if (!details) return;
      const nowHidden = details.classList.toggle("hidden");
      btn.textContent = nowHidden ? "▸" : "▾";
      btn.setAttribute("aria-expanded", String(!nowHidden));
      localStorage.setItem(`hdash.expanded.${panel.id}`, nowHidden ? "0" : "1");
      return;
    }
    const gbtn = e.target.closest(".guest-expand");
    if (gbtn) {
      const row = gbtn.closest(".guest-item");
      if (!row) return;
      const vmid = row.dataset.vmid;
      toggleGuestDetails(row, gbtn, vmid);
    }
  });

  initSettingsModal();
}

function renderGreeting() {
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  document.getElementById("greetingText").textContent = greet;
  document.getElementById("greetingName").textContent = CONFIG.profile?.name || "";
}

function startClock() {
  function tick() {
    const now = new Date();
    document.getElementById("clockTime").textContent = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    document.getElementById("clockDate").textContent = now.toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }
  tick();
  setInterval(tick, 1000);
}

function renderCalendar() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();

  document.getElementById("calMonthLabel").textContent = now.toLocaleDateString([], {
    month: "long",
    year: "numeric"
  });

  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = "";
  ["S", "M", "T", "W", "T", "F", "S"].forEach((d) => {
    const el = document.createElement("div");
    el.className = "cal-dow";
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement("div");
    el.className = "cal-day empty";
    grid.appendChild(el);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const el = document.createElement("div");
    el.className = "cal-day" + (d === today ? " today" : "");
    el.textContent = d;
    grid.appendChild(el);
  }
}

function fmtBytes(bytes) {
  if (bytes == null) return "--";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return gb.toFixed(1) + " GB";
  return (bytes / 1024 ** 2).toFixed(0) + " MB";
}

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function meterClass(pct) {
  if (pct >= 85) return "danger";
  if (pct >= 65) return "warn";
  return "";
}

const STAT_CATALOG = [
  { key: "cpu", label: "CPU Load" },
  { key: "memory", label: "Memory" },
  { key: "swap", label: "Swap" },
  { key: "disk", label: "Disk" },
  { key: "temp", label: "CPU Temp" },
  { key: "load", label: "Load Avg" },
  { key: "network", label: "Network" },
  { key: "uptime", label: "Uptime" },
  { key: "localip", label: "Local IP" },
  { key: "docker", label: "Docker" }
];
const DEFAULT_PINNED = ["cpu", "memory", "swap", "disk", "temp", "load"];

function pinnedStats() {
  const list = Array.isArray(CONFIG.system?.pinnedStats) ? CONFIG.system.pinnedStats : DEFAULT_PINNED;
  return list.slice(0, 6);
}

async function refreshStats() {
  try {
    const r = await fetch("/api/system");
    const s = await r.json();
    const strip = document.getElementById("statsStrip");
    const extra = document.getElementById("statsExtra");
    const toggle = document.getElementById("statsToggle");

    const cpuPct = s.cpu?.loadPct ?? 0;
    const ramPct = s.mem?.usedPct ?? 0;
    const swapPct = s.swap?.usedPct ?? 0;
    const diskPct = s.disk?.usedPct ?? null;
    const temp = s.temp?.main;
    const net = s.network;

    const cards = {
      cpu: `
      <div class="stat-card">
        <div class="stat-label">CPU Load</div>
        <div class="stat-value">${cpuPct.toFixed(1)}%</div>
        <div class="stat-sub">${s.cpu?.cores || "?"} cores · ${s.cpu?.brand || ""}</div>
        <div class="meter"><div class="meter-fill ${meterClass(cpuPct)}" style="width:${cpuPct}%"></div></div>
      </div>`,
      memory: `
      <div class="stat-card">
        <div class="stat-label">Memory</div>
        <div class="stat-value">${ramPct.toFixed(1)}%</div>
        <div class="stat-sub">${fmtBytes(s.mem?.used)} / ${fmtBytes(s.mem?.total)}</div>
        <div class="meter"><div class="meter-fill ${meterClass(ramPct)}" style="width:${ramPct}%"></div></div>
      </div>`,
      swap: `
      <div class="stat-card">
        <div class="stat-label">Swap</div>
        <div class="stat-value">${s.swap?.total ? swapPct.toFixed(1) + "%" : "--"}</div>
        <div class="stat-sub">${s.swap?.total ? `${fmtBytes(s.swap.used)} / ${fmtBytes(s.swap.total)}` : "no swap configured"}</div>
        <div class="meter"><div class="meter-fill ${meterClass(swapPct)}" style="width:${swapPct}%"></div></div>
      </div>`,
      disk: `
      <div class="stat-card">
        <div class="stat-label">Disk</div>
        <div class="stat-value">${diskPct != null ? diskPct.toFixed(1) + "%" : "--"}</div>
        <div class="stat-sub">${s.disk ? `${fmtBytes(s.disk.free)} free of ${fmtBytes(s.disk.size)}` : "unavailable"}</div>
        <div class="meter"><div class="meter-fill ${meterClass(diskPct || 0)}" style="width:${diskPct || 0}%"></div></div>
      </div>`,
      temp: `
      <div class="stat-card">
        <div class="stat-label">CPU Temp</div>
        <div class="stat-value">${temp && temp > 0 ? temp.toFixed(0) + "°C" : "--"}</div>
        <div class="stat-sub">${s.hostname || s.os || ""}</div>
      </div>`,
      load: `
      <div class="stat-card">
        <div class="stat-label">Load Avg</div>
        <div class="stat-value">${s.loadAvg?.["1m"] ?? "--"}</div>
        <div class="stat-sub">5m ${s.loadAvg?.["5m"] ?? "--"} · 15m ${s.loadAvg?.["15m"] ?? "--"}</div>
      </div>`,
      network: `
      <div class="stat-card">
        <div class="stat-label">Network</div>
        <div class="stat-value">${net?.rxSec != null ? fmtBytes(net.rxSec + net.txSec) + "/s" : "--"}</div>
        <div class="stat-sub">↓ ${net?.rxSec != null ? fmtBytes(net.rxSec) : "--"}/s · ↑ ${net?.txSec != null ? fmtBytes(net.txSec) : "--"}/s</div>
      </div>`,
      uptime: `
      <div class="stat-card">
        <div class="stat-label">Uptime</div>
        <div class="stat-value">${fmtUptime(s.uptimeSec || 0)}</div>
        <div class="stat-sub">since last reboot</div>
      </div>`,
      localip: `
      <div class="stat-card">
        <div class="stat-label">Local IP</div>
        <div class="stat-value" style="font-size:16px;">${s.localIp || "--"}</div>
        <div class="stat-sub">${s.kernel || s.os || ""}</div>
      </div>`
    };
    if (s.docker) {
      cards.docker = `
      <div class="stat-card">
        <div class="stat-label">Docker</div>
        <div class="stat-value">${s.docker.running}/${s.docker.total}</div>
        <div class="stat-sub">containers running</div>
      </div>`;
    }

    const pinned = pinnedStats().filter((k) => cards[k]);
    const rest = STAT_CATALOG.map((s) => s.key).filter((k) => cards[k] && !pinned.includes(k));

    strip.innerHTML = pinned.map((k) => cards[k]).join("");
    extra.innerHTML = rest.map((k) => cards[k]).join("");

    if (rest.length) {
      const expanded = localStorage.getItem("hdash.statsExpanded") === "1";
      extra.classList.toggle("hidden", !expanded);
      toggle.classList.remove("hidden");
      toggle.textContent = expanded ? "Collapse ▴" : "Show all ▾";
    } else {
      extra.classList.add("hidden");
      toggle.classList.add("hidden");
    }
  } catch (err) {
    console.error("stats failed", err);
  }
}

function fmtNum(n) {
  const v = Number(String(n).replace(/,/g, "")) || 0;
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(v);
}

function fmt(n) {
  return n == null ? "--" : fmtNum(n);
}

function friendlyName(name) {
  const s = String(name || "");
  const idx = s.indexOf("|");
  return idx > 0 ? s.slice(0, idx) : s || "—";
}

function unitForCountry(code) {
  const fahrenheit = new Set(["US", "BS", "KY", "LR", "PW", "FM", "MH", "AS", "GU", "MP", "VI", "PR", "TC"]);
  return fahrenheit.has(String(code || "").toUpperCase()) ? "fahrenheit" : "celsius";
}

function unitSymbol(unit) {
  return unit === "celsius" ? "°C" : "°F";
}

function renderDnsGraph(graph) {
  const queries = graph?.queries;
  const labels = graph?.labels || [];
  if (!Array.isArray(queries) || !queries.length) {
    return `<div class="dns-graph"><div class="dns-graph-empty">24h history unavailable</div></div>`;
  }
  const n = queries.length;
  const blocked = Array.isArray(graph?.blocked) && graph.blocked.length === n
    ? graph.blocked
    : queries.map(() => 0);
  const max = Math.max(...queries, ...blocked, 1);

  const bars = queries
    .map((qv, i) => {
      const bv = blocked[i];
      return `
        <div class="dns-bar">
          <span class="dns-bar-tip">${escapeHtml(labels[i] || "")} · ${fmtNum(qv)} queries · ${fmtNum(bv)} blocked</span>
          <div class="dns-bar-blocked" style="height:${Math.round((bv / max) * 100)}%"></div>
          <div class="dns-bar-queries" style="height:${Math.round((qv / max) * 100)}%"></div>
        </div>`;
    })
    .join("");

  return `
    <div class="dns-graph">
      <div class="dns-graph-legend">
        <span class="dns-legend"><i class="dns-swatch dns-swatch-queries"></i>Queries</span>
        <span class="dns-legend"><i class="dns-swatch dns-swatch-blocked"></i>Blocked</span>
      </div>
      <div class="dns-graph-body">
        <div class="dns-graph-y">${fmtNum(max)}</div>
        <div class="dns-graph-bars">${bars}</div>
      </div>
      <div class="dns-graph-x"><span>${escapeHtml(labels[0] || "")}</span><span>${escapeHtml(labels[n - 1] || "")}</span></div>
    </div>`;
}

function renderTopList(title, items, opts) {
  if (!items || !items.length) {
    return `<div class="dns-list"><div class="dns-list-head">${title}</div><div class="dns-list-empty">No data</div></div>`;
  }
  const max = Math.max(...items.map((i) => i.count), 1);
  const rows = items
    .map((i) => {
      const pct = Math.round((i.count / max) * 100);
      const blockedCell = opts?.blocked && i.blocked != null
        ? `<span class="dns-count dns-count-blocked" title="blocked">${fmtNum(i.blocked)}</span>`
        : "";
      return `
        <div class="dns-row" title="${escapeHtml(i.name)}">
          <span class="dns-name">${escapeHtml(friendlyName(i.name))}</span>
          <span class="dns-meter"><span style="width:${pct}%"></span></span>
          <span class="dns-count">${fmtNum(i.count)}</span>
          ${blockedCell}
        </div>`;
    })
    .join("");
  return `
    <div class="dns-list">
      <div class="dns-list-head">${title}</div>
      ${rows}
    </div>`;
}

function renderBlockerPanel(panel, data) {
  const expanded = localStorage.getItem(`hdash.expanded.${panel.id}`) === "1";
  panel.classList.remove("hidden");
  panel.innerHTML = `
    <div class="blocker-head">
      <div class="blocker-title">${data.title}</div>
      <button class="blocker-toggle" type="button" aria-expanded="${expanded}" title="More details">${expanded ? "▾" : "▸"}</button>
    </div>
    <div class="blocker-strip">${data.cells}</div>
    <div class="blocker-graph">${renderDnsGraph(data.graph)}</div>
    <div class="blocker-details${expanded ? "" : " hidden"}">
      <div class="dns-lists">
        ${renderTopList("Top Clients", data.topClients, { blocked: true })}
        ${renderTopList("Top Blocked", data.topBlocked)}
        ${renderTopList("Top Allowed", data.topAllowed)}
      </div>
    </div>`;
}

async function refreshPihole() {
  const panel = document.getElementById("piholeStrip");
  if (!CONFIG.pihole?.enabled) {
    panel.classList.add("hidden");
    return;
  }
  try {
    const r = await fetch("/api/pihole");
    if (!r.ok) throw new Error("pihole unavailable");
    const d = await r.json();
    renderBlockerPanel(panel, {
      title: "PI-HOLE",
      cells: `
        <div><div class="ph-label">Status</div><div class="ph-value">${d.status === "enabled" ? "🟢 Active" : "🔴 Paused"}</div></div>
        <div><div class="ph-label">Queries Today</div><div class="ph-value">${fmt(d.queriesToday)}</div></div>
        <div><div class="ph-label">Blocked Today</div><div class="ph-value">${fmt(d.blockedToday)}</div></div>
        <div><div class="ph-label">Blocked %</div><div class="ph-value">${d.blockedPct != null ? Number(d.blockedPct).toFixed(1) + "%" : "--"}</div></div>
        <div><div class="ph-label">Blocklist Size</div><div class="ph-value">${fmt(d.domainsOnBlocklist)}</div></div>`,
      graph: d.graph,
      topClients: d.topClients,
      topBlocked: d.topBlocked,
      topAllowed: d.topAllowed
    });
  } catch {
    panel.classList.add("hidden");
  }
}

async function refreshAdguard() {
  const panel = document.getElementById("adguardStrip");
  if (!CONFIG.adguard?.enabled) {
    panel.classList.add("hidden");
    return;
  }
  try {
    const r = await fetch("/api/adguard");
    if (!r.ok) throw new Error("adguard unavailable");
    const d = await r.json();
    renderBlockerPanel(panel, {
      title: "ADGUARD HOME",
      cells: `
        <div><div class="ph-label">Status</div><div class="ph-value">${d.protectionEnabled ? "🟢 Active" : "🔴 Paused"}</div></div>
        <div><div class="ph-label">Queries Today</div><div class="ph-value">${fmt(d.queriesToday)}</div></div>
        <div><div class="ph-label">Blocked Today</div><div class="ph-value">${fmt(d.blockedToday)}</div></div>
        <div><div class="ph-label">Blocked %</div><div class="ph-value">${d.blockedPct != null ? Number(d.blockedPct).toFixed(1) + "%" : "--"}</div></div>
        <div><div class="ph-label">Blocklist Size</div><div class="ph-value">${fmt(d.blocklistSize)}</div></div>
        <div><div class="ph-label">Avg Response</div><div class="ph-value">${d.avgProcessingMs != null ? d.avgProcessingMs + " ms" : "--"}</div></div>`,
      graph: d.graph,
      topClients: d.topClients,
      topBlocked: d.topBlocked,
      topAllowed: d.topAllowed
    });
  } catch {
    panel.classList.add("hidden");
  }
}

const proxmoxGuestCache = new Map();
const PROXMOX_GUESTS_KEY = "hdash.expanded.proxmoxGuests";

function expandedGuestVmids() {
  try {
    const v = JSON.parse(localStorage.getItem(PROXMOX_GUESTS_KEY) || "[]");
    return Array.isArray(v) ? new Set(v) : new Set();
  } catch {
    return new Set();
  }
}

function setExpandedGuestVmid(vmid, open) {
  const set = expandedGuestVmids();
  if (open) set.add(String(vmid));
  else set.delete(String(vmid));
  localStorage.setItem(PROXMOX_GUESTS_KEY, JSON.stringify([...set]));
}

async function toggleGuestDetails(row, btn, vmid) {
  const details = row.querySelector(".guest-details");
  if (!details) return;
  const opening = details.classList.contains("hidden");
  details.classList.toggle("hidden", !opening);
  btn.textContent = opening ? "▾" : "▸";
  setExpandedGuestVmid(vmid, opening);
  if (opening) {
    const ipEl = details.querySelector(".guest-ips");
    if (!ipEl) return;
    const node = row.dataset.node;
    const type = row.dataset.type;
    const cacheKey = `${node}/${type}/${vmid}`;
    if (proxmoxGuestCache.has(cacheKey)) {
      ipEl.textContent = proxmoxGuestCache.get(cacheKey);
      return;
    }
    ipEl.textContent = "…";
    try {
      const r = await fetch(`/api/proxmox/guest/${encodeURIComponent(node)}/${type}/${vmid}`);
      if (!r.ok) throw new Error("guest unavailable");
      const g = await r.json();
      const ips = Array.isArray(g.ips) && g.ips.length ? g.ips.join(", ") : "—";
      proxmoxGuestCache.set(cacheKey, ips);
      ipEl.textContent = ips;
    } catch {
      ipEl.textContent = "—";
    }
  }
}

function renderProxmoxPanel(panel, d) {
  const expanded = localStorage.getItem(`hdash.expanded.${panel.id}`) === "1";
  const running = d.guests.filter((g) => g.status === "running");
  const vms = d.guests.filter((g) => g.type === "qemu");
  const cts = d.guests.filter((g) => g.type === "lxc");
  const openVmids = expandedGuestVmids();

  const rows = d.guests.length
    ? d.guests
        .map((g) => {
          const on = g.status === "running";
          const meta = `${g.type === "lxc" ? "CT" : "VM"} ${g.vmid}${g.node ? " · " + g.node : ""}`;
          const stats = on
            ? `${g.cpuPct != null ? g.cpuPct + "% CPU" : "–"} · ${fmtBytes(g.memUsed)} / ${fmtBytes(g.memMax)}`
            : "stopped";
          const open = on && openVmids.has(String(g.vmid));
          const diskPct =
            g.disk != null && g.maxDisk > 0 ? Math.min(100, Math.round((g.disk / g.maxDisk) * 100)) : null;
          const detail = on
            ? `<div class="guest-details${open ? "" : " hidden"}">
                <div class="guest-detail-line"><span class="gd-label">IP</span><span class="guest-ips gd-value">…</span></div>
                <div class="guest-detail-line"><span class="gd-label">Disk</span><span class="gd-value">${fmtBytes(g.disk)} / ${fmtBytes(g.maxDisk)}${diskPct != null ? ` (${diskPct}%)` : ""}</span></div>
                <div class="guest-detail-line"><span class="gd-label">Net</span><span class="gd-value">↓ ${fmtBytes(g.netIn)} · ↑ ${fmtBytes(g.netOut)}</span></div>
                <div class="guest-detail-line"><span class="gd-label">Uptime</span><span class="gd-value">${fmtUptime(g.uptime)}</span></div>
              </div>`
            : "";
          return `
            <div class="guest-item" data-vmid="${g.vmid}" data-node="${escapeHtml(g.node)}" data-type="${g.type}">
              <div class="dns-row">
                <span class="dns-name">
                  <span class="guest-dot ${on ? "online" : "offline"}"></span>
                  ${escapeHtml(g.name || "guest")}
                  <span class="guest-meta">${meta}</span>
                </span>
                <span class="dns-count">${stats}</span>
                <button class="guest-expand" type="button" title="${on ? "Guest details" : "Guest is stopped"}" ${on ? "" : "disabled"}>${open ? "▾" : "▸"}</button>
              </div>
              ${detail}
            </div>`;
        })
        .join("")
    : `<div class="dns-list-empty">No guests found</div>`;

  panel.classList.remove("hidden");
  panel.innerHTML = `
    <div class="blocker-head">
      <div class="blocker-title">PROXMOX</div>
      <button class="blocker-toggle" type="button" aria-expanded="${expanded}" title="More details">${expanded ? "▾" : "▸"}</button>
    </div>
    <div class="blocker-strip">
      <div><div class="ph-label">Nodes</div><div class="ph-value">${d.nodes.length}</div></div>
      <div><div class="ph-label">VMs Running</div><div class="ph-value">${running.filter((g) => g.type === "qemu").length}/${vms.length}</div></div>
      <div><div class="ph-label">CTs Running</div><div class="ph-value">${running.filter((g) => g.type === "lxc").length}/${cts.length}</div></div>
      <div><div class="ph-label">Total Guests</div><div class="ph-value">${d.guests.length}</div></div>
    </div>
    <div class="blocker-details${expanded ? "" : " hidden"}">
      <div class="dns-list">
        <div class="dns-list-head">Guests (VMs &amp; LXC) <span class="dns-list-hint">click ▸ for IP · disk · net</span></div>
        ${rows}
      </div>
    </div>`;
}

async function refreshProxmox() {
  const panel = document.getElementById("proxmoxStrip");
  if (!CONFIG.proxmox?.enabled) {
    panel.classList.add("hidden");
    return;
  }
  try {
    const r = await fetch("/api/proxmox");
    if (!r.ok) throw new Error("proxmox unavailable");
    const d = await r.json();
    renderProxmoxPanel(panel, d);
  } catch {
    panel.classList.add("hidden");
  }
}

const WEATHER_CODES = {
  0: "☀️ Clear", 1: "🌤️ Mostly clear", 2: "⛅ Partly cloudy", 3: "☁️ Overcast",
  45: "🌫️ Fog", 48: "🌫️ Fog",
  51: "🌦️ Light drizzle", 53: "🌦️ Drizzle", 55: "🌧️ Heavy drizzle",
  61: "🌧️ Light rain", 63: "🌧️ Rain", 65: "🌧️ Heavy rain",
  71: "🌨️ Light snow", 73: "🌨️ Snow", 75: "❄️ Heavy snow",
  80: "🌦️ Showers", 81: "🌧️ Showers", 82: "⛈️ Violent showers",
  95: "⛈️ Thunderstorm", 96: "⛈️ Thunderstorm", 99: "⛈️ Severe storm"
};

async function refreshWeather() {
  const body = document.getElementById("weatherBody");
  if (!CONFIG.weather?.latitude) {
    body.textContent = "Set a location in Settings";
    return;
  }
  try {
    const r = await fetch("/api/weather");
    if (!r.ok) throw new Error();
    const d = await r.json();
    const desc = WEATHER_CODES[d.current?.weather_code] || "";
    const unitLabel = d.unit === "celsius" ? "°C" : "°F";
    body.innerHTML = `
      <div class="weather-loc">${d.locationName}</div>
      <div class="weather-temp">${Math.round(d.current?.temperature_2m)}${unitLabel}</div>
      <div>${desc}</div>
      <div class="weather-range">H: ${Math.round(d.todayHigh)}° &nbsp; L: ${Math.round(d.todayLow)}°</div>
    `;
  } catch {
    body.textContent = "Weather unavailable";
  }
}

async function refreshRss() {
  const body = document.getElementById("rssBody");
  try {
    const r = await fetch("/api/rss");
    const items = await r.json();
    if (!items.length) {
      body.textContent = "No news items right now.";
      return;
    }
    body.innerHTML = items
      .map(
        (it) => `
      <a class="rss-item" href="${it.link}" target="_blank" rel="noopener">
        <div class="rss-item-title">${escapeHtml(it.title)}</div>
        <div class="rss-item-meta">${escapeHtml(it.source || "")}</div>
      </a>`
      )
      .join("");
  } catch {
    body.textContent = "Feed unavailable";
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2200);
}

function toastResult(res, okMsg) {
  showToast(res.ok ? okMsg : "Save failed");
  return res.ok;
}

function renderServices() {
  const grid = document.getElementById("servicesGrid");
  const empty = document.getElementById("emptyState");
  grid.innerHTML = "";

  if (!CONFIG.services.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  const groups = new Map();
  CONFIG.services.forEach((svc) => {
    const cat = (svc.category || "Other").trim() || "Other";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(svc);
  });
  const order = [...groups.keys()].sort((a, b) => {
    const ia = SERVICE_CATEGORIES.indexOf(a);
    const ib = SERVICE_CATEGORIES.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  order.forEach((cat) => {
    const group = document.createElement("div");
    group.className = "svc-group";
    group.dataset.cat = cat;
    const head = document.createElement("div");
    head.className = "svc-cat-head";
    head.innerHTML = `${escapeHtml(cat)}<span class="svc-count">${groups.get(cat).length}</span>`;
    group.appendChild(head);
    const sub = document.createElement("div");
    sub.className = "services-grid";
    groups.get(cat).forEach((svc) => sub.appendChild(makeServiceTile(svc)));
    group.appendChild(sub);

    group.addEventListener("dragenter", (e) => {
      if (!dragServiceId) return;
      e.preventDefault();
      group.classList.add("drag-over");
    });
    group.addEventListener("dragover", (e) => {
      if (!dragServiceId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    group.addEventListener("dragleave", (e) => {
      if (e.relatedTarget && group.contains && group.contains(e.relatedTarget)) return;
      group.classList.remove("drag-over");
    });
    group.addEventListener("drop", (e) => {
      e.preventDefault();
      group.classList.remove("drag-over");
      if (!dragServiceId) return;
      const from = CONFIG.services.findIndex((s) => s.id === dragServiceId);
      if (from === -1) return;
      if ((CONFIG.services[from].category || "Other").trim() === cat) return;
      moveServiceToCategory(dragServiceId, cat);
      persistServiceOrder();
    });

    grid.appendChild(group);
  });
}

function moveServiceToCategory(id, cat) {
  const from = CONFIG.services.findIndex((s) => s.id === id);
  if (from === -1) return;
  const [moved] = CONFIG.services.splice(from, 1);
  moved.category = cat;
  let insertAt = CONFIG.services.length;
  for (let i = CONFIG.services.length - 1; i >= 0; i--) {
    if ((CONFIG.services[i].category || "Other").trim() === cat) {
      insertAt = i + 1;
      break;
    }
  }
  CONFIG.services.splice(insertAt, 0, moved);
}

function makeServiceTile(svc) {
  const tile = document.createElement("a");
  tile.href = svc.url && !/^https?:\/\//i.test(svc.url) ? `http://${svc.url}` : svc.url || "#";
  tile.target = "_blank";
  tile.rel = "noopener";
  tile.className = "service-tile";
  tile.dataset.name = svc.name.toLowerCase();
  tile.draggable = true;
  tile.dataset.id = svc.id;

  const iconHtml = svc.icon
    ? `<img src="${svc.icon}" onerror="this.outerHTML=letterAvatar('${escapeHtml(svc.name)}')" />`
    : letterAvatar(svc.name);

  tile.innerHTML = `
    <div class="service-tile-top">
      ${iconHtml}
      <span class="status-dot" data-url="${svc.url}"></span>
    </div>
    <div>
      <div class="service-name">${escapeHtml(svc.name)}</div>
      <div class="service-ping" id="ping-${svc.id}">checking…</div>
    </div>
  `;

  tile.addEventListener("dragstart", (e) => {
    dragServiceId = svc.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", svc.id);
    tile.classList.add("dragging");
  });

  tile.addEventListener("dragover", (e) => {
    if (!dragServiceId || dragServiceId === svc.id) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    tile.classList.add("drag-over");
  });

  tile.addEventListener("dragleave", () => tile.classList.remove("drag-over"));
  tile.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    tile.classList.remove("drag-over");
    if (!dragServiceId || dragServiceId === svc.id) return;
    const from = CONFIG.services.findIndex((s) => s.id === dragServiceId);
    const to = CONFIG.services.findIndex((s) => s.id === svc.id);
    if (from === -1 || to === -1) return;
    const targetCat = (svc.category || "Other").trim();
    if ((CONFIG.services[from].category || "Other").trim() === targetCat) {
      const [moved] = CONFIG.services.splice(from, 1);
      const targetNow = CONFIG.services.findIndex((s) => s.id === svc.id);
      CONFIG.services.splice(targetNow, 0, moved);
    } else {
      moveServiceToCategory(dragServiceId, targetCat);
    }
    persistServiceOrder();
  });
  tile.addEventListener("dragend", () => {
    dragServiceId = null;
    document.querySelectorAll(".service-tile.dragging, .service-tile.drag-over, .svc-group.drag-over").forEach((t) =>
      t.classList.remove("dragging", "drag-over")
    );
  });

  checkStatus(tile.querySelector(".status-dot"), svc.url, document.getElementById(`ping-${svc.id}`));
  return tile;
}

async function persistServiceOrder() {
  renderServices();
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ services: CONFIG.services })
  });
  CONFIG = await res.json();
  toastResult(res, "Service order saved");
}

async function refreshPorts() {
  const body = document.getElementById("portsTableBody");
  const empty = document.getElementById("portsEmpty");
  try {
    const r = await fetch("/api/ports");
    const ports = await r.json();
    if (!ports.length) {
      body.innerHTML = "";
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    body.innerHTML = ports
      .map(
        (p) => `
      <tr data-filter="${p.port} ${escapeHtml((p.process || "").toLowerCase())}">
        <td class="port-num">${p.port}</td>
        <td class="port-proto">${escapeHtml(p.protocol || "")}</td>
        <td class="port-process">${escapeHtml(p.process || "unknown")}</td>
        <td class="port-pid">${p.pid || "--"}</td>
      </tr>`
      )
      .join("");
  } catch {
    body.innerHTML = "";
    empty.classList.remove("hidden");
  }
}

function letterAvatar(name) {
  const letter = (name || "?").trim()[0]?.toUpperCase() || "?";
  return `<div class="service-letter">${letter}</div>`;
}
window.letterAvatar = letterAvatar;

const statusCache = new Map();

function applyStatus(dotEl, url, pingEl, res) {
  const online = !!res.ok;
  [dotEl, pingEl].forEach((el) => {
    if (!el) return;
    el.classList.toggle("offline", !online);
    el.classList.toggle("online", online);
  });
  if (pingEl) {
    pingEl.textContent = res.error === "no-url" ? "no url" : online ? `${res.ms} ms` : "offline";
  }
}

function checkStatus(dotEl, url, pingEl, force) {
  const key = String(url || "").trim().toLowerCase();
  if (!url) {
    applyStatus(dotEl, url, pingEl, { ok: false, ms: null, error: "no-url" });
    return;
  }
  const cached = statusCache.get(key);
  if (cached) {
    applyStatus(dotEl, url, pingEl, cached);
    if (!force && Date.now() - cached.at < 20000) return;
  }
  const target = /^https?:\/\//i.test(url) ? url : `http://${url}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  const start = performance.now();
  return fetch(target, { mode: "no-cors", signal: controller.signal })
    .then(() => {
      const res = { ok: true, ms: Math.round(performance.now() - start), at: Date.now() };
      statusCache.set(key, res);
      applyStatus(dotEl, url, pingEl, res);
    })
    .catch(() => {
      const res = { ok: false, ms: null, at: Date.now() };
      statusCache.set(key, res);
      applyStatus(dotEl, url, pingEl, res);
    })
    .finally(() => clearTimeout(timeout));
}

function refreshAllStatuses() {
  document.querySelectorAll(".service-tile").forEach((tile) => {
    const dot = tile.querySelector(".status-dot");
    const ping = tile.querySelector(".service-ping");
    checkStatus(dot, dot?.dataset.url, ping, true);
  });
}

function openSettings() {
  document.getElementById("settingsModal").classList.remove("hidden");
  settingsPick = null;
  const suggestBox = document.getElementById("settingsServiceSuggest");
  if (suggestBox) suggestBox.classList.add("hidden");
  renderSettingsIconPreview();
  resetAddCategoryField();
  renderSettingsServices();
  document.getElementById("settingsProfileName").value = CONFIG.profile?.name || "";
  document.getElementById("settingsCurrentLocation").textContent = CONFIG.weather?.locationName
    ? `Current: ${CONFIG.weather.locationName}`
    : "No location set";
  renderRssEditor("settingsRssList", CONFIG.rss.feeds, persistRssFeeds);
  document.getElementById("settingsPiholeEnabled").checked = !!CONFIG.pihole?.enabled;
  document.getElementById("settingsPiholeUrl").value = CONFIG.pihole?.url || "";
  document.getElementById("settingsPiholeKey").value = CONFIG.pihole?.apiKey || "";
  document.getElementById("settingsAdguardEnabled").checked = !!CONFIG.adguard?.enabled;
  document.getElementById("settingsAdguardUrl").value = CONFIG.adguard?.url || "";
  document.getElementById("settingsAdguardMode").value = CONFIG.adguard?.authMode || "basic";
  document.getElementById("settingsAdguardUser").value = CONFIG.adguard?.username || "";
  document.getElementById("settingsAdguardPass").value = CONFIG.adguard?.password || "";
  applyAdguardModeUi("settingsAdguard");
  renderSettingsStats();
  document.getElementById("settingsProxmoxEnabled").checked = !!CONFIG.proxmox?.enabled;
  document.getElementById("settingsProxmoxUrl").value = CONFIG.proxmox?.url || "";
  document.getElementById("settingsProxmoxTokenId").value = CONFIG.proxmox?.tokenId || "";
  document.getElementById("settingsProxmoxTokenSecret").value = CONFIG.proxmox?.tokenSecret || "";
}

function closeSettings() {
  document.getElementById("settingsModal").classList.add("hidden");
}

function renderSettingsStats() {
  const pinned = pinnedStats();
  const list = document.getElementById("settingsStatsList");
  list.innerHTML = "";
  STAT_CATALOG.forEach(({ key, label }) => {
    const row = document.createElement("label");
    row.className = "stats-pick-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = key;
    cb.checked = pinned.includes(key);
    const span = document.createElement("span");
    span.textContent = label;
    row.appendChild(cb);
    row.appendChild(span);
    list.appendChild(row);
  });
}

function fillCategorySelect(select, current) {
  if (!select) return;
  select.innerHTML = "";
  const cats = [...SERVICE_CATEGORIES];
  CONFIG.services.forEach((s) => {
    const c = (s.category || "Other").trim();
    if (c && !cats.includes(c)) cats.push(c);
  });
  if (current && !cats.includes(current)) cats.push(current);
  cats.forEach((c) => {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = c;
    if (c === current) o.selected = true;
    select.appendChild(o);
  });
  const custom = document.createElement("option");
  custom.value = "__new__";
  custom.textContent = "＋ Add new category…";
  select.appendChild(custom);
}

function resetAddCategoryField() {
  const select = document.getElementById("settingsNewCat");
  const input = document.getElementById("settingsNewCatCustom");
  if (select) {
    select.classList.remove("hidden");
    fillCategorySelect(select, "Other");
  }
  if (input) {
    input.classList.add("hidden");
    input.value = "";
  }
}

function refreshAddCategoryField() {
  const select = document.getElementById("settingsNewCat");
  const input = document.getElementById("settingsNewCatCustom");
  if (!select) return;
  if (input && !input.classList.contains("hidden")) return;
  const prev = select.value;
  fillCategorySelect(select, "Other");
  if (prev && prev !== "__new__" && prev !== "__sep__") {
    const exists = [...select.children].some((o) => o.value === prev);
    if (exists) select.value = prev;
  }
}

function makeCategoryField(current) {
  const select = document.createElement("select");
  select.className = "ss-input ss-cat-input";
  select.title = "Category";
  fillCategorySelect(select, current || "Other");
  const input = document.createElement("input");
  input.className = "ss-input ss-cat-input ss-cat-custom hidden";
  input.placeholder = "New category name";
  input.autocomplete = "off";
  select.addEventListener("change", () => {
    if (select.value === "__new__") {
      select.classList.add("hidden");
      input.classList.remove("hidden");
      input.value = "";
      input.focus();
    }
  });
  const value = () => (select.classList.contains("hidden") ? input.value.trim() : select.value.trim());
  return { select, input, value };
}

function makeServiceRow(svc) {
  const row = document.createElement("div");
  row.className = "settings-service-row";
  const iconHtml = svc.icon
    ? `<img src="${svc.icon}" onerror="this.outerHTML=letterAvatar('${escapeHtml(svc.name)}')" />`
    : letterAvatar(svc.name);

  const top = document.createElement("div");
  top.className = "ss-row-top";
  top.innerHTML = iconHtml;
  const nameInput = document.createElement("input");
  nameInput.className = "ss-input ss-name-input";
  nameInput.value = svc.name;
  nameInput.title = "Name";
  const removeBtn = document.createElement("button");
  removeBtn.className = "ss-remove";
  removeBtn.title = "Remove";
  removeBtn.textContent = "✕";
  top.appendChild(nameInput);
  top.appendChild(removeBtn);

  const bottom = document.createElement("div");
  bottom.className = "ss-row-bottom";
  const urlInput = document.createElement("input");
  urlInput.className = "ss-input ss-url-input";
  urlInput.value = svc.url || "";
  urlInput.title = "IP and port";
  urlInput.placeholder = "http://192.168.1.50:8080";
  const catField = makeCategoryField(svc.category);
  const saveBtn = document.createElement("button");
  saveBtn.className = "ss-save";
  saveBtn.title = "Save changes";
  saveBtn.textContent = "Save";
  bottom.appendChild(urlInput);
  bottom.appendChild(catField.select);
  bottom.appendChild(catField.input);
  bottom.appendChild(saveBtn);

  row.appendChild(top);
  row.appendChild(bottom);

  const doSave = async () => {
    const updated = {
      name: nameInput.value.trim() || svc.name,
      url: urlInput.value.trim(),
      category: catField.value() || "Other"
    };
    const res = await fetch(`/api/services/${svc.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated)
    });
    if (res.ok) Object.assign(svc, await res.json());
    renderSettingsServices();
    renderServices();
    toastResult(res, "Service updated");
  };
  saveBtn.addEventListener("click", doSave);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSave();
    }
  });
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSave();
    }
  });
  catField.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSave();
    }
  });
  removeBtn.addEventListener("click", async () => {
    const res = await fetch(`/api/services/${svc.id}`, { method: "DELETE" });
    CONFIG.services = CONFIG.services.filter((s) => s.id !== svc.id);
    renderSettingsServices();
    renderServices();
    toastResult(res, "Service removed");
  });
  return row;
}

function renderSettingsServices() {
  const list = document.getElementById("settingsServicesList");
  refreshAddCategoryField();
  list.innerHTML = "";
  if (!CONFIG.services.length) {
    const empty = document.createElement("div");
    empty.className = "ss-empty";
    empty.textContent = "No services yet — add one below.";
    list.appendChild(empty);
    return;
  }
  const groups = new Map();
  CONFIG.services.forEach((svc) => {
    const cat = (svc.category || "Other").trim() || "Other";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(svc);
  });
  const order = [...groups.keys()].sort((a, b) => {
    const ia = SERVICE_CATEGORIES.indexOf(a);
    const ib = SERVICE_CATEGORIES.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  order.forEach((cat) => {
    const head = document.createElement("div");
    head.className = "ss-group-head";
    head.textContent = cat;
    list.appendChild(head);
    groups.get(cat).forEach((svc) => list.appendChild(makeServiceRow(svc)));
  });
}

function renderSettingsIconPreview() {
  const preview = document.getElementById("settingsNewIcon");
  if (!preview) return;
  if (settingsPick?.icon) {
    preview.classList.remove("hidden");
    preview.innerHTML = `<img src="${settingsPick.icon}" onerror="this.style.display='none'" />`;
  } else {
    preview.classList.add("hidden");
    preview.innerHTML = "";
  }
}

function setupSettingsServiceSuggest() {
  const input = document.getElementById("settingsNewName");
  const box = document.getElementById("settingsServiceSuggest");
  const catInput = document.getElementById("settingsNewCat");
  const catCustom = document.getElementById("settingsNewCatCustom");
  if (!input || !box) return;
  input.addEventListener("input", () => {
    const hadPick = !!settingsPick;
    settingsPick = null;
    renderSettingsIconPreview();
    if (hadPick) resetAddCategoryField();
    const q = input.value.trim().toLowerCase();
    box.innerHTML = "";
    if (!q) {
      box.classList.add("hidden");
      return;
    }
    const matches = SERVICE_CATALOG.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 6);
    if (!matches.length) {
      box.classList.add("hidden");
      return;
    }
    box.classList.remove("hidden");
    matches.forEach((s) => {
      const iconUrl = `https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/${s.slug}.png`;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "ss-suggest-item";
      item.innerHTML = `<img src="${iconUrl}" onerror="this.style.display='none'" /><span>${escapeHtml(s.name)}</span><em>${escapeHtml(s.category)}</em>`;
      item.addEventListener("mousedown", (e) => e.preventDefault());
      item.addEventListener("click", () => {
        input.value = s.name;
        settingsPick = { icon: iconUrl, category: s.category };
        if (catInput) catInput.value = s.category;
        if (catCustom) catCustom.classList.add("hidden");
        if (catInput) catInput.classList.remove("hidden");
        box.classList.add("hidden");
        renderSettingsIconPreview();
        const urlInput = document.getElementById("settingsNewUrl");
        if (urlInput && !urlInput.value.trim()) urlInput.placeholder = `http://host:${s.defaultPort}`;
      });
      box.appendChild(item);
    });
  });
  input.addEventListener("blur", () => setTimeout(() => box.classList.add("hidden"), 150));
}

function openAddService() {
  openSettings();
  document.querySelector('.tab-btn[data-tab="services"]')?.click();
  const nameInput = document.getElementById("settingsNewName");
  if (nameInput) nameInput.focus();
}

async function persistRssFeeds() {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rss: { feeds: CONFIG.rss.feeds } })
  });
  CONFIG = await res.json();
  refreshRss();
  toastResult(res, "News feeds saved");
}

function initSettingsModal() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.querySelector(`.tab-pane[data-pane="${btn.dataset.tab}"]`).classList.add("active");
    });
  });

  setupSettingsServiceSuggest();

  const addCatSelect = document.getElementById("settingsNewCat");
  const addCatCustom = document.getElementById("settingsNewCatCustom");
  if (addCatSelect && addCatCustom) {
    addCatSelect.addEventListener("change", () => {
      if (addCatSelect.value === "__new__") {
        addCatSelect.classList.add("hidden");
        addCatCustom.classList.remove("hidden");
        addCatCustom.value = "";
        addCatCustom.focus();
      }
    });
  }

  document.getElementById("settingsAddService").addEventListener("click", async () => {
    const name = document.getElementById("settingsNewName").value.trim();
    const url = document.getElementById("settingsNewUrl").value.trim();
    if (!name) return;
    const catInput = document.getElementById("settingsNewCat");
    const catCustom = document.getElementById("settingsNewCatCustom");
    const usingCustom = catCustom && !catCustom.classList.contains("hidden");
    let icon = settingsPick?.icon || null;
    const category = (usingCustom ? catCustom.value.trim() : catInput?.value.trim()) || "Other";
    if (!icon) {
      try {
        const r = await fetch(`/api/resolve-icon?name=${encodeURIComponent(name)}&url=${encodeURIComponent(url)}`);
        icon = (await r.json()).icon;
      } catch {}
    }
    const res = await fetch("/api/services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, url, icon, category })
    });
    const svc = await res.json();
    CONFIG.services.push(svc);
    document.getElementById("settingsNewName").value = "";
    document.getElementById("settingsNewUrl").value = "";
    document.getElementById("settingsNewUrl").placeholder = "http://192.168.1.50:8080";
    settingsPick = null;
    resetAddCategoryField();
    const suggestBox = document.getElementById("settingsServiceSuggest");
    if (suggestBox) suggestBox.classList.add("hidden");
    renderSettingsIconPreview();
    renderSettingsServices();
    renderServices();
    toastResult(res, "Service added");
  });

  document.getElementById("saveProfile").addEventListener("click", async () => {
    const name = document.getElementById("settingsProfileName").value.trim();
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: { name } })
    });
    CONFIG = await res.json();
    renderGreeting();
    toastResult(res, "Profile saved");
  });

  setupWeatherSearch("settingsWeatherSearch", "settingsWeatherResults", async (chosen) => {
    const weather = {
      locationName: `${chosen.name}${chosen.admin1 ? ", " + chosen.admin1 : ""}`,
      latitude: chosen.latitude,
      longitude: chosen.longitude,
      unit: unitForCountry(chosen.country_code)
    };
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weather })
    });
    CONFIG = await res.json();
    document.getElementById("settingsCurrentLocation").textContent = `Current: ${weather.locationName}`;
    document.getElementById("settingsWeatherResults").innerHTML = "";
    refreshWeather();
    toastResult(res, "Weather updated");
  });

  document.getElementById("settingsAddRss").addEventListener("click", async () => {
    const input = document.getElementById("settingsRssInput");
    if (!input.value.trim()) return;
    CONFIG.rss.feeds.push(input.value.trim());
    input.value = "";
    await persistRssFeeds();
    renderRssEditor("settingsRssList", CONFIG.rss.feeds, persistRssFeeds);
  });

  document.getElementById("savePihole").addEventListener("click", async () => {
    const pihole = {
      enabled: document.getElementById("settingsPiholeEnabled").checked,
      url: document.getElementById("settingsPiholeUrl").value.trim(),
      apiKey: document.getElementById("settingsPiholeKey").value.trim()
    };
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pihole })
    });
    CONFIG = await res.json();
    refreshPihole();
    toastResult(res, "Pi-hole settings saved");
  });

  document.getElementById("settingsAdguardMode").addEventListener("change", () => {
    applyAdguardModeUi("settingsAdguard");
  });

  document.getElementById("saveAdguard").addEventListener("click", async () => {
    const adguard = {
      enabled: document.getElementById("settingsAdguardEnabled").checked,
      url: document.getElementById("settingsAdguardUrl").value.trim(),
      username: document.getElementById("settingsAdguardUser").value.trim(),
      password: document.getElementById("settingsAdguardPass").value,
      authMode: document.getElementById("settingsAdguardMode").value
    };
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adguard })
    });
    CONFIG = await res.json();
    refreshAdguard();
    toastResult(res, "AdGuard settings saved");
  });

  document.getElementById("saveProxmox").addEventListener("click", async () => {
    const proxmox = {
      enabled: document.getElementById("settingsProxmoxEnabled").checked,
      url: document.getElementById("settingsProxmoxUrl").value.trim(),
      tokenId: document.getElementById("settingsProxmoxTokenId").value.trim(),
      tokenSecret: document.getElementById("settingsProxmoxTokenSecret").value
    };
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proxmox })
    });
    CONFIG = await res.json();
    refreshProxmox();
    toastResult(res, "Proxmox settings saved");
  });

  document.getElementById("settingsStatsList").addEventListener("change", (e) => {
    if (!e.target.matches("input[type=checkbox]") || !e.target.checked) return;
    if (document.querySelectorAll("#settingsStatsList input:checked").length > 6) {
      e.target.checked = false;
      showToast("Pick up to 6 stats for the first row");
    }
  });

  document.getElementById("saveSystem").addEventListener("click", async () => {
    const keys = [...document.querySelectorAll("#settingsStatsList input:checked")]
      .map((i) => i.value)
      .slice(0, 6);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system: { pinnedStats: keys } })
    });
    CONFIG = await res.json();
    refreshStats();
    toastResult(res, "System info saved");
  });
}

boot();
