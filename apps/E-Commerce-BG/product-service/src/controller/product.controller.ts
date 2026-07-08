import { NextFunction, Request, Response } from "express";
import prisma from "../libs/prisma";

// Minimal ValidationError for controller use
class ValidationError extends Error {
  status?: number;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
  }
}

// Minimal NotFoundError for controller use
class NotFoundError extends Error {
  status?: number;
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
    this.status = 404;
  }
}

export const getCategories = async ( _req: Request, res: Response, next: NextFunction ) => {
  try {
    const config = await prisma.site_config.findFirst({
      select: {
        categories: true,
        subCategories: true,
      },
    });

    if (!config) {
      return res.status(404).json({
        message: "Categories not found",
      });
    }

    return res.status(200).json({
      categories: config.categories,
      subCategories: config.subCategories,
    });
  } catch (error) {
    return next(error);
  }
};

// Create discount codes
export const createDiscountCodes = async ( req: Request & { seller?: { id: string } }, res: Response, next: NextFunction ) => {
  try {
    const { public_name, discountType, discountValue, discountCode, } = req.body;

    if (!req.seller || !req.seller.id) {
      return res.status(401).json({ message: "Unauthorized: seller not found on request" });
    }

    const isDiscountCodeExist = await prisma.discount_codes.findUnique({
      where: {
        discountCode,
      },
    });

    if (isDiscountCodeExist) {
      return next(
        new ValidationError(
          "Discount code already available, please use a different code!"
        )
      );
    }

    const discount_code = await prisma.discount_codes.create({
      data: {
        public_name,
        discountType,
        discountValue: parseFloat(discountValue),
        discountCode,
        sellerId: req.seller.id,
      },
    });

    res.status(201).json({
      success: true,
      discount_code,
    });
  } catch (error) {
    next(error);
  }
};

/// get discount codes
export const getDiscountCodes = async ( req: any, res: Response, next: NextFunction ) => {
  try {
    const discount_codes = await prisma.discount_codes.findMany({
      where: {
        sellerId: req.seller.id,
      },
    });

    res.status(201).json({
      success: true,
      discount_codes,
    });
  } catch (error) {
    next(error);
  }
};

// delete discount code
export const deleteDiscountCode = async ( req: any, res: Response, next: NextFunction ) => {
  try {
    const { id } = req.params;
    const sellerId = req.seller?.id;

    const discountCode = await prisma.discount_codes.findUnique({
      where: { id },
      select: { id: true, sellerId: true },
    });

    if (!discountCode) {
      return next(new NotFoundError("Discount code not found!"));
    }

    if (discountCode.sellerId !== sellerId) {
      return next(new ValidationError("Unauthorized access!"));
    }

    await prisma.discount_codes.delete({
      where: { id },
    });

    return res.status(200).json({
      message: "Discount code successfully deleted",
    });
  } catch (error) {
    next(error);
  }
};