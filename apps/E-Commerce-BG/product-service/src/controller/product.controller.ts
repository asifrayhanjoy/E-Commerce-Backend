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

const createTrackingEvent = ( productId: string, shopId: string, action: string ) => ({
  productId,
  shopId,
  action,
  timestamp: new Date().toISOString(),
});

const normalizeProductReview = (review: any) => {
  const rawId = review?.id || review?._id;
  const id =
    typeof rawId === "object" && rawId?.$oid
      ? rawId.$oid
      : typeof rawId === "string"
        ? rawId
        : "";
  const comment =
    typeof review?.comment === "string"
      ? review.comment
      : typeof review?.review === "string"
        ? review.review
        : typeof review?.reviews === "string"
          ? review.reviews
          : "";
  const user = review?.user
    ? {
        id: review.user.id || review.user._id || "",
        name: review.user.name || review.userName || review.name || "Customer",
      }
    : {
        id: review?.userId || "",
        name: review?.userName || review?.name || "Customer",
      };

  return {
    id,
    rating: Number(review?.rating) || 0,
    comment,
    createdAt: review?.createdAt || null,
    user,
  };
};

const getRawProductReviews = async (productId: string) => {
  const result: any = await prisma.$runCommandRaw({
    aggregate: "products",
    pipeline: [
      { $match: getProductObjectIdQuery(productId) },
      {
        $project: {
          _id: 0,
          reviews: { $ifNull: ["$reviews", []] },
          productReviews: { $ifNull: ["$productReviews", []] },
        },
      },
    ],
    cursor: {},
  });
  const rawProduct = result?.cursor?.firstBatch?.[0] || {};

  if (Array.isArray(rawProduct.reviews) && rawProduct.reviews.length > 0) {
    return rawProduct.reviews.map(normalizeProductReview);
  }

  if (
    Array.isArray(rawProduct.productReviews) &&
    rawProduct.productReviews.length > 0
  ) {
    return rawProduct.productReviews.map(normalizeProductReview);
  }

  return [];
};

const getFirstQueryValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return getFirstQueryValue(value[0]);
  }

  return typeof value === "string" ? value.trim() : "";
};

const getQueryValues = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap(getQueryValues);
  }

  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const uniqueQueryValues = (...values: unknown[]) => [
  ...new Set(values.flatMap(getQueryValues)),
];

const getQueryNumber = (value: unknown) => {
  const rawValue = getFirstQueryValue(value);
  const parsedValue = Number(rawValue);

  return rawValue && Number.isFinite(parsedValue) ? parsedValue : undefined;
};

