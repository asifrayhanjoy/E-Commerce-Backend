import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export class ChatValidationError extends Error {
  status = 400;

  constructor(message: string) {
    super(message);
    this.name = "ChatValidationError";
  }
}

export class ChatAuthError extends Error {
  status = 403;

  constructor(message: string) {
    super(message);
    this.name = "ChatAuthError";
  }
}

export type ChatRole = "user" | "seller";

export type ChatAccount = {
  id: string;
  role: ChatRole;
};

const objectIdPattern = /^[a-f\d]{24}$/i;
const newObjectId = () => crypto.randomBytes(12).toString("hex");
const toObjectId = (id: string) => ({ $oid: id });

const assertObjectId = (value: unknown, label: string) => {
  if (typeof value !== "string" || !objectIdPattern.test(value)) {
    throw new ChatValidationError(`${label} is invalid.`);
  }

  return value;
};

const getText = (value: unknown) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, 5000);
};

const getConversationWhere = (account: ChatAccount) =>
  account.role === "user"
    ? { buyerId: toObjectId(account.id) }
    : { sellerId: toObjectId(account.id) };

const normalizeMongoValue = (value: any): any => {
  if (Array.isArray(value)) {
    return value.map(normalizeMongoValue);
  }

  if (value && typeof value === "object") {
    if (typeof value.$oid === "string") {
      return value.$oid;
    }

    if (value.$date?.$numberLong) {
      return new Date(Number(value.$date.$numberLong)).toISOString();
    }

    if (value.$date) {
      return new Date(value.$date).toISOString();
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key === "_id" ? "id" : key,
        normalizeMongoValue(item),
      ])
    );
  }

  return value;
};

const getFirstBatch = (result: any) =>
  Array.isArray(result?.cursor?.firstBatch)
    ? result.cursor.firstBatch.map(normalizeMongoValue)
    : [];

const findConversations = async (filter: Record<string, unknown>) => {
  const result = await prisma.$runCommandRaw({
    find: "conversations",
    filter,
    sort: {
      lastMessageAt: -1,
      updatedAt: -1,
    },
  });

  return getFirstBatch(result);
};

const findConversation = async (filter: Record<string, unknown>) => {
  const conversations = await findConversations(filter);

  return conversations[0] || null;
};

const findMessages = async (conversationId: string) => {
  const result = await prisma.$runCommandRaw({
    find: "messages",
    filter: {
      conversationId: toObjectId(conversationId),
    },
    sort: {
      createdAt: 1,
    },
  });

  return getFirstBatch(result);
};

const enrichConversation = async (conversation: any) => {
  if (!conversation) {
    return conversation;
  }

  const [buyer, seller, product] = await Promise.all([
    prisma.users.findUnique({
      where: { id: conversation.buyerId },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
      },
    }),
    prisma.sellers.findUnique({
      where: { id: conversation.sellerId },
      select: {
        id: true,
        name: true,
        email: true,
        shop: {
          select: {
            id: true,
            name: true,
            avatar: true,
            coverBanner: true,
          },
        },
      },
    }),
    prisma.products.findUnique({
      where: { id: conversation.productId },
      select: {
        id: true,
        title: true,
        slug: true,
        images: true,
        sale_price: true,
        regular_price: true,
      },
    }),
  ]);

  return {
    ...conversation,
    buyer,
    seller,
    product,
  };
};

const enrichMessage = async (message: any) => {
  if (!message) {
    return message;
  }

  const [senderUser, senderSeller] = await Promise.all([
    message.senderUserId
      ? prisma.users.findUnique({
          where: { id: message.senderUserId },
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        })
      : null,
    message.senderSellerId
      ? prisma.sellers.findUnique({
          where: { id: message.senderSellerId },
          select: {
            id: true,
            name: true,
            shop: {
              select: {
                id: true,
                name: true,
                avatar: true,
              },
            },
          },
        })
      : null,
  ]);

  return {
    ...message,
    senderUser,
    senderSeller,
  };
};

const updateConversation = async (
  conversationId: string,
  update: Record<string, unknown>
) => {
  await prisma.$runCommandRaw({
    update: "conversations",
    updates: [
      {
        q: { _id: toObjectId(conversationId) },
        u: update,
      },
    ],
  });

  return findConversation({ _id: toObjectId(conversationId) });
};

export const getAuthenticatedAccount = (req: any): ChatAccount => {
  if (!req.user?.id || (req.role !== "user" && req.role !== "seller")) {
    throw new ChatAuthError("Unauthorized chat account.");
  }

  return {
    id: req.user.id,
    role: req.role,
  };
};

export const getConversationForAccount = async (
  conversationId: string,
  account: ChatAccount
) => {
  const id = assertObjectId(conversationId, "Conversation id");
  const conversation = await findConversation({
    _id: toObjectId(id),
    ...getConversationWhere(account),
  });

  if (!conversation) {
    throw new ChatAuthError("Conversation not found.");
  }

  return enrichConversation(conversation);
};

