import { Router } from "express";
import {
  recordPayment,
  getAllPayments,
  getPaymentsByInvoice,
  getPaymentById,
  updatePayment,
  deletePayment,
  getPaymentStats,
} from "../controllers/payment.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  createPaymentSchema,
  updatePaymentSchema,
  paymentIdSchema,
  paymentQuerySchema,
} from "../validators/payment.validator.js";

const router = Router();

router.use(verifyJWT);

// Stats — before /:id so "stats" isn't treated as an ID param
router.get("/stats", getPaymentStats);

// Payment history for a specific invoice
router.get(
  "/invoice/:invoiceId",
  getPaymentsByInvoice
);

router
  .route("/")
  .get(validate(paymentQuerySchema), getAllPayments)
  .post(validate(createPaymentSchema), recordPayment);

router
  .route("/:id")
  .get(validate(paymentIdSchema), getPaymentById)
  .put(validate(updatePaymentSchema), updatePayment)
  .delete(validate(paymentIdSchema), deletePayment);

export default router;