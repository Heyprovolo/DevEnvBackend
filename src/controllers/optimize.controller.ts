import type { Request, Response } from "express";
import {
  optimizerPrompt,
  optimizerSystemInstruction,
  linkedinOptimizerPrompt,
  linkedinOptimizerSystemInstruction,
  proposalPrompt,
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
  getUserOptimizerHistory,
  getOptimizerHistoryById,
  cleanupOldOptimizerHistory,
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
import { getFirestore } from "firebase-admin/firestore";
import { getFirebaseApp } from "../utils/getFirebaseApp.ts";
import type { OptimizerType } from "../types/optimizer-history.ts";
import { sendNotificationToUser } from "../services/notification.service.ts";
import { NotificationCategory } from "../types/notification.ts";

// Helper function to get user profile data (displayName, portfolioLink, professionalTitle) in one DB call
async function getUserProfileData(
  userId: string,
  tokenDisplayName?: string
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
        err
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
      err
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
            "Missing required fields: full_name, professional_title, profile"
          )
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
            "Input fields exceed allowed length."
          )
        );
    }

    // 3. Check quota
    let quotaResult;
    try {
      quotaResult = await checkUserQuota(userId, "upwork_profile_optimizer");
      console.log("Quota result for user", userId, ":", quotaResult);
    } catch (err: any) {
      console.error("[optimizeProfile] Quota check error:", err);
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Internal Server Error",
            "An error occurred. Please try again or contact support."
          )
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
            `Quota limit exceeded for profile optimizer. Current usage: ${quotaResult.count}/${limitText}. Try again in the next period.`
          )
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
      aiResponseText = await callGemini(content, optimizerSystemInstruction());
    } catch (err: any) {
      console.error("[optimizeProfile] AI service call failed:", err);

      // If system override detected, deduct quota and return specific error
      if (err instanceof SystemOverrideError) {
        try {
          await updateUserQuota(userId, "upwork_profile_optimizer");
        } catch (quotaErr) {
          console.warn(
            "Warning: Failed to update quota after system override error for user",
            userId,
            quotaErr
          );
        }

        return res
          .status(400)
          .json(
            newErrorResponse(
              "Invalid Request",
              "The prompt attempted to do something it shouldn't. Your quota has been deducted."
            )
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
                "Invalid request. Please check your input and try again."
            )
          );
      }

      return res
        .status(500)
        .json(
          newErrorResponse(
            "AI Service Error",
            "An error occurred. Please try again or contact support."
          )
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
        aiResponseText.substring(0, 500) + "..."
      );
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Processing Error",
            "The AI response could not be processed. Please try again or contact support."
          )
        );
    }

    // 7. Update quota in background (fire and forget - don't block response)
    updateUserQuota(userId, "upwork_profile_optimizer").catch((err) => {
      console.warn("Warning: Failed to update quota for user", userId, err);
    });

    // 8. Store optimization history only for premium users (not starter/free)
    try {
      const profileData = await getUserProfileData(userId, req.userDisplayName);
      const starterTierId = process.env.STARTER_TIER_ID || "starter";
      const userTierId = profileData?.tierId || null;

      if (userTierId && userTierId !== starterTierId) {
        // Check for first optimization milestone
        try {
          const history = await getUserOptimizerHistory(userId, 1, 1);
          if (history.total === 0) {
            await sendNotificationToUser(
              userId,
              "Milestone Unlocked: First Optimization!",
              "You've just optimized your first profile. You're a step closer to your goal!",
              "/optimizer",
              NotificationCategory.ACHIEVEMENT
            );
          }
        } catch (err) {
          console.error(
            "Error checking/sending first optimization notification:",
            err
          );
        }

        // premium user - store optimizer history
        storeOptimizerHistory({
          userId,
          optimizerType: "upwork",
          originalInput: {
            fullName: sanitizedFullName,
            professionalTitle: sanitizedTitle,
            content: sanitizedProfile,
          },
          response: parsedResponse,
        }).catch((err) => {
          console.warn("Failed to store optimizer history (upwork)", err);
        });
      } else {
        // non-premium - skip storing history
        console.debug(
          `[optimizeProfile] Skipping optimizer history store for user ${userId} with tier ${userTierId}`
        );
      }
    } catch (err) {
      console.warn(
        "Failed to check user tier before storing optimizer history",
        err
      );
    }

    // 9. Return success immediately (quota + history storing continue in background)
    return res
      .status(200)
      .json(
        newSuccessResponse(
          "Optimization Successful",
          "Profile optimized successfully",
          parsedResponse
        )
      );
  } catch (err) {
    // Top-level catch for any unexpected errors
    console.error("[optimizeProfile] Unhandled error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "An error occurred. Please try again or contact support."
        )
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
            "Missing required fields: full_name, professional_title, profile"
          )
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
            "Input fields exceed allowed length."
          )
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
            "An error occurred. Please try again or contact support."
          )
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
            `Quota limit exceeded for profile optimizer. Current usage: ${quotaResult.count}/${limitText}. Try again in the next period.`
          )
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
        linkedinOptimizerSystemInstruction()
      );
    } catch (err: any) {
      console.error("[optimizeLinkedIn] AI service call failed:", err);

      // If system override detected, deduct quota and return specific error
      if (err instanceof SystemOverrideError) {
        try {
          await updateUserQuota(userId, "linkedin_profile_optimizer");
        } catch (quotaErr) {
          console.warn(
            "Warning: Failed to update quota after system override error for user",
            userId,
            quotaErr
          );
        }

        return res
          .status(400)
          .json(
            newErrorResponse(
              "Invalid Request",
              "The prompt attempted to do something it shouldn't. Your quota has been deducted."
            )
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
                "Invalid request. Please check your input and try again."
            )
          );
      }

      return res
        .status(500)
        .json(
          newErrorResponse(
            "AI Service Error",
            "An error occurred. Please try again or contact support."
          )
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
        aiResponseText.substring(0, 500) + "..."
      );
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Processing Error",
            "The AI response could not be processed. Please try again or contact support."
          )
        );
    }

    // 7. Update quota in background (fire and forget - don't block response)
    updateUserQuota(userId, "linkedin_profile_optimizer").catch((err) => {
      console.warn("Warning: Failed to update quota for user", userId, err);
    });

    // 8. Store optimization history (fire and forget)
    // Only for premium users
    try {
      const profileData = await getUserProfileData(userId, req.userDisplayName);
      const starterTierId = process.env.STARTER_TIER_ID || "starter";
      const userTierId = profileData?.tierId || null;

      if (userTierId && userTierId !== starterTierId) {
        // Check for first optimization milestone (using getUserOptimizerHistory which is already imported)
        try {
          const history = await getUserOptimizerHistory(userId, 1, 1);
          if (history.total === 0) {
            await sendNotificationToUser(
              userId,
              "Milestone Unlocked: First Optimization!",
              "You've just optimized your first profile. You're a step closer to your goal!",
              "/optimizer",
              NotificationCategory.ACHIEVEMENT
            );
          }
        } catch (err) {
          console.error(
            "Error checking/sending first optimization notification:",
            err
          );
        }

        storeOptimizerHistory({
          userId,
          optimizerType: "linkedin",
          originalInput: {
            fullName: sanitizedFullName,
            professionalTitle: sanitizedTitle,
            content: sanitizedProfile,
          },
          response: parsedResponse,
        }).catch((err) => {
          console.warn("Failed to store optimizer history (linkedin)", err);
        });
      } else {
        // non-premium - skip storing history
        console.debug(
          `[optimizeLinkedIn] Skipping optimizer history store for user ${userId} with tier ${userTierId}`
        );
      }
    } catch (err) {
      console.warn(
        "Failed to check user tier before storing optimizer history (linkedin)",
        err
      );
    }

    // 9. Return success immediately (quota update continues in background)
    return res
      .status(200)
      .json(
        newSuccessResponse(
          "Optimization Successful",
          "LinkedIn profile optimized successfully",
          parsedResponse
        )
      );
  } catch (err) {
    // Top-level catch for any unexpected errors
    console.error("[optimizeLinkedIn] Unhandled error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "An error occurred. Please try again or contact support."
        )
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
            "Page must be >=1 and limit between 1 and 50"
          )
        );
    }

    const result = await getUserOptimizerHistory(
      userId,
      pageNum,
      limitNum,
      search,
      type as OptimizerType | undefined
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
        }
      )
    );
  } catch (err) {
    console.error("[getOptimizerHistory] Error", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "Failed to retrieve optimizer history"
        )
      );
  }
}

