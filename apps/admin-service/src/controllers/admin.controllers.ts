import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import path from "path";
import { PrismaClient } from "@prisma/client";

type AdminLoginBody = {
  email?: string;
  password?: string;
};

type AdminRegisterBody = {
  name?: string;
  email?: string;
  password?: string;
};

type AdminAccount = {
  id: string;
  name?: string | null;
  email: string;
  password?: string | null;
};

type RawAdminRecord = {
  id?: string;
  _id?: string | { $oid?: string; toString?: () => string };
  name?: string | null;
  email?: string;
  password?: string | null;
  lastLoginAt?: Date | string | null;
};

type RawOrderRecord = {
  id?: string;
  _id?: string | { $oid?: string; toString?: () => string };
  userId?: string;
  shopId?: string;
  shippingAddressId?: string | null;
  paymentIntentId?: string | null;
  paymentSessionId?: string | null;
  user?: { name?: string | null; email?: string | null } | null;
  shop?: { name?: string | null } | null;
  shippingAddress?: {
    label?: string | null;
    name?: string | null;
    street?: string | null;
    city?: string | null;
    zip?: string | null;
    country?: string | null;
  } | null;
  cart?: unknown;
  totalAmount?: number;
  paymentStatus?: string;
  deliveryStatus?: string;
  createdAt?: Date | string;
};

type AdminOrderItem = {
  id?: string;
  title?: string;
  name?: string;
  quantity?: number;
  sale_price?: number;
  price?: number;
  regular_price?: number;
  image?: string;
  thumbnail?: string;
  size?: string;
  selectedSize?: string;
  selectedOptions?: Record<string, unknown>;
  images?: Array<{ url?: string } | string>;
  product?: {
    title?: string;
    name?: string;
    image?: string;
    images?: Array<{ url?: string } | string>;
  };
};

type RawProductRecord = {
  id?: string;
  _id?: string | { $oid?: string; toString?: () => string };
  title?: string;
  slug?: string;
  category?: string;
  subCategory?: string;
  short_description?: string;
  detailed_description?: string;
  images?: Array<{ url?: string } | string>;
  image?: string;
  video_url?: string | null;
  tags?: string | null;
  brand?: string | null;
  colors?: string | null;
  sizes?: string[];
  starting_date?: Date | string | null;
  ending_date?: Date | string | null;
  stock?: number;
  sale_price?: number;
  regular_price?: number;
  ratings?: number;
  warranty?: string | null;
  custom_specifications?: Record<string, unknown> | null;
  custom_properties?: Record<string, unknown> | null;
  status?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  shop?: { name?: string | null } | null;
  Shop?: { name?: string | null } | null;
};

type RawUserRecord = {
  id?: string;
  _id?: string | { $oid?: string; toString?: () => string };
  name?: string | null;
  email?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  avatar?: Array<{ url?: string } | string>;
  ordersCount?: number;
};

type RawSellerRecord = {
  id?: string;
  _id?: string | { $oid?: string; toString?: () => string };
  name?: string | null;
  email?: string | null;
  phone_number?: string | null;
  country?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  shop?: {
    id?: string;
    _id?: string | { $oid?: string; toString?: () => string };
    name?: string | null;
    bio?: string | null;
    address?: string | null;
    category?: string | null;
    ratings?: number | null;
    avatar?: Array<{ url?: string } | string>;
    createdAt?: Date | string;
    updatedAt?: Date | string;
  } | null;
  avatar?: Array<{ url?: string } | string>;
};

[
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "apps/admin-service/.env"),
  path.resolve(process.cwd(), "apps/E-Commerce-BG/.env"),
  path.resolve(__dirname, "../../../../.env"),
  path.resolve(__dirname, "../../../E-Commerce-BG/.env"),
  path.resolve(__dirname, "../../.env"),
].forEach((envPath) => {
  dotenv.config({ path: envPath });
});

const prisma = new PrismaClient();
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DEFAULT_ADMIN_CREDENTIALS = [
  {
    name: process.env.ADMIN_NAME || "Admin",
    email: process.env.ADMIN_EMAIL || "g22nqqniae@bltiwd.com",
    password: process.env.ADMIN_PASSWORD || "11223344",
  },
  {
    name: "Admin",
    email: "support@becodemy.com",
    password: "admin123",
  },
];

const ACCESS_TOKEN_SECRET =
  process.env.ADMIN_ACCESS_TOKEN_SECRET ||
  process.env.ACCESS_TOKEN_SECRET ||
  process.env.ADMIN_JWT_SECRET ||
  process.env.JWT_SECRET ||
  "admin-service-secret";

const REFRESH_TOKEN_SECRET =
  process.env.ADMIN_REFRESH_TOKEN_SECRET ||
  process.env.REFRESH_TOKEN_SECRET ||
  ACCESS_TOKEN_SECRET;

const getAdminModel = () => (prisma as any).admins;
const getPrismaModel = (modelName: string) => (prisma as any)[modelName];

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const getDefaultAdminCredential = (email: string, password: string) =>
  DEFAULT_ADMIN_CREDENTIALS.find(
    (credential) =>
      credential.email === email && credential.password === password
  );

const sendError = (res: Response, status: number, message: string) =>
  res.status(status).json({
    status: "error",
    message,
  });

const runRawCommand = async <T = any>(command: Record<string, unknown>) => {
  if (typeof (prisma as any).$runCommandRaw !== "function") {
    return null;
  }

  try {
    return ((await (prisma as any).$runCommandRaw(command)) || null) as T | null;
  } catch (error) {
    console.error("Admin dashboard database command failed:", command, error);
    return null;
  }
};

