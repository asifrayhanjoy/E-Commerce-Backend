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

// Minimal AuthError for controller use
class AuthError extends Error {
  status?: number;
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
    this.status = 401;
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
      fileId: response.fileId,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteProductImage = async ( req: Request, res: Response, next: NextFunction ) => {
  try {
    const { fileId } = req.body;

    const response = await imagekit.deleteFile(fileId);

    res.status(201).json({
      success: true,
      response,
    });
  } catch (error) {
    next(error);
  }
};

// create product controller
export const createProduct = async (req: any, res: Response, next: NextFunction ) => {
  try {
    const {
      title,
      short_description,
      detailed_description,
      warranty,
      custom_specifications,
      slug,
      tags,
      cash_on_delivery,
      brand,
      video_url,
      category,
      colors = [],
      sizes = [],
      discountCodes,
      stock,
      sale_price,
      regular_price,
      subCategory,
      customProperties = {},
      images = [],
    } = req.body;

    const validImages = Array.isArray(images)
      ? images.filter((image: any) => image && image.fileId && image.file_url)
      : [];

    if (
      !title ||
      !slug ||
      !short_description ||
      !detailed_description ||
      !category ||
      !subCategory ||
      sale_price === undefined ||
      sale_price === null ||
      validImages.length === 0 ||
      !tags ||
      stock === undefined ||
      stock === null ||
      regular_price === undefined ||
      regular_price === null
    ) {
      return next(new ValidationError("Missing required fields"));
    }

    const seller = req.seller ?? (req.role === "seller" ? req.user : undefined);
    const shopId = seller?.shop?.id ?? req.body.shopId;

    if (!seller?.id) {
      return next(new AuthError("Only seller can create products!"));
    }

    if (!shopId) {
      return next(new ValidationError("Seller shop not found"));
    }

    const slugChecking = await prisma.products.findUnique({
      where: {
        slug,
      },
    });

    if (slugChecking) {
      return next(
        new ValidationError("Slug already exist! Please use a different slug!")
      );
    }

    const newProduct = await prisma.products.create({
      data: {
        title,
        short_description,
        detailed_description,
        warranty,
        slug,
        tags: Array.isArray(tags) ? tags.join(",") : tags,
        cashOnDelivery: cash_on_delivery,
        brand,
        video_url,
        category,
        subCategory,
        colors: Array.isArray(colors) ? colors.join(",") : colors,
        sizes,
        discount_codes: discountCodes || [],
        stock: parseInt(stock, 10),
        sale_price: parseFloat(sale_price),
        regular_price: parseFloat(regular_price),
        custom_properties: customProperties || {},
        custom_specifications: custom_specifications || {},
        shopId,
        images: {
          create: validImages.map((image: any) => ({
            file_id: image.fileId,
            url: image.file_url,
          })),
        },
      },
      include: {
        images: true,
      },
    });

    res.status(201).json({
      success: true,
      newProduct,
    });
  } catch (error) {
    next(error);
  }
};

// get logged in seller products
export const getShopProducts = async ( req: any, res: Response, next: NextFunction ) => {
  try {
    const seller = req.seller ?? (req.role === "seller" ? req.user : undefined);
    const shopId = seller?.shop?.id;

    if (!shopId) {
      return next(new AuthError("Seller shop not found"));
    }

    const products = await prisma.products.findMany({
      where: {
        shopId,
      },
      include: {
        images: true,
      },
    });

    res.status(201).json({
      success: true,
      products,
    });
  } catch (error) {
    next(error);
  }
};

// delete product
export const deleteProduct = async ( req: any, res: Response, next: NextFunction ) => {
  try {
    const { productId } = req.params;
    const seller = req.seller ?? (req.role === "seller" ? req.user : undefined);
    const shopId = seller?.shop?.id;

    if (!shopId) {
      return next(new AuthError("Seller shop not found"));
    }

    const product = await prisma.products.findUnique({
      where: { id: productId },
      select: {
        id: true,
        shopId: true,
        isDeleted: true,
      },
    });

    if (!product) {
      return next(new ValidationError("Product not found"));
    }

    if (product.shopId !== shopId) {
      return next(new ValidationError("Unauthorized action"));
    }

    if (product.isDeleted) {
      return next(new ValidationError("Product is already deleted"));
    }

    const deletedProduct = await prisma.products.update({
      where: { id: productId },
      data: {
        isDeleted: true,
        deletedAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    return res.status(200).json({
      message:
        "Product is scheduled for deletion in 24 hours. You can restore it within this time.",
      deletedAt: deletedProduct.deletedAt,
    });
  } catch (error) {
    return next(error);
  }
};

// restore product
export const restoreProduct = async ( req: any, res: Response, next: NextFunction ) => {
  try {
    const { productId } = req.params;

    const seller = req.seller ?? (req.role === "seller" ? req.user : undefined);
    const shopId = seller?.shop?.id;

    if (!shopId) {
      return next(new AuthError("Seller shop not found"));
    }

    const product = await prisma.products.findUnique({
      where: { id: productId },
      select: { id: true, shopId: true, isDeleted: true },
    });

    if (!product) {
      return next(new ValidationError("Product not found"));
    }

    if (product.shopId !== shopId) {
      return next(new ValidationError("Unauthorized action"));
    }

    if (!product.isDeleted) {
      return res
        .status(400)
        .json({ message: "Product is not in deleted state" });
    }

    await prisma.products.update({
      where: { id: productId },
      data: {
        isDeleted: false,
        deletedAt: null,
      },
    });

    return res
      .status(200)
      .json({ message: "Product successfully restored!" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Error restoring product", error });
  }
};
