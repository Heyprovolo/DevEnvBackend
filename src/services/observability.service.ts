import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { getFirebaseApp } from "../utils/getFirebaseApp.ts";
import type { RequestObservabilityEvent } from "../types/observability.ts";

const COLLECTION = "backend_observability_events";
const ERROR_RATE_ALERT_THRESHOLD = Number(process.env.OBS_ERROR_RATE_ALERT_THRESHOLD ?? 0.05);
const P95_LATENCY_ALERT_MS = Number(process.env.OBS_P95_LATENCY_ALERT_MS ?? 4000);

function stripUndefined<T extends Record<string, unknown>>(obj: T) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined)
  ) as T;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1)));
  return sorted[idx] ?? 0;
}

export async function persistObservabilityEvent(event: RequestObservabilityEvent): Promise<void> {
  const app = getFirebaseApp();
  const db = getFirestore(app);
  const payload = stripUndefined({
    ...event,
    eventTimestamp: Timestamp.fromDate(new Date(event.timestamp)),
    createdAt: Timestamp.now(),
  });
  await db.collection(COLLECTION).add(payload);
}

type StoredEvent = RequestObservabilityEvent & { eventTimestamp: Timestamp };

function parseRangeStart(value?: string): Date | undefined {
  if (!value) return undefined;
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (isDateOnly) {
    const date = new Date(`${value}T00:00:00.000`);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseRangeEnd(value?: string): Date | undefined {
  if (!value) return undefined;
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (isDateOnly) {
    const date = new Date(`${value}T23:59:59.999`);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

async function readEvents(from?: string, to?: string) {
  const app = getFirebaseApp();
  const db = getFirestore(app);
  const toDate = parseRangeEnd(to) ?? new Date();
  const fromDate =
    parseRangeStart(from) ?? new Date(toDate.getTime() - 24 * 60 * 60 * 1000);
  const snapshot = await db
    .collection(COLLECTION)
    .where("eventTimestamp", ">=", Timestamp.fromDate(fromDate))
    .where("eventTimestamp", "<=", Timestamp.fromDate(toDate))
    .get();
  return snapshot.docs.map((doc) => doc.data() as StoredEvent);
}

export async function getBackendDashboardMetrics(from?: string, to?: string) {
  const events = await readEvents(from, to);
  const byEndpoint = new Map<
    string,
    {
      endpoint: string;
      route: string;
      feature: string;
      total: number;
      success: number;
      failure: number;
      durations: number[];
      dbDurations: number[];
      externalDurations: number[];
      users: Set<string>;
      errorCount: number;
    }
  >();

  const minuteBuckets = new Map<string, number>();
  let totalErrors = 0;

  for (const event of events) {
    const key = event.endpoint;
    const current = byEndpoint.get(key) ?? {
      endpoint: event.endpoint,
      route: event.route,
      feature: event.feature,
      total: 0,
      success: 0,
      failure: 0,
      durations: [],
      dbDurations: [],
      externalDurations: [],
      users: new Set<string>(),
      errorCount: 0,
    };
    current.total += 1;
    if (event.success) current.success += 1;
    else current.failure += 1;
    current.durations.push(event.durationMs);
    current.dbDurations.push(event.dbLatencyMs);
    current.externalDurations.push(event.externalLatencyMs);
    if (event.userId) current.users.add(event.userId);
    if (event.error) {
      current.errorCount += 1;
      totalErrors += 1;
    }
    byEndpoint.set(key, current);

    const bucket = event.timestamp.slice(0, 16);
    minuteBuckets.set(bucket, (minuteBuckets.get(bucket) ?? 0) + 1);
  }

  const endpointMetrics = Array.from(byEndpoint.values()).map((item) => {
    const errorRate = item.total === 0 ? 0 : item.failure / item.total;
    const reliabilityScore = Math.max(0, 100 - errorRate * 70 - percentile(item.durations, 95) / 200);
    return {
      endpoint: item.endpoint,
      route: item.route,
      feature: item.feature,
      usageCount: item.total,
      uniqueUsers: item.users.size,
      successRate: item.total === 0 ? 0 : item.success / item.total,
      failureRate: item.total === 0 ? 0 : item.failure / item.total,
      errorRate,
      avgMs: item.total === 0 ? 0 : item.durations.reduce((a, b) => a + b, 0) / item.total,
      p95Ms: percentile(item.durations, 95),
      p99Ms: percentile(item.durations, 99),
      latencyBreakdown: {
        dbAvgMs: item.total === 0 ? 0 : item.dbDurations.reduce((a, b) => a + b, 0) / item.total,
        externalAvgMs:
          item.total === 0 ? 0 : item.externalDurations.reduce((a, b) => a + b, 0) / item.total,
        processingAvgMs:
          item.total === 0
            ? 0
            : item.durations.reduce((a, b) => a + b, 0) / item.total -
              (item.dbDurations.reduce((a, b) => a + b, 0) / item.total +
                item.externalDurations.reduce((a, b) => a + b, 0) / item.total),
      },
      reliabilityScore: Number(reliabilityScore.toFixed(2)),
    };
  });

  const rpmSeries = Array.from(minuteBuckets.entries())
    .map(([minute, count]) => ({ minute, rpm: count }))
    .sort((a, b) => a.minute.localeCompare(b.minute));

  return {
    totalRequests: events.length,
    totalErrors,
    globalErrorRate: events.length === 0 ? 0 : totalErrors / events.length,
    endpointMetrics,
    rpmSeries,
  };
}

export async function getBackendAlerts(from?: string, to?: string) {
  const metrics = await getBackendDashboardMetrics(from, to);
  const alerts: Array<{ level: "warn" | "critical"; endpoint: string; reason: string; value: number }> = [];
  for (const item of metrics.endpointMetrics) {
    if (item.errorRate > ERROR_RATE_ALERT_THRESHOLD) {
      alerts.push({
        level: item.errorRate > ERROR_RATE_ALERT_THRESHOLD * 2 ? "critical" : "warn",
        endpoint: item.endpoint,
        reason: "error_rate_threshold_exceeded",
        value: Number((item.errorRate * 100).toFixed(2)),
      });
    }
    if (item.p95Ms > P95_LATENCY_ALERT_MS) {
      alerts.push({
        level: item.p95Ms > P95_LATENCY_ALERT_MS * 1.75 ? "critical" : "warn",
        endpoint: item.endpoint,
        reason: "latency_p95_threshold_exceeded",
        value: Number(item.p95Ms.toFixed(2)),
      });
    }
  }

  // Simple spike detection on RPM (last minute > 2x average)
  if (metrics.rpmSeries.length > 5) {
    const last = metrics.rpmSeries[metrics.rpmSeries.length - 1]?.rpm ?? 0;
    const baselineValues = metrics.rpmSeries.slice(0, -1).map((point) => point.rpm);
    const avgBaseline =
      baselineValues.length === 0 ? 0 : baselineValues.reduce((a, b) => a + b, 0) / baselineValues.length;
    if (avgBaseline > 0 && last > avgBaseline * 2) {
      alerts.push({
        level: "warn",
        endpoint: "global",
        reason: "traffic_spike_detected",
        value: Number(last.toFixed(2)),
      });
    }
  }

  return { alerts, alertCount: alerts.length };
}

