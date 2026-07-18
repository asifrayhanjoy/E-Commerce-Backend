import { Request, NextFunction, Response } from "express";
import { Redis } from "@upstash/redis";
import { PrismaClient } from "@prisma/client";
import { sendEmail } from "../utils/sendEmail";
// Local ValidationError to avoid missing identifier when a shared error class isn't available.
class ValidationError extends Error {
  status: number;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
  }
}
import Stripe from "stripe";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

let stripeClient: Stripe | null = null;

const getStripeClient = () => {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new ValidationError("Stripe secret key is not configured.");
  }

  stripeClient ??= new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-06-24.dahlia",
  });

  return stripeClient;
};

const redisClient = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const DELIVERY_STATUSES = [
  "Ordered",
  "Packed",
  "Shipped",
  "Out for Delivery",
  "Delivered",
] as const;
const SELLER_EARNING_RATE = 0.9;
const ADMIN_FEE_RATE = 0.1;

const getOrderLookupConditions = (orderId: string) => {
  const conditions: any[] = [
    { paymentSessionId: orderId },
    { paymentIntentId: orderId },
  ];

  if (/^[a-f\d]{24}$/i.test(orderId)) {
    conditions.unshift({ id: orderId });
  }

  return conditions;
};

const getOrderShippingAddress = async (order: {
  shippingAddressId?: string | null;
  userId: string;
}) => {
  if (!order.shippingAddressId) {
    return null;
  }

  return prisma.user_addresses.findFirst({
    where: {
      id: order.shippingAddressId,
      userId: order.userId,
    },
    select: {
      id: true,
      label: true,
      name: true,
      street: true,
      city: true,
      zip: true,
      country: true,
      isDefault: true,
    },
  });
};

const toMoneyAmount = (value: number) => Number(value.toFixed(2));

const getOrderPaymentTotal = (order: { totalAmount?: number | null }) => {
  const totalAmount = Number(order.totalAmount || 0);

  return Number.isFinite(totalAmount) ? totalAmount : 0;
};

const getCartItemCount = (cart: unknown) => {
  if (!Array.isArray(cart)) {
    return 0;
  }

  return cart.reduce((total, item: any) => {
    const quantity = Number(item?.quantity || 0);
    return total + (Number.isFinite(quantity) ? quantity : 0);
  }, 0);
};

const enrichOrderCartItems = async (cart: unknown) => {
  if (!Array.isArray(cart)) {
    return [];
  }

  const productIds = cart
    .map((item: any) => item?.id || item?.productId)
    .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);

  if (productIds.length === 0) {
    return cart;
  }

  const products = await prisma.products.findMany({
    where: {
      id: {
        in: [...new Set(productIds)],
      },
    },
    select: {
      id: true,
      title: true,
      slug: true,
      images: true,
      sale_price: true,
      regular_price: true,
    },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  return cart.map((item: any) => {
    const product = productById.get(item?.id || item?.productId);

    return {
      ...item,
      product,
      title: item?.title || product?.title || "Product",
      images: item?.images || product?.images || [],
      sale_price: item?.sale_price ?? product?.sale_price ?? 0,
      regular_price: item?.regular_price ?? product?.regular_price ?? 0,
    };
  });
};

const getTrackingSteps = (deliveryStatus?: string | null) => {
  const currentIndex = Math.max(
    DELIVERY_STATUSES.findIndex((status) => status === deliveryStatus),
    0
  );

  return DELIVERY_STATUSES.map((status, index) => ({
    label: status,
    completed: index <= currentIndex,
    current: index === currentIndex,
  }));
};

const mapOrderToSellerPayment = (order: any) => {
  const totalAmount = getOrderPaymentTotal(order);

  return {
    id: order.id,
    orderId: order.id,
    buyer: order.user,
    buyerName: order.user?.name || order.user?.email || "Unknown Buyer",
    buyerEmail: order.user?.email || null,
    totalAmount: toMoneyAmount(totalAmount),
    sellerEarning: toMoneyAmount(totalAmount * SELLER_EARNING_RATE),
    adminFee: toMoneyAmount(totalAmount * ADMIN_FEE_RATE),
    status: order.paymentStatus || "Paid",
    paymentIntentId: order.paymentIntentId,
    paymentSessionId: order.paymentSessionId,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
};

const formatAdminOrderId = (id: string) =>
  `#${String(id || "").slice(-6).toUpperCase()}`;

const formatAdminOrderDate = (value: Date | string) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    date.getFullYear(),
  ].join("/");
};

