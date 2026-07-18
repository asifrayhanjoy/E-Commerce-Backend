import { RequestHandler } from "express";
import {
  createOrGetConversation,
  getAuthenticatedAccount,
  getConversations,
  getMessages,
  getUnreadCount,
  markConversationRead,
  sendMessage,
} from "../chat.service";

export const createConversation: RequestHandler = async (req, res, next) => {
  try {
    const account = getAuthenticatedAccount(req);
    const conversation = await createOrGetConversation(account, req.body);

    res.status(200).json({
      success: true,
      conversation,
    });
  } catch (error) {
    next(error);
  }
};

export const getConversationList: RequestHandler = async (req, res, next) => {
  try {
    const account = getAuthenticatedAccount(req);
    const conversations = await getConversations(account);

    res.status(200).json({
      success: true,
      conversations,
    });
  } catch (error) {
    next(error);
  }
};

export const getConversationMessages: RequestHandler = async (req, res, next) => {
  try {
    const account = getAuthenticatedAccount(req);
    const conversationId = Array.isArray(req.params.conversationId)
      ? req.params.conversationId[0]
      : req.params.conversationId;

    if (!conversationId) {
      throw new Error("conversationId is required");
    }

    const result = await getMessages(conversationId, account);

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

export const sendConversationMessage: RequestHandler = async (req, res, next) => {
  try {
    const account = getAuthenticatedAccount(req);
    const conversationId = Array.isArray(req.params.conversationId)
      ? req.params.conversationId[0]
      : req.params.conversationId;

    if (!conversationId) {
      throw new Error("conversationId is required");
    }

    const result = await sendMessage(conversationId, account, req.body);

    res.status(201).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

export const markConversationMessagesRead: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const account = getAuthenticatedAccount(req);
    const conversationId = Array.isArray(req.params.conversationId)
      ? req.params.conversationId[0]
      : req.params.conversationId;

    if (!conversationId) {
      throw new Error("conversationId is required");
    }

    const conversation = await markConversationRead(
      conversationId,
      account
    );

    res.status(200).json({
      success: true,
      conversation,
    });
  } catch (error) {
    next(error);
  }
};

export const getConversationUnreadCount: RequestHandler = async (
  req,
  res,
  next
) => {
  try {
    const account = getAuthenticatedAccount(req);
    const unreadCount = await getUnreadCount(account);

    res.status(200).json({
      success: true,
      unreadCount,
    });
  } catch (error) {
    next(error);
  }
};
