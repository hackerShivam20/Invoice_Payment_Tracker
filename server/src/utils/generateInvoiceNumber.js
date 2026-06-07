import { Invoice } from "../models/Invoice.model.js";

// WHY auto-generate instead of letting users type it:
// Manual entry causes duplicates, inconsistent formats, human errors.
// Auto-generation guarantees uniqueness and a professional format.
//
// Format: INV-{YEAR}-{4-digit-sequence}
// Examples: INV-2024-0001, INV-2024-0042, INV-2025-0001
// WHY reset per year: matches how real accounting works.
// Every new financial year starts fresh — easier for GST filing and audits.

const generateInvoiceNumber = async (userId) => {
  const currentYear = new Date().getFullYear();

  // Find the last invoice THIS user created THIS year.
  // WHY filter by user: each user has their own numbering sequence.
  // User A's INV-2024-0005 and User B's INV-2024-0005 can coexist.
  const lastInvoice = await Invoice.findOne({
    user: userId,
    // invoiceNumber contains the year — regex match is the cleanest filter
    invoiceNumber: { $regex: `^INV-${currentYear}-` },
  })
    // Sort descending — most recent invoice first
    .sort({ createdAt: -1 })
    // Only need the invoiceNumber field, not the whole document
    .select("invoiceNumber")
    .lean();

  let nextNumber = 1; // default: first invoice of the year

  if (lastInvoice) {
    // Parse the sequence number from "INV-2024-0042" → 42
    const parts = lastInvoice.invoiceNumber.split("-");
    const lastSequence = parseInt(parts[2], 10);
    nextNumber = lastSequence + 1;
  }

  // padStart(4, "0") formats: 1 → "0001", 42 → "0042", 1000 → "1000"
  // WHY 4 digits: supports up to 9999 invoices per year per user.
  // Most freelancers and small businesses never exceed 500/year.
  const paddedNumber = String(nextNumber).padStart(4, "0");

  return `INV-${currentYear}-${paddedNumber}`;
};

export { generateInvoiceNumber };