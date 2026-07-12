import { NextFunction, Request, Response } from "express";
import ImageKit from "imagekit";
import prisma from "../libs/prisma";
import { Prisma } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      seller?: { id: string };
    }
  }
}

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

const getProductObjectIdQuery = (productId: string) => {
  if (!/^[a-f\d]{24}$/i.test(productId)) {
    throw new ValidationError("Invalid product id");
  }

  return { _id: { $oid: productId } };
};

const getTrackingCounts = async (productId: string) => {
  const result: any = await prisma.$runCommandRaw({
    aggregate: "products",
    pipeline: [
      { $match: getProductObjectIdQuery(productId) },
      {
        $project: {
          _id: 0,
          views: { $size: { $ifNull: ["$trackingViewKeys", []] } },
          wishes: { $size: { $ifNull: ["$trackingWishKeys", []] } },
          carts: {
            $sum: {
              $map: {
                input: { $ifNull: ["$trackingCartItems", []] },
                as: "item",
                in: { $ifNull: ["$$item.quantity", 0] },
              },
            },
          },
        },
      },
    ],
    cursor: {},
  });

  return result?.cursor?.firstBatch?.[0] || { views: 0, wishes: 0, carts: 0 };
};

const normalizeTrackingKey = (value: unknown) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, 300);
};

const normalizeTrackingText = (value: unknown) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, 300);
};

const getTrackingShopId = async (productId: string, requestShopId: unknown) => {
  const shopId = normalizeTrackingText(requestShopId);

  if (shopId) {
    return shopId;
  }

  const product = await prisma.products.findUnique({
    where: { id: productId },
    select: { shopId: true },
  });

  return product?.shopId || "";
};

const createTrackingEvent = (
  productId: string,
  shopId: string,
  action: string
) => ({
  productId,
  shopId,
  action,
  timestamp: new Date().toISOString(),
});

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


// get seller stripe information
export const getStripeAccount = async ( req: Request, res: Response, next: NextFunction ) => {
  try {
    const sellerId = req.seller?.id;

    if (!sellerId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const shop = await prisma.shops.findUnique({
      where: {
        sellerId,
      },
    });

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    res.status(200).json({
      success: true,
      stripeAccount: {
        accountId: (shop as any).stripeAccountId,
        status: (shop as any).stripeAccountStatus,
      },
    });
  } catch (error) {
    next(error);
  }
};

// get All products
export const getAllProducts = async ( req: Request, res: Response, next: NextFunction ) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    const type = req.query.type;

    const baseFilter: Prisma.productsWhereInput = {
      AND: [
        {
          OR: [
            { starting_date: null },
            { starting_date: { isSet: false } },
          ],
        },
        {
          OR: [
            { ending_date: null },
            { ending_date: { isSet: false } },
          ],
        },
      ],
    };

    const orderBy: Prisma.productsOrderByWithRelationInput =
      type === "latest"
        ? { createdAt: "desc" as Prisma.SortOrder }
        : { createdAt: "desc" as Prisma.SortOrder };

    const [products, total, top10Products] = await Promise.all([
      prisma.products.findMany({
        skip,
        take: limit,
        include: {
          images: true,
          Shop: true,
        },
        where: baseFilter,
        orderBy,
      }),

      prisma.products.count({
        where: baseFilter,
      }),

      prisma.products.findMany({
        take: 10,
        where: baseFilter,
        orderBy,
      }),
    ]);

    res.status(200).json({
      products,
      top10By: type === "latest" ? "latest" : "topSales",
      top10Products,
      total,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    next(error);
  }
};

export const getProductDetails = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const productId =
      typeof req.query.productId === "string"
        ? req.query.productId
        : typeof req.query.id === "string"
          ? req.query.id
          : "";
    const slug = typeof req.query.slug === "string" ? req.query.slug : "";
    const visibleProductFilter = {
      OR: [
        { isDeleted: false },
        { isDeleted: null },
        { isDeleted: { isSet: false } },
      ],
    };

    if (productId && !/^[a-f\d]{24}$/i.test(productId)) {
      return next(new ValidationError("Invalid product id"));
    }

    const product = await prisma.products.findFirst({
      where: {
        ...visibleProductFilter,
        ...(productId ? { id: productId } : {}),
        ...(slug ? { slug } : {}),
      },
      include: {
        images: true,
        Shop: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!product) {
      return next(new NotFoundError("Product not found"));
    }

    return res.status(200).json({
      success: true,
      product,
    });
  } catch (error) {
    next(error);
  }
};

export const getProductTracking = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const productId = Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId;
    const counts = await getTrackingCounts(productId);

    res.status(200).json({
      success: true,
      productId: req.params.productId,
      ...counts,
    });
  } catch (error) {
    next(error);
  }
};

