# Server source (audit transparency)

Published copies of the MCP/agent-interface modules and test suite from the
private site repo, for code-level audit. The full Worker also contains the
checkout/webhook/brief handlers these dispatch into.

- Source commit: `41fred/ibo-website@ed12061a042379296219610c621885738607c8b2`
- Files: `mcp.ts` (protocol layer), `rate-limit.ts`, `r2-presign.ts`, and the
  relevant audit test copy in `tests.mjs`.
- Protocol changes follow the IBO Release, Registry Sync, and Rollback SOP.
  `node scripts/validate-release.mjs` must pass before tagging a release; pass
  the local website checkout as an optional argument to require byte-for-byte
  equality with its production `worker/mcp.ts`.
