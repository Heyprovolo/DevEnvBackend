import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import { getCookie } from "../utils/getCookie.ts";
import { closeFirebaseApp, getFirebaseApp } from "../utils/getFirebaseApp.ts";
import { newSuccessResponse, newErrorResponse } from "../utils/apiResponse.ts";
import { createQuotaHistoryFromTier } from "../utils/quota.utils.ts";
import { createPolarCustomer } from "../utils/polarClient.ts";
import {
  sendWelcomeEmail,
  sendVerificationEmail,
} from "../services/mail.service.ts";
import { subscribeUser } from "../services/mailerlite.service.ts";
import { sendNotificationToUser } from "../services/notification.service.ts";
import { UAParser } from "ua-parser-js";

import type { NewUser, User } from "../types/user.ts";
import type { Request, Response } from "express";
import type { DecodedIdToken, UserRecord } from "firebase-admin/auth";
import { NotificationCategory } from "../types/notification.ts";
import {
  createSafeUserObject,
  generateOTP,
  getUserByUserId,
  mapFirebaseProvider,
} from "../utils/user.utils.ts";
import { extractRequestLocation } from "../utils/requestLocation.utils.ts";
import {
  decodeLoginHistoryCursor,
  encodeLoginHistoryCursor,
  loginHistoryBaseQuery,
  startLoginHistoryAfterCompound,
  timestampMillisFromFirestoreField,
} from "../utils/loginHistoryPagination.utils.ts";
import { validateUsername } from "../utils/validation.utils.ts";

// Generates and stores a new OTP code for email verification, then sends it via email (expires after 15 minutes)
export async function generateAndSendOTP(
  userId: string,
  email: string,
  db: FirebaseFirestore.Firestore
): Promise<void> {
  const otp = generateOTP();
  const otpExpires = new Date(Date.now() + 15 * 60 * 1000);

  const usersRef = db.collection("users");
  const userQuery = usersRef.where("userId", "==", userId).limit(1);
  const docs = await userQuery.get();

  if (!docs.empty && docs.docs[0]) {
    await docs.docs[0].ref.update({
      otp,
      otpExpires,
      updatedAt: new Date(),
    });

    await sendVerificationEmail({ email, otp });
  }
}

// Records login history for a user
async function recordLoginHistory(
  userId: string,
  req: Request,
  db: FirebaseFirestore.Firestore
): Promise<void> {
  try {
    const userAgent = req.headers["user-agent"] || "";
    const parser = new UAParser(userAgent);
    const result = parser.getResult();

    const deviceName =
      result.device.model || result.os.name || result.browser.name || "Unknown";
    const browserName = result.browser.name
      ? `${result.browser.name} ${result.browser.version || ""}`
      : "Unknown";
    const osName = result.os.name
      ? `${result.os.name} ${result.os.version || ""}`
      : "Unknown";

    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0] ||
      req.ip ||
      "Unknown";

    const { country, state } = extractRequestLocation(req);

    const usersRef = db.collection("users");
    const userQuery = usersRef.where("userId", "==", userId).limit(1);
    const docs = await userQuery.get();

    if (!docs.empty && docs.docs[0]) {
      await docs.docs[0].ref.collection("login_history").add({
        device: deviceName,
        browser: browserName,
        os: osName,
        ip,
        country,
        state,
        userAgent,
        timestamp: new Date(),
      });
    }
  } catch (error) {
    console.error("Error recording login history:", error);
  }
}

