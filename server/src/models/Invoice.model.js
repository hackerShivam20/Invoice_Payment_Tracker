import mongoose from "mongoose";

// ─── INVOICE ITEM SUB-SCHEMA ──────────────────────────────────────────────────
// WHY embedded (not a separate collection):
// Invoice items always belong to exactly one invoice and are always
// fetched with it. Embedding means one DB query instead of two.
// You never query invoice items independently — no need for a separate collection.
// Rule of thumb: if you always fetch A with B, embed B inside A.
const invoiceItemSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Item name is required"],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    quantity: {
      type: Number,
      required: [true, "Quantity is required"],
      min: [0.01, "Quantity must be greater than 0"],
    },
    unitPrice: {
      type: Number,
      required: [true, "Unit price is required"],
      min: [0, "Unit price cannot be negative"],
    },
    taxRate: {
      type: Number,
      default: 0,
      min: [0, "Tax rate cannot be negative"],
      max: [100, "Tax rate cannot exceed 100%"],
    },
    // total = quantity * unitPrice (tax calculated separately at invoice level)
    // WHY store this: avoids recalculating on every read.
    // We compute it when the invoice is saved and store the result.
    total: {
      type: Number,
    //   required: true,
    default: 0,
      min: [0, "Item total cannot be negative"],
    },
  },
  { _id: true } // keep _id for items — needed when editing a specific item
);

// ─── MAIN INVOICE SCHEMA ──────────────────────────────────────────────────────
const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      // unique per user is enforced via compound index below
      trim: true,
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Invoice must belong to a user"],
      index: true,
    },

    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: [true, "Invoice must have a client"],
      index: true,
    },

    status: {
      type: String,
      enum: ["draft", "sent", "paid", "partial", "overdue", "cancelled"],
      default: "draft",
      index: true, // frequently filtered — always index enum fields used in queries
    },

    invoiceDate: {
      type: Date,
      required: [true, "Invoice date is required"],
      default: Date.now,
    },

    dueDate: {
      type: Date,
      required: [true, "Due date is required"],
    },

    currency: {
      type: String,
      enum: ["INR", "USD", "EUR", "GBP", "AED"],
      default: "INR",
    },

    // items is an embedded array using the sub-schema defined above
    items: {
      type: [invoiceItemSchema],
      validate: {
        // Custom validator: invoice must have at least one item
        // WHY: An invoice with zero items is meaningless and shouldn't be saved
        validator: function (items) {
          return items && items.length > 0;
        },
        message: "Invoice must have at least one item",
      },
    },

    // ── FINANCIAL FIELDS ──────────────────────────────────────────────────────
    // WHY store calculated fields instead of computing on the fly:
    // For reports, aggregations, and sorting — you can't sort by a computed field
    // unless it's stored. Storing them keeps queries fast and simple.

    subtotal: {
      type: Number,
      default: 0,
      // sum of all (quantity * unitPrice) before tax and discount
    },

    taxAmount: {
      type: Number,
      default: 0,
      // total tax across all items
    },

    discount: {
      type: Number,
      default: 0,
      min: [0, "Discount cannot be negative"],
      // flat discount amount (not percentage — simpler for MVP)
    },

    total: {
      type: Number,
      default: 0,
      // subtotal + taxAmount - discount = grand total
    },

    amountPaid: {
      type: Number,
      default: 0,
      min: [0, "Amount paid cannot be negative"],
      // running total updated every time a payment is recorded
    },

    // ── CONTENT FIELDS ────────────────────────────────────────────────────────
    notes: {
      type: String,
      trim: true,
      maxlength: [1000, "Notes cannot exceed 1000 characters"],
      // shown at bottom of invoice PDF — "Thank you for your business"
    },

    terms: {
      type: String,
      trim: true,
      maxlength: [1000, "Terms cannot exceed 1000 characters"],
      // payment terms — "Payment due within 30 days"
    },

    // ── TRACKING FIELDS ───────────────────────────────────────────────────────
    sentAt: {
      type: Date,
      // set when invoice is emailed to client (Phase 2)
    },

    paidAt: {
      type: Date,
      // set when invoice reaches "paid" status
    },

    // For duplicate invoice feature — tracks which invoice this was copied from
    duplicatedFrom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── INDEXES ──────────────────────────────────────────────────────────────────

