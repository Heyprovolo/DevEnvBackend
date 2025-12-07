import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { authMiddleware, emailVerificationMiddleware } from "../middlewares/auth.middleware.ts";
import {
  optimizeProfile,
  optimizeLinkedIn,
  generateProposal,
  getProposalHistory,
  getProposalByIdController,
  refineProposal,
  getProposalVersionsController,
  cleanupOldProposalHistory,
  getUserQuota,
  getOptimizerHistoryByIdController,
  cleanupOldOptimizerHistoryController,
  getOptimizerHistory,
} from "../controllers/optimize.controller.ts";

const aiRouter: ExpressRouter = Router();

/**
 * @openapi
 * /api/v1/ai/optimize-upwork:
 *   post:
 *     summary: Optimize freelancer Upwork profile using AI
 *     description: Analyzes and optimizes a freelancer's Upwork profile content using AI to improve client attraction and profile effectiveness.
 *     tags:
 *       - AI
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               full_name:
 *                 type: string
 *                 example: John Doe
 *                 description: Freelancer's full name (max 100 characters)
 *               professional_title:
 *                 type: string
 *                 example: Full Stack Developer
 *                 description: Professional title or role (max 200 characters)
 *               profile:
 *                 type: string
 *                 example: Experienced developer with 5+ years in web development...
 *                 description: Profile description or bio (max 1000 characters)
 *             required:
 *               - full_name
 *               - professional_title
 *               - profile
 *     responses:
 *       200:
 *         description: Profile optimization completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     weaknessesAndOptimization:
 *                       type: string
 *                     optimizedProfileOverview:
 *                       type: string
 *                     suggestedProjectTitles:
 *                       type: string
 *                     recommendedVisuals:
 *                       type: string
 *                     beforeAfterComparison:
 *                       type: string
 *       400:
 *         description: Bad Request - Invalid input validation
 *       401:
 *         description: Unauthorized - Unauthorized
 *       429:
 *         description: Too Many Requests - Daily limit exceeded
 *       500:
 *         description: Internal Server Error - AI service or client creation failed
 */
aiRouter.post("/optimize-upwork", authMiddleware, emailVerificationMiddleware, optimizeProfile);

/**
 * @swagger
 * /api/v1/ai/optimize-linkedin:
 *   post:
 *     summary: Optimize LinkedIn Profile
 *     description: Uses AI to analyze and optimize a LinkedIn professional profile for better networking and job opportunities
 *     tags:
 *       - AI
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - full_name
 *               - professional_title
 *               - profile
 *             properties:
 *               full_name:
 *                 type: string
 *                 maxLength: 100
 *                 description: The professional's full name
 *                 example: "John Smith"
 *               professional_title:
 *                 type: string
 *                 maxLength: 200
 *                 description: Current professional title or headline
 *                 example: "Senior Software Engineer"
 *               profile:
 *                 type: string
 *                 maxLength: 5000
 *                 description: Current LinkedIn profile content (summary, experience, etc.)
 *                 example: "Experienced software engineer with 5+ years in web development..."
 *     responses:
 *       200:
 *         description: LinkedIn profile optimization successful
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
 *                   example: "Optimization Successful"
 *                 data:
 *                   type: object
 *                   properties:
 *                     weaknessesAndOptimization:
 *                       type: string
 *                     optimizedProfileOverview:
 *                       type: string
 *                     suggestedProjectTitles:
 *                       type: string
 *                     recommendedVisuals:
 *                       type: string
 *                     beforeAfterComparison:
 *                       type: string
 *       400:
 *         description: Bad Request - Invalid input validation
 *       401:
 *         description: Unauthorized - Unauthorized
 *       429:
 *         description: Too Many Requests - Daily limit exceeded
 *       500:
 *         description: Internal Server Error - AI service or client creation failed
 */
aiRouter.post("/optimize-linkedin", authMiddleware, emailVerificationMiddleware, optimizeLinkedIn);

