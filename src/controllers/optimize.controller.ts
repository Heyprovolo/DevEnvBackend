import type { Request, Response } from "express";
import { validateProposalRefineInstruction } from "../utils/proposalInputGuard.ts";
import { validateRefineInstruction } from "../utils/refineInstructionGuard.ts";
import {
  optimizerPrompt,
  optimizerSystemInstruction,
  linkedinOptimizerPrompt,
  linkedinOptimizerSystemInstruction,
  proposalPrompt,
  formatOptimizerProfileContext,
  proposalSystemInstruction,
  storeProposalHistory,
  getUserProposalHistory,
  getProposalById,
  refineProposalPrompt,
  refineProposalSystemInstruction,
  getLatestProposalVersion,
  storeRefinement,
  getProposalVersions,
  createProposalMDX,
  validateProposalResponse,
  storeOptimizerHistory,
  storeOptimizerRefinement,
  getUserOptimizerHistory,
  getOptimizerHistoryById,
  cleanupOldOptimizerHistory,
  getLatestOptimizerVersion,
  getOptimizerVersionChain,
  countOptimizerRefinementsForRoot,
  resolveOptimizerRootId,
  truncateInstructionLabel,
  refineProfilePrompt,
  refineProfileSystemInstruction,
  STARTER_REFINEMENTS_PER_ROOT,
} from "../utils/prompt.utils.ts";
import { updateUserQuota, checkUserQuota } from "../utils/quota.utils.ts";
import type { FeatureSlug } from "../types/tiers.ts";
import { callGemini } from "../utils/geminiClient.ts";
import {
  SystemOverrideError,
  ValidationError,
} from "../utils/responseValidator.ts";
import { newErrorResponse, newSuccessResponse } from "../utils/apiResponse.ts";
import type {
  ProposalReq,
  ProposalResponse,
  AIErrorResponse,
  ProposalHistoryReq,
  RefineProposalReq,
  RefinementAction,
} from "../types/proposal.types.ts";
import { REFINEMENT_LABELS } from "../types/proposal.types.ts";
import { getFirestore } from "firebase-admin/firestore";
import { getFirebaseApp } from "../utils/getFirebaseApp.ts";
import type {
  OptimizerType,
  RefineProfileReq,
  OptimizerTargetSection,
  OptimizerResponseSections,
} from "../types/optimizer-history.ts";
import { sendNotificationToUser } from "../services/notification.service.ts";
import { NotificationCategory } from "../types/notification.ts";
import {
  tagObservedError,
  timedDb,
  timedExternal,
} from "../middlewares/observability.middleware.ts";

function observeControllerError(
  req: Request,
  category: "internal_failure" | "external_api_error",
  fallbackType: string,
  fallbackMessage: string,
  error: unknown,
) {
  const observed: {
    category: "internal_failure" | "external_api_error";
    type: string;
    message: string;
    stack?: string;
  } = {
    category,
    type: error instanceof Error ? error.name : fallbackType,
    message: error instanceof Error ? error.message : fallbackMessage,
  };
  if (error instanceof Error && error.stack) observed.stack = error.stack;
  tagObservedError(req, observed);
}

// Helper function to get user profile data (displayName, portfolioLink, professionalTitle) in one DB call
async function getUserProfileData(
  userId: string,
  tokenDisplayName?: string,
): Promise<{
  displayName: string | undefined;
  portfolioLink: string | null;
  professionalTitle: string | null;
  tierId: string | null;
}> {
  // Use displayName from token if available
  if (tokenDisplayName) {
    try {
      const app = getFirebaseApp();
      const db = getFirestore(app);
      const userSnap = await db
        .collection("users")
        .where("userId", "==", userId)
        .limit(1)
        .get();

      if (!userSnap.empty && userSnap.docs[0]) {
        const userData = userSnap.docs[0].data();
        return {
          displayName: tokenDisplayName,
          portfolioLink: userData.portfolioLink || null,
          professionalTitle: userData.professionalTitle || null,
          tierId: userData.tierId || null,
        };
      }
    } catch (err) {
      console.error(
        "[getUserProfileData] Error fetching user profile data:",
        err,
      );
    }
    return {
      displayName: tokenDisplayName,
      portfolioLink: null,
      professionalTitle: null,
      tierId: null,
    };
  }

  // Fetch all data from database if displayName not in token
  try {
    const app = getFirebaseApp();
    const db = getFirestore(app);
    const userSnap = await db
      .collection("users")
      .where("userId", "==", userId)
      .limit(1)
      .get();

    if (!userSnap.empty && userSnap.docs[0]) {
      const userData = userSnap.docs[0].data();
      return {
        displayName: userData.displayName,
        portfolioLink: userData.portfolioLink || null,
        professionalTitle: userData.professionalTitle || null,
        tierId: userData.tierId || null,
      };
    }
  } catch (err) {
    console.error(
      "[getUserProfileData] Error fetching user profile data:",
      err,
    );
  }

  return {
    displayName: undefined,
    portfolioLink: null,
    professionalTitle: null,
    tierId: null,
  };
}

interface PromptReq {
  full_name: string;
  professional_title: string;
  profile: string;
}

function isUnlimitedRefineTier(tierId: string | null): boolean {
  const starterTierId = process.env.STARTER_TIER_ID || "starter";
  return !!tierId && tierId !== starterTierId;
}

async function persistOptimizerRootRun(
  userId: string,
  optimizerType: OptimizerType,
  sanitizedFullName: string,
  sanitizedTitle: string,
  sanitizedProfile: string,
  parsedResponse: OptimizerResponseSections,
): Promise<string> {
  return storeOptimizerHistory({
    userId,
    optimizerType,
    originalInput: {
      fullName: sanitizedFullName,
      professionalTitle: sanitizedTitle,
      content: sanitizedProfile,
    },
    response: parsedResponse,
  });
}