const formatAdminPaymentCurrency = (value: number) =>
  `$${Number(value || 0).toFixed(2)}`;

const mapOrderToAdminPayment = (order: any) => {
  const totalAmount = getOrderPaymentTotal(order);
  const adminFee = toMoneyAmount(totalAmount * ADMIN_FEE_RATE);
  const sellerEarnings = toMoneyAmount(totalAmount * SELLER_EARNING_RATE);

  return {
    id: order.id,
    orderId: formatAdminOrderId(order.id),
    shop: order.shop?.name || "Unknown shop",
    buyer: order.user?.name || order.user?.email || "Unknown buyer",
    adminFee: formatAdminPaymentCurrency(adminFee),
    adminFeeValue: adminFee,
    sellerEarnings: formatAdminPaymentCurrency(sellerEarnings),
    sellerEarningsValue: sellerEarnings,
    total: formatAdminPaymentCurrency(totalAmount),
    totalValue: toMoneyAmount(totalAmount),
    paymentStatus: order.paymentStatus || "Pending",
    date: formatAdminOrderDate(order.createdAt),
    createdAt: order.createdAt,
  };
};

const mapOrderToAdminOrder = (order: any) => ({
  id: order.id,
  orderId: formatAdminOrderId(order.id),
  shop: order.shop?.name || "Unknown shop",
  buyer: order.user?.name || order.user?.email || "Unknown buyer",
  total: `$${getOrderPaymentTotal(order).toFixed(2)}`,
  status: order.paymentStatus || "Pending",
  date: formatAdminOrderDate(order.createdAt),
});

const matchesAdminOrderSearch = (order: ReturnType<typeof mapOrderToAdminOrder>, search: string) => {
  if (!search) {
    return true;
  }

  const searchableText = [
    order.orderId,
    order.shop,
    order.buyer,
    order.total,
    order.status,
    order.date,
  ]
    .join(" ")
    .toLowerCase();

  return searchableText.includes(search.toLowerCase());
};

const matchesAdminPaymentSearch = (
  payment: ReturnType<typeof mapOrderToAdminPayment>,
  search: string
) => {
  if (!search) {
    return true;
  }

  const searchableText = [
    payment.orderId,
    payment.shop,
    payment.buyer,
    payment.adminFee,
    payment.sellerEarnings,
    payment.total,
    payment.paymentStatus,
    payment.date,
  ]
    .join(" ")
    .toLowerCase();

  return searchableText.includes(search.toLowerCase());
};

const paginateAdminPayments = <T,>(items: T[], page: number, limit: number) => {
  const requestedPage = Number(page || 1);
  const requestedLimit = Number(limit || 10);
  const safePage = Number.isFinite(requestedPage)
    ? Math.max(requestedPage, 1)
    : 1;
  const safeLimit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 100)
    : 10;
  const totalPages = Math.max(Math.ceil(items.length / safeLimit), 1);
  const currentPage = Math.min(safePage, totalPages);
  const startIndex = (currentPage - 1) * safeLimit;

  return {
    payments: items.slice(startIndex, startIndex + safeLimit),
    pagination: {
      page: currentPage,
      limit: safeLimit,
      totalPayments: items.length,
      totalPages,
    },
  };
};

