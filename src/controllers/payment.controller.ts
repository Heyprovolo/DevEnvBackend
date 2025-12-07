import type { Request, Response } from "express";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type {
  DocumentSnapshot,
  DocumentReference,
} from "firebase-admin/firestore";
import { getFirebaseApp } from "../utils/getFirebaseApp.ts";
import { newErrorResponse, newSuccessResponse } from "../utils/apiResponse.ts";
import {
  createQuotaHistoryFromTier,
  updateQuotaHistoryForCanceledSubscription,
  updateQuotaHistoryForRevokedSubscription,
  updateQuotaHistoryForUncanceledSubscription,
} from "../utils/quota.utils.ts";
import type { Tier } from "../types/tiers.ts";
import type { QuotaHistory } from "../types/quotas.ts";
import { sendPremiumWelcomeEmail } from "../services/mail.service.ts";
import { sendNotificationToUser } from "../services/notification.service.ts";
import { NotificationCategory } from "../types/notification.ts";

// Default tier ID
const DEFAULT_TIER_ID = process.env.DEFAULT_TIER_ID || "starter";

export async function getPaymentTiers(req: Request, res: Response) {
  try {
    const app = getFirebaseApp();
    const db = getFirestore(app);

    const tiersSnapshot = await db.collection("tiers").get();

    const tiers: Tier[] = [];
    tiersSnapshot.forEach((doc) => {
      const data = doc.data() as Tier;
      tiers.push(data);
    });

    // Sort tiers by price (ascending)
    tiers.sort((a, b) => a.price - b.price);

    res
      .status(200)
      .json(
        newSuccessResponse(
          "Payment Tiers",
          "Payment tiers retrieved successfully",
          tiers
        )
      );
  } catch (err: any) {
    console.error("[getPaymentTiers] Failed to retrieve payment tiers:", err);
    res
      .status(500)
      .json(
        newErrorResponse(
          "Service Error",
          "Unable to retrieve pricing information. Please contact support if this continues."
        )
      );
  }
}

export async function getPaymentTierBySlug(req: Request, res: Response) {
  try {
    const slug = req.params.slug;

    if (!slug) {
      return res
        .status(400)
        .json(newErrorResponse("Invalid Request", "Tier slug is required"));
    }

    const app = getFirebaseApp();
    const db = getFirestore(app);

    // Query tier by slug
    const tierSnapshot = await db
      .collection("tiers")
      .where("slug", "==", slug)
      .limit(1)
      .get();

    if (tierSnapshot.empty || !tierSnapshot.docs[0]) {
      return res
        .status(404)
        .json(
          newErrorResponse("Tier Not Found", `No tier found with slug: ${slug}`)
        );
    }

    const tier = tierSnapshot.docs[0]!.data() as Tier;

    res
      .status(200)
      .json(
        newSuccessResponse(
          "Payment Tier",
          "Payment tier retrieved successfully",
          tier
        )
      );
  } catch (err: any) {
    console.error(
      `[getPaymentTierBySlug] Failed to retrieve payment tier (${req.params.slug}):`,
      err
    );
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Service Error",
          "Unable to retrieve pricing information. Please contact support if this continues."
        )
      );
  }
}