// Authenticates user with Firebase ID token and creates a session cookie (does not send OTP automatically to avoid spamming users)
export async function login(req: Request, res: Response) {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Invalid Request",
            "Please check your request format and try again."
          )
        );
    }

    const app = getFirebaseApp();
    const auth = getAuth(app);
    const db = getFirestore(app);

    let token: DecodedIdToken | null = null;
    try {
      token = await auth.verifyIdToken(idToken);
    } catch (err) {
      return res
        .status(401)
        .json(
          newErrorResponse(
            "Authentication Failed",
            "Unable to verify your authentication. Please try logging in again."
          )
        );
    }

    let cookie;
    let activeSessionToken: string;
    try {
      // Create session cookie
      cookie = await auth.createSessionCookie(idToken, {
        expiresIn: 5 * 24 * 60 * 60 * 1000,
      });

      // Generate unique session token for single-device tracking
      activeSessionToken = crypto.randomUUID();

      // Record device history
      await recordLoginHistory(token.uid, req, db);
    } catch (err) {
      console.log(err);
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Session Creation Failed",
            "Unable to create your session. Please contact support if this continues."
          )
        );
    }

    const isProduction = process.env.NODE_ENV === "production";

    const COOKIE_OPTIONS = {
      maxAge: 5 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      path: "/",
      sameSite: isProduction ? "lax" : "none",
      secure: true,
    } as const;

    res.cookie("session", cookie, COOKIE_OPTIONS);
    res.cookie("session_token", activeSessionToken, COOKIE_OPTIONS);

    // Get user using helper
    const userResult = await getUserByUserId(token.uid, res);
    if (!userResult) return; // Response handled by helper

    const { doc, data } = userResult;

    // Check account setup (redundant with getUserByUserId returning null but explicit check in original code)
    if (!doc) {
      // Should be caught by getUserByUserId, but for safety
      return;
    }

    const firebaseProvider = token.firebase.sign_in_provider;
    const currentProvider = mapFirebaseProvider(firebaseProvider);

    const providers = data.providers || [];
    const loc = extractRequestLocation(req);

    // Update providers and activeSessionToken
    const updateData: Record<string, unknown> = {
      activeSessionToken,
      updatedAt: new Date(),
    };
    if (!providers.includes(currentProvider)) {
      updateData.providers = [...providers, currentProvider];
      providers.push(currentProvider);
    }
    if (loc.country != null) updateData.country = loc.country;
    if (loc.state != null) updateData.state = loc.state;
    await doc.ref.update(updateData);

    const emailVerified = data.emailVerified === true;
    const user: User = {
      ...data,
      id: doc.id,
      providers, // Ensure updated providers are returned
      activeSessionToken,
      ...(loc.country != null && { country: loc.country }),
      ...(loc.state != null && { state: loc.state }),
    };

    return res
      .status(200)
      .json(
        newSuccessResponse(
          "Login Successful",
          "User authenticated successfully",
          createSafeUserObject(user)
        )
      );
  } catch (err) {
    console.log("Login Error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Login Error",
          "Unable to log you in. Please contact support if this continues."
        )
      );
  }
}

