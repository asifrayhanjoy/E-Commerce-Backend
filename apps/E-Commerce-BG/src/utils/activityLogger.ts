import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../packages/libs/prisma";

type ActivityStatus = "Success" | "Failed";

type ActivityActor = {
  userId?: string;
  userName?: string;
  userRole?: "Admin" | "Seller" | "User" | "System";
};

type ActivityDetails = {
  action: string;
  module: string;
  description: string;
  targetId?: string;
  targetName?: string;
};

type ActivityLogInput = ActivityActor &
  ActivityDetails & {
    ipAddress?: string;
    userAgent?: string;
    requestMethod: string;
    endpoint: string;
    status: ActivityStatus;
  };

const sensitiveKeys = [
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "secret",
  "cookie",
];

const activityLogModel = () => (prisma as any).activity_logs;

const normalizeText = (value: unknown, fallback = "") => {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmedValue = value.trim();

  return trimmedValue || fallback;
};

const normalizeRole = (role?: string): ActivityActor["userRole"] => {
  const normalizedRole = normalizeText(role).toLowerCase();

  if (normalizedRole === "admin") return "Admin";
  if (normalizedRole === "seller") return "Seller";
  if (normalizedRole === "user") return "User";

  return undefined;
};

const isSensitiveKey = (key: string) =>
  sensitiveKeys.some((sensitiveKey) =>
    key.toLowerCase().includes(sensitiveKey.toLowerCase())
  );

const sanitizeObject = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sanitizeObject);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.entries(value as Record<string, unknown>).reduce(
    (record, [key, item]) => ({
      ...record,
      [key]: isSensitiveKey(key) ? "[redacted]" : sanitizeObject(item),
    }),
    {}
  );
};

const getCookieToken = (req: any) =>
  req.cookies?.["admin-access-token"] ||
  req.cookies?.["seller-access-token"] ||
  req.cookies?.access_token ||
  req.headers?.authorization?.split(" ")[1] ||
  "";

const getActorFromToken = (req: any): ActivityActor => {
  const token = getCookieToken(req);

  if (!token) {
    return {};
  }

  const decoded = jwt.decode(token) as
    | {
        id?: string;
        role?: string;
      }
    | null;

  if (!decoded?.id) {
    return {};
  }

  return {
    userId: decoded.id,
    userRole: normalizeRole(decoded.role),
  };
};

const getActorFromResponse = (body: any): ActivityActor => {
  const account = body?.admin || body?.seller || body?.user;

  if (!account || typeof account !== "object") {
    return {};
  }

  return {
    userId: account.id,
    userName: account.name || account.email,
    userRole: normalizeRole(account.role) || (body?.admin ? "Admin" : body?.seller ? "Seller" : "User"),
  };
};

const getActor = (req: any, responseBody: unknown): ActivityActor => {
  const requestAccount = req.admin || req.seller || req.user;
  const requestRole = normalizeRole(req.role || requestAccount?.role);
  const responseActor = getActorFromResponse(responseBody);
  const tokenActor = getActorFromToken(req);
  const bodyEmail = normalizeText(req.body?.email);

  return {
    userId: requestAccount?.id || responseActor.userId || tokenActor.userId,
    userName:
      requestAccount?.name ||
      requestAccount?.email ||
      responseActor.userName ||
      bodyEmail ||
      undefined,
    userRole:
      requestRole ||
      responseActor.userRole ||
      tokenActor.userRole ||
      inferRoleFromPath(req.originalUrl || req.url),
  };
};

const getRequestIp = (req: Request) => {
  const forwardedFor = req.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  if (Array.isArray(forwardedFor) && forwardedFor[0]) {
    return forwardedFor[0];
  }

  return req.ip || req.socket.remoteAddress || "";
};

const getSafeEndpoint = (req: Request) => {
  const endpoint = req.originalUrl || req.url || "";
  const [path, query = ""] = endpoint.split("?");

  if (!query) {
    return path;
  }

  const params = new URLSearchParams(query);

  sensitiveKeys.forEach((key) => {
    [...params.keys()].forEach((paramKey) => {
      if (paramKey.toLowerCase().includes(key.toLowerCase())) {
        params.set(paramKey, "[redacted]");
      }
    });
  });

  const safeQuery = params.toString();

  return safeQuery ? `${path}?${safeQuery}` : path;
};

