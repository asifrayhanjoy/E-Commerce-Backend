import { NextFunction, Request, Response } from "express";
import prisma from "../packages/libs/prisma";
import { validateRegistrationData, checkOtpRestrictions, trackOtpRequests, sendOtp, verifyOtp, deleteOtp, handleForgotPassword, verifyForgotPasswordOtp, } from "../utils/auth.helper";
import { AuthError, ValidationError } from "../packages/error-handler";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { setCookie } from "../utils/cookic/set.cookic";

// POST /register
// 1. Validate input
// 2. Generate OTP → store in Redis → send to email


                          // {User}
                          
// Register User
export const userRegistration = async ( req: Request, res: Response, next: NextFunction ) => {
  try {
    const validationError = validateRegistrationData(req.body, "user");
    if (validationError) return next(validationError);

    const { name, email } = req.body;

    const existingUser = await prisma.users.findUnique({
       where:{ email } });
    if (existingUser) {
      return next(new ValidationError("User already exists with this email!"));
    }

    await checkOtpRestrictions(email);
    await trackOtpRequests(email);
    await sendOtp(name, email);

    res.status(201).json({
      message: "OTP sent to your email. Please verify to complete registration.",
    });
  } catch (error) {
    return next(error);
  }
};

// login User
export const loginUser = async ( req: Request, res: Response, next: NextFunction ) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return next(
        new ValidationError("Email and password are required!")
      );
    }

    const user = await prisma.users.findUnique({
      where: { email },
    });

    console.log("Email:", email);
    console.log("Input Password:", password);
    console.log("User:", user);
    console.log("DB Password:", user?.password);

    if (!user) {
      return next(
        new AuthError("User doesn't exists!")
      );
    }

    // verify password
    const isMatch = await bcrypt.compare(password, user.password!);

    console.log("isMatch:", isMatch);

    if (!isMatch) {
      return next(new AuthError("Invalid email or password"));
    }

    // Generate access token
    const accessToken = jwt.sign(
      {
        id: user.id,
        role: "user",
      },
      process.env.ACCESS_TOKEN_SECRET as string,
      {
        expiresIn: "15m",
      }
    );

// Generate refersh token
      const refershToken = jwt.sign(
      {
        id: user.id,
        role: "user",
      },
      process.env.REFRESH_TOKEN_SECRET as string,
      {
        expiresIn: "7d",
      }
    );

// Store the refresh and access token in an httpOnly secure cookie
      setCookie(res, "refresh_token", refershToken);
      setCookie(res, "access_token", accessToken);

      res.status(200).json({
      message: "Login successful!",
      user: {
      id: user.id,
      email: user.email,
      name: user.name,
      },
      });

  } catch (error) {
    return next(error);
  }
};

// refresh token user
export const refreshToken = async ( req: Request, res: Response, next: NextFunction ) => {
  try {
    const refreshToken = req.cookies.refresh_token;

    if (!refreshToken) {
      throw new ValidationError("Unauthorized! No refresh token.");
    }

    const decoded = jwt.verify(
      refreshToken,
      process.env.REFRESH_TOKEN_SECRET as string
    ) as unknown as { id: string; role: string };

    if (!decoded || !decoded.id || !decoded.role) {
      throw new ValidationError("Forbidden! Invalid refresh token.");
    }

    // let account;
    // if (decoded.role === "user")

    const user = await prisma.users.findUnique({
      where: { id: decoded.id },
    });

    if (!user) {
      return new AuthError("Forbidden! User/Seller not found");
    }

    const newAccessToken = jwt.sign(
      { id: decoded.id, role: decoded.role },
      process.env.ACCESS_TOKEN_SECRET as string,
      { expiresIn: "15m" }
    );

    setCookie(res, "access_token", newAccessToken);

    return res.status(201).json({
      success: true,
    });
  } catch (error) {
    return next(error);
  }
};

// get logged in user
export const getUser = async ( req: any, res: Response, next: NextFunction ) => {
  try {
    const user = req.user;

    res.status(201).json({
    success: true,
    user,
    });
  } 
  catch (error) {
    next(error);
  }
};

//  Verify User
export const verifyUser = async ( req: Request, res: Response, next: NextFunction ) => {
  try {
    const { email, otp, password, name } = req.body;

    if (!email || !otp || !password || !name) {
      return next(new ValidationError("All fields are required!"));
    }

    const existingUser = await prisma.users.findUnique({ where: { email } });
    if (existingUser) {
      return next(new ValidationError("User already exists with this email!"));
    }

    // Verify OTP — throws if incorrect
    await verifyOtp(email, otp);

    // Hash the password
    console.log("Verify-OTP Input Password:", password);
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log("Verify-OTP Hashed Password:", hashedPassword);

    // Create user in MongoDB
    await prisma.users.create({
      data: { name, email, password: hashedPassword },
    });

    // Delete OTP from Redis
    await deleteOtp(email);

    // Return success
    res.status(201).json({ status: "success" });
  } catch (error) {
    return next(error);
  }
};

// User Forgot Password
export const userForgotPassword = async ( req: Request, res: Response, next: NextFunction ) => {
  await handleForgotPassword( req, res, next, "user");
};

// Verify forgot password OTP
export const verifyUserForgotPassword = async ( req: Request, res: Response, next: NextFunction ) => {
  await verifyForgotPasswordOtp( req, res, next);
};

// Reset user password
export const resetUserPassword = async ( req: Request, res: Response, next: NextFunction ) => {
  try {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
      return next(
        new ValidationError("Email and new password are required!")
      );
    }

    const user = await prisma.users.findUnique({where: { email },});

    if (!user) {
      return next(
        new ValidationError("User not found!")
      );
    }

    // compare new password with the ixisting one
    const isSamePassword = await bcrypt.compare( newPassword,user.password!);

if (isSamePassword) {
  return next(
    new ValidationError(
      "New password cannot be the same as the old password!"
    )
  );
}

// hash the new password
const hashedPassword = await bcrypt.hash(newPassword, 10);
await prisma.users.update({ where: { email },
  data: {
    password: hashedPassword,
  },
});

res.status(200).json({message: "Password reset successfully!", });
  } catch (error) {
    next(error);
  }
};

                          // {Seller}

// register a new seller
export const registerSeller = async ( req: Request, res: Response, next: NextFunction ) => {
  try {
    validateRegistrationData(req.body, "seller");
    const { name, email } = req.body;

    const existingSeller = await prisma.users.findUnique({ where: { email } });
    if (existingSeller) {
      return next(new ValidationError("Seller already exists with this email!"));
    }

    await checkOtpRestrictions(email);
    await trackOtpRequests(email);
    await sendOtp(name, email);

    res.status(200).json(
    { message: "OTP sent to email. Please verify your account." });
  } catch (error) {
    next(error);
  }
};

// verify seller with OTP
export const verifySeller = async ( req: Request, res: Response, next: NextFunction ) => {
  try {
    const { email, otp, password, name, phone_number, country } = req.body;

    if (!email || !otp || !password || !name || !phone_number || !country) {
    return next(new ValidationError("All fields are required!"));
    }

    const existingSeller = await prisma.sellers.findUnique({
    where: { email },
    });

   if (existingSeller)
   return next(
   new ValidationError("Seller already exists with this email!")
  );

  await verifyOtp(email, otp);

  const hashedPassword = await bcrypt.hash(password, 10);

  const seller = await prisma.sellers.create({
  data: { name, email, password: hashedPassword, country, phone_number,},});

res.status(201).json({
  seller,
  message: "Seller registered successfully!",
  });

  } catch (error) {
    next(error);
  }
};