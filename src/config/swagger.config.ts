import { SwaggerSchemas } from "./swagger.schemas.ts";
export const SwaggerOptions = {
  definition: {
    openapi: "3.1.0",
    info: {
      title: "Provolo API",
      version: "1.0",
      description: "This is the Provolo backend API server",
      license: {
        name: "Apache 2.0",
        url: "http://www.apache.org/licenses/LICENSE-2.0.html",
      },
    },
    servers: [
      {
        url: "http://localhost:8001",
        url: "http://localhost:8080",
      },
      {
        url: "https://provolo-backend.fly.dev",
      },
    ],
    basePath: "/",
    schemes: ["http", "https"],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: 'Type "Bearer" followed by a space and JWT token.',
        },
      },
      schemas: SwaggerSchemas,
    },
    security: [
      {
        BearerAuth: [],
      },
    ],
  },
  apis: ["src/routes/*.ts"],
};