const inferRoleFromPath = (endpoint: string): ActivityActor["userRole"] => {
  const path = endpoint.toLowerCase();

  if (path.includes("/admin") || path.includes("login-admin")) return "Admin";
  if (path.includes("seller")) return "Seller";
  if (path.includes("register") || path.includes("login")) return "User";

  return "System";
};

const getTargetDetails = (req: any): Pick<ActivityDetails, "targetId" | "targetName"> => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const params = req.params && typeof req.params === "object" ? req.params : {};

  return {
    targetId:
      params.id ||
      params.productId ||
      params.shopId ||
      params.sellerId ||
      params.userId ||
      params.orderId ||
      body.targetId ||
      body.id ||
      body.productId ||
      body.shopId ||
      body.sellerId ||
      body.userId ||
      body.orderId,
    targetName:
      body.targetName ||
      body.name ||
      body.title ||
      body.public_name ||
      body.email ||
      body.shopName,
  };
};

const getGenericAction = (method: string) => {
  if (method === "POST") return "Create";
  if (method === "PUT" || method === "PATCH") return "Update";
  if (method === "DELETE") return "Delete";
  return "View";
};

const inferActivityDetails = (
  req: any,
  status: ActivityStatus,
  responseBody: unknown
): ActivityDetails => {
  const method = String(req.method || "GET").toUpperCase();
  const path = String(req.originalUrl || req.url || "").toLowerCase();
  const requestBody =
    req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)
      ? req.body
      : {};
  const moduleAction = (module: string, action: string) => ({
    module,
    action,
  });
  const inferred = (() => {
    if (path.includes("login-admin")) return moduleAction("Admin", "Login");
    if (path.includes("login-seller")) return moduleAction("Seller", "Login");
    if (path.includes("/login")) return moduleAction("User", "Login");
    if (path.includes("logout-admin")) return moduleAction("Admin", "Logout");
    if (path.includes("logout-seller")) return moduleAction("Seller", "Logout");
    if (path.includes("logout-user") || path.includes("/logout")) return moduleAction("User", "Logout");
    if (path.includes("seller-register")) return moduleAction("Seller", "Register");
    if (path.includes("/register")) return moduleAction("User", "Register");
    if (path.includes("create-shop")) return moduleAction("Shop", "Create Shop");
    if (path.includes("seller-shop") && method === "DELETE") return moduleAction("Shop", "Delete Shop");
    if (path.includes("addresses") || path.includes("change-password") || path.includes("profile")) return moduleAction("User", "Update Profile");
    if (path.includes("seller-storefront/products") && method === "POST") return moduleAction("Product", "Create Product");
    if (path.includes("seller-storefront/products")) return moduleAction("Product", "Edit Product");
    if (path.includes("seller-storefront")) return moduleAction("Shop", "Update Shop");
    if (path.includes("upload-product-image")) return moduleAction("Media", "Upload Images");
    if (path.includes("delete-product-image")) return moduleAction("Media", "Delete Image");
    if (path.includes("create-product")) return moduleAction("Product", "Create Product");
    if (path.includes("delete-product")) return moduleAction("Product", "Delete Product");
    if (path.includes("restore-product")) return moduleAction("Product", "Restore Product");
    if (path.includes("create-event")) return moduleAction("Event", "Create Event");
    if (path.includes("discount-code") && method === "DELETE") return moduleAction("Offer", "Delete Discount");
    if (path.includes("discount-code")) return moduleAction("Offer", "Create Discount");
    if (path.includes("follow-shop") && method === "DELETE") return moduleAction("Shop", "Unfollow Shop");
    if (path.includes("follow-shop")) return moduleAction("Shop", "Follow Shop");
    if (path.includes("track-wishlist")) return moduleAction("Wishlist", "Wishlist");
    if (path.includes("track-cart")) return moduleAction("Cart", "Cart");
    if (path.includes("create-order")) return moduleAction("Orders", "Place Order");
    if (path.includes("delivery-status")) return moduleAction("Orders", "Change Order Status");
    if (path.includes("create-payment") || path.includes("payment-intent")) return moduleAction("Payments", "Payment Created");
    if (path.includes("confirm-payment") || path.includes("verifying-payment")) return moduleAction("Payments", "Payment Success");
    if (path.includes("refund")) return moduleAction("Payments", "Refund");
    if (path.includes("withdraw")) return moduleAction("Payments", "Withdraw Request");
    if (path.includes("admin/dashboard")) return moduleAction("Dashboard", "Dashboard");
    if (
      path.includes("admin/customization") &&
      ("categories" in requestBody || "subCategories" in requestBody)
    ) {
      return moduleAction("Category", "Edit Category");
    }
    if (path.includes("admin/customization")) return moduleAction("Dashboard", "Dashboard Action");
    if (path.includes("admin/sellers") && method !== "GET") return moduleAction("Seller", "Approve/Reject Seller");
    if (path.includes("admin/users") && method !== "GET") return moduleAction("User", "Ban/Unban User");
    if (path.includes("admin/orders") && method !== "GET") return moduleAction("Orders", "Change Order Status");
    if (path.includes("admin/payments")) return moduleAction("Payments", "Dashboard Action");
    if (path.includes("admin")) return moduleAction("Admin", getGenericAction(method));
    if (status === "Failed") return moduleAction("System", "API Error");

    return moduleAction("System", getGenericAction(method));
  })();
  const errorMessage =
    typeof responseBody === "object" && responseBody
      ? normalizeText((responseBody as any).message || (responseBody as any).error)
      : "";
  const { targetId, targetName } = getTargetDetails(req);

  return {
    ...inferred,
    targetId,
    targetName,
    description:
      status === "Failed"
        ? `${inferred.action} failed${errorMessage ? `: ${errorMessage}` : ""}.`
        : `${inferred.action} completed successfully.`,
  };
};

