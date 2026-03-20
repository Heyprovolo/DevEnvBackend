import "dotenv/config";
import { getFirebaseApp, closeFirebaseApp } from "../utils/getFirebaseApp.ts";
import { getFirestore } from "firebase-admin/firestore";
import type { QuotaHistory } from "../types/quotas.ts";

const RESUME_FEATURE = {
  name: "Resume Generator",
  description: "Create professional resumes.",
  slug: "resume_generator",
  limited: false,
  recurringInterval: "",
  maxQuota: -1,
  usageCount: 0,
  lastUsed: null,
};

async function migrateResumeQuotas() {
  const app = getFirebaseApp();
  const db = getFirestore(app);

  try {
    console.log(
      "Starting resume quota migration for existing Premium users...",
    );

    // Find all active plus and plusAnnual users' quota history docs
    const quotaRef = db.collection("quota_history");
    const snapshot = await quotaRef
      .where("tierId", "in", ["plus", "plusAnnual"])
      .get();

    if (snapshot.empty) {
      console.log("No existing Premium users found. Migration completed.");
      return;
    }

    let updatedCount = 0;
    let skippedCount = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data() as QuotaHistory;

      const features = data.features || [];
      const hasResumeFeature = features.some(
        (f) => f.slug === "resume_generator",
      );

      if (!hasResumeFeature) {
        features.push(RESUME_FEATURE as any);
        await doc.ref.update({
          features,
          updatedAt: new Date(),
        });
        updatedCount++;
        console.log(`Updated user ${data.userId} with resume quota.`);
      } else {
        skippedCount++;
      }
    }

    console.log("Migration complete!");
    console.log(`Updated documents: ${updatedCount}`);
    console.log(`Skipped documents (already had feature): ${skippedCount}`);
  } catch (error) {
    console.error("Migration failed with error:", error);
  } finally {
    closeFirebaseApp();
  }
}

migrateResumeQuotas();
