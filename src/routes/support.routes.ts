import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { uploadSupportFiles, submitSupportTicket } from "../controllers/support.controller.ts";
import { strictRateLimiter } from "../middlewares/rateLimiter.middleware.ts";

const supportRouter: ExpressRouter = Router();

/**
 * @openapi
 * /api/v1/support/ticket:
 *   post:
 *     summary: Submit a support ticket
 *     description: Submit a support request with optional file attachments. Sends an email to support team with replyTo set to the user's email.
 *     tags:
 *       - Support
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: John Doe
 *                 description: Your name
 *               email:
 *                 type: string
 *                 format: email
 *                 example: john@example.com
 *                 description: Your email address
 *               subject:
 *                 type: string
 *                 example: Need help with proposal generation
 *                 description: Subject of your support request
 *               message:
 *                 type: string
 *                 example: I'm having trouble generating proposals with the AI. It keeps timing out.
 *                 description: Your support message
 *               attachments:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: Attachments (images, documents, videos). Max 5 files, 5MB per file, 10MB total.
 *             required:
 *               - name
 *               - email
 *               - message
 *     responses:
 *       200:
 *         description: Support request submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Support Request Submitted
 *                 data:
 *                   type: object
 *                   properties:
 *                     messageId:
 *                       type: string
 *                       example: "<message-id>"
 *                     attachmentsCount:
 *                       type: number
 *                       example: 2
 *       400:
 *         description: Invalid request or file validation failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: File Validation Failed
 *                 error:
 *                   type: string
 *                   example: "screenshot.png: Exceeds 2MB limit for image files"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Email Error
 *                 error:
 *                   type: string
 *                   example: Failed to send support email
 */

supportRouter.post(
  "/ticket",
  strictRateLimiter(),
  uploadSupportFiles,
  submitSupportTicket
);

export default supportRouter;

