import type { Request, Response, NextFunction } from "express";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getFirebaseApp } from "../utils/getFirebaseApp.ts";
import { newErrorResponse } from "../utils/apiResponse.ts";
import { getCookie } from "../utils/getCookie.ts";

// Types
import type { DecodedIdToken } from "firebase-admin/auth";

// Extend Express Request interface to include custom user properties
declare global {
  namespace Express {
    interface Request {
      userID?: string;
      userEmail?: string | undefined;
      userDisplayName?: string | undefined;
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const app = getFirebaseApp();
  const auth = getAuth(app);

  let token: DecodedIdToken;
  try {
    // Try session cookie first
    const sessionCookie = getCookie(req, "session");
    if (sessionCookie) {
      token = await auth.verifySessionCookie(sessionCookie, true);
    } else {
      // Fallback to Bearer token
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const idToken = authHeader.replace("Bearer ", "");
        token = await auth.verifyIdToken(idToken);
      } else {
        return res
          .status(401)
          .json(newErrorResponse("Unauthorized", "No authentication provided"));
      }
    }
  } catch (err) {
    return res
      .status(401)
      .json(
        newErrorResponse("Unauthorized", "Invalid or expired token/session")
      );
  }

  // Attach user info to request
  req.userID = token.uid;
  req.userEmail = token.email;
  req.userDisplayName = token.name;
  next();
}

// Middleware to check if email is verified
export async function emailVerificationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.userID) {
    return res
      .status(401)
      .json(newErrorResponse("Unauthorized", "Authentication required"));
  }

  try {
    const app = getFirebaseApp();
    const db = getFirestore(app);

    const usersRef = db.collection("users");
    const userQuery = usersRef.where("userId", "==", req.userID).limit(1);
    const docs = await userQuery.get();

    if (docs.empty || !docs.docs[0]) {
      return res
        .status(404)
        .json(newErrorResponse("User Not Found", "User account not found"));
    }

    const userData = docs.docs[0].data();
    const emailVerified = userData.emailVerified === true;

    if (!emailVerified) {
      return res
        .status(403)
        .json(
          newErrorResponse(
            "Email Not Verified",
            "Please verify your email address before using this feature. Check your inbox for the verification code."
          )
        );
    }

    next();
  } catch (err) {
    console.error("[emailVerificationMiddleware] Error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "Unable to verify email status"
        )
      );
  }
}
