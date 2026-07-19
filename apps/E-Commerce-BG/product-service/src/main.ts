import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import express from 'express';
import "./job/product-crone-job";
import * as path from 'path';
import morgan from "morgan";
import {
  errorMiddleware,
  notFoundMiddleware,
} from "./middleware/error.middleware";
import { getHomeProducts } from "./controller/product.controller";
import productRouter from "./routes/product.route";
import { activityLoggerMiddleware } from "../../src/utils/activityLogger";

dotenv.config({ path: path.resolve(__dirname, "../../../..", ".env") });
dotenv.config({ path: path.resolve(__dirname, "../..", ".env") });
dotenv.config({
  path: path.resolve(__dirname, "..", ".env"),
  override: true,
});

const app = express();

app.set("trust proxy", 1);
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

app.get('/api', (req, res) => {
  res.send({ message: 'Welcome to product-service!' });
});

app.use("/api/v1/products", productRouter);
app.get("/get-home-products", getHomeProducts);
app.use(notFoundMiddleware);
app.use(errorMiddleware);

const port = Number(process.env.PORT) || 8181;

const server = app.listen(port, () => {
  console.log(`Listening at http://localhost${port}/api`);
});
server.on('error', console.error);
