import type { Request, Response } from "express";
import { newErrorResponse, newSuccessResponse } from "../utils/apiResponse.ts";
import {
  getAnalyticsOverview,
  getOptimizationAnalytics,
  getProposalsAnalytics,
  getResumesAnalytics,
  getUserAnalytics,
} from "../services/analyticsInsights.service.ts";

export async function analyticsOverviewController(req: Request, res: Response) {
  try {
    const { from, to } = req.query;
    const data = await getAnalyticsOverview(from as string | undefined, to as string | undefined);
    return res.status(200).json(newSuccessResponse("Analytics Overview", "Overview metrics fetched", data));
  } catch {
    return res.status(500).json(newErrorResponse("Internal Server Error", "Failed to fetch overview metrics"));
  }
}

export async function analyticsUsersController(req: Request, res: Response) {
  try {
    const { from, to } = req.query;
    const data = await getUserAnalytics(from as string | undefined, to as string | undefined);
    return res.status(200).json(newSuccessResponse("User Analytics", "User metrics fetched", data));
  } catch {
    return res.status(500).json(newErrorResponse("Internal Server Error", "Failed to fetch user metrics"));
  }
}

export async function analyticsProposalsController(req: Request, res: Response) {
  try {
    const { from, to } = req.query;
    const data = await getProposalsAnalytics(from as string | undefined, to as string | undefined);
    return res.status(200).json(newSuccessResponse("Proposal Analytics", "Proposal metrics fetched", data));
  } catch {
    return res.status(500).json(newErrorResponse("Internal Server Error", "Failed to fetch proposal metrics"));
  }
}

export async function analyticsOptimizationController(req: Request, res: Response) {
  try {
    const { from, to } = req.query;
    const data = await getOptimizationAnalytics(from as string | undefined, to as string | undefined);
    return res.status(200).json(newSuccessResponse("Optimization Analytics", "Optimization metrics fetched", data));
  } catch {
    return res.status(500).json(newErrorResponse("Internal Server Error", "Failed to fetch optimization metrics"));
  }
}

export async function analyticsResumesController(req: Request, res: Response) {
  try {
    const { from, to } = req.query;
    const data = await getResumesAnalytics(from as string | undefined, to as string | undefined);
    return res.status(200).json(newSuccessResponse("Resume Analytics", "Resume metrics fetched", data));
  } catch {
    return res.status(500).json(newErrorResponse("Internal Server Error", "Failed to fetch resume metrics"));
  }
}