export async function optimizeProfile(req: Request, res: Response) {
  try {
    // 1. Get user ID from auth middleware
    const userId = req.userID as string;
    if (!userId) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));
    }

    // 2. Validate input first (fast, no DB calls)
    const { full_name, professional_title, profile } = req.body as PromptReq;
    if (!full_name || !professional_title || !profile) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Invalid Request",
            "Missing required fields: full_name, professional_title, profile",
          ),
        );
    }
    if (
      full_name.length > 100 ||
      professional_title.length > 200 ||
      profile.length > 5000
    ) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Validation Error",
            "Input fields exceed allowed length.",
          ),
        );
    }

    // 3. Check quota
    let quotaResult;
    try {
      quotaResult = await timedDb(req, () =>
        checkUserQuota(userId, "upwork_profile_optimizer"),
      );
      console.log("Quota result for user", userId, ":", quotaResult);
    } catch (err: any) {
      console.error("[optimizeProfile] Quota check error:", err);
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Internal Server Error",
            "An error occurred. Please try again or contact support.",
          ),
        );
    }
    if (!quotaResult.allowed) {
      const limitText =
        quotaResult.limit === -1 ? "unlimited" : quotaResult.limit.toString();
      return res
        .status(429)
        .json(
          newErrorResponse(
            "Quota Exceeded",
            `You’ve used up your available ${quotaResult.period} quota. Please try again later or upgrade your plan. Current usage: ${quotaResult.count}/${limitText}.`,
          ),
        );
    }

    // 4. Sanitize input (simple trim)
    const sanitizedFullName = full_name.trim();
    const sanitizedTitle = professional_title.trim();
    const sanitizedProfile = profile.trim();

    const inputContent = `Freelancer Name: ${sanitizedFullName}\nTitle: ${sanitizedTitle}\n\n Profile Description:\n${sanitizedProfile}`;
    const content = optimizerPrompt(inputContent);

    // 5. Call AI model (replace with your actual AI call)
    let aiResponseText = "";
    try {
      aiResponseText = await timedExternal(req, () =>
        callGemini(content, optimizerSystemInstruction()),
      );
    } catch (err: any) {
      console.error("[optimizeProfile] AI service call failed:", err);
      observeControllerError(
        req,
        "external_api_error",
        "ExternalApiError",
        "AI service call failed",
        err,
      );

      // If system override detected, deduct quota and return specific error
      if (err instanceof SystemOverrideError) {
        try {
          await updateUserQuota(userId, "upwork_profile_optimizer");
        } catch (quotaErr) {
          console.warn(
            "Warning: Failed to update quota after system override error for user",
            userId,
            quotaErr,
          );
        }

        return res
          .status(400)
          .json(
            newErrorResponse(
              "Invalid Request",
              "The prompt attempted to do something it shouldn't. Your quota has been deducted.",
            ),
          );
      }

      // If validation error (400-level), return 400 status
      if (err instanceof ValidationError) {
        return res
          .status(400)
          .json(
            newErrorResponse(
              "Validation Error",
              err.message ||
                "Invalid request. Please check your input and try again.",
            ),
          );
      }

      return res
        .status(500)
        .json(
          newErrorResponse(
            "AI Service Error",
            "An error occurred. Please try again or contact support.",
          ),
        );
    }

    // 6. Parse AI response
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(aiResponseText);
    } catch (err) {
      console.error(
        "[optimizeProfile] Unexpected JSON parse failure after validation:",
        err instanceof Error ? err.message : String(err),
        "Response text:",
        aiResponseText.substring(0, 500) + "...",
      );
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Processing Error",
            "Invalid JSON response from AI. Please try again, or contact support if the issue persists. Your quota has not been deducted.",
          ),
        );
    }

    // 7. Update quota in background (fire and forget - don't block response)
    updateUserQuota(userId, "upwork_profile_optimizer").catch((err) => {
      console.warn("Warning: Failed to update quota for user", userId, err);
    });

    // 8. Store optimization history (required for in-app refinement)
    let optimizerRecordId: string | undefined;
    let unlimitedRefine = false;
    try {
      const profileData = await timedDb(req, () =>
        getUserProfileData(userId, req.userDisplayName),
      );
      const userTierId = profileData?.tierId || null;
      unlimitedRefine = isUnlimitedRefineTier(userTierId);

      optimizerRecordId = await timedDb(req, () =>
        persistOptimizerRootRun(
          userId,
          "upwork",
          sanitizedFullName,
          sanitizedTitle,
          sanitizedProfile,
          parsedResponse,
        ),
      );

      const starterTierId = process.env.STARTER_TIER_ID || "starter";
      if (userTierId && userTierId !== starterTierId) {
        try {
          const history = await timedDb(req, () =>
            getUserOptimizerHistory(userId, 1, 1),
          );
          if (history.total <= 1) {
            await sendNotificationToUser(
              userId,
              "Milestone Unlocked: First Optimization!",
              "You've just optimized your first profile. You're a step closer to your goal!",
              "/optimizer",
              NotificationCategory.ACHIEVEMENT,
            );
          }
        } catch (err) {
          console.error(
            "Error checking/sending first optimization notification:",
            err,
          );
        }
      }
    } catch (err) {
      console.warn("Failed to store optimizer history (upwork)", err);
    }

    // 9. Return success with record id for refinement workspace
    return res.status(200).json(
      newSuccessResponse(
        "Optimization Successful",
        "Profile optimized successfully",
        {
          ...parsedResponse,
          optimizerRecordId,
          unlimitedRefine,
          refinementsRemaining: unlimitedRefine
            ? -1
            : STARTER_REFINEMENTS_PER_ROOT,
        },
      ),
    );
  } catch (err) {
    // Top-level catch for any unexpected errors
    console.error("[optimizeProfile] Unhandled error:", err);
    observeControllerError(
      req,
      "internal_failure",
      "OptimizeProfileUnhandledError",
      "Unhandled optimize profile error",
      err,
    );
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "An error occurred. Please try again or contact support.",
        ),
      );
  }
}

