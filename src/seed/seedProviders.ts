import "dotenv/config";
import { getFirebaseApp } from "../utils/getFirebaseApp.ts";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

export async function seedProviders() {
  console.log("Starting user providers seeding...");

  const app = getFirebaseApp();
  const db = getFirestore(app);

  console.log("Querying all users...");
  const allUsers = await db.collection("users").get();

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  const BATCH_SIZE = 500;
  let batch = db.batch();
  let operationCount = 0;

  for (const doc of allUsers.docs) {
    try {
      const userData = doc.data();
      
      // Check if providers field already exists and is not empty
      if (userData.providers && Array.isArray(userData.providers) && userData.providers.length > 0) {
        skippedCount++;
        continue;
      }

      console.log(`Queueing update for user ${doc.id}...`);

      batch.update(doc.ref, {
        providers: ["email"],
        updatedAt: FieldValue.serverTimestamp(),
      });

      operationCount++;
      successCount++;

      if (operationCount >= BATCH_SIZE) {
        console.log(`Committing batch of ${operationCount} updates...`);
        await batch.commit();
        batch = db.batch();
        operationCount = 0;
      }
    } catch (error) {
      console.error(`Failed to process user ${doc.id}:`, error);
      errorCount++;
    }
  }

  if (operationCount > 0) {
    console.log(`Committing final batch of ${operationCount} updates...`);
    await batch.commit();
  }

  console.log(`\nSeeding completed:`);
  console.log(`Successfully updated: ${successCount} users`);
  console.log(`Skipped (already had providers): ${skippedCount} users`);
  console.log(`Failed: ${errorCount} users`);
}
