import type { Request, Response, NextFunction } from "express";
import { newErrorResponse } from "../utils/apiResponse.ts";

/**
 * Middleware to authenticate admin requests for notification broadcasting.
 * It checks for a secret token in the 'X-Notification-Secret' header
 * and validates it against the NOTIFICATION_ADMIN_SECRET environment variable.
 */
export const notificationAdminAuth = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const adminSecret = process.env.NOTIFICATION_ADMIN_SECRET;
  const requestSecret = req.headers["x-notification-secret"];

  // 1. Check if the secret is configured on the server
  if (!adminSecret)
    return res
      .status(500)
      .json(newErrorResponse("Server Error", "Server configuration error."));

  // 2. If the header is present and matches the secret, proceed. Otherwise, block.
  if (requestSecret === adminSecret) return next();

  res
    .status(403)
    .json(newErrorResponse("Forbidden", "Invalid or missing admin secret."));
};
