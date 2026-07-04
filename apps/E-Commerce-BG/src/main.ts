import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "apps/E-Commerce-BG/.env") });
import express from "express";
import cors from "cors";

import morgan from "morgan";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import { errorMiddleware } from "./packages/error-handler/custom-error";
import authRouter from "./routes/auth.route";

const app = express();
app.set('trust proxy', 1);



app.use(
  cors({
    origin: ["http://localhost:6001", "http://localhost:3000"],
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
    return req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  },
  validate: { xForwardedForHeader: false },
  skip: () => process.env.NODE_ENV !== 'production',
});

app.use(limiter);

app.get('/gateway-health', (_req, res) => {
  res.send({ message: 'Welcome to E-Commerce-BG API Gateway!' });
});

app.use(express.json())
app.use(cookieParser())
app.use("/api/v1/auth", authRouter);


app.use(errorMiddleware);

const port = process.env.PORT || 8080;
const server = app.listen(port, () => {
  console.log(`API Gateway is listening at http://localhost:${port}`);
});

server.on('error', console.error);
