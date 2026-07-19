import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const getHeaderValue = (value: unknown) =>
  Array.isArray(value) ? value[0] : typeof value === "string" ? value : "";

const getRequestedRole = (req: any): "user" | "seller" | "" => {
  const roleFromHeader = getHeaderValue(req.headers?.["x-auth-role"]);

  if (roleFromHeader === "user" || roleFromHeader === "seller") {
    return roleFromHeader;
  }

  if (req.body?.role === "user" || req.body?.role === "seller") {
    return req.body.role;
  }

  const requestPath = String(req.originalUrl || req.path || "");

  if (
    requestPath.includes("/loged-in-seller") ||
    requestPath.includes("/logout-seller") ||
    requestPath.includes("/seller-") ||
    requestPath.includes("/create-product") ||
    requestPath.includes("/create-event") ||
    requestPath.includes("/get-shop-products") ||
    requestPath.includes("/get-shop-events") ||
    requestPath.includes("/get-discount-codes") ||
    requestPath.includes("/create-discount-code") ||
    requestPath.includes("/delete-discount-code") ||
    requestPath.includes("/upload-product-image") ||
    requestPath.includes("/delete-product-image") ||
    requestPath.includes("/delete-product") ||
    requestPath.includes("/restore-product") ||
    requestPath.includes("/get-stripe-account")
  ) {
    return "seller";
  }

  if (
    requestPath.includes("/login-in-user") ||
    requestPath.includes("/logout-user") ||
    requestPath.includes("/addresses") ||
    requestPath.includes("/follow-shop") ||
    requestPath.includes("/unfollow-shop")
  ) {
    return "user";
  }

  return "";
};

const getAuthToken = (req: any) => {
  const requestedRole = getRequestedRole(req);
  const userToken = req.cookies?.access_token;
  const sellerToken = req.cookies?.["seller-access-token"];
  const authorizationToken = req.headers.authorization?.split(" ")[1];

  if (requestedRole === "user") {
    return userToken || authorizationToken;
  }

  if (requestedRole === "seller") {
    return sellerToken || authorizationToken;
  }

  return userToken || sellerToken || authorizationToken;
};

const isAuthenticated = async ( req: any, res: Response, next: NextFunction ) => {
  try {
    const token = getAuthToken(req);

    if (!token) {
      return res.status(401).json({
        message: "Unauthorized! Token missing.",
      });
    }

    // verify token
    const decoded = jwt.verify(
      token,
      process.env.ACCESS_TOKEN_SECRET!
    ) as {
      id: string;
      role: "user" | "seller";
    };

    if (!decoded) {
      return res.status(401).json({
        message: "Unauthorized! Invalid token.",
      });
    }

    let account;
    if(decoded.role === "user"){
    account = await prisma.users.findUnique({
      where: {
        id: decoded.id,
      },
      include: {
        avatar: true,
      },
    });
        req.user = account;
    }else if(decoded.role === "seller"){
      account = await prisma.sellers.findUnique({
      where: {
      id: decoded.id,
      },
      include: {shop:true}
    });
     req.user = account;
     req.seller = account;
    }

    if (!account) {
      return res.status(401).json({
        message: "Account not found!",
      });
    }
    req.role = decoded.role
    return next();
  } catch (error) {
    return res.status(401).json({
      message: "Unauthorized! Token expired or invalid.",
    });
  }
};

export default isAuthenticated;