export async function optimizeLinkedIn(req: Request, res: Response) {
  try {
    // 1. Get user ID from auth middleware
    const userId = req.userID as string;
    if (!userId) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));
    }

    // 2. Validate input first (fast, no DB calls)
    const { full_name, professional_title, profile } = req.body as PromptReq;
    if (!full_name || !professional_title || !profile) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Invalid Request",
            "Missing required fields: full_name, professional_title, profile",
          ),
        );
    }
    if (
      full_name.length > 100 ||
      professional_title.length > 200 ||
      profile.length > 5000
    ) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Validation Error",
            "Input fields exceed allowed length.",
          ),
        );
    }

    // 3. Check quota
    let quotaResult;
    try {
      quotaResult = await checkUserQuota(userId, "linkedin_profile_optimizer");
      console.log("Quota result for user", userId, ":", quotaResult);
    } catch (err: any) {
      console.error("[optimizeLinkedIn] Quota check error:", err);
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Internal Server Error",
            "An error occurred. Please try again or contact support.",
          ),
        );
    }
    if (!quotaResult.allowed) {
      const limitText =
        quotaResult.limit === -1 ? "unlimited" : quotaResult.limit.toString();
      return res
        .status(429)
        .json(
          newErrorResponse(
            "Quota Exceeded",
            `You’ve used up your available ${quotaResult.period} quota. Please try again later or upgrade your plan. Current usage: ${quotaResult.count}/${limitText}.`,
          ),
        );
    }

    // 4. Sanitize input (simple trim)
    const sanitizedFullName = full_name.trim();
    const sanitizedTitle = professional_title.trim();
    const sanitizedProfile = profile.trim();

    const inputContent = `Professional Name: ${sanitizedFullName}\nTitle: ${sanitizedTitle}\n\n Profile Description:\n${sanitizedProfile}`;
    const content = linkedinOptimizerPrompt(inputContent);

    // 5. Call AI model (replace with your actual AI call)
    let aiResponseText = "";
    try {
      aiResponseText = await callGemini(
        content,
        linkedinOptimizerSystemInstruction(),
      );
    } catch (err: any) {
      console.error("[optimizeLinkedIn] AI service call failed:", err);
      observeControllerError(
        req,
        "external_api_error",
        "LinkedInExternalApiError",
        "AI service call failed",
        err,
      );

      // If system override detected, deduct quota and return specific error
      if (err instanceof SystemOverrideError) {
        try {
          await updateUserQuota(userId, "linkedin_profile_optimizer");
        } catch (quotaErr) {
          console.warn(
            "Warning: Failed to update quota after system override error for user",
            userId,
            quotaErr,
          );
        }

        return res
          .status(400)
          .json(
            newErrorResponse(
              "Invalid Request",
              "The prompt attempted to do something it shouldn't. Your quota has been deducted.",
            ),
          );
      }

      // If validation error (400-level), return 400 status
      if (err instanceof ValidationError) {
        return res
          .status(400)
          .json(
            newErrorResponse(
              "Validation Error",
              err.message ||
                "Invalid request. Please check your input and try again.",
            ),
          );
      }

      return res
        .status(500)
        .json(
          newErrorResponse(
            "AI Service Error",
            "An error occurred. Please try again or contact support.",
          ),
        );
    }

    // 6. Parse AI response
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(aiResponseText);
    } catch (err) {
      console.error(
        "[optimizeLinkedIn] Unexpected JSON parse failure after validation:",
        err instanceof Error ? err.message : String(err),
        "Response text:",
        aiResponseText.substring(0, 500) + "...",
      );
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Processing Error",
            "Invalid JSON response from AI. Please try again, or contact support if the issue persists. Your quota has not been deducted.",
          ),
        );
    }

    // 7. Update quota in background (fire and forget - don't block response)
    updateUserQuota(userId, "linkedin_profile_optimizer").catch((err) => {
      console.warn("Warning: Failed to update quota for user", userId, err);
    });

    // 8. Store optimization history (required for in-app refinement)
    let optimizerRecordId: string | undefined;
    let unlimitedRefine = false;
    try {
      const profileData = await getUserProfileData(userId, req.userDisplayName);
      const userTierId = profileData?.tierId || null;
      unlimitedRefine = isUnlimitedRefineTier(userTierId);

      optimizerRecordId = await persistOptimizerRootRun(
        userId,
        "linkedin",
        sanitizedFullName,
        sanitizedTitle,
        sanitizedProfile,
        parsedResponse,
      );
    } catch (err) {
      console.warn("Failed to store optimizer history (linkedin)", err);
    }

    // 9. Return success with record id for refinement workspace
    return res.status(200).json(
      newSuccessResponse(
        "Optimization Successful",
        "LinkedIn profile optimized successfully",
        {
          ...parsedResponse,
          optimizerRecordId,
          unlimitedRefine,
          refinementsRemaining: unlimitedRefine
            ? -1
            : STARTER_REFINEMENTS_PER_ROOT,
        },
      ),
    );
  } catch (err) {
    // Top-level catch for any unexpected errors
    console.error("[optimizeLinkedIn] Unhandled error:", err);
    observeControllerError(
      req,
      "internal_failure",
      "OptimizeLinkedInUnhandledError",
      "Unhandled optimize LinkedIn error",
      err,
    );
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "An error occurred. Please try again or contact support.",
        ),
      );
  }
}

// Get optimizer history (Upwork / LinkedIn) for authenticated user
export async function getOptimizerHistory(req: Request, res: Response) {
  try {
    const userId = req.userID as string;
    if (!userId) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));
    }

    const {
      page = 1,
      limit = 10,
      search,
      type,
    } = req.query as {
      page?: any;
      limit?: any;
      search?: string;
      type?: OptimizerType;
    };

    const pageNum = parseInt(page.toString(), 10);
    const limitNum = parseInt(limit.toString(), 10);
    if (pageNum < 1 || limitNum < 1 || limitNum > 50) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Invalid Request",
            "Page must be >=1 and limit between 1 and 50",
          ),
        );
    }

    const result = await getUserOptimizerHistory(
      userId,
      pageNum,
      limitNum,
      search,
      type as OptimizerType | undefined,
    );

    return res.status(200).json(
      newSuccessResponse(
        "Optimizer History Retrieved",
        "Optimizer history retrieved successfully",
        {
          records: result.records,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: result.total,
            hasMore: result.hasMore,
          },
        },
      ),
    );
  } catch (err) {
    console.error("[getOptimizerHistory] Error", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "Failed to retrieve optimizer history",
        ),
      );
  }
}

