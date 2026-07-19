import express, { Router } from "express";
import isAuthenticated from "../middleware/isAuthenticated";
import { getRecommendedProducts } from "../controller/controller";

const router: Router = express.Router();

router.get("/get-recommendation-products", isAuthenticated, getRecommendedProducts);

export default router;