const getOptionalDate = (value: unknown) => {
  if (!value || typeof value !== "string") {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeSlugValue = (value: unknown) => {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const getUniqueProductSlug = async (requestedSlug: unknown, title: unknown) => {
  const baseSlug =
    normalizeSlugValue(requestedSlug) ||
    normalizeSlugValue(title) ||
    `product-${Date.now()}`;

  const existingProduct = await prisma.products.findUnique({
    where: {
      slug: baseSlug,
    },
    select: {
      id: true,
    },
  });

  if (!existingProduct) {
    return baseSlug;
  }

  for (let index = 2; index <= 50; index += 1) {
    const slug = `${baseSlug}-${index}`;
    const existingProductWithSuffix = await prisma.products.findUnique({
      where: {
        slug,
      },
      select: {
        id: true,
      },
    });

    if (!existingProductWithSuffix) {
      return slug;
    }
  }

  return `${baseSlug}-${Date.now()}`;
};

const getPriceRangeValues = (value: unknown): number[] => {
  if (Array.isArray(value)) {
    return value.flatMap(getPriceRangeValues);
  }

  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(/,|-/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
};

const publicProductFilters = (): Prisma.productsWhereInput[] => [
  {
    OR: [
      { isDeleted: false },
      { isDeleted: null },
      { isDeleted: { isSet: false } },
    ],
  },
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
];

const getFilteredProductOrderBy = (
  value: unknown
): Prisma.productsOrderByWithRelationInput => {
  switch (getFirstQueryValue(value)) {
    case "oldest":
      return { createdAt: "asc" };
    case "price_asc":
    case "price-low-to-high":
    case "low-to-high":
      return { sale_price: "asc" };
    case "price_desc":
    case "price-high-to-low":
    case "high-to-low":
      return { sale_price: "desc" };
    case "rating":
    case "top-rated":
      return { ratings: "desc" };
    case "latest":
    default:
      return { createdAt: "desc" };
  }
};

const publicProductShopInclude = {
  avatar: true,
  sellers: true,
} satisfies Prisma.shopsInclude;

const publicProductInclude = {
  images: true,
  Shop: {
    include: publicProductShopInclude,
  },
} satisfies Prisma.productsInclude;

const publicHomeProductInclude = {
  images: true,
} satisfies Prisma.productsInclude;

const getImageUrl = (value: unknown): string => {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const image of value) {
      const url = getImageUrl(image);

      if (url) {
        return url;
      }
    }
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return getImageUrl(
      record.url ??
        record.secure_url ??
        record.secureUrl ??
        record.src ??
        record.image ??
        record.imageUrl ??
        record.avatar ??
        record.avatarUrl ??
        record.profilePhoto ??
        record.profilePhotoUrl ??
        record.profileImage ??
        record.profileImageUrl ??
        record.coverPhoto ??
        record.coverPhotoUrl ??
        record.coverBanner ??
        record.coverBannerUrl
    );
  }

  return "";
};

const withPublicShopImages = (shop: any) => {
  if (!shop) {
    return shop;
  }

  const storefront =
    shop.storefront && typeof shop.storefront === "object"
      ? shop.storefront
      : {};
  const avatarUrl =
    getImageUrl(shop.avatar) ||
    getImageUrl(shop.avatarUrl) ||
    getImageUrl(shop.profilePhoto) ||
    getImageUrl(shop.profilePhotoUrl) ||
    getImageUrl(storefront.avatarImage) ||
    getImageUrl(shop.sellers?.avatar);
  const coverBannerUrl =
    getImageUrl(shop.coverBanner) ||
    getImageUrl(shop.coverBannerUrl) ||
    getImageUrl(shop.coverPhoto) ||
    getImageUrl(shop.coverPhotoUrl) ||
    getImageUrl(storefront.coverImage) ||
    getImageUrl(storefront.cover?.images);

  return {
    ...shop,
    avatarUrl,
    profilePhoto: avatarUrl,
    profilePhotoUrl: avatarUrl,
    coverBannerUrl,
    coverPhoto: coverBannerUrl,
    coverPhotoUrl: coverBannerUrl,
  };
};

const withPublicProductShopImages = (product: any) => ({
  ...product,
  Shop: product?.Shop ? withPublicShopImages(product.Shop) : product?.Shop,
  shop: product?.shop ? withPublicShopImages(product.shop) : product?.shop,
});

const formatPublicEventDate = (value: unknown) => {
  if (!value) {
    return "";
  }

  const date = new Date(value as string | Date);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
};

const formatPublicEventCurrency = (value: unknown) => {
  const amount = Number(value || 0);

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
};

const withPublicEventFields = (product: any) => {
  const normalizedProduct = withPublicProductShopImages(product);
  const shop = normalizedProduct.Shop || normalizedProduct.shop;
  const image = getImageUrl(normalizedProduct.images) || normalizedProduct.image || "";

  return {
    ...normalizedProduct,
    image,
    price: formatPublicEventCurrency(
      normalizedProduct.sale_price ?? normalizedProduct.price
    ),
    start: formatPublicEventDate(normalizedProduct.starting_date),
    end: formatPublicEventDate(normalizedProduct.ending_date),
    shopName: shop?.name || "Unknown",
    isEvent: true,
  };
};

const isEventProduct = (product: any) =>
  Boolean(product?.starting_date || product?.ending_date);

const getHomeProductLimit = (value: unknown) =>
  Math.min(Math.max(1, getQueryNumber(value) || 10), 20);

const getDiscountPercent = (product: {
  regular_price?: number | null;
  sale_price?: number | null;
}) => {
  const regularPrice = Number(product.regular_price || 0);
  const salePrice = Number(product.sale_price || 0);

  if (!regularPrice || !salePrice || regularPrice <= salePrice) {
    return 0;
  }

  return ((regularPrice - salePrice) / regularPrice) * 100;
};

const getTopOffers = async (
  where: Prisma.productsWhereInput,
  limit: number
) => {
  const candidates = await prisma.products.findMany({
    take: Math.max(limit * 4, 40),
    where: {
      AND: [
        where,
        {
          sale_price: {
            gt: 0,
          },
        },
        {
          regular_price: {
            gt: 0,
          },
        },
      ],
    },
    include: publicHomeProductInclude,
    orderBy: [
      {
        ratings: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
  });

  return candidates
    .filter((product) => getDiscountPercent(product) > 0)
    .sort((first, second) => {
      const discountDifference =
        getDiscountPercent(second) - getDiscountPercent(first);

      if (discountDifference !== 0) {
        return discountDifference;
      }

      const ratingDifference =
        Number(second.ratings || 0) - Number(first.ratings || 0);

      if (ratingDifference !== 0) {
        return ratingDifference;
      }

      return (
        new Date(second.createdAt).getTime() -
        new Date(first.createdAt).getTime()
      );
    })
    .slice(0, limit);
};

const getTopHomeShops = async (limit: number) => {
  const shops = await prisma.shops.findMany({
    take: limit,
    include: {
      avatar: true,
      sellers: true,
      products: {
        where: {
          AND: publicProductFilters(),
        },
        include: {
          images: true,
        },
      },
      _count: {
        select: {
          products: true,
          reviews: true,
        },
      },
    },
    orderBy: [
      {
        ratings: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
  });

  return Promise.all(
    shops.map(async (shop) =>
      withPublicShopImages({
        ...shop,
        followersCount: await prisma.users.count({
          where: {
            following: {
              has: shop.id,
            },
          },
        }),
      })
    )
  );
};

const getSafeHomeSection = async <T>(
  section: string,
  loader: () => Promise<T>,
  fallback: T
) => {
  try {
    return await loader();
  } catch (error) {
    console.error(`Failed to load home ${section}:`, error);
    return fallback;
  }
};

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
      starting_date,
      ending_date,
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

    const uniqueSlug = await getUniqueProductSlug(slug, title);

    const startingDate = getOptionalDate(starting_date);
    const endingDate = getOptionalDate(ending_date);

    const newProduct = await prisma.products.create({
      data: {
        title,
        short_description,
        detailed_description,
        warranty,
        slug: uniqueSlug,
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
        starting_date: startingDate,
        ending_date: endingDate,
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

// create event controller
export const createEvent = async (req: any, res: Response, next: NextFunction) => {
  if (!req.body?.starting_date || !req.body?.ending_date) {
    return next(new ValidationError("Event start and end dates are required"));
  }

  return createProduct(req, res, next);
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
      orderBy: {
        createdAt: "desc",
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

// get logged in seller events
export const getShopEvents = async ( req: any, res: Response, next: NextFunction ) => {
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
      orderBy: {
        createdAt: "desc",
      },
    });
    const events = products.filter(
      (product) => isEventProduct(product) && !product.isDeleted
    );

    res.status(200).json({
      success: true,
      events,
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
        include: publicProductInclude,
        where: baseFilter,
        orderBy,
      }),

      prisma.products.count({
        where: baseFilter,
      }),

      prisma.products.findMany({
        take: 10,
        where: baseFilter,
        include: publicProductInclude,
        orderBy,
      }),
    ]);

    res.status(200).json({
      products: products.map(withPublicProductShopImages),
      top10By: type === "latest" ? "latest" : "topSales",
      top10Products: top10Products.map(withPublicProductShopImages),
      total,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    next(error);
  }
};

// get public events
export const getPublicEvents = async ( req: Request, res: Response, next: NextFunction ) => {
  try {
    const page = Math.max(1, getQueryNumber(req.query.page) || 1);
    const limit = Math.min(
      Math.max(1, getQueryNumber(req.query.limit) || 20),
      100
    );
    const skip = (page - 1) * limit;
    const search =
      getFirstQueryValue(req.query.search) ||
      getFirstQueryValue(req.query.searchQuery) ||
      getFirstQueryValue(req.query.q) ||
      getFirstQueryValue(req.query.title);
    const filters: Prisma.productsWhereInput[] = [
      {
        OR: [
          { isDeleted: false },
          { isDeleted: null },
          { isDeleted: { isSet: false } },
        ],
      },
    ];

    if (search) {
      filters.push({
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { short_description: { contains: search, mode: "insensitive" } },
          { detailed_description: { contains: search, mode: "insensitive" } },
          { tags: { contains: search, mode: "insensitive" } },
          { brand: { contains: search, mode: "insensitive" } },
          { category: { contains: search, mode: "insensitive" } },
          { subCategory: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    const where: Prisma.productsWhereInput = {
      AND: filters,
    };

    const products = await prisma.products.findMany({
      where,
      include: publicProductInclude,
      orderBy: {
        createdAt: "desc",
      },
    });
    const events = products.filter(isEventProduct);
    const total = events.length;
    const paginatedEvents = events.slice(skip, skip + limit);

    res.status(200).json({
      success: true,
      events: paginatedEvents.map(withPublicEventFields),
      total,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      pagination: {
        page,
        limit,
        total,
        totalEvents: total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

// get home products
export const getHomeProducts = async ( req: Request, res: Response, next: NextFunction ) => {
  try {
    const limit = getHomeProductLimit(req.query.limit);
    const where: Prisma.productsWhereInput = {
      AND: publicProductFilters(),
    };

    const [suggestedProducts, latestProducts, topShops, topOffers] =
      await Promise.all([
        getSafeHomeSection(
          "suggested products",
          () =>
            prisma.products.findMany({
              take: limit,
              where,
              include: publicHomeProductInclude,
              orderBy: [
                {
                  ratings: "desc",
                },
                {
                  createdAt: "desc",
                },
              ],
            }),
          []
        ),
        getSafeHomeSection(
          "latest products",
          () =>
            prisma.products.findMany({
              take: limit,
              where,
              include: publicHomeProductInclude,
              orderBy: {
                createdAt: "desc",
              },
            }),
          []
        ),
        getSafeHomeSection("top shops", () => getTopHomeShops(limit), []),
        getSafeHomeSection("top offers", () => getTopOffers(where, limit), []),
      ]);

    return res.status(200).json({
      success: true,
      suggestedProducts: suggestedProducts.map(withPublicProductShopImages),
      latestProducts: latestProducts.map(withPublicProductShopImages),
      topShops,
      topOffers: topOffers.map(withPublicProductShopImages),
    });
  } catch (error) {
    return next(error);
  }
};

// get filtered products
export const getFilteredProducts = async ( req: Request, res: Response, next: NextFunction ) => {
  try {
    const page = Math.max(1, getQueryNumber(req.query.page) || 1);
    const limit = Math.min(
      Math.max(1, getQueryNumber(req.query.limit) || 12),
      100
    );
    const skip = (page - 1) * limit;
    const categories = uniqueQueryValues(
      req.query.category,
      req.query.categories
    );
    const subCategories = uniqueQueryValues(
      req.query.subCategory,
      req.query.subcategory,
      req.query.subCategories,
      req.query.subcategories
    );
    const brands = uniqueQueryValues(req.query.brand, req.query.brands);
    const colors = uniqueQueryValues(req.query.color, req.query.colors);
    const sizes = uniqueQueryValues(req.query.size, req.query.sizes);
    const parsedPriceRange = getPriceRangeValues(req.query.priceRange);
    const priceRange = parsedPriceRange.length ? parsedPriceRange : [0, 10000];
    const minPrice =
      getQueryNumber(req.query.minPrice) ??
      priceRange[0];
    const maxPrice =
      getQueryNumber(req.query.maxPrice) ??
      priceRange[1];
    const minRating =
      getQueryNumber(req.query.minRating) ??
      getQueryNumber(req.query.rating);
    const cashOnDelivery = getFirstQueryValue(req.query.cashOnDelivery);
    const search =
      getFirstQueryValue(req.query.search) ||
      getFirstQueryValue(req.query.searchQuery) ||
      getFirstQueryValue(req.query.q) ||
      getFirstQueryValue(req.query.title);

    const filters: Prisma.productsWhereInput[] = publicProductFilters();

    if (categories.length) {
      filters.push({
        OR: categories.map((category) => ({
          category: { equals: category, mode: "insensitive" },
        })),
      });
    }

    if (subCategories.length) {
      filters.push({
        OR: subCategories.map((subCategory) => ({
          subCategory: { equals: subCategory, mode: "insensitive" },
        })),
      });
    }

    if (brands.length) {
      filters.push({
        OR: brands.map((brand) => ({
          brand: { equals: brand, mode: "insensitive" },
        })),
      });
    }

    if (colors.length) {
      filters.push({
        OR: colors.map((color) => ({
          colors: { contains: color, mode: "insensitive" },
        })),
      });
    }

    if (sizes.length) {
      filters.push({
        sizes: { hasSome: sizes },
      });
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      const priceFilter: Prisma.FloatFilter<"products"> = {};

      if (minPrice !== undefined) {
        priceFilter.gte = minPrice;
      }

      if (maxPrice !== undefined) {
        priceFilter.lte = maxPrice;
      }

      filters.push({
        sale_price: priceFilter,
      });
    }

    if (minRating !== undefined) {
      filters.push({
        ratings: { gte: minRating },
      });
    }

    if (cashOnDelivery) {
      filters.push({
        cashOnDelivery: { equals: cashOnDelivery, mode: "insensitive" },
      });
    }

    if (search) {
      filters.push({
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { short_description: { contains: search, mode: "insensitive" } },
          { detailed_description: { contains: search, mode: "insensitive" } },
          { tags: { contains: search, mode: "insensitive" } },
          { brand: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    const where: Prisma.productsWhereInput = {
      AND: filters,
    };

    const [products, total] = await Promise.all([
      prisma.products.findMany({
        skip,
        take: limit,
        where,
        include: {
          images: true,
          Shop: {
            include: publicProductShopInclude,
          },
        },
        orderBy: getFilteredProductOrderBy(
          req.query.sortBy || req.query.sort || req.query.type
        ),
      }),
      prisma.products.count({
        where,
      }),
    ]);

    res.status(200).json({
      success: true,
      products: products.map(withPublicProductShopImages),
      total,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      filters: {
        categories,
        subCategories,
        brands,
        colors,
        sizes,
        minPrice,
        maxPrice,
        minRating,
        cashOnDelivery,
        search,
      },
    });
  } catch (error) {
    next(error);
  }
};

// get filtered shops
export const getFilteredShops = async ( req: Request, res: Response, next: NextFunction ) => {
  try {
    const categories = uniqueQueryValues(
      req.query.category,
      req.query.categories
    );
    const countries = uniqueQueryValues(
      req.query.country,
      req.query.countries
    );
    const page = Math.max(1, getQueryNumber(req.query.page) || 1);
    const limit = Math.min(
      Math.max(1, getQueryNumber(req.query.limit) || 12),
      100
    );
    const skip = (page - 1) * limit;
    const filters: Prisma.shopsWhereInput[] = [];

    if (categories.length) {
      filters.push({
        OR: categories.map((category) => ({
          category: { equals: category, mode: "insensitive" },
        })),
      });
    }

    if (countries.length) {
      filters.push({
        sellers: {
          is: {
            OR: countries.map((country) => ({
              country: { equals: country, mode: "insensitive" },
            })),
          },
        },
      });
    }

    const where: Prisma.shopsWhereInput = filters.length
      ? { AND: filters }
      : {};

    const [shops, total] = await Promise.all([
      prisma.shops.findMany({
        skip,
        take: limit,
        where,
        include: {
          avatar: true,
          sellers: true,
          products: {
            where: {
              AND: publicProductFilters(),
            },
            include: {
              images: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      }),
      prisma.shops.count({
        where,
      }),
    ]);

    res.status(200).json({
      success: true,
      shops: shops.map(withPublicShopImages),
      total,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      filters: {
        categories,
        countries,
      },
    });
  } catch (error) {
    next(error);
  }
};

// search products
export const searchProducts = async ( req: Request, res: Response, next: NextFunction ) => {
  try {
    const query = getFirstQueryValue(req.query.q);

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ message: "Search query is required." });
    }

    const products = await prisma.products.findMany({
      where: {
        AND: [
          ...publicProductFilters(),
          {
            OR: [
              { title: { contains: query, mode: "insensitive" } },
              { short_description: { contains: query, mode: "insensitive" } },
              { detailed_description: { contains: query, mode: "insensitive" } },
              { category: { contains: query, mode: "insensitive" } },
              { subCategory: { contains: query, mode: "insensitive" } },
              { tags: { contains: query, mode: "insensitive" } },
              { brand: { contains: query, mode: "insensitive" } },
            ],
          },
        ],
      },
      include: {
        images: true,
        Shop: {
          include: publicProductShopInclude,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.status(200).json({
      success: true,
      products: products.map(withPublicProductShopImages),
    });
  } catch (error) {
    next(error);
  }
};

export const getProductDetails = async ( req: Request, res: Response, next: NextFunction ) => {
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
        Shop: {
          include: {
            avatar: true,
            sellers: true,
            reviews: {
              orderBy: {
                createdAt: "desc",
              },
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!product) {
      return next(new NotFoundError("Product not found"));
    }

    const rawProductReviews = await getRawProductReviews(product.id);
    const shopReviews = product.Shop?.reviews?.map(normalizeProductReview) || [];
    const reviews = rawProductReviews.length > 0 ? rawProductReviews : shopReviews;

    return res.status(200).json({
      success: true,
      product: {
        ...withPublicProductShopImages(product),
        reviews,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getProductTracking = async ( req: Request, res: Response, next: NextFunction ) => {
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


export const trackProductView = async ( req: Request, res: Response, next: NextFunction ) => {
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

// trackProductWishlist
export const trackProductWishlist = async ( req: Request, res: Response, next: NextFunction ) => {
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

// trackProductCart
export const trackProductCart = async ( req: Request, res: Response, next: NextFunction ) => {
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

// top shops
export const topShops = async ( req: Request, res: Response, next: NextFunction ) => {
  try {
    const shops = await prisma.shops.findMany({
      take: 10,
      orderBy: [
        {
          ratings: "desc",
        },
        {
          createdAt: "desc",
        },
      ],
      select: {
        id: true,
        name: true,
        avatar: true,
        coverBanner: true,
        storefront: true,
        address: true,
        ratings: true,
        category: true,
        sellers: true,
        _count: {
          select: {
            products: true,
            reviews: true,
          },
        },
      },
    });

    return res.status(200).json({ shops: shops.map(withPublicShopImages) });
  } catch (error) {
    console.error("Error fetching top shops:", error);
    return next(error);
  }
};
