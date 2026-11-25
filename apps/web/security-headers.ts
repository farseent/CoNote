/**
 * Security headers for every response of the web app (ARCHITECTURE §10.4, D70, AC-10.3).
 * The API sets its own through Helmet; these cover the pages.
 */
export interface Header {
  key: string;
  value: string;
}

/**
 * The page CSP. Next.js inlines its bootstrap scripts, so `script-src` needs `'unsafe-inline'`
 * until a per-request nonce is added (D70 records that option); everything else is closed:
 * no plugins, no framing, no foreign form targets, no remote resources. The collaboration
 * WebSocket origin is handed to the browser at run time by the API, so it cannot be named here:
 * `wss:` is allowed, and `ws:` only when the app itself is served over plain http (local use).
 */
export function contentSecurityPolicy(appUrl: string): string {
  const secure = appUrl.startsWith('https://');
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${secure ? 'wss:' : 'ws: wss:'}`,
  ].join('; ');
}

export function buildSecurityHeaders(appUrl: string): Header[] {
  const headers: Header[] = [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(appUrl) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ];
  if (appUrl.startsWith('https://')) {
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000; includeSubDomains',
    });
  }
  return headers;
}
