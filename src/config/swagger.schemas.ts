export const SwaggerSchemas = {
  User: {
    type: "object",
    properties: {
      id: { type: "string" },
      userId: { type: "string" },
      email: { type: "string" },
      displayName: { type: "string" },
      tierId: { type: "string" },
      subscribed: { type: "boolean" },
      createdAt: { type: "string" },
      updatedAt: { type: "string" },
    },
    required: [
      "id",
      "userId",
      "email",
      "tierId",
      "subscribed",
      "createdAt",
      "updatedAt",
    ],
  },
  Tier: {
    type: "object",
    properties: {
      name: { type: "string" },
      slug: { type: "string" },
      polarRefId: { type: "string" },
      price: { type: "number" },
      description: { type: "string" },
      recurringInterval: { type: "string", enum: ["monthly", "yearly"] },
      features: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            slug: { type: "string" },
            limited: { type: "boolean" },
            maxQuota: { type: "number" },
            recurringInterval: {
              type: "string",
              enum: ["daily", "weekly", "monthly", "yearly", ""],
            },
          },
          required: [
            "name",
            "description",
            "slug",
            "limited",
            "maxQuota",
            "recurringInterval",
          ],
        },
      },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
    required: [
      "name",
      "slug",
      "polarRefId",
      "price",
      "description",
      "recurringInterval",
      "features",
      "createdAt",
      "updatedAt",
    ],
  },
  ApiResponse: {
    type: "object",
    properties: {
      title: { type: "string" },
      message: { type: "string" },
      status: { type: "string", enum: ["success", "error"] },
      data: {
        oneOf: [
          { $ref: "#/components/schemas/User" },
          { $ref: "#/components/schemas/Tier" },
          { type: "array", items: { $ref: "#/components/schemas/Tier" } },
          { type: "null" },
          { type: "object" },
          { type: "array" },
        ],
      },
    },
    required: ["title", "message", "status", "data"],
  },
  ErrorResponse: {
    type: "object",
    properties: {
      title: { type: "string" },
      message: { type: "string" },
      status: { type: "string", enum: ["error"] },
      data: { type: "null" },
    },
    required: ["title", "message", "status", "data"],
  },
  ResumeContent: {
    type: "object",
    additionalProperties: true,
    properties: {
      personalInfo: {
        type: "object",
        properties: {
          firstName: { type: "string" },
          lastName: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          address: { type: "string" },
          city: { type: "string" },
          country: { type: "string" },
          summary: { type: "string" },
          jobTitle: { type: "string" },
          links: {
            type: "object",
            additionalProperties: { type: "string" },
          },
        },
        required: ["firstName", "lastName", "email"],
      },
      education: {
        type: "array",
        items: {
          type: "object",
          properties: {
            institution: { type: "string" },
            degree: { type: "string" },
            fieldOfStudy: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
            current: { type: "boolean" },
            description: { type: "string" },
          },
          required: ["institution", "degree"],
        },
      },
      experience: {
        type: "array",
        items: {
          type: "object",
          properties: {
            company: { type: "string" },
            position: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
            current: { type: "boolean" },
            description: { type: "string" },
            location: { type: "string" },
          },
          required: ["company", "position"],
        },
      },
      skills: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            level: {
              type: "string",
              enum: ["Beginner", "Intermediate", "Advanced", "Expert"],
            },
          },
          required: ["name"],
        },
      },
      projects: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            link: { type: "string" },
            technologies: { type: "array", items: { type: "string" } },
            startDate: { type: "string" },
            endDate: { type: "string" },
          },
          required: ["title"],
        },
      },
      languages: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            level: {
              type: "string",
              enum: ["Beginner", "Intermediate", "Advanced", "Expert"],
            },
          },
        },
      },
      certifications: { type: "array", items: { type: "object" } },
    },
    required: ["personalInfo"],
  },
  Resume: {
    type: "object",
    properties: {
      id: { type: "string" },
      userId: { type: "string" },
      title: { type: "string" },
      template: { type: "string" },
      content: { $ref: "#/components/schemas/ResumeContent" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
    required: ["userId", "title", "content"],
  },
  KnowledgeBaseCertification: {
    type: "object",
    properties: {
      name: { type: "string" },
      issuer: { type: "string" },
      issueDate: { type: "string" },
    },
    required: ["name"],
  },
  KnowledgeBaseSections: {
    type: "object",
    properties: {
      professionalSummary: { type: "string", nullable: true },
      location: { type: "string", nullable: true },
      experienceYears: { type: "integer", nullable: true, minimum: 0, maximum: 80 },
      education: {
        type: "array",
        items: {
          type: "object",
          properties: {
            institution: { type: "string" },
            degree: { type: "string" },
            fieldOfStudy: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
            current: { type: "boolean" },
            description: { type: "string" },
          },
          required: ["institution", "degree"],
        },
      },
      experience: {
        type: "array",
        items: {
          type: "object",
          properties: {
            company: { type: "string" },
            position: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
            current: { type: "boolean" },
            description: { type: "string" },
            location: { type: "string" },
          },
          required: ["company", "position"],
        },
      },
      skills: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            level: {
              type: "string",
              enum: ["Beginner", "Intermediate", "Advanced", "Expert"],
            },
          },
          required: ["name"],
        },
      },
      projects: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            link: { type: "string" },
            technologies: { type: "array", items: { type: "string" } },
            startDate: { type: "string" },
            endDate: { type: "string" },
          },
          required: ["title"],
        },
      },
      certifications: {
        type: "array",
        items: { $ref: "#/components/schemas/KnowledgeBaseCertification" },
      },
    },
    required: [
      "professionalSummary",
      "location",
      "experienceYears",
      "education",
      "experience",
      "skills",
      "projects",
      "certifications",
    ],
  },
  KnowledgeBaseAccount: {
    type: "object",
    properties: {
      displayName: { type: "string", nullable: true },
      email: { type: "string", nullable: true },
      professionalTitle: { type: "string", nullable: true },
      portfolioLink: { type: "string", nullable: true },
      tierId: { type: "string", nullable: true },
    },
    required: [
      "displayName",
      "email",
      "professionalTitle",
      "portfolioLink",
      "tierId",
    ],
  },
  KnowledgeBaseMeta: {
    type: "object",
    properties: {
      hasResume: { type: "boolean" },
      latestResumeId: { type: "string", nullable: true },
      profileCompletionPercent: { type: "integer", minimum: 0, maximum: 100 },
    },
    required: ["hasResume", "latestResumeId", "profileCompletionPercent"],
  },
  SlimOptimizerEnrichment: {
    type: "object",
    properties: {
      id: { type: "string" },
      optimizerType: { type: "string", enum: ["upwork", "linkedin"] },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      originalInputPreview: { type: "string" },
      optimizedOverviewPreview: { type: "string" },
    },
    required: [
      "id",
      "optimizerType",
      "createdAt",
      "updatedAt",
      "originalInputPreview",
      "optimizedOverviewPreview",
    ],
  },
  SlimProposalEnrichment: {
    type: "object",
    properties: {
      id: { type: "string" },
      clientName: { type: "string" },
      jobTitle: { type: "string" },
      proposalTone: { type: "string" },
      jobSummary: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      textPreview: { type: "string" },
    },
    required: [
      "id",
      "clientName",
      "jobTitle",
      "proposalTone",
      "jobSummary",
      "createdAt",
      "updatedAt",
      "textPreview",
    ],
  },
  KnowledgeBaseGetResponse: {
    type: "object",
    properties: {
      account: { $ref: "#/components/schemas/KnowledgeBaseAccount" },
      knowledge: { $ref: "#/components/schemas/KnowledgeBaseSections" },
      enrichment: {
        type: "object",
        properties: {
          recentOptimizations: {
            type: "array",
            items: { $ref: "#/components/schemas/SlimOptimizerEnrichment" },
          },
          recentProposals: {
            type: "array",
            items: { $ref: "#/components/schemas/SlimProposalEnrichment" },
          },
        },
        required: ["recentOptimizations", "recentProposals"],
      },
      meta: { $ref: "#/components/schemas/KnowledgeBaseMeta" },
    },
    required: ["account", "knowledge", "enrichment", "meta"],
  },
  KnowledgeBasePatchBody: {
    type: "object",
    description:
      "Partial update; any omitted key is left unchanged. Arrays are replaced when provided.",
    properties: {
      professionalSummary: { type: "string", nullable: true },
      location: { type: "string", nullable: true },
      experienceYears: { type: "integer", nullable: true, minimum: 0, maximum: 80 },
      education: {
        type: "array",
        items: {
          type: "object",
          properties: {
            institution: { type: "string" },
            degree: { type: "string" },
            fieldOfStudy: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
            current: { type: "boolean" },
            description: { type: "string" },
          },
          required: ["institution", "degree"],
        },
      },
      experience: {
        type: "array",
        items: {
          type: "object",
          properties: {
            company: { type: "string" },
            position: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
            current: { type: "boolean" },
            description: { type: "string" },
            location: { type: "string" },
          },
          required: ["company", "position"],
        },
      },
      skills: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            level: {
              type: "string",
              enum: ["Beginner", "Intermediate", "Advanced", "Expert"],
            },
          },
          required: ["name"],
        },
      },
      projects: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            link: { type: "string" },
            technologies: { type: "array", items: { type: "string" } },
            startDate: { type: "string" },
            endDate: { type: "string" },
          },
          required: ["title"],
        },
      },
      certifications: {
        type: "array",
        items: { $ref: "#/components/schemas/KnowledgeBaseCertification" },
      },
    },
  },
  KnowledgeBaseImportBody: {
    type: "object",
    required: ["source"],
    properties: {
      source: {
        type: "string",
        enum: ["resume", "optimizer", "all"],
        description:
          "Import from saved resume content, latest optimizer run, or try resume then enrich from optimizer.",
      },
      resumeId: {
        type: "string",
        description: "Specific resume to import; defaults to most recently updated resume.",
      },
      overwrite: {
        type: "boolean",
        description:
          "If true, replace sections from the source. If false, only fill empty fields (default).",
      },
    },
  },
};
