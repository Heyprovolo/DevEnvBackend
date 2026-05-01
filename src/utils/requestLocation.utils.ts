import type { Request } from "express";

const MAX_LABEL = 64;

/** Labels for region/state (e.g. Vercel subdivision, full names from client hints). */
function sanitizeRegion(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().slice(0, MAX_LABEL);
  if (!t || t.length < 2) return null;
  if (!/^[\p{L}\d\s\-,.']+$/u.test(t)) return null;
  return t;
}

/**
 * Normalizes CDN / client-provided country: ISO-ish 2-letter from CDNs or a short label from client hints.
 */
function normalizeCountry(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase().slice(0, MAX_LABEL);
  if (!v) return null;
  // Cloudflare "unknown" sentinel values
  if (v === "XX" || v === "T1") return null;
  const two = v.length >= 2 ? v.slice(0, 2) : v;
  if (two.length === 2 && /^[A-Z]{2}$/.test(two)) return two;
  const label = raw.trim().slice(0, MAX_LABEL);
  if (/^[\p{L}\d\s\-,.']+$/u.test(label)) return label;
  return null;
}

function header(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0];
  return v;
}

/**
 * Infer country/state from trusted edge headers (Cloudflare, Vercel, CloudFront) or optional client hints.
 * Returns null for both when signals are absent or unknown — never guesses from IP alone here.
 */
export function extractRequestLocation(req: Request): {
  country: string | null;
  state: string | null;
} {
  const fromCdn =
    normalizeCountry(header(req, "cf-ipcountry")) ||
    normalizeCountry(header(req, "x-vercel-ip-country")) ||
    normalizeCountry(header(req, "cloudfront-viewer-country"));

  const fromClient = normalizeCountry(header(req, "x-client-country"));
  const country = fromCdn || fromClient || null;

  const state =
    sanitizeRegion(header(req, "x-vercel-ip-country-region")) ||
    sanitizeRegion(header(req, "x-client-region")) ||
    sanitizeRegion(header(req, "x-client-state")) ||
    null;

  return { country, state };
}
