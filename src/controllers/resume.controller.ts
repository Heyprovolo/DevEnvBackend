import type { Request, Response } from "express";
import multer from "multer";
import { newErrorResponse, newSuccessResponse } from "../utils/apiResponse.ts";
import type { SaveResumeRequest, Resume } from "../types/resume.ts";
import { resumeService } from "../services/resume.service.ts";
import { fetchLinkedInFromDataMagnet } from "../services/datamagnet.service.ts";
import { importResumeFromPdf } from "../services/resume-import.service.ts";
import { getFirestore } from "firebase-admin/firestore";
import { getFirebaseApp } from "../utils/getFirebaseApp.ts";

const MAX_RESUME_IMPORT_SIZE = 5 * 1024 * 1024;

const resumePdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_RESUME_IMPORT_SIZE,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    const isPdf =
      file.mimetype === "application/pdf" || /\.pdf$/i.test(file.originalname);

    if (!isPdf) {
      callback(new Error("Only PDF resumes are supported"));
      return;
    }

    callback(null, true);
  },
}).single("resume");

function runResumePdfUpload(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    resumePdfUpload(req, res, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export const saveResume = async (req: Request, res: Response) => {
  try {
    const { resumeId, title, content, template, latex, sectionOrder } =
      req.body as SaveResumeRequest;
    const uid = req.userID;

    if (!uid) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));
    }

    if (!content) {
      return res
        .status(400)
        .json(newErrorResponse("Bad Request", "Content is required"));
    }

    const resumeData: Partial<Resume> = {
      title: title || "Untitled Resume",
      template: template || "classic",
      content,
    };

    if (typeof latex === "string") resumeData.latex = latex;
    if (Array.isArray(sectionOrder)) resumeData.sectionOrder = sectionOrder;

    if (resumeId) {
      try {
        await resumeService.updateResume(uid, resumeId, resumeData);
        return res.json(
          newSuccessResponse("Success", "Resume updated successfully", {
            id: resumeId,
          }),
        );
      } catch (error: any) {
        if (
          error.message === "Resume not found" ||
          error.message === "Unauthorized access to this resume"
        ) {
          return res
            .status(error.message === "Resume not found" ? 404 : 403)
            .json(
              newErrorResponse(
                error.message === "Resume not found"
                  ? "Not Found"
                  : "Forbidden",
                error.message,
              ),
            );
        }
        throw error;
      }
    } else {
      try {
        const quotaResult = await resumeService.validateResumeQuota(uid);
        if (!quotaResult.allowed) {
          const limitText =
            quotaResult.limit === -1
              ? "unlimited"
              : quotaResult.limit.toString();
          return res
            .status(429)
            .json(
              newErrorResponse(
                "Quota Exceeded",
                `You’ve used up your available monthly resume creation quota. Please upgrade your plan for unlimited resumes. Current usage: ${quotaResult.count}/${limitText}.`,
              ),
            );
        }
      } catch (err) {
        console.error("Quota check error:", err);
        return res
          .status(500)
          .json(
            newErrorResponse("Internal Server Error", "Failed to check quota"),
          );
      }

      const newResume = await resumeService.createResume(uid, resumeData);

      return res.json(
        newSuccessResponse("Success", "Resume created successfully", {
          id: newResume.id,
        }),
      );
    }
  } catch (error) {
    console.error("Save Resume Error:", error);
    return res
      .status(500)
      .json(newErrorResponse("Internal Server Error", "Failed to save resume"));
  }
};

export const listResumes = async (req: Request, res: Response) => {
  try {
    const uid = req.userID;
    if (!uid) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));
    }

    const resumes = await resumeService.getResumes(uid);

    return res.json(
      newSuccessResponse("Success", "Resumes fetched successfully", resumes),
    );
  } catch (error) {
    console.error("List Resumes Error:", error);
    return res
      .status(500)
      .json(
        newErrorResponse("Internal Server Error", "Failed to fetch resumes"),
      );
  }
};

export const getResumeById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const uid = req.userID;

    if (!uid) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));
    }

    if (!id) {
      return res
        .status(400)
        .json(newErrorResponse("Bad Request", "Resume ID is required"));
    }

    try {
      const resume = await resumeService.getResumeById(uid, id);
      return res.json(
        newSuccessResponse("Success", "Resume fetched successfully", resume),
      );
    } catch (error: any) {
      if (
        error.message === "Resume not found" ||
        error.message === "Unauthorized access to this resume"
      ) {
        return res
          .status(error.message === "Resume not found" ? 404 : 403)
          .json(
            newErrorResponse(
              error.message === "Resume not found" ? "Not Found" : "Forbidden",
              error.message,
            ),
          );
      }
      throw error;
    }
  } catch (error) {
    console.error("Get Resume Error:", error);
    return res
      .status(500)
      .json(newErrorResponse("Internal Server Error", "Error fetching resume"));
  }
};

export const deleteResume = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const uid = req.userID;

    if (!uid) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));
    }

    if (!id) {
      return res
        .status(400)
        .json(newErrorResponse("Bad Request", "Resume ID is required"));
    }

    try {
      await resumeService.deleteResume(uid, id);
      return res.json(
        newSuccessResponse("Success", "Resume deleted successfully", {
          id,
        }),
      );
    } catch (error: any) {
      if (
        error.message === "Resume not found" ||
        error.message === "Unauthorized access to this resume"
      ) {
        return res
          .status(error.message === "Resume not found" ? 404 : 403)
          .json(
            newErrorResponse(
              error.message === "Resume not found" ? "Not Found" : "Forbidden",
              error.message,
            ),
          );
      }
      throw error;
    }
  } catch (error) {
    console.error("Delete Resume Error:", error);
    return res
      .status(500)
      .json(
        newErrorResponse("Internal Server Error", "Failed to delete resume"),
      );
  }
};