export async function paymentWebhook(req: Request, res: Response) {
  try {
    // Handle completely dynamic JSON data - accepts any structure
    const webhookData: Record<string, any> = req.body;

    // // Log webhookData as JSON
    // try {
    //   const webhookJSON = JSON.stringify(webhookData, null, 2);
    //   console.log("Payment Webhook received:", webhookJSON);
    // } catch (err) {
    //   console.log("Payment Webhook received (stringify error):", webhookData);
    // }

    // Extract event type and data
    const eventType = webhookData.type as string;
    const data = webhookData.data as Record<string, any>;
    const checkoutID = data.checkout_id as string;
    const status = data.status as string;
    let createdAt = data.created_at as string;
    let updatedAt = (data.modified_at as string) || (data.updated_at as string);

    // Only persist subscription.created, subscription.updated, order.created, order.updated, and handle subscription.canceled
    if (
      [
        "subscription.created",
        "subscription.updated",
        "order.created",
        "order.updated",
        "subscription.canceled",
        "subscription.uncanceled",
        "subscription.revoked",
      ].includes(eventType)
    ) {
      const app = getFirebaseApp();
      const db = getFirestore(app);

      // Upsert logic: store all events as keys in a single 'events' map
      const docRef = db.collection("billing_history").doc(checkoutID);

      // Read existing document to preserve previous events
      const docSnap = await docRef.get();
      let events: Record<string, any> = {};
      if (docSnap.exists) {
        const existing = docSnap.data()?.events;
        if (existing && typeof existing === "object") {
          events = existing;
        }
      }
      events[eventType] = data;

      // Ensure updated_at is always set (never undefined)
      await docRef.set(
        {
          checkout_id: checkoutID,
          current_status: status,
          created_at: createdAt || new Date().toISOString(),
          updated_at: updatedAt || new Date().toISOString(),
          events: events,
        },
        { merge: true }
      );

      // Handle order.updated event for subscription management
      if (eventType === "order.updated") {
        try {
          await handleOrderUpdated(data);
        } catch (err) {
          console.error("Failed to process order.updated event:", err);
        }
      } else if (eventType === "subscription.canceled") {
        await updateQuotaHistoryForCanceledSubscription(data);
      } else if (eventType === "subscription.uncanceled") {
        await updateQuotaHistoryForUncanceledSubscription(data);
      } else if (eventType === "subscription.revoked") {
        await updateQuotaHistoryForRevokedSubscription(data, DEFAULT_TIER_ID);
      } else {
        // Log all other events but do not persist
        console.log(`Webhook event ${eventType} received and logged only.`);
      }

      // Return success using the standard APIResponse pattern
      res
        .status(200)
        .json(
          newSuccessResponse(
            "Payment Webhook",
            "Webhook received and processed successfully - any data structure accepted",
            webhookData
          )
        );
    }
  } catch (err: any) {
    console.error("[paymentWebhook] Invalid JSON payload received:", err);
    res
      .status(400)
      .json(
        newErrorResponse(
          "Invalid Request",
          "Invalid payment webhook data format."
        )
      );
  }
}

// Endpoint for cron job to archive expired subscriptions and quota histories
export async function archiveExpiredSubscriptions(req: Request, res: Response) {
  const app = getFirebaseApp();
  const db = getFirestore(app);
  const now = new Date();

  // Find quota histories pending archive and expired
  const expiredQuotas = await db
    .collection("quota_history")
    .where("canceled", "==", true)
    .where("subscription_period_end", "<", now.toISOString())
    .get();

  let archivedCount = 0;

  for (const doc of expiredQuotas.docs) {
    const quota = doc.data();
    const userId = quota.userId;

    // Archive quota history
    await db.collection("quota_archive").doc(userId).set(quota);
    await db.collection("quota_history").doc(userId).delete();

    // Downgrade user to starter tier and clear pending_archive
    const userQuerySnap = await db
      .collection("users")
      .where("userId", "==", userId)
      .limit(1)
      .get();
    if (!userQuerySnap.empty && userQuerySnap.docs[0]) {
      const userDocRef = userQuerySnap.docs[0].ref;
      await userDocRef.update({
        tierId: DEFAULT_TIER_ID,
        updatedAt: new Date(),
      });
    } else {
      console.warn(`User with userId ${userId} not found for tier downgrade.`);
    }

    // Create new quota history for starter tier
    await createQuotaHistoryFromTier(userId, DEFAULT_TIER_ID, true);

    archivedCount++;
    console.log(`Archived quota for user ${userId}`);
  }

  res.status(200).json({ archivedCount });
}

