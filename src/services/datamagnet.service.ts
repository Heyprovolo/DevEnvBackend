import axios from "axios";

/**
 * DataMagnet API Response Schema (Complete based on user documentation)
 */
interface DataMagnetPersonResponse {
  message: {
    first_name: string;
    middle_name?: string;
    last_name: string;
    full_name: string;
    display_name: string;
    profile_headline: string;
    job_title: string;
    description: string;
    location: string;
    country: string;
    username: string;
    email?: string;
    avatar_url: string;
    education: Array<{
      school_name: string;
      degree?: string;
      field_of_study?: string;
      job_started_on?: string;
      job_ended_on?: string;
      job_description?: string[];
      job_location?: string;
    }>;
    experience: Array<{
      job_title: string;
      company_name: string;
      job_started_on?: string;
      job_ended_on?: string;
      job_still_working?: boolean;
      job_description?: string[];
      job_location?: string;
    }>;
    [key: string]: any;
  };
}

/**
 * Common format for the rest of the application
 */
export interface ScrapedProfile {
  firstName: string;
  lastName: string;
  headline: string;
  summary: string;
  username: string;
  locationName: string;
  country: string;
  avatarUrl: string;
  email: string;
  education: Array<{
    institution: string; // Corrected from school
    degree: string;
    fieldOfStudy: string;
    description: string;
    startDate?: string;
    endDate?: string;
    location?: string; // Added location for education
  }>;
  experience: Array<{
    position: string; // Corrected from title
    company: string;
    description: string;
    startDate?: string;
    endDate?: string;
    location?: string;
    current?: boolean;
  }>;
  raw?: any;
}

/**
 * Normalizes date string to YYYY-MM for the frontend month input
 */
const normalizeDate = (dateStr: string | undefined): string => {
  if (!dateStr || dateStr.trim() === "") return "";

  try {
    const parts = dateStr.split(/[-/]/).filter((p) => p.trim() !== "");
    if (parts.length >= 2) {
      const p0 = parts[0] || "";
      const p1 = parts[1] || "";
      const plast = parts[parts.length - 1] || "";

      const year = p0.length === 4 ? p0 : plast;
      const month = p0.length === 4 ? p1 : p0;

      if (year && month) {
        const paddedMonth = month.padStart(2, "0");
        return `${year}-${paddedMonth}`;
      }
    }
    return dateStr;
  } catch (e) {
    return dateStr;
  }
};

export const fetchLinkedInFromDataMagnet = async (
  url: string
): Promise<ScrapedProfile> => {
  const apiKey = process.env.DATAMAGNET_API_KEY;

  if (!apiKey) {
    throw new Error(
      "DATAMAGNET_API_KEY is not configured in the backend environment."
    );
  }

  try {
    console.log(`[DataMagnet] Fetching profile for URL: ${url}`);

    const response = await axios.post<DataMagnetPersonResponse>(
      "https://api.datamagnet.co/api/v1/linkedin/person",
      {
        url,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    const data = response.data.message;
    console.log(
      "[DataMagnet] Full RAW Response Message:",
      JSON.stringify(response.data, null, 2)
    );
    console.log("[DataMagnet] Response mapping for:", data.full_name);

    // Map DataMagnet schema to internal ScrapedProfile schema
    const profile: ScrapedProfile = {
      firstName: data.first_name || "",
      lastName: data.last_name || "",
      headline: data.profile_headline || data.job_title || "",
      summary: data.description || "",
      username: data.username || "",
      locationName: data.location || "",
      country: data.country || "",
      avatarUrl: data.avatar_url || "",
      email: data.email || "",
      education: (data.education || [])
        .map((edu) => ({
          institution: edu.school_name || "",
          degree: edu.degree || "",
          fieldOfStudy: edu.field_of_study || "",
          description: Array.isArray(edu.job_description)
            ? edu.job_description.join("\n")
            : "",
          startDate: normalizeDate(edu.job_started_on),
          endDate: normalizeDate(edu.job_ended_on),
          location: edu.job_location || "",
        }))
        .filter(
          (edu) => edu.institution.trim() !== "" || edu.degree.trim() !== ""
        ),
      experience: (data.experience || [])
        .map((exp) => ({
          position: exp.job_title || "",
          company: exp.company_name || "",
          description: Array.isArray(exp.job_description)
            ? exp.job_description.join("\n")
            : "",
          startDate: normalizeDate(exp.job_started_on),
          endDate: normalizeDate(exp.job_ended_on),
          location: exp.job_location || "",
          current: !!exp.job_still_working || !exp.job_ended_on,
        }))
        .filter(
          (exp) => exp.position.trim() !== "" || exp.company.trim() !== ""
        ),
      raw: data,
    };

    return profile;
  } catch (error: any) {
    console.error(
      "DataMagnet API Error Detail:",
      error.response?.data || error.message
    );

    if (error.response?.status === 401 || error.response?.status === 403) {
      throw new Error(
        "DataMagnet API authentication failed. Please check your API key."
      );
    }

    if (error.response?.status === 429) {
      throw new Error("DataMagnet API rate limit exceeded or out of credits.");
    }

    throw new Error(
      `Failed to fetch profile from DataMagnet: ${error.message}`
    );
  }
};
