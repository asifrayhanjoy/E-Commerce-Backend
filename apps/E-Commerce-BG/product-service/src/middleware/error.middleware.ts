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
  console.error("Product service error:", err);

  return res.status(500).json({
    status: "error",
    message:
      process.env.NODE_ENV !== "production"
        ? err.message
        : "Something went wrong, please try again!",
  });
};