// Handles user signup or ensures user exists in Firestore (creates new user with starter tier, sends verification email with OTP, creates session cookie)
export async function signupOrEnsureUser(req: Request, res: Response) {
  try {
    const starterTierId = process.env.STARTER_TIER_ID || "";
    const { idToken } = req.body;

    if (!idToken)
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Invalid Request",
            "Please check your request format and try again."
          )
        );

    const app = getFirebaseApp();
    const auth = getAuth(app);
    const db = getFirestore(app);
    const usersRef = db.collection("users");

    let decodedUserInfo: DecodedIdToken | null = null;
    try {
      decodedUserInfo = (await auth.verifyIdToken(idToken)) as DecodedIdToken;
    } catch (err) {
      return res
        .status(401)
        .json(
          newErrorResponse(
            "Authentication Failed",
            "Unable to verify your authentication. Please try again."
          )
        );
    }

    const userID = decodedUserInfo.uid;
    let userRecord: UserRecord | null = null;

    try {
      userRecord = (await auth.getUser(userID)) as UserRecord;
    } catch (err) {
      return res
        .status(500)
        .json(
          newErrorResponse(
            "User Info Failed",
            "Unable to retrieve your account information. Please contact support if this continues."
          )
        );
    }

    // Check if user exists
    const userResult = await getUserByUserId(userID);
    const now: Date = new Date();
    const loc = extractRequestLocation(req);

    // Determine provider
    const firebaseProvider = decodedUserInfo.firebase.sign_in_provider;
    const currentProvider = mapFirebaseProvider(firebaseProvider);

    let userData: User | null = null;
    let isNewUser: boolean = false;
    let userDocRef: FirebaseFirestore.DocumentReference;

    if (userResult) {
      // Existing User Logic
      const existingUserDoc = userResult.doc;
      const existingUserData = userResult.data;
      userDocRef = existingUserDoc.ref;

      const providers = existingUserData.providers || [];
      if (!providers.includes(currentProvider)) {
        await userDocRef.update({
          providers: [...providers, currentProvider],
          updatedAt: now,
        });
        providers.push(currentProvider);
      }

      userData = {
        ...existingUserData,
        id: existingUserDoc.id,
        providers, // Ensure updated providers are used
        activeSessionToken: null, // Set later
      };
    } else {
      // New User Logic
      isNewUser = true;
      const otp = generateOTP();
      const otpExpires = new Date(Date.now() + 15 * 60 * 1000);

      const newUserData: NewUser = {
        userId: userID,
        email: userRecord.email!,
        displayName: userRecord.displayName || null,
        country: loc.country,
        state: loc.state,
        tierId: starterTierId,
        mailerliteId: null,
        polarId: null,
        portfolioLink: null,
        professionalTitle: null,
        emailVerified: false,
        otp,
        otpExpires,
        providers: [currentProvider],
        activeSessionToken: null,
        createdAt: now,
        updatedAt: now,
      };

      const docRef = await usersRef.add(newUserData);
      userDocRef = docRef;
      userData = {
        id: docRef.id,
        ...newUserData,
      };

      // Async post-signup tasks (Polar, Quota, Email, Notification)
      // We don't await these to speed up response, or we await if critical.
      // Original code awaited them.
      try {
        const polarCustomerResult = await createPolarCustomer({
          userId: userID,
          email: userRecord.email!,
          name: userRecord.displayName || userRecord.email!,
        });

        await docRef.update({
          polarId: polarCustomerResult.id,
          updatedAt: now,
        });

        userData.polarId = polarCustomerResult.id;
      } catch (error) {
        console.error(
          `Failed to create Polar customer for new user ${userID}:`,
          error
        );
      }

      await createQuotaHistoryFromTier(userID, starterTierId, false);

      try {
        await sendVerificationEmail({ email: userRecord.email!, otp });
      } catch (error) {
        console.error(
          "[signupOrEnsureUser] Error sending verification email:",
          error
        );
      }

      try {
        await sendNotificationToUser(
          userID,
          "Welcome to Provolo!",
          "You're now part of a growing community of freelancers who are working smarter to land more clients.",
          "/optimizer",
          NotificationCategory.USER
        );
      } catch (error) {
        console.error(
          "[signupOrEnsureUser] Error sending welcome notification:",
          error
        );
      }
    }

    // Session Management
    let cookie;
    let activeSessionToken: string;
    try {
      // Create session cookie
      cookie = await auth.createSessionCookie(idToken, {
        expiresIn: 5 * 24 * 60 * 60 * 1000,
      });

      // Generate unique session token for single-device tracking
      activeSessionToken = crypto.randomUUID();

      // Record device history
      await recordLoginHistory(userID, req, db); // Provided recordLoginHistory is in scope or imported

      // Update user with activeSessionToken using the ref we already have
      await userDocRef.update({
        activeSessionToken,
        updatedAt: new Date(),
        ...(loc.country != null && { country: loc.country }),
        ...(loc.state != null && { state: loc.state }),
      });

      // Update userData with the token
      if (userData) {
        userData.activeSessionToken = activeSessionToken;
        userData.updatedAt = new Date();
        if (loc.country != null) userData.country = loc.country;
        if (loc.state != null) userData.state = loc.state;
      }
    } catch (err) {
      console.error("Signup/Session Error:", err);
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Session Error",
            "Unable to create your session. Please contact support if this continues."
          )
        );
    }

    const isProduction = process.env.NODE_ENV === "production";

    const COOKIE_OPTIONS = {
      maxAge: 5 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      path: "/",
      sameSite: isProduction ? "lax" : "none",
      secure: true,
    } as const;

    res.cookie("session", cookie, COOKIE_OPTIONS);
    res.cookie("session_token", activeSessionToken, COOKIE_OPTIONS);

    const message = isNewUser
      ? "Signup successful! Your account has been created."
      : "User profile retrieved";

    const action = isNewUser ? "Signup Successful" : "Login Successful";
    return res
      .status(200)
      .json(
        newSuccessResponse(
          action,
          message,
          userData ? createSafeUserObject(userData) : null
        )
      );
  } catch (err) {
    console.error("Signup Error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Signup Error",
          "Unable to set up your account. Please contact support if this continues."
        )
      );
  }
}

