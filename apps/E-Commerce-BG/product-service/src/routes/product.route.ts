import { Router } from "express";
import { getCategories, createDiscountCodes, getDiscountCodes, deleteDiscountCode, uploadProductImage, deleteProductImage, createProduct, getShopProducts, restoreProduct, deleteProduct, getStripeAccount, getAllProducts, getProductDetails, getProductTracking, trackProductView, trackProductWishlist, trackProductCart } from "../controller/product.controller";
import isAuthenticated from "../../../src/utils/middleware/isAuthenticated";

const router = Router();

router.get("/get-categories", getCategories);
router.post("/create-discount-code", isAuthenticated, createDiscountCodes );
router.get( "/get-discount-codes", isAuthenticated, getDiscountCodes );
router.delete( "/delete-discount-code/:id", isAuthenticated, deleteDiscountCode );
router.post( "/upload-product-image", isAuthenticated, uploadProductImage);
router.delete( "/delete-product-image", isAuthenticated, deleteProductImage);
router.post( "/create-product", isAuthenticated, createProduct);
router.get("/get-shop-products", isAuthenticated, getShopProducts);
router.delete("/delete-product/:productId", isAuthenticated, deleteProduct);
router.put("/restore-product/:productId", isAuthenticated, restoreProduct);
router.get("/get-stripe-account", isAuthenticated, getStripeAccount);
router.get("/get-all-products", getAllProducts);
router.get("/product-details", getProductDetails);
router.get("/:productId/tracking", getProductTracking);
router.post("/:productId/track-view", trackProductView);
router.post("/:productId/track-wishlist", trackProductWishlist);
router.post("/:productId/track-cart", trackProductCart);

export default router;
