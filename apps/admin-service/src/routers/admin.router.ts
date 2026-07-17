import express, { Router } from "express";
import cors from "cors";
import {
  getAdminDashboard,
  getAdminEvents,
  getAdminOrder,
  getAdminOrders,
  getAdminProduct,
  getAdminProducts,
  getAdminSeller,
  getAdminSellers,
  getAdminUser,
  getAdminUsers,
  loginAdmin,
  registerAdmin,
} from "../controllers/admin.controllers";

const router: Router = express.Router();

const adminCors = cors({
  origin: true,
  credentials: true,
});

router.options("/v1/auth/register-admin", adminCors);
router.options("/v1/auth/login-admin", adminCors);
router.options("/v1/admin/dashboard", adminCors);
router.options("/v1/auth/admin/dashboard", adminCors);
router.options("/v1/admin/orders", adminCors);
router.options("/v1/auth/admin/orders", adminCors);
router.options("/v1/admin/orders/:orderId", adminCors);
router.options("/v1/auth/admin/orders/:orderId", adminCors);
router.options("/v1/admin/products", adminCors);
router.options("/v1/auth/admin/products", adminCors);
router.options("/v1/admin/products/:productId", adminCors);
router.options("/v1/auth/admin/products/:productId", adminCors);
router.options("/v1/admin/events", adminCors);
router.options("/v1/auth/admin/events", adminCors);
router.options("/v1/admin/users", adminCors);
router.options("/v1/auth/admin/users", adminCors);
router.options("/v1/admin/users/:userId", adminCors);
router.options("/v1/auth/admin/users/:userId", adminCors);
router.options("/v1/admin/sellers", adminCors);
router.options("/v1/auth/admin/sellers", adminCors);
router.options("/v1/admin/sellers/:sellerId", adminCors);
router.options("/v1/auth/admin/sellers/:sellerId", adminCors);
router.post("/v1/auth/register-admin", adminCors, registerAdmin);
router.post("/v1/auth/login-admin", adminCors, loginAdmin);
router.get("/v1/admin/dashboard", adminCors, getAdminDashboard);
router.get("/v1/auth/admin/dashboard", adminCors, getAdminDashboard);
router.get("/v1/admin/orders", adminCors, getAdminOrders);
router.get("/v1/auth/admin/orders", adminCors, getAdminOrders);
router.get("/v1/admin/orders/:orderId", adminCors, getAdminOrder);
router.get("/v1/auth/admin/orders/:orderId", adminCors, getAdminOrder);
router.get("/v1/admin/products", adminCors, getAdminProducts);
router.get("/v1/auth/admin/products", adminCors, getAdminProducts);
router.get("/v1/admin/products/:productId", adminCors, getAdminProduct);
router.get("/v1/auth/admin/products/:productId", adminCors, getAdminProduct);
router.get("/v1/admin/events", adminCors, getAdminEvents);
router.get("/v1/auth/admin/events", adminCors, getAdminEvents);
router.get("/v1/admin/users", adminCors, getAdminUsers);
router.get("/v1/auth/admin/users", adminCors, getAdminUsers);
router.get("/v1/admin/users/:userId", adminCors, getAdminUser);
router.get("/v1/auth/admin/users/:userId", adminCors, getAdminUser);
router.get("/v1/admin/sellers", adminCors, getAdminSellers);
router.get("/v1/auth/admin/sellers", adminCors, getAdminSellers);
router.get("/v1/admin/sellers/:sellerId", adminCors, getAdminSeller);
router.get("/v1/auth/admin/sellers/:sellerId", adminCors, getAdminSeller);

export default router;
