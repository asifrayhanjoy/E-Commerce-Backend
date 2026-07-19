import type { products } from "@prisma/client";

type UserActionInput = {
  userId?: string;
  productId?: string;
  actionType?: string;
};

export const preProcessData = (
  userActions: UserActionInput[],
  products: products[]
) => {
  const interactions = userActions
    .filter((action) => action.userId && action.productId && action.actionType)
    .map((action) => ({
      userId: action.userId,
      productId: action.productId,
      actionType: action.actionType,
    }));

  return { interactions, products };
};