// Verifies if the current session cookie is valid and returns user data
export async function verifySession(req: Request, res: Response) {
  try {
    const app = getFirebaseApp();
    const auth = getAuth(app);

    const sessionCookie = getCookie(req, "session");
    let decodedUserInfo: DecodedIdToken | null = null;
    if (sessionCookie) {
      try {
        decodedUserInfo = await auth.verifySessionCookie(sessionCookie, true);
      } catch (err) {
        return res
          .status(401)
          .json(
            newErrorResponse(
              "Invalid Session",
              "Session is invalid or expired. Please log in again."
            )
          );
      }
    } else {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const idToken = authHeader.replace("Bearer ", "");
        try {
          decodedUserInfo = await auth.verifyIdToken(idToken);
        } catch (err) {
          return res
            .status(401)
            .json(
              newErrorResponse("Unauthorized", "Invalid or expired token.")
            );
        }
      } else {
        return res
          .status(401)
          .json(
            newErrorResponse("Unauthorized", "No session or token provided.")
          );
      }
    }

    const { uid } = decodedUserInfo;
    // Get user using helper
    const userResult = await getUserByUserId(uid);

    // Explicit 403 checks for verify logic (similar to original) but utilizing the helper
    if (!userResult) {
      return res
        .status(403)
        .json(
          newErrorResponse(
            "Account Setup Required",
            "Your account is not properly set up. Please contact support or sign up again to complete your account setup."
          )
        );
    }

    const { doc, data } = userResult;

    // Single-device enforcement: check if session_token matches stored activeSessionToken
    const sessionTokenCookie = getCookie(req, "session_token");
    const storedSessionToken = data.activeSessionToken;
    if (storedSessionToken && sessionTokenCookie !== storedSessionToken) {
      return res
        .status(401)
        .json(
          newErrorResponse(
            "Session Invalidated",
            "You have been logged out because you signed in on another device."
          )
        );
    }

    const user: User = {
      ...data,
      id: doc.id,
    };

    return res
      .status(200)
      .json(
        newSuccessResponse(
          "Session Valid",
          "Session is valid",
          createSafeUserObject(user)
        )
      );
  } catch (err) {
    console.error("Verify Session Error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Session Verification Error",
          "Unable to verify your session. Please contact support if this continues."
        )
      );
  }
}

export async function logout(req: Request, res: Response) {
  try {
    const sessionCookie = getCookie(req, "session");

    const isProduction = process.env.NODE_ENV === "production";
    console.log("isProduction:", isProduction);

    const COOKIE_OPTIONS = {
      maxAge: 0,
      httpOnly: true,
      path: "/",
      sameSite: isProduction ? "lax" : "none",
      secure: true,
    } as const;

    console.log("Setting cookie with options:", COOKIE_OPTIONS);
    res.cookie("session", "", COOKIE_OPTIONS);

    if (sessionCookie) {
      try {
        const app = getFirebaseApp();
        const auth = getAuth(app);

        const decodedToken = await auth.verifySessionCookie(
          sessionCookie,
          true
        );

        await auth.revokeRefreshTokens(decodedToken.uid);
      } catch (err) {
        console.error("Failed to revoke Firebase session:", err);
      }
    }

    return res
      .status(200)
      .json(
        newSuccessResponse(
          "Logout Successful",
          "User logged out successfully",
          null
        )
      );
  } finally {
    closeFirebaseApp();
  }
}

