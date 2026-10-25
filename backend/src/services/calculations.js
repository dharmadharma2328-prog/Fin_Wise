function calculateLoan({ principalPaise, annualRatePercent, months, extraMonthlyPaise = 0 }) {
  if (!Number.isSafeInteger(principalPaise) || principalPaise <= 0 ||
      !Number.isFinite(annualRatePercent) || annualRatePercent < 0 || annualRatePercent > 100 ||
      !Number.isInteger(months) || months <= 0 || months > 600 ||
      !Number.isSafeInteger(extraMonthlyPaise) || extraMonthlyPaise < 0) {
    return null;
  }

  const monthlyRate = annualRatePercent / 1200;
  const emiPaise = monthlyRate === 0
    ? principalPaise / months
    : principalPaise * monthlyRate * (1 + monthlyRate) ** months /
      ((1 + monthlyRate) ** months - 1);

  let balance = principalPaise;
  let totalInterestPaise = 0;
  let totalPaymentPaise = 0;
  let periods = 0;

  while (balance > 0 && periods < months) {
    const interest = Math.round(balance * monthlyRate);
    const payment = Math.min(balance + interest, Math.round(emiPaise) + extraMonthlyPaise);
    balance = Math.max(0, balance + interest - payment);
    totalInterestPaise += interest;
    totalPaymentPaise += payment;
    periods += 1;
  }

  return {
    emi_paise: Math.round(emiPaise),
    total_payment_paise: totalPaymentPaise,
    total_interest_paise: totalInterestPaise,
    payoff_months: periods
  };
}

module.exports = { calculateLoan };
