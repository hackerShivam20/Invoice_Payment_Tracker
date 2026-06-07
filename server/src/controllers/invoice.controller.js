import mongoose from "mongoose";
import { Invoice } from "../models/Invoice.model.js";
import { Client } from "../models/Client.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { generateInvoiceNumber } from "../utils/generateInvoiceNumber.js";

// ─── CREATE INVOICE ───────────────────────────────────────────────────────────
export const createInvoice = asyncHandler(async (req, res) => {
  const { client, invoiceDate, dueDate, currency, items, discount, notes, terms } =
    req.body;

  // Verify the client exists and belongs to this user
  // WHY: Prevent creating an invoice for another user's client
  const clientDoc = await Client.findOne({
    _id: client,
    user: req.user._id,
    isActive: true,
  });

  if (!clientDoc) {
    throw new ApiError(404, "Client not found");
  }

  // Validate due date is after invoice date
  const invDate = invoiceDate ? new Date(invoiceDate) : new Date();
  const due = new Date(dueDate);

  if (due < invDate) {
    throw new ApiError(400, "Due date cannot be before invoice date");
  }

  // Auto-generate invoice number — unique per user per year
  const invoiceNumber = await generateInvoiceNumber(req.user._id);

  // Create invoice — the pre-save hook calculates all totals automatically
  // You never pass subtotal, taxAmount, or total — the hook computes them
  const invoice = await Invoice.create({
    user: req.user._id,
    client,
    invoiceNumber,
    invoiceDate: invDate,
    dueDate: due,
    currency: currency || clientDoc.currency,
    items,
    discount: discount || 0,
    notes,
    terms,
    status: "draft",
  });

  // Populate client details for the response
  await invoice.populate("client", "name email company gstin");

  return res
    .status(201)
    .json(new ApiResponse(201, invoice, "Invoice created successfully"));
});

// ─── GET ALL INVOICES ─────────────────────────────────────────────────────────
export const getAllInvoices = asyncHandler(async (req, res) => {
  const { page, limit, status, client, search, sortBy, sortOrder, startDate, endDate } =
    req.query;

  // Base query — always scoped to this user
  const query = { user: req.user._id };

  // Optional filters
  if (status) query.status = status;
  if (client) query.client = client;

  // Date range filter — for dashboard "this month" views
  if (startDate || endDate) {
    query.invoiceDate = {};
    if (startDate) query.invoiceDate.$gte = new Date(startDate);
    if (endDate) query.invoiceDate.$lte = new Date(endDate);
  }

  // Search by invoice number
  if (search) {
    query.invoiceNumber = { $regex: search, $options: "i" };
  }

  const sortDirection = sortOrder === "asc" ? 1 : -1;

  const [invoices, totalCount] = await Promise.all([
    Invoice.find(query)
      .populate("client", "name email company")
      .sort({ [sortBy]: sortDirection })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Invoice.countDocuments(query),
  ]);

  const totalPages = Math.ceil(totalCount / limit);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        invoices,
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      },
      "Invoices fetched successfully"
    )
  );
});

// ─── GET INVOICE BY ID ────────────────────────────────────────────────────────
export const getInvoiceById = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findOne({
    _id: req.params.id,
    user: req.user._id,
  })
    .populate("client", "name email phone company address gstin currency")
    .populate("user", "name email");

  if (!invoice) {
    throw new ApiError(404, "Invoice not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, invoice, "Invoice fetched successfully"));
});

// ─── UPDATE INVOICE ───────────────────────────────────────────────────────────
export const updateInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findOne({
    _id: req.params.id,
    user: req.user._id,
  });

  if (!invoice) {
    throw new ApiError(404, "Invoice not found");
  }

  // Business rule: paid or cancelled invoices cannot be edited
  // WHY: Editing a paid invoice would break accounting records.
  // In real accounting software, you must issue a credit note instead.
  if (["paid", "cancelled"].includes(invoice.status)) {
    throw new ApiError(
      400,
      `Cannot edit a ${invoice.status} invoice. Issue a credit note instead.`
    );
  }

  // Validate due date if provided
  if (req.body.dueDate) {
    const newDueDate = new Date(req.body.dueDate);
    const invDate = req.body.invoiceDate
      ? new Date(req.body.invoiceDate)
      : invoice.invoiceDate;

    if (newDueDate < invDate) {
      throw new ApiError(400, "Due date cannot be before invoice date");
    }
  }

  // Apply updates — Object.assign merges req.body into the document
  // WHY not findByIdAndUpdate here: we need the pre-save hook to run
  // (total calculation). findByIdAndUpdate bypasses pre-save hooks by default.
  Object.assign(invoice, req.body);
  await invoice.save(); // triggers pre-save hooks → recalculates totals + status

  await invoice.populate("client", "name email company gstin");

  return res
    .status(200)
    .json(new ApiResponse(200, invoice, "Invoice updated successfully"));
});

