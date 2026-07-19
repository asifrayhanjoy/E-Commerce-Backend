
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const initializeConfig = async () => {
  try {
    const existingConfig = await prisma.site_config.findFirst({
      select: {
        id: true,
      },
    });

    if (!existingConfig) {
      await prisma.site_config.create({
        data: {
          categories: [
            "Electronics",
            "Fashion",
            "Home & Kitchen",
            "Sports & Fitness",
          ],
          subCategories: {
            Electronics: ["Mobiles", "Laptops", "Accessories", "Gaming"],
            Fashion: ["Men", "Women", "Kids", "Footwear"],
            "Home & Kitchen": ["Furniture", "Appliances", "Decor"],
            "Sports & Fitness": [
              "Gym Equipment",
              "Outdoor Sports",
              "Wearables",
            ],
          },
        },
      });
    }
  } catch (error) {
    console.error("Error initializing site config:", error);
  }
};

export default initializeConfig;
