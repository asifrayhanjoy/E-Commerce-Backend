import type { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type AuthPayload = {
  id?: string;
  role?: "user" | "seller";
};

const getAuthToken = (req: any) =>
  req.cookies?.access_token ||
  req.cookies?.["seller-access-token"] ||
  req.headers?.authorization?.split(" ")[1] ||
  "";

const isAuthenticated = async (req: any, res: Response, next: NextFunction) => {
  try {
    const token = getAuthToken(req);

    if (!token) {
      return res.status(401).json({
        message: "Unauthorized! Token missing.",
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.ACCESS_TOKEN_SECRET!
    ) as AuthPayload;

    if (!decoded.id) {
      return res.status(401).json({
        message: "Unauthorized! Invalid token.",
      });
    }

    if (decoded.role === "seller") {
      const seller = await prisma.sellers.findUnique({
        where: { id: decoded.id },
        include: { shop: true },
      });

      if (!seller) {
        return res.status(401).json({
          message: "Account not found!",
        });
      }

      req.user = seller;
      req.seller = seller;
      req.role = "seller";

      return next();
    }

    const user = await prisma.users.findUnique({
      where: { id: decoded.id },
      include: { avatar: true },
    });

    if (!user) {
      return res.status(401).json({
        message: "Account not found!",
      });
    }

    req.user = user;
    req.role = "user";

    return next();
  } catch {
    return res.status(401).json({
      message: "Unauthorized! Token expired or invalid.",
    });
  }
};

export default isAuthenticated;
