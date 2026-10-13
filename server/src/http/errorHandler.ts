import type { ErrorRequestHandler, RequestHandler } from "express";
import multer from "multer";
import { Prisma } from "@prisma/client";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export const apiNotFound: RequestHandler = (req, _res, next) => {
  next(new AppError(404, "ROUTE_NOT_FOUND", `No route for ${req.method} ${req.originalUrl}`));
};

/**
 * Single place that turns errors into HTTP responses. Known errors get a
 * specific status and code; anything unexpected is logged with the request id
 * and returned as a generic 500 without leaking internals.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const send = (status: number, code: string, message: string, details?: unknown) =>
    res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });

  if (err instanceof AppError) return send(err.status, err.code, err.message, err.details);

  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return send(status, "UPLOAD_ERROR", err.code === "LIMIT_FILE_SIZE" ? "Attachment must be 5 MB or smaller" : err.message);
  }

  // Malformed JSON body (thrown by express.json()).
  if (err instanceof SyntaxError && "body" in err) return send(400, "INVALID_JSON", "Request body is not valid JSON");

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") return send(404, "NOT_FOUND", "Resource not found");
    if (err.code === "P2002") return send(409, "CONFLICT", "A record with these details already exists");
  }

  req.log?.error({ err }, "Unhandled error");
  if (!req.log) logger.error({ err }, "Unhandled error");
  return send(500, "INTERNAL_ERROR", "Something went wrong on our side. Please try again.");
};
