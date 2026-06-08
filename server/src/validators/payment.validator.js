import { z } from "zod";

const objectId = z
  .string()
  .regex(/^[a-fA-F0-9]{24}$/, "Invalid ID format");

export const createPaymentSchema = z.object({
  body: z.object({
    invoice: objectId,

    amount: z
      .number({ required_error: "Amount is required" })
      .positive("Amount must be greater than 0")
      // Round to 2 decimal places on input
      .transform((val) => parseFloat(val.toFixed(2))),

    method: z.enum(
      ["cash", "upi", "bank_transfer", "card", "cheque", "other"],
      { required_error: "Payment method is required" }
    ),

    paymentDate: z
      .string()
      .or(z.date())
      .transform((val) => new Date(val))
      .optional(),

    transactionId: z.string().trim().max(100).optional(),

    note: z.string().trim().max(500).optional(),
  }),
});

export const updatePaymentSchema = z.object({
  body: z.object({
    amount: z
      .number()
      .positive("Amount must be greater than 0")
      .transform((val) => parseFloat(val.toFixed(2)))
      .optional(),

    method: z
      .enum(["cash", "upi", "bank_transfer", "card", "cheque", "other"])
      .optional(),

    paymentDate: z
      .string()
      .or(z.date())
      .transform((val) => new Date(val))
      .optional(),

    transactionId: z.string().trim().max(100).optional(),
    note: z.string().trim().max(500).optional(),
  }),

  params: z.object({
    id: objectId,
  }),
});

export const paymentIdSchema = z.object({
  params: z.object({
    id: objectId,
  }),
});

export const paymentQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(10),
    invoice: objectId.optional(),
    method: z
      .enum(["cash", "upi", "bank_transfer", "card", "cheque", "other"])
      .optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
});