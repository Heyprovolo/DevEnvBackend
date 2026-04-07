import type { Request, Response, NextFunction } from "express";

/**
 * Client IP for rate limiting behind Fly, Vercel, Cloudflare, etc.
 * Without a real per-user IP, every request can share one bucket and trigger 429s app-wide.
 */
export function getTrustedClientIp(req: Request): string {
  const xffRaw = req.headers["x-forwarded-for"];
  const xff =
    typeof xffRaw === "string"
      ? xffRaw
      : Array.isArray(xffRaw)
        ? xffRaw[0]
        : "";
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }

  const fly = req.headers["fly-client-ip"];
  if (typeof fly === "string" && fly.trim()) return fly.trim();

  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.trim()) return real.trim();

  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();

  const raw = req.socket.remoteAddress || "";
  return raw.replace(/^::ffff:/, "");
}

export interface RateLimiterConfig {
  requestsPerMinute: number;
  burstSize: number;
  cleanupIntervalMs: number;
}

export const defaultRateLimiterConfig: RateLimiterConfig = {
  requestsPerMinute: 60,
  burstSize: 10,
  cleanupIntervalMs: 5 * 60 * 1000,
};

export const strictRateLimiterConfig: RateLimiterConfig = {
  requestsPerMinute: 30,
  burstSize: 5,
  cleanupIntervalMs: 5 * 60 * 1000,
};

function takeToken(
  clients: Map<string, { tokens: number; lastRefill: number }>,
  key: string,
  now: number,
  config: RateLimiterConfig
): boolean {
  let client = clients.get(key);
  if (!client) {
    client = { tokens: config.burstSize, lastRefill: now };
    clients.set(key, client);
  }

  const timePassed = now - client.lastRefill;
  const tokensToAdd = Math.floor((timePassed / 60000) * config.requestsPerMinute);
  if (tokensToAdd > 0) {
    client.tokens = Math.min(client.tokens + tokensToAdd, config.burstSize);
    client.lastRefill = now;
  }

  if (client.tokens > 0) {
    client.tokens--;
    return true;
  }

  return false;
}

export function rateLimiterMiddleware(config: RateLimiterConfig) {
  const clients = new Map<string, { tokens: number; lastRefill: number }>();

  setInterval(() => {
    const now = Date.now();
    for (const [ip, client] of clients.entries()) {
      if (now - client.lastRefill > 10 * 60 * 1000) {
        clients.delete(ip);
      }
    }
  }, config.cleanupIntervalMs);

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = getTrustedClientIp(req);
    const userKey = req.userID ? `user:${req.userID}` : null;
    const ipKey = `ip:${ip || "unknown"}`;
    const now = Date.now();
    const ipAllowed = takeToken(clients, ipKey, now, config);
    const userAllowed = userKey
      ? takeToken(clients, userKey, now, config)
      : true;

    if (ipAllowed && userAllowed) {
      return next();
    } else {
      res.setHeader("X-RateLimit-Limit", config.requestsPerMinute.toString());
      res.setHeader("X-RateLimit-Remaining", "0");
      res.setHeader("Retry-After", "60");
      return res.status(429).json({
        title: "Rate Limit Exceeded",
        message: "Too many requests. Please try again later.",
        status: "error",
        data: null,
      });
    }
  };
}

export function globalRateLimiter() {
  return rateLimiterMiddleware(defaultRateLimiterConfig);
}

export function strictRateLimiter() {
  return rateLimiterMiddleware(strictRateLimiterConfig);
}
