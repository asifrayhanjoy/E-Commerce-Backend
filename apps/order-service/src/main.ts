import "./config/env";
import express from 'express';
import cors from "cors"
import cookieParser from 'cookie-parser';
import {
  errorMiddleware,
  notFoundMiddleware,
} from "./middleware/error.middleware";
import router from './routes/order.route';
import { createOrder } from './controllers/order.controller';


const app = express();

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

app.post("/api/create-order", express.raw({ type: "application/json" }),(req, res, next) => {
    (req as any).rawBody = req.body;
    next();
  },
  createOrder
);

app.use(express.json());
app.use(cookieParser());

app.get('/', (req, res) => {
  res.send({ message: 'Welcome to order-service!' });
});

app.use("/api", router)
app.use(notFoundMiddleware);
app.use(errorMiddleware);

const port = process.env.PORT || 8282;
const server = app.listen(port, () => {
  console.log(`Listening at http://localhost:${port}/api`);
});
server.on('error', console.error);
