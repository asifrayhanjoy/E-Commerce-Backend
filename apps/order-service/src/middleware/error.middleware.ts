import { NextFunction, Request, Response } from "express";

export const notFoundMiddleware = (req: Request, res: Response) => {
  return res.status(404).json({
    status: "error",
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
};

export const errorMiddleware = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  console.error("Order service error:", err);
  const status =
    typeof (err as { status?: unknown }).status === "number"
      ? (err as { status: number }).status
      : 500;

  return res.status(status).json({
    status: "error",
    message:
      process.env.NODE_ENV !== "production"
        ? err.message
        : "Something went wrong, please try again!",
  });
};