export const trackProductView = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const trackingKey = normalizeTrackingKey(req.body?.trackingKey);

    if (!trackingKey) {
      return next(new ValidationError("Tracking key is required"));
    }

    const productId = Array.isArray(req.params.productId)
      ? req.params.productId[0]
      : req.params.productId;

    await prisma.$runCommandRaw({
      update: "products",
      updates: [
        {
          q: getProductObjectIdQuery(productId),
          u: {
            $addToSet: { trackingViewKeys: trackingKey },
            $currentDate: { trackingUpdatedAt: true },
          },
          upsert: false,
        },
      ],
    });

    const counts = await getTrackingCounts(productId);

    res.status(200).json({
      success: true,
      productId: req.params.productId,
      ...counts,
    });
  } catch (error) {
    next(error);
  }
};

export const trackProductWishlist = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const trackingKey = normalizeTrackingKey(req.body?.trackingKey);
    const action = req.body?.action === "remove" ? "remove" : "add";

    if (!trackingKey) {
      return next(new ValidationError("Tracking key is required"));
    }

    const productId = Array.isArray(req.params.productId) ? req.params.productId[0] : req.params.productId;
    const shopId = await getTrackingShopId(productId, req.body?.shopId);
    const trackingEvent = createTrackingEvent(
      productId,
      shopId,
      action === "remove" ? "remove_from_wishlist" : "add_to_wishlist"
    );

    await prisma.$runCommandRaw({
      update: "products",
      updates: [
        {
          q: getProductObjectIdQuery(productId),
          u:
            action === "remove"
              ? {
                  $pull: { trackingWishKeys: trackingKey },
                  $push: { trackingEvents: trackingEvent },
                  $currentDate: { trackingUpdatedAt: true },
                }
              : {
                  $addToSet: { trackingWishKeys: trackingKey },
                  $push: { trackingEvents: trackingEvent },
                  $currentDate: { trackingUpdatedAt: true },
                },
          upsert: false,
        },
      ],
    });

    const counts = await getTrackingCounts(productId);

    res.status(200).json({
      success: true,
      productId: productId,
      ...counts,
    });
  } catch (error) {
    next(error);
  }
};

export const trackProductCart = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const trackingKey = normalizeTrackingKey(req.body?.trackingKey);
    const action =
      req.body?.action === "remove"
        ? "remove"
        : req.body?.action === "set"
          ? "set"
          : "add";
    const quantity = Math.max(1, Number(req.body?.quantity) || 1);

    if (!trackingKey) {
      return next(new ValidationError("Tracking key is required"));
    }

    const productId = Array.isArray(req.params.productId)
      ? req.params.productId[0]
      : req.params.productId;
    const shopId = await getTrackingShopId(productId, req.body?.shopId);
    const trackingEvent = createTrackingEvent(
      productId,
      shopId,
      action === "remove"
        ? "remove_from_cart"
        : action === "set"
          ? "update_cart"
          : "add_to_cart"
    );

    const addOrSetCartItemUpdate = [
      {
        $set: {
          trackingCartItems: {
            $let: {
              vars: {
                cartItems: { $ifNull: ["$trackingCartItems", []] },
              },
              in: {
                $cond: [
                  {
                    $in: [
                      trackingKey,
                      {
                        $map: {
                          input: "$$cartItems",
                          as: "item",
                          in: "$$item.key",
                        },
                      },
                    ],
                  },
                  {
                    $map: {
                      input: "$$cartItems",
                      as: "item",
                      in: {
                        $cond: [
                          { $eq: ["$$item.key", trackingKey] },
                          {
                            key: "$$item.key",
                            quantity:
                              action === "set"
                                ? quantity
                                : {
                                    $add: [
                                      { $ifNull: ["$$item.quantity", 0] },
                                      quantity,
                                    ],
                                  },
                          },
                          "$$item",
                        ],
                      },
                    },
                  },
                  {
                    $concatArrays: [
                      "$$cartItems",
                      [{ key: trackingKey, quantity }],
                    ],
                  },
                ],
              },
            },
          },
          trackingEvents: {
            $concatArrays: [
              { $ifNull: ["$trackingEvents", []] },
              [trackingEvent],
            ],
          },
          trackingUpdatedAt: "$$NOW",
        },
      },
    ];

    const removeCartItemUpdate = [
      {
        $set: {
          trackingCartItems: {
            $filter: {
              input: { $ifNull: ["$trackingCartItems", []] },
              as: "item",
              cond: { $ne: ["$$item.key", trackingKey] },
            },
          },
          trackingEvents: {
            $concatArrays: [
              { $ifNull: ["$trackingEvents", []] },
              [trackingEvent],
            ],
          },
          trackingUpdatedAt: "$$NOW",
        },
      },
    ];

    await prisma.$runCommandRaw({
      update: "products",
      updates: [
        {
          q: getProductObjectIdQuery(productId),
          u: action === "remove" ? removeCartItemUpdate : addOrSetCartItemUpdate,
          upsert: false,
        },
      ],
    });

    const counts = await getTrackingCounts(productId);

    res.status(200).json({
      success: true,
      productId,
      ...counts,
    });
  } catch (error) {
    next(error);
  }
};
