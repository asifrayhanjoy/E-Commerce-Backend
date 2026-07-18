import { Server } from "node:http";
import type { Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import {
  ChatAccount,
  getConversationForAccount,
  getUnreadCount,
  markConversationRead,
  sendMessage,
} from "./chat.service";

const prisma = new PrismaClient();
let SocketServer: any = null;

try {
  SocketServer = require("socket.io").Server;
} catch {
  SocketServer = null;
}

const allowedOrigins = [
  "http://localhost:6001",
  "http://localhost:6002",
  "http://localhost:6003",
  "http://localhost:3000",
];

const parseCookies = (cookieHeader = "") =>
  cookieHeader.split(";").reduce<Record<string, string>>((cookies, cookie) => {
    const [name, ...valueParts] = cookie.trim().split("=");

    if (!name) {
      return cookies;
    }

    cookies[name] = decodeURIComponent(valueParts.join("=") || "");
    return cookies;
  }, {});

const getSocketRole = (value: unknown): ChatAccount["role"] | "" =>
  value === "user" || value === "seller" ? value : "";

const getSocketAccount = async (socket: any): Promise<ChatAccount> => {
  const cookies = parseCookies(socket.handshake.headers.cookie || "");
  const requestedRole = getSocketRole(socket.handshake.auth?.role);
  const authorizationHeader = socket.handshake.headers.authorization || "";
  const authorizationToken =
    typeof authorizationHeader === "string"
      ? authorizationHeader.split(" ")[1]
      : "";
  const userToken = cookies.access_token;
  const sellerToken = cookies["seller-access-token"];
  const token =
    requestedRole === "user"
      ? userToken || authorizationToken
      : requestedRole === "seller"
        ? sellerToken || authorizationToken
        : userToken || sellerToken || authorizationToken;

  if (!token) {
    throw new Error("Unauthorized! Token missing.");
  }

  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET!) as {
    id: string;
    role: ChatAccount["role"];
  };

  if (decoded.role === "user") {
    const user = await prisma.users.findUnique({
      where: { id: decoded.id },
      select: { id: true },
    });

    if (!user) {
      throw new Error("Account not found.");
    }
  } else if (decoded.role === "seller") {
    const seller = await prisma.sellers.findUnique({
      where: { id: decoded.id },
      select: { id: true },
    });

    if (!seller) {
      throw new Error("Account not found.");
    }
  } else {
    throw new Error("Invalid chat role.");
  }

  return {
    id: decoded.id,
    role: decoded.role,
  };
};

const conversationRoom = (conversationId: string) =>
  `conversation:${conversationId}`;

const accountRoom = (account: ChatAccount) => `${account.role}:${account.id}`;

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Chat request failed.";

const emitUnreadCount = async (
  io: any,
  account: ChatAccount
) => {
  io.to(accountRoom(account)).emit("unread:updated", {
    unreadCount: await getUnreadCount(account),
  });
};

export const createChatSocketServer = (server: Server) => {
  if (!SocketServer) {
    return null;
  }

  const io = new SocketServer(server, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
      allowedHeaders: ["Authorization", "Content-Type", "x-auth-role"],
    },
  });

  io.use(async (socket: Socket, next: (err?: Error) => void) => {
    try {
      socket.data.account = await getSocketAccount(socket);
      next();
    } catch (error) {
      next(new Error(getErrorMessage(error)));
    }
  });

  io.on("connection", (socket: Socket) => {
    const account = socket.data.account as ChatAccount;
    socket.join(accountRoom(account));

    socket.on("conversation:join", async (payload: any, acknowledge?: any) => {
      try {
        const conversation = await getConversationForAccount(
          payload?.conversationId,
          account
        );

        socket.join(conversationRoom(conversation.id));
        const updatedConversation = await markConversationRead(
          conversation.id,
          account
        );
        socket.to(accountRoom(account)).emit("conversation:updated", {
          conversation: updatedConversation,
        });
        await emitUnreadCount(io, account);
        acknowledge?.({ success: true, conversation: updatedConversation });
      } catch (error) {
        acknowledge?.({ success: false, message: getErrorMessage(error) });
      }
    });

    socket.on("conversation:leave", async (payload: any, acknowledge?: any) => {
      socket.leave(conversationRoom(String(payload?.conversationId || "")));
      acknowledge?.({ success: true });
    });

    socket.on("message:send", async (payload: any, acknowledge?: any) => {
      try {
        const result = await sendMessage(payload?.conversationId, account, {
          text: payload?.text,
        });
        const buyerAccount: ChatAccount = {
          id: result.conversation.buyerId,
          role: "user",
        };
        const sellerAccount: ChatAccount = {
          id: result.conversation.sellerId,
          role: "seller",
        };

        io.to(conversationRoom(result.conversation.id)).emit(
          "message:received",
          result
        );
        io.to(accountRoom(buyerAccount)).emit("conversation:updated", {
          conversation: result.conversation,
        });
        io.to(accountRoom(sellerAccount)).emit("conversation:updated", {
          conversation: result.conversation,
        });
        await emitUnreadCount(io, buyerAccount);
        await emitUnreadCount(io, sellerAccount);
        acknowledge?.({ success: true, ...result });
      } catch (error) {
        acknowledge?.({ success: false, message: getErrorMessage(error) });
      }
    });

    socket.on("typing:start", async (payload: any) => {
      try {
        const conversation = await getConversationForAccount(
          payload?.conversationId,
          account
        );
        socket.to(conversationRoom(conversation.id)).emit("typing:started", {
          conversationId: conversation.id,
          role: account.role,
          accountId: account.id,
        });
      } catch {
        return;
      }
    });

    socket.on("typing:stop", async (payload: any) => {
      try {
        const conversation = await getConversationForAccount(
          payload?.conversationId,
          account
        );
        socket.to(conversationRoom(conversation.id)).emit("typing:stopped", {
          conversationId: conversation.id,
          role: account.role,
          accountId: account.id,
        });
      } catch {
        return;
      }
    });
  });

  return io;
};
