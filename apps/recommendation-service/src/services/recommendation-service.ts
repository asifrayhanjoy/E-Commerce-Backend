import type { UserAction } from "./fetch-active";

type ProductInput = {
  id: string;
  category?: string | null;
  subCategory?: string | null;
  tags?: string | null;
  brand?: string | null;
  ratings?: number | null;
  sale_price?: number | null;
  createdAt?: Date | string | null;
};

type WeightedProduct = {
  id: string;
  score: number;
};

const ACTION_WEIGHTS: Record<string, number> = {
  purchase: 5,
  add_to_cart: 3,
  add_to_wishlist: 2,
  product_view: 1,
};

const normalizeText = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const addScore = (scores: Map<string, number>, key: string, score: number) => {
  if (!key) {
    return;
  }

  scores.set(key, (scores.get(key) ?? 0) + score);
};

export const recommendProducts = async (
  userId: string,
  allProducts: ProductInput[],
  userActions: UserAction[]
): Promise<string[]> => {
  if (allProducts.length === 0) {
    return [];
  }

  const productsById = new Map(
    allProducts.map((product) => [product.id, product])
  );
  const categoryScores = new Map<string, number>();
  const subCategoryScores = new Map<string, number>();
  const brandScores = new Map<string, number>();
  const productScores = new Map<string, number>();

  userActions
    .filter((action) => !action.userId || action.userId === userId)
    .forEach((action) => {
      const productId = normalizeText(action.productId);
      const product = productsById.get(action.productId || "");
      const weight = ACTION_WEIGHTS[normalizeText(action.actionType)] ?? 0.5;

      addScore(productScores, productId, weight * 2);

      if (product) {
        addScore(categoryScores, normalizeText(product.category), weight);
        addScore(subCategoryScores, normalizeText(product.subCategory), weight);
        addScore(brandScores, normalizeText(product.brand), weight * 0.5);
      }
    });

  const weightedProducts: WeightedProduct[] = allProducts.map((product) => {
    const category = normalizeText(product.category);
    const subCategory = normalizeText(product.subCategory);
    const brand = normalizeText(product.brand);
    const rating = Number(product.ratings || 0);
    const directScore = productScores.get(normalizeText(product.id)) ?? 0;

    return {
      id: product.id,
      score:
        directScore +
        (categoryScores.get(category) ?? 0) +
        (subCategoryScores.get(subCategory) ?? 0) +
        (brandScores.get(brand) ?? 0) +
        rating * 0.2,
    };
  });

  return weightedProducts
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((product) => product.id);
};
