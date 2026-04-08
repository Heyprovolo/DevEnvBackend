import type { Request, Response } from "express";
import { z } from "zod";
import { newErrorResponse, newSuccessResponse } from "../utils/apiResponse.ts";
import { createAdminSession, verifyAdminCredentials } from "../services/adminAuth.service.ts";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(256),
});

export async function adminLoginController(req: Request, res: Response) {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(newErrorResponse("Invalid Request", "Email and password are required"));
    }

    const admin = await verifyAdminCredentials(parsed.data.email, parsed.data.password);
    if (!admin) {
      return res.status(401).json(newErrorResponse("Unauthorized", "Invalid admin credentials"));
    }

    const session = await createAdminSession(admin);
    return res.status(200).json(
      newSuccessResponse("Admin Login Successful", "Authenticated", {
        token: session.token,
        expiresAt: session.expiresAt,
        role: session.role,
        email: session.email,
      })
    );
  } catch (error) {
    console.error("admin_login_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json(newErrorResponse("Internal Server Error", "Failed to authenticate admin"));
  }
}

