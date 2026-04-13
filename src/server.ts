import express from "express";
import type { Request, Response } from "express";
import morgan from "morgan";
import dotenv from "dotenv";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

import v1Routes from "./routes/index.ts";
import { SwaggerOptions } from "./config/swagger.config.ts";
import { newErrorResponse } from "./utils/apiResponse.ts";
import { corsMiddleware } from "./middlewares/cors.middleware.ts";
import {
  observeRequest,
  observeUnhandledErrors,
} from "./middlewares/observability.middleware.ts";

dotenv.config();

const port = Number(process.env.PORT);
const host = process.env.HOST || "0.0.0.0";

const swaggerSpec = swaggerJsdoc(SwaggerOptions);

const app = express();
// One proxy hop (Fly edge, Vercel rewrite, etc.) so req.ip and rate-limit keys match the real client.
app.set("trust proxy", 1);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }),
);
app.use(morgan("combined"));
app.use(corsMiddleware());
app.use(observeRequest);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use("/api/v1", v1Routes);

if (process.env.NODE_ENV !== "production") {
  // Dev-only endpoint to intentionally trigger a 500 for alert pipeline testing.
  app.get("/api/v1/debug/force-500", (_req: Request, res: Response) => {
    return res
      .status(500)
      .json(newErrorResponse("Internal Server Error", "Intentional test error for Slack alert"));
  });
}

app.get("/", (req: Request, res: Response) => {
  res.send("Provolo Server!");
});

app.use(observeUnhandledErrors);

const server = app.listen(port, host, () =>
  console.log(`Server is running on ${host}:${port}`),
);

// Large PDF uploads + parsing can exceed default timeouts on slow connections.
server.requestTimeout = 120_000;
server.headersTimeout = 125_000;