const getAdminPaymentSummary = (
  payments: ReturnType<typeof mapOrderToAdminPayment>[]
) => {
  const totalRevenue = payments.reduce(
    (sum, payment) => sum + payment.totalValue,
    0
  );
  const totalAdminFees = payments.reduce(
    (sum, payment) => sum + payment.adminFeeValue,
    0
  );
  const totalSellerEarnings = payments.reduce(
    (sum, payment) => sum + payment.sellerEarningsValue,
    0
  );

  return {
    totalRevenue: formatAdminPaymentCurrency(totalRevenue),
    totalAdminFees: formatAdminPaymentCurrency(totalAdminFees),
    totalSellerEarnings: formatAdminPaymentCurrency(totalSellerEarnings),
  };
};

const parseStoredSession = <T>(value: unknown): T => {
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }

  if (value && typeof value === "object") {
    return value as T;
  }

  throw new ValidationError("Invalid payment session data.");
};

const isStripeTransferCapabilityError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: string }).code === "insufficient_capabilities_for_transfer";

const createPlatformPaymentIntent = ( stripe: Stripe, params: {
    amount: number;
    sessionId: string;
    userId: string;
    sellerStripeAccountId?: string;
    transferSkippedReason: string;
  }
) => stripe.paymentIntents.create({
    amount: params.amount,
    currency: "usd",
    payment_method_types: ["card"],
    metadata: {
      sessionId: params.sessionId,
      userId: params.userId,
      sellerStripeAccountId: params.sellerStripeAccountId || "",
      transferSkippedReason: params.transferSkippedReason,
    },
  });

// create payment intent
export const createPaymentIntent = async ( req: any, res: Response, next: NextFunction ) => {
  const { amount, sellerStripeAccountId, sessionId } = req.body;

  const customerAmount = Math.round(Number(amount || 0) * 100);
  const platformFee = Math.floor(customerAmount * 0.1);
  const userId = req.user.id;
  let transferMode: "connected" | "platform" = "connected";
  let warning: string | undefined;

  if (!sessionId) {
    return next(new ValidationError("Payment session ID is required."));
  }

  if (!Number.isFinite(customerAmount) || customerAmount < 1) {
    return next(new ValidationError("Payment amount is invalid."));
  }

  try {
    const stripe = getStripeClient();
    let paymentIntent: Stripe.PaymentIntent;

    if (!sellerStripeAccountId) {
      transferMode = "platform";
      warning = "Seller Stripe account is missing; payment will be collected on the platform account.";
      paymentIntent = await createPlatformPaymentIntent(stripe, {
        amount: customerAmount,
        sessionId,
        userId,
        transferSkippedReason: "seller_stripe_account_missing",
      });
    } else {
      try {
        paymentIntent = await stripe.paymentIntents.create({
          amount: customerAmount,
          currency: "usd",
          payment_method_types: ["card"],
          application_fee_amount: platformFee,
          transfer_data: {
            destination: sellerStripeAccountId,
          },
          metadata: {
            sessionId,
            userId,
            sellerStripeAccountId,
          },
        });
      } catch (error) {
        if (!isStripeTransferCapabilityError(error)) {
          throw error;
        }

        transferMode = "platform";
        warning =
          "Seller Stripe account is not ready for transfers; payment will be collected on the platform account.";
        paymentIntent = await createPlatformPaymentIntent(stripe, {
          amount: customerAmount,
          sessionId,
          userId,
          sellerStripeAccountId,
          transferSkippedReason: "seller_transfers_capability_inactive",
        });
      }
    }

    return res.send({
      clientSecret: paymentIntent.client_secret,
      transferMode,
      warning,
    });
  } catch (error) {
    return next(error);
  }
};

