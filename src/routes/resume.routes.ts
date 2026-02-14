import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { authMiddleware } from "../middlewares/auth.middleware.ts";
import {
  saveResume,
  listResumes,
  getResumeById,
  deleteResume,
} from "../controllers/resume.controller.ts";

const resumeRouter: ExpressRouter = Router();

/**
 * @openapi
 * /api/v1/resumes/save:
 *   post:
 *     summary: Create or Update a Resume
 *     description: Save a resume. If resumeId is provided, it updates the existing resume. Otherwise, creates a new one.
 *     tags:
 *       - Resumes
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               resumeId:
 *                 type: string
 *                 description: Optional ID for updating an existing resume
 *               title:
 *                 type: string
 *               template:
 *                 type: string
 *               content:
 *                 $ref: "#/components/schemas/ResumeContent"
 *     responses:
 *       200:
 *         description: Resume saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiResponse"
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal Server Error
 */
resumeRouter.post("/save", authMiddleware, saveResume);

/**
 * @openapi
 * /api/v1/resumes/list:
 *   get:
 *     summary: List all resumes for the user
 *     description: Returns a list of all resumes belonging to the authenticated user.
 *     tags:
 *       - Resumes
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of resumes retrieved
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: "#/components/schemas/ApiResponse"
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: "#/components/schemas/Resume"
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal Server Error
 */
resumeRouter.get("/list", authMiddleware, listResumes);

/**
 * @openapi
 * /api/v1/resumes/:id:
 *   get:
 *     summary: Get a resume by ID
 *     description: Retrieve full details of a specific resume.
 *     tags:
 *       - Resumes
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Resume ID
 *     responses:
 *       200:
 *         description: Resume retrieved
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: "#/components/schemas/ApiResponse"
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: "#/components/schemas/Resume"
 *       404:
 *         description: Resume not found
 *       403:
 *         description: Forbidden
 *       401:
 *         description: Unauthorized
 */
resumeRouter.get("/:id", authMiddleware, getResumeById);

/**
 * @openapi
 * /api/v1/resumes/:id:
 *   delete:
 *     summary: Delete a resume
 *     description: Delete a specific resume by ID.
 *     tags:
 *       - Resumes
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Resume ID
 *     responses:
 *       200:
 *         description: Resume deleted successfully
 *       404:
 *         description: Resume not found
 *       403:
 *         description: Forbidden
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal Server Error
 */
resumeRouter.delete("/:id", authMiddleware, deleteResume);

export default resumeRouter;
