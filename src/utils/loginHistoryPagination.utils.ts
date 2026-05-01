import { FieldPath, Timestamp } from "firebase-admin/firestore";
import type { CollectionReference } from "firebase-admin/firestore";

/** Opaque pagination token (avoid an extra `.doc(cursor).get()` read per page). */
export function encodeLoginHistoryCursor(
  timestampMillis: number,
  docId: string,
): string {
  return Buffer.from(
    JSON.stringify({ t: timestampMillis, i: docId }),
    "utf8",
  ).toString("base64url");
}

export function decodeLoginHistoryCursor(
  raw: string,
): { millis: number; docId: string } | null {
  try {
    const json = Buffer.from(raw.trim(), "base64url").toString("utf8");
    const o = JSON.parse(json) as { t?: unknown; i?: unknown };
    if (typeof o.t !== "number" || !Number.isFinite(o.t)) return null;
    if (typeof o.i !== "string" || !o.i.trim()) return null;
    return { millis: o.t, docId: o.i.trim() };
  } catch {
    return null;
  }
}

export function timestampMillisFromFirestoreField(
  val: unknown,
): number | null {
  if (
    val &&
    typeof (val as { toMillis?: () => number }).toMillis === "function"
  ) {
    return (val as { toMillis: () => number }).toMillis();
  }
  if (val instanceof Date) return val.getTime();
  if (
    val &&
    typeof val === "object" &&
    "seconds" in (val as Record<string, unknown>)
  ) {
    const s = Number((val as { seconds?: unknown }).seconds);
    if (Number.isFinite(s)) return s * 1000;
  }
  return null;
}

export function loginHistoryBaseQuery(loginCol: CollectionReference): FirebaseFirestore.Query {
  return loginCol
    .orderBy("timestamp", "desc")
    .orderBy(FieldPath.documentId(), "desc");
}

export function startLoginHistoryAfterCompound(
  base: FirebaseFirestore.Query,
  millis: number,
  docId: string,
): FirebaseFirestore.Query {
  const ts = Timestamp.fromMillis(Math.floor(millis));
  return base.startAfter(ts, docId);
}
