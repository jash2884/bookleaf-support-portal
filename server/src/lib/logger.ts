import { pino } from "pino";
import { env } from "../config/env.js";

export const logger = pino({
  level: env.isTest ? "silent" : env.isProduction ? "info" : "debug",
  // Never log credentials or session tokens, even by accident.
  redact: ["req.headers.authorization", "req.headers.cookie", "password", "*.password"],
});
