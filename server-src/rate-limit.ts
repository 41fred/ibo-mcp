/**
 * Lightweight sliding-window rate limiter for abuse mitigation.
 *
 * Honest scope: state is per-isolate (per Cloudflare colo process), so this is
 * not billing-grade global limiting. It IS effective against the realistic
 * threat: a single source hammering checkout/brief/MCP endpoints, since
 * repeat traffic from one client lands on the same colo. Zero bindings, zero
 * dependencies, safe under the vinext-generated Worker config.
 */

const buckets = new Map<string, number[]>();
const MAX_KEYS = 10_000;

/** Returns true when the request is allowed; false when over the limit. */
export function allowRequest(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  // Backstop against unbounded growth from spoofed/rotating keys.
  if (buckets.size > MAX_KEYS) buckets.clear();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}

export function rateLimitResponse(): Response {
  return Response.json(
    { error: "Rate limited. Please retry shortly." },
    { status: 429, headers: { "retry-after": "30", "cache-control": "no-store" } },
  );
}

/** Per-endpoint-class limits (requests per minute per client IP). */
export const RATE_LIMITS: Array<{ prefix: string; limit: number }> = [
  { prefix: "/api/checkout", limit: 10 },   // creates real Stripe sessions
  { prefix: "/api/brief/upload-url", limit: 30 },
  { prefix: "/api/brief", limit: 6 },       // sends emails
  { prefix: "/api/order", limit: 30 },
  { prefix: "/api/checkout-session", limit: 30 },
  { prefix: "/mcp", limit: 60 },
];

export function checkRateLimit(request: Request, pathname: string): Response | null {
  const rule = RATE_LIMITS.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  if (!rule) return null;
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  return allowRequest(`${rule.prefix}:${ip}`, rule.limit, 60_000) ? null : rateLimitResponse();
}
