import type { NextFunction, Request, Response } from "express";
import crypto from "crypto";
import type {
  ErrorCategory,
  RequestErrorDetails,
  RequestObservabilityEvent,
} from "../types/observability.ts";
import { logJson } from "../utils/structuredLogger.ts";
import { sendSlackCriticalAlert } from "../utils/slackAlerts.ts";

const REDACT_KEYS = new Set([
  "password",
  "token",
  "authorization",
  "email",
  "idToken",
  "session",
  "cookie",
  "secret",
  "apiKey",
]);

declare global {
  namespace Express {
    interface Request {
      observability?: {
        requestId: string;
        startMs: number;
        dbLatencyMs: number;
        externalLatencyMs: number;
        addDbLatency: (ms: number) => void;
        addExternalLatency: (ms: number) => void;
        setError: (error: RequestErrorDetails) => void;
        error?: RequestErrorDetails;
      };
    }
  }
}

function sanitizePayload(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizePayload(item, depth + 1));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(record)) {
      if (REDACT_KEYS.has(key)) {
        output[key] = "[redacted]";
        continue;
      }
      if (typeof raw === "string") {
        output[key] = raw.length > 500 ? `${raw.slice(0, 500)}...[truncated]` : raw;
        continue;
      }
      output[key] = sanitizePayload(raw, depth + 1);
    }
    return output;
  }
  return value;
}

function detectFeature(path: string) {
  if (path.includes("/analytics/backend")) return "backend_analytics";
  if (path.includes("/ai/optimize-upwork") || path.includes("/ai/optimize-linkedin")) return "optimization_prompt";
  if (path.includes("/ai/generate-proposal") || path.includes("/ai/refine-proposal")) return "proposal_generation";
  if (path.includes("/resumes")) return "resume_assistance";
  return "general";
}

function categorize(statusCode: number, message: string): ErrorCategory {
  const lower = message.toLowerCase();
  if (statusCode >= 500) return "http_5xx";
  if (statusCode >= 400) {
    if (lower.includes("quota")) return "quota_error";
    if (lower.includes("auth") || statusCode === 401 || statusCode === 403) return "auth_error";
    if (lower.includes("validation") || statusCode === 400) return "validation_error";
    return "http_4xx";
  }
  return "internal_failure";
}

