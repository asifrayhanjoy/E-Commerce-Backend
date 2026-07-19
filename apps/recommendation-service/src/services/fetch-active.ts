import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const analyticsCollections = ["userAnalytics", "user_analytics"] as const;

export type UserAction = {
  userId?: string;
  productId?: string;
  actionType?: string;
};

export type UserAnalytics = {
  actions: UserAction[];
  recommendations: string[];
  lastTrained: Date | null;
  collectionName: string;
};

const getFirstBatch = (result: unknown) =>
  (((result as any)?.cursor?.firstBatch ?? []) as Record<string, unknown>[]);

const normalizeActions = (value: unknown): UserAction[] =>
  Array.isArray(value)
    ? value.filter(
        (action): action is UserAction =>
          Boolean(action) && typeof action === "object"
      )
    : [];

const normalizeRecommendations = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((productId): productId is string => typeof productId === "string")
    : [];

const normalizeDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (value && typeof value === "object" && "$date" in value) {
    return normalizeDate((value as { $date: unknown }).$date);
  }

  return null;
};

export const fetchUserAnalytics = async (
  userId: string
): Promise<UserAnalytics | null> => {
  for (const collectionName of analyticsCollections) {
    try {
      const result = await prisma.$runCommandRaw({
        find: collectionName,
        filter: { userId },
        limit: 1,
      });
      const analytics = getFirstBatch(result)[0];

      if (analytics) {
        return {
          actions: normalizeActions(analytics.actions),
          recommendations: normalizeRecommendations(analytics.recommendations),
          lastTrained: normalizeDate(analytics.lastTrained),
          collectionName,
        };
      }
    } catch {
      continue;
    }
  }

  return null;
};

export const getUserActivity = async (userId: string) => {
  try {
    const analytics = await fetchUserAnalytics(userId);

    return analytics?.actions ?? [];
  } catch (error) {
    console.error("Error fetching user activity:", error);
    return [];
  }
};

export const saveUserRecommendations = async (
  userId: string,
  recommendations: string[],
  collectionName = analyticsCollections[0],
  trainedAt = new Date()
) => {
  try {
    await prisma.$runCommandRaw({
      update: collectionName,
      updates: [
        {
          q: { userId },
          u: {
            $set: {
              recommendations,
              lastTrained: { $date: trainedAt.toISOString() },
            },
            $setOnInsert: {
              userId,
              actions: [],
            },
          },
          upsert: true,
        },
      ],
    });
  } catch (error) {
    console.error("Error saving recommendations:", error);
  }
};
