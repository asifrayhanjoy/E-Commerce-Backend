import { NextFunction, Request, Response } from "express";
import ImageKit from "imagekit";
import prisma from "../libs/prisma";

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || "",
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || "",
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || "",
});

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

// Creates a new discount code for the authenticated seller.
export const createDiscountCodes = async ( req: Request & { user?: { id: string } }, res: Response, next: NextFunction ) => {
  try {
    const { public_name, discountType, discountValue, discountCode, } = req.body;
    const sellerId = req.user?.id;

    if (!sellerId) {
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
        sellerId,
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
    const sellerId = req.user?.id;

    if (!sellerId) {
      return res.status(401).json({ message: "Unauthorized: seller not found on request" });
    }

    const discount_codes = await prisma.discount_codes.findMany({
      where: {
        sellerId,
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

// Deletes a discount code after confirming it belongs to the authenticated seller.
export const deleteDiscountCode = async ( req: any, res: Response, next: NextFunction ) => {
  try {
    const { id } = req.params;
    const sellerId = req.user?.id;

    if (!sellerId) {
      return res.status(401).json({ message: "Unauthorized: seller not found on request" });
    }

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

// upload product image
export const uploadProductImage = async ( req: Request, res: Response, next: NextFunction ) => {
  try {
    const { fileName } = req.body;

    const response = await imagekit.upload({
      file: fileName,
      fileName: `product-${Date.now()}.jpg`,
      folder: "/products",
    });

    res.status(201).json({
      file_url: response.url,
      fileName: response.fileId,
    });
  } catch (error) {
    next(error);
  }
};


