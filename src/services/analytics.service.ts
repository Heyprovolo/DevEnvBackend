import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { getFirebaseApp } from "../utils/getFirebaseApp.ts";
import type { AnalyticsEventPayload, AnalyticsSummary } from "../types/analytics.ts";

type StoredEvent = {
  eventName: string;
  profile: "dev" | "prod";
  eventTime: Timestamp;
  route?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  actionName?: string;
  metricName?: string;
  metricValue?: number;
  rating?: string;
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
};

const COLLECTION_NAME = "analytics_events";

function stripUndefined<T extends Record<string, unknown>>(obj: T) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined)
  ) as T;
}

function toDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed;
}

export async function ingestAnalyticsEvents(events: AnalyticsEventPayload[]): Promise<number> {
  const app = getFirebaseApp();
  const db = getFirestore(app);
  const batch = db.batch();
  const now = Timestamp.now();

  for (const event of events) {
    const eventTime = event.eventTime ? new Date(event.eventTime) : new Date();
    const safeTime = Number.isNaN(eventTime.getTime()) ? new Date() : eventTime;
    const docRef = db.collection(COLLECTION_NAME).doc();
    const payload = stripUndefined({
      eventName: event.eventName,
      profile: event.profile,
      eventTime: Timestamp.fromDate(safeTime),
      route: event.route,
      method: event.method,
      statusCode: event.statusCode,
      durationMs: event.durationMs,
      actionName: event.actionName,
      metricName: event.metricName,
      metricValue: event.metricValue,
      rating: event.rating,
      metadata: event.metadata,
      createdAt: now,
    }) as StoredEvent;
    batch.set(docRef, payload);
  }

  await batch.commit();
  return events.length;
}

async function getEventsInRange(from?: string, to?: string, profile?: "dev" | "prod") {
  const app = getFirebaseApp();
  const db = getFirestore(app);
  const endFallback = new Date();
  const startFallback = new Date(endFallback.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fromDate = toDate(from, startFallback);
  const toDateValue = toDate(to, endFallback);

  const snapshot = await db
    .collection(COLLECTION_NAME)
    .where("eventTime", ">=", Timestamp.fromDate(fromDate))
    .where("eventTime", "<=", Timestamp.fromDate(toDateValue))
    .get();

  const events = snapshot.docs.map((doc) => doc.data() as StoredEvent);
  return profile ? events.filter((event) => event.profile === profile) : events;
}

export async function getAnalyticsSummary(
  from?: string,
  to?: string,
  profile?: "dev" | "prod"
): Promise<AnalyticsSummary> {
  const events = await getEventsInRange(from, to, profile);
  let pageViews = 0;
  let adminActions = 0;
  let apiRequests = 0;
  let apiSuccessCount = 0;
  let apiDurationTotal = 0;

  for (const event of events) {
    if (event.eventName === "page_view") pageViews += 1;
    if (event.eventName === "admin_action") adminActions += 1;
    if (event.eventName === "api_request") {
      apiRequests += 1;
      if ((event.statusCode ?? 0) > 0 && (event.statusCode ?? 0) < 400) apiSuccessCount += 1;
      if (typeof event.durationMs === "number") apiDurationTotal += event.durationMs;
    }
  }

  return {
    totalEvents: events.length,
    pageViews,
    adminActions,
    apiRequests,
    apiSuccessRate: apiRequests === 0 ? 0 : (apiSuccessCount / apiRequests) * 100,
    apiAverageDurationMs: apiRequests === 0 ? 0 : apiDurationTotal / apiRequests,
  };
}

function getBucketKey(date: Date, interval: "hour" | "day") {
  if (interval === "hour") {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
      date.getUTCDate()
    ).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}:00`;
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate()
  ).padStart(2, "0")}`;
}

export async function getAnalyticsTimeseries(
  from?: string,
  to?: string,
  profile?: "dev" | "prod",
  interval: "hour" | "day" = "day"
) {
  const events = await getEventsInRange(from, to, profile);
  const bucketMap = new Map<
    string,
    { bucket: string; totalEvents: number; apiRequests: number; pageViews: number; adminActions: number }
  >();

  for (const event of events) {
    const date = event.eventTime.toDate();
    const bucket = getBucketKey(date, interval);
    const current = bucketMap.get(bucket) ?? {
      bucket,
      totalEvents: 0,
      apiRequests: 0,
      pageViews: 0,
      adminActions: 0,
    };
    current.totalEvents += 1;
    if (event.eventName === "api_request") current.apiRequests += 1;
    if (event.eventName === "page_view") current.pageViews += 1;
    if (event.eventName === "admin_action") current.adminActions += 1;
    bucketMap.set(bucket, current);
  }

  return Array.from(bucketMap.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));
}

export async function getTopActions(from?: string, to?: string, profile?: "dev" | "prod", limit = 10) {
  const events = await getEventsInRange(from, to, profile);
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.eventName !== "admin_action") continue;
    const action =
      event.actionName ??
      (typeof event.metadata?.["action_name"] === "string" ? (event.metadata["action_name"] as string) : "unknown");
    counts.set(action, (counts.get(action) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export async function getTopApis(from?: string, to?: string, profile?: "dev" | "prod", limit = 10) {
  const events = await getEventsInRange(from, to, profile);
  const stats = new Map<string, { route: string; count: number; errorCount: number; durationTotal: number }>();

  for (const event of events) {
    if (event.eventName !== "api_request") continue;
    const route =
      event.route ??
      (typeof event.metadata?.["route"] === "string" ? (event.metadata["route"] as string) : "unknown");
    const current = stats.get(route) ?? { route, count: 0, errorCount: 0, durationTotal: 0 };
    current.count += 1;
    if ((event.statusCode ?? 0) >= 400 || event.statusCode === 0) current.errorCount += 1;
    if (typeof event.durationMs === "number") current.durationTotal += event.durationMs;
    stats.set(route, current);
  }

  return Array.from(stats.values())
    .map((item) => ({
      route: item.route,
      count: item.count,
      errorCount: item.errorCount,
      avgDurationMs: item.count === 0 ? 0 : item.durationTotal / item.count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
