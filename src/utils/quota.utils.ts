import { getFirestore } from "firebase-admin/firestore";
import { getFirebaseApp, closeFirebaseApp } from "./getFirebaseApp.ts";
import type { QuotaFeature, QuotaHistory } from "../types/quotas.ts";
import type { Tier, FeatureSlug } from "../types/tiers.ts";

// Reset usage count if a new interval has started
export function resetIfNewInterval(feature: QuotaFeature, now: Date): number {
  if (!feature.lastUsed) return feature.usageCount;
  // Firestore Timestamp or Date
  let last: Date;
  if (feature.lastUsed instanceof Date) {
    last = feature.lastUsed;
  } else if (
    typeof feature.lastUsed === "object" &&
    typeof (feature.lastUsed as any).toDate === "function"
  ) {
    last = (feature.lastUsed as any).toDate();
  } else {
    last = new Date(feature.lastUsed);
  }
  switch (feature.recurringInterval) {
    case "daily":
      if (
        last.getUTCFullYear() !== now.getUTCFullYear() ||
        last.getUTCMonth() !== now.getUTCMonth() ||
        last.getUTCDate() !== now.getUTCDate()
      ) {
        return 0;
      }
      break;
    case "weekly": {
      const getWeek = (d: Date) => {
        const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        const dayNum = date.getUTCDay() || 7;
        date.setUTCDate(date.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
        return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
      };
      if (last.getUTCFullYear() !== now.getUTCFullYear() || getWeek(last) !== getWeek(now)) {
        return 0;
      }
      break;
    }
    case "monthly":
      if (
        last.getUTCFullYear() !== now.getUTCFullYear() ||
        last.getUTCMonth() !== now.getUTCMonth()
      ) {
        return 0;
      }
      break;
    case "yearly":
      if (last.getUTCFullYear() !== now.getUTCFullYear()) {
        return 0;
      }
      break;
  }
  return feature.usageCount;
}

// Check if user has quota for a feature
export async function checkUserQuota(userId: string, slug: FeatureSlug) {
  const app = getFirebaseApp();
  const db = getFirestore(app);
  try {
    let quotaDoc = await db.collection("quota_history").doc(userId).get();
    
    // If quota history doesn't exist, create it first
    if (!quotaDoc.exists) {
      // Get user's tier and create quota history
      const userQuery = db.collection("users").where("userId", "==", userId).limit(1);
      const userSnap = await userQuery.get();
      if (userSnap.empty) throw new Error(`User not found: ${userId}`);
      
      const userDoc = userSnap.docs[0];
      if (!userDoc) throw new Error(`User document not found: ${userId}`);
      
      const user = userDoc.data();
      const tierId = user.tierId || process.env.DEFAULT_TIER_ID || "starter";
      await createQuotaHistoryFromTier(userId, tierId);
      
      // Fetch the newly created quota document
      quotaDoc = await db.collection("quota_history").doc(userId).get();
    }
    const quotaHistory = quotaDoc.data() as QuotaHistory;
    const feature = quotaHistory.features.find((f: QuotaFeature) => f.slug === slug);
    if (!feature) {
      throw new Error(`Feature ${slug} not found in quota history for user ${userId}`);
    }
    const now = new Date();
    const currentCount = resetIfNewInterval(feature, now);

    // If unlimited (maxQuota is -1), always allow
    if (feature.maxQuota === -1) {
      return {
        allowed: true,
        count: currentCount,
        limit: -1,
      };
    }

    return {
      allowed: currentCount < feature.maxQuota,
      count: currentCount,
      limit: feature.maxQuota,
    };
  } finally {
    closeFirebaseApp();
  }
}

// Create quota history for a user from their tier
export async function createQuotaHistoryFromTier(
  userId: string,
  tierId: string,
  closeApp: boolean = true
) {
  const app = getFirebaseApp();
  const db = getFirestore(app);
  try {
    // Get tier doc
    const tierSnap = await db.collection("tiers").doc(tierId).get();
    if (!tierSnap.exists) throw new Error(`Tier not found: ${tierId}`);
    const tier = tierSnap.data() as Tier;
    
    // Build features
    const features = (tier.features || []).map((f: any) => ({
      ...f,
      usageCount: 0,
      lastUsed: null,
    }));
    
    const now = new Date();
    const quotaHistory: QuotaHistory = {
      userId,
      tierId,
      lastSubscriptionDate: now,
      features,
      createdAt: now,
      updatedAt: now,
    };
    
    await db.collection("quota_history").doc(userId).set(quotaHistory);
    
    return quotaHistory;
  } finally {
    if (closeApp) {
      closeFirebaseApp();
    }
  }
}

// Increment quota usage for a feature
export async function updateUserQuota(userId: string, slug: FeatureSlug) {
  const app = getFirebaseApp();
  const db = getFirestore(app);
  try {
    const quotaDoc = await db.collection("quota_history").doc(userId).get();
    if (!quotaDoc.exists) throw new Error(`No quota history for user ${userId}`);
    const quotaHistory = quotaDoc.data() as QuotaHistory;
    const now = new Date();
    const features = quotaHistory.features.map((f: QuotaFeature) => {
      if (f.slug === slug) {
        const resetCount = resetIfNewInterval(f, now);
        return {
          ...f,
          usageCount: resetCount + 1,
          lastUsed: now,
        };
      }
      return f;
    });
    await db.collection("quota_history").doc(userId).set(
      {
        features,
        updatedAt: now,
      },
      { merge: true }
    );
    return true;
  } finally {
    closeFirebaseApp();
  }
}

// Check and update quota in one call
export async function checkAndUpdateQuota(userId: string, slug: FeatureSlug) {
  const result = await checkUserQuota(userId, slug);
  if (!result.allowed) return result;
  await updateUserQuota(userId, slug);
  return { ...result, count: result.count + 1 };
}

// Update quota history for canceled subscription
export async function updateQuotaHistoryForCanceledSubscription(data: Record<string, any>) {
  const app = getFirebaseApp();
  const db = getFirestore(app);
  let userId = data.external_id;
  const now = new Date();

  // Fallback: if no external_id, search for customer_id in users table (polarId)
  if (!userId && data.customer_id) {
    const userQuery = db.collection("users").where("polarId", "==", data.customer_id).limit(1);
    const userSnap = await userQuery.get();
    if (!userSnap.empty && userSnap.docs[0]) {
      const userDoc = userSnap.docs[0];
      const userData = userDoc.data();
      if (userData && userData.userId) {
        userId = userData.userId;
      }
    }
  }

  if (!userId) {
    console.log(
      "No userId found for canceled subscription (missing external_id and polarId match)"
    );
    return;
  }

  // Update quota_history for the user to reflect cancellation
  const quotaDocRef = db.collection("quota_history").doc(userId);
  const quotaDoc = await quotaDocRef.get();
  if (!quotaDoc.exists) {
    console.log(`No quota history found for canceled subscription user ${userId}`);
    return;
  }
  // Mark quota as canceled and set end date
  await quotaDocRef.set(
    {
      canceled: true,
      canceled_at: data.canceled_at || now.toISOString(),
      subscription_period_end: data.current_period_end,
      updatedAt: now,
    },
    { merge: true }
  );
  console.log(`Updated quota_history for canceled subscription user ${userId}`);
}

// Undo quota cancellation for uncanceled subscription
export async function updateQuotaHistoryForUncanceledSubscription(data: Record<string, any>) {
  const app = getFirebaseApp();
  const db = getFirestore(app);
  let userId = data.external_id;
  // Fallback: if no external_id, search for customer_id in users table (polarId)
  if (!userId && data.customer_id) {
    const userQuery = db.collection("users").where("polarId", "==", data.customer_id).limit(1);
    const userSnap = await userQuery.get();
    if (!userSnap.empty && userSnap.docs[0]) {
      const userDoc = userSnap.docs[0];
      const userData = userDoc.data();
      if (userData && userData.userId) {
        userId = userData.userId;
      }
    }
  }
  if (!userId) {
    console.log(
      "No userId found for uncanceled subscription (missing external_id and polarId match)"
    );
    return;
  }
  // Update quota_history for the user to undo cancellation
  const quotaDocRef = db.collection("quota_history").doc(userId);
  const quotaDoc = await quotaDocRef.get();
  if (!quotaDoc.exists) {
    console.log(`No quota history found to uncancel for user ${userId}`);
    return;
  }
  await quotaDocRef.set(
    {
      canceled: false,
      canceled_at: null,
      subscription_period_end: null,
      updatedAt: new Date(),
    },
    { merge: true }
  );
  console.log(`Uncanceled quota_history for user ${userId}`);
}

// Archive quota and downgrade user for revoked subscription
export async function updateQuotaHistoryForRevokedSubscription(
  data: Record<string, any>,
  DEFAULT_TIER_ID: string
) {
  const app = getFirebaseApp();
  const db = getFirestore(app);
  let userId = data.external_id;
  // Fallback: if no external_id, search for customer_id in users table (polarId)
  if (!userId && data.customer_id) {
    const userQuery = db.collection("users").where("polarId", "==", data.customer_id).limit(1);
    const userSnap = await userQuery.get();
    if (!userSnap.empty && userSnap.docs[0]) {
      const userDoc = userSnap.docs[0];
      const userData = userDoc.data();
      if (userData && userData.userId) {
        userId = userData.userId;
      }
    }
  }
  if (!userId) {
    console.log("No userId found for revoked subscription (missing external_id and polarId match)");
    return;
  }
  // Archive current quota history
  const quotaDoc = await db.collection("quota_history").doc(userId).get();
  if (quotaDoc.exists) {
    // Archive quota
    const currentQuota = quotaDoc.data();
    const archiveDocRef = db.collection("quota_archive").doc(userId);
    const archiveDoc = await archiveDocRef.get();
    let archiveData;
    const now = new Date().toISOString();
    if (!archiveDoc.exists) {
      archiveData = {
        userId,
        prev_quotas: [
          {
            archived_at: now,
            ...currentQuota,
          },
        ],
        createdAt: now,
        updatedAt: now,
      };
    } else {
      const existingArchive = archiveDoc.data();
      if (existingArchive) {
        archiveData = existingArchive;
        const prevQuotas = archiveData.prev_quotas || [];
        prevQuotas.push({ archived_at: now, ...currentQuota });
        archiveData.prev_quotas = prevQuotas;
        archiveData.updatedAt = now;
      } else {
        // If somehow archiveDoc.data() is undefined, create new archiveData
        archiveData = {
          userId,
          prev_quotas: [
            {
              archived_at: now,
              ...currentQuota,
            },
          ],
          createdAt: now,
          updatedAt: now,
        };
      }
    }
    await archiveDocRef.set(archiveData);
    await db.collection("quota_history").doc(userId).delete();
    console.log(`Archived quota for user ${userId}`);
  }
  
  // Downgrade user to starter tier
  const usersRef = db.collection("users");
  const userQuery = usersRef.where("userId", "==", userId).limit(1);
  const userDocs = await userQuery.get();
  
  if (!userDocs.empty && userDocs.docs[0]) {
    await userDocs.docs[0].ref.update({
      tierId: DEFAULT_TIER_ID,
      updatedAt: new Date(),
    });
  } else {
    console.error(`User with userId ${userId} not found for tier downgrade`);
  }
  // Create new quota history for starter tier
  await createQuotaHistoryFromTier(userId, DEFAULT_TIER_ID);
  console.log(`User ${userId} downgraded and quota archived due to subscription.revoked`);
}
