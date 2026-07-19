import { PrismaClient } from "@prisma/client";
import type { NextFunction, Response } from "express";
import {
  fetchUserAnalytics,
  saveUserRecommendations,
} from "../services/fetch-active";
import { recommendProducts } from "../services/recommendation-service";

const prisma = new PrismaClient();
const RECOMMENDATION_CACHE_HOURS = 3;
const RECOMMENDATION_LIMIT = 10;

const getHoursSince = (date: Date | null) => {
  if (!date) {
    return Number.POSITIVE_INFINITY;
  }

  return (Date.now() - date.getTime()) / (1000 * 60 * 60);
};

export const getRecommendedProducts = async (
  req: any,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized! User not found.",
      });
    }

    const products = await prisma.products.findMany({
      where: {
        OR: [{ isDeleted: false }, { isDeleted: null }],
      },
      include: { images: true, Shop: true },
      orderBy: { createdAt: "desc" },
    });

    const userAnalytics = await fetchUserAnalytics(userId);
    const actions = userAnalytics?.actions ?? [];
    const cachedRecommendations = userAnalytics?.recommendations ?? [];
    const cacheAgeHours = getHoursSince(userAnalytics?.lastTrained ?? null);

    let recommendedProductIds: string[];

    if (
      cachedRecommendations.length > 0 &&
      cacheAgeHours < RECOMMENDATION_CACHE_HOURS
    ) {
      recommendedProductIds = cachedRecommendations;
    } else if (actions.length === 0) {
      recommendedProductIds = products
        .slice(0, RECOMMENDATION_LIMIT)
        .map((product) => product.id);
    } else {
      recommendedProductIds = await recommendProducts(
        userId,
        products,
        actions
      );

      if (recommendedProductIds.length > 0) {
        await saveUserRecommendations(
          userId,
          recommendedProductIds
        );
      }
    }

    const productById = new Map(
      products.map((product) => [product.id, product])
    );
    const recommendedProducts = recommendedProductIds
      .map((productId) => productById.get(productId))
      .filter((product): product is NonNullable<typeof product> =>
        Boolean(product)
      );
    const recommendedIds = new Set(
      recommendedProducts.map((product) => product.id)
    );
    const fallbackProducts = products.filter(
      (product) => !recommendedIds.has(product.id)
    );

    return res.status(200).json({
      success: true,
      recommendations: [...recommendedProducts, ...fallbackProducts].slice(
        0,
        RECOMMENDATION_LIMIT
      ),
    });
  } catch (error) {
    return next(error);
  }
};
