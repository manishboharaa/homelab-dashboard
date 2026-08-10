# Home Lab Dashboard

A self-hosted, dark-themed dashboard for your homelab. Add your services
once through a guided setup wizard, icons are pulled in automatically, and
you get one page with everything you would normally open separately:
what's running, whether it's up, how the host is doing, what's listening on
which port, the weather, and the latest tech news.

No account, no cloud dependency, no API keys required to get started.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Get the code](#get-the-code)
- [Run it](#run-it)
- [First-run setup](#first-run-setup)
- [Using the dashboard](#using-the-dashboard)
- [Configuration](#configuration)
- [Host networking (why, and how to opt out)](#host-networking-why-and-how-to-opt-out)
- [Optional: Docker container count](#optional-docker-container-count)
- [DNS blocking stats (Pi-hole or AdGuard Home)](#dns-blocking-stats-pi-hole-or-adguard-home)
- [Proxmox VE guests](#proxmox-ve-guests)
- [Editing settings after setup](#editing-settings-after-setup)
- [Manually editing config.json](#manually-editing-configjson)
- [Updating](#updating)
- [Troubleshooting](#troubleshooting)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [License](#license)

## Features

- **Services grid** — every service you add shows up as a tile with its
  logo, category, an online/offline status dot, and a live response time
  (e.g. `42 ms`). Statuses are checked in the background every 15 seconds
  and the last known result is kept on screen between checks, so nothing
  flashes back to "checking…". Drag a tile to reorder the grid, or drag it
  onto another category to move it there — both are saved. An **+ Add
  service** button in the section header jumps straight to Settings →
  Services.
- **Proxmox VE guests** — connect a Proxmox host with a read-only API token
  and the dashboard lists every VM and LXC container in the cluster: nodes,
  running/total VMs and containers, live CPU + memory, and status dots.
  Expand any running guest for its **IP address(es), disk usage, network
  I/O, and uptime** — all read-only, nothing runs inside your containers.
- **Automatic icons** — pick a service from the built-in catalog (Plex,
  Sonarr, Pi-hole, Home Assistant, Portainer, Nextcloud, Grafana, and
  more) and its icon is pulled in for you. Adding from Settings shows
  **icon + name suggestions** as you type, so you can pick a known app and
  get its icon and category for free. Add something custom and the app
  still resolves an icon automatically, favicon-style, no uploading.
- **Live system stats** — CPU load, memory, swap, disk usage, CPU
  temperature, load average, network throughput, uptime, local IP, and
  (optionally) running Docker container count. The first row shows your
  6 chosen stats; click **Show all** to expand the rest. Choose which 6
  from Settings → System Info.
- **Open ports table** — every listening port on the host, with protocol,
  process name, and PID, searchable.
- **DNS blocking stats** — queries today, percent blocked, blocklist size,
  and an always-visible 24-hour queries/blocked graph, plus Top Clients /
  Top Blocked / Top Allowed lists behind a toggle, for **Pi-hole** *or*
  **AdGuard Home**, with either (or both) connected from the wizard or
  Settings.
- **Sidebar** — full-month calendar with today highlighted, an instant
  service search, current weather for a location you set (no API key —
  powered by [Open-Meteo](https://open-meteo.com/); °F for US locations,
  °C everywhere else, chosen automatically), and a tech news RSS feed with
  sensible defaults you can replace.
- **Everything editable later** — the ⚙️ settings panel lets you add, edit
  (name, **IP/port/URL**, category), or remove services, change your name,
  move your weather location, edit RSS feeds, and connect/disconnect
  Pi-hole without touching a config file. Every change saves with an
  on-screen **"Saved"** confirmation and the dashboard updates instantly —
  no reload needed.
- **Resizable service tiles** — drag the bottom-right corner of any tile to
  switch between **small** (1 column), **medium** (2 columns, shows uptime),
  and **large** (3 columns, full detail panel). Sizes are saved per service.
- **Per-service uptime** — tiles show uptime in days/hours/minutes. Set a
  **Docker container name** in Settings and (with the socket mounted, below)
  a tile shows the container's *real* uptime; otherwise the dashboard
  observes reachability itself (local probes every 5 min, remote every 30
  min) and remembers it across restarts.
- **Jellyfin detail panel** — large Jellyfin tiles show movies, series,
  episodes, active streams, libraries, users, and server version/OS. An
  optional API key in Settings unlocks the full counters (public info works
  without one).
- **Dark, sleek UI** — no build step, no framework, just HTML/CSS/JS
  served by a small Express app, so the Docker image stays small and easy
  to hack on.

## Requirements

- A machine that can run Node.js or Docker (a NAS, mini PC, Raspberry Pi,
  VM — most homelab setups already have this)
- For the Docker route: [Docker](https://docs.docker.com/get-docker/) and
  [Docker Compose](https://docs.docker.com/compose/install/)
- For the bare-metal route: [Node.js](https://nodejs.org/) 18 or newer
- Linux host recommended. Some system stats (temperature, listening ports)
  rely on host mounts that behave best on Linux.

## Get the code

Two ways to get the project onto your machine — pick whichever you prefer.

**Option 1 — clone with git**

```bash
git clone https://github.com/manishboharaa/homelab-dashboard.git
cd homelab-dashboard
```

> If you cloned from a fork, use your own fork's URL instead.

**Option 2 — download the ZIP**

On the repository page on GitHub, click the green **Code** button and choose
**Download ZIP**. Unzip the archive and open a terminal in the resulting
`homelab-dashboard` folder. No git required.

Both ways give you the same files. Continue to [Run it](#run-it).

## Run it

Choose the method that fits your setup: run directly with Node.js, or build
with Docker from the source you just got.

### Method 1 — run with Node.js (no Docker)

```bash
npm install
npm start
```

Then open **`http://localhost:8080`** (or `http://YOUR_SERVER_IP:8080` if
you're on another machine on your network). The server writes its config to
`./data/config.json` next to the app.

### Method 2 — build and run with Docker (default)

The included `docker-compose.yml` builds the image from the `Dockerfile`,
so no extra configuration is needed:

```bash
docker compose up -d --build
```

Then visit **`http://YOUR_SERVER_IP:8080`**. Rebuilding takes a minute or
two the first time.

That's it — no `.env` file to fill in first, no API keys. Everything else
happens in the browser on first load.

## First-run setup

The first time you open the dashboard, a setup wizard walks you through:

1. **Your name** — used for the greeting on the dashboard ("Good evening,
   Alex").
2. **Services** — pick from a curated catalog of popular self-hosted apps,
   or click **"+ Add your own service"** for anything not listed. Icons
   are resolved automatically as you go.
3. **Weather location** — search-as-you-type city lookup, no API key.
   Temperatures show in **°C** or **°F** automatically based on the
   location you pick (US locations → °F, everywhere else → °C).
4. **Tech news feeds** — pre-filled with a few solid tech RSS feeds; edit
   the list or leave the defaults.
5. **DNS blocking stats (optional)** — enter your Pi-hole URL + API key,
   or your AdGuard Home URL + admin credentials, to show blocking stats on
   the dashboard.
6. **Host type** — pick **Standalone / Docker host** (the default — this
   dashboard runs as a standalone service) or **Proxmox host** to connect
   your Proxmox VE server and show all VMs/containers on the dashboard.

You only see this once. After that, the dashboard loads straight to the
main view, and everything from the wizard is editable from Settings.

## Using the dashboard

| Area | What it shows |
|---|---|
| Top bar | Personalized greeting, live clock/date, settings (⚙️) |
| Stats strip | First row shows your 6 chosen stats; click **Show all** to expand the full set: CPU, memory, swap, disk, temp, load average, network, uptime, local IP, Docker containers |
| DNS stats | Status, queries today, blocked today, blocked %, blocklist size + a 24h graph (always visible); click the **▾** arrow for Top Clients / Top Blocked / Top Allowed, which scroll inside the panel — for Pi-hole and/or AdGuard Home (only shown if configured) |
| Proxmox | Nodes, VMs/CTs running, total guests + a collapsible list of every VM/LXC. Click a guest's **▸** for its IP address(es), disk usage, network I/O, and uptime (only shown if configured) |
| Services grid | Your added services — click a tile to open it in a new tab; **drag** a tile to reorder the grid or move it to another category. **+ Add service** opens Settings → Services |
| Open Ports | Every listening port on the host with process name and PID |
| Sidebar → Search | Instantly filters the services grid as you type |
| Sidebar → Calendar | Current month, today highlighted |
| Sidebar → Weather | Current temp, condition, today's high/low |
| Sidebar → Tech News | Latest items from your configured RSS feeds |

## Configuration

Most settings are managed from the UI (setup wizard + ⚙️ Settings), but
here's what each piece maps to under the hood:

| Setting | Where to set it | Notes |
|---|---|---|
| Services (name, URL, icon, category) | Wizard step 2, or Settings → Services | Add from Settings shows icon + name suggestions; every service is editable in place (name, IP/port, category) with a per-row **Save** |
| Your name | Wizard step 1, or Settings → Profile | Used only for the greeting |
| Weather location | Wizard step 3, or Settings → Weather | Search by city name; °F/°C auto-detected from the location |
| RSS feeds | Wizard step 4, or Settings → News Feeds | Any standard RSS/Atom feed URL |
| Pi-hole URL + API key | Wizard step 5, or Settings → Pi-hole | See [DNS blocking stats](#dns-blocking-stats-pi-hole-or-adguard-home) |
| AdGuard Home URL + credentials | Wizard step 5, or Settings → AdGuard | See [DNS blocking stats](#dns-blocking-stats-pi-hole-or-adguard-home) |
| Proxmox URL + API token | Wizard step 6 (Host type), or Settings → Proxmox | See [Proxmox VE guests](#proxmox-ve-guests) |
| Stats shown in the first row | Settings → System Info | Pick up to 6 of the 10 stats for the collapsed first row; the rest appear behind "Show all" |
| Timezone | `docker-compose.yml` → `TZ` | Set before first build, see below |
| Primary disk path | `docker-compose.yml` → `HOST_DISK_PATH` | Defaults to `/hostfs`, see below |

### Changing the timezone

Edit `TZ` in `docker-compose.yml` to your
[IANA timezone name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)
(e.g. `Europe/London`, `Asia/Kolkata`, `America/New_York`) before your
first `docker compose up`. If you run with Node.js directly, set the
`TZ` environment variable the same way.

## Host networking (why, and how to opt out)

`docker-compose.yml` runs the container with `network_mode: host` and
`pid: host`. This is what lets the **Open Ports** panel and **Network**
stat reflect your actual host machine instead of just the container's own
isolated network stack — the same approach tools like Netdata use. With
host networking there's no `ports:` mapping; the app binds directly to
`$PORT` (`8080` by default) on the host itself.

If you'd rather not use host networking (e.g. you want stricter container
isolation), remove `network_mode: host` from `docker-compose.yml` and add
back:

```yaml
ports:
  - "8080:8080"
```

Everything else keeps working — you'll just lose accurate host-level data
in the Open Ports panel and network throughput stat, since the container
will only see its own network stack.

## Optional: Docker container count

To show a running/total container count on the stats strip, add this
volume mount to the `volumes:` block of `docker-compose.yml`:

```yaml
- /var/run/docker.sock:/var/run/docker.sock:ro
```

This grants the container **read-only** access to your Docker daemon.
It's off by default since mounting the socket is a real privilege grant —
only enable it if you're comfortable with that tradeoff.

The same mount powers **per-service uptime**: when you set a service's
**Docker container name** in Settings, its tile reads the container's real
uptime. Without the mount (or when the container isn't found), tiles fall back
to dashboard-observed uptime.

## DNS blocking stats (Pi-hole or AdGuard Home)

The dashboard can show live blocking stats for **one or both** of the two
most popular network-wide ad blockers. Each widget only appears once you
connect it (wizard step 5, or ⚙️ Settings → Pi-hole / Settings → AdGuard)
and stays hidden if it can't connect, so a misconfiguration never breaks
the rest of the dashboard.

The widgets always show the headline numbers **and** a 24-hour
queries-vs-blocked graph. Click the **▾** button to expand **Top Clients**
(blocked counts for Pi-hole), **Top Blocked** domains, and **Top Allowed**
domains (queried minus blocked) — the lists scroll inside the panel so the
page stays short. Your expanded/collapsed choice is remembered per widget.

### Pi-hole

1. Open your Pi-hole admin and go to **Settings → API / Web interface**,
   then click **Show API token** and copy it. (In Pi-hole v6 the API token
   lives on the same page.)
2. In the dashboard, enter your Pi-hole **URL** — no trailing slash, e.g.
   `http://192.168.1.10` — and paste the **API key**, then save.
3. On Pi-hole **v6**, the legacy `/admin/api.php?summary` endpoint used by
   this widget must be enabled (v6 ships a legacy API compatibility mode);
   if it's unavailable the widget simply stays hidden.

The widget shows status, queries today, blocked today, blocked %, and
blocklist size (blocked counts per client come from Pi-hole's
`topClientsBlocked`). The 24-hour graph uses Pi-hole's `overTimeData10mins`
data.

### AdGuard Home

The dashboard supports **two auth modes** (drop-down in wizard step 5 and
Settings → AdGuard): *Standard* and *GL.iNet router*.

**Standard** (default — normal AdGuard Home installs, Docker, etc.):

1. AdGuard Home's control API authenticates with its admin **username and
   password** (HTTP Basic auth) — there's no API token to generate.
2. In the dashboard, enter your AdGuard Home **URL** — no trailing slash,
   e.g. `http://192.168.1.10:3000` — the **username** (default `admin`) and
   the **password**, then save.
3. The widget reads `/control/status`, `/control/stats`, and
   `/control/filtering/status`. **Queries today** / **Blocked today** are
   computed from AdGuard's per-hour stats buckets, and the blocklist size
   is the total number of rules across your enabled filter lists.
   Top Clients / Top Blocked / Top Allowed come from AdGuard's
   `top_clients`, `top_blocked_domains`, and `top_queried_domains`;
   AdGuard doesn't expose blocked-per-client, so clients show request
   totals only.
4. AdGuard's counters are cumulative until you click **Reset statistics**
   in the AdGuard admin, so today's numbers reflect the current day while
   the blocked percentage is over the whole window since the last reset.
5. Self-signed HTTPS certificates are accepted; plain HTTP on your LAN
   works too.

**GL.iNet router** (Brume 2, Flint 2, etc.):

On GL.iNet routers, AdGuard Home runs with the `--glinet` flag, which
disables AdGuard's own credentials entirely — AGH will reject standard
Basic-auth logins with `403`. Instead, pick **GL.iNet router** mode and
enter your **router's** admin username and password (GL.iNet's login is
`root` by default), with the AdGuard URL pointing at the router's AGH
instance (e.g. `http://10.10.8.1:3000`). The dashboard then logs in to the
router's RPC API the same way the router web UI does (unix-crypt challenge
→ SHA-256, MD5 fallback for older firmware), obtains a session, and uses
that session's `Admin-Token` cookie to read AGH. Sessions are cached for
~10 minutes and refreshed automatically. Note: GL.iNet firmware 4.9.0+
removed the RPC login this relies on, so those versions can't use the
dashboard's GL.iNet mode.

Both widgets refresh every 30 seconds.

## Proxmox VE guests

If you run VMs or LXC containers on a [Proxmox VE](https://www.proxmox.com/)
server, connect it and the dashboard shows a **Proxmox** panel with the
number of nodes, how many VMs and containers are running, total guests, and
a collapsible list of every guest with its status dot and live CPU/memory.
Click a running guest's **▸** arrow to expand it and see its **IP
address(es)**, **disk usage** (used / total + %), **network I/O**, and
**uptime** — your expanded guests stay open and refresh every 60 seconds.

Refreshes every 60 seconds.

1. In the Proxmox web UI, go to **Datacenter → Permissions → API Tokens**
   and **Add** a token. Give it a user (e.g. `root@pam` or a dedicated
   user) and the **Audit** role (read-only is all the dashboard needs) and
   copy the **Token ID** (looks like `user@pam!tokenid`) and the **Token
   Secret** shown once. Keep the secret safe — it's the password for the
   token. A single token covers the whole cluster, so one is enough no
   matter how many nodes you have.
2. In the dashboard wizard, choose **Proxmox host** on step 6, then enter
   your Proxmox server URL — no trailing slash, e.g.
   `https://192.168.1.20:8006` — the token ID and the token secret, then
   finish. (You can also connect later via ⚙️ Settings → Proxmox.)
3. Self-signed HTTPS certificates are accepted, so a default Proxmox
   install works without extra setup.

The panel hides itself if it can't connect, so a wrong URL or token never
breaks the rest of the dashboard.

> **Note for PVE 8.1 and newer:** API tokens no longer inherit the
> privileges of the user they belong to — a token only has what is granted
> to the token itself. If the panel shows all zeros (no guests listed),
> open **Datacenter → Permissions → Add**, pick **API Token**, choose your
> token, give it the **PVEAuditor** role at path **/** with **Propagate**
> ticked, and save.
>
> IP addresses come from PVE's container interface data, so they show for
> LXC containers reliably (loopback and link-local addresses are hidden).
> QEMU VMs need the
> [guest agent](https://pve.proxmox.com/wiki/Qemu-guest-agent) installed to
> report IPs; without it the IP line shows **—**.

## Editing settings after setup

Click the ⚙️ icon top-right at any time to:

- Add, edit (name, **IP/port**, category), or remove services
- Add services from the dashboard itself via **+ Add service** in the
  Services section header (opens Settings on the Services tab)
- Change your display name
- Update your weather location
- Add or remove RSS feeds
- Connect, edit, or disable Pi-hole and AdGuard Home
- Connect, edit, or disable Proxmox VE
- Rearrange services by dragging tiles on the main page

Changes save immediately — no restart needed.

## Manually editing config.json

All settings persist to `./data/config.json` on the host (bind-mounted
into the container). You can:

- **Back it up** to preserve your setup across rebuilds
- **Edit it directly** if you prefer — restart the container after
  (`docker compose restart`)
- **Delete it** to re-trigger the first-run wizard from scratch

## Updating

**With Docker (local build):**
```bash
git pull
docker compose up -d --build
```

**Without Docker:**
```bash
git pull
npm install
npm start
```

Either way, your `data/config.json` is untouched by updates since it
lives outside the image, in the bind-mounted `./data` folder.

## Troubleshooting

**A service icon isn't showing / shows a plain letter instead of a logo**
The app tries the [dashboard-icons](https://github.com/walkxcode/dashboard-icons)
project first, then a favicon lookup on the service's domain, then falls
back to a generated letter avatar. Uncommon or self-branded apps may not
have a match in either source — this is expected, not a bug.

**Open Ports table is empty**
This panel needs `network_mode: host` (enabled by default — see
[above](#host-networking-why-and-how-to-opt-out)). If you removed it for
isolation, the panel will only show the container's own ports, which is
usually empty.

**CPU temperature shows `--`**
Not all hosts expose thermal sensors the same way. Confirm
`/sys/class/thermal` exists on your host and is populated
(`cat /sys/class/thermal/thermal_zone0/temp`). Some virtual machines and
certain SBCs simply don't expose this.

**Disk usage looks wrong**
`HOST_DISK_PATH` in `docker-compose.yml` defaults to `/hostfs`, which maps
to your host's root filesystem via the `/:/hostfs:ro` mount. If you want
to track a different mount (e.g. a separate data drive), bind-mount it to
a new path in `docker-compose.yml` and update `HOST_DISK_PATH` to match.

**Pi-hole stats won't connect**
Double-check the URL is reachable from the dashboard container (no
trailing slash) and that the API key is correct (Pi-hole admin →
Settings → API / Web interface → Show API token). This uses the Pi-hole
v5 legacy `/admin/api.php` API (`summary`, `topItems`, `topClients`,
`topClientsBlocked`, `overTimeData10mins`); on Pi-hole v6 point the URL
at a legacy-compatible endpoint if you have one enabled, otherwise the
widget stays hidden until it can connect — it won't break the rest of the
dashboard.

**AdGuard Home stats won't connect**
Make sure the URL is reachable from the dashboard container (no trailing
slash) and that the username/password are the same ones you use to log in
to AdGuard's admin UI. This uses the `/control` API with HTTP Basic auth —
there's no API token. If you enabled two-factor or changed the admin
account, use those exact credentials. If AdGuard keeps returning `403`, you
may be hitting a **GL.iNet router** (which disables AGH credentials) —
switch the auth mode drop-down to *GL.iNet router* and enter the router's
admin credentials instead. The widget hides itself on any failure, so it
won't break the rest of the dashboard.

**A service tile always shows "offline" even though it's up**
The status check runs from your browser, so it needs to be able to reach
the service's URL/IP directly (same network). Services only reachable
from the server itself, not your browsing device, will show as offline.

**Proxmox panel is hidden**
Check that the URL is reachable from the dashboard container (no trailing
slash) and that you're using a token ID in the form `user@pam!tokenid`
plus its secret. The panel uses the read-only **Audit** role and accepts
self-signed certificates. Any connection failure just hides the panel — it
won't affect the rest of the dashboard.

**Proxmox panel shows zeros / no guests**
On PVE 8.1+, a token only has the permissions explicitly granted to it (it
no longer inherits its user's). Even a `root@pam` token returns an empty
guest list until you add the token itself to an ACL: **Datacenter →
Permissions → Add** → *API Token* → role **PVEAuditor** at path **/** with
**Propagate** ticked. See [Proxmox VE guests](#proxmox-ve-guests).

**Proxmox guest IP line shows "—"**
LXC containers report their IPs automatically. QEMU VMs need the guest
agent installed and running; without it PVE can't report VM IPs, so the
dashboard shows "—". The disk/net/uptime lines still work either way.

## Tech stack

- **Backend**: Node.js + Express · [`systeminformation`](https://systeminformation.io/)
  for host stats · [`rss-parser`](https://www.npmjs.com/package/rss-parser)
  for feeds · [Open-Meteo](https://open-meteo.com/) for weather (no API
  key required)
- **Frontend**: plain HTML/CSS/JS — no build step, no framework — so the
  image stays small and easy to modify
- **Icons**: [dashboard-icons](https://github.com/walkxcode/dashboard-icons)
  with a favicon and letter-avatar fallback chain

## Project structure

```
homelab-dashboard/
├── docker-compose.yml
├── Dockerfile
├── package.json
├── server.js
├── config/
│   └── config.default.json
├── data/
└── public/
    ├── index.html
    ├── css/
    │   └── style.css
    └── js/
        ├── catalog.js
        └── app.js
```

## License

Released under the [MIT License](LICENSE).
