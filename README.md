# Home Lab Dashboard

A single page for your homelab. It tells you what's up, how the host is
doing, what ports are listening, what the weather's like, and what's in the
tech news. I got tired of keeping eight tabs open just to answer "is
everything still running?", so this is the other way round: one tab,
everything in it.

Runs on your own box. No account, no cloud, no config file to fill in before
you start.

## Contents

- [What you get](#what-you-get)
- [Run it](#run-it)
- [First run](#first-run)
- [What's on the page](#whats-on-the-page)
- [Configuration](#configuration)
- [Security stuff worth knowing](#security-stuff-worth-knowing)
- [The bits people usually ask about](#the-bits-people-usually-ask-about)
- [If something looks off](#if-something-looks-off)
- [Updating](#updating)
- [The tech bits](#the-tech-bits)
- [License](#license)

## What you get

- **Service tiles.** Logo, category, a status dot, and the last measured
  response time. The server does the probing; the page picks up the result
  every 15 seconds. The dot and the "UP / down" text read from that same
  result, so they can't contradict each other. The last known result stays
  on screen between checks instead of flashing "checking…".
- **Host stats.** CPU, memory, swap, disk, temperature, load average,
  network, uptime, local IP. Your six favourites sit on the first row; the
  rest live behind **Show all**.
- **Open Ports.** Everything listening on the host, with protocol, process
  name, and PID, plus a filter box.
- **Uptime per service.** Set a Docker container name and the tile reads
  that container's real uptime. Otherwise the dashboard watches
  reachability itself — every 5 minutes locally, 30 for remote services —
  and remembers across restarts.
- **Sidebar.** Service search, weather from Open-Meteo (no API key, °F for
  US locations and °C elsewhere, seven-day forecast), and a tech news feed
  with defaults you can replace.
- **Icons.** dashboard-icons first, then a favicon lookup, then a letter
  avatar. Settings suggests icon and name pairs as you type.
- **Drag and resize.** Reorder tiles, move them between categories, and
  stretch them. Sizes and positions stick.
- **Detail panels.** More space means more info: uptime from two columns,
  source and checked time from two for non-API services, widget panels from
  three up. Pick which metrics to show in Settings.
- **DNS blocking stats.** Queries, blocks, blocklist size, and a 24-hour
  graph for Pi-hole or AdGuard Home.
- **Theme.** Dark by default. The ☀ / ☾ button in the top bar flips between
  dark and a light linen, navy, and amber palette. Your choice sticks in
  this browser.

## Run it

With Docker (the usual route):

```bash
docker compose up -d --build
```

Open `http://YOUR_SERVER_IP:8080`. The compose file builds the image from
the included Dockerfile, so there's nothing to set up first.

Or without Docker, on Node.js 18 or newer:

```bash
npm install
npm start
```

Same address. Config ends up in `./data/config.json`. If you cloned from a
fork, use your own URL instead of the one above. Linux is the happiest host
for the temperature and ports panels.

## First run

The wizard walks through:

1. **Your name** — used for the greeting.
2. **Services** — pick from the catalog or add your own.
3. **Weather location** — search by city name.
4. **Tech news feeds** — a few defaults are pre-filled.
5. **DNS blocking stats (optional)** — Pi-hole or AdGuard Home details.
6. **Host type** — standalone or Proxmox. You also set a username and
   password here. Login is required during setup; it can't be skipped.

You only see this once. Until setup finishes, the server refuses every API
call except setup, config, and login, so nobody else on the LAN can poke at
a half-finished install. Afterwards it opens on the login screen, and
everything from the wizard stays editable in ⚙️ Settings.

## What's on the page

| Area | What it shows |
|---|---|
| Top bar | Greeting, live clock, Settings (⚙️) |
| Stats strip | Your six chosen stats, with **Show all** for the full set |
| Services grid | Your tiles. Click to open a service, drag to reorder or move category, **+ Add service** to add one |
| Open Ports | **System** tab for host listeners with PID; **Docker** tab for containers, images, IDs, and published ports |
| DNS stats | Status, queries and blocks today, blocked %, blocklist size, 24h graph; **▾** opens Top Clients / Top Blocked / Top Allowed |
| Proxmox | Nodes, guest counts, and a collapsible VM/LXC list with live CPU and memory |
| Integrations | Live metrics inside service tiles |
| Sidebar | Search, weather with seven-day forecast, tech news |

## Configuration

Most of this happens in the wizard or in Settings. The table is just a map
between the two:

| Setting | Where | Notes |
|---|---|---|
| Services | Wizard step 2, Settings → Services | Name, URL, icon, category. One **Save** covers every tab |
| Your name | Wizard step 1, Settings → Profile | Greeting only |
| Weather location | Wizard step 3, Settings → Weather | °F/°C picked from the location |
| RSS feeds | Wizard step 4, Settings → News Feeds | Any RSS/Atom URL |
| Pi-hole / AdGuard | Wizard step 5, Settings → Pi-hole / AdGuard | URL, token or credentials |
| Proxmox | Wizard step 6, Settings → Proxmox | URL and read-only API token |
| Login | Wizard step 6, Settings → Security | Required at setup; scrypt hash |
| Stats in first row | Settings → System Info | Pick up to six of ten |
| Timezone | `docker-compose.yml` → `TZ` | Set before the first build |
| Disk path | `docker-compose.yml` → `HOST_DISK_PATH` | Defaults to `/hostfs` |

Everything persists to `./data/config.json`, bind-mounted into the
container. Back it up if you want to move the dashboard, edit it by hand if
you prefer (then `docker compose restart`), or delete it to start the
wizard over.

### TLS, outbound URLs, time

HTTPS certificates are checked by default. For a self-signed integration,
mount its CA certificate and set `TLS_CA_FILE`. `ALLOW_INSECURE_TLS=true` is
the blunt fallback for a trusted private network.

Outbound URLs are checked before the server fetches them. Loopback,
metadata, link-local, CGNAT (`100.64.0.0/10`), IPv6 unique-local and
multicast addresses are blocked, including IPv4-mapped IPv6 spellings like
`http://[::ffff:127.0.0.1]/`. DNS answers are pinned to the address that
was checked, and redirects aren't followed. Private LAN ranges stay
allowed — that's the whole point for a homelab.

`TZ` in `docker-compose.yml` is an
[IANA timezone name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)
like `Europe/London` or `Asia/Kolkata`.

## Security stuff worth knowing

Login is required at setup, passwords are stored as scrypt hashes, and
integration secrets are stripped out of API responses.

The container runs as a non-root user (`UID:GID`, default `1000:1000`) with
all capabilities dropped and `no-new-privileges` on. It also uses host
networking (`network_mode: host`, `pid: host`) so the ports table and
network stat see the real host, and it mounts `/` read-only for disk usage.
That's a fair bit of host visibility, so keep this on a network you trust.

The Docker socket mount is read-only at the file level only. Anything
running in this container can still talk to the Docker API and create a
privileged container, which is root on the host. Take the mount out if you
don't need container stats. To change the host user, set `UID` and `GID`
before starting; for the socket, set `DOCKER_GID` to your host's `docker`
group id.

Want tighter isolation? Drop `network_mode: host` and add a port mapping:

```yaml
ports:
  - "8080:8080"
```

Everything else keeps working. You just lose host-level accuracy in the
ports table and network throughput stat.

## The bits people usually ask about

**Services.** Add them in the wizard or with **+ Add service** in the
Services header. Click a tile to open the service in a new tab, drag it to
reorder, or drop it on another category. Settings shows icon and name
suggestions as you type.

**Proxmox.** A read-only API token gets you nodes, guest counts, and a list
of VMs and containers with live CPU and memory. Expand a guest for its IP
address, disk usage, network I/O, and uptime. On PVE 8.1+ the token needs
the **PVEAuditor** role granted to the token itself at `/` with
**Propagate** ticked — tokens there don't inherit their user's rights.
QEMU VMs need the guest agent for IPs; LXCs report their own.

**DNS blockers.** Enter the URL with no trailing slash. Pi-hole wants its
API token, and on v6 you need the legacy `/admin/api.php` API enabled.
AdGuard Home uses your admin username and password. On GL.iNet routers the
AGH credentials are switched off, so pick the GL.iNet mode and log in with
the router's account instead. A widget that can't connect just hides
itself; it won't break the page.

**Nginx Proxy Manager.** The service name needs to contain "nginx". Put
the admin email and password in that service's row in Settings and the
tile shows:

| Info | When it appears |
|---|---|
| Active proxy hosts count | Tile ≥ 2 columns wide |
| Hosts / Streams / Certs | Tile ≥ 3 columns or 3 rows |
| Dead hosts + last audit action | Tile ≥ 4 columns or 4 rows |

**Integrations.** Pick one under **Settings → Services → Service widget**.
The metric checkboxes change to match, so each tile shows only what you
asked for. Credentials stay on your server and go straight to that
service — they're never put in the tile's link.

| Kind | Examples | What shows |
|---|---|---|
| Media | Jellyfin, Emby, Plex, Immich | Counts, streams, libraries, server info |
| Downloads | qBittorrent | Speeds, seeding, leeching |
| *arr apps | Sonarr, Radarr, Lidarr, Prowlarr | Wanted, queued, indexers |
| Other | Nextcloud, Portainer, Overseerr, NPM | Storage, endpoints, requests, host counts |

**Custom API.** If your app isn't on the list, give it a JSON endpoint and
map a few `Label=json.path` lines, optionally with an auth header. Paths
use dots, so `storage.used` reads `{ "storage": { "used": 123 } }`.

## If something looks off

- **Tile says "offline" but the service is up.** Checks run on the server,
  not your browser, so the server has to reach the URL. Remote services
  are re-probed every 30 minutes, so a recovery can take a bit to show.
  The dot and the text flip together.
- **No icon.** It tried the icon set and the favicon lookup. Letter avatar
  is the fallback; nothing is broken.
- **Open Ports is empty.** Needs `network_mode: host`.
- **Temperature shows `--`.** The host doesn't expose `/sys/class/thermal`.
- **Disk usage looks wrong.** `HOST_DISK_PATH` defaults to `/hostfs`. Change
  the mount and the variable together.
- **No login screen.** Settings → Security. On narrow screens the tabs wrap
  onto another row, so scroll down. Put HTTPS in front of this before
  exposing it past the LAN.
- **Proxmox panel is blank or hidden.** Check the token ID format
  (`user@pam!tokenid`), the read-only role, and the ACL note above.
- **Pi-hole / AdGuard widget stays hidden.** Check the URL from the
  container and the credentials. AGH returning `403` usually means a
  GL.iNet router — switch modes.

## Updating

```bash
git pull
docker compose up -d --build
```

`data/config.json` sits outside the image, so it survives updates.

## The tech bits

Node.js and Express, `systeminformation` for host stats, `rss-parser` for
feeds, Open-Meteo for weather (no key). Frontend is plain HTML, CSS and
JavaScript — no build step, no framework, small image.

## License

MIT. See [LICENSE](LICENSE).
