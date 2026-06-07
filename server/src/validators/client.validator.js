import { z } from "zod";

// WHY we define schemas in separate files:
// 1. Reusable — createClientSchema can be imported in tests too
// 2. Co-located with the feature — client validators stay near client logic
// 3. Readable — business rules are documented in one place

// Helper: reusable phone number regex
// Supports: +91 9876543210, 9876543210, +1-555-555-5555
const phoneRegex = /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]{6,14}$/;

// Helper: GST number regex (India)
// Format: 2 digits + 5 alpha + 4 digits + 1 alpha + 1 alpha/digit + Z + 1 alphanumeric
const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

// ─── CREATE CLIENT SCHEMA ──────────────────────────────────────────────────
// z.object() validates that the value is an object.
// .shape defines the fields and their rules.
export const createClientSchema = z.object({
  body: z.object({
    name: z
      .string({ required_error: "Client name is required" })
      // .trim() removes whitespace before validation
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name cannot exceed 100 characters"),

    email: z
      .string({ required_error: "Email is required" })
      .trim()
      .toLowerCase()   // transform: normalize email before saving
      .email("Please provide a valid email address"),

    phone: z
      .string()
      .trim()
      .regex(phoneRegex, "Please provide a valid phone number")
      // .optional() means the field can be missing from the request
      // Without .optional(), Zod requires the field even if it has no .min()
      .optional(),

    company: z
      .string()
      .trim()
      .max(100, "Company name cannot exceed 100 characters")
      .optional(),

    address: z
      .object({
        street: z.string().trim().optional(),
        city: z.string().trim().optional(),
        state: z.string().trim().optional(),
        country: z.string().trim().optional(),
        pincode: z.string().trim().optional(),
      })
      // .optional() on the whole address object — it's not required
      .optional(),

    gstin: z
      .string()
      .trim()
      .toUpperCase()   // normalize GST number to uppercase
      .regex(gstRegex, "Please provide a valid GSTIN number")
      .optional(),

    currency: z
      .enum(["INR", "USD", "EUR", "GBP", "AED"], {
        errorMap: () => ({
          message: "Currency must be one of: INR, USD, EUR, GBP, AED",
        }),
      })
      // Default: if currency is not sent, use INR
      .default("INR"),

    notes: z
      .string()
      .trim()
      .max(500, "Notes cannot exceed 500 characters")
      .optional(),
  }),
});

// ─── UPDATE CLIENT SCHEMA ──────────────────────────────────────────────────
// .partial() makes ALL fields optional — perfect for PATCH/PUT updates.
// User can send only the fields they want to change.
// WHY not just reuse createClientSchema with all fields optional manually:
// .partial() is DRY — any field added to createClientSchema is automatically
// partial in updateClientSchema too.
export const updateClientSchema = z.object({
  body: createClientSchema.shape.body.partial(),

  // Validate the URL param :id is a valid MongoDB ObjectId
  // WHY: Without this, passing "abc" as :id causes Mongoose to throw
  // a CastError deep in the controller. Catching it here gives a
  // clean 422 with a useful message instead of a 500.
  params: z.object({
    id: z
      .string()
      .regex(/^[a-fA-F0-9]{24}$/, "Invalid client ID format"),
  }),
});

// ─── GET/DELETE CLIENT SCHEMA ──────────────────────────────────────────────
// Only validates the :id param — no body needed for these routes.
export const clientIdSchema = z.object({
  params: z.object({
    id: z
      .string()
      .regex(/^[a-fA-F0-9]{24}$/, "Invalid client ID format"),
  }),
});

// ─── QUERY/FILTER SCHEMA ───────────────────────────────────────────────────
// Validates query params for the GET /clients list endpoint.
// Query params come in as strings — z.coerce.number() converts "10" → 10
export const clientQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(10),
    search: z.string().trim().optional(),
    sortBy: z
      .enum(["name", "email", "createdAt", "company"])
      .default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  }),
});