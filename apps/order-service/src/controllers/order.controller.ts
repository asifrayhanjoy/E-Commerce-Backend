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
    const { cart, coupon } = session;

    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).send("Invalid payment session cart");
    }

    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });

    if (!user) {
      return res.status(404).send("User not found");
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

    for (const [shopId, orderItems] of Object.entries(shopGrouped)) {
      const existingOrder = await prisma.orders.findFirst({
        where: {
          shopId,
          paymentIntentId: paymentIntent.id,
        },
      });

      if (existingOrder) {
        console.log(`Order already processed for shop ${shopId}: ${existingOrder.id}`);
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

      await prisma.orders.create({
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

      console.log(`Processed order for shop ${shopId}: ${orderTotal}`);
    }

    const totalAmount =
      session.totalAmount ??
      cart.reduce((total, item) => total + item.quantity * item.sale_price, 0);
    const { name, email } = user;
    const orderRedirectLink = `${
      process.env.FRONTEND_URL || "https://eshop.com"
    }/order/${sessionId}`;

    await sendEmail(
      email,
      "🛍 Your Eshop Order Confirmation",
      "order-confirmation",
      {
        name,
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
        message: `A new order was placed by ${name}.`,
        creatorId: userId,
        receiverId: "admin",
        redirect_link: orderRedirectLink,
      },
    });

    await redisClient.del(sessionKey);

    return res.status(200).json({
      received: true,
      message: "Order processed successfully",
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
