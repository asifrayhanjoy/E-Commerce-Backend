import { Router } from "express";
import { loginUser, resetUserPassword, userForgotPassword, userRegistration, verifyUser } from "../controler/auth.controler";
import { verifyForgotPasswordOtp } from "../utils/auth.helper";

const router = Router();

router.post("/register", userRegistration);
router.post("/verify-otp", verifyUser);
router.post("/login", loginUser);
router.post("/forgot-password-user", userForgotPassword);
router.post("/reset-password-user", resetUserPassword);
router.post("/verify-forgot-password-user", verifyForgotPasswordOtp);

export default router;