const safeDashboardValue = async <T>(callback: () => Promise<T>, fallback: T) => {
  try {
    return await callback();
  } catch (error) {
    console.error("Admin dashboard query failed:", error);
    return fallback;
  }
};

const getCollectionCount = async (collection: string) => {
  const model = getPrismaModel(collection);

  if (model?.count) {
    try {
      return Number(await model.count());
    } catch (error) {
      console.error(`Admin dashboard ${collection} count failed:`, error);
    }
  }

  const result = await runRawCommand<{ n?: number }>({
    count: collection,
  });

  return Number(result?.n || 0);
};

const getOrderId = (order: RawOrderRecord, index: number) => {
  if (typeof order._id === "string") {
    return order._id.slice(-6).toUpperCase();
  }

  if (order._id?.$oid) {
    return order._id.$oid.slice(-6).toUpperCase();
  }

  return String(index + 1).padStart(3, "0");
};

const getRawOrderId = (order: RawOrderRecord) => {
  if (order.id) {
    return order.id;
  }

  if (typeof order._id === "string") {
    return order._id;
  }

  if (order._id?.$oid) {
    return order._id.$oid;
  }

  return order._id?.toString?.() || "";
};

const getAdminOrderDisplayId = (order: RawOrderRecord) =>
  `#${getRawOrderId(order).slice(-6).toUpperCase()}`;

const getAdminOrderTitleId = (order: RawOrderRecord) =>
  `#${getRawOrderId(order).slice(-6).toLowerCase()}`;

const formatAdminDate = (value?: Date | string) => {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }

  return [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    date.getFullYear(),
  ].join("/");
};

const getAdminOrderTotal = (order: RawOrderRecord) =>
  Number.isFinite(Number(order.totalAmount)) ? Number(order.totalAmount) : 0;

const getAdminOrderSearchText = (order: {
  orderId: string;
  shop: string;
  buyer: string;
  total: string;
  status: string;
  date: string;
}) =>
  [
    order.orderId,
    order.shop,
    order.buyer,
    order.total,
    order.status,
    order.date,
  ]
    .join(" ")
    .toLowerCase();

const getCartItems = (cart: unknown): AdminOrderItem[] => {
  if (Array.isArray(cart)) {
    return cart as AdminOrderItem[];
  }

  if (typeof cart === "string") {
    try {
      const parsedCart = JSON.parse(cart);
      return Array.isArray(parsedCart) ? parsedCart : [];
    } catch {
      return [];
    }
  }

  return [];
};

const getItemImage = (item: AdminOrderItem) => {
  const firstImage = item.images?.[0] || item.product?.images?.[0];

  if (typeof firstImage === "string") {
    return firstImage;
  }

  return (
    item.image ||
    item.thumbnail ||
    item.product?.image ||
    firstImage?.url ||
    ""
  );
};

const getItemSize = (item: AdminOrderItem) => {
  const selectedSize =
    item.selectedOptions?.size ||
    item.selectedOptions?.Size ||
    item.selectedOptions?.variant ||
    item.selectedOptions?.Variant;

  return String(item.size || item.selectedSize || selectedSize || "");
};

const mapAdminOrderListItem = (order: RawOrderRecord) => ({
  id: getRawOrderId(order),
  orderId: getAdminOrderDisplayId(order),
  shop: order.shop?.name || "Unknown shop",
  buyer: order.user?.name || order.user?.email || "Unknown buyer",
  total: `$${getAdminOrderTotal(order).toFixed(2)}`,
  status: order.paymentStatus || "Pending",
  date: formatAdminDate(order.createdAt),
});

const getOrderWithAddress = async (order: RawOrderRecord) => {
  if (!order.shippingAddressId || order.shippingAddress) {
    return order;
  }

  try {
    const address = await getPrismaModel("user_addresses")?.findFirst?.({
      where: {
        id: order.shippingAddressId,
      },
    });

    return {
      ...order,
      shippingAddress: address || null,
    };
  } catch {
    return order;
  }
};

const mapAdminOrderDetail = (order: RawOrderRecord) => {
  const address = order.shippingAddress;
  const items = getCartItems(order.cart).map((item, index) => {
    const price = Number(item.sale_price || item.price || item.regular_price || 0);
    const quantity = Number(item.quantity || 1);

    return {
      id: item.id || `${getRawOrderId(order)}-${index}`,
      title: item.title || item.name || item.product?.title || item.product?.name || "Order item",
      quantity,
      size: getItemSize(item),
      price: `$${(price * quantity).toFixed(2)}`,
      image: getItemImage(item),
    };
  });

  return {
    id: getRawOrderId(order),
    orderId: getAdminOrderTitleId(order),
    paymentStatus: order.paymentStatus || "Pending",
    deliveryStatus: order.deliveryStatus || "Ordered",
    totalPaid: `$${getAdminOrderTotal(order).toFixed(2)}`,
    date: formatAdminDate(order.createdAt),
    shippingAddress: {
      name: address?.name || address?.label || "",
      street: address?.street || "",
      cityLine: [address?.city, address?.zip].filter(Boolean).join(", "),
      country: address?.country || "",
    },
    items,
  };
};