// Updates user's display name/username (for first-time users, sends welcome email and subscribes to MailerLite)
export async function updateUsername(req: Request, res: Response) {
  try {
    const { username } = req.body;

    const validation = validateUsername(username);
    if (!validation.isValid) {
      return res
        .status(400)
        .json(newErrorResponse("Invalid Username", validation.error!));
    }

    if (!req.userID || !req.userEmail) {
      return res
        .status(401)
        .json(
          newErrorResponse(
            "Unauthorized",
            "You must be logged in to update your username."
          )
        );
    }

    const isFirstTimeUser =
      !req.userDisplayName || req.userDisplayName.trim() === "";
    const now = new Date();

    const app = getFirebaseApp();
    const auth = getAuth(app);
    const db = getFirestore(app);

    try {
      await auth.updateUser(req.userID, { displayName: username });
    } catch (authErr) {
      console.error("Firebase Auth updateUser error:", authErr);
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Auth Update Failed",
            "Unable to update your username in authentication. Please contact support."
          )
        );
    }

    // Use helper to get user for the update loop
    // Note: The original logic fetched, updated, then fetched again.
    // We can simplify by just getting ref first.
    const userResult = await getUserByUserId(req.userID, res);
    if (!userResult) return;

    const { doc: userDoc, data: userData } = userResult;

    try {
      await userDoc.ref.update({ displayName: username });
    } catch (firestoreErr) {
      console.error("Firestore update error:", firestoreErr);
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Database Update Failed",
            "Unable to update your username in our database."
          )
        );
    }

    if (isFirstTimeUser) {
      try {
        const emailResult = await sendWelcomeEmail({
          name: username,
          email: req.userEmail,
        });

        if (emailResult.success) {
          console.log(`Welcome email sent successfully to ${req.userEmail}`);
        } else {
          console.error(
            `Failed to send welcome email to ${req.userEmail}:`,
            emailResult.error
          );
        }
      } catch (emailErr) {
        console.error("Error sending welcome email:", emailErr);
      }

      try {
        const subscribeUserResult = await subscribeUser(
          username,
          req.userEmail
        );

        if (subscribeUserResult.success && subscribeUserResult.data?.data?.id) {
          await userDoc.ref.update({
            mailerliteId: subscribeUserResult.data.data.id,
            updatedAt: now,
          });
          console.log(
            `User ${req.userID} subscribed to MailerLite with ID: ${subscribeUserResult.data.data.id}`
          );
        } else {
          console.warn(
            `Failed to subscribe user ${req.userID} to MailerLite:`,
            subscribeUserResult.message
          );
        }
      } catch (mailerliteErr) {
        console.error("Error subscribing user to MailerLite:", mailerliteErr);
      }
    }

    try {
      // Fetch updated user data
      const updatedUserResult = await getUserByUserId(req.userID);
      if (!updatedUserResult) {
        throw new Error("User document not found after username update.");
      }

      const { doc: updatedDoc, data: updatedData } = updatedUserResult;

      const user: User = {
        ...updatedData,
        id: updatedDoc.id,
      };

      return res
        .status(200)
        .json(
          newSuccessResponse(
            "Username Updated",
            "Your username has been updated successfully.",
            createSafeUserObject(user)
          )
        );
    } catch (err) {
      console.error("Update Username Error:", err);
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Update Failed",
            "Unable to update your username. Please contact support."
          )
        );
    }
  } catch (err) {
    console.error("Update Username Error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Update Failed",
          "Unable to update your username. Please contact support."
        )
      );
  }
}

export async function updateProviders(req: Request, res: Response) {
  try {
    const { providers } = req.body;

    if (
      !Array.isArray(providers) ||
      !providers.every((p) => typeof p === "string")
    ) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Invalid Request",
            "Providers must be an array of strings."
          )
        );
    }

    if (!req.userID) {
      return res
        .status(401)
        .json(
          newErrorResponse(
            "Unauthorized",
            "You must be logged in to update your providers."
          )
        );
    }

    // Use helper to get user
    const userResult = await getUserByUserId(req.userID, res);
    if (!userResult) return;

    const { doc, data } = userResult;

    await doc.ref.update({
      providers,
      updatedAt: new Date(),
    });

    const user: User = {
      ...data,
      id: doc.id,
      providers, // Use the updated providers
      updatedAt: new Date(),
    };

    return res
      .status(200)
      .json(
        newSuccessResponse(
          "Providers Updated",
          "Your authentication providers have been updated successfully.",
          createSafeUserObject(user)
        )
      );
  } catch (err) {
    console.error("Update Providers Error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Update Failed",
          "Unable to update your providers. Please contact support."
        )
      );
  }
}