// create payment session
export const createPaymentSession = async ( req: any, res: Response, next: NextFunction ) => {
  try {
    const { cart, selectedAddressId, coupon } = req.body;
    const userId = req.user.id;

    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return next(new ValidationError("Cart is empty or invalid."));
    }

    const normalizedCart = JSON.stringify(
      cart
        .map((item: any) => ({
          id: item.id,
          quantity: item.quantity,
          sale_price: item.sale_price,
          shopId: item.shopId,
          selectedOptions: item.selectedOptions || {},
        }))
        .sort((a, b) => a.id.localeCompare(b.id))
    );

    const keys = await redisClient.keys("payment-session:*");

    for (const key of keys) {
      const data = await redisClient.get<unknown>(key);

      if (data) {
        const session = parseStoredSession<any>(data);

        if (session.userId === userId) {
          const existingCart = JSON.stringify(
            session.cart
              .map((item: any) => ({
                id: item.id,
                quantity: item.quantity,
                sale_price: item.sale_price,
                shopId: item.shopId,
                selectedOptions: item.selectedOptions || {},
              }))
              .sort((a: any, b: any) => a.id.localeCompare(b.id))
          );

          if (existingCart === normalizedCart) {
            return res.status(200).json({
              sessionId: key.split(":")[1],
            });
          } else {
            await redisClient.del(key);
          }
        }
      }
    }
    // fetch sellers and their stripe accounts
const uniqueShopIds = [...new Set(cart.map((item: any) => item.shopId))];

const shops = await prisma.shops.findMany({
  where: {
    id: { in: uniqueShopIds },
  },
  select: {
    id: true,
    sellerId: true,
    sellers: {
      select: {
        stripeId: true,
      },
    },
  },
});
const sellerData = shops.map((shop) => ({
  shopId: shop.id,
  sellerId: shop.sellerId,
  stripeAccountId: shop?.sellers?.stripeId,
}));

// calculate total
const totalAmount = cart.reduce((total: number, item: any) => {
  return total + item.quantity * item.sale_price;
}, 0);

// create session payload
const sessionId = crypto.randomUUID();

const sessionData = {
  userId,
  cart,
  sellers: sellerData,
  totalAmount,
  shippingAddressId: selectedAddressId || null,
  coupon: coupon || null,
};

await redisClient.set(
  "payment-session:" + sessionId,
  sessionData,
  { ex: 600 } // 10 minutes
);

return res.status(201).json({
  sessionId,
});
  } catch (error) {
    return next(error);
  }
};

// verifying payment session
export const verifyingPaymentSession = async ( req: Request, res: Response, next: NextFunction ) => {
  try {
    const sessionId = req.query.sessionId as string;

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required." });
    }

    // Fetch session from Redis
    const sessionKey = `payment-session:${sessionId}`;
    const sessionData = await redisClient.get<unknown>(sessionKey);

    if (!sessionData) {
      return res
        .status(404)
        .json({ error: "Session not found or expired." });
    }

    // Parse and return session
    const session = parseStoredSession(sessionData);

    return res.status(200).json({
      success: true,
      session,
    });
  } catch (error) {
    return next(error);
  }
};

// create order
type OrderCartItem = {
  id: string;
  title?: string;
  name?: string;
  shopId: string;
  quantity: number;
  sale_price: number;
};

type PaymentSessionData = {
  userId: string;
  cart: OrderCartItem[];
  totalAmount?: number;
  shippingAddressId?: string | null;
  coupon?: {
    discountedProductId?: string;
    discountPercent?: number;
    discountAmount?: number;
  } | null;
};

