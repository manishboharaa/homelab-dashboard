const assert = require("assert");
const { parseDockerPort } = require("../server");

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
console.log("4 server unit tests passed");
