import { NextFunction, Response } from "express";

class AuthError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    Error.captureStackTrace?.(this, AuthError);
  }
}

export const isSeller = ( req: any, res: Response, next: NextFunction ) => {
  if (req.role !== "seller") {
    return next(new AuthError("Access denied: Seller only"));
  }
  return next();
};

export const isUser = ( req: any, res: Response, next: NextFunction ) => {
  if (req.role !== "user") {
    return next(new AuthError("Access denied: User only"));
  }
  return next();
};