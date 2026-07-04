import { Router } from "express";
import { createShop, createStripeConnectLink, getSeller, getUser, loginUser, refreshToken, registerSeller, resetUserPassword, sellerLogin, userForgotPassword, userRegistration, verifySeller, verifyUser } from "../controler/auth.controler";
import { verifyForgotPasswordOtp } from "../utils/auth.helper";
import isAuthenticated from "../utils/middleware/isAuthenticated";
import { isSeller } from "../utils/middleware/AuthorizeRole";

const router = Router();

                  // {userx}
router.post("/register", userRegistration);
router.post("/verify-otp", verifyUser);
router.post("/login", loginUser);
router.post("/refresh-token-user", refreshToken);
router.post("/forgot-password-user", userForgotPassword);
router.post("/reset-password-user", resetUserPassword);
router.post("/verify-forgot-password-user", verifyForgotPasswordOtp);
router.get("/login-in-user", isAuthenticated, getUser);
                  // {seller}
router.post("/seller-register", registerSeller);
router.post("/verify-seller", verifySeller);
router.post("/create-shop", createShop);
router.post("/create-stripe-link", createStripeConnectLink);
router.post("/login-seller", sellerLogin);
router.get("/loged-in-seller", isAuthenticated,isSeller, getSeller);



export default router;
