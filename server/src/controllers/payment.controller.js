import { Payment } from "../models/Payment.model.js";
import { Invoice } from "../models/Invoice.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { updateInvoicePaymentStatus } from "../utils/updateInvoicePaymentStatus.js";
import mongoose from "mongoose";

// ─── RECORD PAYMENT ───────────────────────────────────────────────────────────
export const recordPayment = asyncHandler(async (req, res) => {
  const { invoice: invoiceId, amount, method, paymentDate, transactionId, note } =
    req.body;

  // Step 1: verify invoice exists and belongs to this user
  const invoice = await Invoice.findOne({
    _id: invoiceId,
    user: req.user._id,
  });

  if (!invoice) {
    throw new ApiError(404, "Invoice not found");
  }

  // Step 2: business rules — which statuses can accept payments
  if (invoice.status === "cancelled") {
    throw new ApiError(400, "Cannot record payment for a cancelled invoice");
  }

  if (invoice.status === "paid") {
    throw new ApiError(
      400,
      "This invoice is already fully paid. No further payments can be recorded."
    );
  }

  // Step 3: overpayment check
  // balance = how much is still owed
  const balance = parseFloat((invoice.total - invoice.amountPaid).toFixed(2));

  if (amount > balance) {
    throw new ApiError(
      400,
      `Payment amount (${amount}) exceeds outstanding balance (${balance}). ` +
        `Maximum payable amount is ${balance}.`
    );
  }

  // Step 4: create the payment record
  const payment = await Payment.create({
    invoice: invoiceId,
    user: req.user._id,
    amount,
    method,
    paymentDate: paymentDate || new Date(),
    transactionId,
    note,
  });

  // Step 5: recalculate invoice amountPaid and trigger status engine
  // This is the core of the entire payment system
  const updatedInvoice = await updateInvoicePaymentStatus(
    new mongoose.Types.ObjectId(invoiceId)
  );

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        payment,
        invoice: {
          _id: updatedInvoice._id,
          invoiceNumber: updatedInvoice.invoiceNumber,
          status: updatedInvoice.status,
          total: updatedInvoice.total,
          amountPaid: updatedInvoice.amountPaid,
          balance: updatedInvoice.balance, // virtual field
        },
      },
      "Payment recorded successfully"
    )
  );
});

// ─── GET ALL PAYMENTS ─────────────────────────────────────────────────────────
export const getAllPayments = asyncHandler(async (req, res) => {
  const { page, limit, invoice, method, startDate, endDate } = req.query;

  // Base query — always scoped to this user
  const query = { user: req.user._id };

  if (invoice) query.invoice = invoice;
  if (method) query.method = method;

  // Date range filter on paymentDate
  if (startDate || endDate) {
    query.paymentDate = {};
    if (startDate) query.paymentDate.$gte = new Date(startDate);
    if (endDate) {
      // Set end of day so "endDate = today" includes all payments today
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query.paymentDate.$lte = end;
    }
  }

  const [payments, totalCount] = await Promise.all([
    Payment.find(query)
      // Populate invoice details — useful for payment history table
      .populate("invoice", "invoiceNumber total status client")
      .sort({ paymentDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Payment.countDocuments(query),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        payments,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalCount,
          limit,
          hasNextPage: page < Math.ceil(totalCount / limit),
          hasPrevPage: page > 1,
        },
      },
      "Payments fetched successfully"
    )
  );
});

// ─── GET PAYMENTS BY INVOICE ──────────────────────────────────────────────────
// Dedicated endpoint: GET /payments/invoice/:invoiceId
// Returns payment history for one specific invoice
export const getPaymentsByInvoice = asyncHandler(async (req, res) => {
  const { invoiceId } = req.params;

  // Verify invoice belongs to this user before showing its payments
  const invoice = await Invoice.findOne({
    _id: invoiceId,
    user: req.user._id,
  }).select("invoiceNumber total amountPaid status");

  if (!invoice) {
    throw new ApiError(404, "Invoice not found");
  }

  const payments = await Payment.find({ invoice: invoiceId })
    .sort({ paymentDate: -1 })
    .lean();

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        invoice,
        payments,
        summary: {
          totalPayments: payments.length,
          totalPaid: invoice.amountPaid,
          balance: parseFloat(
            (invoice.total - invoice.amountPaid).toFixed(2)
          ),
        },
      },
      "Payment history fetched successfully"
    )
  );
});

