/**
 * Minimal AWS SigV4 query presigner for Cloudflare R2 (S3-compatible).
 * No dependencies — WebCrypto only. Presigned URLs let the browser PUT files
 * directly to the private bucket without routing bytes through the Worker.
 */

const encoder = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key instanceof Uint8Array ? (key as unknown as ArrayBuffer) : key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
}

const toHex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256Hex(data: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(data)));
}

/** AWS-style URI encoding (RFC 3986; slash optionally preserved for paths). */
function uriEncode(value: string, encodeSlash: boolean): string {
  return [...value].map((ch) => {
    if (/[A-Za-z0-9\-._~]/.test(ch)) return ch;
    if (ch === "/" && !encodeSlash) return ch;
    return [...encoder.encode(ch)].map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`).join("");
  }).join("");
}

export async function presignR2Url(options: {
  accessKeyId: string;
  secretAccessKey: string;
  accountId: string;
  bucket: string;
  key: string;
  method: "PUT" | "GET" | "HEAD";
  expiresSeconds: number;
  /** Extra signed query params, e.g. list-type/prefix or response-content-disposition. */
  extraQuery?: Array<[string, string]>;
}): Promise<string> {
  const { accessKeyId, secretAccessKey, accountId, bucket, key, method, expiresSeconds, extraQuery = [] } = options;
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const amzDate = `${dateStamp}T${now.toISOString().slice(11, 19).replace(/:/g, "")}Z`;
  const scope = `${dateStamp}/auto/s3/aws4_request`;

  const query: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresSeconds)],
    ["X-Amz-SignedHeaders", "host"],
    ...extraQuery,
  ];
  const canonicalQuery = query
    .map(([k, v]) => [uriEncode(k, true), uriEncode(v, true)] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalUri = `/${uriEncode(bucket, true)}/${uriEncode(key, false)}`;
  const canonicalRequest = [
    method, canonicalUri, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest),
  ].join("\n");

  let signingKey = await hmac(encoder.encode(`AWS4${secretAccessKey}`) as unknown as ArrayBuffer, dateStamp);
  for (const part of ["auto", "s3", "aws4_request"]) signingKey = await hmac(signingKey, part);
  const signature = toHex(await hmac(signingKey, stringToSign));

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