// Compound index: unique invoice number per user
// WHY compound not global unique: two users can both have INV-2024-0001
invoiceSchema.index({ user: 1, invoiceNumber: 1 }, { unique: true });

// Compound index for the most common query: "get all invoices for this user"
// sortBy createdAt desc is the default — this index serves that perfectly
invoiceSchema.index({ user: 1, createdAt: -1 });

// Status + user — for dashboard queries like "count overdue invoices for user"
invoiceSchema.index({ user: 1, status: 1 });

// Client + user — for "all invoices for this client"
invoiceSchema.index({ client: 1, user: 1 });

// ─── VIRTUAL: balance ─────────────────────────────────────────────────────────
// How much is still owed. Computed fresh — never stored.
// invoice.balance = invoice.total - invoice.amountPaid
invoiceSchema.virtual("balance").get(function () {
  return Math.max(0, this.total - this.amountPaid);
});

// ─── VIRTUAL: isOverdue ───────────────────────────────────────────────────────
// True if dueDate has passed and invoice is not paid/cancelled
invoiceSchema.virtual("isOverdue").get(function () {
  return (
    this.dueDate < new Date() &&
    !["paid", "cancelled"].includes(this.status)
  );
});

// ─── PRE-SAVE: CALCULATE TOTALS ───────────────────────────────────────────────
// Runs automatically before every .save() call.
// WHY: Prevents inconsistency — totals are always calculated from items,
// never manually set by the controller. Single source of truth.
invoiceSchema.pre("save", function () {
  if (this.isModified("items") || this.isModified("discount")) {
    // Step 1: calculate each item's total
    this.items.forEach((item) => {
      item.total = parseFloat((item.quantity * item.unitPrice).toFixed(2));
    });

    // Step 2: subtotal = sum of all item totals
    this.subtotal = parseFloat(
      this.items.reduce((sum, item) => sum + item.total, 0).toFixed(2)
    );

    // Step 3: taxAmount = sum of (itemTotal * taxRate / 100) for each item
    // WHY per-item tax: different items can have different tax rates
    // (GST 5% on food, 18% on services)
    this.taxAmount = parseFloat(
      this.items
        .reduce((sum, item) => sum + (item.total * item.taxRate) / 100, 0)
        .toFixed(2)
    );

    // Step 4: grand total
    this.total = parseFloat(
      (this.subtotal + this.taxAmount - (this.discount || 0)).toFixed(2)
    );

    // Ensure total is never negative (discount can't exceed subtotal + tax)
    if (this.total < 0) this.total = 0;
  }
//   next();
});

// ─── PRE-SAVE: AUTO STATUS ENGINE ────────────────────────────────────────────
// Automatically updates status based on payment amounts.
// WHY pre-save: status should ALWAYS reflect payment reality.
// A controller should never manually set status to "paid" —
// the hook does it automatically when amountPaid reaches total.
invoiceSchema.pre("save", function () {
  // Don't auto-change status for cancelled or draft invoices
  if (["cancelled", "draft"].includes(this.status)) return;

  if (this.amountPaid >= this.total && this.total > 0) {
    this.status = "paid";
    // Record when it became paid — useful for reports
    if (!this.paidAt) this.paidAt = new Date();
  } else if (this.amountPaid > 0 && this.amountPaid < this.total) {
    this.status = "partial";
  } else if (this.dueDate < new Date() && this.amountPaid === 0) {
    this.status = "overdue";
  }
  // If none of the above: keep existing status (sent, etc.)

//   next();
});

export const Invoice = mongoose.model("Invoice", invoiceSchema);