import "dotenv/config";
import { getFirebaseApp, closeFirebaseApp } from "../utils/getFirebaseApp.ts";
import { getFirestore } from "firebase-admin/firestore";
import type { Feature, Tier } from "../types/tiers.ts";

const tiers: Tier[] = [
  {
    name: "Starter (Freemium)",
    slug: "starter",
    description: "Perfect for new freelancers and those exploring the platform.",
    recurringInterval: "monthly",
    price: 0,
    polarRefId: "fbba796c-931a-4074-bf57-e8c4007db387",
    features: [
      {
        name: "Upwork Profile Optimizer",
        description: "Limited access to the Upwork Profile Optimizer feature.",
        slug: "upwork_profile_optimizer",
        limited: true,
        recurringInterval: "daily",
        maxQuota: 2,
      },
      {
        name: "Comunity Access",
        description: "Community Access.",
        slug: "comunity_access",
        limited: false,
        recurringInterval: "",
        maxQuota: 0,
      },
      {
        name: "Newsletters & Provolo Notes",
        description: "Newsletters.",
        slug: "newsletters",
        limited: false,
        recurringInterval: "",
        maxQuota: 0,
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    name: "Plus",
    slug: "plus",
    description: "For freelancers actively applying for jobs and serious about getting clients.",
    recurringInterval: "monthly",
    price: 399,
    polarRefId: "9d1a3ad1-5bd7-48c3-aef0-b4ea80d4ec79",
    features: [
      {
        name: "Upwork Profile Optimizer",
        description: "Full access to the Upwork Profile Optimizer feature.",
        slug: "upwork_profile_optimizer",
        limited: false,
        recurringInterval: "",
        maxQuota: -1,
      },
      {
        name: "LinkedIn Profile Optimizer",
        description: "Access to the LinkedIn Profile Optimizer feature.",
        slug: "linkedin_profile_optimizer",
        limited: false,
        recurringInterval: "",
        maxQuota: -1,
      },
      {
        name: "Optimization History",
        description: "Track all your profile optimizations and review past versions.",
        slug: "optimization_history",
        limited: false,
        recurringInterval: "",
        maxQuota: -1,
      },
      {
        name: "Proposal History",
        description: "Review and learn from all your past proposals.",
        slug: "proposal_history",
        limited: false,
        recurringInterval: "",
        maxQuota: -1,
      },
      {
        name: "Access to the most capable AI-Powered Proposals Generator",
        description: "Unlimited AI Proposals per month.",
        slug: "ai_proposals",
        limited: false,
        recurringInterval: "",
        maxQuota: -1,
      },
      {
        name: "Provolo Learn Early Community Access",
        description: "Community Access.",
        slug: "comunity_access",
        limited: false,
        recurringInterval: "",
        maxQuota: -1,
      },
      {
        name: "Newsletters & Provolo Notes",
        description: "Newsletters.",
        slug: "newsletters",
        limited: false,
        recurringInterval: "",
        maxQuota: -1,
      },
      {
        name: "Freelancer Growth Tools",
        description: "Access to the Freelancer Growth Tools.",
        slug: "freelancer_growth_tools",
        limited: false,
        recurringInterval: "",
        maxQuota: -1,
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    name: "Plus",
    slug: "plusAnnual",
    description: "For freelancers actively applying for jobs and serious about getting clients.",
    recurringInterval: "yearly",
    price: 4300,
    polarRefId: "ee5f12df-ec1e-4fdc-b22c-6253cae9cf0d",
    features: [
      {
        name: "Upwork Profile Optimizer",
        description: "Full access to the Upwork Profile Optimizer feature.",
        slug: "upwork_profile_optimizer",
        limited: false,
        recurringInterval: "",
        maxQuota: -1,
      },
      {
        name: "LinkedIn Profile Optimizer",
        description: "Access to the LinkedIn Profile Optimizer feature.",
        slug: "linkedin_profile_optimizer",
        limited: false,
        recurringInterval: "",
        maxQuota: -1,
      },
      {
        name: "Optimization History",
        description: "Track all your profile optimizations and review past versions.",
        slug: "optimization_history",
        limited: false,
        recurringInterval: "",
        maxQuota: -1,
      },
      {
        name: "Proposal History",
        description: "Review and learn from all your past proposals.",
        slug: "proposal_history",
        limited: false,
        recurringInterval: "",
        maxQuota: -1,
      },
      {
        name: "Access to the most capable AI-Powered Proposals Generator",
        description: "Unlimited AI Proposals per month.",
        slug: "ai_proposals",
        limited: false,
        recurringInterval: "",
        maxQuota: -1,
      },
      {
        name: "Provolo Learn Early Community Access",
        description: "Community Access.",
        slug: "comunity_access",
        limited: false,
        recurringInterval: "",
        maxQuota: -1,
      },
      {
        name: "Newsletters & Provolo Notes",
        description: "Newsletters.",
        slug: "newsletters",
        limited: false,
        recurringInterval: "",
        maxQuota: -1,
      },
      {
        name: "Freelancer Growth Tools",
        description: "Access to the Freelancer Growth Tools.",
        slug: "freelancer_growth_tools",
        limited: false,
        recurringInterval: "",
        maxQuota: -1,
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

function validateFeatures(features: Feature[]): string | null {
  for (const f of features) {
    if (f.limited) {
      if (f.maxQuota <= 0) return `feature ${f.slug} is limited but maxQuota is not set`;
      if (!f.recurringInterval)
        return `feature ${f.slug} is limited but recurringInterval is not set`;
    } else {
      if (f.maxQuota !== 0 && f.maxQuota !== -1) {
        return `feature ${f.slug} is not limited but maxQuota is not 0 or -1`;
      }
      if (f.recurringInterval !== "") {
        return `feature ${f.slug} is not limited but recurringInterval is set`;
      }
    }
  }
  return null;
}

export async function seedTiers() {
  const app = getFirebaseApp();
  const db = getFirestore(app);

  for (const tier of tiers) {
    const error = validateFeatures(tier.features);
    if (error) {
      console.error(`Validation failed for tier ${tier.slug}: ${error}`);
      continue;
    }
    tier.createdAt = new Date();
    tier.updatedAt = new Date();

    try {
      await db.collection("tiers").doc(tier.slug).set(tier);
      console.log(`Seeded tier: ${tier.slug}`);
    } catch (err) {
      console.error(`Error seeding tier ${tier.slug}:`, err);
    }
  }
  closeFirebaseApp();
  console.log("Seeding completed ✅");
}
