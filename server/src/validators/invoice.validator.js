import { z } from "zod";

// Helper: valid MongoDB ObjectId
const objectId = z
  .string()
  .regex(/^[a-fA-F0-9]{24}$/, "Invalid ID format");

// ─── INVOICE ITEM SCHEMA ──────────────────────────────────────────────────────
const invoiceItemSchema = z.object({
  name: z
    .string({ required_error: "Item name is required" })
    .trim()
    .min(1, "Item name cannot be empty")
    .max(200, "Item name too long"),

  description: z.string().trim().max(500).optional(),

  quantity: z
    .number({ required_error: "Quantity is required" })
    .positive("Quantity must be greater than 0")
    .multipleOf(0.01, "Quantity supports up to 2 decimal places"),

  unitPrice: z
    .number({ required_error: "Unit price is required" })
    .min(0, "Unit price cannot be negative"),

  taxRate: z
    .number()
    .min(0, "Tax rate cannot be negative")
    .max(100, "Tax rate cannot exceed 100")
    .default(0),
});

// ─── CREATE INVOICE SCHEMA ────────────────────────────────────────────────────
export const createInvoiceSchema = z.object({
  body: z.object({
    client: objectId,

    invoiceDate: z
      .string()
      .or(z.date())
      // coerce string "2024-01-15" to a Date object
      .transform((val) => new Date(val))
      .optional(),

    dueDate: z
      .string()
      .or(z.date())
      .transform((val) => new Date(val)),

    currency: z
      .enum(["INR", "USD", "EUR", "GBP", "AED"])
      .default("INR"),

    items: z
      .array(invoiceItemSchema)
      .min(1, "Invoice must have at least one item")
      .max(50, "Invoice cannot have more than 50 items"),

    discount: z
      .number()
      .min(0, "Discount cannot be negative")
      .default(0),

    notes: z.string().trim().max(1000).optional(),
    terms: z.string().trim().max(1000).optional(),
  }),
});

// ─── UPDATE INVOICE SCHEMA ────────────────────────────────────────────────────
export const updateInvoiceSchema = z.object({
  body: createInvoiceSchema.shape.body
    .omit({ client: true }) // client cannot be changed after creation
    .partial(),

  params: z.object({ id: objectId }),
});

// ─── ID PARAM SCHEMA ──────────────────────────────────────────────────────────
export const invoiceIdSchema = z.object({
  params: z.object({ id: objectId }),
});

// ─── QUERY SCHEMA ─────────────────────────────────────────────────────────────
export const invoiceQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(10),
    status: z
      .enum(["draft", "sent", "paid", "partial", "overdue", "cancelled"])
      .optional(),
    client: objectId.optional(),
    search: z.string().trim().optional(),
    sortBy: z
      .enum(["createdAt", "dueDate", "total", "invoiceNumber"])
      .default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
});