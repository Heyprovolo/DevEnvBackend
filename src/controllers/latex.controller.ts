import type { Request, Response } from "express";
import { newErrorResponse } from "../utils/apiResponse.ts";
import { compileToPdf } from "../services/latex.service.ts";

export const compileLatex = async (req: Request, res: Response) => {
  try {
    const uid = req.userID;

    if (!uid) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));
    }

    const { latexContent } = req.body;

    if (!latexContent || typeof latexContent !== "string") {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Bad Request",
            "latexContent is required and must be a string",
          ),
        );
    }

    const pdfBuffer = await compileToPdf(latexContent);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=resume.pdf");
    return res.send(pdfBuffer);
  } catch (error: any) {
    console.error("LaTeX Compilation Error:", error);

    const isSanitizationError =
      error.message?.includes("Forbidden") ||
      error.message?.includes("exceeds maximum") ||
      error.message?.includes("non-empty string");

    return res
      .status(isSanitizationError ? 400 : 500)
      .json(
        newErrorResponse(
          isSanitizationError ? "Bad Request" : "Compilation Error",
          error.message || "Failed to compile LaTeX",
        ),
      );
  }
};
