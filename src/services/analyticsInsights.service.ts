import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { getFirebaseApp } from "../utils/getFirebaseApp.ts";

type Range = { from: Date; to: Date };

function parseDateStart(value?: string) {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00.000`);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseDateEnd(value?: string) {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T23:59:59.999`);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function resolveRange(from?: string, to?: string): Range {
  const toDate = parseDateEnd(to) ?? new Date();
  const fromDate = parseDateStart(from) ?? new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from: fromDate, to: toDate };
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === "object" && value && "toDate" in value) {
    const toDateFn = (value as { toDate?: () => Date }).toDate;
    if (typeof toDateFn === "function") return toDateFn();
  }
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function bucketByDay(input: Date) {
  return `${input.getUTCFullYear()}-${String(input.getUTCMonth() + 1).padStart(2, "0")}-${String(
    input.getUTCDate()
  ).padStart(2, "0")}`;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1)));
  return sorted[idx] ?? 0;
}

async function readObservabilityEvents(from: Date, to: Date) {
  const db = getFirestore(getFirebaseApp());
  const snapshot = await db
    .collection("backend_observability_events")
    .where("eventTimestamp", ">=", Timestamp.fromDate(from))
    .where("eventTimestamp", "<=", Timestamp.fromDate(to))
    .get();
  return snapshot.docs.map((doc) => doc.data() as Record<string, unknown>);
}

export async function getUserAnalytics(from?: string, to?: string) {
  const db = getFirestore(getFirebaseApp());
  const range = resolveRange(from, to);
  const usersSnapshot = await db.collection("users").get();
  const users = usersSnapshot.docs.map((doc) => doc.data() as Record<string, unknown>);
  const totalUsers = users.length;

  const signups = users
    .map((user) => toDate(user.createdAt))
    .filter((date): date is Date => Boolean(date))
    .filter((date) => date >= range.from && date <= range.to);

  const byDay = new Map<string, number>();
  for (const signupDate of signups) {
    const key = bucketByDay(signupDate);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }

  const events = await readObservabilityEvents(range.from, range.to);
  const uniqueInRange = new Set(
    events
      .map((event) => (typeof event.userId === "string" ? event.userId : null))
      .filter((value): value is string => Boolean(value))
  );

  const now = range.to;
  const dauStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const wauStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const mauStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const activeDau = new Set<string>();
  const activeWau = new Set<string>();
  const activeMau = new Set<string>();
  for (const event of events) {
    const userId = typeof event.userId === "string" ? event.userId : null;
    if (!userId) continue;
    const eventDate = toDate(event.timestamp);
    if (!eventDate) continue;
    if (eventDate >= dauStart) activeDau.add(userId);
    if (eventDate >= wauStart) activeWau.add(userId);
    if (eventDate >= mauStart) activeMau.add(userId);
  }

  const segmentationByPlan = new Map<string, number>();
  for (const user of users) {
    const tier = typeof user.tierId === "string" ? user.tierId : "unknown";
    segmentationByPlan.set(tier, (segmentationByPlan.get(tier) ?? 0) + 1);
  }

  return {
    totalUsers,
    newSignups: {
      inRange: signups.length,
      daily: signups.filter((date) => date >= dauStart).length,
      weekly: signups.filter((date) => date >= wauStart).length,
      monthly: signups.filter((date) => date >= mauStart).length,
    },
    activeUsers: {
      dau: activeDau.size,
      wau: activeWau.size,
      mau: activeMau.size,
      uniqueInRange: uniqueInRange.size,
    },
    growthTrend: Array.from(byDay.entries())
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    retention: null,
    segmentation: {
      plan: Array.from(segmentationByPlan.entries()).map(([key, count]) => ({ key, count })),
    },
  };
}

async function getFeatureObservabilityMetrics(
  featureKey: "proposal_generation" | "optimization_prompt" | "resume_assistance",
  from?: string,
  to?: string
) {
  const range = resolveRange(from, to);
  const events = await readObservabilityEvents(range.from, range.to);
  const selected = events.filter((event) => event.feature === featureKey);

  let successCount = 0;
  let failureCount = 0;
  const durations: number[] = [];
  const users = new Map<string, number>();
  const trend = new Map<string, { total: number; success: number; failure: number }>();

  for (const event of selected) {
    const success = event.success === true;
    if (success) successCount += 1;
    else failureCount += 1;

    const duration = typeof event.durationMs === "number" ? event.durationMs : null;
    if (duration !== null) durations.push(duration);

    const userId = typeof event.userId === "string" ? event.userId : null;
    if (userId) users.set(userId, (users.get(userId) ?? 0) + 1);

    const date = toDate(event.timestamp);
    if (!date) continue;
    const key = bucketByDay(date);
    const bucket = trend.get(key) ?? { total: 0, success: 0, failure: 0 };
    bucket.total += 1;
    if (success) bucket.success += 1;
    else bucket.failure += 1;
    trend.set(key, bucket);
  }

  return {
    totalRequests: selected.length,
    successCount,
    failureCount,
    successRate: selected.length === 0 ? 0 : successCount / selected.length,
    failureRate: selected.length === 0 ? 0 : failureCount / selected.length,
    avgLatencyMs: durations.length === 0 ? 0 : durations.reduce((a, b) => a + b, 0) / durations.length,
    p95LatencyMs: percentile(durations, 95),
    p99LatencyMs: percentile(durations, 99),
    requestsPerUser: Array.from(users.entries()).map(([userId, count]) => ({ userId, count })),
    trend: Array.from(trend.entries())
      .map(([day, value]) => ({ day, ...value }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  };
}

async function countCollectionInRange(collectionName: string, from?: string, to?: string) {
  const db = getFirestore(getFirebaseApp());
  const range = resolveRange(from, to);
  const snapshot = await db
    .collection(collectionName)
    .where("createdAt", ">=", Timestamp.fromDate(range.from))
    .where("createdAt", "<=", Timestamp.fromDate(range.to))
    .get();
  return snapshot.size;
}

export async function getProposalsAnalytics(from?: string, to?: string) {
  const totalGenerated = await countCollectionInRange("proposal_history", from, to);
  const runtime = await getFeatureObservabilityMetrics("proposal_generation", from, to);
  return { totalGenerated, ...runtime };
}

export async function getOptimizationAnalytics(from?: string, to?: string) {
  const totalOptimizations = await countCollectionInRange("optimizer_history", from, to);
  const runtime = await getFeatureObservabilityMetrics("optimization_prompt", from, to);
  return { totalOptimizations, ...runtime };
}

export async function getResumesAnalytics(from?: string, to?: string) {
  const totalResumes = await countCollectionInRange("resumes", from, to);
  const runtime = await getFeatureObservabilityMetrics("resume_assistance", from, to);
  return { totalResumes, ...runtime };
}

export async function getAnalyticsOverview(from?: string, to?: string) {
  const [users, proposals, optimization, resumes] = await Promise.all([
    getUserAnalytics(from, to),
    getProposalsAnalytics(from, to),
    getOptimizationAnalytics(from, to),
    getResumesAnalytics(from, to),
  ]);

  return {
    users: {
      totalUsers: users.totalUsers,
      activeDau: users.activeUsers.dau,
      activeWau: users.activeUsers.wau,
      activeMau: users.activeUsers.mau,
      newSignupsInRange: users.newSignups.inRange,
    },
    features: {
      proposalsTotal: proposals.totalGenerated,
      optimizationsTotal: optimization.totalOptimizations,
      resumesTotal: resumes.totalResumes,
      totalFeatureRequests:
        proposals.totalRequests + optimization.totalRequests + resumes.totalRequests,
    },
  };
}

