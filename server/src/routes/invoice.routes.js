import { Router } from "express";
import {
  createInvoice,
  getAllInvoices,
  getInvoiceById,
  updateInvoice,
  deleteInvoice,
  cancelInvoice,
  duplicateInvoice,
  getInvoiceStats,
} from "../controllers/invoice.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  createInvoiceSchema,
  updateInvoiceSchema,
  invoiceIdSchema,
  invoiceQuerySchema,
} from "../validators/invoice.validator.js";

const router = Router();

// All invoice routes require authentication
router.use(verifyJWT);

// Stats — must be BEFORE /:id routes
// WHY: if "stats" was after /:id, Express would treat "stats" as an ID
router.get("/stats", getInvoiceStats);

router
  .route("/")
  .get(validate(invoiceQuerySchema), getAllInvoices)
  .post(validate(createInvoiceSchema), createInvoice);

router
  .route("/:id")
  .get(validate(invoiceIdSchema), getInvoiceById)
  .put(validate(updateInvoiceSchema), updateInvoice)
  .delete(validate(invoiceIdSchema), deleteInvoice);

router.patch("/:id/cancel", validate(invoiceIdSchema), cancelInvoice);
router.post("/:id/duplicate", validate(invoiceIdSchema), duplicateInvoice);

export default router;