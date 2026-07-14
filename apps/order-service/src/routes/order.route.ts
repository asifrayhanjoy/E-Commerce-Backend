import express, { Router } from "express";
import { createPaymentIntent, createPaymentSession, verifyingPaymentSession } from "../controllers/order.controller";
import isAuthenticated from "../middleware/isAuthenticated";

const router: Router = express.Router();

router.post("/create-payment-intent", isAuthenticated, createPaymentIntent );
router.post("/create-payment-session", isAuthenticated, createPaymentSession );
router.get("/verifying-payment-session", isAuthenticated, verifyingPaymentSession );


export default router;
