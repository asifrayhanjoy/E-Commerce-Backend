import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "apps/E-Commerce-BG/.env") });
import express from "express";
import cors from "cors";

import morgan from "morgan";
import proxy from "express-http-proxy";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import cookieParser from "cookie-parser";
import { errorMiddleware } from "./packages/error-handler";
import authRouter from "./routes/auth.route";
import initializeConfig from "./libs/initializeConfig";
import { createAdminNotification, getAdminCustomization, getAdminDashboard, getAdminNotificationList, getAdminPayments, getAdminSeller, getAdminSellers, updateAdminCustomization } from "./controler/auth.controler";
import { createActivityLogEntry, deleteActivityLogEntry, getActivityLog, getActivityLogs, updateActivityLogEntry } from "./controler/activityLog.controler";
import { activityLoggerMiddleware } from "./utils/activityLogger";
import isAdminAuthenticated from "./utils/middleware/isAdminAuthenticated";

const app = express();
app.set('trust proxy', 1);

app.use(
  cors({
    origin: [
      "http://localhost:6001",
      "http://localhost:6002",
      "http://localhost:6003",
      "http://localhost:3000",
    ],
    allowedHeaders: ["Authorization", "Content-Type", "x-auth-role"],
    credentials: true,
  })
);
app.use(morgan("dev"));
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));
app.use(cookieParser());
app.use(activityLoggerMiddleware);
app.use('/assets', express.static(path.join(__dirname, 'assets')));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req: any) => (req.user ? 5000 : 1000),
  message: {
    error: "Too many requests, please try again later!",
  },
  standardHeaders: true,
  legacyHeaders: true,
  keyGenerator: (req: any) => {
    return ipKeyGenerator(req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress);
  },
  validate: { xForwardedForHeader: false },
  skip: () => process.env.NODE_ENV !== 'production',
});

app.use(limiter);

app.get('/gateway-health', (_req, res) => {
  res.send({ message: 'Welcome to E-Commerce-BG API Gateway!' });
});

const productServiceUrl =
  process.env.PRODUCT_SERVICE_URL || "http://127.0.0.1:8181";
const orderServiceUrl =
  process.env.ORDER_SERVICE_URL || "http://127.0.0.1:8282";
const chattingServiceUrl =
  process.env.CHATTING_SERVICE_URL || "http://127.0.0.1:8484";

app.use(
  "/api/v1/products",
  proxy(productServiceUrl, {
    proxyReqPathResolver: (req) => req.originalUrl,
    proxyErrorHandler: (err, res, next) => {
      console.error("Product service proxy error:", err);

      if (res.headersSent) {
        return next(err);
      }

      return res.status(502).json({
        status: "error",
        message: "Product service is unavailable",
      });
    },
  })
);

app.use(
  "/api/v1/chats",
  proxy(chattingServiceUrl, {
    proxyReqPathResolver: (req) => req.originalUrl,
    proxyErrorHandler: (err, res, next) => {
      console.error("Chatting service proxy error:", err);

      if (res.headersSent) {
        return next(err);
      }

      return res.status(502).json({
        status: "error",
        message: "Chatting service is unavailable",
      });
    },
  })
);

app.get(
  "/get-home-products",
  proxy(productServiceUrl, {
    proxyReqPathResolver: (req) => `/api/v1/products${req.originalUrl}`,
    proxyErrorHandler: (err, res, next) => {
      console.error("Product service proxy error:", err);

      if (res.headersSent) {
        return next(err);
      }

      return res.status(502).json({
        status: "error",
        message: "Product service is unavailable",
      });
    },
  })
);

app.use(
  "/api/v1/admin/orders",
  proxy(orderServiceUrl, {
    proxyReqPathResolver: (req) =>
      req.originalUrl.replace(/^\/api\/v1\/admin\/orders/, "/api/admin/orders"),
    proxyErrorHandler: (err, res, next) => {
      console.error("Order service proxy error:", err);

      if (res.headersSent) {
        return next(err);
      }

      return res.status(502).json({
        status: "error",
        message: "Order service is unavailable",
      });
    },
  })
);

app.use(express.json({ limit: "100mb" }))
app.use(cookieParser())
app.get("/api/v1/admin/dashboard", getAdminDashboard);
app.get("/api/v1/admin/notifications", getAdminNotificationList);
app.post("/api/v1/admin/notifications", createAdminNotification);
app.get("/api/v1/admin/payments", getAdminPayments);
app.get("/api/v1/admin/customization", getAdminCustomization);
app.patch("/api/v1/admin/customization", updateAdminCustomization);
app.get("/api/v1/admin/sellers", getAdminSellers);
app.get("/api/v1/admin/sellers/:sellerId", getAdminSeller);
app.get("/api/v1/admin/loggers", isAdminAuthenticated, getActivityLogs);
app.post("/api/v1/admin/loggers", isAdminAuthenticated, createActivityLogEntry);
app.get("/api/v1/admin/loggers/:logId", isAdminAuthenticated, getActivityLog);
app.patch("/api/v1/admin/loggers/:logId", isAdminAuthenticated, updateActivityLogEntry);
app.delete("/api/v1/admin/loggers/:logId", isAdminAuthenticated, deleteActivityLogEntry);
app.use("/api/v1/auth", authRouter);

app.use(errorMiddleware);

const port = process.env.PORT || 8080;
const server = app.listen(port, () => {
console.log(`API Gateway is listening at http://localhost:${port}`);
  try{
   initializeConfig();
   console.log("Side Config Initialized Successfully!");
  }catch(error){
console.error("failed Initialized Config")
  }
});

server.on('error', console.error);