const createOrdersForPaymentSession = async (params: {
  paymentIntent: Stripe.PaymentIntent;
  sessionId: string;
  userId: string;
  session: PaymentSessionData;
}) => {
  const { paymentIntent, sessionId, userId, session } = params;
  const { cart, coupon } = session;

  if (!Array.isArray(cart) || cart.length === 0) {
    throw new ValidationError("Invalid payment session cart");
  }

  if (session.userId !== userId) {
    throw new ValidationError("Payment session does not belong to this user.");
  }

  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });

  if (!user) {
    throw new ValidationError("User not found");
  }

  const shopGrouped = cart.reduce<Record<string, OrderCartItem[]>>(
    (acc, item) => {
      if (!acc[item.shopId]) {
        acc[item.shopId] = [];
      }
      acc[item.shopId].push(item);
      return acc;
    },
    {}
  );
  const orders: any[] = [];

  for (const [shopId, orderItems] of Object.entries(shopGrouped)) {
    const existingOrder = await prisma.orders.findFirst({
      where: {
        shopId,
        paymentIntentId: paymentIntent.id,
      },
    });

    if (existingOrder) {
      orders.push(existingOrder);
      continue;
    }

    let orderTotal = orderItems.reduce(
      (sum, item) => sum + item.quantity * item.sale_price,
      0
    );

    if (coupon?.discountedProductId) {
      const discountedItem = orderItems.find(
        (item) => item.id === coupon.discountedProductId
      );

      if (discountedItem) {
        const discount =
          (coupon.discountPercent || 0) > 0
            ? (discountedItem.sale_price *
                discountedItem.quantity *
                (coupon.discountPercent || 0)) /
              100
            : coupon.discountAmount || 0;

        orderTotal = Math.max(orderTotal - discount, 0);
      }
    }

    for (const item of orderItems) {
      await prisma.products.update({
        where: { id: item.id },
        data: {
          stock: { decrement: item.quantity },
        },
      });
    }

    const order = await prisma.orders.create({
      data: {
        userId,
        shopId,
        cart: orderItems,
        totalAmount: orderTotal,
        coupon: coupon || null,
        paymentIntentId: paymentIntent.id,
        paymentSessionId: sessionId,
        paymentStatus: "Paid",
        deliveryStatus: "Ordered",
        shippingAddressId: session.shippingAddressId || null,
      },
    });

    orders.push(order);
  }

  const totalAmount =
    session.totalAmount ??
    cart.reduce((total, item) => total + item.quantity * item.sale_price, 0);
  const orderRedirectLink = `${
    process.env.FRONTEND_URL || "https://eshop.com"
  }/order/${sessionId}`;

  await sendEmail(
    user.email,
    "🛍 Your Eshop Order Confirmation",
    "order-confirmation",
    {
      name: user.name,
      cart,
      totalAmount: coupon?.discountAmount
        ? totalAmount - coupon.discountAmount
        : totalAmount,
      trackingUrl: orderRedirectLink,
    }
  );

  await prisma.notifications.create({
    data: {
      title: "📦 Platform Order Alert",
      message: `A new order was placed by ${user.name}.`,
      creatorId: userId,
      receiverId: "admin",
      redirect_link: orderRedirectLink,
    },
  });

  await redisClient.del(`payment-session:${sessionId}`);

  return orders;
};

export const createOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stripe = getStripeClient();
    const stripeSignature = req.headers["stripe-signature"];

    if (!stripeSignature) {
      return res.status(400).send("Missing Stripe Signature");
    }

    const rawBody = (req as any).rawBody;

    if (!rawBody) {
      return res.status(400).send("Missing raw request body");
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        stripeSignature,
        process.env.STRIPE_WEBHOOK_SECRET!
      );
    } catch (err: any) {
      console.error("Webhook signature verification failed.", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type !== "payment_intent.succeeded") {
      return res.status(200).json({ received: true });
    }

    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const sessionId = paymentIntent.metadata.sessionId;
    const userId = paymentIntent.metadata.userId;

    if (!sessionId || !userId) {
      return res.status(400).send("Missing payment metadata");
    }

    const sessionKey = `payment-session:${sessionId}`;
    const sessionData = await redisClient.get<unknown>(sessionKey);

    if (!sessionData) {
      console.warn("Session data expired or missing for", sessionId);
      return res.status(200).send("No session found, skipping order creation");
    }

    const session = parseStoredSession<PaymentSessionData>(sessionData);
    await createOrdersForPaymentSession({
      paymentIntent,
      sessionId,
      userId,
      session,
    });

    return res.status(200).json({
      received: true,
      message: "Order processed successfully",
    });
  } catch (error) {
    return next(error);
  }
};

