import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * This application has an unusually small attack surface: it is fully static,
 * makes no network requests at runtime, has no backend, no authentication, no
 * cookies and no user-generated content. The headers below are about closing
 * off the classes of attack that remain — clickjacking, MIME sniffing, referrer
 * leakage and unexpected egress — rather than defending a dynamic app.
 *
 * Note on `script-src 'unsafe-inline'`: Next.js inlines its hydration payload,
 * so a nonce-based policy would require per-request rendering and forfeit static
 * generation. Given there is no path by which untrusted input reaches the DOM
 * (no `dangerouslySetInnerHTML`, no `eval`, no third-party scripts), that is a
 * deliberate and documented trade-off rather than an oversight. The `connect-src
 * 'self'` and `object-src 'none'` directives are the ones doing real work here:
 * even if a script were somehow injected, it could not exfiltrate anywhere.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // The application never calls out. Anything trying to is not ours.
  "connect-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  // Belt-and-braces alongside frame-ancestors, for older browsers.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // Do not advertise the framework version to scanners.
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