export function observeRequest(req: Request, res: Response, next: NextFunction) {
  const requestId = crypto.randomUUID();
  const startMs = performance.now();
  const maybeSessionHeader = req.headers["x-session-id"];
  const sessionId = typeof maybeSessionHeader === "string" ? maybeSessionHeader : undefined;

  req.observability = {
    requestId,
    startMs,
    dbLatencyMs: 0,
    externalLatencyMs: 0,
    addDbLatency: (ms: number) => {
      if (!Number.isFinite(ms) || ms < 0) return;
      if (!req.observability) return;
      req.observability.dbLatencyMs += ms;
    },
    addExternalLatency: (ms: number) => {
      if (!Number.isFinite(ms) || ms < 0) return;
      if (!req.observability) return;
      req.observability.externalLatencyMs += ms;
    },
    setError: (error: RequestErrorDetails) => {
      if (!req.observability) return;
      req.observability.error = error;
    },
  };

  res.setHeader("x-request-id", requestId);

  let responseBody: unknown;
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    responseBody = body;
    return originalJson(body);
  };

  res.on("finish", () => {
    if (!req.observability) return;
    const durationMs = performance.now() - req.observability.startMs;
    const routePath =
      (req.route?.path
        ? `${req.baseUrl}${String(req.route.path)}`
        : req.originalUrl.split("?")[0]) ?? req.originalUrl ?? "";
    const endpoint = `${req.method} ${routePath}`;
    const statusCode = res.statusCode;
    const success = statusCode < 400;
    const processingLatencyMs = Math.max(
      0,
      durationMs - req.observability.dbLatencyMs - req.observability.externalLatencyMs
    );
    const feature = detectFeature(routePath);

    const errorPayload = req.observability.error
      ? req.observability.error
      : !success
      ? {
          category: categorize(statusCode, JSON.stringify(responseBody ?? "")),
          type: "http_response_error",
          message:
            typeof responseBody === "object" && responseBody
              ? JSON.stringify(responseBody).slice(0, 800)
              : `Request failed with status ${statusCode}`,
        }
      : undefined;

    const event: RequestObservabilityEvent = {
      kind: "request" as const,
      timestamp: new Date().toISOString(),
      endpoint,
      route: routePath,
      method: req.method,
      feature,
      statusCode,
      success,
      durationMs: Number(durationMs.toFixed(2)),
      dbLatencyMs: Number(req.observability.dbLatencyMs.toFixed(2)),
      externalLatencyMs: Number(req.observability.externalLatencyMs.toFixed(2)),
      processingLatencyMs: Number(processingLatencyMs.toFixed(2)),
      requestId,
    };
    if (req.userID) event.userId = req.userID;
    if (sessionId) event.sessionId = sessionId;
    const payload = sanitizePayload(req.body);
    if (payload && typeof payload === "object") {
      event.requestPayload = payload as Record<string, unknown>;
    }
    if (errorPayload) event.error = errorPayload;

    logJson(success ? "info" : "error", {
      event: "http_request_observed",
      endpoint,
      statusCode,
      feature,
      requestId,
      durationMs: event.durationMs,
      dbLatencyMs: event.dbLatencyMs,
      externalLatencyMs: event.externalLatencyMs,
      success,
      errorCategory: errorPayload?.category,
    });

    const shouldSendSlackAlert =
      statusCode >= 500 || errorPayload?.category === "external_api_error";

    if (shouldSendSlackAlert) {
      const alertPayload: {
        title: string;
        requestId: string;
        endpoint: string;
        route: string;
        method: string;
        statusCode: number;
        feature: string;
        durationMs: number;
        dbLatencyMs: number;
        externalLatencyMs: number;
        errorCategory?: string;
        errorType?: string;
        errorMessage?: string;
        errorStack?: string;
        payloadPreview?: unknown;
      } = {
        title: statusCode >= 500
          ? process.env.NODE_ENV === "production"
            ? "PRODUCTION Critical Error (5xx)"
            : "DevEnvBackend Critical Error (5xx)"
          : process.env.NODE_ENV === "production"
            ? "PRODUCTION AI/External Error"
            : "DevEnvBackend AI/External Error",
        requestId,
        endpoint,
        route: routePath,
        method: req.method,
        statusCode,
        feature,
        durationMs: event.durationMs,
        dbLatencyMs: event.dbLatencyMs,
        externalLatencyMs: event.externalLatencyMs,
      };
      if (errorPayload?.category) alertPayload.errorCategory = errorPayload.category;
      if (errorPayload?.type) alertPayload.errorType = errorPayload.type;
      if (errorPayload?.message) alertPayload.errorMessage = errorPayload.message;
      if (errorPayload?.stack) alertPayload.errorStack = errorPayload.stack;
      if (event.requestPayload) alertPayload.payloadPreview = event.requestPayload;
      void sendSlackCriticalAlert(alertPayload);
    }
  });

  next();
}

export function observeUnhandledErrors(error: unknown, req: Request, res: Response, _next: NextFunction) {
  const statusCode = typeof (error as { status?: number })?.status === "number" ? (error as { status: number }).status : 500;
  const message = error instanceof Error ? error.message : "Unhandled error";
  const stack = error instanceof Error ? error.stack : undefined;

  const errorDetails: RequestErrorDetails = {
    category: statusCode >= 500 ? "internal_failure" : "http_4xx",
    type: error instanceof Error ? error.name : "UnhandledError",
    message,
  };
  if (stack) errorDetails.stack = stack;
  req.observability?.setError(errorDetails);

  logJson("error", {
    event: "unhandled_exception",
    requestId: req.observability?.requestId,
    endpoint: `${req.method} ${req.originalUrl}`,
    statusCode,
    message,
    stack,
  });

  if (res.headersSent) return;
  res.status(statusCode).json({
    title: "Internal Server Error",
    message: statusCode >= 500 ? "Unexpected server error" : message,
    status: "error",
  });
}

export async function timedDb<T>(req: Request, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    req.observability?.addDbLatency(performance.now() - start);
  }
}

export async function timedExternal<T>(req: Request, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    req.observability?.addExternalLatency(performance.now() - start);
  }
}

export function tagObservedError(
  req: Request,
  details: {
    category: ErrorCategory;
    type: string;
    message: string;
    stack?: string;
  }
) {
  req.observability?.setError(details);
}

