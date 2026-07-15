import express, { Router } from "express";
import { createPaymentIntent, createPaymentSession, getSellerOrder, getSellerOrders, getSellerPayments, updateSellerOrderDeliveryStatus, verifyingPaymentSession } from "../controllers/order.controller";
import isAuthenticated from "../middleware/isAuthenticated";

const router: Router = express.Router();

router.post("/create-payment-intent", isAuthenticated, createPaymentIntent );
router.post("/create-payment-session", isAuthenticated, createPaymentSession );
router.get("/verifying-payment-session", isAuthenticated, verifyingPaymentSession );
router.get("/get-Seller-Orders", isAuthenticated, getSellerOrders );
router.get("/get-Seller-Payments", isAuthenticated, getSellerPayments );
router.get("/get-Seller-Order/:orderId", isAuthenticated, getSellerOrder );
router.patch("/get-Seller-Order/:orderId/delivery-status", isAuthenticated, updateSellerOrderDeliveryStatus );


export default router;
