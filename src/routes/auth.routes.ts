import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { strictRateLimiter } from "../middlewares/rateLimiter.middleware.ts";
import { authMiddleware } from "../middlewares/auth.middleware.ts";
import {
  login,
  logout,
  signupOrEnsureUser,
  updateUsername,
  updateProfile,
  verifySession,
  verifyEmail,
  resendVerificationOTP,
  updateProviders,
} from "../controllers/auth.controller.ts";

const authRouter: ExpressRouter = Router();

/**
 * @openapi
 * /api/v1/auth/signup:
 *   post:
 *     summary: Signup or ensure user
 *     description: Verifies Firebase ID token, creates or retrieves user profile, sets session cookie.
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               idToken:
 *                 type: string
 *                 description: Firebase ID token from client
 *             required:
 *               - idToken
 *     responses:
 *       200:
 *         description: Signup/Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Error response (any error)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
authRouter.post("/signup", strictRateLimiter(), signupOrEnsureUser);

/**
 * @openapi
 * /api/v1/auth/login:
 *   post:
 *     summary: User login
 *     description: Authenticates user with Firebase ID token and creates session cookie
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               idToken:
 *                 type: string
 *                 description: Firebase ID token from client
 *             required:
 *               - idToken
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Error response (any error)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
authRouter.post("/login", strictRateLimiter(), login);

/**
 * @openapi
 * /api/v1/auth/verify:
 *   get:
 *     summary: Verify user session
 *     description: Verifies the current user session and returns user info
 *     tags:
 *       - Auth
 *     responses:
 *       200:
 *         description: Session valid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         description: Unauthorized or invalid session
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
authRouter.get("/verify", verifySession);

/**
 * @openapi
 * /api/v1/auth/logout:
 *   post:
 *     summary: User logout
 *     description: Logs out the user by clearing the session cookie
 *     tags:
 *       - Auth
 *     responses:
 *       200:
 *         description: Logout successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 */
authRouter.post("/logout", logout);

/**
 * @openapi
 * /api/v1/auth/update-username:
 *   put:
 *     summary: Update user username
 *     description: Updates the user's display name/username. First-time users (those without a display name) will be automatically subscribed to the mailing list.
 *     tags:
 *       - Auth
 *     security:
 *       - sessionCookie: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *                 description: New username (3-32 characters, alphanumeric, underscores, hyphens, spaces allowed)
 *                 minLength: 3
 *                 maxLength: 32
 *                 pattern: '^[a-zA-Z0-9_\- ]+$'
 *             required:
 *               - username
 *     responses:
 *       200:
 *         description: Username updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Invalid username format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Rate limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
authRouter.put(
  "/update-username",
  strictRateLimiter(),
  authMiddleware,
  updateUsername
);

/**
 * @swagger
 * /api/v1/auth/update-profile:
 *   put:
 *     summary: Update user profile
 *     description: Updates the user's profile link and/or professional title
 *     tags:
 *       - Auth
 *     security:
 *       - sessionCookie: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               portfolio_link:
 *                 type: string
 *                 format: uri
 *                 description: Portfolio URL (must start with http:// or https://)
 *                 example: "https://example.com/portfolio"
 *               professional_title:
 *                 type: string
 *                 maxLength: 200
 *                 description: User's professional title (e.g., "Full Stack Developer")
 *                 example: "Full Stack Developer"
 *             description: At least one field must be provided
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         userId:
 *                           type: string
 *                         email:
 *                           type: string
 *                         displayName:
 *                           type: string
 *                           nullable: true
 *                         tierId:
 *                           type: string
 *                         polarId:
 *                           type: string
 *                           nullable: true
 *                         mailerliteId:
 *                           type: string
 *                           nullable: true
 *                         portfolioLink:
 *                           type: string
 *                           nullable: true
 *                           description: Portfolio URL (camelCase)
 *                         professionalTitle:
 *                           type: string
 *                           nullable: true
 *                           description: Professional title (camelCase)
 *                         createdAt:
 *                           type: string
 *                           format: date-time
 *                           nullable: true
 *                         updatedAt:
 *                           type: string
 *                           format: date-time
 *                           nullable: true
 *       400:
 *         description: Invalid input or missing fields
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 *       429:
 *         description: Rate limit exceeded
 */
authRouter.put(
  "/update-profile",
  strictRateLimiter(),
  authMiddleware,
  updateProfile
);

/**
 * @swagger
 * /api/v1/auth/verify-email:
 *   post:
 *     summary: Verify email with OTP
 *     description: Verifies the user's email address using the OTP code sent to their email
 *     tags:
 *       - Auth
 *     security:
 *       - sessionCookie: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               otp:
 *                 type: string
 *                 description: 6-digit OTP code received via email
 *                 example: "123456"
 *                 minLength: 6
 *                 maxLength: 6
 *             required:
 *               - otp
 *     responses:
 *       200:
 *         description: Email verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Invalid OTP, expired OTP, or already verified
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 *       429:
 *         description: Rate limit exceeded
 */
authRouter.post(
  "/verify-email",
  strictRateLimiter(),
  authMiddleware,
  verifyEmail
);

/**
 * @swagger
 * /api/v1/auth/resend-verification-otp:
 *   post:
 *     summary: Resend verification OTP
 *     description: Resends a new OTP code to the user's email address
 *     tags:
 *       - Auth
 *     security:
 *       - sessionCookie: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Verification code sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Email already verified
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 *       429:
 *         description: Rate limit exceeded
 */
authRouter.post(
  "/resend-verification-otp",
  strictRateLimiter(),
  authMiddleware,
  resendVerificationOTP
);

/**
 * @swagger
 * /api/v1/auth/update-providers:
 *   put:
 *     summary: Update user providers
 *     description: Updates the list of authentication providers for the user (e.g. after linking an account)
 *     tags:
 *       - Auth
 *     security:
 *       - sessionCookie: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               providers:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: List of authentication providers (e.g., ["email", "google"])
 *             required:
 *               - providers
 *     responses:
 *       200:
 *         description: Providers updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
authRouter.put(
  "/update-providers",
  strictRateLimiter(),
  authMiddleware,
  updateProviders
);

export default authRouter;
