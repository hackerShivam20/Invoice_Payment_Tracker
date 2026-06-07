import mongoose from "mongoose";

const addressSchema = new mongoose.Schema(
  {
    street: { type: String, trim: true },
    city:   { type: String, trim: true },
    state:  { type: String, trim: true },
    country: { type: String, trim: true },
    pincode: { type: String, trim: true },
  },
  { _id: false }
  // _id: false — embedded sub-documents don't need their own _id.
  // WHY: Mongoose adds _id to every sub-document by default.
  // For embedded objects that are never queried independently,
  // _id just wastes space.
);

const clientSchema = new mongoose.Schema(
  {
    // Every client belongs to exactly one user.
    // This is your multi-tenancy foundation: when you query clients,
    // you always filter by user: Client.find({ user: req.user._id })
    // This ensures User A can NEVER see User B's clients.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Client must belong to a user"],
      // Index on user because EVERY client query filters by user.
      // Without this, MongoDB scans ALL clients to find yours.
      index: true,
    },

    name: {
      type: String,
      required: [true, "Client name is required"],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters"],
    },

    email: {
      type: String,
      required: [true, "Client email is required"],
      trim: true,
      lowercase: true,
    },

    phone: {
      type: String,
      trim: true,
    },

    company: {
      type: String,
      trim: true,
    },

    address: addressSchema,

    gstin: {
      type: String,
      trim: true,
      uppercase: true,
    },

    currency: {
      type: String,
      enum: ["INR", "USD", "EUR", "GBP", "AED"],
      default: "INR",
    },

    notes: {
      type: String,
      maxlength: [500, "Notes cannot exceed 500 characters"],
    },

    // Soft delete pattern.
    // WHY not hard delete (actually remove the document):
    // If you delete a client who has invoices, those invoices lose their
    // client reference. Instead, isActive = false hides the client from
    // the UI while preserving all historical data and invoice relationships.
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    // toJSON transform: controls what's returned when you call res.json(client)
    // We can add computed fields here in the future without changing the schema.
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── COMPOUND INDEX ───────────────────────────────────────────────────────────
// A compound index on (user + email) serves two purposes:
// 1. Prevents a user from adding the same client email twice
// 2. Makes "find client by email for this user" fast
// unique: true enforces this at the DB level — not just application logic.
// WHY compound not just unique email: two different users CAN have
// a client with the same email (it's their own client list).
clientSchema.index({ user: 1, email: 1 }, { unique: true });

// ─── COMPOUND INDEX FOR SEARCH ────────────────────────────────────────────────
// Text index enables MongoDB's $text search operator across name, email, company.
// You can then do: Client.find({ $text: { $search: "Acme" } })
// This is faster than regex search on large collections.
clientSchema.index({ name: "text", email: "text", company: "text" });

// ─── VIRTUAL: invoiceCount ────────────────────────────────────────────────────
// A virtual field is computed, not stored in MongoDB.
// You populate it separately when needed (see getClientById controller).
// WHY virtual not a stored field: invoice count changes every time an
// invoice is created or deleted. Storing it means you must update it in sync.
// A virtual is always computed fresh.
clientSchema.virtual("invoices", {
  ref: "Invoice",       // the model to populate from
  localField: "_id",    // match Client._id
  foreignField: "client", // to Invoice.client
});

export const Client = mongoose.model("Client", clientSchema);