const shouldSkipLog = (req: Request) => {
  const path = String(req.originalUrl || req.url || "").toLowerCase();

  return (
    req.method === "OPTIONS" ||
    path.includes("/assets") ||
    path.includes("gateway-health") ||
    path === "/api"
  );
};

const shouldLogSuccess = (req: Request) => {
  const method = String(req.method || "GET").toUpperCase();
  const path = String(req.originalUrl || req.url || "").toLowerCase();

  if (method !== "GET") {
    return true;
  }

  return (
    path.includes("admin/dashboard") ||
    path.includes("admin/customization") ||
    path.includes("admin/payments")
  );
};

export const createActivityLog = async (input: ActivityLogInput) => {
  const model = activityLogModel();

  if (!model) {
    return null;
  }

  return model.create({
    data: {
      userId: input.userId || null,
      userName: input.userName || null,
      userRole: input.userRole || "System",
      action: input.action,
      module: input.module,
      description: input.description,
      targetId: input.targetId || null,
      targetName: input.targetName || null,
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null,
      requestMethod: input.requestMethod,
      endpoint: input.endpoint,
      status: input.status,
    },
  });
};

export const activityLoggerMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  res.json = ((body?: any) => {
    res.locals.activityResponseBody = sanitizeObject(body);
    return originalJson(body);
  }) as any;

  res.send = ((body?: any) => {
    if (res.locals.activityResponseBody === undefined) {
      try {
        res.locals.activityResponseBody =
          typeof body === "string" ? sanitizeObject(JSON.parse(body)) : sanitizeObject(body);
      } catch {
        res.locals.activityResponseBody = undefined;
      }
    }

    return originalSend(body);
  }) as any;

  res.on("finish", () => {
    if (shouldSkipLog(req)) {
      return;
    }

    const status: ActivityStatus = res.statusCode >= 400 ? "Failed" : "Success";

    if (status === "Success" && !shouldLogSuccess(req)) {
      return;
    }

    const responseBody = res.locals.activityResponseBody;
    const actor = getActor(req as any, responseBody);
    const details = inferActivityDetails(req as any, status, responseBody);

    setImmediate(() => {
      createActivityLog({
        ...actor,
        ...details,
        ipAddress: getRequestIp(req),
        userAgent: String(req.headers["user-agent"] || ""),
        requestMethod: req.method,
        endpoint: getSafeEndpoint(req),
        status,
      }).catch((error) => {
        console.error("Failed to save activity log:", error);
      });
    });
  });

  next();
};