// Updates user profile fields: portfolio_link and professional_title
export async function updateProfile(req: Request, res: Response) {
  try {
    const { portfolio_link, professional_title } = req.body;

    if (!req.userID) {
      return res
        .status(401)
        .json(
          newErrorResponse(
            "Unauthorized",
            "You must be logged in to update your profile."
          )
        );
    }

    if (portfolio_link !== undefined) {
      if (
        typeof portfolio_link !== "string" ||
        (portfolio_link.trim() && !/^https?:\/\/.+/.test(portfolio_link.trim()))
      ) {
        return res
          .status(400)
          .json(
            newErrorResponse(
              "Invalid Portfolio Link",
              "Portfolio link must be a valid URL starting with http:// or https://"
            )
          );
      }
    }

    if (professional_title !== undefined) {
      if (
        typeof professional_title !== "string" ||
        professional_title.length > 200
      ) {
        return res
          .status(400)
          .json(
            newErrorResponse(
              "Invalid Professional Title",
              "Professional title must be a string and not exceed 200 characters."
            )
          );
      }
    }

    if (portfolio_link === undefined && professional_title === undefined) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Invalid Request",
            "At least one field (portfolio_link or professional_title) must be provided."
          )
        );
    }

    const app = getFirebaseApp();
    const now = new Date();

    // Use helper to get user
    const userResult = await getUserByUserId(req.userID, res);
    if (!userResult) return;

    const { doc: userDoc, data: userData } = userResult;

    const updateData: any = { updatedAt: now };

    if (portfolio_link !== undefined) {
      updateData.portfolioLink = portfolio_link.trim() || null;
    }

    if (professional_title !== undefined) {
      updateData.professionalTitle = professional_title.trim() || null;
    }

    await userDoc.ref.update(updateData);

    // Check for changes and send "Knowledge Base Updated" notification
    try {
      const oldPortfolio = userData.portfolioLink || null;
      const oldTitle = userData.professionalTitle || null;

      const newPortfolio =
        portfolio_link !== undefined
          ? portfolio_link.trim() || null
          : oldPortfolio;
      const newTitle =
        professional_title !== undefined
          ? professional_title.trim() || null
          : oldTitle;

      // Check if anything actually changed
      const portfolioChanged = newPortfolio !== oldPortfolio;
      const titleChanged = newTitle !== oldTitle;

      if (portfolioChanged || titleChanged) {
        await sendNotificationToUser(
          req.userID,
          "Knowledge Base Updated",
          "Your profile information has been updated. We'll use this new context for future optimizations.",
          "/userprofile",
          NotificationCategory.KNOWLEDGE
        );
      }
    } catch (err) {
      console.error(
        "Error checking/sending knowledge base update notification:",
        err
      );
    }

    // Refetch updated data (simpler than manual merge for complex objects, though merge is faster)
    const updatedUserResult = await getUserByUserId(req.userID);
    if (!updatedUserResult) {
      return res
        .status(404)
        .json(
          newErrorResponse("User Not Found", "User record lost after update?")
        );
    }
    const { doc: updatedDoc, data: updatedData } = updatedUserResult;

    const user: User = {
      ...updatedData,
      id: updatedDoc.id,
    };

    return res
      .status(200)
      .json(
        newSuccessResponse(
          "Profile Updated",
          "Profile updated successfully",
          createSafeUserObject(user)
        )
      );
  } catch (err) {
    console.error("Update Profile Error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Update Profile Error",
          "Unable to update your profile. Please contact support if this continues."
        )
      );
  } finally {
    closeFirebaseApp();
  }
}

