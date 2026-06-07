import { ZodError } from "zod";
import { ApiError } from "../utils/ApiError.js";

// WHY Zod over express-validator or Joi:
// Zod schemas are TypeScript-first and produce a parsed, type-safe
// output — not just validation errors. When you call schema.parse(data),
// you get back a CLEAN object: unknown fields are stripped, types are
// coerced (strings to numbers where specified), defaults are applied.
// Your controller receives clean data, not raw req.body.

// validate() is a middleware FACTORY.
// You call it with a schema and it RETURNS a middleware function.
// Usage: router.post("/", validate(createClientSchema), createClient)
//
// WHY a factory pattern: you can't pass arguments directly to middleware.
// A factory lets you configure the middleware before Express calls it.

const validate = (schema) => (req, res, next) => {
  try {
    // schema.parse() does two things simultaneously:
    // 1. Validates the data against the schema rules
    // 2. Returns a cleaned, transformed object (strips unknown keys by default
    //    when you use z.object().strict(), applies defaults, coerces types)
    //
    // We spread all three sources so you can validate body, params, and query
    // in a single schema if needed:
    //   z.object({ body: z.object({...}), params: z.object({...}) })
    const parsed = schema.parse({
      body: req.body,
      params: req.params,
      query: req.query,
    });

    // Overwrite req.body with the parsed (cleaned) version.
    // Now your controller gets data that's already validated and clean.
    // No need for manual checks like "if (!req.body.email)" in controllers.
    // req.body = parsed.body || req.body;
    // req.params = parsed.params || req.params;
    // req.query = parsed.query || req.query;
    req.body = parsed.body || req.body;
req.params = parsed.params || req.params;

if (parsed.query) {
  Object.assign(req.query, parsed.query);
}

    next();
  } catch (error) {
    if (error instanceof ZodError) {
      // ZodError.errors is an array of issues:
      // [{ path: ["body", "email"], message: "Invalid email" }, ...]
      // We flatten this into a clean array the frontend can use to
      // highlight specific fields.
      const formattedErrors = error.issues.map((err) => ({
        // path[1] is the field name (path[0] is "body"/"params"/"query")
        field: err.path.slice(1).join("."),
        message: err.message,
      }));

      // 422 Unprocessable Entity = the request was well-formed (valid JSON)
      // but the content failed business validation.
      // Different from 400 Bad Request (malformed JSON, missing Content-Type).
      throw new ApiError(422, "Validation failed", formattedErrors);
    }
    // Non-Zod error (shouldn't happen here but safety net)
    next(error);
  }
};

export { validate };