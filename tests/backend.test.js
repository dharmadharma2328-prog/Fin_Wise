const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateLoan } = require("../backend/src/services/calculations");
const { isDate } = require("../backend/src/middleware/validate");
const { escapeCsvField, getRange } = require("../backend/src/services/reportUtils");

test("calculates a fixed-rate EMI and reconciles payment totals", () => {
  const result = calculateLoan({
    principalPaise: 50000000,
    annualRatePercent: 8.5,
    months: 60
  });

  assert.equal(result.payoff_months, 60);
  assert.ok(Math.abs(result.emi_paise - 1025827) < 100);
  assert.ok(Math.abs(result.total_payment_paise - (result.total_interest_paise + 50000000)) < 100);
});

test("handles zero interest and extra payments with early payoff", () => {
  const zeroInterest = calculateLoan({
    principalPaise: 10000000,
    annualRatePercent: 0,
    months: 10,
    extraMonthlyPaise: 100000
  });
  const prepayment = calculateLoan({
    principalPaise: 50000000,
    annualRatePercent: 8.5,
    months: 60,
    extraMonthlyPaise: 500000
  });

  assert.equal(zeroInterest.total_interest_paise, 0);
  assert.equal(zeroInterest.payoff_months, 10);
  assert.ok(prepayment.payoff_months < 60);
  assert.ok(prepayment.total_payment_paise < 61550000);
});

test("rejects invalid loan input", () => {
  assert.equal(calculateLoan({
    principalPaise: 1000,
    annualRatePercent: -1,
    months: 12
  }), null);
});

test("validates strict calendar dates", () => {
  assert.equal(isDate("2024-02-29"), true);
  assert.equal(isDate("2025-02-29"), false);
  assert.equal(isDate("2025-13-01"), false);
});

test("creates month reports with an exclusive first day of next month", () => {
  assert.deepEqual(getRange({ month: "12", year: "2026" }), {
    start: "2026-12-01",
    end: "2027-01-01"
  });
  assert.throws(() => getRange({ month: "13", year: "2026" }), { code: "INVALID_PERIOD" });
});

test("protects CSV cells from formula injection and quotes content", () => {
  assert.equal(escapeCsvField("=1+1"), "\"'=1+1\"");
  assert.equal(escapeCsvField("Food, \"Market\""), "\"Food, \"\"Market\"\"\"");
});