// Get single optimizer history record
export async function getOptimizerHistoryByIdController(
  req: Request,
  res: Response,
) {
  try {
    const userId = req.userID as string;
    if (!userId) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));
    }
    const { recordId } = req.params;
    if (!recordId) {
      return res
        .status(400)
        .json(newErrorResponse("Invalid Request", "Record ID is required"));
    }
    const record = await getOptimizerHistoryById(userId, recordId);
    if (!record) {
      return res
        .status(404)
        .json(
          newErrorResponse("Not Found", "Record not found or access denied"),
        );
    }
    return res
      .status(200)
      .json(
        newSuccessResponse(
          "Record Retrieved",
          "Optimizer record retrieved successfully",
          record,
        ),
      );
  } catch (err) {
    console.error("[getOptimizerHistoryByIdController] Error", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "Failed to retrieve optimizer record",
        ),
      );
  }
}

// Cron cleanup for optimizer history
export async function cleanupOldOptimizerHistoryController(
  req: Request,
  res: Response,
) {
  try {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const provided = req.headers["x-cron-secret"] as string | undefined;
      if (!provided || provided !== secret) {
        return res
          .status(401)
          .json(newErrorResponse("Unauthorized", "Invalid cron secret"));
      }
    }
    const deleted = await cleanupOldOptimizerHistory(30);
    return res.status(200).json(
      newSuccessResponse(
        "Cleanup Completed",
        "Deleted optimizer history older than 30 days",
        {
          deleted,
        },
      ),
    );
  } catch (err) {
    console.error("[cleanupOldOptimizerHistoryController] Error", err);
    return res
      .status(500)
      .json(
        newErrorResponse("Internal Server Error", "Optimizer cleanup failed"),
      );
  }
}