const getAdminOrdersFromDatabase = async () => {
  try {
    const ordersModel = getPrismaModel("orders");

    if (ordersModel?.findMany) {
      return ((await ordersModel.findMany({
        orderBy: {
          createdAt: "desc",
        },
        take: 1000,
        include: {
          user: true,
          shop: true,
        },
      })) || []) as RawOrderRecord[];
    }
  } catch (error) {
    console.error("Admin orders Prisma query failed:", error);
  }

  const result = await runRawCommand<{
    cursor?: { firstBatch?: RawOrderRecord[] };
  }>({
    aggregate: "orders",
    pipeline: [
      { $sort: { createdAt: -1 } },
      { $limit: 100 },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      {
        $unwind: {
          path: "$user",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "shops",
          localField: "shopId",
          foreignField: "_id",
          as: "shop",
        },
      },
      {
        $unwind: {
          path: "$shop",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "user_addresses",
          localField: "shippingAddressId",
          foreignField: "_id",
          as: "shippingAddress",
        },
      },
      {
        $unwind: {
          path: "$shippingAddress",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 1,
          cart: 1,
          totalAmount: 1,
          paymentStatus: 1,
          deliveryStatus: 1,
          createdAt: 1,
          paymentIntentId: 1,
          paymentSessionId: 1,
          "user.name": 1,
          "user.email": 1,
          "shop.name": 1,
          "shippingAddress.label": 1,
          "shippingAddress.name": 1,
          "shippingAddress.street": 1,
          "shippingAddress.city": 1,
          "shippingAddress.zip": 1,
          "shippingAddress.country": 1,
        },
      },
    ],
    cursor: {},
  });

  return result?.cursor?.firstBatch || [];
};

