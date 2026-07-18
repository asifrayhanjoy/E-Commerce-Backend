import { Router } from "express";
import { createAdminAccount, createAdminNotification, createSellerStorefrontProduct, createShop, createStripeConnectLink, createUserAddress, deleteSellerShop, deleteUserAddress, getAdminCustomization, getAdminDashboard, getAdminManagement, getAdminNotificationList, getAdminPayments, getAdminSeller, getAdminSellers, getSeller, getSellerNotificationList, getSellerSettings, getSellerStorefront, getUser, getUserAddresses, loginAdmin, loginUser, refreshToken, registerSeller, resetUserPassword, sellerLogin, updateAdminCustomization, updateSellerSettings, updateSellerStorefront, updateSellerStorefrontProduct, updateUserAddress, userForgotPassword, userRegistration, verifySeller, verifyUser } from "../controler/auth.controler";
import { verifyForgotPasswordOtp } from "../utils/auth.helper";
import isAuthenticated from "../utils/middleware/isAuthenticated";
import { isSeller } from "../utils/middleware/AuthorizeRole";

const router = Router();

                  // {user}
router.post("/register", userRegistration);
router.post("/verify-otp", verifyUser);
router.post("/login", loginUser);
router.post("/refresh-token", refreshToken);
router.post("/forgot-password-user", userForgotPassword);
router.post("/reset-password-user", resetUserPassword);
router.post("/verify-forgot-password-user", verifyForgotPasswordOtp);
router.get("/login-in-user", isAuthenticated, getUser);
router.get("/addresses", isAuthenticated, getUserAddresses);
router.post("/addresses", isAuthenticated, createUserAddress);
router.put("/addresses/:addressId", isAuthenticated, updateUserAddress);
router.delete("/addresses/:addressId", isAuthenticated, deleteUserAddress);
                  // {seller}
router.post("/seller-register", registerSeller);
router.post("/verify-seller", verifySeller);
router.post("/create-shop", createShop);
router.post("/create-stripe-link", createStripeConnectLink);
router.post("/login-seller", sellerLogin);
router.get("/loged-in-seller", isAuthenticated,isSeller, getSeller);
router.get("/seller-settings", isAuthenticated,isSeller, getSellerSettings);
router.put("/seller-settings", isAuthenticated,isSeller, updateSellerSettings);
router.get("/seller-notifications", isAuthenticated,isSeller, getSellerNotificationList);
router.get("/seller-storefront", isAuthenticated,isSeller, getSellerStorefront);
router.put("/seller-storefront", isAuthenticated,isSeller, updateSellerStorefront);
router.post("/seller-storefront/products", isAuthenticated,isSeller, createSellerStorefrontProduct);
router.put("/seller-storefront/products/:productId", isAuthenticated,isSeller, updateSellerStorefrontProduct);
router.delete("/seller-shop", isAuthenticated,isSeller, deleteSellerShop);
                  // {Admin}
router.post("/login-admin", loginAdmin);
router.get("/admin/dashboard", getAdminDashboard);
router.get("/admin/admins", getAdminManagement);
router.post("/admin/admins", createAdminAccount);
router.get("/admin/management", getAdminManagement);
router.post("/admin/management", createAdminAccount);
router.get("/admin/notifications", getAdminNotificationList);
router.post("/admin/notifications", createAdminNotification);
router.get("/admin/payments", getAdminPayments);
router.get("/admin/customization", getAdminCustomization);
router.patch("/admin/customization", updateAdminCustomization);
router.get("/admin/sellers", getAdminSellers);
router.get("/admin/sellers/:sellerId", getAdminSeller);


export default router;