// Get single optimizer history record
export async function getOptimizerHistoryByIdController(
  req: Request,
  res: Response
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
          newErrorResponse("Not Found", "Record not found or access denied")
        );
    }
    return res
      .status(200)
      .json(
        newSuccessResponse(
          "Record Retrieved",
          "Optimizer record retrieved successfully",
          record
        )
      );
  } catch (err) {
    console.error("[getOptimizerHistoryByIdController] Error", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "Failed to retrieve optimizer record"
        )
      );
  }
}

// Cron cleanup for optimizer history
export async function cleanupOldOptimizerHistoryController(
  req: Request,
  res: Response
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
        }
      )
    );
  } catch (err) {
    console.error("[cleanupOldOptimizerHistoryController] Error", err);
    return res
      .status(500)
      .json(
        newErrorResponse("Internal Server Error", "Optimizer cleanup failed")
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
    const { client_name, job_title, proposal_tone, job_summary } =
      req.body as ProposalReq;
    if (!client_name || !job_title || !proposal_tone || !job_summary) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Invalid Request",
            "Missing required fields: client_name, job_title, proposal_tone, job_summary"
          )
        );
    }
    if (
      client_name.length > 100 ||
      job_title.length > 200 ||
      job_summary.length > 2000
    ) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Validation Error",
            "Input fields exceed allowed length."
          )
        );
    }
    const validTones = ["professional", "conversational", "confident", "calm"];
    if (!validTones.includes(proposal_tone)) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Validation Error",
            "Invalid proposal tone. Must be one of: professional, conversational, confident, calm"
          )
        );
    }

    // 3. Parallelize quota check and user profile data fetch (both are independent DB calls)
    let quotaResult;
    let profileData;
    try {
      [quotaResult, profileData] = await Promise.all([
        checkUserQuota(userId, "ai_proposals"),
        getUserProfileData(userId, req.userDisplayName),
      ]);
    } catch (err: any) {
      console.error(
        "[generateProposal] Quota check or profile fetch error:",
        err
      );
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Internal Server Error",
            "An error occurred. Please try again or contact support."
          )
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
            `Quota limit exceeded for AI proposals. Current usage: ${quotaResult.count}/${limitText}. Try again in the next period.`
          )
        );
    }

    // 4. Extract profile data
    const { displayName, portfolioLink, professionalTitle } = profileData;

    // 5. Sanitize input (simple trim)
    const sanitizedClientName = client_name.trim();
    const sanitizedJobTitle = job_title.trim();
    const sanitizedJobSummary = job_summary.trim();

    // Use professional title from profile if available (for context, though job_title is the job being applied for)
    const inputContent = `Client Name: ${sanitizedClientName}\nJob Title: ${sanitizedJobTitle}${
      professionalTitle ? `\nYour Professional Title: ${professionalTitle}` : ""
    }\nProposal Tone: ${proposal_tone}\n\nJob Summary:\n${sanitizedJobSummary}`;
    const content = proposalPrompt(inputContent, displayName, portfolioLink);

    // 5. Call AI model
    let aiResponseText = "";
    try {
      aiResponseText = await callGemini(content, proposalSystemInstruction());
    } catch (err: any) {
      console.error("[generateProposal] AI service call failed:", err);

      // If system override detected, deduct quota and return specific error
      if (err instanceof SystemOverrideError) {
        try {
          await updateUserQuota(userId, "ai_proposals");
        } catch (quotaErr) {
          console.warn(
            "Warning: Failed to update quota after system override error for user",
            userId,
            quotaErr
          );
        }

        return res
          .status(400)
          .json(
            newErrorResponse(
              "Invalid Request",
              "The prompt attempted to do something it shouldn't. Your quota has been deducted."
            )
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
                "Invalid request. Please check your input and try again."
            )
          );
      }

      return res
        .status(500)
        .json(
          newErrorResponse(
            "AI Service Error",
            "An error occurred. Please try again or contact support."
          )
        );
    }

    // 6. Parse AI response
    let parsedResponse: ProposalResponse | AIErrorResponse;
    let proposalResponse: ProposalResponse;

    try {
      parsedResponse = JSON.parse(aiResponseText);

      // Check if AI returned an error response
      if ("error" in parsedResponse && parsedResponse.error === true) {
        // Handle different error types
        if (parsedResponse.code === "OUT_OF_SCOPE") {
          return res
            .status(400)
            .json(
              newErrorResponse(
                "Out of Scope",
                parsedResponse.message ||
                  "This type of work is not supported. Please provide a web development related project."
              )
            );
        } else if (parsedResponse.code === "INVALID_INPUT") {
          return res
            .status(400)
            .json(
              newErrorResponse(
                "Invalid Input",
                parsedResponse.message ||
                  "The provided information is not valid. Please check your input and try again."
              )
            );
        } else if (parsedResponse.code === "CONTENT_TOO_LONG") {
          return res
            .status(400)
            .json(
              newErrorResponse(
                "Content Too Long",
                parsedResponse.message ||
                  "The job description is too long. Please provide a shorter summary."
              )
            );
        } else {
          return res
            .status(400)
            .json(
              newErrorResponse(
                "AI Error",
                parsedResponse.message ||
                  "The AI service encountered an error. Please try again."
              )
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
        aiResponseText.substring(0, 500) + "..."
      );
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Processing Error",
            "The AI response could not be processed. Please try again or contact support."
          )
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
            "The AI response was empty. Please try again or contact support."
          )
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
      portfolioLink || null
    );

    // 7. Store proposal history and update quota in parallel (non-blocking for response)

    // Check for first proposal milestone
    try {
      const history = await getUserProposalHistory(userId, 1, 1);
      if (history.total === 0) {
        await sendNotificationToUser(
          userId,
          "Milestone Unlocked: First Proposal!",
          "You've successfully generated your first proposal. Start pitching the right way!",
          "/proposal",
          NotificationCategory.ACHIEVEMENT
        );
      }
    } catch (err) {
      console.error("Error checking/sending first proposal notification:", err);
    }

    // Start both operations but don't wait for quota update
    const storePromise = storeProposalHistory(
      userId,
      {
        client_name: sanitizedClientName,
        job_title: sanitizedJobTitle,
        proposal_tone: proposal_tone,
        job_summary: sanitizedJobSummary,
      },
      proposalResponse
    ).catch((err) => {
      console.warn(
        "Warning: Failed to store proposal history for user",
        userId,
        err
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
          proposalResponse
        )
      );
  } catch (err) {
    // Top-level catch for any unexpected errors
    console.error("[generateProposal] Unhandled error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "An error occurred. Please try again or contact support."
        )
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
            "Page must be >= 1, limit must be between 1 and 50"
          )
        );
    }

    // 4. Get proposal history with optional search
    const result = await getUserProposalHistory(
      userId,
      pageNum,
      limitNum,
      search
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
        }
      )
    );
  } catch (err) {
    console.error("[getProposalHistory] Error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "An error occurred while retrieving proposal history. Please try again or contact support."
        )
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
          newErrorResponse("Not Found", "Proposal not found or access denied")
        );
    }

    // 4. Return success
    return res
      .status(200)
      .json(
        newSuccessResponse(
          "Proposal Retrieved",
          "AI proposal retrieved successfully",
          proposal
        )
      );
  } catch (err) {
    console.error("[getProposalByIdController] Error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "An error occurred while retrieving the proposal. Please try again or contact support."
        )
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
    const { proposalId, refinementType, newTone } =
      req.body as RefineProposalReq;

    if (!proposalId || !refinementType) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Invalid Request",
            "Missing proposalId or refinementType"
          )
        );
    }

    const validRefinementTypes: RefinementAction[] = [
      "expand_text",
      "trim_text",
      "simplify_text",
      "improve_flow",
      "change_tone",
    ];

    if (!validRefinementTypes.includes(refinementType)) {
      return res
        .status(400)
        .json(newErrorResponse("Invalid Request", "Invalid refinement type"));
    }

    // Change tone requires newTone
    if (refinementType === "change_tone" && !newTone) {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Invalid Request",
            "newTone required for change_tone refinement"
          )
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
      req.userDisplayName
    );

    // 5. Call AI for refinement
    const prompt = refineProposalPrompt(
      currentProposal,
      refinementType,
      proposal.jobTitle,
      proposal.clientName,
      newTone || proposal.proposalTone,
      displayName
    );

    let aiResponseText = "";
    try {
      aiResponseText = await callGemini(
        prompt,
        refineProposalSystemInstruction()
      );
    } catch (err: any) {
      console.error("[refineProposal] AI call failed:", err);

      // If system override detected, deduct quota and return specific error
      if (err instanceof SystemOverrideError) {
        try {
          await updateUserQuota(userId, "ai_proposals");
        } catch (quotaErr) {
          console.warn(
            "Warning: Failed to update quota after system override error for user",
            userId,
            quotaErr
          );
        }

        return res
          .status(400)
          .json(
            newErrorResponse(
              "Invalid Request",
              "The prompt attempted to do something it shouldn't. Your quota has been deducted."
            )
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
                "Invalid request. Please check your input and try again."
            )
          );
      }

      return res
        .status(500)
        .json(
          newErrorResponse(
            "AI Service Error",
            "Failed to refine proposal. Please try again."
          )
        );
    }

    // 6. Parse AI response
    let refinedProposal: ProposalResponse;
    try {
      refinedProposal = JSON.parse(aiResponseText) as ProposalResponse;
    } catch (err) {
      console.error("[refineProposal] JSON parse failed:", err);
      return res
        .status(500)
        .json(
          newErrorResponse(
            "Processing Error",
            "Failed to process refined proposal."
          )
        );
    }

    // 6.5. Validate and create MDX content
    const sanitizedClientName = proposal.clientName.trim();
    validateProposalResponse(refinedProposal);
    refinedProposal.mdx = createProposalMDX(
      refinedProposal,
      sanitizedClientName,
      portfolioLink || null
    );

    // 7. Store refinement
    await storeRefinement(
      proposalId,
      userId,
      refinementType,
      currentProposal,
      refinedProposal,
      refinementOrder
    );

    // 8. Return success
    return res
      .status(200)
      .json(
        newSuccessResponse(
          "Proposal Refined",
          "Proposal refined successfully",
          refinedProposal
        )
      );
  } catch (err) {
    console.error("[refineProposal] Error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "An error occurred while refining the proposal."
        )
      );
  }
}

// Get all versions of a proposal
export async function getProposalVersionsController(
  req: Request,
  res: Response
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
        }
      )
    );
  } catch (err) {
    console.error("[getProposalVersionsController] Error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "An error occurred while retrieving proposal versions."
        )
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
        }
      )
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
            "Missing required query parameter: quota"
          )
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
            `Invalid quota slug. Must be one of: ${validQuotaSlugs.join(", ")}`
          )
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
            "An error occurred while checking quota. Please try again or contact support."
          )
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
        }
      )
    );
  } catch (err) {
    console.error("[getUserQuota] Unhandled error:", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "An error occurred. Please try again or contact support."
        )
      );
  }
}
