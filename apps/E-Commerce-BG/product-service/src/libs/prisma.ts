import { PrismaClient } from "@prisma/client";

declare global {
  var productServicePrisma: PrismaClient | undefined;
}

const prisma = global.productServicePrisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.productServicePrisma = prisma;
}

export default prisma;