const findAdminOrder = async (orderId: string) => {
  const normalizedOrderId = orderId.replace(/^#/, "").toLowerCase();
  const orders = await getAdminOrdersFromDatabase();

  return (
    orders.find((order) => {
      const rawOrderId = getRawOrderId(order).toLowerCase();

      return (
        rawOrderId === normalizedOrderId ||
        rawOrderId.endsWith(normalizedOrderId) ||
        order.paymentIntentId?.toLowerCase() === normalizedOrderId ||
        order.paymentSessionId?.toLowerCase() === normalizedOrderId
      );
    }) || null
  );
};

const getRawProductId = (product: RawProductRecord) => {
  if (product.id) {
    return product.id;
  }

  if (typeof product._id === "string") {
    return product._id;
  }

  if (product._id?.$oid) {
    return product._id.$oid;
  }

  return product._id?.toString?.() || product.slug || "";
};

const getProductImage = (product: RawProductRecord) => {
  const firstImage = product.images?.[0];

  if (typeof firstImage === "string") {
    return firstImage;
  }

  return product.image || firstImage?.url || "";
};

const formatProductPrice = (value?: number) => {
  const price = Number(value || 0);

  return Number.isFinite(price) ? `$${price.toFixed(0)}` : "$0";
};

const formatProductStock = (value?: number) => {
  const stock = Number(value || 0);

  return `${Number.isFinite(stock) ? stock : 0} left`;
};

const mapAdminProductListItem = (product: RawProductRecord) => ({
  id: getRawProductId(product),
  image: getProductImage(product),
  title: product.title || "Untitled product",
  price: formatProductPrice(product.sale_price),
  stock: formatProductStock(product.stock),
  category: product.category || "Uncategorized",
  rating: Number(product.ratings || 0),
  shop: product.shop?.name || "Unknown shop",
  created: formatAdminDate(product.createdAt),
});

const mapAdminProductDetail = (product: RawProductRecord) => ({
  id: getRawProductId(product),
  image: getProductImage(product),
  title: product.title || "Untitled product",
  slug: product.slug || "",
  price: formatProductPrice(product.sale_price),
  regularPrice: formatProductPrice(product.regular_price),
  stock: formatProductStock(product.stock),
  stockCount: Number(product.stock || 0),
  category: product.category || "Uncategorized",
  subCategory: product.subCategory || "",
  rating: Number(product.ratings || 0),
  shop: product.shop?.name || "Unknown shop",
  status: product.status || "Active",
  brand: product.brand || "",
  tags: product.tags || "",
  colors: product.colors || "",
  sizes: product.sizes || [],
  warranty: product.warranty || "",
  videoUrl: product.video_url || "",
  shortDescription: product.short_description || "",
  detailedDescription: product.detailed_description || "",
  customSpecifications: product.custom_specifications || {},
  customProperties: product.custom_properties || {},
  created: formatAdminDate(product.createdAt),
});

const getAdminProductSearchText = (product: ReturnType<typeof mapAdminProductListItem>) =>
  [
    product.title,
    product.price,
    product.stock,
    product.category,
    product.rating,
    product.shop,
    product.created,
  ]
    .join(" ")
    .toLowerCase();

const mapAdminEventListItem = (product: RawProductRecord) => ({
  id: getRawProductId(product),
  image: getProductImage(product),
  title: product.title || "Untitled event",
  price: formatProductPrice(product.sale_price),
  stock: Number(product.stock || 0),
  start: formatAdminDate(product.starting_date || product.createdAt),
  end: formatAdminDate(product.ending_date ?? undefined),
  shopName: product.shop?.name || "Unknown shop",
});

const getAdminEventSearchText = (event: ReturnType<typeof mapAdminEventListItem>) =>
  [
    event.title,
    event.price,
    event.stock,
    event.start,
    event.end,
    event.shopName,
  ]
    .join(" ")
    .toLowerCase();

const getAdminProductsFromDatabase = async () => {
  try {
    const productsModel = getPrismaModel("products");

    if (productsModel?.findMany) {
      const products = await productsModel.findMany({
        where: {
          OR: [
            { isDeleted: false },
            { isDeleted: null },
            { isDeleted: { isSet: false } },
          ],
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 1000,
        include: {
          images: true,
          Shop: true,
        },
      });

      return ((products || []).map((product: RawProductRecord) => ({
        ...product,
        shop: product.shop || product.Shop || null,
      }))) as RawProductRecord[];
    }
  } catch (error) {
    console.error("Admin products Prisma query failed:", error);
  }

  const result = await runRawCommand<{
    cursor?: { firstBatch?: RawProductRecord[] };
  }>({
    aggregate: "products",
    pipeline: [
      {
        $match: {
          isDeleted: { $ne: true },
        },
      },
      { $sort: { createdAt: -1 } },
      { $limit: 1000 },
      {
        $lookup: {
          from: "shops",
          localField: "shopId",
          foreignField: "_id",
          as: "shop",
        },
      },
      {
        $unwind: {
          path: "$shop",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "images",
          localField: "_id",
          foreignField: "productId",
          as: "images",
        },
      },
      {
        $project: {
          _id: 1,
          title: 1,
          slug: 1,
          category: 1,
          subCategory: 1,
          short_description: 1,
          detailed_description: 1,
          video_url: 1,
          tags: 1,
          brand: 1,
          colors: 1,
          sizes: 1,
          starting_date: 1,
          ending_date: 1,
          stock: 1,
          sale_price: 1,
          regular_price: 1,
          ratings: 1,
          warranty: 1,
          custom_specifications: 1,
          custom_properties: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          "shop.name": 1,
          "images.url": 1,
        },
      },
    ],
    cursor: {},
  });

  return result?.cursor?.firstBatch || [];
};

const findAdminProduct = async (productId: string) => {
  const normalizedProductId = productId.replace(/^#/, "").toLowerCase();
  const products = await getAdminProductsFromDatabase();

  return (
    products.find((product) => {
      const rawProductId = getRawProductId(product).toLowerCase();

      return (
        rawProductId === normalizedProductId ||
        rawProductId.endsWith(normalizedProductId) ||
        product.slug?.toLowerCase() === normalizedProductId
      );
    }) || null
  );
};

const getRawUserId = (user: RawUserRecord) => {
  if (user.id) {
    return user.id;
  }

  if (typeof user._id === "string") {
    return user._id;
  }

  if (user._id?.$oid) {
    return user._id.$oid;
  }

  return user._id?.toString?.() || user.email || "";
};

const getUserAvatar = (user: RawUserRecord) => {
  const firstAvatar = user.avatar?.[0];

  if (typeof firstAvatar === "string") {
    return firstAvatar;
  }

  return firstAvatar?.url || "";
};

const mapAdminUserListItem = (user: RawUserRecord) => ({
  id: getRawUserId(user),
  image: getUserAvatar(user),
  name: user.name || "Unknown user",
  email: user.email || "",
  orders: Number(user.ordersCount || 0),
  joined: formatAdminDate(user.createdAt),
});

const mapAdminUserDetail = (user: RawUserRecord) => ({
  id: getRawUserId(user),
  image: getUserAvatar(user),
  name: user.name || "Unknown user",
  email: user.email || "",
  orders: Number(user.ordersCount || 0),
  joined: formatAdminDate(user.createdAt),
  updated: formatAdminDate(user.updatedAt),
});

const getAdminUserSearchText = (user: ReturnType<typeof mapAdminUserListItem>) =>
  [user.name, user.email, user.orders, user.joined].join(" ").toLowerCase();

const getAdminUsersFromDatabase = async () => {
  try {
    const usersModel = getPrismaModel("users");

    if (usersModel?.findMany) {
      const users = await usersModel.findMany({
        orderBy: {
          createdAt: "desc",
        },
        take: 1000,
        include: {
          avatar: true,
          orders: true,
        },
      });

      return ((users || []).map((user: RawUserRecord & { orders?: unknown[] }) => ({
        ...user,
        ordersCount: Array.isArray(user.orders) ? user.orders.length : 0,
      }))) as RawUserRecord[];
    }
  } catch (error) {
    console.error("Admin users Prisma query failed:", error);
  }

  const result = await runRawCommand<{
    cursor?: { firstBatch?: RawUserRecord[] };
  }>({
    aggregate: "users",
    pipeline: [
      { $sort: { createdAt: -1 } },
      { $limit: 1000 },
      {
        $lookup: {
          from: "images",
          localField: "_id",
          foreignField: "userId",
          as: "avatar",
        },
      },
      {
        $lookup: {
          from: "orders",
          localField: "_id",
          foreignField: "userId",
          as: "orders",
        },
      },
      {
        $addFields: {
          ordersCount: { $size: "$orders" },
        },
      },
      {
        $project: {
          _id: 1,
          name: 1,
          email: 1,
          createdAt: 1,
          updatedAt: 1,
          ordersCount: 1,
          "avatar.url": 1,
        },
      },
    ],
    cursor: {},
  });

  return result?.cursor?.firstBatch || [];
};

const findAdminUser = async (userId: string) => {
  const normalizedUserId = userId.replace(/^#/, "").toLowerCase();
  const users = await getAdminUsersFromDatabase();

  return (
    users.find((user) => {
      const rawUserId = getRawUserId(user).toLowerCase();

      return (
        rawUserId === normalizedUserId ||
        rawUserId.endsWith(normalizedUserId) ||
        user.email?.toLowerCase() === normalizedUserId
      );
    }) || null
  );
};

const getRawSellerId = (seller: RawSellerRecord) => {
  if (seller.id) {
    return seller.id;
  }

  if (typeof seller._id === "string") {
    return seller._id;
  }

  if (seller._id?.$oid) {
    return seller._id.$oid;
  }

  return seller._id?.toString?.() || seller.email || "";
};

const getRawSellerShopId = (seller: RawSellerRecord) => {
  if (seller.shop?.id) {
    return seller.shop.id;
  }

  if (typeof seller.shop?._id === "string") {
    return seller.shop._id;
  }

  if (seller.shop?._id?.$oid) {
    return seller.shop._id.$oid;
  }

  return seller.shop?._id?.toString?.() || "";
};

const getSellerAvatar = (seller: RawSellerRecord) => {
  const firstAvatar = seller.avatar?.[0] || seller.shop?.avatar?.[0];

  if (typeof firstAvatar === "string") {
    return firstAvatar;
  }

  return firstAvatar?.url || "";
};

const mapAdminSellerListItem = (seller: RawSellerRecord) => ({
  id: getRawSellerId(seller),
  shopId: getRawSellerShopId(seller),
  avatar: getSellerAvatar(seller),
  name: seller.name || "Unknown seller",
  email: seller.email || "",
  shopName: seller.shop?.name || "No shop",
  address: seller.shop?.address || seller.country || "",
  joined: formatAdminDate(seller.createdAt),
});

const mapAdminSellerDetail = (seller: RawSellerRecord) => ({
  ...mapAdminSellerListItem(seller),
  phone: seller.phone_number || "",
  country: seller.country || "",
  category: seller.shop?.category || "",
  rating: Number(seller.shop?.ratings || 0),
  updated: formatAdminDate(seller.updatedAt),
});

const getAdminSellerSearchText = (
  seller: ReturnType<typeof mapAdminSellerListItem>
) =>
  [
    seller.name,
    seller.email,
    seller.shopName,
    seller.address,
    seller.joined,
  ]
    .join(" ")
    .toLowerCase();

const getAdminSellersFromDatabase = async () => {
  try {
    const sellersModel = getPrismaModel("sellers");

    if (sellersModel?.findMany) {
      return ((await sellersModel.findMany({
        orderBy: {
          createdAt: "desc",
        },
        take: 1000,
        include: {
          shop: {
            include: {
              avatar: true,
            },
          },
        },
      })) || []) as RawSellerRecord[];
    }
  } catch (error) {
    console.error("Admin sellers Prisma query failed:", error);
  }

  const result = await runRawCommand<{
    cursor?: { firstBatch?: RawSellerRecord[] };
  }>({
    aggregate: "sellers",
    pipeline: [
      { $sort: { createdAt: -1 } },
      { $limit: 1000 },
      {
        $lookup: {
          from: "shops",
          localField: "_id",
          foreignField: "sellerId",
          as: "shop",
        },
      },
      {
        $unwind: {
          path: "$shop",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "images",
          localField: "shop._id",
          foreignField: "shopId",
          as: "avatar",
        },
      },
      {
        $project: {
          _id: 1,
          name: 1,
          email: 1,
          phone_number: 1,
          country: 1,
          createdAt: 1,
          updatedAt: 1,
          "shop._id": 1,
          "shop.name": 1,
          "shop.address": 1,
          "shop.category": 1,
          "shop.ratings": 1,
          "avatar.url": 1,
        },
      },
    ],
    cursor: {},
  });

  const rawSellers = result?.cursor?.firstBatch || [];

  if (rawSellers.length > 0) {
    return rawSellers;
  }

  return [];
};

const findAdminSeller = async (sellerId: string) => {
  const normalizedSellerId = sellerId.replace(/^#/, "").toLowerCase();
  const sellers = await getAdminSellersFromDatabase();

  return (
    sellers.find((seller) => {
      const rawSellerId = getRawSellerId(seller).toLowerCase();
      const rawShopId = getRawSellerShopId(seller).toLowerCase();

      return (
        rawSellerId === normalizedSellerId ||
        rawSellerId.endsWith(normalizedSellerId) ||
        rawShopId === normalizedSellerId ||
        rawShopId.endsWith(normalizedSellerId) ||
        seller.email?.toLowerCase() === normalizedSellerId
      );
    }) || null
  );
};

const getRecentOrders = async () => {
  try {
    const ordersModel = getPrismaModel("orders");

    if (ordersModel?.findMany) {
      const orders = (await ordersModel.findMany({
        orderBy: {
          createdAt: "desc",
        },
        take: 6,
        include: {
          user: true,
        },
      })) as RawOrderRecord[];

      return (orders || []).map((order, index) => ({
        id: `ORD-${getOrderId(order, index)}`,
        customer: order.user?.name || "Unknown Customer",
        amount: `$${Number(order.totalAmount || 0).toFixed(0)}`,
        status: order.paymentStatus || order.deliveryStatus || "Pending",
      }));
    }
  } catch (error) {
    console.error("Admin recent orders Prisma query failed:", error);
  }

  const result = await runRawCommand<{
    cursor?: { firstBatch?: RawOrderRecord[] };
  }>({
    aggregate: "orders",
    pipeline: [
      { $sort: { createdAt: -1 } },
      { $limit: 6 },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      {
        $unwind: {
          path: "$user",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 1,
          totalAmount: 1,
          paymentStatus: 1,
          deliveryStatus: 1,
          createdAt: 1,
          "user.name": 1,
        },
      },
    ],
    cursor: {},
  });

  return (result?.cursor?.firstBatch || []).map((order, index) => ({
    id: `ORD-${getOrderId(order, index)}`,
    customer: order.user?.name || "Unknown Customer",
    amount: `$${Number(order.totalAmount || 0).toFixed(0)}`,
    status: order.paymentStatus || order.deliveryStatus || "Pending",
  }));
};

const getRevenue = async () => {
  const months = Array.from({ length: 7 }).map((_, index) => {
    const date = new Date();
    date.setMonth(date.getMonth() - (6 - index));
    date.setDate(1);
    date.setHours(0, 0, 0, 0);

    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
        2,
        "0"
      )}`,
      month: date.toLocaleString("en", { month: "short" }),
    };
  });
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 6);
  startDate.setDate(1);
  startDate.setHours(0, 0, 0, 0);

  try {
    const ordersModel = getPrismaModel("orders");

    if (ordersModel?.findMany) {
      const orders = await ordersModel.findMany({
        where: {
          createdAt: {
            gte: startDate,
          },
        },
        select: {
          createdAt: true,
          totalAmount: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      });
      const revenueByMonth = new Map<string, { total: number; count: number }>();

      (orders || []).forEach((order: { createdAt?: Date | string; totalAmount?: number }) => {
        const createdAt = order.createdAt ? new Date(order.createdAt) : null;

        if (!createdAt || Number.isNaN(createdAt.getTime())) {
          return;
        }

        const key = `${createdAt.getFullYear()}-${String(
          createdAt.getMonth() + 1
        ).padStart(2, "0")}`;
        const current = revenueByMonth.get(key) || { total: 0, count: 0 };

        current.total += Number(order.totalAmount || 0);
        current.count += 1;
        revenueByMonth.set(key, current);
      });

      return months.map(({ key, month }) => {
        const item = revenueByMonth.get(key);

        return {
          month,
          total: Number(item?.total || 0),
          count: Number(item?.count || 0),
        };
      });
    }
  } catch (error) {
    console.error("Admin revenue Prisma query failed:", error);
  }

  const result = await runRawCommand<{
    cursor?: {
      firstBatch?: Array<{ _id: string; total: number; count: number }>;
    };
  }>({
    aggregate: "orders",
    pipeline: [
      {
        $match: {
          createdAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m",
              date: "$createdAt",
            },
          },
          total: { $sum: "$totalAmount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ],
    cursor: {},
  });

  const revenueByMonth = new Map(
    (result?.cursor?.firstBatch || []).map((item) => [item._id, item])
  );

  return months.map(({ key, month }) => {
    const item = revenueByMonth.get(key);

    return {
      month,
      total: Number(item?.total || 0),
      count: Number(item?.count || 0),
    };
  });
};

const getRevenueMarker = (
  revenue: Array<{ month: string; total: number; count: number }>
) => {
  const preferredIndex = Math.min(4, Math.max(revenue.length - 1, 0));
  let latestDataIndex = -1;

  for (let index = revenue.length - 1; index >= 0; index -= 1) {
    if (revenue[index].total > 0 || revenue[index].count > 0) {
      latestDataIndex = index;
      break;
    }
  }

  const index = latestDataIndex >= 0 ? latestDataIndex : preferredIndex;
  const item = revenue[index] || revenue[preferredIndex] || {
    month: "",
    total: 0,
    count: 0,
  };

  return {
    index,
    month: item.month,
    value: item.count || Math.round(item.total),
    total: item.total,
  };
};

const getCountryDistribution = async () => {
  try {
    const sellersModel = getPrismaModel("sellers");

    if (sellersModel?.findMany) {
      const sellers = await sellersModel.findMany({
        select: {
          country: true,
        },
      });
      const counts = new Map<string, number>();

      (sellers || []).forEach((seller: { country?: string | null }) => {
        const country = seller.country || "Unknown";
        counts.set(country, (counts.get(country) || 0) + 1);
      });

      return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([country, sellers]) => ({
          country,
          sellers,
        }));
    }
  } catch (error) {
    console.error("Admin distribution Prisma query failed:", error);
  }

  const result = await runRawCommand<{
    cursor?: {
      firstBatch?: Array<{ _id: string | null; users?: number; sellers?: number }>;
    };
  }>({
    aggregate: "sellers",
    pipeline: [
      {
        $group: {
          _id: "$country",
          sellers: { $sum: 1 },
        },
      },
      { $sort: { sellers: -1 } },
      { $limit: 6 },
    ],
    cursor: {},
  });

  return (result?.cursor?.firstBatch || []).map((item) => ({
    country: item._id || "Unknown",
    sellers: Number(item.sellers || 0),
  }));
};

const getRawAdminId = (admin: RawAdminRecord) => {
  if (admin.id) {
    return admin.id;
  }

  if (typeof admin._id === "string") {
    return admin._id;
  }

  if (admin._id?.$oid) {
    return admin._id.$oid;
  }

  return admin._id?.toString?.() || admin.email || "";
};

const serializeRawAdmin = (admin: RawAdminRecord): AdminAccount => ({
  id: getRawAdminId(admin),
  name: admin.name,
  email: admin.email || "",
  password: admin.password,
});

const findRawAdminByEmail = async (email: string) => {
  if (typeof (prisma as any).$runCommandRaw !== "function") {
    return null;
  }

  const result = await (prisma as any).$runCommandRaw({
    find: "admins",
    filter: { email },
    limit: 1,
  });

  const admin = result?.cursor?.firstBatch?.[0];
  return admin ? serializeRawAdmin(admin) : null;
};

const findAdminByEmail = async (email: string) => {
  const adminModel = getAdminModel();

  if (adminModel?.findUnique) {
    return adminModel.findUnique({
      where: { email },
    }) as Promise<AdminAccount | null>;
  }

  return findRawAdminByEmail(email);
};

const saveRawAdmin = async (admin: {
  name: string;
  email: string;
  password: string;
}) => {
  if (typeof (prisma as any).$runCommandRaw !== "function") {
    return null;
  }

  const now = new Date();

  await (prisma as any).$runCommandRaw({
    update: "admins",
    updates: [
      {
        q: { email: admin.email },
        u: {
          $set: {
            name: admin.name,
            password: admin.password,
            updatedAt: now,
          },
          $setOnInsert: {
            email: admin.email,
            createdAt: now,
          },
        },
        upsert: true,
      },
    ],
  });

  return findRawAdminByEmail(admin.email);
};

const saveAdmin = async (admin: {
  name: string;
  email: string;
  password: string;
}) => {
  const adminModel = getAdminModel();

  if (adminModel?.upsert) {
    return adminModel.upsert({
      where: { email: admin.email },
      update: {
        name: admin.name,
        password: admin.password,
      },
      create: admin,
    }) as Promise<AdminAccount>;
  }

  const savedAdmin = await saveRawAdmin(admin);

  if (!savedAdmin) {
    throw new Error("Admin database model is not available.");
  }

  return savedAdmin;
};

const recordAdminLogin = async (email: string) => {
  try {
    if (typeof (prisma as any).$runCommandRaw !== "function") {
      return;
    }

    await (prisma as any).$runCommandRaw({
      update: "admins",
      updates: [
        {
          q: { email },
          u: {
            $set: {
              lastLoginAt: new Date(),
              updatedAt: new Date(),
            },
          },
        },
      ],
    });
  } catch (error) {
    console.error("Failed to record admin login:", error);
  }
};

const signInAdmin = (res: Response, admin: AdminAccount) => {
  const accessToken = jwt.sign(
    {
      id: admin.id,
      email: admin.email,
      role: "admin",
    },
    ACCESS_TOKEN_SECRET,
    { expiresIn: "15m" }
  );

  const refreshToken = jwt.sign(
    {
      id: admin.id,
      email: admin.email,
      role: "admin",
    },
    REFRESH_TOKEN_SECRET,
    { expiresIn: "7d" }
  );

  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  };

  res.cookie("admin_access_token", accessToken, cookieOptions);
  res.cookie("admin_refresh_token", refreshToken, cookieOptions);

  return res.status(200).json({
    status: "success",
    message: "Admin login successful!",
    token: accessToken,
    admin: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: "admin",
    },
  });
};

export const registerAdmin = async (
  req: Request<object, object, AdminRegisterBody>,
  res: Response,
  next: NextFunction
) => {
  try {
    const name = req.body.name?.trim();
    const email = req.body.email ? normalizeEmail(req.body.email) : "";
    const password = req.body.password;

    if (!name || !email || !password) {
      return sendError(res, 400, "Name, email and password are required!");
    }

    if (!emailRegex.test(email)) {
      return sendError(res, 400, "Invalid email address!");
    }

    if (password.length < 6) {
      return sendError(res, 400, "Password must be at least 6 characters!");
    }

    const existingAdmin = await findAdminByEmail(email);

    if (existingAdmin) {
      return sendError(res, 409, "Admin already exists with this email!");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const admin = await saveAdmin({
      name,
      email,
      password: hashedPassword,
    });

    return res.status(201).json({
      status: "success",
      message: "Admin account created successfully!",
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: "admin",
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const loginAdmin = async (
  req: Request<object, object, AdminLoginBody>,
  res: Response,
  next: NextFunction
) => {
  try {
    const email = req.body.email ? normalizeEmail(req.body.email) : "";
    const password = req.body.password;

    if (!email || !password) {
      return sendError(res, 400, "Email and password are required!");
    }

    const admin = await findAdminByEmail(email);

    if (admin?.password) {
      const isPasswordMatched = await bcrypt.compare(password, admin.password);

      if (!isPasswordMatched) {
        return sendError(res, 401, "Invalid credentials!");
      }

      await recordAdminLogin(admin.email);

      return signInAdmin(res, admin);
    }

    const defaultAdminCredential = getDefaultAdminCredential(email, password);

    if (!defaultAdminCredential) {
      return sendError(res, 401, "Invalid credentials!");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const savedAdmin = await saveAdmin({
      name: defaultAdminCredential.name,
      email,
      password: hashedPassword,
    });

    await recordAdminLogin(savedAdmin.email);

    return signInAdmin(res, savedAdmin);
  } catch (error) {
    return next(error);
  }
};

export const getAdminDashboard = async (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const [
      totalUsers,
      totalSellers,
      totalProducts,
      totalOrders,
      revenue,
      recentOrders,
      distribution,
    ] = await Promise.all([
      safeDashboardValue(() => getCollectionCount("users"), 0),
      safeDashboardValue(() => getCollectionCount("sellers"), 0),
      safeDashboardValue(() => getCollectionCount("products"), 0),
      safeDashboardValue(() => getCollectionCount("orders"), 0),
      safeDashboardValue(() => getRevenue(), []),
      safeDashboardValue(() => getRecentOrders(), []),
      safeDashboardValue(() => getCountryDistribution(), []),
    ]);

    const totalRevenue = revenue.reduce((sum, item) => sum + item.total, 0);
    const revenueMarker = getRevenueMarker(revenue);
    const successfulOrders = recentOrders.filter(
      (order) => order.status.toLowerCase() === "paid"
    ).length;
    const pendingOrders = recentOrders.filter(
      (order) => order.status.toLowerCase() === "pending"
    ).length;

    return res.status(200).json({
      status: "success",
      data: {
        stats: {
          totalUsers,
          totalSellers,
          totalProducts,
          totalOrders,
          totalRevenue,
          successfulOrders,
          pendingOrders,
        },
        revenue,
        revenueMarker,
        deviceUsage: {
          phone: totalUsers,
          tablet: totalSellers,
          computer: totalOrders,
        },
        distribution,
        recentOrders,
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const getAdminOrders = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const orders = (await getAdminOrdersFromDatabase())
      .map(mapAdminOrderListItem)
      .filter((order) =>
        search
          ? getAdminOrderSearchText(order).includes(search.toLowerCase())
          : true
      );

    return res.status(200).json({
      status: "success",
      orders,
    });
  } catch (error) {
    return next(error);
  }
};

export const getAdminOrder = async (
  req: Request<{ orderId: string }>,
  res: Response,
  next: NextFunction
) => {
  try {
    const order = await findAdminOrder(req.params.orderId);

    if (!order) {
      return sendError(res, 404, "Order not found!");
    }

    const orderWithAddress = await getOrderWithAddress(order);

    return res.status(200).json({
      status: "success",
      order: mapAdminOrderDetail(orderWithAddress),
    });
  } catch (error) {
    return next(error);
  }
};

export const getAdminProducts = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 8), 1), 50);
    const products = (await getAdminProductsFromDatabase())
      .map(mapAdminProductListItem)
      .filter((product) =>
        search
          ? getAdminProductSearchText(product).includes(search.toLowerCase())
          : true
      );
    const totalProducts = products.length;
    const totalPages = Math.max(Math.ceil(totalProducts / limit), 1);
    const currentPage = Math.min(page, totalPages);
    const startIndex = (currentPage - 1) * limit;

    return res.status(200).json({
      status: "success",
      products: products.slice(startIndex, startIndex + limit),
      pagination: {
        page: currentPage,
        limit,
        totalProducts,
        totalPages,
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const getAdminProduct = async (
  req: Request<{ productId: string }>,
  res: Response,
  next: NextFunction
) => {
  try {
    const product = await findAdminProduct(req.params.productId);

    if (!product) {
      return sendError(res, 404, "Product not found!");
    }

    return res.status(200).json({
      status: "success",
      product: mapAdminProductDetail(product),
    });
  } catch (error) {
    return next(error);
  }
};

export const getAdminEvents = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 8), 1), 50);
    const events = (await getAdminProductsFromDatabase())
      .map(mapAdminEventListItem)
      .filter((event) =>
        search
          ? getAdminEventSearchText(event).includes(search.toLowerCase())
          : true
      );
    const totalEvents = events.length;
    const totalPages = Math.max(Math.ceil(totalEvents / limit), 1);
    const currentPage = Math.min(page, totalPages);
    const startIndex = (currentPage - 1) * limit;

    return res.status(200).json({
      status: "success",
      events: events.slice(startIndex, startIndex + limit),
      pagination: {
        page: currentPage,
        limit,
        totalEvents,
        totalPages,
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const getAdminUsers = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 8), 1), 50);
    const users = (await getAdminUsersFromDatabase())
      .map(mapAdminUserListItem)
      .filter((user) =>
        search
          ? getAdminUserSearchText(user).includes(search.toLowerCase())
          : true
      );
    const totalUsers = users.length;
    const totalPages = Math.max(Math.ceil(totalUsers / limit), 1);
    const currentPage = Math.min(page, totalPages);
    const startIndex = (currentPage - 1) * limit;

    return res.status(200).json({
      status: "success",
      users: users.slice(startIndex, startIndex + limit),
      pagination: {
        page: currentPage,
        limit,
        totalUsers,
        totalPages,
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const getAdminUser = async (
  req: Request<{ userId: string }>,
  res: Response,
  next: NextFunction
) => {
  try {
    const user = await findAdminUser(req.params.userId);

    if (!user) {
      return sendError(res, 404, "User not found!");
    }

    return res.status(200).json({
      status: "success",
      user: mapAdminUserDetail(user),
    });
  } catch (error) {
    return next(error);
  }
};

export const getAdminSellers = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 8), 1), 50);
    const sellers = (await getAdminSellersFromDatabase())
      .map(mapAdminSellerListItem)
      .filter((seller) =>
        search
          ? getAdminSellerSearchText(seller).includes(search.toLowerCase())
          : true
      );
    const totalSellers = sellers.length;
    const totalPages = Math.max(Math.ceil(totalSellers / limit), 1);
    const currentPage = Math.min(page, totalPages);
    const startIndex = (currentPage - 1) * limit;

    return res.status(200).json({
      status: "success",
      sellers: sellers.slice(startIndex, startIndex + limit),
      pagination: {
        page: currentPage,
        limit,
        totalSellers,
        totalPages,
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const getAdminSeller = async (
  req: Request<{ sellerId: string }>,
  res: Response,
  next: NextFunction
) => {
  try {
    const seller = await findAdminSeller(req.params.sellerId);

    if (!seller) {
      return sendError(res, 404, "Seller not found!");
    }

    return res.status(200).json({
      status: "success",
      seller: mapAdminSellerDetail(seller),
    });
  } catch (error) {
    return next(error);
  }
};
