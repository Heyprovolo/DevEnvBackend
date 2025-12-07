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

const port = Number(process.env.PORT);
const swaggerSpec = swaggerJsdoc(SwaggerOptions);

const app = express();
app.use(express.json());
app.use(morgan("combined"));
app.use(corsMiddleware());

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use("/api/v1", v1Routes);

app.get("/", (req: Request, res: Response) => {
  res.send("Provolo Server!");
});

app.listen(port, () => console.log(`Server is running on port ${port}`));
