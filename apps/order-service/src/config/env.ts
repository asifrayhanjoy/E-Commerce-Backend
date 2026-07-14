import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "apps/E-Commerce-BG/.env") });
dotenv.config({
  path: path.resolve(process.cwd(), "apps/order-service/.env"),
  override: true,
});
dotenv.config({ path: path.resolve(__dirname, "../../..", ".env") });
dotenv.config({
  path: path.resolve(__dirname, "../../..", "apps/E-Commerce-BG/.env"),
});
dotenv.config({
  path: path.resolve(__dirname, "../../..", "apps/order-service/.env"),
  override: true,
});
