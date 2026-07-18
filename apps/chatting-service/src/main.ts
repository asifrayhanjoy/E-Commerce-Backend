import express from 'express';
import cookieParser from 'cookie-parser';
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import chatRouter from "./routes/chat.route";
import { createChatSocketServer } from "./websocket";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "apps/E-Commerce-BG/.env") });
dotenv.config({
  path: path.resolve(process.cwd(), "apps/chatting-service/.env"),
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
app.use(express.json());
app.use(cookieParser());

app.get('/', (req, res) => {
  res.send({ message: 'Welcome to chatting-service!' });
});

app.use("/api/v1/chats", chatRouter);

app.use((req, res) => {
  return res.status(404).json({
    status: "error",
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

app.use((err: any, _req: any, res: any, _next: any) => {
  const status = typeof err.status === "number" ? err.status : 500;

  return res.status(status).json({
    status: "error",
    message:
      process.env.NODE_ENV !== "production"
        ? err.message
        : "Something went wrong, please try again!",
  });
});

const port = process.env.PORT || 8484;
const server = app.listen(port, () => {
  console.log(`Listening at http://localhost:${port}`);
});
createChatSocketServer(server);
server.on('error', console.error);
