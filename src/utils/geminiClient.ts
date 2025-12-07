import { gemini } from "../config/gemini.config.ts";
import {
  validateAndCleanJsonResponse,
  detectSystemOverride,
  detectApiIssues,
  SystemOverrideError,
  ValidationError,
} from "./responseValidator.ts";

/**
 * Check if an error is a 400-level validation error (user/client error)
 * These errors should not be retried
 */
function is400LevelError(error: any): boolean {
  // Check for HTTP status code 400-499
  if (error?.status && error.status >= 400 && error.status < 500) {
    return true;
  }

  // Check for error codes that indicate validation errors
  if (error?.code) {
    const validationErrorCodes = [
      "INVALID_ARGUMENT",
      "PERMISSION_DENIED",
      "NOT_FOUND",
      "FAILED_PRECONDITION",
      "OUT_OF_RANGE",
      "UNAUTHENTICATED",
      "API_KEY_HTTP_REFERRER_BLOCKED",
      "API_KEY_INVALID",
    ];
    if (validationErrorCodes.includes(error.code)) {
      return true;
    }
  }

  // Check error message for validation-related keywords
  const errorMessage = error?.message?.toLowerCase() || "";
  const validationKeywords = [
    "invalid",
    "validation",
    "permission denied",
    "unauthorized",
    "forbidden",
    "not found",
    "bad request",
    "malformed",
  ];
  if (validationKeywords.some((keyword) => errorMessage.includes(keyword))) {
    return true;
  }

  return false;
}

export async function callGemini(
  prompt: string,
  systemInstruction: string,
  maxRetries: number = 1
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      console.log(`[callGemini] Attempt ${attempt}/${maxRetries + 1}`);

      const response = await gemini.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: [
          { role: "user", parts: [{ text: systemInstruction }] },
          { role: "user", parts: [{ text: prompt }] },
        ],
      });

      if (!response) {
        throw new Error("No response received from Gemini");
      }

      let responseText = "";

      if (typeof response.text === "string") {
        responseText = response.text;
      } else if (
        response.candidates &&
        response.candidates[0]?.content?.parts?.[0]?.text
      ) {
        responseText = response.candidates[0].content.parts[0].text;
      } else {
        console.error(
          "[callGemini] Unexpected response structure:",
          JSON.stringify(response, null, 2)
        );
        throw new Error("Could not extract text from Gemini response");
      }

      if (!responseText || responseText.trim().length === 0) {
        throw new Error("Empty response received from Gemini");
      }

      if (detectApiIssues(responseText)) {
        throw new Error(
          `API issue detected in response: ${responseText.substring(0, 200)}`
        );
      }

      if (detectSystemOverride(responseText)) {
        console.error(
          "[callGemini] System override detected - AI attempted to edit/ignore instructions"
        );
        throw new SystemOverrideError(
          "The prompt attempted to do something it shouldn't."
        );
      }

      const validation = validateAndCleanJsonResponse(responseText);
      if (!validation.isValid) {
        // Invalid JSON is a validation error - don't retry, throw immediately
        throw new ValidationError(`Invalid JSON response: ${validation.error}`);
      }

      console.log(
        `[callGemini] Success on attempt ${attempt}. Response length: ${responseText.length} characters`
      );
      console.log(
        `[callGemini] Response preview: ${responseText.substring(0, 100)}...`
      );

      return validation.cleanedResponse || responseText.trim();
    } catch (error) {
      // Don't retry validation errors (400-level) - throw immediately
      if (
        error instanceof SystemOverrideError ||
        error instanceof ValidationError
      ) {
        throw error;
      }

      // Check if it's a 400-level error from Gemini SDK (validation/user error)
      const isValidationError = is400LevelError(error);
      if (isValidationError) {
        throw new ValidationError(
          error instanceof Error ? error.message : String(error)
        );
      }

      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(
        `[callGemini] Attempt ${attempt} failed:`,
        lastError.message
      );

      // Only retry for 500-level errors (server errors)
      if (attempt <= maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  console.error(`[callGemini] All ${maxRetries + 1} attempts failed`);
  throw new Error(
    `Gemini API call failed after ${maxRetries + 1} attempts: ${
      lastError?.message || "Unknown error"
    }`
  );
}