/**
 * @swagger
 * /api/v1/ai/generate-proposal:
 *   post:
 *     summary: Generate AI Proposal
 *     description: Uses AI to generate high-converting Upwork proposals based on job requirements and client information
 *     tags:
 *       - AI
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - client_name
 *               - job_title
 *               - proposal_tone
 *               - job_summary
 *             properties:
 *               client_name:
 *                 type: string
 *                 maxLength: 100
 *                 description: The client's name or company name
 *                 example: "TechStartup Inc."
 *               job_title:
 *                 type: string
 *                 maxLength: 200
 *                 description: The job title for the position
 *                 example: "WordPress Developer"
 *               proposal_tone:
 *                 type: string
 *                 enum: [professional, conversational, confident, calm]
 *                 description: The desired tone for the proposal
 *                 example: "professional"
 *               job_summary:
 *                 type: string
 *                 maxLength: 2000
 *                 description: Summary of the job posting including requirements, budget, and key details
 *                 example: "Looking for a WordPress developer to build a custom e-commerce site with payment integration..."
 *     responses:
 *       200:
 *         description: Proposal generated successfully
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
 *                   example: "Proposal Generated"
 *                 data:
 *                   type: object
 *                   properties:
 *                     hook:
 *                       type: string
 *                       description: Attention-grabbing opening statement
 *                     solution:
 *                       type: string
 *                       description: How you'll solve their problem
 *                     keyPoints:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: Bullet points with emojis highlighting services
 *                     portfolioLink:
 *                       type: string
 *                       description: Portfolio URL if relevant
 *                     availability:
 *                       type: string
 *                       description: Availability statement
 *                     support:
 *                       type: string
 *                       description: Post-launch support information
 *                     closing:
 *                       type: string
 *                       description: Call-to-action to move forward
 *                     mdx:
 *                       type: string
 *                       description: Complete proposal as formatted markdown text
 *                       example: "Hi [Client Name]! I noticed you're looking for a WordPress developer...\n\nI can help you build a custom e-commerce solution...\n\n• ✅ Custom WordPress development\n• 🚀 E-commerce integration\n• 🎯 SEO optimization\n\nPortfolio: https://example.com\n\nI'm available to start immediately!\n\nI provide 30 days of free support after launch.\n\nLet's discuss your project!"
 *       400:
 *         description: Bad Request - Invalid input validation
 *       401:
 *         description: Unauthorized - Unauthorized
 *       429:
 *         description: Too Many Requests - Daily limit exceeded
 *       500:
 *         description: Internal Server Error - AI service or client creation failed
 */
aiRouter.post("/generate-proposal", authMiddleware, emailVerificationMiddleware, generateProposal);

/**
 * @swagger
 * /api/v1/ai/proposal-history:
 *   get:
 *     summary: Get AI Proposal History
 *     description: Retrieves the user's AI proposal generation history with pagination and optional search
 *     tags:
 *       - AI
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *         description: Number of proposals per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term to filter by job title, client name, or job summary
 *         example: "WordPress Developer"
 *     responses:
 *       200:
 *         description: Proposal history retrieved successfully
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
 *                   example: "Proposal History Retrieved"
 *                 data:
 *                   type: object
 *                   properties:
 *                     proposals:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                             description: Unique proposal ID
 *                           clientName:
 *                             type: string
 *                             description: Client name
 *                           jobTitle:
 *                             type: string
 *                             description: Job title for the position
 *                           proposalTone:
 *                             type: string
 *                             enum: [professional, conversational, confident, calm]
 *                           jobSummary:
 *                             type: string
 *                             description: Job summary used for generation
 *                           proposalResponse:
 *                             type: object
 *                             description: Generated proposal content
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *                             description: When the proposal was created
 *                           updatedAt:
 *                             type: string
 *                             format: date-time
 *                             description: When the proposal was last updated
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         page:
 *                           type: integer
 *                           description: Current page number
 *                         limit:
 *                           type: integer
 *                           description: Number of items per page
 *                         total:
 *                           type: integer
 *                           description: Total number of proposals
 *                         hasMore:
 *                           type: boolean
 *                           description: Whether there are more pages available
 *       400:
 *         description: Bad Request - Invalid pagination parameters
 *       401:
 *         description: Unauthorized - User not authenticated
 *       500:
 *         description: Internal Server Error - Failed to retrieve proposal history
 */
aiRouter.get("/proposal-history", authMiddleware, emailVerificationMiddleware, getProposalHistory);

