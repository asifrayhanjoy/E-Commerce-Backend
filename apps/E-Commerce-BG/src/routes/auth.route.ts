import { Router } from "express";
import { createShop, createStripeConnectLink, createUserAddress, deleteUserAddress, getSeller, getUser, getUserAddresses, loginUser, refreshToken, registerSeller, resetUserPassword, sellerLogin, updateUserAddress, userForgotPassword, userRegistration, verifySeller, verifyUser } from "../controler/auth.controler";
import { verifyForgotPasswordOtp } from "../utils/auth.helper";
import isAuthenticated from "../utils/middleware/isAuthenticated";
import { isSeller } from "../utils/middleware/AuthorizeRole";

const router = Router();

                  // {userx}
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



export default router;
