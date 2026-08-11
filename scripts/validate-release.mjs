import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (path) => readFileSync(resolve(root, path), "utf8");

const manifest = JSON.parse(read("server.json"));
const mcp = read("server-src/mcp.ts");
const readme = read("README.md");

const version = mcp.match(/MCP_SERVER_VERSION = "([^"]+)"/)?.[1];
assert.ok(version, "server source must export MCP_SERVER_VERSION");
assert.equal(manifest.version, version, "server.json and MCP server version differ");
assert.match(mcp, /enum: \["film", "film4k", "series"\]/);
assert.match(mcp, /Delivery resolution must be selected before creative kickoff/);
assert.match(mcp, /A 4K Campaign Series must use this route before checkout/);
assert.match(readme, /Campaign Film, 4K Campaign Film, and Campaign Series/);

const websitePath = process.argv[2];
if (websitePath) {
  const websiteMcp = readFileSync(resolve(websitePath, "worker/mcp.ts"), "utf8");
  assert.equal(mcp, websiteMcp, "public MCP source differs from website production source");
}

console.log(JSON.stringify({ ok: true, version, website_compared: Boolean(websitePath) }));
