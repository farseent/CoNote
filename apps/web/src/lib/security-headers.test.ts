import { describe, expect, it } from 'vitest';
import { buildSecurityHeaders, contentSecurityPolicy } from '../../security-headers';

const asMap = (headers: { key: string; value: string }[]) =>
  Object.fromEntries(headers.map((h) => [h.key, h.value]));

describe('web security headers (Phase 10, AC-10.3)', () => {
  it('sets the baseline headers on every response', () => {
    const h = asMap(buildSecurityHeaders('https://app.example.com'));
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('no-referrer');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(h['Permissions-Policy']).toContain('camera=()');
    expect(h['Content-Security-Policy']).toBeTruthy();
  });

  it('sends HSTS only when the app is served over https', () => {
    expect(
      asMap(buildSecurityHeaders('https://app.example.com'))['Strict-Transport-Security'],
    ).toMatch(/^max-age=\d+; includeSubDomains$/);
    expect(
      asMap(buildSecurityHeaders('http://localhost:3000'))['Strict-Transport-Security'],
    ).toBeUndefined();
  });

  it('forbids framing, plugins and foreign form targets, and pins the base URL', () => {
    const csp = contentSecurityPolicy('https://app.example.com');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it('allows only secure WebSockets under https, and plain ones too under http', () => {
    const connect = (csp: string) => csp.split('; ').find((d) => d.startsWith('connect-src'));
    expect(connect(contentSecurityPolicy('https://app.example.com'))).toBe(
      "connect-src 'self' wss:",
    );
    expect(connect(contentSecurityPolicy('http://localhost:3000'))).toBe(
      "connect-src 'self' ws: wss:",
    );
  });

  it('allows no remote scripts, images or frames', () => {
    const csp = contentSecurityPolicy('https://app.example.com');
    expect(csp).not.toMatch(/https?:\/\//);
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data: blob:");
  });
});