// ─── DELETE INVOICE ───────────────────────────────────────────────────────────
export const deleteInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findOne({
    _id: req.params.id,
    user: req.user._id,
  });

  if (!invoice) {
    throw new ApiError(404, "Invoice not found");
  }

  // Only draft invoices can be deleted
  // WHY: Sent/paid invoices are financial records — deleting them
  // would create gaps in your invoice number sequence and break audits.
  // For sent invoices, use "cancel" instead.
  if (invoice.status !== "draft") {
    throw new ApiError(
      400,
      `Cannot delete a ${invoice.status} invoice. Use cancel instead.`
    );
  }

  await Invoice.findByIdAndDelete(req.params.id);

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Invoice deleted successfully"));
});

// ─── CANCEL INVOICE ───────────────────────────────────────────────────────────
export const cancelInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findOne({
    _id: req.params.id,
    user: req.user._id,
  });

  if (!invoice) {
    throw new ApiError(404, "Invoice not found");
  }

  if (invoice.status === "paid") {
    throw new ApiError(400, "Cannot cancel a paid invoice");
  }

  if (invoice.status === "cancelled") {
    throw new ApiError(400, "Invoice is already cancelled");
  }

  invoice.status = "cancelled";
  await invoice.save();

  return res
    .status(200)
    .json(new ApiResponse(200, invoice, "Invoice cancelled successfully"));
});

// ─── DUPLICATE INVOICE ────────────────────────────────────────────────────────
// Creates a new draft invoice copied from an existing one.
// WHY: Businesses often send similar invoices repeatedly (monthly retainers, etc.)
// Duplicate saves time — copy and just change the date.
export const duplicateInvoice = asyncHandler(async (req, res) => {
  const original = await Invoice.findOne({
    _id: req.params.id,
    user: req.user._id,
  });

  if (!original) {
    throw new ApiError(404, "Invoice not found");
  }

  const invoiceNumber = await generateInvoiceNumber(req.user._id);

  const duplicate = await Invoice.create({
    user: req.user._id,
    client: original.client,
    invoiceNumber,
    invoiceDate: new Date(),
    // Default due date: 30 days from today
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    currency: original.currency,
    items: original.items,
    discount: original.discount,
    notes: original.notes,
    terms: original.terms,
    status: "draft",
    duplicatedFrom: original._id,
  });

  await duplicate.populate("client", "name email company");

  return res
    .status(201)
    .json(new ApiResponse(201, duplicate, "Invoice duplicated successfully"));
});

// ─── DASHBOARD STATS ──────────────────────────────────────────────────────────
// Aggregation pipeline — calculates all dashboard numbers in ONE DB query.
// WHY aggregation: doing this in JS would require fetching thousands of invoices.
// MongoDB does the math on the server — massively faster.
export const getInvoiceStats = asyncHandler(async (req, res) => {
  const stats = await Invoice.aggregate([
    // Stage 1: only this user's invoices
    { $match: { user: new mongoose.Types.ObjectId(req.user._id) } },

    // Stage 2: group everything into one document and compute counts/sums
    {
      $group: {
        _id: null,
        totalInvoices: { $sum: 1 },
        totalRevenue: { $sum: "$total" },
        totalPaid: { $sum: "$amountPaid" },
        totalOutstanding: {
          // outstanding = total - amountPaid, but only for unpaid invoices
          $sum: {
            $cond: [
              { $in: ["$status", ["sent", "partial", "overdue"]] },
              { $subtract: ["$total", "$amountPaid"] },
              0,
            ],
          },
        },
        // Count by status using $sum with conditional
        draftCount: {
          $sum: { $cond: [{ $eq: ["$status", "draft"] }, 1, 0] },
        },
        sentCount: {
          $sum: { $cond: [{ $eq: ["$status", "sent"] }, 1, 0] },
        },
        paidCount: {
          $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] },
        },
        overdueCount: {
          $sum: { $cond: [{ $eq: ["$status", "overdue"] }, 1, 0] },
        },
        partialCount: {
          $sum: { $cond: [{ $eq: ["$status", "partial"] }, 1, 0] },
        },
      },
    },

    // Stage 3: clean up the output (remove the _id: null field)
    {
      $project: {
        _id: 0,
        totalInvoices: 1,
        totalRevenue: 1,
        totalPaid: 1,
        totalOutstanding: 1,
        draftCount: 1,
        sentCount: 1,
        paidCount: 1,
        overdueCount: 1,
        partialCount: 1,
      },
    },
  ]);

  // If no invoices yet, return zero values
  const result = stats[0] || {
    totalInvoices: 0,
    totalRevenue: 0,
    totalPaid: 0,
    totalOutstanding: 0,
    draftCount: 0,
    sentCount: 0,
    paidCount: 0,
    overdueCount: 0,
    partialCount: 0,
  };

  return res
    .status(200)
    .json(new ApiResponse(200, result, "Invoice stats fetched successfully"));
});