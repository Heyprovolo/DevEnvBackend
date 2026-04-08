import crypto from "crypto";
import dotenv from "dotenv";
import { getFirestore } from "firebase-admin/firestore";
import { getFirebaseApp } from "../utils/getFirebaseApp.ts";

dotenv.config();

function usage() {
  console.log("Usage: ts-node ./src/scripts/create-admin-user.ts <email> <password>");
}

async function scryptHash(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) return reject(error);
      resolve(derivedKey.toString("hex"));
    });
  });
}

async function run() {
  const [, , emailArg, passwordArg] = process.argv;
  const email = (emailArg ?? "").trim().toLowerCase();
  const password = passwordArg ?? "";

  if (!email || !password) {
    usage();
    process.exit(1);
  }
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  const app = getFirebaseApp();
  const db = getFirestore(app);

  const existing = await db
    .collection("admin_users")
    .where("emailLower", "==", email)
    .limit(1)
    .get();
  if (!existing.empty) {
    throw new Error(`Admin user already exists for ${email}`);
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = await scryptHash(password, salt);

  const docRef = db.collection("admin_users").doc();
  await docRef.set({
    email,
    emailLower: email,
    passwordHash,
    passwordSalt: salt,
    isActive: true,
    role: "admin",
    createdAt: new Date(),
  });

  console.log(`Admin user created successfully: ${email}`);
}

run().catch((error) => {
  console.error("Failed to create admin user:", error instanceof Error ? error.message : error);
  process.exit(1);
});

