import { Router } from "express";
import {
  createConversation,
  getConversationList,
  getConversationMessages,
  getConversationUnreadCount,
  markConversationMessagesRead,
  sendConversationMessage,
} from "../controller/chat.controller";
import isAuthenticated from "../middleware/isAuthenticated";

const router = Router();

router.use(isAuthenticated);

router.get("/conversations", getConversationList);
router.post("/conversations", createConversation);
router.get("/conversations/:conversationId/messages", getConversationMessages);
router.post("/conversations/:conversationId/messages", sendConversationMessage);
router.patch("/conversations/:conversationId/read", markConversationMessagesRead);
router.get("/unread-count", getConversationUnreadCount);

export default router;