// Verifies user's email address using the OTP code (validates OTP, checks expiration, and marks email as verified)
export async function verifyEmail(req: Request, res: Response) {
  try {
    const { otp } = req.body;

    if (!req.userID) {
      return res
        .status(401)
        .json(
          newErrorResponse(
            "Unauthorized",
            "You must be logged in to verify your email."
          )
        );
    }

    if (!otp || typeof otp !== "string" || otp.length !== 6) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Invalid OTP",
            "Please provide a valid 6-digit OTP code."
          )
        );
    }

    const app = getFirebaseApp();
    const now = new Date();

    // Use helper to get user
    const userResult = await getUserByUserId(req.userID, res);
    if (!userResult) return;

    const { doc: userDoc, data: userData } = userResult;

    if (userData.emailVerified === true) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Already Verified",
            "Your email has already been verified."
          )
        );
    }

    if (!userData.otp || userData.otp !== otp) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Invalid OTP",
            "The OTP code you entered is incorrect. Please check and try again."
          )
        );
    }

    // Helper already converts Timestamp objects to Date, so simple check
    const otpExpires = userData.otpExpires;

    if (!otpExpires || otpExpires < now) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "OTP Expired",
            "The OTP code has expired. Please request a new one."
          )
        );
    }

    const auth = getAuth(app);
    try {
      await auth.updateUser(req.userID, {
        emailVerified: true,
      });
    } catch (authErr) {
      console.error(
        "Failed to update Firebase Auth email verification:",
        authErr
      );
    }

    await userDoc.ref.update({
      emailVerified: true,
      otp: null,
      otpExpires: null,
      updatedAt: now,
    });

    const updatedUserResult = await getUserByUserId(req.userID);
    if (!updatedUserResult) {
      return res
        .status(404)
        .json(
          newErrorResponse(
            "User Not Found",
            "User record lost after verification?"
          )
        );
    }
    const { doc: updatedDoc, data: updatedData } = updatedUserResult;

    const user: User = {
      ...updatedData,
      id: updatedDoc.id,
    };

    return res
      .status(200)
      .json(
        newSuccessResponse(
          "Email Verified",
          "Your email has been successfully verified.",
          createSafeUserObject(user)
        )
      );
  } catch (err) {
    console.error("Verify Email Error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Verification Error",
          "Unable to verify your email. Please contact support if this continues."
        )
      );
  } finally {
    closeFirebaseApp();
  }
}

// Resends a new OTP code to the user's email for verification (only works if email is not already verified)
export async function resendVerificationOTP(req: Request, res: Response) {
  try {
    if (!req.userID) {
      return res
        .status(401)
        .json(
          newErrorResponse(
            "Unauthorized",
            "You must be logged in to request a verification code."
          )
        );
    }

    const app = getFirebaseApp();
    const db = getFirestore(app);

    // Use helper to get user
    const userResult = await getUserByUserId(req.userID, res);
    if (!userResult) return;

    const { data: userData } = userResult;

    if (userData.emailVerified === true) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Already Verified",
            "Your email has already been verified."
          )
        );
    }

    try {
      await generateAndSendOTP(req.userID, userData.email, db);
    } catch (error) {
      console.error("[resendVerificationOTP] Error sending OTP:", error);
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Error Sending OTP",
            "Failed to send verification code. Please try again later."
          )
        );
    }

    return res
      .status(200)
      .json(
        newSuccessResponse(
          "Verification Code Sent",
          "A new verification code has been sent to your email.",
          null
        )
      );
  } catch (err) {
    console.error("Resend OTP Error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Resend OTP Error",
          "Unable to send verification code. Please contact support if this continues."
        )
      );
  } finally {
    closeFirebaseApp();
  }
}

