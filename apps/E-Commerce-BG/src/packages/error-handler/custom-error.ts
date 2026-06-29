import { AppError } from "./index";
import { NextFunction, Request, Response } from "express";

export const errorMiddleware = (err: Error, req: Request, res: Response, _next: NextFunction) => {
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
