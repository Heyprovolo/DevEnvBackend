import axios from "axios";

const extractLinkedInUsername = (url: string): string | null => {
  const regex = /https:\/\/(www\.)?linkedin\.com\/in\/([^/?]+)/;
  const match = url.match(regex);
  if (match && match[2]) {
    return match[2];
  }
  return null;
};

// Generic User-Agent matching a modern Mac Chrome Browser
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36";

export const scrapeLinkedInProfile = async (url: string) => {
  const username = extractLinkedInUsername(url);

  if (!username) {
    throw new Error("Invalid LinkedIn URL. Could not extract username.");
  }

  const liAtCookie = process.env.LINKEDIN_LI_AT;
  const jsessionidCookie = process.env.LINKEDIN_JSESSIONID;

  if (!liAtCookie || !jsessionidCookie) {
    throw new Error(
      "LinkedIn authentication cookies (LINKEDIN_LI_AT or LINKEDIN_JSESSIONID) are not set in the environment.",
    );
  }

  const csrfToken = jsessionidCookie.replace(/"/g, "");
  const baseUrl = `https://www.linkedin.com/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${username}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-101&count=100`;

  const headers = {
    "User-Agent": USER_AGENT,
    Cookie: `li_at=${liAtCookie}; JSESSIONID="${csrfToken}"`,
    "csrf-token": csrfToken,
    accept: "application/vnd.linkedin.normalized+json+2.1",
    "x-li-lang": "en_US",
    "x-restli-protocol-version": "2.0.0",
  };

  try {
    const response = await axios.get(baseUrl, {
      headers,
      maxRedirects: 0,
    });

    if (!response.data) {
      throw new Error("LinkedIn returned an empty response.");
    }

    const rawData = response.data;
    const included = rawData.included || [];

    // In normalized JSON, we look for the main Profile object in the 'included' array
    const profile = included.find(
      (item: any) =>
        item.$type === "com.linkedin.voyager.dash.identity.profile.Profile" ||
        item.publicIdentifier === username
    );

    if (!profile) {
      console.error(
        "LinkedIn profile object not found in response. Data excerpt:",
        JSON.stringify(rawData).substring(0, 1000)
      );
      throw new Error("LinkedIn profile data could not be found or extracted.");
    }

    // Helper to find related entities in the included array
    const findInIncluded = (type: string) =>
      included.filter((item: any) => item.$type === type);

    const extractedData: any = {
      firstName: profile.firstName || "",
      lastName: profile.lastName || "",
      headline: profile.headline || "",
      summary: profile.summary || "",
      username: profile.publicIdentifier || "",
      locationName: profile.locationName || "",
      industry: profile.industryName || "",
      avatarUrl: "", // We can try to find this later if needed
      education: [],
      experience: [],
    };

    // Extract Experience
    const positions = findInIncluded("com.linkedin.voyager.dash.identity.profile.Position");
    extractedData.experience = positions.map((pos: any) => ({
      title: pos.title || "",
      company: pos.companyName || "",
      description: pos.description || "",
      location: pos.locationName || "",
    }));

    // Extract Education
    const education = findInIncluded("com.linkedin.voyager.dash.identity.profile.Education");
    extractedData.education = education.map((edu: any) => ({
      school: edu.schoolName || "",
      degree: edu.degreeName || "",
      fieldOfStudy: edu.fieldOfStudy || "",
      description: edu.description || "",
    }));

    return extractedData;
  } catch (error: any) {
    console.error("LinkedIn Scraper Full Error:", error.message);
    if (error.response) {
      console.error("LinkedIn Scraper Response Status:", error.response.status);
      console.error(
        "LinkedIn Scraper Response Data Snapshot:",
        JSON.stringify(error.response.data).substring(0, 1000)
      );
    }

    if (error.response?.status === 302 || error.response?.status === 303) {
      throw new Error(
        "LinkedIn authentication failed. The session cookies are invalid or expired."
      );
    }

    if ([401, 403, 400].includes(error.response?.status)) {
      throw new Error("LinkedIn authentication failed. Cookies might be blocked.");
    } else if (error.response?.status === 429) {
      throw new Error("LinkedIn rate limit exceeded.");
    } else if (error.response?.status === 404) {
      throw new Error("LinkedIn profile not found.");
    }

    throw new Error(`Failed to scrape LinkedIn profile. Reason: ${error.message}`);
  }
};
