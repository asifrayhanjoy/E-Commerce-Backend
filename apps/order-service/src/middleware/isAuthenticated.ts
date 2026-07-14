import { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const isAuthenticated = async (req: any, res: Response, next: NextFunction) => {
  try {
    const token =
      req.cookies?.access_token ||
      req.cookies?.["seller-access-token"] ||
      req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        message: "Unauthorized! Token missing.",
      });
    }

    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET!) as {
      id: string;
      role: "user" | "seller";
    };

    let account;

    if (decoded.role === "user") {
      account = await prisma.users.findUnique({
        where: { id: decoded.id },
      });
      req.user = account;
    } else if (decoded.role === "seller") {
      account = await prisma.sellers.findUnique({
        where: { id: decoded.id },
        include: { shop: true },
      });
      req.user = account;
      req.seller = account;
    }

    if (!account) {
      return res.status(401).json({
        message: "Account not found!",
      });
    }

    req.role = decoded.role;
    return next();
  } catch (_error) {
    return res.status(401).json({
      message: "Unauthorized! Token expired or invalid.",
    });
  }
};

export default isAuthenticated;
