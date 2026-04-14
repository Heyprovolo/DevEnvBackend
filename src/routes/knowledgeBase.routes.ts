import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import {
  authMiddleware,
  emailVerificationMiddleware,
} from "../middlewares/auth.middleware.ts";
import {
  getKnowledgeBase,
  patchKnowledgeBase,
  importKnowledgeBase,
  manualUpdateKnowledgeBase,
} from "../controllers/knowledgeBase.controller.ts";

const knowledgeBaseRouter: ExpressRouter = Router();

/**
 * @swagger
 * /api/v1/knowledge-base:
 *   get:
 *     summary: Get unified knowledge base for the authenticated user
 *     description: >
 *       Returns account fields from the user profile, editable knowledge sections from Firestore,
 *       and read-only enrichment from recent profile optimizations and proposals (truncated for size).
 *       Profile completion is computed from 10 binary checks (10 points each): display name,
 *       professional title, summary, experience, skills, education, certifications, projects,
 *       portfolio link, and (location or years of experience).
 *     tags:
 *       - Knowledge Base
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Knowledge base retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 title:
 *                   type: string
 *                   example: Success
 *                 message:
 *                   type: string
 *                   example: Knowledge base retrieved
 *                 status:
 *                   type: string
 *                   enum: [success, error]
 *                 data:
 *                   $ref: '#/components/schemas/KnowledgeBaseGetResponse'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
knowledgeBaseRouter.get(
  "/",
  authMiddleware,
  emailVerificationMiddleware,
  getKnowledgeBase,
);

/**
 * @swagger
 * /api/v1/knowledge-base:
 *   patch:
 *     summary: Update knowledge base sections
 *     description: >
 *       Partial update. Only keys present in the body are applied; others remain unchanged.
 *       When a list field is sent, it replaces the existing list. Validation limits apply
 *       (e.g. professionalSummary max 10000 characters, each array max 50 items).
 *     tags:
 *       - Knowledge Base
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/KnowledgeBasePatchBody'
 *     responses:
 *       200:
 *         description: Knowledge base updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 title:
 *                   type: string
 *                 message:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [success, error]
 *                 data:
 *                   type: object
 *                   properties:
 *                     knowledge:
 *                       $ref: '#/components/schemas/KnowledgeBaseSections'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
knowledgeBaseRouter.patch(
  "/",
  authMiddleware,
  emailVerificationMiddleware,
  patchKnowledgeBase,
);

/**
 * @swagger
 * /api/v1/knowledge-base/import:
 *   post:
 *     summary: Import knowledge from resume and/or optimizer history
 *     description: >
 *       Merges data into the user's knowledge_base document. With overwrite=false (default),
 *       only empty fields are filled from the import source. With overwrite=true, resume import
 *       replaces the structured sections from that resume; optimizer import replaces or fills
 *       professionalSummary. Source "all" attempts resume first, then applies optimizer enrichment.
 *     tags:
 *       - Knowledge Base
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/KnowledgeBaseImportBody'
 *     responses:
 *       200:
 *         description: Import completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 title:
 *                   type: string
 *                 message:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [success, error]
 *                 data:
 *                   type: object
 *                   properties:
 *                     knowledge:
 *                       $ref: '#/components/schemas/KnowledgeBaseSections'
 *       400:
 *         description: Invalid body or nothing to import
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
knowledgeBaseRouter.post(
  "/import",
  authMiddleware,
  emailVerificationMiddleware,
  importKnowledgeBase,
);

/**
 * @swagger
 * /api/v1/knowledge-base/manual-update:
 *   post:
 *     summary: Manually update knowledge base sections
 *     description: >
 *       Explicit manual update endpoint for knowledge base fields.
 *       Accepts partial section data and applies only provided keys.
 *       Uses the same validation limits as PATCH knowledge-base.
 *     tags:
 *       - Knowledge Base
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/KnowledgeBasePatchBody'
 *     responses:
 *       200:
 *         description: Knowledge base manually updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 title:
 *                   type: string
 *                   example: Success
 *                 message:
 *                   type: string
 *                   example: Knowledge base manually updated
 *                 status:
 *                   type: string
 *                   enum: [success, error]
 *                 data:
 *                   type: object
 *                   properties:
 *                     knowledge:
 *                       $ref: '#/components/schemas/KnowledgeBaseSections'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
knowledgeBaseRouter.post(
  "/manual-update",
  authMiddleware,
  emailVerificationMiddleware,
  manualUpdateKnowledgeBase,
);

export default knowledgeBaseRouter;
