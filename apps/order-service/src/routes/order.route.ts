import express, { Router } from "express";
import { changeUserPassword, createPaymentIntent, createPaymentSession, getAdminOrders, getSellerOrder, getSellerOrders, getSellerPayments, getUserOrders, updateSellerOrderDeliveryStatus, verifyCouponCode, verifyingPaymentSession } from "../controllers/order.controller";
import isAuthenticated from "../middleware/isAuthenticated";

const router: Router = express.Router();

router.post("/create-payment-intent", isAuthenticated, createPaymentIntent );
router.post("/create-payment-session", isAuthenticated, createPaymentSession );
router.get("/my-orders", isAuthenticated, getUserOrders );
router.get("/admin/orders", getAdminOrders );
router.get("/verifying-payment-session", isAuthenticated, verifyingPaymentSession );
router.get("/get-Seller-Orders", isAuthenticated, getSellerOrders );
router.get("/get-Seller-Payments", isAuthenticated, getSellerPayments );
router.get("/get-Seller-Order/:orderId", isAuthenticated, getSellerOrder );
router.patch("/get-Seller-Order/:orderId/delivery-status", isAuthenticated, updateSellerOrderDeliveryStatus );
router.put("/verify-coupon", isAuthenticated, verifyCouponCode)
router.put("/change-password", isAuthenticated, changeUserPassword)


export default router;
