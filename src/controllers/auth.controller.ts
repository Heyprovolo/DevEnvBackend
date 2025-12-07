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

import type { NewUser, User } from "../types/user.ts";
import type { Request, Response } from "express";
import type { Timestamp } from "firebase-admin/firestore";
import type { DecodedIdToken, UserRecord } from "firebase-admin/auth";
import { NotificationCategory } from "../types/notification.ts";

// Generates a 6-digit OTP code for email verification
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Removes sensitive OTP fields from user object before sending to frontend
function createSafeUserObject(user: User): Omit<User, "otp" | "otpExpires"> {
  const { otp, otpExpires, ...safeUser } = user;
  return safeUser;
}

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
    try {
      cookie = await auth.createSessionCookie(idToken, {
        expiresIn: 5 * 24 * 60 * 60 * 1000,
      });
    } catch (err) {
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
    console.log("isProduction:", isProduction);

    const COOKIE_OPTIONS = {
      maxAge: 5 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      path: "/",
      sameSite: isProduction ? "lax" : "none",
      secure: true,
    } as const;

    console.log("Setting cookie with options:", COOKIE_OPTIONS);

    res.cookie("session", cookie, COOKIE_OPTIONS);

    const usersRef = db.collection("users");
    const userQuery = usersRef.where("userId", "==", token.uid).limit(1);
    const docs = await userQuery.get();

    if (docs.empty || docs.docs.length === 0) {
      return res
        .status(403)
        .json(
          newErrorResponse(
            "Account Setup Required",
            "Your account is not properly set up. Please contact support or sign up again to complete your account setup."
          )
        );
    }

    const doc = docs.docs[0];
    if (!doc) {
      return res
        .status(403)
        .json(
          newErrorResponse(
            "Account Setup Required",
            "Your account is not properly set up. Please contact support or sign up again to complete your account setup."
          )
        );
    }

    const firebaseProvider = token.firebase.sign_in_provider;
    const currentProvider =
      firebaseProvider === "password"
        ? "email"
        : firebaseProvider === "google.com"
        ? "google"
        : firebaseProvider;

    const data = doc.data();
    const providers = data.providers || [];
    if (!providers.includes(currentProvider)) {
      await doc.ref.update({
        providers: [...providers, currentProvider],
        updatedAt: new Date(),
      });
      providers.push(currentProvider);
    }

    const emailVerified = data.emailVerified === true;
    const user: User = {
      id: doc.id,
      userId: data.userId,
      email: data.email,
      displayName: data.displayName || null,
      tierId: data.tierId,
      mailerliteId: data.mailerliteId || null,
      polarId: data.polarId || null,
      portfolioLink: data.portfolioLink || null,
      professionalTitle: data.professionalTitle || null,
      emailVerified,
      otp: data.otp || null,
      otpExpires: data.otpExpires
        ? data.otpExpires instanceof Date
          ? data.otpExpires
          : new Date((data.otpExpires as Timestamp).seconds * 1000)
        : null,
      providers,
      createdAt: data.createdAt
        ? data.createdAt instanceof Date
          ? data.createdAt
          : new Date((data.createdAt as Timestamp).seconds * 1000)
        : undefined,
      updatedAt: data.updatedAt
        ? data.updatedAt instanceof Date
          ? data.updatedAt
          : new Date((data.updatedAt as Timestamp).seconds * 1000)
        : undefined,
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

    const usersRef = db.collection("users");
    const userQuery = usersRef.where("userId", "==", userID).limit(1);
    const docs = await userQuery.get();

    let userData: User | null = null;
    let isNewUser: boolean = false;
    const now: Date = new Date();

    if (!docs.empty && docs.docs.length > 0) {
      // Existing user - retrieve their data
      const existingUserDoc = docs.docs[0];
      if (existingUserDoc) {
        const existingUserData: User = existingUserDoc.data() as User;
        const emailVerified = existingUserData.emailVerified === true;

        const firebaseProvider = decodedUserInfo.firebase.sign_in_provider;
        const currentProvider =
          firebaseProvider === "password"
            ? "email"
            : firebaseProvider === "google.com"
            ? "google"
            : firebaseProvider;

        const providers = existingUserData.providers || [];
        if (!providers.includes(currentProvider)) {
          await existingUserDoc.ref.update({
            providers: [...providers, currentProvider],
            updatedAt: now,
          });
          providers.push(currentProvider);
        }

        userData = {
          id: existingUserDoc.id,
          userId: userID,
          email: userRecord.email!,
          displayName: userRecord.displayName || null,
          tierId: existingUserData.tierId || starterTierId,
          mailerliteId: null,
          polarId: existingUserData.polarId || null,
          portfolioLink: existingUserData.portfolioLink || null,
          professionalTitle: existingUserData.professionalTitle || null,
          emailVerified: existingUserData.emailVerified === true,
          otp: existingUserData.otp || null,
          otpExpires: existingUserData.otpExpires
            ? existingUserData.otpExpires instanceof Date
              ? existingUserData.otpExpires
              : new Date(
                  (existingUserData.otpExpires as Timestamp).seconds * 1000
                )
            : null,
          providers,
          createdAt: existingUserData.createdAt
            ? existingUserData.createdAt instanceof Date
              ? existingUserData.createdAt
              : new Date(
                  (existingUserData.createdAt as Timestamp).seconds * 1000
                )
            : now,
          updatedAt: existingUserData.updatedAt
            ? existingUserData.updatedAt instanceof Date
              ? existingUserData.updatedAt
              : new Date(
                  (existingUserData.updatedAt as Timestamp).seconds * 1000
                )
            : now,
        };
      }
    } else {
      // New user - create account with starter tier and send verification email
      isNewUser = true;
      const otp = generateOTP();
      const otpExpires = new Date(Date.now() + 15 * 60 * 1000);

      const firebaseProvider = decodedUserInfo.firebase.sign_in_provider;
      const currentProvider =
        firebaseProvider === "password"
          ? "email"
          : firebaseProvider === "google.com"
          ? "google"
          : firebaseProvider;

      const newUserData: NewUser = {
        userId: userID,
        email: userRecord.email!,
        displayName: userRecord.displayName || null,
        tierId: starterTierId,
        mailerliteId: null,
        polarId: null,
        portfolioLink: null,
        professionalTitle: null,
        emailVerified: false,
        otp,
        otpExpires,
        providers: [currentProvider],
        createdAt: now,
        updatedAt: now,
      };

      const docRef = await usersRef.add(newUserData);
      userData = {
        id: docRef.id,
        ...newUserData,
      };

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

      // Send welcome notification
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

    let cookie;
    try {
      cookie = await auth.createSessionCookie(idToken, {
        expiresIn: 5 * 24 * 60 * 60 * 1000,
      });
    } catch (err) {
      console.error("Signup Error:", err);
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
    console.log("isProduction:", isProduction);

    const COOKIE_OPTIONS = {
      maxAge: 5 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      path: "/",
      sameSite: isProduction ? "lax" : "none",
      secure: true,
    } as const;

    console.log("Setting cookie with options:", COOKIE_OPTIONS);
    res.cookie("session", cookie, COOKIE_OPTIONS);

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
    const db = getFirestore(app);

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

    const usersRef = db.collection("users");
    const userQuery = usersRef
      .where("userId", "==", decodedUserInfo.uid)
      .limit(1);
    const docs = await userQuery.get();
    const doc = docs.docs[0];
    if (!doc) {
      return res
        .status(403)
        .json(
          newErrorResponse(
            "Account Setup Required",
            "Your account is not properly set up. Please contact support or sign up again to complete your account setup."
          )
        );
    }
    const data = doc.data();
    const emailVerified = data.emailVerified === true;
    const user: User = {
      id: doc.id,
      userId: data.userId,
      email: data.email,
      displayName: data.displayName || null,
      tierId: data.tierId,
      polarId: data.polarId || null,
      mailerliteId: data.mailerliteId || null,
      portfolioLink: data.portfolioLink || null,
      professionalTitle: data.professionalTitle || null,
      emailVerified,
      otp: data.otp || null,
      otpExpires: data.otpExpires
        ? data.otpExpires instanceof Date
          ? data.otpExpires
          : new Date((data.otpExpires as Timestamp).seconds * 1000)
        : null,
      providers: data.providers || [],
      createdAt: data.createdAt
        ? data.createdAt instanceof Date
          ? data.createdAt
          : new Date((data.createdAt as Timestamp).seconds * 1000)
        : undefined,
      updatedAt: data.updatedAt
        ? data.updatedAt instanceof Date
          ? data.updatedAt
          : new Date((data.updatedAt as Timestamp).seconds * 1000)
        : undefined,
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

    if (
      !username ||
      typeof username !== "string" ||
      username.length < 3 ||
      !/^[a-zA-Z0-9_\- ]+$/.test(username) ||
      username.startsWith("-") ||
      username.endsWith("-") ||
      username.startsWith(" ") ||
      username.endsWith(" ") ||
      username.includes("--") ||
      username.includes("__")
    ) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Invalid Username",
            "Username must be at least 3, use only letters, numbers, underscores, hyphens, or spaces, cannot start or end with hyphens or spaces, and cannot contain consecutive hyphens or consecutive underscores."
          )
        );
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

    let userDoc;
    try {
      const usersRef = db.collection("users");
      const userQuery = usersRef.where("userId", "==", req.userID).limit(1);
      const docs = await userQuery.get();

      if (docs.empty || !docs.docs[0]) {
        return res
          .status(404)
          .json(
            newErrorResponse(
              "User Not Found",
              "Your user record could not be found. Please contact support."
            )
          );
      }

      userDoc = docs.docs[0];
      await userDoc.ref.update({ displayName: username });
    } catch (firestoreErr) {
      console.error("Firestore update error:", firestoreErr);
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Database Update Failed",
            "Unable to update your username in our database. Please contact support."
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
      const usersRef = db.collection("users");
      const userQuery = usersRef.where("userId", "==", req.userID).limit(1);
      const docs = await userQuery.get();

      if (docs.empty || !docs.docs[0]) {
        throw new Error("User document not found after username update.");
      }

      const userDoc = docs.docs[0];
      const userData = userDoc.data();

      const user: User = {
        id: userDoc.id,
        userId: userData.userId,
        email: userData.email,
        displayName: userData.displayName || null,
        tierId: userData.tierId,
        polarId: userData.polarId || null,
        mailerliteId: userData.mailerliteId || null,
        portfolioLink: userData.portfolioLink || null,
        professionalTitle: userData.professionalTitle || null,
        emailVerified: userData.emailVerified === true,
        otp: userData.otp || null,
        otpExpires: userData.otpExpires
          ? userData.otpExpires instanceof Date
            ? userData.otpExpires
            : new Date((userData.otpExpires as Timestamp).seconds * 1000)
          : null,
        providers: userData.providers || [],
        createdAt: userData.createdAt
          ? userData.createdAt instanceof Date
            ? userData.createdAt
            : new Date((userData.createdAt as Timestamp).seconds * 1000)
          : undefined,
        updatedAt: userData.updatedAt
          ? userData.updatedAt instanceof Date
            ? userData.updatedAt
            : new Date((userData.updatedAt as Timestamp).seconds * 1000)
          : undefined,
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

    const app = getFirebaseApp();
    const db = getFirestore(app);
    const usersRef = db.collection("users");
    const userQuery = usersRef.where("userId", "==", req.userID).limit(1);
    const docs = await userQuery.get();

    if (docs.empty || !docs.docs[0]) {
      return res
        .status(404)
        .json(
          newErrorResponse(
            "User Not Found",
            "Your user record could not be found. Please contact support."
          )
        );
    }

    const userDoc = docs.docs[0];
    await userDoc.ref.update({
      providers,
      updatedAt: new Date(),
    });

    const userData = userDoc.data();
    const user: User = {
      id: userDoc.id,
      userId: userData.userId,
      email: userData.email,
      displayName: userData.displayName || null,
      tierId: userData.tierId,
      polarId: userData.polarId || null,
      mailerliteId: userData.mailerliteId || null,
      portfolioLink: userData.portfolioLink || null,
      professionalTitle: userData.professionalTitle || null,
      emailVerified: userData.emailVerified === true,
      otp: userData.otp || null,
      otpExpires: userData.otpExpires
        ? userData.otpExpires instanceof Date
          ? userData.otpExpires
          : new Date((userData.otpExpires as Timestamp).seconds * 1000)
        : null,
      providers, // Use the updated providers
      createdAt: userData.createdAt
        ? userData.createdAt instanceof Date
          ? userData.createdAt
          : new Date((userData.createdAt as Timestamp).seconds * 1000)
        : undefined,
      updatedAt: new Date(), // Use the new update time
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
    const db = getFirestore(app);
    const now = new Date();

    const usersRef = db.collection("users");
    const userQuery = usersRef.where("userId", "==", req.userID).limit(1);
    const docs = await userQuery.get();

    if (docs.empty || !docs.docs[0]) {
      return res
        .status(404)
        .json(
          newErrorResponse(
            "User Not Found",
            "Your user record could not be found. Please contact support."
          )
        );
    }

    const userDoc = docs.docs[0];
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
      const userData = userDoc.data();
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

    const updatedDocs = await userQuery.get();
    const updatedUserDoc = updatedDocs.docs[0];

    if (!updatedUserDoc) {
      return res
        .status(404)
        .json(
          newErrorResponse(
            "User Not Found",
            "Your user record could not be found after update. Please contact support."
          )
        );
    }

    const userData = updatedUserDoc.data();

    const user: User = {
      id: updatedUserDoc.id,
      userId: userData.userId,
      email: userData.email,
      displayName: userData.displayName || null,
      tierId: userData.tierId,
      polarId: userData.polarId || null,
      mailerliteId: userData.mailerliteId || null,
      portfolioLink: userData.portfolioLink || null,
      professionalTitle: userData.professionalTitle || null,
      emailVerified: userData.emailVerified === true,
      otp: userData.otp || null,
      otpExpires: userData.otpExpires
        ? userData.otpExpires instanceof Date
          ? userData.otpExpires
          : new Date((userData.otpExpires as Timestamp).seconds * 1000)
        : null,
      providers: userData.providers || [],
      createdAt: userData.createdAt
        ? userData.createdAt instanceof Date
          ? userData.createdAt
          : new Date((userData.createdAt as Timestamp).seconds * 1000)
        : undefined,
      updatedAt: userData.updatedAt
        ? userData.updatedAt instanceof Date
          ? userData.updatedAt
          : new Date((userData.updatedAt as Timestamp).seconds * 1000)
        : undefined,
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
    const db = getFirestore(app);
    const now = new Date();

    const usersRef = db.collection("users");
    const userQuery = usersRef.where("userId", "==", req.userID).limit(1);
    const docs = await userQuery.get();

    if (docs.empty || !docs.docs[0]) {
      return res
        .status(404)
        .json(
          newErrorResponse(
            "User Not Found",
            "Your user record could not be found. Please contact support."
          )
        );
    }

    const userDoc = docs.docs[0];
    const userData = userDoc.data();

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

    const otpExpires = userData.otpExpires
      ? userData.otpExpires instanceof Date
        ? userData.otpExpires
        : new Date((userData.otpExpires as Timestamp).seconds * 1000)
      : null;

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

    await userDoc.ref.update({
      emailVerified: true,
      otp: null,
      otpExpires: null,
      updatedAt: now,
    });

    const updatedDocs = await userQuery.get();
    const updatedUserDoc = updatedDocs.docs[0];

    if (!updatedUserDoc) {
      return res
        .status(404)
        .json(
          newErrorResponse(
            "User Not Found",
            "Your user record could not be found after verification. Please contact support."
          )
        );
    }

    const updatedData = updatedUserDoc.data();
    const user: User = {
      id: updatedUserDoc.id,
      userId: updatedData.userId,
      email: updatedData.email,
      displayName: updatedData.displayName || null,
      tierId: updatedData.tierId,
      polarId: updatedData.polarId || null,
      mailerliteId: updatedData.mailerliteId || null,
      portfolioLink: updatedData.portfolioLink || null,
      professionalTitle: updatedData.professionalTitle || null,
      emailVerified: true,
      otp: null,
      otpExpires: null,
      providers: updatedData.providers || [],
      createdAt: updatedData.createdAt
        ? updatedData.createdAt instanceof Date
          ? updatedData.createdAt
          : new Date((updatedData.createdAt as Timestamp).seconds * 1000)
        : undefined,
      updatedAt: updatedData.updatedAt
        ? updatedData.updatedAt instanceof Date
          ? updatedData.updatedAt
          : new Date((updatedData.updatedAt as Timestamp).seconds * 1000)
        : undefined,
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

    const usersRef = db.collection("users");
    const userQuery = usersRef.where("userId", "==", req.userID).limit(1);
    const docs = await userQuery.get();

    if (docs.empty || !docs.docs[0]) {
      return res
        .status(404)
        .json(
          newErrorResponse(
            "User Not Found",
            "Your user record could not be found. Please contact support."
          )
        );
    }

    const userDoc = docs.docs[0];
    const userData = userDoc.data();

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