// Helper function to handle order.updated events
async function handleOrderUpdated(data: Record<string, any>) {
  // Extract user identification
  let userID = "";
  let customerEmail = "";

  // Try to get user_id from metadata
  const metadata = data.metadata as Record<string, any>;
  if (metadata && metadata.user_id) {
    userID = metadata.user_id as string;
  }

  // If no user_id in metadata, try customer email
  if (!userID) {
    const customer = data.customer as Record<string, any>;
    if (customer && customer.email) {
      customerEmail = customer.email as string;
    }
  }

  // Skip if we have neither user_id nor customer email
  if (!userID && !customerEmail) {
    throw new Error(
      "no user identification found: missing both metadata.user_id and customer.email"
    );
  }

  // Extract product_id and status
  const productID = data.product_id as string;
  const status = data.status as string;

  if (!productID) {
    throw new Error("missing product_id in order data");
  }

  // Define accepted "paid" statuses
  const paidStatuses: Record<string, boolean> = {
    pending: true,
    paid: true,
    active: true,
    completed: true,
    refunded: false,
    partially_refunded: false,
    canceled: false,
  };

  const isPaidStatus = paidStatuses[status];
  if (isPaidStatus === undefined) {
    throw new Error(`unknown order status: ${status}`);
  }

  const app = getFirebaseApp();
  const db = getFirestore(app);

  // Check for double processing - look for existing order with same product_id and status
  const checkoutID = data.checkout_id as string;
  if (checkoutID) {
    const billingDoc = await db
      .collection("billing_history")
      .doc(checkoutID)
      .get();
    if (billingDoc.exists) {
      const events = billingDoc.data()?.events as Record<string, any>;
      if (events && events["order.updated"]) {
        const existingStatus = events["order.updated"].status as string;
        if (existingStatus === status) {
          // TODO: Already processed
          //   return;
        }
      }
    }
  }

  // Find tier by product_id (polarRefId)
  const tierQuery = db
    .collection("tiers")
    .where("polarRefId", "==", productID)
    .limit(1);
  const tierDocs = await tierQuery.get();
  if (tierDocs.empty) {
    throw new Error(`no tier found with polarRefId: ${productID}`);
  }

  const tierDoc = tierDocs.docs[0]!;
  const tier = tierDoc.data() as Tier;

  // Find user by userID or email
  let userDoc: DocumentSnapshot | null = null;
  let userDocRef: DocumentReference | null = null;

  if (userID) {
    // Query by userId field
    const userQuery = db
      .collection("users")
      .where("userId", "==", userID)
      .limit(1);
    const userDocs = await userQuery.get();
    if (!userDocs.empty) {
      userDoc = userDocs.docs[0]!;
      userDocRef = userDocs.docs[0]!.ref;
    }
  }

  if (!userDoc && customerEmail) {
    // Query by email field
    const userQuery = db
      .collection("users")
      .where("email", "==", customerEmail)
      .limit(1);
    const userDocs = await userQuery.get();
    if (!userDocs.empty) {
      userDoc = userDocs.docs[0]!;
      userDocRef = userDocs.docs[0]!.ref;
      // Update userID for subsequent operations
      const userData = userDoc!.data();
      if (userData && userData.userId) {
        userID = userData.userId as string;
      }
    }
  }

  if (!userDoc) {
    throw new Error(
      `user not found with userID: ${userID} or email: ${customerEmail}`
    );
  }

  // Only update tier if status indicates a paid subscription
  if (isPaidStatus) {
    // Update user's tierId
    await userDocRef!.update({
      tierId: tier.slug,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Archive current quota history before updating to new tier
    try {
      await archiveQuotaHistory(userID);
    } catch (err) {
      console.warn(
        `Warning: Failed to archive quota history for user ${userID}:`,
        err
      );
    }

    // Update quota history using existing utility function
    await createQuotaHistoryFromTier(userID, tier.slug);

    // Send premium welcome email after successful subscription
    try {
      const userEmail = userDoc.data()?.email as string;
      const userName = userDoc.data()?.displayName;

      const premiumResult = await sendPremiumWelcomeEmail(userEmail, userName);

      if (premiumResult.success) {
        console.log(
          `Premium welcome email sent successfully for user ${userID}`
        );
      } else {
        console.warn(
          `Failed to send premium welcome email for user ${userID}:`,
          premiumResult.error
        );
      }
    } catch (emailError) {
      console.error(
        `Error sending premium welcome email for user ${userID}:`,
        emailError
      );
    }

    // Send premium welcome notification
    try {
      await sendNotificationToUser(
        userID,
        "Provolo Plus Activated!",
        "You’ve taken a big step towards landing more clients and building the career you want.",
        "/proposal",
        NotificationCategory.SUBSCRIPTION
      );
    } catch (error) {
      console.error(
        `Error sending premium welcome notification for user ${userID}:`,
        error
      );
    }
  } else {
    // For non-paid statuses (refunded, canceled), potentially downgrade to starter
    // But only if the current tier matches the product being refunded/canceled
    const currentUserData = userDoc!.data();
    const currentTierID = currentUserData?.tierId as string;
    if (currentTierID === tier.slug) {
      // Archive current quota history before downgrading
      try {
        await archiveQuotaHistory(userID);
      } catch (err) {
        console.warn(
          `Warning: Failed to archive quota history for user ${userID} before downgrade:`,
          err
        );
      }

      // Downgrade to starter tier
      await userDocRef!.update({
        tierId: DEFAULT_TIER_ID,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Update quota history for starter tier
      await createQuotaHistoryFromTier(userID, DEFAULT_TIER_ID);
    } else {
      console.log(
        `User ${userID} tier not affected by ${status} status (current tier: ${currentTierID}, order tier: ${tier.slug})`
      );
    }
  }
}

// Helper function to archive quota history
async function archiveQuotaHistory(userID: string) {
  const app = getFirebaseApp();
  const db = getFirestore(app);

  // Get current quota history
  const quotaDoc = await db.collection("quota_history").doc(userID).get();
  if (!quotaDoc.exists) {
    console.log(`No existing quota history to archive for user ${userID}`);
    return;
  }

  // Parse current quota history
  const currentQuota = quotaDoc.data() as QuotaHistory;

  // Get or create archive document
  const archiveDocRef = db.collection("quota_archive").doc(userID);
  const archiveDoc = await archiveDocRef.get();

  let archiveData: Record<string, any>;
  const now = FieldValue.serverTimestamp();
  const archivedAt = new Date().toISOString();

  if (!archiveDoc.exists) {
    // Create new archive document
    archiveData = {
      userId: userID,
      prev_quotas: [
        {
          archived_at: archivedAt,
          tier_id: currentQuota.tierId,
          last_subscription_date: currentQuota.lastSubscriptionDate,
          features: currentQuota.features,
          created_at: currentQuota.createdAt,
          updated_at: currentQuota.updatedAt,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
  } else {
    // Get existing archive data
    archiveData = archiveDoc.data()!;

    // Append new quota history to prev_quotas array
    const prevQuotas = archiveData.prev_quotas || [];
    const newQuotaEntry = {
      archived_at: archivedAt,
      tier_id: currentQuota.tierId,
      last_subscription_date: currentQuota.lastSubscriptionDate,
      features: currentQuota.features,
      created_at: currentQuota.createdAt,
      updated_at: currentQuota.updatedAt,
    };
    prevQuotas.push(newQuotaEntry);

    archiveData.prev_quotas = prevQuotas;
    archiveData.updatedAt = now;
  }

  // Save archive document
  await archiveDocRef.set(archiveData);

  console.log(
    `Successfully archived quota history for user ${userID} (tier: ${currentQuota.tierId})`
  );
}
