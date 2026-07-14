import type { ErrorRequestHandler } from "express";
import { AppError } from "./app-error";

export const errorMiddleware: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    console.error(`[${req.method}] ${req.url} → ${err.statusCode} ${err.message}`);
    return res.status(err.statusCode).json({
      status: "error",
      message: err.message,
      ...(err.details && { details: err.details }),
    });
  }

  console.error("Unhandled error:", err);

  return res.status(500).json({
    status: "error",
    message: process.env.NODE_ENV !== "production"
      ? err.message
      : "Something went wrong, please try again!",
  });
};
