import express from "express";
import type { Request, Response } from "express";
import morgan from "morgan";
import dotenv from "dotenv";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

import v1Routes from "./routes/index.ts";
import { SwaggerOptions } from "./config/swagger.config.ts";
import { corsMiddleware } from "./middlewares/cors.middleware.ts";

dotenv.config();

// Fly.io sets PORT to match fly.toml internal_port (8080). NaN breaks listen() → PR03/PC01 "connection refused".
const rawPort = Number(process.env.PORT);
const port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 8080;
// Must bind all interfaces so the Fly proxy can reach the app (not 127.0.0.1 only).
const host = process.env.FLY_APP_NAME ? "0.0.0.0" : (process.env.HOST || "0.0.0.0");

console.log(`[startup] listening on ${host}:${port} (FLY_APP_NAME=${process.env.FLY_APP_NAME ?? "n/a"})`);

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

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use("/api/v1", v1Routes);

app.get("/", (req: Request, res: Response) => {
  res.send("Provolo Server!");
});

const server = app.listen(port, host, () =>
  console.log(`Server is running on ${host}:${port}`),
);

// Large PDF uploads + parsing can exceed default timeouts on slow connections.
server.requestTimeout = 120_000;
server.headersTimeout = 125_000;