const extractLinkedInUsername = (url: string): string | null => {
  const regex = /https:\/\/(www\.)?linkedin\.com\/in\/([^/?]+)/;
  const match = url.match(regex);
  if (match && match[2]) {
    return match[2];
  }
  return null;
};

export const scrapeLinkedIn = async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    const uid = req.userID;

    /* Temporarily disabled for testing
    if (!uid) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));
    }
    */

    if (!url) {
      return res
        .status(400)
        .json(newErrorResponse("Bad Request", "LinkedIn URL is required"));
    }

    const username = extractLinkedInUsername(url);
    if (!username) {
      return res
        .status(400)
        .json(newErrorResponse("Bad Request", "Invalid LinkedIn URL"));
    }

    // 1. Quota Check - Can they generate a resume from LinkedIn?
    if (uid) {
      const quotaResult = await resumeService.validateResumeQuota(uid);
      if (!quotaResult.allowed) {
        const limitText =
          quotaResult.limit === -1 ? "unlimited" : quotaResult.limit.toString();
        return res
          .status(429)
          .json(
            newErrorResponse(
              "Quota Exceeded",
              `You've used up your available monthly resume creation quota. Please upgrade your plan. Current usage: ${quotaResult.count}/${limitText}.`,
            ),
          );
      }
    }

    // 2. Cache Check in Firestore
    const db = getFirestore(getFirebaseApp());
    const cacheRef = db.collection("linkedin_profiles").doc(username);
    const cacheDoc = await cacheRef.get();

    console.log(
      `[LinkedInController] Requesting scrape for: ${url} (Username: ${username})`,
    );

    if (cacheDoc.exists) {
      console.log(
        `[LinkedInController] Cache found for ${username}. Checking age...`,
      );
      const cachedData = cacheDoc.data();
      const updatedAt = cachedData?.updatedAt?.toDate
        ? cachedData.updatedAt.toDate()
        : new Date(0);

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      if (updatedAt > sevenDaysAgo) {
        console.log(`[LinkedInController] Serving fresh cache for ${username}`);
        return res.json(
          newSuccessResponse(
            "Success",
            "LinkedIn profile fetched from cache successfully",
            cachedData?.profileData,
          ),
        );
      }
      console.log(
        `[LinkedInController] Cache for ${username} is stale (> 7 days). Re-scraping...`,
      );
    }

    // 3. Scrape if not cached or cache is stale
    console.log(`[LinkedInController] Calling fetchLinkedInFromDataMagnet...`);
    const data = await fetchLinkedInFromDataMagnet(url);

    // 4. Save to Cache
    console.log(
      `[LinkedInController] Saving scraped data to Firestore for ${username}`,
    );
    await cacheRef.set({
      username,
      profileData: data,
      updatedAt: new Date(),
    });

    console.log(
      `[LinkedInController] Sending final profile data to frontend:`,
      JSON.stringify(data, null, 2),
    );

    return res.json(
      newSuccessResponse(
        "Success",
        "LinkedIn profile scraped successfully",
        data,
      ),
    );
  } catch (error: any) {
    console.error("Scrape LinkedIn Error:", error);

    // Pass along specific errors from the service
    if (error.message.includes("authentication failed")) {
      return res
        .status(401)
        .json(
          newErrorResponse(
            "Unauthorized",
            "LinkedIn authentication failed on the server. Admin needs to refresh session cookies.",
          ),
        );
    } else if (error.message.includes("rate limit exceeded")) {
      return res
        .status(429)
        .json(
          newErrorResponse(
            "Too Many Requests",
            "LinkedIn scraper rate limit exceeded.",
          ),
        );
    }

    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "Failed to scrape LinkedIn profile: " + error.message,
        ),
      );
  }
};

export const importResumePdf = async (req: Request, res: Response) => {
  try {
    const uid = req.userID;

    if (!uid) {
      return res
        .status(401)
        .json(newErrorResponse("Unauthorized", "User not authenticated"));
    }

    await runResumePdfUpload(req, res);

    if (!req.file) {
      return res
        .status(400)
        .json(newErrorResponse("Bad Request", "Resume PDF is required"));
    }

    const importedResume = await importResumeFromPdf(
      req.file.buffer,
      req.file.originalname,
    );

    return res.json(
      newSuccessResponse(
        "Success",
        "Resume PDF imported successfully",
        importedResume,
      ),
    );
  } catch (error) {
    console.error("Import Resume PDF Error:", error);

    if (error instanceof multer.MulterError) {
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? "Resume PDF exceeds the 5MB upload limit"
          : error.message;

      return res.status(400).json(newErrorResponse("Bad Request", message));
    }

    if (error instanceof Error) {
      return res
        .status(400)
        .json(newErrorResponse("Bad Request", error.message));
    }

    return res
      .status(500)
      .json(
        newErrorResponse(
          "Internal Server Error",
          "Failed to import resume PDF",
        ),
      );
  }
};