export async function generateProposal(req: Request, res: Response) {
  try {
    // 1. Get user ID from auth middleware
    const userId = req.userID as string;
    if (!userId) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));
    }

    // 2. Validate input first (fast, no DB calls)
    const {
      client_name,
      job_title,
      proposal_tone,
      job_summary,
      optimizer_record_id,
    } = req.body as ProposalReq;
    if (!client_name || !job_title || !proposal_tone || !job_summary) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Invalid Request",
            "Missing required fields: client_name, job_title, proposal_tone, job_summary",
          ),
        );
    }
    if (
      client_name.length > 100 ||
      job_title.length > 200 ||
      job_summary.length > 5000
    ) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Validation Error",
            "Input fields exceed allowed length.",
          ),
        );
    }
    const validTones = ["professional", "conversational", "confident", "calm"];
    if (!validTones.includes(proposal_tone)) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Validation Error",
            "Invalid proposal tone. Must be one of: professional, conversational, confident, calm",
          ),
        );
    }

    // 3. Parallelize quota check and user profile data fetch (both are independent DB calls)
    let quotaResult;
    let profileData;
    try {
      [quotaResult, profileData] = await Promise.all([
        timedDb(req, () => checkUserQuota(userId, "ai_proposals")),
        timedDb(req, () => getUserProfileData(userId, req.userDisplayName)),
      ]);
    } catch (err: any) {
      console.error(
        "[generateProposal] Quota check or profile fetch error:",
        err,
      );
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Internal Server Error",
            "An error occurred. Please try again or contact support.",
          ),
        );
    }

    if (!quotaResult.allowed) {
      const limitText =
        quotaResult.limit === -1 ? "unlimited" : quotaResult.limit.toString();
      return res
        .status(429)
        .json(
          newErrorResponse(
            "Quota Exceeded",
            `Quota limit exceeded for AI proposals. Current usage: ${quotaResult.count}/${limitText}. Try again in the next period.`,
          ),
        );
    }

    // 4. Extract profile data
    const { displayName, portfolioLink, professionalTitle } = profileData;

    // 4b. Optional Profile Optimizer record for role-fit + tailored proposal
    let optimizerProfileContext: string | null = null;
    let sanitizedOptimizerRecordId: string | undefined;
    if (optimizer_record_id?.trim()) {
      sanitizedOptimizerRecordId = optimizer_record_id.trim();
      const optimizerRecord = await timedDb(req, () =>
        getOptimizerHistoryById(userId, sanitizedOptimizerRecordId!),
      );
      if (!optimizerRecord) {
        return res
          .status(404)
          .json(
            newErrorResponse(
              "Not Found",
              "Optimizer profile not found or access denied",
            ),
          );
      }
      optimizerProfileContext = formatOptimizerProfileContext(optimizerRecord);
    }

    // 5. Sanitize input (simple trim)
    const sanitizedClientName = client_name.trim();
    const sanitizedJobTitle = job_title.trim();
    const sanitizedJobSummary = job_summary.trim();

    // Use professional title from profile if available (for context, though job_title is the job being applied for)
    const inputContent = `Client Name: ${sanitizedClientName}\nJob Title: ${sanitizedJobTitle}${
      professionalTitle ? `\nYour Professional Title: ${professionalTitle}` : ""
    }\nProposal Tone: ${proposal_tone}\n\nJob Summary:\n${sanitizedJobSummary}`;
    const content = proposalPrompt(
      inputContent,
      displayName,
      portfolioLink,
      optimizerProfileContext,
    );

    // 5. Call AI model
    let aiResponseText = "";
    try {
      aiResponseText = await timedExternal(req, () =>
        callGemini(content, proposalSystemInstruction()),
      );
    } catch (err: any) {
      console.error("[generateProposal] AI service call failed:", err);
      observeControllerError(
        req,
        "external_api_error",
        "ExternalApiError",
        "AI service call failed",
        err,
      );

      // If system override detected, deduct quota and return specific error
      if (err instanceof SystemOverrideError) {
        try {
          await updateUserQuota(userId, "ai_proposals");
        } catch (quotaErr) {
          console.warn(
            "Warning: Failed to update quota after system override error for user",
            userId,
            quotaErr,
          );
        }

        return res
          .status(400)
          .json(
            newErrorResponse(
              "Invalid Request",
              "The prompt attempted to do something it shouldn't. Your quota has been deducted.",
            ),
          );
      }

      // If validation error (400-level), return 400 status
      if (err instanceof ValidationError) {
        return res
          .status(400)
          .json(
            newErrorResponse(
              "Validation Error",
              err.message ||
                "Invalid request. Please check your input and try again.",
            ),
          );
      }

      return res
        .status(500)
        .json(
          newErrorResponse(
            "AI Service Error",
            "An error occurred. Please try again or contact support.",
          ),
        );
    }

    // 6. Parse AI response
    let parsedResponse: ProposalResponse | AIErrorResponse;
    let proposalResponse: ProposalResponse;

    try {
      parsedResponse = JSON.parse(aiResponseText);

      // Check if AI returned an error response
      if ("error" in parsedResponse && parsedResponse.error === true) {
        observeControllerError(
          req,
          "external_api_error",
          "AiModelBusinessError",
          parsedResponse.message || "AI model returned an error response",
          parsedResponse.message || "AI model returned an error response",
        );
        // Handle different error types
        if (parsedResponse.code === "OUT_OF_SCOPE") {
          return res
            .status(400)
            .json(
              newErrorResponse(
                "Out of Scope",
                parsedResponse.message ||
                  "This type of work is not supported. Please provide a web development related project.",
              ),
            );
        } else if (parsedResponse.code === "INVALID_INPUT") {
          return res
            .status(400)
            .json(
              newErrorResponse(
                "Invalid Input",
                parsedResponse.message ||
                  "The provided information is not valid. Please check your input and try again.",
              ),
            );
        } else if (parsedResponse.code === "CONTENT_TOO_LONG") {
          return res
            .status(400)
            .json(
              newErrorResponse(
                "Content Too Long",
                parsedResponse.message ||
                  "The job description is too long. Please provide a shorter summary.",
              ),
            );
        } else {
          return res
            .status(400)
            .json(
              newErrorResponse(
                "AI Error",
                parsedResponse.message ||
                  "The AI service encountered an error. Please try again.",
              ),
            );
        }
      }

      // At this point, parsedResponse should be a ProposalResponse
      proposalResponse = parsedResponse as ProposalResponse;
    } catch (err) {
      console.error(
        "[generateProposal] Unexpected JSON parse failure after validation:",
        err instanceof Error ? err.message : String(err),
        "Response text:",
        aiResponseText.substring(0, 500) + "...",
      );
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Processing Error",
            "Invalid JSON response from AI. Please try again, or contact support if the issue persists. Your quota has not been deducted.",
          ),
        );
    }

    // 6.1. Validate parsed response structure
    if (!proposalResponse) {
      console.error("[generateProposal] Parsed response is null/undefined");
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Processing Error",
            "The AI response was empty. Please try again or contact support.",
          ),
        );
    }

    // 6.2. Ensure portfolioLink is only set if user has one
    // Clear any AI-generated portfolioLink if user doesn't have one
    if (!portfolioLink) {
      proposalResponse.portfolioLink = "";
    } else {
      // Always use portfolioLink from user profile if available
      proposalResponse.portfolioLink = portfolioLink;
    }

    // 6.5. Validate and create MDX content
    validateProposalResponse(proposalResponse);
    proposalResponse.mdx = createProposalMDX(
      proposalResponse,
      sanitizedClientName,
      portfolioLink || null,
    );

    // 7. Store proposal history and update quota in parallel (non-blocking for response)

    // Check for first proposal milestone
    try {
      const history = await timedDb(req, () => getUserProposalHistory(userId, 1, 1));
      if (history.total === 0) {
        await sendNotificationToUser(
          userId,
          "Milestone Unlocked: First Proposal!",
          "You've successfully generated your first proposal. Start pitching the right way!",
          "/proposal",
          NotificationCategory.ACHIEVEMENT,
        );
      }
    } catch (err) {
      console.error("Error checking/sending first proposal notification:", err);
    }

    // Start both operations but don't wait for quota update
    const storePromise = timedDb(req, () =>
      storeProposalHistory(
        userId,
        {
          client_name: sanitizedClientName,
          job_title: sanitizedJobTitle,
          proposal_tone: proposal_tone,
          job_summary: sanitizedJobSummary,
          ...(sanitizedOptimizerRecordId
            ? { optimizer_record_id: sanitizedOptimizerRecordId }
            : {}),
        },
        proposalResponse,
      ),
    ).catch((err) => {
      console.warn(
        "Warning: Failed to store proposal history for user",
        userId,
        err,
      );
      return undefined;
    });

    // Update quota in background (fire and forget - don't block response)
    updateUserQuota(userId, "ai_proposals").catch((err) => {
      console.warn("Warning: Failed to update quota for user", userId, err);
    });

    // Wait for proposal storage to complete (needed for proposalId in response)
    const proposalId = await storePromise;
    if (proposalId) {
      proposalResponse.proposalId = proposalId;
    }

    // 8. Return success immediately (quota update continues in background)
    return res
      .status(200)
      .json(
        newSuccessResponse(
          "Proposal Generated",
          "AI proposal generated successfully",
          proposalResponse,
        ),
      );
  } catch (err) {
    // Top-level catch for any unexpected errors
    console.error("[generateProposal] Unhandled error:", err);
    observeControllerError(
      req,
      "internal_failure",
      "GenerateProposalUnhandledError",
      "Unhandled generate proposal error",
      err,
    );
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "An error occurred. Please try again or contact support.",
        ),
      );
  }
}

