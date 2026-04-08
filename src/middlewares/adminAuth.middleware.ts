import type { NextFunction, Request, Response } from "express";
import { newErrorResponse } from "../utils/apiResponse.ts";
import { getAdminSession } from "../services/adminAuth.service.ts";

declare global {
  namespace Express {
    interface Request {
      adminUserId?: string;
      adminEmail?: string;
      adminRole?: string;
    }
  }
}

export async function adminAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json(newErrorResponse("Unauthorized", "Missing admin authorization token"));
  }
  const token = header.replace("Bearer ", "").trim();
  if (!token) {
    return res.status(401).json(newErrorResponse("Unauthorized", "Missing admin authorization token"));
  }

  let session = null;
  try {
    session = await getAdminSession(token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("RESOURCE_EXHAUSTED")) {
      return res
        .status(503)
        .json(newErrorResponse("Service Unavailable", "Auth service is temporarily unavailable"));
    }
    throw error;
  }
  if (!session) {
    return res.status(401).json(newErrorResponse("Unauthorized", "Invalid or expired admin session"));
  }

  req.adminUserId = session.adminUserId;
  req.adminEmail = session.email;
  req.adminRole = session.role;
  next();
}