export const confirmPaymentSession = async (req: any, res: Response, next: NextFunction) => {
  try {
    if (req.role !== "user" || !req.user?.id) {
      return res.status(403).json({
        success: false,
        message: "Only users can confirm their payment.",
      });
    }

    const sessionId =
      typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
    const paymentIntentId =
      typeof req.body?.paymentIntentId === "string"
        ? req.body.paymentIntentId
        : "";

    if (!sessionId || !paymentIntentId) {
      return res.status(400).json({
        success: false,
        message: "Payment session ID and payment intent ID are required.",
      });
    }

    const stripe = getStripeClient();
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== "succeeded") {
      return res.status(400).json({
        success: false,
        message: "Payment is not completed yet.",
      });
    }

    if (
      paymentIntent.metadata?.sessionId &&
      paymentIntent.metadata.sessionId !== sessionId
    ) {
      return res.status(403).json({
        success: false,
        message: "Payment session does not match this payment.",
      });
    }

    if (
      paymentIntent.metadata?.userId &&
      paymentIntent.metadata.userId !== req.user.id
    ) {
      return res.status(403).json({
        success: false,
        message: "Payment does not belong to this user.",
      });
    }

    const existingOrders = await prisma.orders.findMany({
      where: {
        userId: req.user.id,
        paymentIntentId,
      },
    });

    if (existingOrders.length > 0) {
      return res.status(200).json({
        success: true,
        message: "Order already confirmed.",
        orders: existingOrders,
      });
    }

    const sessionKey = `payment-session:${sessionId}`;
    const sessionData = await redisClient.get<unknown>(sessionKey);

    if (!sessionData) {
      return res.status(404).json({
        success: false,
        message: "Payment session expired before order creation.",
      });
    }

    const session = parseStoredSession<PaymentSessionData>(sessionData);
    const orders = await createOrdersForPaymentSession({
      paymentIntent,
      sessionId,
      userId: req.user.id,
      session,
    });

    return res.status(201).json({
      success: true,
      message: "Order confirmed successfully.",
      orders,
    });
  } catch (error) {
    return next(error);
  }
};

