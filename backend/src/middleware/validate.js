const { ApiError } = require("./errors");

function requireObjectBody(req, res, next) {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return next(new ApiError(400, "Request body must be a JSON object.", "INVALID_BODY"));
  }
  next();
}

function validateTransaction(req, res, next) {
  const { type, amount_paise, category, date, description, payment_method, notes } = req.body;
  if (!["income", "expense"].includes(type)) {
    return next(new ApiError(400, "Type must be income or expense.", "INVALID_TYPE"));
  }
  if (!Number.isSafeInteger(amount_paise) || amount_paise <= 0) {
    return next(new ApiError(400, "Amount must be a positive integer number of paise.", "INVALID_AMOUNT"));
  }
  if (typeof category !== "string" || !category.trim() || category.trim().length > 80) {
    return next(new ApiError(400, "Category is required and must be at most 80 characters.", "INVALID_CATEGORY"));
  }
  if (!isDate(date)) {
    return next(new ApiError(400, "Date must be a valid YYYY-MM-DD date.", "INVALID_DATE"));
  }
  if (description !== undefined && (typeof description !== "string" || description.length > 240)) {
    return next(new ApiError(400, "Description must be at most 240 characters.", "INVALID_DESCRIPTION"));
  }
  if (notes !== undefined && (typeof notes !== "string" || notes.length > 2000)) {
    return next(new ApiError(400, "Notes must be at most 2000 characters.", "INVALID_NOTES"));
  }
  if (payment_method !== undefined && !["Cash", "Bank transfer", "Card", "UPI", "Other"].includes(payment_method)) {
    return next(new ApiError(400, "Payment method is not supported.", "INVALID_PAYMENT_METHOD"));
  }
  next();
}

function validateBudget(req, res, next) {
  const { category, month, year, limit_paise } = req.body;
  if (typeof category !== "string" || !category.trim() || category.trim().length > 80) {
    return next(new ApiError(400, "Category is required and must be at most 80 characters.", "INVALID_CATEGORY"));
  }
  if (!Number.isInteger(month) || month < 1 || month > 12 ||
      !Number.isInteger(year) || year < 2000 || year > 2200) {
    return next(new ApiError(400, "Month must be 1-12 and year must be valid.", "INVALID_PERIOD"));
  }
  if (!Number.isSafeInteger(limit_paise) || limit_paise < 0) {
    return next(new ApiError(400, "Budget limit must be a non-negative integer number of paise.", "INVALID_AMOUNT"));
  }
  next();
}

function validateGoal(req, res, next) {
  const { name, target_paise, current_paise, target_date, notes, status } = req.body;
  if (typeof name !== "string" || !name.trim() || name.trim().length > 100) {
    return next(new ApiError(400, "Goal name is required and must be at most 100 characters.", "INVALID_NAME"));
  }
  if (!Number.isSafeInteger(target_paise) || target_paise <= 0 ||
      !Number.isSafeInteger(current_paise) || current_paise < 0) {
    return next(new ApiError(400, "Goal amounts must be valid integer paise amounts.", "INVALID_AMOUNT"));
  }
  if (!isDate(target_date)) {
    return next(new ApiError(400, "Target date must be a valid YYYY-MM-DD date.", "INVALID_DATE"));
  }
  if (notes !== undefined && (typeof notes !== "string" || notes.length > 2000)) {
    return next(new ApiError(400, "Notes must be at most 2000 characters.", "INVALID_NOTES"));
  }
  if (status !== undefined && !["active", "completed", "archived"].includes(status)) {
    return next(new ApiError(400, "Goal status is not supported.", "INVALID_STATUS"));
  }
  next();
}

function validateBill(req, res, next) {
  const { name, amount_paise, due_date, category, recurrence } = req.body;
  if (typeof name !== "string" || !name.trim() || name.trim().length > 120) {
    return next(new ApiError(400, "Bill name is required and must be at most 120 characters.", "INVALID_NAME"));
  }
  if (!Number.isSafeInteger(amount_paise) || amount_paise <= 0) {
    return next(new ApiError(400, "Bill amount must be a positive integer number of paise.", "INVALID_AMOUNT"));
  }
  if (!isDate(due_date)) {
    return next(new ApiError(400, "Due date must be a valid YYYY-MM-DD date.", "INVALID_DATE"));
  }
  if (category !== undefined && (typeof category !== "string" || category.length > 80)) {
    return next(new ApiError(400, "Category must be at most 80 characters.", "INVALID_CATEGORY"));
  }
  if (!["one-time", "weekly", "monthly", "yearly"].includes(recurrence)) {
    return next(new ApiError(400, "Recurrence is not supported.", "INVALID_RECURRENCE"));
  }
  next();
}

function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

module.exports = {
  requireObjectBody,
  validateTransaction,
  validateBudget,
  validateGoal,
  validateBill,
  isDate
};