// Get user's AI proposal history
export async function getProposalHistory(req: Request, res: Response) {
  try {
    // 1. Get user ID from auth middleware
    const userId = req.userID as string;
    if (!userId) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));
    }

    // 2. Parse query parameters
    const { page = 1, limit = 10, search } = req.query as ProposalHistoryReq;
    const pageNum = parseInt(page.toString(), 10);
    const limitNum = parseInt(limit.toString(), 10);

    // 3. Validate pagination parameters
    if (pageNum < 1 || limitNum < 1 || limitNum > 50) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Invalid Request",
            "Page must be >= 1, limit must be between 1 and 50",
          ),
        );
    }

    // 4. Get proposal history with optional search
    const result = await getUserProposalHistory(
      userId,
      pageNum,
      limitNum,
      search,
    );

    // 5. Return success
    return res.status(200).json(
      newSuccessResponse(
        "Proposal History Retrieved",
        "AI proposal history retrieved successfully",
        {
          proposals: result.proposals,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: result.total,
            hasMore: result.hasMore,
          },
        },
      ),
    );
  } catch (err) {
    console.error("[getProposalHistory] Error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "An error occurred while retrieving proposal history. Please try again or contact support.",
        ),
      );
  }
}

// Get a specific proposal by ID
export async function getProposalByIdController(req: Request, res: Response) {
  try {
    // 1. Get user ID from auth middleware
    const userId = req.userID as string;
    if (!userId) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));
    }

    // 2. Get proposal ID from params
    const { proposalId } = req.params;
    if (!proposalId) {
      return res
        .status(400)
        .json(newErrorResponse("Invalid Request", "Proposal ID is required"));
    }

    // 3. Get proposal by ID
    const proposal = await getProposalById(userId, proposalId);
    if (!proposal) {
      return res
        .status(404)
        .json(
          newErrorResponse("Not Found", "Proposal not found or access denied"),
        );
    }

    // 4. Return success
    return res
      .status(200)
      .json(
        newSuccessResponse(
          "Proposal Retrieved",
          "AI proposal retrieved successfully",
          proposal,
        ),
      );
  } catch (err) {
    console.error("[getProposalByIdController] Error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "An error occurred while retrieving the proposal. Please try again or contact support.",
        ),
      );
  }
}

export async function refineProposal(req: Request, res: Response) {
  try {
    // 1. Auth check
    const userId = req.userID as string;
    if (!userId) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));
    }

    // 2. Validate input
    const { proposalId, refinementType, newTone, customInstruction } =
      req.body as RefineProposalReq;

    if (!proposalId) {
      return res
        .status(400)
        .json(newErrorResponse("Invalid Request", "Missing proposalId"));
    }

    const validRefinementTypes: RefinementAction[] = [
      "expand_text",
      "trim_text",
      "simplify_text",
      "improve_flow",
      "change_tone",
      "custom",
    ];

    const trimmedCustom = customInstruction?.trim() ?? "";

    if (!refinementType && !trimmedCustom) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Invalid Request",
            "Provide a refinement type or describe how to improve the proposal",
          ),
        );
    }

    if (refinementType && !validRefinementTypes.includes(refinementType)) {
      return res
        .status(400)
        .json(newErrorResponse("Invalid Request", "Invalid refinement type"));
    }

    let effectiveRefinementType: RefinementAction =
      refinementType ?? "custom";
    let effectiveCustomInstruction: string | undefined;

    if (trimmedCustom) {
      const instructionCheck = validateProposalRefineInstruction(trimmedCustom);
      if (!instructionCheck.valid) {
        return res
          .status(400)
          .json(
            newErrorResponse(
              "Validation Error",
              instructionCheck.message ||
                "Invalid refinement instruction",
            ),
          );
      }

      if (
        refinementType &&
        refinementType !== "custom" &&
        refinementType !== "change_tone"
      ) {
        effectiveRefinementType = "custom";
        effectiveCustomInstruction = `Quick improvement: ${REFINEMENT_LABELS[refinementType]}.\n\nAdditional instructions: ${instructionCheck.sanitized}`;
      } else if (refinementType === "change_tone") {
        effectiveRefinementType = "custom";
        effectiveCustomInstruction = `Change the proposal tone to ${newTone || "as selected"}.\n\nAdditional instructions: ${instructionCheck.sanitized}`;
      } else {
        effectiveRefinementType = "custom";
        effectiveCustomInstruction = instructionCheck.sanitized;
      }
    } else if (refinementType === "custom") {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Invalid Request",
            "Describe how you want the proposal improved (10–500 characters)",
          ),
        );
    }

    if (effectiveRefinementType === "change_tone" && !newTone) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Invalid Request",
            "newTone required for change_tone refinement",
          ),
        );
    }

    // 2.5 Enforce quota for refinements as well (same feature bucket as generation)
    let quotaResult;
    try {
      quotaResult = await checkUserQuota(userId, "ai_proposals");
    } catch (err) {
      console.error("[refineProposal] Quota check error:", err);
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Internal Server Error",
            "An error occurred while checking quota. Please try again.",
          ),
        );
    }

    if (!quotaResult.allowed) {
      const limitText =
        quotaResult.limit === -1 ? "unlimited" : quotaResult.limit.toString();
      return res
        .status(429)
        .json(
          newErrorResponse(
            "Quota Exceeded",
            `Quota limit exceeded for AI proposals. Current usage: ${quotaResult.count}/${limitText}.`,
          ),
        );
    }

    // 3. Get proposal details
    const proposal = await getProposalById(userId, proposalId);
    if (!proposal) {
      return res
        .status(404)
        .json(newErrorResponse("Not Found", "Proposal not found"));
    }

    // 4. Get latest version (could be refined already)
    const { proposal: currentProposal, refinementOrder } =
      await getLatestProposalVersion(proposalId, userId);

    // 4a. Get user profile data (displayName, portfolioLink)
    const { displayName, portfolioLink } = await getUserProfileData(
      userId,
      req.userDisplayName,
    );

    // 5. Call AI for refinement
    const prompt = refineProposalPrompt(
      currentProposal,
      effectiveRefinementType,
      proposal.jobTitle,
      proposal.clientName,
      newTone || proposal.proposalTone,
      displayName,
      effectiveCustomInstruction,
    );

    let aiResponseText = "";
    try {
      aiResponseText = await callGemini(
        prompt,
        refineProposalSystemInstruction(),
      );
    } catch (err: any) {
      console.error("[refineProposal] AI call failed:", err);
      observeControllerError(
        req,
        "external_api_error",
        "RefineProposalExternalApiError",
        "AI service call failed",
        err,
      );

      // If system override detected, deduct quota and return specific error
      if (err instanceof SystemOverrideError) {
        try {
          await updateUserQuota(userId, "ai_proposals");
        } catch (quotaErr) {
          console.warn(
            "Warning: Failed to update quota after system override error for user",
            userId,
            quotaErr,
          );
        }

        return res
          .status(400)
          .json(
            newErrorResponse(
              "Invalid Request",
              "The prompt attempted to do something it shouldn't. Your quota has been deducted.",
            ),
          );
      }

      // If validation error (400-level), return 400 status
      if (err instanceof ValidationError) {
        return res
          .status(400)
          .json(
            newErrorResponse(
              "Validation Error",
              err.message ||
                "Invalid request. Please check your input and try again.",
            ),
          );
      }

      return res
        .status(500)
        .json(
          newErrorResponse(
            "AI Service Error",
            "Failed to refine proposal. Please try again.",
          ),
        );
    }

    // 6. Parse AI response
    let parsedRefine: ProposalResponse | AIErrorResponse;
    let refinedProposal: ProposalResponse;
    try {
      parsedRefine = JSON.parse(aiResponseText) as ProposalResponse | AIErrorResponse;

      if ("error" in parsedRefine && parsedRefine.error === true) {
        return res.status(400).json(
          newErrorResponse(
            parsedRefine.code === "OUT_OF_SCOPE"
              ? "Out of Scope"
              : "Invalid Request",
            parsedRefine.message ||
              "That request is outside proposal refinement. Describe how you want the proposal changed.",
          ),
        );
      }

      refinedProposal = parsedRefine as ProposalResponse;
      if (currentProposal.roleFit && !refinedProposal.roleFit) {
        refinedProposal.roleFit = currentProposal.roleFit;
      }
    } catch (err) {
      console.error("[refineProposal] JSON parse failed:", err);
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Processing Error",
            "Failed to process refined proposal.",
          ),
        );
    }

    // 6.5. Validate and create MDX content
    const sanitizedClientName = proposal.clientName.trim();
    validateProposalResponse(refinedProposal);
    refinedProposal.mdx = createProposalMDX(
      refinedProposal,
      sanitizedClientName,
      portfolioLink || null,
    );

    // 7. Store refinement
    await storeRefinement(
      proposalId,
      userId,
      effectiveRefinementType,
      currentProposal,
      refinedProposal,
      refinementOrder,
    );

    // Keep quota accounting consistent with proposal generation
    updateUserQuota(userId, "ai_proposals").catch((err) => {
      console.warn("Warning: Failed to update quota for user", userId, err);
    });

    // 8. Return success
    return res
      .status(200)
      .json(
        newSuccessResponse(
          "Proposal Refined",
          "Proposal refined successfully",
          refinedProposal,
        ),
      );
  } catch (err) {
    console.error("[refineProposal] Error:", err);
    observeControllerError(
      req,
      "internal_failure",
      "RefineProposalUnhandledError",
      "Unhandled refine proposal error",
      err,
    );
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "An error occurred while refining the proposal.",
        ),
      );
  }
}

