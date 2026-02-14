import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { authMiddleware } from "../middlewares/auth.middleware.ts";
import { compileLatex } from "../controllers/latex.controller.ts";

const latexRouter: ExpressRouter = Router();

/**
 * @openapi
 * /api/v1/latex/compile:
 *   post:
 *     summary: Compile LaTeX to PDF
 *     description: Receives a LaTeX string and returns a compiled PDF binary.
 *     tags:
 *       - LaTeX
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - latexContent
 *             properties:
 *               latexContent:
 *                 type: string
 *                 description: The raw LaTeX content to compile
 *     responses:
 *       200:
 *         description: PDF generated successfully
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Invalid or dangerous LaTeX content
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: LaTeX compilation failed
 */
latexRouter.post("/compile", authMiddleware, compileLatex);

export default latexRouter;
