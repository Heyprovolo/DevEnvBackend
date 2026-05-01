import { getFirestore } from "firebase-admin/firestore";
import { getFirebaseApp } from "./getFirebaseApp.ts";
import { newErrorResponse } from "./apiResponse.ts";
import type { User, NewUser } from "../types/user.ts";
import type { Response } from "express";
import type { Timestamp } from "firebase-admin/firestore";

// Generates a 6-digit OTP code for email verification
export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Removes sensitive OTP fields from user object before sending to frontend
export function createSafeUserObject(
  user: User
): Omit<User, "otp" | "otpExpires"> {
  const { otp, otpExpires, ...safeUser } = user;
  return safeUser;
}

// Maps Firebase sign-in provider to our internal provider string
export function mapFirebaseProvider(firebaseProvider: string): string {
  switch (firebaseProvider) {
    case "password":
      return "email";
    case "google.com":
      return "google";
    default:
      return firebaseProvider;
  }
}

// Helper to get user by userId from Firestore
// Returns the doc and data, or sends a 404 response if not found and returns null
export async function getUserByUserId(
  userId: string,
  res?: Response
): Promise<{
  doc: FirebaseFirestore.QueryDocumentSnapshot;
  data: User;
} | null> {
  try {
    const app = getFirebaseApp();
    const db = getFirestore(app);
    const usersRef = db.collection("users");
    const userQuery = usersRef.where("userId", "==", userId).limit(1);
    const docs = await userQuery.get();

    if (docs.empty || !docs.docs[0]) {
      if (res) {
        res
          .status(404)
          .json(
            newErrorResponse(
              "User Not Found",
              "Your user record could not be found. Please contact support."
            )
          );
      }
      return null;
    }

    const doc = docs.docs[0];
    const data = doc.data() as User; // Cast to User type for better type safety

    // Convert Firestore Timestamps to Dates if necessary (helper logic to standardize this)
    if (data.otpExpires && !(data.otpExpires instanceof Date)) {
      data.otpExpires = new Date(
        (data.otpExpires as unknown as Timestamp).seconds * 1000
      );
    }
    if (data.createdAt && !(data.createdAt instanceof Date)) {
      data.createdAt = new Date(
        (data.createdAt as unknown as Timestamp).seconds * 1000
      );
    }
    if (data.updatedAt && !(data.updatedAt instanceof Date)) {
      data.updatedAt = new Date(
        (data.updatedAt as unknown as Timestamp).seconds * 1000
      );
    }

    if (data.country === undefined) data.country = null;
    if (data.state === undefined) data.state = null;

    return { doc, data };
  } catch (err) {
    console.error("Error fetching user:", err);
    if (res) {
      res
        .status(500)
        .json(
          newErrorResponse(
            "Database Error",
            "Unable to retrieve user data. Please contact support."
          )
        );
    }
    return null;
  }
}