// Get all versions of a proposal
export async function getProposalVersionsController(
  req: Request,
  res: Response,
) {
  try {
    const userId = req.userID as string;
    if (!userId) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));
    }

    const { proposalId } = req.params;
    if (!proposalId) {
      return res
        .status(400)
        .json(newErrorResponse("Invalid Request", "Proposal ID is required"));
    }

    const versions = await getProposalVersions(proposalId, userId);

    return res.status(200).json(
      newSuccessResponse(
        "Versions Retrieved",
        "Proposal versions retrieved successfully",
        {
          versions,
        },
      ),
    );
  } catch (err) {
    console.error("[getProposalVersionsController] Error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "An error occurred while retrieving proposal versions.",
        ),
      );
  }
}

// Cron: delete proposal history older than 30 days
export async function cleanupOldProposalHistory(req: Request, res: Response) {
  try {
    const app = getFirebaseApp();
    const db = getFirestore(app);

    const secret = process.env.CRON_SECRET;
    if (secret) {
      const provided = req.headers["x-cron-secret"] as string | undefined;
      if (!provided || provided !== secret) {
        return res
          .status(401)
          .json(newErrorResponse("Unauthorized", "Invalid cron secret"));
      }
    }

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let deleted = 0;

    while (true) {
      const snap = await db
        .collection("proposal_history")
        .where("createdAt", "<", cutoff)
        .orderBy("createdAt", "asc")
        .limit(500)
        .get();

      if (snap.empty) break;

      const batch = db.batch();
      for (const doc of snap.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      deleted += snap.size;

      if (snap.size < 500) break;
    }

    return res.status(200).json(
      newSuccessResponse(
        "Cleanup Completed",
        "Deleted proposal history older than 30 days",
        {
          deleted,
          cutoff: cutoff.toISOString(),
        },
      ),
    );
  } catch (err) {
    console.error("[cleanupOldProposalHistory] Error:", err);
    return res
      .status(500)
      .json(newErrorResponse("Internal Server Error", "Cleanup failed"));
  }
}

// Get user quota information for a specific feature
export async function getUserQuota(req: Request, res: Response) {
  try {
    // 1. Get user ID from auth middleware
    const userId = req.userID as string;
    if (!userId) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));
    }

    // 2. Get quota slug from query parameter
    const quota = req.query.quota as string;
    if (!quota) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Invalid Request",
            "Missing required query parameter: quota",
          ),
        );
    }

    // 3. Validate quota slug
    const validQuotaSlugs: FeatureSlug[] = [
      "upwork_profile_optimizer",
      "linkedin_profile_optimizer",
      "ai_proposals",
      "resume_generator",
      "advanced_ai_insights",
      "comunity_access",
      "newsletters",
      "freelancer_growth_tools",
    ];

    if (!validQuotaSlugs.includes(quota as FeatureSlug)) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Invalid Request",
            `Invalid quota slug. Must be one of: ${validQuotaSlugs.join(", ")}`,
          ),
        );
    }

    // 4. Get quota information
    let quotaResult;
    try {
      quotaResult = await checkUserQuota(userId, quota as FeatureSlug);
    } catch (err: any) {
      console.error("[getUserQuota] Quota check error:", err);
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Internal Server Error",
            "An error occurred while checking quota. Please try again or contact support.",
          ),
        );
    }

    // 5. Return quota information
    return res.status(200).json(
      newSuccessResponse(
        "Quota Retrieved",
        "User quota information retrieved successfully",
        {
          quota: quota,
          count: quotaResult.count,
          limit: quotaResult.limit,
          remaining:
            quotaResult.limit === -1
              ? -1
              : Math.max(0, quotaResult.limit - quotaResult.count),
        },
      ),
    );
  } catch (err) {
    console.error("[getUserQuota] Unhandled error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "An error occurred. Please try again or contact support.",
        ),
      );
  }
}

