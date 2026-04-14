import type { Request, Response } from "express";
import { newErrorResponse, newSuccessResponse } from "../utils/apiResponse.ts";
import { knowledgeBaseService } from "../services/knowledgeBase.service.ts";
import type { KnowledgeBaseImportBody } from "../types/knowledge-base.ts";
import { timedDb } from "../middlewares/observability.middleware.ts";

export async function getKnowledgeBase(req: Request, res: Response) {
  try {
    const userId = req.userID;
    if (!userId) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));
    }

    const data = await timedDb(req, () =>
      knowledgeBaseService.getMergedResponse(
        userId,
        req.userEmail,
        req.userDisplayName,
      ),
    );

    return res.json(
      newSuccessResponse("Success", "Knowledge base retrieved", data),
    );
  } catch (err) {
    console.error("[getKnowledgeBase]", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "Failed to load knowledge base",
        ),
      );
  }
}

export async function patchKnowledgeBase(req: Request, res: Response) {
  try {
    const userId = req.userID;
    if (!userId) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));
    }

    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== "object") {
      return res
        .status(400)
        .json(newErrorResponse("Bad Request", "JSON body required"));
    }

    const result = await timedDb(req, () =>
      knowledgeBaseService.patch(userId, body),
    );

    if ("error" in result && typeof result.error === "string") {
      return res
        .status(400)
        .json(newErrorResponse("Validation Error", result.error));
    }

    return res.json(
      newSuccessResponse("Success", "Knowledge base updated", {
        knowledge: result,
      }),
    );
  } catch (err) {
    console.error("[patchKnowledgeBase]", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "Failed to update knowledge base",
        ),
      );
  }
}

export async function importKnowledgeBase(req: Request, res: Response) {
  try {
    const userId = req.userID;
    if (!userId) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));
    }

    const body = req.body as KnowledgeBaseImportBody;
    if (!body?.source || typeof body.source !== "string") {
      return res
        .status(400)
        .json(
          newErrorResponse(
            "Bad Request",
            "source is required (resume | optimizer | all)",
          ),
        );
    }

    const allowed = ["resume", "optimizer", "all"];
    if (!allowed.includes(body.source)) {
      return res
        .status(400)
        .json(newErrorResponse("Bad Request", "Invalid source"));
    }

    const result = await timedDb(req, () =>
      knowledgeBaseService.importFromSources(userId, body),
    );

    if ("error" in result && typeof result.error === "string") {
      return res
        .status(400)
        .json(newErrorResponse("Import Failed", result.error));
    }

    return res.json(
      newSuccessResponse("Success", "Knowledge base imported", {
        knowledge: result,
      }),
    );
  } catch (err) {
    console.error("[importKnowledgeBase]", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "Failed to import knowledge base",
        ),
      );
  }
}

export async function manualUpdateKnowledgeBase(req: Request, res: Response) {
  try {
    const userId = req.userID;
    if (!userId) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));
    }

    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== "object") {
      return res
        .status(400)
        .json(newErrorResponse("Bad Request", "JSON body required"));
    }

    const result = await timedDb(req, () => knowledgeBaseService.patch(userId, body));
    if ("error" in result && typeof result.error === "string") {
      return res
        .status(400)
        .json(newErrorResponse("Validation Error", result.error));
    }

    return res.json(
      newSuccessResponse("Success", "Knowledge base manually updated", {
        knowledge: result,
      }),
    );
  } catch (err) {
    console.error("[manualUpdateKnowledgeBase]", err);
    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "Failed to manually update knowledge base",
        ),
      );
  }
}
