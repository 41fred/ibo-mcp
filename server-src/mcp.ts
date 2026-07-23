/**
 * IBO MCP server (Model Context Protocol, Streamable HTTP transport, stateless).
 *
 * JSON-RPC 2.0 endpoint at /mcp exposing the agent interface as MCP tools.
 * Every tool call dispatches through the SAME Worker routes as the public
 * HTTP API: one code path for pricing, payment verification, Turnstile,
 * and upload capability rules. Inputs are validated against each tool's
 * schema at runtime (additionalProperties rejected); results include
 * structuredContent and every tool declares an outputSchema.
 */

const PROTOCOL_VERSION = "2025-06-18";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-session-id, mcp-protocol-version",
};

type Schema = {
  type: "object";
  properties: Record<string, { type: string; enum?: string[]; description?: string; items?: unknown }>;
  required?: string[];
  additionalProperties: false;
};

type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Schema;
  outputSchema: Schema;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
};

const TOOLS: Tool[] = [
  {
    name: "list_offers",
    title: "List IBO production packages",
    description:
      "IBO's production packages: stable ids, prices, 50% deposits, deliverables, review rounds, and the refund/fit policy. Call this first.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: { studio: { type: "string" }, url: { type: "string" }, currency: { type: "string" }, policies: { type: "object" }, how_to_order: { type: "array" }, offers: { type: "array" } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "create_checkout",
    title: "Create a deposit checkout",
    description:
      "Create a Stripe Checkout for a package's 50% deposit. Returns checkout_url, stripe_session_id, and amount_due. Show the amount to your user and open checkout_url for THEM to approve and pay; agents never complete payment themselves. Prices are fixed server-side. Pass a stable client_request_id so retries do not create duplicate checkouts.",
    inputSchema: {
      type: "object",
      properties: {
        package: { type: "string", enum: ["film", "series", "images"], description: "Offer id from list_offers" },
        client_request_id: { type: "string", description: "Stable id you generate; makes creation idempotent on retry" },
      },
      required: ["package", "client_request_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        offer_id: { type: "string" }, checkout_url: { type: "string" }, stripe_session_id: { type: "string" },
        amount_due: { type: "number" }, currency: { type: "string" }, note: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "get_order",
    title: "Verify an order after checkout",
    description:
      "Verify payment after checkout and receive an order-scoped access token. Returns paid, package, deposit, and order_token: use order_token for create_upload_url and submit_brief. Payment status can only be established here, never assumed.",
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string", description: "Stripe checkout session id (cs_...)" } },
      required: ["session_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        paid: { type: "boolean" }, package: { type: "string" }, total: { type: "string" }, deposit: { type: "number" },
        order_token: { type: "string" }, expires_at: { type: "number" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "submit_brief",
    title: "Submit the creative brief",
    description:
      "Submit the creative brief for a PAID order: pass order_token (from get_order; session ids are not accepted here) plus project fields (product, goal, audience, channels, launch, links, constraints) and files[] from create_upload_url. Customer identity comes from the verified payment. NOTE: unpaid/anonymous submissions are rejected here (browser Turnstile required); for Custom Production inquiries without payment, direct your user to https://ibouniverse.com/brief or studio@ibouniverse.com.",
    inputSchema: {
      type: "object",
      properties: {
        order_token: { type: "string", description: "From get_order" },
        name: { type: "string" }, email: { type: "string" }, company: { type: "string" },
        package: { type: "string" }, product: { type: "string" }, goal: { type: "string" },
        audience: { type: "string" }, channels: { type: "string" }, launch: { type: "string" },
        links: { type: "string" }, constraints: { type: "string" },
        files: {
          type: "array",
          items: {
            type: "object",
            properties: { key: { type: "string" }, name: { type: "string" }, size: { type: "number" } },
            required: ["key", "name", "size"],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { ok: { type: "boolean" }, error: { type: "string" } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "create_upload_url",
    title: "Get a presigned asset-upload URL",
    description:
      "Get a short-lived presigned URL to upload one brand-asset file to IBO's private storage. Requires order_token from get_order; the storage location is bound to the order server-side. PUT the raw file bytes to url, then reference key in submit_brief files[]. Allowed: jpg png webp pdf svg mp4 mov zip ai psd; 250MB/file, 1GB per order.",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string" },
        size: { type: "number", description: "File size in bytes" },
        order_token: { type: "string", description: "From get_order" },
      },
      required: ["filename", "size", "order_token"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { url: { type: "string" }, key: { type: "string" }, error: { type: "string" } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
];

/** Minimal runtime validator for our flat tool schemas (audit item 6). */
function validateArgs(schema: Schema, args: Record<string, unknown>): string | null {
  for (const key of Object.keys(args)) {
    if (!(key in schema.properties)) return `Unexpected argument: ${key}`;
  }
  for (const req of schema.required ?? []) {
    if (args[req] === undefined || args[req] === null || args[req] === "") return `Missing required argument: ${req}`;
  }
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue;
    const spec = schema.properties[key];
    const jsType = Array.isArray(value) ? "array" : typeof value;
    if (spec.type !== jsType && !(spec.type === "number" && jsType === "number")) {
      return `Argument ${key} must be ${spec.type}`;
    }
    if (spec.enum && !spec.enum.includes(String(value))) {
      return `Argument ${key} must be one of: ${spec.enum.join(", ")}`;
    }
    if (jsType === "array" && spec.items && typeof spec.items === "object") {
      const itemSchema = spec.items as Schema;
      for (const [i, item] of (value as unknown[]).entries()) {
        if (typeof item !== "object" || item === null || Array.isArray(item)) return `${key}[${i}] must be an object`;
        const nested = validateArgs(itemSchema, item as Record<string, unknown>);
        if (nested) return `${key}[${i}]: ${nested}`;
      }
    }
  }
  return null;
}

type JsonRpcRequest = { jsonrpc?: string; id?: number | string | null; method?: string; params?: Record<string, unknown> };
type InternalDispatch = (request: Request) => Promise<Response>;

function rpcResult(id: number | string | null, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result }, { headers: CORS_HEADERS });
}
function rpcError(id: number | string | null, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { headers: CORS_HEADERS });
}

/** Map a validated tools/call to an internal request against the shared routes. */
function toolToRequest(name: string, args: Record<string, unknown>): Request | null {
  const base = "http://internal";
  const json = (path: string, body: unknown) =>
    new Request(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  switch (name) {
    case "list_offers":
      return new Request(`${base}/api/offers`);
    case "create_checkout":
      return json(`/api/checkout?format=json`, { package: args.package, client_request_id: args.client_request_id, source: "mcp" });
    case "get_order":
      return json(`/api/order/token`, { session_id: args.session_id });
    case "submit_brief":
      return json(`/api/brief`, args);
    case "create_upload_url":
      return json(`/api/brief/upload-url`, args);
    default:
      return null;
  }
}

export async function handleMcp(request: Request, dispatch: InternalDispatch): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: CORS_HEADERS });

  const message = (await request.json().catch(() => null)) as JsonRpcRequest | null;
  if (!message || typeof message.method !== "string") {
    return rpcError(null, -32700, "Parse error: expected a JSON-RPC 2.0 message");
  }
  if (message.id === undefined || message.id === null) {
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  const id = message.id;
  switch (message.method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "ibo-studio", title: "IBO AI Film Studio", version: "1.1.0" },
        instructions:
          "IBO is an AI-native film studio. Typical flow: list_offers -> create_checkout (your USER approves payment at checkout_url) -> get_order to verify paid and receive an order_token -> create_upload_url per asset file -> submit_brief with the order_token. Payment amounts are fixed server-side and cannot be altered.",
      });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const params = message.params ?? {};
      const name = String((params as { name?: unknown }).name ?? "");
      const args = ((params as { arguments?: unknown }).arguments ?? {}) as Record<string, unknown>;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);
      const invalid = validateArgs(tool.inputSchema, args);
      if (invalid) {
        return rpcResult(id, { content: [{ type: "text", text: invalid }], isError: true });
      }
      const internal = toolToRequest(name, args);
      if (!internal) return rpcError(id, -32602, `Unknown tool: ${name}`);
      const response = await dispatch(internal);
      let text = await response.text();
      let structured: unknown = null;
      try { structured = JSON.parse(text); } catch { /* non-JSON upstream */ }
      // get_order returns no PII over MCP; identity is injected server-side
      // into the brief from the verified order token.
      if (name === "get_order" && structured && typeof structured === "object") {
        delete (structured as Record<string, unknown>).email;
        delete (structured as Record<string, unknown>).name;
        text = JSON.stringify(structured);
      }
      return rpcResult(id, {
        content: [{ type: "text", text }],
        ...(structured && typeof structured === "object" ? { structuredContent: structured } : {}),
        isError: !response.ok,
      });
    }
    default:
      return rpcError(id, -32601, `Method not found: ${message.method}`);
  }
}