// ─── GET PAYMENT BY ID ────────────────────────────────────────────────────────
export const getPaymentById = asyncHandler(async (req, res) => {
  const payment = await Payment.findOne({
    _id: req.params.id,
    user: req.user._id,
  }).populate("invoice", "invoiceNumber total status client");

  if (!payment) {
    throw new ApiError(404, "Payment not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, payment, "Payment fetched successfully"));
});

// ─── UPDATE PAYMENT ───────────────────────────────────────────────────────────
export const updatePayment = asyncHandler(async (req, res) => {
  const payment = await Payment.findOne({
    _id: req.params.id,
    user: req.user._id,
  });

  if (!payment) {
    throw new ApiError(404, "Payment not found");
  }

  // If amount is being changed, re-validate overpayment
  if (req.body.amount !== undefined) {
    const invoice = await Invoice.findById(payment.invoice);

    // balance excluding THIS payment's current contribution
    // WHY exclude current: if payment was 5000, and we're changing to 6000,
    // the "available balance" should include the current 5000 being replaced
    const balanceExcludingThis = parseFloat(
      (invoice.total - invoice.amountPaid + payment.amount).toFixed(2)
    );

    if (req.body.amount > balanceExcludingThis) {
      throw new ApiError(
        400,
        `Updated amount (${req.body.amount}) exceeds available balance (${balanceExcludingThis})`
      );
    }
  }

  // Apply updates
  Object.assign(payment, req.body);
  await payment.save();

  // Recalculate invoice status after amount change
  const updatedInvoice = await updateInvoicePaymentStatus(payment.invoice);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        payment,
        invoice: {
          _id: updatedInvoice._id,
          invoiceNumber: updatedInvoice.invoiceNumber,
          status: updatedInvoice.status,
          amountPaid: updatedInvoice.amountPaid,
          balance: updatedInvoice.balance,
        },
      },
      "Payment updated successfully"
    )
  );
});

// ─── DELETE PAYMENT ───────────────────────────────────────────────────────────
export const deletePayment = asyncHandler(async (req, res) => {
  const payment = await Payment.findOne({
    _id: req.params.id,
    user: req.user._id,
  });

  if (!payment) {
    throw new ApiError(404, "Payment not found");
  }

  // Store invoiceId before deleting — needed for recalculation
  const invoiceId = payment.invoice;

  await Payment.findByIdAndDelete(req.params.id);

  // Recalculate from scratch — this payment no longer exists
  // The aggregate in updateInvoicePaymentStatus will now exclude it
  const updatedInvoice = await updateInvoicePaymentStatus(invoiceId);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        invoice: {
          _id: updatedInvoice._id,
          invoiceNumber: updatedInvoice.invoiceNumber,
          status: updatedInvoice.status,
          amountPaid: updatedInvoice.amountPaid,
          balance: updatedInvoice.balance,
        },
      },
      "Payment deleted and invoice balance updated"
    )
  );
});

// ─── PAYMENT SUMMARY (for dashboard) ─────────────────────────────────────────
export const getPaymentStats = asyncHandler(async (req, res) => {
  const stats = await Payment.aggregate([
    // Only this user's payments
    { $match: { user: new mongoose.Types.ObjectId(req.user._id) } },

    {
      $group: {
        _id: null,
        totalReceived: { $sum: "$amount" },
        totalPayments: { $sum: 1 },
        // Group amounts by payment method for the breakdown chart
        cashTotal: {
          $sum: {
            $cond: [{ $eq: ["$method", "cash"] }, "$amount", 0],
          },
        },
        upiTotal: {
          $sum: {
            $cond: [{ $eq: ["$method", "upi"] }, "$amount", 0],
          },
        },
        bankTotal: {
          $sum: {
            $cond: [{ $eq: ["$method", "bank_transfer"] }, "$amount", 0],
          },
        },
        cardTotal: {
          $sum: {
            $cond: [{ $eq: ["$method", "card"] }, "$amount", 0],
          },
        },
      },
    },
    { $project: { _id: 0 } },
  ]);

  // Monthly revenue for chart — last 6 months
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const monthlyStats = await Payment.aggregate([
    {
      $match: {
        user: new mongoose.Types.ObjectId(req.user._id),
        paymentDate: { $gte: sixMonthsAgo },
      },
    },
    {
      $group: {
        // Group by year + month
        _id: {
          year: { $year: "$paymentDate" },
          month: { $month: "$paymentDate" },
        },
        revenue: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
    // Sort chronologically
    { $sort: { "_id.year": 1, "_id.month": 1 } },
    {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        revenue: 1,
        count: 1,
      },
    },
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        summary: stats[0] || {
          totalReceived: 0,
          totalPayments: 0,
          cashTotal: 0,
          upiTotal: 0,
          bankTotal: 0,
          cardTotal: 0,
        },
        monthlyRevenue: monthlyStats,
      },
      "Payment stats fetched successfully"
    )
  );
});