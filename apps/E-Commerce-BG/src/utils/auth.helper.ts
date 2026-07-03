import crypto from "crypto";
import path from "path";
import ejs from "ejs";
import { ValidationError } from "../packages/error-handler";
import redis from "../packages/libs/Redis/Index";
import { sendEmail } from "./sentEmail";
import { NextFunction, Request, Response } from "express";
import prisma from "../packages/libs/prisma";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateRegistrationData = ( data: any, userType: "user" | "seller" ): ValidationError | void => {
  const { name, email, password, phone_number, country } = data;

  if (!name || !email || !password || (userType === "seller" && (!phone_number || !country))) {
    return new ValidationError("Missing required fields!");
  }

  if (!emailRegex.test(email)) {
    return new ValidationError("Invalid email format!");
  }
};

export const checkOtpRestrictions = async (email: string) => {
  if (await redis.get(`otp_lock:${email}`)) {
    throw new ValidationError(
      "Account locked due to multiple failed attempts. Try again after 30 minutes."
    );
  }
  if (await redis.get(`otp_spam_lock:${email}`)) {
    throw new ValidationError(
      "Too many OTP requests. Please wait 1 hour before requesting again."
    );
  }
  if (await redis.get(`otp_cooldown:${email}`)) {
    throw new ValidationError(
      "Please wait 1 minute before requesting a new OTP."
    );
  }
};

export const trackOtpRequests = async (email: string) => {
  const otpRequestKey = `otp_request_count:${email}`;
  const otpRequests = parseInt((await redis.get(otpRequestKey)) || "0");

  if (otpRequests >= 3) {
    await redis.set(`otp_spam_lock:${email}`, "locked", { ex: 3600 });
    throw new ValidationError(
      "Too many OTP requests. Please wait 1 hour before requesting again."
    );
  }
  await redis.set(otpRequestKey, (otpRequests + 1).toString(), { ex: 3600 });
};

export const sendOtp = async (name: string, email: string) => {
  const otp = crypto.randomInt(1000, 9999).toString();

  const templatePath = path.join(
    __dirname,
    "packages/libs/email-template/user-activation-mail.ejs"
  );

  const html = await ejs.renderFile(templatePath, {
    name,
    email,
    otp,
    companyName: process.env.COMPANY_NAME || "E-Shop",
  });

  await sendEmail({
    to: email,
    subject: `Verify Your ${process.env.COMPANY_NAME || "E-Shop"} Account`,
    html: html as string,
  });

  await redis.set(`otp:${email}`, otp, { ex: 300 });
  await redis.set(`otp_cooldown:${email}`, "true", { ex: 60 });
};

// Step 1: Verify OTP only — does NOT delete (deletion happens after user creation)
export const verifyOtp = async (email: string, otp: string): Promise<void> => {
  const storedOtp = await redis.get(`otp:${email}`);

  if (!storedOtp) {
    throw new ValidationError("OTP has expired. Please request a new one.");
  }

  const failedAttemptsKey = `otp_attempts:${email}`;
  const failedAttempts = parseInt((await redis.get(failedAttemptsKey)) || "0");

  if (String(storedOtp) !== String(otp)) {
    if (failedAttempts >= 2) {
      await redis.set(`otp_lock:${email}`, "locked", { ex: 1800 });
      await redis.del(`otp:${email}`);
      await redis.del(failedAttemptsKey);
      throw new ValidationError(
        "Too many failed attempts. Your account is locked for 30 minutes!"
      );
    }

    await redis.set(failedAttemptsKey, (failedAttempts + 1).toString(), { ex: 300 });
    throw new ValidationError(
      `Incorrect OTP. ${2 - failedAttempts} attempt(s) left.`
    );
  }
};

// Step 2: Delete OTP from Redis — called after user is successfully created in MongoDB
export const deleteOtp = async (email: string): Promise<void> => {
  await redis.del(`otp:${email}`);
  await redis.del(`otp_attempts:${email}`);
};

// handleForgotPassword
export const handleForgotPassword = async ( req: Request, res: Response, next: NextFunction, userType: "user" | "seller" ) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new ValidationError("Email is required!");
    }
    let user;
    if (userType === "user") {
      user = await prisma.users.findUnique({
        where: { email },
      });
    } else {
      user = await prisma.sellers.findUnique({
        where: { email },
      });
    }

    if (!user) {
      throw new ValidationError(`${userType} not found!`);
    }

    await checkOtpRestrictions(email);
    await trackOtpRequests(email);

    await sendOtp(user.name, email);

    res.status(200).json({
      message: "OTP sent to email. Please verify your account.",
    });
  } catch (error) {
    return next(error);
  }
};

export const verifyForgotPasswordOtp = async ( req: Request, res: Response, next: NextFunction,) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      throw new ValidationError(
        "Email and OTP are required!"
      );
    }
    await verifyOtp(email, otp);
    res.status(200).json({message: "OTP verified. You can now reset your password.",});
  } catch (error) {
    return next(error);
  }
};

