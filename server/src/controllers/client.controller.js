import mongoose from "mongoose";
import { Client } from "../models/Client.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// ─── CREATE CLIENT ────────────────────────────────────────────────────────────
export const createClient = asyncHandler(async (req, res) => {
  const { name, email, phone, company, address, gstin, currency, notes } =
    req.body;
  // req.body is already validated and cleaned by Zod middleware.
  // No need to re-validate here. Controller focuses purely on business logic.

  // Check for duplicate email within this user's client list.
  // The compound index (user + email) also enforces this at DB level,
  // but checking here gives a clean error BEFORE hitting the DB write.
  const existing = await Client.findOne({
    user: req.user._id,
    email,
    isActive: true,
  });

  if (existing) {
    throw new ApiError(
      409,
      `A client with email "${email}" already exists in your account`
    );
  }

  const client = await Client.create({
    user: req.user._id,  // always attach the logged-in user's ID
    name,
    email,
    phone,
    company,
    address,
    gstin,
    currency,
    notes,
  });

  return res
    .status(201)
    .json(new ApiResponse(201, client, "Client created successfully"));
});

// ─── GET ALL CLIENTS (with pagination + search) ───────────────────────────────
export const getAllClients = asyncHandler(async (req, res) => {
  // Zod already validated and coerced query params (strings → numbers, defaults applied).
  const { page, limit, search, sortBy, sortOrder } = req.query;

  // Build the base query: only this user's active clients.
  // Every query MUST include user: req.user._id — this is your data isolation.
  // Never forget this. Without it, all users see all clients.
  const baseQuery = {
    user: req.user._id,
    isActive: true,
  };

  // If search term provided, add MongoDB text search.
  // $text uses the text index we created on name, email, company.
  // Falls back to regex for partial matching if $text feels too strict.
  if (search) {
    // Regex search: case-insensitive, partial match
    // e.g. searching "acm" matches "Acme Corp"
    // WHY regex over $text here: $text requires whole words.
    // "acm" won't match "Acme" with $text, but will with regex.
    // Tradeoff: regex is slower on large collections. Use $text for 10k+ clients.
    const searchRegex = new RegExp(search, "i");
    baseQuery.$or = [
      { name: searchRegex },
      { email: searchRegex },
      { company: searchRegex },
    ];
  }

  // sortOrder "asc" → 1, "desc" → -1 (MongoDB sort convention)
  const sortDirection = sortOrder === "asc" ? 1 : -1;

  // WHY run count and find in parallel (Promise.all):
  // They're independent queries. Running sequentially wastes time.
  // Promise.all fires both at once — response is faster.
  const [clients, totalCount] = await Promise.all([
    Client.find(baseQuery)
      .sort({ [sortBy]: sortDirection })
      // .skip() jumps to the right page.
      // page 1 → skip 0, page 2 → skip 10, page 3 → skip 20
      .skip((page - 1) * limit)
      .limit(limit)
      // .lean() returns plain JS objects instead of Mongoose documents.
      // WHY: Mongoose documents carry overhead (methods, change tracking).
      // For read-only data sent to the client, .lean() is 3-5x faster.
      // Trade-off: you lose virtuals and instance methods on the result.
      .lean(),

    Client.countDocuments(baseQuery),
  ]);

  // Calculate pagination metadata the frontend needs to render page controls.
  const totalPages = Math.ceil(totalCount / limit);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        clients,
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          limit,
          hasNextPage,
          hasPrevPage,
        },
      },
      "Clients fetched successfully"
    )
  );
});