const VALID_TARGET_SECTIONS: OptimizerTargetSection[] = [
  "all",
  "weaknessesAndOptimization",
  "optimizedProfileOverview",
  "suggestedProjectTitles",
  "recommendedVisuals",
  "beforeAfterComparison",
];

export async function refineProfile(req: Request, res: Response) {
  try {
    const userId = req.userID as string;
    if (!userId) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));
    }

    const { recordId, instruction, targetSection = "all" } =
      req.body as RefineProfileReq;

    if (!recordId || !instruction?.trim()) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Invalid Request",
            "recordId and instruction are required",
          ),
        );
    }

    const instructionCheck = validateRefineInstruction(instruction, "profile");
    if (!instructionCheck.valid) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Validation Error",
            instructionCheck.message ||
              "Invalid refinement instruction",
          ),
        );
    }
    const trimmedInstruction = instructionCheck.sanitized;

    if (!VALID_TARGET_SECTIONS.includes(targetSection)) {
      return res
        .status(400)
        .json(newErrorResponse("Invalid Request", "Invalid targetSection"));
    }

    const rootRecord = await getOptimizerHistoryById(userId, recordId);
    if (!rootRecord) {
      return res
        .status(404)
        .json(newErrorResponse("Not Found", "Optimizer record not found"));
    }

    const rootId = resolveOptimizerRootId(rootRecord);
    const profileData = await getUserProfileData(userId, req.userDisplayName);
    const userTierId = profileData?.tierId || null;
    const unlimitedRefine = isUnlimitedRefineTier(userTierId);

    if (!unlimitedRefine) {
      const refinementCount = await countOptimizerRefinementsForRoot(
        rootId,
        userId,
      );
      if (refinementCount >= STARTER_REFINEMENTS_PER_ROOT) {
        return res
          .status(429)
          .json(
            newErrorResponse(
              "Refinement Limit Reached",
              `You can refine this profile up to ${STARTER_REFINEMENTS_PER_ROOT} times on your plan. Upgrade for unlimited refinements.`,
            ),
          );
      }
    }

    const latest = await getLatestOptimizerVersion(rootId, userId);
    const versions = await getOptimizerVersionChain(rootId, userId);
    const nextVersion = (versions[versions.length - 1]?.versionNumber ?? 1) + 1;

    const prompt = refineProfilePrompt(
      latest.response,
      trimmedInstruction,
      targetSection,
      rootRecord.originalInput,
      rootRecord.optimizerType,
    );

    let aiResponseText = "";
    try {
      aiResponseText = await timedExternal(req, () =>
        callGemini(
          prompt,
          refineProfileSystemInstruction(rootRecord.optimizerType),
        ),
      );
    } catch (err: unknown) {
      console.error("[refineProfile] AI call failed:", err);
      observeControllerError(
        req,
        "external_api_error",
        "RefineProfileExternalApiError",
        "AI service call failed",
        err,
      );

      if (err instanceof SystemOverrideError) {
        return res
          .status(400)
          .json(
            newErrorResponse(
              "Invalid Request",
              "The refinement request could not be processed.",
            ),
          );
      }

      if (err instanceof ValidationError) {
        return res
          .status(400)
          .json(
            newErrorResponse(
              "Validation Error",
              err.message || "Invalid refinement request.",
            ),
          );
      }

      return res
        .status(500)
        .json(
          newErrorResponse(
            "AI Service Error",
            "Failed to refine profile. Please try again.",
          ),
        );
    }

    let refinedResponse: OptimizerResponseSections;
    try {
      const parsed = JSON.parse(aiResponseText) as OptimizerResponseSections & {
        error?: boolean;
        message?: string;
      };
      if (parsed.error) {
        return res
          .status(400)
          .json(
            newErrorResponse(
              "Invalid Request",
              parsed.message || "Refinement could not be applied.",
            ),
          );
      }
      refinedResponse = parsed;
    } catch (err) {
      console.error("[refineProfile] JSON parse failed:", err);
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Processing Error",
            "Failed to process refined profile.",
          ),
        );
    }

    const refinementLabel = truncateInstructionLabel(trimmedInstruction);
    const versionId = await storeOptimizerRefinement({
      userId,
      rootRecordId: rootId,
      optimizerType: rootRecord.optimizerType,
      originalInput: rootRecord.originalInput,
      response: refinedResponse,
      userInstruction: trimmedInstruction,
      targetSection,
      refinementLabel,
      versionNumber: nextVersion,
    });

    const refinementsRemaining = unlimitedRefine
      ? -1
      : Math.max(
          0,
          STARTER_REFINEMENTS_PER_ROOT -
            (await countOptimizerRefinementsForRoot(rootId, userId)),
        );

    return res.status(200).json(
      newSuccessResponse("Profile Refined", "Profile refined successfully", {
        ...refinedResponse,
        optimizerRecordId: rootId,
        versionId,
        versionNumber: nextVersion,
        refinementLabel,
        unlimitedRefine,
        refinementsRemaining,
      }),
    );
  } catch (err) {
    console.error("[refineProfile] Error:", err);
    observeControllerError(
      req,
      "internal_failure",
      "RefineProfileUnhandledError",
      "Unhandled refine profile error",
      err,
    );
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "An error occurred while refining the profile.",
        ),
      );
  }
}
