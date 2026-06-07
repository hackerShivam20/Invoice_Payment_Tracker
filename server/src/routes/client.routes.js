import { Router } from "express";
import {
  createClient,
  getAllClients,
  getClientById,
  updateClient,
  deleteClient,
} from "../controllers/client.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  createClientSchema,
  updateClientSchema,
  clientIdSchema,
  clientQuerySchema,
} from "../validators/client.validator.js";

const router = Router();

// Apply verifyJWT to ALL routes in this router with one line.
// WHY router.use() instead of adding verifyJWT to each route:
// DRY — every client route requires auth. If you add a new route,
// it's automatically protected. No chance of forgetting.
router.use(verifyJWT);

router
  .route("/")
  .get(validate(clientQuerySchema), getAllClients)
  .post(validate(createClientSchema), createClient);

router
  .route("/:id")
  .get(validate(clientIdSchema), getClientById)
  .put(validate(updateClientSchema), updateClient)
  .delete(validate(clientIdSchema), deleteClient);

export default router;