import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import { parse as parseYaml } from "yaml";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { authenticate, requireRole } from "./http/auth.js";
import { apiNotFound, errorHandler } from "./http/errorHandler.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { bookRouter } from "./modules/books/book.routes.js";
import { ticketRouter } from "./modules/tickets/ticket.routes.js";
import { adminRouter } from "./modules/admin/admin.routes.js";
import { eventsRouter } from "./realtime/events.routes.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Same relative location from src/ (tsx) and dist/ (compiled).
const OPENAPI_PATH = path.resolve(here, "../openapi.yaml");
const CLIENT_DIST = path.resolve(here, "../../client/dist");

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  if (env.isProduction) app.set("trust proxy", 1); // behind Render/Railway proxy: real client IP for rate limits

  app.use(helmet());
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/api/health" } }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  if (env.CORS_ORIGIN) {
    // Only needed when the SPA is hosted on a different origin than the API.
    app.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", env.CORS_ORIGIN!);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
      if (req.method === "OPTIONS") return res.status(204).end();
      next();
    });
  }

  // ---- Public ----
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api/auth", authRouter);

  const openapi = parseYaml(readFileSync(OPENAPI_PATH, "utf8"));
  app.get("/api/openapi.json", (_req, res) => res.json(openapi));
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: "BookLeaf Support API" }));

  // ---- Authenticated ----
  app.use("/api/books", authenticate, bookRouter);
  app.use("/api/tickets", authenticate, ticketRouter);
  app.use("/api/events", authenticate, eventsRouter);
  app.use("/api/admin", authenticate, requireRole("ADMIN"), adminRouter);

  app.use("/api", apiNotFound);

  // ---- SPA (production build) ----
  if (existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(CLIENT_DIST, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
