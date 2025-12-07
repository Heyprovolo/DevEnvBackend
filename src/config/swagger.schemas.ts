/**
 * OpenAPI reusable schemas for Provolo API
 */

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
    required: ["id", "userId", "email", "tierId", "subscribed", "createdAt", "updatedAt"],
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
          required: ["name", "description", "slug", "limited", "maxQuota", "recurringInterval"],
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
};