/**
 * @swagger
 * /api/v1/ai/proposal-history/{proposalId}:
 *   get:
 *     summary: Get Specific AI Proposal
 *     description: Retrieves a specific AI proposal by ID (user can only access their own proposals)
 *     tags:
 *       - AI
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique proposal ID
 *     responses:
 *       200:
 *         description: Proposal retrieved successfully
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
 *                   example: "Proposal Retrieved"
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       description: Unique proposal ID
 *                     clientName:
 *                       type: string
 *                       description: Client name
 *                     jobTitle:
 *                       type: string
 *                       description: Job title for the position
 *                     proposalTone:
 *                       type: string
 *                       enum: [professional, conversational, confident, calm]
 *                     jobSummary:
 *                       type: string
 *                       description: Job summary used for generation
 *                     proposalResponse:
 *                       type: object
 *                       description: Complete generated proposal content (latest version)
 *                       properties:
 *                         hook:
 *                           type: string
 *                         solution:
 *                           type: string
 *                         keyPoints:
 *                           type: array
 *                           items:
 *                             type: string
 *                         portfolioLink:
 *                           type: string
 *                         availability:
 *                           type: string
 *                         support:
 *                           type: string
 *                         closing:
 *                           type: string
 *                         mdx:
 *                           type: string
 *                         proposalId:
 *                           type: string
 *                         version:
 *                           type: number
 *                         versionId:
 *                           type: string
 *                     refinementCount:
 *                       type: number
 *                       description: Number of times this proposal has been refined
 *                     latestRefinementId:
 *                       type: string
 *                       description: ID of the most recent refinement
 *                     allRefinementIds:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: Array of all refinement IDs
 *                     refinements:
 *                       type: array
 *                       description: Full refinement history with before/after (only included if refinements exist)
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           proposalId:
 *                             type: string
 *                           userId:
 *                             type: string
 *                           refinementType:
 *                             type: string
 *                             enum: [expand_text, trim_text, simplify_text, improve_flow, change_tone]
 *                           refinementLabel:
 *                             type: string
 *                             description: Human-readable refinement label
 *                           originalProposal:
 *                             type: object
 *                             description: Proposal before refinement
 *                           refinedProposal:
 *                             type: object
 *                             description: Proposal after refinement
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *                           order:
 *                             type: number
 *                           version:
 *                             type: number
 *                     versions:
 *                       type: array
 *                       description: All versions including original (only included if refinements exist)
 *                       items:
 *                         type: object
 *                         properties:
 *                           versionId:
 *                             type: string
 *                             description: Unique ID for this version
 *                           version:
 *                             type: number
 *                             description: Version number (0 = original, 1, 2, 3... for refinements)
 *                           refinementLabel:
 *                             type: string
 *                             description: Label for this version (if refinement)
 *                           refinementType:
 *                             type: string
 *                             enum: [expand_text, trim_text, simplify_text, improve_flow, change_tone]
 *                           proposal:
 *                             type: object
 *                             description: Complete proposal for this version
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Bad Request - Missing proposal ID
 *       401:
 *         description: Unauthorized - User not authenticated
 *       404:
 *         description: Not Found - Proposal not found or access denied
 *       500:
 *         description: Internal Server Error - Failed to retrieve proposal
 */
aiRouter.get(
  "/proposal-history/:proposalId",
  authMiddleware,
  emailVerificationMiddleware,
  getProposalByIdController
);

/**
 * @swagger
 * /api/v1/ai/refine-proposal:
 *   post:
 *     summary: Refine an existing AI proposal
 *     description: Refines an existing proposal by expanding, trimming, simplifying, improving flow, or changing tone
 *     tags:
 *       - AI
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - proposalId
 *               - refinementType
 *             properties:
 *               proposalId:
 *                 type: string
 *                 description: ID of the proposal to refine
 *               refinementType:
 *                 type: string
 *                 enum: [expand_text, trim_text, simplify_text, improve_flow, change_tone]
 *                 description: Type of refinement to apply
 *               newTone:
 *                 type: string
 *                 enum: [professional, conversational, confident, calm]
 *                 description: New tone (required only for change_tone refinement)
 *     responses:
 *       200:
 *         description: Proposal refined successfully
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Proposal not found
 *       500:
 *         description: Internal server error
 */
aiRouter.post("/refine-proposal", authMiddleware, emailVerificationMiddleware, refineProposal);

/**
 * @swagger
 * /api/v1/ai/proposal-versions/{proposalId}:
 *   get:
 *     summary: Get all versions of a proposal
 *     description: Retrieves all versions (original + refinements) of a specific proposal with version history navigation
 *     tags:
 *       - AI
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema:
 *           type: string
 *         description: Proposal ID
 *     responses:
 *       200:
 *         description: Versions retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Proposal not found
 *       500:
 *         description: Internal server error
 */
