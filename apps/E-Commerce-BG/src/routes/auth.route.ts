import { Router } from "express";
import { getUser, loginUser, refreshToken, resetUserPassword, userForgotPassword, userRegistration, verifyUser } from "../controler/auth.controler";
import { verifyForgotPasswordOtp } from "../utils/auth.helper";
import isAuthenticated from "../utils/middleware/isAuthenticated";

const router = Router();

router.post("/register", userRegistration);
router.post("/verify-otp", verifyUser);
router.post("/login", loginUser);
router.post("/refresh-token-user", refreshToken);
router.get("/login-in-user", isAuthenticated, getUser);
router.post("/forgot-password-user", userForgotPassword);
router.post("/reset-password-user", resetUserPassword);
router.post("/verify-forgot-password-user", verifyForgotPasswordOtp);

export default router;
