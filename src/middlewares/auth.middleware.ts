import type { Request, Response, NextFunction } from "express";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getFirebaseApp } from "../utils/getFirebaseApp.ts";
import { newErrorResponse } from "../utils/apiResponse.ts";
import { getCookie } from "../utils/getCookie.ts";

// Types
import type { DecodedIdToken } from "firebase-admin/auth";

const VERIFIED_CACHE_TTL_MS = 10 * 60 * 1000;
const UNVERIFIED_CACHE_TTL_MS = 30 * 1000;
const CACHE_MAX_ENTRIES = 5000;

type EmailVerificationCacheEntry = {
  exists: boolean;
  emailVerified: boolean;
  expiresAt: number;
};

const emailVerificationCache = new Map<string, EmailVerificationCacheEntry>();

function getEmailVerificationCache(
  userId: string
): EmailVerificationCacheEntry | null {
  const entry = emailVerificationCache.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    emailVerificationCache.delete(userId);
    return null;
  }
  return entry;
}

function setEmailVerificationCache(
  userId: string,
  entry: Omit<EmailVerificationCacheEntry, "expiresAt">
) {
  if (emailVerificationCache.size > CACHE_MAX_ENTRIES) {
    const now = Date.now();
    for (const [key, value] of emailVerificationCache.entries()) {
      if (value.expiresAt <= now) {
        emailVerificationCache.delete(key);
      }
    }
  }

  const ttlMs = entry.emailVerified
    ? VERIFIED_CACHE_TTL_MS
    : UNVERIFIED_CACHE_TTL_MS;

  emailVerificationCache.set(userId, {
    ...entry,
    expiresAt: Date.now() + ttlMs,
  });
}

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

  let token: DecodedIdToken | null = null;
  const sessionCookie = getCookie(req, "session");
  const authHeader = req.headers.authorization;

  if (sessionCookie) {
    try {
      token = await auth.verifySessionCookie(sessionCookie, true);
    } catch (sessionErr) {
      token = null;
    }
  }

  if (!token && authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const idToken = authHeader.replace("Bearer ", "");
      token = await auth.verifyIdToken(idToken);
    } catch (bearerErr) {
      token = null;
    }
  }

  if (!token) {
    return res
      .status(401)
      .json(
        newErrorResponse(
          "Unauthorized",
          sessionCookie || authHeader
            ? "Invalid or expired token/session"
            : "No authentication provided"
        )
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
    const cachedStatus = getEmailVerificationCache(req.userID);
    if (cachedStatus) {
      if (!cachedStatus.exists) {
        return res
          .status(404)
          .json(newErrorResponse("User Not Found", "User account not found"));
      }
      if (!cachedStatus.emailVerified) {
        return res
          .status(403)
          .json(
            newErrorResponse(
              "Email Not Verified",
              "Please verify your email address before using this feature. Check your inbox for the verification code."
            )
          );
      }
      return next();
    }

    const app = getFirebaseApp();
    const db = getFirestore(app);

    const usersRef = db.collection("users");
    const userQuery = usersRef.where("userId", "==", req.userID).limit(1);
    const docs = await userQuery.get();

    if (docs.empty || !docs.docs[0]) {
      setEmailVerificationCache(req.userID, {
        exists: false,
        emailVerified: false,
      });
      return res
        .status(404)
        .json(newErrorResponse("User Not Found", "User account not found"));
    }

    const userData = docs.docs[0].data();
    const emailVerified = userData.emailVerified === true;
    setEmailVerificationCache(req.userID, {
      exists: true,
      emailVerified,
    });

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
