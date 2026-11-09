const assert = require("assert");
const { mapNextcloudInfo, parseDockerPort, probeResponseIsAvailable, serviceCredentialError, safeSettingsBackup } = require("../server");

function testDockerPortParsing() {
  assert.deepStrictEqual(
    parseDockerPort("0.0.0.0:32400->32400/tcp"),
    { hostPort: 32400, containerPort: 32400, protocol: "tcp" },
    "parses Docker string port bindings"
  );
  assert.deepStrictEqual(
    parseDockerPort({ publicPort: 8080, privatePort: 80, type: "TCP" }),
    { hostPort: 8080, containerPort: 80, protocol: "tcp" },
    "normalizes Docker object port bindings"
  );
  assert.deepStrictEqual(
    parseDockerPort({ privatePort: 5353, type: "udp" }),
    { hostPort: null, containerPort: 5353, protocol: "udp" },
    "keeps container-only ports without inventing a host binding"
  );
  assert.strictEqual(parseDockerPort("not-a-port"), null, "rejects malformed Docker port data");
}

testDockerPortParsing();

assert.strictEqual(probeResponseIsAvailable(302), true, "treats a safe HTTP redirect as reachable");
assert.strictEqual(probeResponseIsAvailable(307), true, "treats a temporary HTTP redirect as reachable");
assert.strictEqual(probeResponseIsAvailable(500), false, "treats server errors as unavailable");

assert.deepStrictEqual(
  mapNextcloudInfo({
    nextcloud: {
      system: { freespace: 682060939264 },
      storage: { num_files: 462 },
      shares: { num_shares: 3 }
    },
    activeUsers: { last24hours: 1, last1hour: 1 }
  }),
  { cpuLoad: null, memoryUsage: null, freeSpace: 682060939264, activeUsers: 1, files: 462, shares: 3 },
  "maps nested Nextcloud serverinfo metrics"
);

assert.strictEqual(
  serviceCredentialError({ type: "plex", details: true, apiKey: "" }),
  "Plex requires an API key or token.",
  "rejects a Plex service without a token"
);
assert.strictEqual(
  serviceCredentialError({ type: "nextcloud", details: true, widgetConfig: { username: "", password: "" } }),
  "Nextcloud requires an NC-Token or both username and password.",
  "rejects incomplete Nextcloud credentials"
);
assert.strictEqual(
  serviceCredentialError({ type: "portainer", details: true, apiKey: "token" }),
  null,
  "accepts a Portainer token"
);
const backup = safeSettingsBackup({
  profile: { name: "Test" },
  services: [{ id: "s1", name: "Plex", url: "http://plex", apiKey: "secret", widgetConfig: { username: "user", password: "pass", token: "token", authValue: "header-secret" } }],
  pihole: { enabled: true, url: "http://pi", apiKey: "secret" },
  adguard: { enabled: true, url: "http://ag", username: "admin", password: "secret" },
  proxmox: { enabled: true, url: "https://pve", tokenSecret: "secret" }
});
assert.strictEqual(backup.services[0].apiKey, undefined, "backup excludes service API keys");
assert.strictEqual(backup.services[0].widgetConfig.password, undefined, "backup excludes widget passwords");
assert.strictEqual(backup.pihole.apiKey, undefined, "backup excludes Pi-hole key");
assert.strictEqual(backup.adguard.password, undefined, "backup excludes AdGuard password");
assert.strictEqual(backup.proxmox.tokenSecret, undefined, "backup excludes Proxmox secret");
console.log("12 server unit tests passed");