export async function getDeviceHistory(req: Request, res: Response) {
  try {
    if (!req.userID) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "You must be logged in."));
    }

    const userResult = await getUserByUserId(req.userID, res);
    if (!userResult) return;

    const loginCol = userResult.doc.ref.collection("login_history");

    let limitNum = Number.parseInt(String(req.query.limit ?? "10"), 10);
    if (!Number.isFinite(limitNum)) limitNum = 10;
    limitNum = Math.min(10, Math.max(1, Math.floor(limitNum)));

    let q: FirebaseFirestore.Query = loginHistoryBaseQuery(loginCol);

    const cursorRaw = req.query.cursor;
    const cursorStr =
      typeof cursorRaw === "string" && cursorRaw.trim()
        ? cursorRaw.trim()
        : null;

    if (cursorStr) {
      const opaque = decodeLoginHistoryCursor(cursorStr);
      if (opaque) {
        q = startLoginHistoryAfterCompound(q, opaque.millis, opaque.docId);
      } else {
        /** Legacy anchor = document id alone (costs one read; prefer opaque cursor). */
        const cursorSnap = await loginCol.doc(cursorStr).get();
        if (!cursorSnap.exists) {
          return res
            .status(400)
            .json(
              newErrorResponse(
                "Invalid Request",
                "Invalid or expired pagination cursor.",
              ),
            );
        }
        const millis = timestampMillisFromFirestoreField(
          cursorSnap.get("timestamp"),
        );
        if (millis === null) {
          return res
            .status(400)
            .json(
              newErrorResponse(
                "Invalid Request",
                "Invalid pagination cursor timestamp.",
              ),
            );
        }
        q = startLoginHistoryAfterCompound(q, millis, cursorSnap.id);
      }
    }

    const peek = limitNum + 1;
    const snapshot = await q.limit(peek).get();
    const hasMore = snapshot.docs.length > limitNum;
    const pageDocs = hasMore
      ? snapshot.docs.slice(0, limitNum)
      : snapshot.docs;

    const history = pageDocs.map((doc) => {
      const data = doc.data();
      let timestamp: string;

      if (data.timestamp) {
        if (data.timestamp.toDate) {
          timestamp = data.timestamp.toDate().toISOString();
        } else if (data.timestamp instanceof Date) {
          timestamp = data.timestamp.toISOString();
        } else if (data.timestamp.seconds) {
          timestamp = new Date(data.timestamp.seconds * 1000).toISOString();
        } else {
          timestamp = new Date(data.timestamp).toISOString();
        }
      } else {
        timestamp = new Date().toISOString();
      }

      return {
        id: doc.id,
        device: data.device || "Unknown",
        browser: data.browser || "Unknown",
        os: data.os || "Unknown",
        ip: data.ip || "Unknown",
        country:
          typeof data.country === "string" && data.country.trim()
            ? data.country.trim()
            : null,
        state:
          typeof data.state === "string" && data.state.trim()
            ? data.state.trim()
            : null,
        timestamp,
      };
    });

    const lastSnap =
      hasMore && pageDocs.length > 0
        ? pageDocs[pageDocs.length - 1]
        : null;
    const lastMillis = lastSnap
      ? timestampMillisFromFirestoreField(lastSnap.get("timestamp"))
      : null;
    const nextCursor =
      hasMore && lastSnap && lastMillis !== null
        ? encodeLoginHistoryCursor(lastMillis, lastSnap.id)
        : null;

    return res.status(200).json(
      newSuccessResponse("Device History", "Retrieved successfully", {
        sessions: history,
        nextCursor,
        limit: limitNum,
      }),
    );
  } catch (err) {
    console.error("Get Device History Error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Fetch Failed",
          "Unable to fetch device history. Please contact support."
        )
      );
  }
}

export async function deleteDeviceHistory(req: Request, res: Response) {
  try {
    if (!req.userID) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "You must be logged in."));
    }

    const { id } = req.params;
    if (!id) {
      return res
        .status(400)
        .json(newErrorResponse("Invalid Request", "ID is required"));
    }

    const userResult = await getUserByUserId(req.userID, res);
    if (!userResult) return;

    await userResult.doc.ref
      .collection("login_history")
      .doc(id)
      .delete();

    return res
      .status(200)
      .json(
        newSuccessResponse("Deleted", "Device history record deleted", null)
      );
  } catch (err) {
    console.error("Delete Device History Error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Delete Failed",
          "Unable to delete history record. Please contact support."
        )
      );
  }
}