export const createOrGetConversation = async (
  account: ChatAccount,
  payload: { productId?: unknown; sellerId?: unknown }
) => {
  if (account.role !== "user") {
    throw new ChatAuthError("Only customers can start a product chat.");
  }

  const productId = assertObjectId(payload.productId, "Product id");
  const product = await prisma.products.findUnique({
    where: { id: productId },
    select: {
      id: true,
      Shop: {
        select: {
          sellerId: true,
        },
      },
    },
  });

  if (!product) {
    throw new ChatValidationError("Product not found.");
  }

  const requestedSellerId =
    typeof payload.sellerId === "string" && payload.sellerId
      ? assertObjectId(payload.sellerId, "Seller id")
      : "";
  const sellerId = product.Shop?.sellerId;

  if (!sellerId) {
    throw new ChatValidationError("Seller was not found for this product.");
  }

  if (requestedSellerId && requestedSellerId !== sellerId) {
    throw new ChatAuthError("Seller does not own this product.");
  }

  const existingConversation = await findConversation({
    buyerId: toObjectId(account.id),
    sellerId: toObjectId(sellerId),
    productId: toObjectId(productId),
  });

  if (existingConversation) {
    return enrichConversation(existingConversation);
  }

  const now = new Date();
  const conversationId = newObjectId();

  await prisma.$runCommandRaw({
    insert: "conversations",
    documents: [
      {
        _id: toObjectId(conversationId),
        buyerId: toObjectId(account.id),
        sellerId: toObjectId(sellerId),
        productId: toObjectId(productId),
        lastMessageText: null,
        lastMessageSenderRole: null,
        lastMessageAt: now,
        buyerUnreadCount: 0,
        sellerUnreadCount: 0,
        buyerLastReadAt: null,
        sellerLastReadAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  });

  const conversation = await findConversation({ _id: toObjectId(conversationId) });

  return enrichConversation(conversation);
};

export const getConversations = async (account: ChatAccount) => {
  const conversations = await findConversations(getConversationWhere(account));

  return Promise.all(conversations.map(enrichConversation));
};

export const getMessages = async (
  conversationId: string,
  account: ChatAccount
) => {
  const conversation = await getConversationForAccount(conversationId, account);
  const messages = await findMessages(conversation.id);

  return {
    conversation,
    messages: await Promise.all(messages.map(enrichMessage)),
  };
};

export const sendMessage = async (
  conversationId: string,
  account: ChatAccount,
  payload: { text?: unknown }
) => {
  const text = getText(payload.text);

  if (!text) {
    throw new ChatValidationError("Message text is required.");
  }

  const conversation = await getConversationForAccount(conversationId, account);
  const now = new Date();
  const messageId = newObjectId();

  await prisma.$runCommandRaw({
    insert: "messages",
    documents: [
      {
        _id: toObjectId(messageId),
        conversationId: toObjectId(conversation.id),
        senderRole: account.role,
        senderUserId: account.role === "user" ? toObjectId(account.id) : null,
        senderSellerId:
          account.role === "seller" ? toObjectId(account.id) : null,
        text,
        readAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  });

  const updatedConversation = await updateConversation(conversation.id, {
    $set: {
      lastMessageText: text,
      lastMessageSenderRole: account.role,
      lastMessageAt: now,
      updatedAt: now,
    },
    $inc:
      account.role === "user"
        ? { sellerUnreadCount: 1 }
        : { buyerUnreadCount: 1 },
  });
  const message = (await findMessages(conversation.id)).find(
    (item: any) => item.id === messageId
  );

  return {
    conversation: await enrichConversation(updatedConversation),
    message: await enrichMessage(message),
  };
};

export const markConversationRead = async (
  conversationId: string,
  account: ChatAccount
) => {
  const conversation = await getConversationForAccount(conversationId, account);
  const readAt = new Date();

  await prisma.$runCommandRaw({
    update: "messages",
    updates: [
      {
        q: {
          conversationId: toObjectId(conversation.id),
          senderRole: account.role === "user" ? "seller" : "user",
          readAt: null,
        },
        u: {
          $set: {
            readAt,
            updatedAt: readAt,
          },
        },
        multi: true,
      },
    ],
  });

  const updatedConversation = await updateConversation(
    conversation.id,
    account.role === "user"
      ? {
          $set: {
            buyerUnreadCount: 0,
            buyerLastReadAt: readAt,
            updatedAt: readAt,
          },
        }
      : {
          $set: {
            sellerUnreadCount: 0,
            sellerLastReadAt: readAt,
            updatedAt: readAt,
          },
        }
  );

  return enrichConversation(updatedConversation);
};

export const getUnreadCount = async (account: ChatAccount) => {
  const conversations = await findConversations(getConversationWhere(account));

  return conversations.reduce(
    (total: number, conversation: any) =>
      total +
      (account.role === "user"
        ? Number(conversation.buyerUnreadCount || 0)
        : Number(conversation.sellerUnreadCount || 0)),
    0
  );
};
