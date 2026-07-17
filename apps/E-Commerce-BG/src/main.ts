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
import { getAdminDashboard, getAdminSeller, getAdminSellers } from "./controler/auth.controler";

const app = express();
app.set('trust proxy', 1);

app.use(
  cors({
    origin: ["http://localhost:6001", "http://localhost:6003", "http://localhost:3000"],
    allowedHeaders: ["Authorization", "Content-Type"],
    credentials: true,
  })
);
app.use(morgan("dev"));
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));
app.use(cookieParser());
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

app.use(express.json())
app.use(cookieParser())
app.get("/api/v1/admin/dashboard", getAdminDashboard);
app.get("/api/v1/admin/sellers", getAdminSellers);
app.get("/api/v1/admin/sellers/:sellerId", getAdminSeller);
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
