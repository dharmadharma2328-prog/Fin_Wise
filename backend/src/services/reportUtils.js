const { ApiError } = require("../middleware/errors");
const { isDate } = require("../middleware/validate");

function getRange(query) {
  if (query.start || query.end) {
    return { start: query.start, end: query.end };
  }
  const month = Number(query.month);
  const year = Number(query.year);
  if (!Number.isInteger(month) || month < 1 || month > 12 ||
      !Number.isInteger(year) || year < 2000 || year > 2200) {
    throw new ApiError(400, "Supply a valid month and year, or start and end dates.", "INVALID_PERIOD");
  }
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  return { start, end };
}

function escapeCsvField(value) {
  let text = String(value ?? "").replace(/[\r\n]+/g, " ");
  if (/^[\t ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function validateDateRange(start, end) {
  if (!isDate(start) || !isDate(end) || start >= end) {
    throw new ApiError(400, "Provide valid start and exclusive end dates.", "INVALID_DATE_RANGE");
  }
}

module.exports = { getRange, escapeCsvField, validateDateRange };