// ─── GET CLIENT BY ID ─────────────────────────────────────────────────────────
export const getClientById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  // Zod already validated that id is a valid ObjectId format.

  const client = await Client.findOne({
    _id: id,
    user: req.user._id, // CRITICAL: scoped to the logged-in user
    isActive: true,
  })
    // Populate invoices virtual — gets last 5 invoices for this client.
    // WHY limit 5: full invoice list would be fetched via the invoice endpoint.
    // Here we just want a quick summary for the client detail page.
    .populate({
      path: "invoices",
      select: "invoiceNumber status total dueDate createdAt",
      options: { sort: { createdAt: -1 }, limit: 5 },
    });

  if (!client) {
    // Same error whether the client doesn't exist OR belongs to another user.
    // WHY: Don't reveal that the ID exists but belongs to someone else.
    // "not found" is safer than "forbidden" here.
    throw new ApiError(404, "Client not found");
  }

  // Aggregate: total billed and total paid for this client.
  // WHY aggregation here instead of JS: the DB does this calculation
  // on the server — much faster than fetching all invoices to JS and summing.
  // This is a preview of what Day 5 (Invoice) will use extensively.
  const stats = await mongoose.model("Invoice").aggregate([
    {
      // Stage 1: filter invoices for this client only
      $match: {
        client: client._id,
        user: req.user._id,
      },
    },
    {
      // Stage 2: group all matched docs into one and compute sums
      $group: {
        _id: null,              // null = group everything into one bucket
        totalBilled: { $sum: "$total" },
        totalPaid: { $sum: "$amountPaid" },
        invoiceCount: { $sum: 1 },
      },
    },
  ]);

  const clientStats = stats[0] || {
    totalBilled: 0,
    totalPaid: 0,
    invoiceCount: 0,
  };

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        client,
        stats: {
          ...clientStats,
          outstanding: clientStats.totalBilled - clientStats.totalPaid,
        },
      },
      "Client fetched successfully"
    )
  );
});

// ─── UPDATE CLIENT ────────────────────────────────────────────────────────────
export const updateClient = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Check if client exists and belongs to this user BEFORE updating.
  // findOneAndUpdate returns the updated doc but doesn't let you check
  // if it existed first — you'd get null for "not found" AND "wrong user".
  // Separate find + update is clearer and safer.
  const client = await Client.findOne({
    _id: id,
    user: req.user._id,
    isActive: true,
  });

  if (!client) {
    throw new ApiError(404, "Client not found");
  }

  // If email is being updated, check for duplicate within this user's list
  if (req.body.email && req.body.email !== client.email) {
    const duplicate = await Client.findOne({
      user: req.user._id,
      email: req.body.email,
      isActive: true,
      _id: { $ne: id },  // exclude the current client from the check
    });

    if (duplicate) {
      throw new ApiError(
        409,
        `Another client with email "${req.body.email}" already exists`
      );
    }
  }

  // $set only updates the provided fields. Unspecified fields are untouched.
  // WHY $set: without it, the whole document is replaced.
  // { new: true } returns the updated doc (not the pre-update version).
  // { runValidators: true } runs schema validators on the updated fields.
  const updatedClient = await Client.findByIdAndUpdate(
    id,
    { $set: req.body },
    { new: true, runValidators: true }
  );

  return res
    .status(200)
    .json(new ApiResponse(200, updatedClient, "Client updated successfully"));
});

// ─── DELETE CLIENT ────────────────────────────────────────────────────────────
export const deleteClient = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const client = await Client.findOne({
    _id: id,
    user: req.user._id,
    isActive: true,
  });

  if (!client) {
    throw new ApiError(404, "Client not found");
  }

  // Business rule: prevent deletion if client has unpaid invoices.
  // WHY: Deleting a client with open invoices creates orphaned financial records.
  // Force the user to resolve invoices first (cancel or mark paid).
  const Invoice = mongoose.model("Invoice");
  const activeInvoices = await Invoice.countDocuments({
    client: id,
    status: { $in: ["draft", "sent", "partial", "overdue"] },
  });

  if (activeInvoices > 0) {
    throw new ApiError(
      400,
      `Cannot delete client with ${activeInvoices} active invoice(s). ` +
        "Please resolve all invoices before deleting this client."
    );
  }

  // Soft delete: set isActive = false instead of removing the document.
  // All past invoices still reference this client and display correctly.
  // Hard delete would break: Invoice.find().populate("client") → null
  await Client.findByIdAndUpdate(id, { $set: { isActive: false } });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Client deleted successfully"));
});