aiRouter.get(
  "/proposal-versions/:proposalId",
  authMiddleware,
  emailVerificationMiddleware,
  getProposalVersionsController
);

/**
 * @swagger
 * /api/v1/ai/cron/cleanup-proposal-history-30d:
 *   get:
 *     summary: Delete proposal history older than 30 days
 *     description: Deletes all proposal_history entries older than 30 days. Intended for daily cron.
 *     tags:
 *       - AI
 *     responses:
 *       200:
 *         description: Cleanup completed
 *       401:
 *         description: Unauthorized when CRON_SECRET is set and missing/invalid
 *       500:
 *         description: Internal server error
 */
aiRouter.get("/cron/cleanup-proposal-history-30d", cleanupOldProposalHistory);

/**
 * @swagger
 * /api/v1/ai/quota:
 *   get:
 *     summary: Get user quota information for a specific feature
 *     description: Retrieves the current quota usage, limit, and remaining quota for a specific feature
 *     tags:
 *       - AI
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: quota
 *         required: true
 *         schema:
 *           type: string
 *           enum:
 *             - upwork_profile_optimizer
 *             - linkedin_profile_optimizer
 *             - ai_proposals
 *             - resume_generator
 *             - advanced_ai_insights
 *             - comunity_access
 *             - newsletters
 *             - freelancer_growth_tools
 *         description: The quota slug for the feature to check
 *         example: ai_proposals
 *     responses:
 *       200:
 *         description: Quota information retrieved successfully
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
 *                   example: "Quota Retrieved"
 *                 data:
 *                   type: object
 *                   properties:
 *                     quota:
 *                       type: string
 *                       example: "ai_proposals"
 *                     count:
 *                       type: number
 *                       description: Current usage count
 *                       example: 5
 *                     limit:
 *                       type: string | number
 *                       description: Maximum quota limit (or "unlimited")
 *                       example: 10
 *                     remaining:
 *                       type: string | number
 *                       description: Remaining quota (or "unlimited")
 *                       example: 5
 *       400:
 *         description: Invalid request - missing or invalid quota parameter
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
aiRouter.get("/quota", authMiddleware, emailVerificationMiddleware, getUserQuota);

/**
 * @swagger
 * /api/v1/ai/optimizer-history:
 *   get:
 *     summary: Get optimizer (profile) history
 *     description: Retrieves the user's profile optimization history (Upwork / LinkedIn) with pagination and optional search and type filter.
 *     tags:
 *       - AI
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *         description: Number of records per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term to filter by input or optimized overview content
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [upwork, linkedin]
 *         description: Filter history by optimizer type
 *     responses:
 *       200:
 *         description: Optimizer history retrieved successfully
 *       400:
 *         description: Invalid pagination parameters
 *       401:
 *         description: Unauthorized - User not authenticated
 *       500:
 *         description: Internal Server Error - Failed to retrieve optimizer history
 */
aiRouter.get(
  "/optimizer-history",
  authMiddleware,
  emailVerificationMiddleware,
  getOptimizerHistory
);

/**
 * @swagger
 * /api/v1/ai/optimizer-history/{recordId}:
 *   get:
 *     summary: Get specific optimizer history record
 *     description: Retrieves a single profile optimization record by ID
 *     tags:
 *       - AI
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: recordId
 *         required: true
 *         schema:
 *           type: string
 *         description: Optimizer record ID
 *     responses:
 *       200:
 *         description: Record retrieved successfully
 *       400:
 *         description: Missing record ID
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Record not found or access denied
 *       500:
 *         description: Internal Server Error - Failed to retrieve record
 */
aiRouter.get(
  "/optimizer-history/:recordId",
  authMiddleware,
  emailVerificationMiddleware,
  getOptimizerHistoryByIdController
);

/**
 * @swagger
 * /api/v1/ai/cron/cleanup-optimizer-history-30d:
 *   get:
 *     summary: Delete optimizer history older than 30 days
 *     description: Deletes all optimizer_history entries older than 30 days. Intended for scheduled cron.
 *     tags:
 *       - AI
 *     responses:
 *       200:
 *         description: Cleanup completed
 *       401:
 *         description: Unauthorized when CRON_SECRET is set and missing/invalid
 *       500:
 *         description: Internal server error
 */
aiRouter.get("/cron/cleanup-optimizer-history-30d", cleanupOldOptimizerHistoryController);

export default aiRouter;
