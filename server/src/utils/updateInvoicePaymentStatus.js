import { Payment } from "../models/Payment.model.js";
import { Invoice } from "../models/Invoice.model.js";

// WHY a separate utility:
// Both recording AND deleting a payment need to:
// 1. Recalculate amountPaid from scratch
// 2. Save the invoice (triggering the status engine)
// Putting this logic in one place means one fix fixes both operations.

const updateInvoicePaymentStatus = async (invoiceId) => {
  // Recalculate amountPaid by summing ALL payments for this invoice.
  // WHY recalculate from scratch instead of += or -=:
  // Running totals drift over time — if a payment was edited or
  // deleted incorrectly, the total would be wrong forever.
  // Recalculating from the ground truth (all payments) self-corrects
  // any inconsistency. This is called "reconciliation".
  const result = await Payment.aggregate([
    {
      // Stage 1: filter only payments for this invoice
      $match: { invoice: invoiceId },
    },
    {
      // Stage 2: sum all payment amounts into one number
      $group: {
        _id: null,
        totalPaid: { $sum: "$amount" },
      },
    },
  ]);

  // If no payments exist, totalPaid = 0
  const totalPaid = result[0]?.totalPaid || 0;

  // Fetch the invoice and update amountPaid
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) return null;

  invoice.amountPaid = parseFloat(totalPaid.toFixed(2));

  // invoice.save() triggers both pre-save hooks:
  // 1. Total calculation (if items changed — they haven't here, but hook is safe)
  // 2. Status engine — automatically sets paid/partial/overdue based on amountPaid
  await invoice.save();

  return invoice;
};

export { updateInvoicePaymentStatus };