// get logged-in user's orders
export const getUserOrders = async (req: any, res: Response, next: NextFunction) => {
  try {
    if (req.role !== "user" || !req.user?.id) {
      return res.status(403).json({
        success: false,
        message: "Only users can view their orders.",
      });
    }

    const orders = await prisma.orders.findMany({
      where: {
        userId: req.user.id,
      },
      include: {
        shop: {
          select: {
            id: true,
            name: true,
            address: true,
            category: true,
            avatar: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const ordersWithAddress = await Promise.all(
      orders.map(async (order) => {
        const shippingAddress = await getOrderShippingAddress(order);
        const cart = await enrichOrderCartItems(order.cart);

        return {
          ...order,
          cart,
          itemCount: getCartItemCount(cart),
          paymentStatus: order.paymentStatus || "Paid",
          deliveryStatus: order.deliveryStatus || "Ordered",
          trackingSteps: getTrackingSteps(order.deliveryStatus),
          shippingAddress,
        };
      })
    );

    return res.status(200).json({
      success: true,
      stats: {
        totalOrders: ordersWithAddress.length,
        processingOrders: ordersWithAddress.filter(
          (order) => order.deliveryStatus !== "Delivered"
        ).length,
        completedOrders: ordersWithAddress.filter(
          (order) => order.deliveryStatus === "Delivered"
        ).length,
      },
      orders: ordersWithAddress,
    });
  } catch (error) {
    return next(error);
  }
};

// get one logged-in user's order
export const getUserOrder = async (req: any, res: Response, next: NextFunction) => {
  try {
    if (req.role !== "user" || !req.user?.id) {
      return res.status(403).json({
        success: false,
        message: "Only users can view this order.",
      });
    }

    const orderId = req.params.orderId;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required.",
      });
    }

    const order = await prisma.orders.findFirst({
      where: {
        userId: req.user.id,
        OR: getOrderLookupConditions(orderId),
      },
      include: {
        shop: {
          select: {
            id: true,
            name: true,
            address: true,
            category: true,
            avatar: true,
            coverBanner: true,
            sellers: {
              select: {
                id: true,
                name: true,
                email: true,
                phone_number: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    const cart = await enrichOrderCartItems(order.cart);
    const shippingAddress = await getOrderShippingAddress(order);

    return res.status(200).json({
      success: true,
      order: {
        ...order,
        cart,
        itemCount: getCartItemCount(cart),
        paymentStatus: order.paymentStatus || "Paid",
        deliveryStatus: order.deliveryStatus || "Ordered",
        trackingSteps: getTrackingSteps(order.deliveryStatus),
        shippingAddress,
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const getAdminOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const orders = await prisma.orders.findMany({
      take: 100,
      include: {
        shop: {
          select: {
            id: true,
            name: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    const adminOrders = orders
      .map(mapOrderToAdminOrder)
      .filter((order) => matchesAdminOrderSearch(order, search));

    return res.status(200).json({
      success: true,
      orders: adminOrders,
    });
  } catch (error) {
    return next(error);
  }
};

export const getAdminPayments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 10);
    const orders = await prisma.orders.findMany({
      take: 500,
      include: {
        shop: {
          select: {
            id: true,
            name: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    const payments = orders
      .map(mapOrderToAdminPayment)
      .filter((payment) => matchesAdminPaymentSearch(payment, search));

    return res.status(200).json({
      success: true,
      ...paginateAdminPayments(payments, page, limit),
      summary: getAdminPaymentSummary(payments),
    });
  } catch (error) {
    return next(error);
  }
};

// get sellers orders
export const getSellerOrders = async ( req: any, res: Response, next: NextFunction ) => {
  try {
    const seller = req.seller ?? (req.role === "seller" ? req.user : undefined);

    if (!seller?.id) {
      return res.status(403).json({
        success: false,
        message: "Only sellers can view shop orders.",
      });
    }

    const shop = await prisma.shops.findUnique({
      where: {
        sellerId: seller.id,
      },
    });

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found for this seller.",
      });
    }

    // fetch all orders for this shop
    const orders = await prisma.orders.findMany({
      where: {
        shopId: shop.id,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      success: true,
      orders,
    });
  } catch (error) {
    return next(error);
  }
};

// get seller payments
export const getSellerPayments = async ( req: any, res: Response, next: NextFunction ) => {
  try {
    const seller = req.seller ?? (req.role === "seller" ? req.user : undefined);

    if (!seller?.id) {
      return res.status(403).json({
        success: false,
        message: "Only sellers can view shop payments.",
      });
    }

    const shop = await prisma.shops.findUnique({
      where: {
        sellerId: seller.id,
      },
    });

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found for this seller.",
      });
    }

    const orders = await prisma.orders.findMany({
      where: {
        shopId: shop.id,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      success: true,
      payments: orders.map(mapOrderToSellerPayment),
    });
  } catch (error) {
    return next(error);
  }
};

// get seller order details
export const getSellerOrder = async ( req: any, res: Response, next: NextFunction ) => {
  try {
    const seller = req.seller ?? (req.role === "seller" ? req.user : undefined);
    const orderId = req.params.orderId;

    if (!seller?.id) {
      return res.status(403).json({
        success: false,
        message: "Only sellers can view shop orders.",
      });
    }

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required.",
      });
    }

    const shop = await prisma.shops.findUnique({
      where: {
        sellerId: seller.id,
      },
    });

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found for this seller.",
      });
    }

    const order = await prisma.orders.findFirst({
      where: {
        shopId: shop.id,
        OR: getOrderLookupConditions(orderId),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
        shop: {
          select: {
            id: true,
            name: true,
            address: true,
            category: true,
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    const shippingAddress = await getOrderShippingAddress(order);

    return res.status(200).json({
      success: true,
      order: {
        ...order,
        paymentStatus: order.paymentStatus || "Paid",
        deliveryStatus: order.deliveryStatus || "Ordered",
        shippingAddress,
      },
    });
  } catch (error) {
    return next(error);
  }
};

// update seller order delivery status
export const updateSellerOrderDeliveryStatus = async ( req: any, res: Response, next: NextFunction ) => {
  try {
    const seller = req.seller ?? (req.role === "seller" ? req.user : undefined);
    const orderId = req.params.orderId;
    const deliveryStatus = req.body?.deliveryStatus || req.body?.status;

    if (!seller?.id) {
      return res.status(403).json({
        success: false,
        message: "Only sellers can update shop orders.",
      });
    }

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required.",
      });
    }

    if (!DELIVERY_STATUSES.includes(deliveryStatus as typeof DELIVERY_STATUSES[number])) {
      return res.status(400).json({
        success: false,
        message: "Invalid delivery status.",
        allowedStatuses: DELIVERY_STATUSES,
      });
    }

    const shop = await prisma.shops.findUnique({
      where: {
        sellerId: seller.id,
      },
    });

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found for this seller.",
      });
    }

    const existingOrder = await prisma.orders.findFirst({
      where: {
        shopId: shop.id,
        OR: getOrderLookupConditions(orderId),
      },
      select: {
        id: true,
      },
    });

    if (!existingOrder) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    const order = await prisma.orders.update({
      where: {
        id: existingOrder.id,
      },
      data: {
        deliveryStatus,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
        shop: {
          select: {
            id: true,
            name: true,
            address: true,
            category: true,
          },
        },
      },
    });

    const shippingAddress = await getOrderShippingAddress(order);

    return res.status(200).json({
      success: true,
      message: "Delivery status updated successfully.",
      order: {
        ...order,
        paymentStatus: order.paymentStatus || "Paid",
        deliveryStatus: order.deliveryStatus || "Ordered",
        shippingAddress,
      },
    });
  } catch (error) {
    return next(error);
  }
};

// verify coupon code
export const verifyCouponCode = async ( req: any, res: Response, next: NextFunction ) => {
  try {
    const { couponCode, cart } = req.body;

    if (!couponCode || !cart || cart.length === 0) {
      return next(
        new ValidationError("Coupon code and cart are required!")
      );
    }

    // Fetch the discount code
    const discount = await prisma.discount_codes.findUnique({
      where: {
        discountCode: couponCode,
      },
    });

    if (!discount) {
      return next(new ValidationError("Coupon code isn't valid!"));
    }

    // Find matching product that includes this discount code
    const matchingProduct = cart.find(
      (item: any) =>
        item.discount_codes?.some((d: any) => d === discount.id)
    );

    if (!matchingProduct) {
      return res.status(200).json({
        valid: false,
        discount: 0,
        discountAmount: 0,
        message: "No matching product found in cart for this coupon",
      });
    }

    let discountAmount = 0;
    const price =
      matchingProduct.sale_price * matchingProduct.quantity;

    if (discount.discountType === "percentage") {
      discountAmount =
        (price * discount.discountValue) / 100;
    } else if (discount.discountType === "flat") {
      discountAmount = discount.discountValue;
    }

    // Prevent discount from being greater than total price
    discountAmount = Math.min(discountAmount, price);

    res.status(200).json({
      valid: true,
      discount: discount.discountValue,
      discountAmount: discountAmount.toFixed(2),
      discountedProductId: matchingProduct.id,
      discountType: discount.discountType,
      message: "Discount applied to 1 eligible product",
    });
  } catch (error) {
    next(error);
  }
};

export const changeUserPassword = async ( req: any, res: Response, next: NextFunction ) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return next(new ValidationError("User not authenticated."));
    }
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return next(
        new ValidationError("Current password and new password are required!")
      );
    }

    if (String(newPassword).length < 6) {
      return next(
        new ValidationError("New password must be at least 6 characters long!")
      );
    }

    const user = await prisma.users.findUnique({
      where: { id: userId },
    });

    if (!user?.password) {
      return next(new ValidationError("User account was not found!"));
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password
    );

    if (!isCurrentPasswordValid) {
      return next(new ValidationError("Current password is incorrect!"));
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.password);

    if (isSamePassword) {
      return next(
        new ValidationError(
          "New password cannot be the same as the current password!"
        )
      );
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.users.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return res.status(200).json({
      success: true,
      message: "Password changed successfully!",
    });
  } catch (error) {
    return next(error);
  }
};
