import cors from "cors";
import type { CorsOptions } from "cors";

const devOrigins = ["http://localhost:5173", "https://provolo-dev.vercel.app"];

export const prodOrigins = [
  "https://provolo.org",
  "https://provolo.vercel.app",
  "https://provolo-dev.vercel.app",
];

export function devCors(): CorsOptions {
  return {
    origin: devOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
      "Origin",
      "Content-Type",
      "Accept",
      "Authorization",
      "X-Requested-With",
    ],
    exposedHeaders: ["Content-Length"],
    credentials: true,
    maxAge: 12 * 60 * 60,
  };
}

export function prodCors(): CorsOptions {
  return {
    origin: prodOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Origin", "Content-Type", "Accept", "Authorization"],
    exposedHeaders: ["Content-Length"],
    credentials: true,
    maxAge: 12 * 60 * 60,
  };
}

export function corsMiddleware() {
  return cors(process.env.NODE_ENV === "production" ? prodCors() : devCors());
}
