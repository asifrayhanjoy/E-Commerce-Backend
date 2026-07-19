import { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../../packages/libs/prisma";

const getAdminToken = (req: any) =>
  req.cookies?.["admin-access-token"] ||
  req.headers.authorization?.split(" ")[1] ||
  "";

const isAdminAuthenticated = async (
  req: any,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = getAdminToken(req);

    if (!token) {
      return res.status(401).json({
        message: "Unauthorized! Admin token missing.",
      });
    }

    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET!) as {
      id: string;
      role: string;
    };

    if (!decoded?.id || decoded.role !== "admin") {
      return res.status(403).json({
        message: "Access denied: Admin only.",
      });
    }

    const admin = /^[a-f\d]{24}$/i.test(decoded.id)
      ? await (prisma as any).admins?.findUnique?.({
          where: {
            id: decoded.id,
          },
        })
      : null;

    req.admin = admin || {
      id: decoded.id,
      name: "Admin",
      email: "",
      role: "admin",
    };
    req.role = "admin";

    return next();
  } catch {
    return res.status(401).json({
      message: "Unauthorized! Admin token expired or invalid.",
    });
  }
};

export default isAdminAuthenticated;
