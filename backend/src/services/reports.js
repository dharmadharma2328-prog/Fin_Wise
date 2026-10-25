const { ApiError } = require("../middleware/errors");
const { isDate } = require("../middleware/validate");

async function getTransactionReport(client, userId, { start, end }) {
  if (!isDate(start) || !isDate(end) || start >= end) {
    throw new ApiError(400, "Provide valid start and exclusive end dates.", "INVALID_DATE_RANGE");
  }

  const { data, error, count } = await client
    .from("transactions")
    .select("id,type,amount_paise,category,date,description,payment_method,notes,created_at", { count: "exact" })
    .eq("user_id", userId)
    .gte("date", start)
    .lt("date", end)
    .order("date", { ascending: false })
    .limit(10000);

  if (error) throw new ApiError(500, "Could not load report transactions.", "REPORT_QUERY_FAILED");
  if ((data || []).length < (count || 0)) {
    throw new ApiError(422, "This report contains too many transactions to summarize in one request.", "REPORT_RESULT_LIMIT");
  }

  const transactions = data || [];
  const incomePaise = transactions
    .filter((item) => item.type === "income")
    .reduce((sum, item) => sum + item.amount_paise, 0);
  const expensesPaise = transactions
    .filter((item) => item.type === "expense")
    .reduce((sum, item) => sum + item.amount_paise, 0);
  const categories = new Map();

  for (const transaction of transactions) {
    if (transaction.type !== "expense") continue;
    categories.set(transaction.category, (categories.get(transaction.category) || 0) + transaction.amount_paise);
  }

  return {
    period: { start, end_exclusive: end },
    income_paise: incomePaise,
    expenses_paise: expensesPaise,
    net_cash_flow_paise: incomePaise - expensesPaise,
    savings_rate_percent: incomePaise > 0
      ? ((incomePaise - expensesPaise) / incomePaise) * 100
      : null,
    categories: [...categories.entries()]
      .map(([category, amountPaise]) => ({ category, amount_paise: amountPaise }))
      .sort((a, b) => b.amount_paise - a.amount_paise),
    transactions
  };
}

module.exports = { getTransactionReport };
