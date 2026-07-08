import { Router } from "express";
import { getCategories, createDiscountCodes, getDiscountCodes, deleteDiscountCode } from "../controller/product.controller";
import isAuthenticated from "../../../src/utils/middleware/isAuthenticated";

const router = Router();

router.get("/get-categories", getCategories);
router.post("/create-discount-code", isAuthenticated, createDiscountCodes );
router.get( "/get-discount-codes", isAuthenticated, getDiscountCodes );
router.delete( "/delete-discount-code/:id", isAuthenticated, deleteDiscountCode );
export default router;
