import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    // Every payment belongs to one invoice
    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      required: [true, "Payment must belong to an invoice"],
      index: true,
    },

    // And to one user — for data isolation
    // WHY store user here too (not just invoice.user):
    // Direct queries like "all payments by this user" are faster
    // without having to join through invoice first
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Payment must belong to a user"],
      index: true,
    },

    amount: {
      type: Number,
      required: [true, "Payment amount is required"],
      min: [0.01, "Payment amount must be greater than 0"],
    },

    // Payment method — how the client paid
    method: {
      type: String,
      enum: ["cash", "upi", "bank_transfer", "card", "cheque", "other"],
      required: [true, "Payment method is required"],
    },

    paymentDate: {
      type: Date,
      required: [true, "Payment date is required"],
      default: Date.now,
    },

    // Optional reference — UPI transaction ID, cheque number, etc.
    // Helps with reconciliation and disputes
    transactionId: {
      type: String,
      trim: true,
    },

    note: {
      type: String,
      trim: true,
      maxlength: [500, "Note cannot exceed 500 characters"],
    },
  },
  {
    timestamps: true,
  }
);

// Compound index — most common query:
// "get all payments for this invoice ordered by date"
paymentSchema.index({ invoice: 1, paymentDate: -1 });

// Compound index — "get all payments by this user"
paymentSchema.index({ user: 1, createdAt: -1 });

export const Payment = mongoose.model("Payment", paymentSchema);