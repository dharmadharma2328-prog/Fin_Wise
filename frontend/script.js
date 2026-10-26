const STORAGE_KEY = "finwise_data_v1";
const LEGACY_KEY = "finance_data";
let stateSyncQueue = Promise.resolve();
let currentUser = null;
const rupee = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});

function qs(selector) {
  return document.querySelector(selector);
}

function qsa(selector) {
  return [...document.querySelectorAll(selector)];
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>\"']/g, (match) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[match]);
}

function formatMoney(value) {
  return rupee.format(Number(value) || 0);
}

function parseAmountInput(value) {
  return Number(String(value ?? "").replace(/,/g, "")) || 0;
}

function formatAmountInput(value) {
  const sanitized = String(value).replace(/[^\d.]/g, "");
  const decimalIndex = sanitized.indexOf(".");
  let integer = decimalIndex === -1 ? sanitized : sanitized.slice(0, decimalIndex);
  const fraction = decimalIndex === -1
    ? null
    : sanitized.slice(decimalIndex + 1).replace(/\./g, "").slice(0, 2);
  integer = integer.replace(/^0+(?=\d)/, "");
  const lastThreeDigits = integer.slice(-3);
  const leadingDigits = integer.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  const groupedInteger = leadingDigits && lastThreeDigits
    ? `${leadingDigits},${lastThreeDigits}`
    : leadingDigits || lastThreeDigits;
  return fraction === null ? groupedInteger : `${groupedInteger || "0"}.${fraction}`;
}

function handleAmountInput(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.matches("[data-money-input]")) return;

  const ungroupedValue = input.value.replace(/,/g, "");
  let charactersBeforeCaret = input.value.slice(0, input.selectionStart).replace(/,/g, "").length;
  if (ungroupedValue.startsWith(".") && charactersBeforeCaret > 0) charactersBeforeCaret += 1;
  input.value = formatAmountInput(input.value);
  let caret = 0;
  let charactersPassed = 0;
  while (caret < input.value.length && charactersPassed < charactersBeforeCaret) {
    if (input.value[caret] !== ",") charactersPassed += 1;
    caret += 1;
  }
  input.setSelectionRange(caret, caret);
}

document.addEventListener("input", handleAmountInput);

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast-message";
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("is-visible"));
  setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => toast.remove(), 250);
  }, 2600);
}

function generateId(prefix = "item") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function toDateString(dateValue) {
  if (!dateValue) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateValue))) return String(dateValue);
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(dateValue) {
  if (!dateValue) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateValue));
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(dateValue);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDefaultState() {
  return {
    income: 0,
    expenses: [],
    transactions: [],
    budgets: [],
    goals: [],
    bills: [],
    billPayments: [],
    retirement: {
      age: 0,
      retirementAge: 0,
      targetAmount: 0,
      annualReturn: 12
    },
    goalName: "",
    goalAmount: 0,
    goalYears: 0,
    retAge: 0,
    retTargetAge: 0,
    retTargetAmt: 0
  };
}

function normalizeState(raw = {}) {
  const base = getDefaultState();
  const state = { ...base, ...raw };

  state.expenses = Array.isArray(raw.expenses) ? raw.expenses : [];
  state.transactions = Array.isArray(raw.transactions) ? raw.transactions : [];
  state.budgets = Array.isArray(raw.budgets) ? raw.budgets : [];
  state.goals = Array.isArray(raw.goals) ? raw.goals : [];
  state.bills = Array.isArray(raw.bills) ? raw.bills : [];
  state.billPayments = Array.isArray(raw.billPayments) ? raw.billPayments : [];

  if (!state.retirement || typeof state.retirement !== "object") {
    state.retirement = { ...base.retirement };
  }

  if (state.transactions.length === 0 && Array.isArray(raw.expenses) && raw.expenses.length) {
    state.transactions = raw.expenses.map((item, index) => ({
      id: `legacy-expense-${index}`,
      type: "expense",
      category: item.name || "General",
      amount: Number(item.amount) || 0,
      date: new Date().toISOString().split("T")[0],
      description: item.name || "Expense",
      paymentMethod: "Other",
      notes: "" 
    }));
  }

  if (Number(raw.income) > 0 && !state.transactions.some((item) => item.id === "legacy-plan-income")) {
    state.transactions.push({
      id: "legacy-plan-income",
      type: "income",
      category: "Monthly income",
      amount: Number(raw.income),
      date: toDateString(new Date()),
      description: "Monthly income plan",
      paymentMethod: "Other",
      notes: ""
    });
  }

  if (state.goals.length === 0 && raw.goalName && Number(raw.goalAmount) > 0) {
    const targetDate = new Date();
    targetDate.setFullYear(targetDate.getFullYear() + Math.max(1, Number(raw.goalYears) || 1));
    state.goals = [{
      id: "legacy-goal",
      name: raw.goalName,
      targetAmount: Number(raw.goalAmount),
      currentSaved: 0,
      targetDate: toDateString(targetDate)
    }];
  }

  return state;
}

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY) || "{}");
    return normalizeState(raw);
  } catch (error) {
    console.error("Unable to read saved FinWise data.", error);
    return getDefaultState();
  }
}

function writeLocalState(state) {
  const safe = normalizeState(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));

  const legacy = {
    income: Number(safe.income) || 0,
    expenses: (safe.expenses || []).map((item) => ({
      name: item.name || item.category || item.description || "Expense",
      amount: Number(item.amount) || 0
    })),
    goalName: safe.goals[0]?.name || safe.goalName || "",
    goalAmount: Number(safe.goals[0]?.targetAmount || safe.goalAmount || 0),
    goalYears: Number(safe.goalYears || 0),
    retAge: Number(safe.retirement?.age || safe.retAge || 0),
    retTargetAge: Number(safe.retirement?.retirementAge || safe.retTargetAge || 0),
    retTargetAmt: Number(safe.retirement?.targetAmount || safe.retTargetAmt || 0)
  };

  localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
  return safe;
}

function persistState(state) {
  const safe = writeLocalState(state);
  const savePromise = stateSyncQueue.then(async () => {
    const response = await fetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: safe })
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error?.message || `Database save failed (${response.status}).`);
    }
  });
  stateSyncQueue = savePromise.catch((error) => {
    console.error("Unable to save FinWise data to the local database.", error);
    showToast("Database save failed. Your browser copy is still available.");
  });
  return savePromise.then(() => true, () => false);
}

async function clearDatabaseState() {
  await stateSyncQueue;
  const response = await fetch("/api/state", { method: "DELETE" });
  if (!response.ok) throw new Error(`Database clear failed (${response.status}).`);
}

function getMonthSummary(state, month = new Date().getMonth(), year = new Date().getFullYear()) {
  const filtered = (state.transactions || []).filter((transaction) => {
    const date = parseLocalDate(transaction.date);
    if (!date) return false;
    return date.getMonth() === month && date.getFullYear() === year;
  });

  const income = filtered.filter((item) => item.type === "income").reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const expenses = filtered.filter((item) => item.type === "expense").reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const net = income - expenses;
  const rate = income > 0 ? (net / income) * 100 : null;

  const categoryMap = {};
  filtered.filter((item) => item.type === "expense").forEach((item) => {
    const key = (item.category || "Other").trim() || "Other";
    categoryMap[key] = (categoryMap[key] || 0) + (Number(item.amount) || 0);
  });

  const categories = Object.entries(categoryMap).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);

  return { filtered, income, expenses, net, rate, categories };
}

function renderEmptyState(element, message) {
  if (!element) return;
  element.innerHTML = `<p class="empty-state">${escapeHtml(message)}</p>`;
}

async function initPage() {
  try {
    const authResponse = await fetch("/api/auth/me");
    if (!authResponse.ok) {
      if (authResponse.status === 401) window.location.replace("/login.html");
      else throw new Error(`Account check failed (${authResponse.status}).`);
      return;
    }
    currentUser = (await authResponse.json()).user;
    addAccountControls();

    const response = await fetch("/api/state");
    if (!response.ok) throw new Error(`Database load failed (${response.status}).`);
    const result = await response.json();
    const state = result.state ? normalizeState(result.state) : getDefaultState();
    writeLocalState(state);
    if (!result.state && !await persistState(state)) return;
  } catch (error) {
    console.error("Unable to load FinWise data from the local database.", error);
    showToast("Database unavailable. Changes may not be saved.");
  }

  qsa("[data-money-input]").forEach((input) => {
    input.value = formatAmountInput(input.value);
  });

  const page = document.body.dataset.page;
  if (page === "landing") initLanding();
  if (page === "inputs") initInputs();
  if (page === "dashboard") initDashboard();
  if (page === "transactions") initTransactions();
  if (page === "budgets") initBudgets();
  if (page === "goals") initGoals();
  if (page === "bills") initBills();
  if (page === "reports") initReports();
  if (page === "loans") initLoans();
  if (page === "ai") initAi();
}

function addAccountControls() {
  const navigation = qs(".topnav") || qs(".nav-links");
  if (!navigation || !currentUser) return;

  const deleteAccount = document.createElement("button");
  deleteAccount.type = "button";
  deleteAccount.className = "btn btn-ghost account-delete";
  deleteAccount.textContent = "Delete account";
  deleteAccount.setAttribute("aria-label", "Delete your FinWise account and its data");
  deleteAccount.addEventListener("click", async () => {
    const confirmed = window.confirm(
      `Permanently delete the FinWise account for ${currentUser.email} and all its locally stored finance data? This cannot be undone.`
    );
    if (!confirmed) return;
    if (window.prompt('Type DELETE to permanently remove your account and data.') !== "DELETE") {
      showToast("Account deletion was cancelled.");
      return;
    }

    deleteAccount.disabled = true;
    try {
      await stateSyncQueue;
      const response = await fetch("/api/auth/account", { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error?.message || `Account deletion failed (${response.status}).`);
      }
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_KEY);
      window.location.replace("/login.html");
    } catch (error) {
      console.error("Unable to delete the FinWise account.", error);
      showToast("Could not delete your account. Please try again.");
      deleteAccount.disabled = false;
    }
  });

  const signOut = document.createElement("button");
  signOut.type = "button";
  signOut.className = "btn btn-ghost account-signout";
  signOut.textContent = "Sign out";
  signOut.addEventListener("click", async () => {
    signOut.disabled = true;
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error(`Sign out failed (${response.status}).`);
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_KEY);
      window.location.replace("/login.html");
    } catch (error) {
      console.error("Unable to sign out of FinWise.", error);
      showToast("Could not sign out. Please try again.");
      signOut.disabled = false;
    }
  });
  navigation.append(deleteAccount, signOut);
}

document.addEventListener("DOMContentLoaded", initPage);

function initLanding() {
  const state = loadState();
  const today = new Date();
  const summary = getMonthSummary(state, today.getMonth(), today.getFullYear());
  const income = summary.income || Number(state.income) || 0;
  const expenses = summary.expenses || (state.expenses || []).reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
  const categories = summary.categories.length
    ? summary.categories
    : (state.expenses || [])
      .filter((expense) => expense.name && Number(expense.amount) > 0)
      .map((expense) => ({ name: expense.name, amount: Number(expense.amount) }));

  qs("#preview-month").textContent = today.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  qs("#preview-income").textContent = formatMoney(income);
  qs("#preview-expenses").textContent = formatMoney(expenses);

  const categoriesElement = qs("#preview-categories");
  const emptyMessage = qs("#preview-empty");
  if (categories.length) {
    categoriesElement.innerHTML = categories.slice(0, 4).map((item) => `
      <div class="preview-category">
        <span>${escapeHtml(item.name)}</span>
        <span>${formatMoney(item.amount)}</span>
      </div>
    `).join("");
    emptyMessage.hidden = true;
  } else {
    categoriesElement.innerHTML = "";
    emptyMessage.hidden = false;
  }
}

function initInputs() {
  const state = loadState();
  const incomeInput = qs("#income");
  const expenseList = qs("#expenses-list");

  if (incomeInput) incomeInput.value = formatAmountInput(String(state.income || ""));

  const legacyExpenses = state.expenses && state.expenses.length ? state.expenses : [{ name: "", amount: "" }];
  if (expenseList) {
    expenseList.innerHTML = "";
    legacyExpenses.forEach((expense) => addExpenseRow(expense.name || "", expense.amount || ""));
  }
  updateLiveTotal();

  if (qs("#goal-name")) qs("#goal-name").value = state.goalName || "";
  if (qs("#goal-amount")) qs("#goal-amount").value = formatAmountInput(String(state.goalAmount || ""));
  if (qs("#goal-years")) qs("#goal-years").value = state.goalYears || "";
  if (qs("#ret-age")) qs("#ret-age").value = state.retAge || state.retirement?.age || "";
  if (qs("#ret-target-age")) qs("#ret-target-age").value = state.retTargetAge || state.retirement?.retirementAge || "";
  if (qs("#ret-target-amt")) {
    qs("#ret-target-amt").value = formatAmountInput(String(state.retTargetAmt || state.retirement?.targetAmount || ""));
  }
  if (qs("#ret-return")) qs("#ret-return").value = state.retirement?.annualReturn ?? 12;

  qs("#add-exp")?.addEventListener("click", () => addExpenseRow());
  qsa(".remove-exp").forEach((button) => {
    button.onclick = () => {
      const row = button.closest(".expense-row");
      if (row) row.remove();
      updateLiveTotal();
    };
  });

  qs("#expenses-list")?.addEventListener("input", updateLiveTotal);

  qs("#save-and-go")?.addEventListener("click", async () => {
    const incomeValue = parseAmountInput(qs("#income")?.value);
    const goalAmount = parseAmountInput(qs("#goal-amount")?.value);
    const goalYears = Number(qs("#goal-years")?.value);
    const retirementAge = Number(qs("#ret-age")?.value);
    const retirementTargetAge = Number(qs("#ret-target-age")?.value);
    const retirementTarget = parseAmountInput(qs("#ret-target-amt")?.value);
    const retirementReturn = Number(qs("#ret-return")?.value);
    const sanitized = qsa(".expense-row").map((row) => ({
      name: row.querySelector(".exp-name")?.value.trim() || "",
      amount: parseAmountInput(row.querySelector(".exp-amt")?.value)
    })).filter((item) => item.name || item.amount > 0);

    if (!Number.isFinite(incomeValue) || incomeValue < 0 ||
        sanitized.some((item) => !Number.isFinite(item.amount) || item.amount < 0 || (item.amount > 0 && !item.name))) {
      alert("Enter a valid non-negative income and give each expense an amount and name.");
      return;
    }
    const goalHasValues = Boolean(qs("#goal-name")?.value.trim() || qs("#goal-amount")?.value || qs("#goal-years")?.value);
    if (goalHasValues && (!qs("#goal-name")?.value.trim() || goalAmount <= 0 || goalYears <= 0 ||
        !Number.isFinite(goalAmount) || !Number.isFinite(goalYears))) {
      alert("Complete all financial goal fields with a valid amount and duration, or leave them empty.");
      return;
    }
    const retirementHasValues = Boolean(qs("#ret-age")?.value || qs("#ret-target-age")?.value || qs("#ret-target-amt")?.value);
    if (retirementHasValues && (!Number.isInteger(retirementAge) || !Number.isInteger(retirementTargetAge) ||
        retirementAge < 1 || retirementTargetAge <= retirementAge || retirementTarget <= 0 ||
        !Number.isFinite(retirementTarget) || !Number.isFinite(retirementReturn) || retirementReturn < 0)) {
      alert("Enter a valid retirement age, a later retirement age, target corpus, and non-negative return assumption.");
      return;
    }

    const savedState = {
      ...loadState(),
      income: incomeValue,
      expenses: sanitized,
      goalName: qs("#goal-name")?.value.trim() || "",
      goalAmount: goalAmount || 0,
      goalYears: goalYears || 0,
      retAge: retirementAge || 0,
      retTargetAge: retirementTargetAge || 0,
      retTargetAmt: retirementTarget || 0,
      retirement: {
        age: retirementAge || 0,
        retirementAge: retirementTargetAge || 0,
        targetAmount: retirementTarget || 0,
        annualReturn: retirementReturn || 0
      }
    };

    const convertedTransactions = sanitized.filter((item) => item.name && item.amount).map((item, index) => ({
      id: `legacy-expense-${index}`,
      type: "expense",
      category: item.name,
      amount: item.amount,
      date: new Date().toISOString().split("T")[0],
      description: item.name,
      paymentMethod: "Other",
      notes: ""
    }));

    const existingTransactions = savedState.transactions || [];
    savedState.transactions = existingTransactions.filter((transaction) => !String(transaction.id).startsWith("legacy-expense-"));
    savedState.transactions.push(...convertedTransactions);
    if (savedState.income > 0) {
      savedState.transactions = savedState.transactions.filter((transaction) => transaction.id !== "legacy-plan-income");
      savedState.transactions.push({
        id: "legacy-plan-income",
        type: "income",
        category: "Monthly income",
        amount: savedState.income,
        date: toDateString(new Date()),
        description: "Monthly income plan",
        paymentMethod: "Other",
        notes: ""
      });
    } else {
      savedState.transactions = savedState.transactions.filter((transaction) => transaction.id !== "legacy-plan-income");
    }
    if (savedState.goalName && savedState.goalAmount > 0) {
      const goal = savedState.goals.find((item) => item.id === "legacy-goal");
      const targetDate = new Date();
      targetDate.setFullYear(targetDate.getFullYear() + Math.max(1, savedState.goalYears || 1));
      const legacyGoal = {
        id: "legacy-goal",
        name: savedState.goalName,
        targetAmount: savedState.goalAmount,
        currentSaved: 0,
        targetDate: toDateString(targetDate)
      };
      if (goal) Object.assign(goal, legacyGoal);
      else savedState.goals.push(legacyGoal);
    } else {
      savedState.goals = savedState.goals.filter((goal) => goal.id !== "legacy-goal");
    }
    if (!await persistState(savedState)) return;
    showToast("Data saved successfully!");
    window.location.href = "dashboard.html";
  });

  qs("#clear-all")?.addEventListener("click", async () => {
    try {
      await clearDatabaseState();
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_KEY);
      window.location.reload();
    } catch (error) {
      console.error("Unable to clear FinWise data.", error);
      showToast("Could not clear the local database.");
    }
  });

  qs("#btn-dashboard")?.addEventListener("click", () => {
    window.location.href = "dashboard.html";
  });
}

function updateLiveTotal() {
  const total = qsa(".exp-amt").reduce((sum, input) => sum + parseAmountInput(input.value), 0);
  const totalElement = qs("#live-total");
  if (totalElement) totalElement.textContent = `Total: ${formatMoney(total)}`;
}

function addExpenseRow(name = "", amount = "") {
  const row = document.createElement("div");
  row.className = "row g-2 mb-2 expense-row";
  row.innerHTML = `
    <div class="col-md-6">
      <input class="form-control exp-name" placeholder="Expense name" value="${escapeHtml(name)}">
    </div>
    <div class="col-md-4">
      <input class="form-control exp-amt" type="text" inputmode="decimal" data-money-input autocomplete="off" placeholder="Amount" value="${escapeHtml(formatAmountInput(String(amount)))}">
    </div>
    <div class="col-md-2">
      <button class="btn btn-danger remove-exp w-100" type="button" aria-label="Remove expense">Remove</button>
    </div>
  `;

  const list = qs("#expenses-list");
  if (list) {
    list.appendChild(row);
    row.querySelector(".remove-exp")?.addEventListener("click", () => {
      row.remove();
      updateLiveTotal();
    });
    row.querySelector(".exp-amt")?.addEventListener("input", updateLiveTotal);
  }
}

function initDashboard() {
  const state = loadState();
  const date = new Date();
  const summary = getMonthSummary(state, date.getMonth(), date.getFullYear());

  const incomeEl = qs("#show-income");
  const expenseEl = qs("#show-expenses");
  const savingsEl = qs("#show-savings");
  const rateEl = qs("#show-rate");

  if (incomeEl) incomeEl.textContent = formatMoney(summary.income);
  if (expenseEl) expenseEl.textContent = formatMoney(summary.expenses);
  if (savingsEl) savingsEl.textContent = formatMoney(summary.net);
  if (rateEl) rateEl.textContent = summary.rate === null ? "Unavailable" : `${summary.rate.toFixed(1)}%`;

  qs("#btn-edit")?.addEventListener("click", () => {
    window.location.href = "inputs.html";
  });

  const ctx = qs("#expChart")?.getContext("2d");
  if (ctx && summary.categories.length && typeof Chart !== "undefined") {
    new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: summary.categories.map((item) => item.name),
        datasets: [{
          data: summary.categories.map((item) => item.amount),
          backgroundColor: summary.categories.map((_, index) => ["#27624f", "#5b806f", "#91a99d", "#b7c6bf", "#d1dbd5"][index % 5])
        }]
      },
      options: { plugins: { legend: { labels: { color: "#18312a" } } } }
    });
  } else if (ctx && summary.categories.length) {
    const wrapper = qs("#expense-breakdown");
    const description = summary.categories.map((item) => `${item.name}: ${formatMoney(item.amount)}`).join("; ");
    if (wrapper) wrapper.insertAdjacentHTML("beforeend", `<p class="empty-state mt-3">${escapeHtml(description)}</p>`);
  } else if (qs("#expChart")) {
    const wrapper = qs("#expense-breakdown");
    if (wrapper) wrapper.insertAdjacentHTML("beforeend", "<p class='empty-state mt-3'>No spending data for this month yet.</p>");
  }

  const budgetSummary = qs("#budget-summary");
  if (budgetSummary) {
    const monthBudgets = state.budgets.filter((item) => Number(item.month) === date.getMonth() + 1 && Number(item.year) === date.getFullYear());
    if (!monthBudgets.length) {
      budgetSummary.innerHTML = '<p class="empty-state">No budgets set for this month.</p>';
    } else {
      budgetSummary.innerHTML = monthBudgets.map((budget) => {
        const spent = getBudgetSpent(state, budget.category, budget.month, budget.year);
        const remaining = (Number(budget.limit) || 0) - spent;
        const utilization = (Number(budget.limit) || 0) > 0 ? (spent / Number(budget.limit)) * 100 : 0;
        const alertClass = spent > Number(budget.limit) ? "danger" : "ok";
        return `
          <div class="mini-budget ${alertClass}">
            <div class="d-flex justify-content-between"><strong>${escapeHtml(budget.category)}</strong><span>${formatMoney(spent)}</span></div>
            <div class="progress mt-2"><div class="progress-bar" style="width:${Math.min(utilization, 100)}%"></div></div>
            <small>${formatMoney(remaining)} remaining • ${utilization.toFixed(0)}% used</small>
          </div>
        `;
      }).join("");
    }
  }

  const goalSummary = qs("#goal-summary");
  if (goalSummary) {
    if (state.goals.length === 0) {
      renderEmptyState(goalSummary, "No savings goals yet.");
    } else {
      goalSummary.innerHTML = state.goals.slice(0, 2).map((goal) => {
        const progress = Number(goal.targetAmount) > 0 ? ((Number(goal.currentSaved) || 0) / Number(goal.targetAmount)) * 100 : 0;
        const remaining = Math.max(0, (Number(goal.targetAmount) || 0) - (Number(goal.currentSaved) || 0));
        const months = getMonthsRemaining(goal.targetDate);
        const required = months > 0 ? Math.ceil(remaining / months) : 0;
        const goalDate = parseLocalDate(goal.targetDate);
        const status = remaining <= 0 ? "Completed" : (goalDate && goalDate < startOfToday() ? "Overdue" : "On track");
        return `
          <div class="goal-card">
            <div class="d-flex justify-content-between"><strong>${escapeHtml(goal.name)}</strong><span>${status}</span></div>
            <div class="progress mt-2"><div class="progress-bar" style="width:${Math.min(progress, 100)}%"></div></div>
            <small>${formatMoney(goal.currentSaved || 0)} / ${formatMoney(goal.targetAmount || 0)} • ${remaining > 0 ? `${formatMoney(remaining)} left` : "Goal reached"}</small>
            <small class="d-block mt-1">Required monthly saving: ${required ? formatMoney(required) : "₹0"}</small>
          </div>
        `;
      }).join("");
    }
  }

  const retirementSummary = qs("#retire-summary");
  const retirement = state.retirement || {};
  if (retirementSummary) {
    const age = Number(retirement.age || state.retAge || 0);
    const retirementAge = Number(retirement.retirementAge || state.retTargetAge || 0);
    const target = Number(retirement.targetAmount || state.retTargetAmt || 0);
    if (age && retirementAge && target && retirementAge > age) {
      const years = retirementAge - age;
      const annualReturn = Number(retirement.annualReturn ?? 12);
      const rate = annualReturn / 100 / 12;
      const months = years * 12;
      const monthlyPayment = rate > 0 ? (target * rate) / (Math.pow(1 + rate, months) - 1) : target / months;
      retirementSummary.innerHTML = `
        <p>Target corpus: <b>${formatMoney(target)}</b></p>
        <p>Years remaining: <b>${years}</b></p>
        <p>Assumed return: <b>${annualReturn.toFixed(1)}%</b> per year</p>
        <p>Projection only, not a guaranteed return.</p>
        <p>Required monthly SIP: <b>${formatMoney(Math.ceil(monthlyPayment))}</b></p>
      `;
    } else {
      retirementSummary.innerHTML = '<p class="empty-state">Set your retirement inputs to estimate a goal.</p>';
    }
  }

  const billsSummary = qs("#bills-summary");
  if (billsSummary) {
    const bills = (state.bills || []).filter((bill) => !bill.paid).sort((a, b) => (parseLocalDate(a.dueDate)?.getTime() || 0) - (parseLocalDate(b.dueDate)?.getTime() || 0)).slice(0, 3);
    if (!bills.length) {
      renderEmptyState(billsSummary, "No upcoming bills.");
    } else {
      billsSummary.innerHTML = bills.map((bill) => {
        const due = parseLocalDate(bill.dueDate);
        if (!due) return "";
        const isOverdue = due < startOfToday() && !bill.paid;
        const tag = isOverdue ? "Overdue" : "Due soon";
        return `<div class="list-item"><strong>${escapeHtml(bill.name)}</strong><span class="status-badge ${isOverdue ? "warn" : "ok"}">${tag}</span><small>${due.toLocaleDateString("en-IN")} • ${formatMoney(bill.amount)}</small></div>`;
      }).join("");
    }
  }

  const aiSummary = qs("#ai-summary");
  if (aiSummary) {
    const insight = generateAssistantInsight(state, date.getMonth(), date.getFullYear());
    aiSummary.innerHTML = `<p>${escapeHtml(insight)}</p>`;
  }

  qs("#clear-storage")?.addEventListener("click", async () => {
    try {
      await clearDatabaseState();
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_KEY);
      window.location.href = "inputs.html";
    } catch (error) {
      console.error("Unable to clear FinWise data.", error);
      showToast("Could not clear the local database.");
    }
  });
}

function getBudgetSpent(state, category, month, year) {
  return (state.transactions || [])
    .filter((transaction) => transaction.type === "expense")
    .filter((transaction) => {
      const date = parseLocalDate(transaction.date);
      if (!date) return false;
      return (transaction.category || "").toLowerCase() === String(category).toLowerCase() && date.getMonth() + 1 === Number(month) && date.getFullYear() === Number(year);
    })
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
}

function startOfToday() {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function getMonthsRemaining(targetDate) {
  const target = parseLocalDate(targetDate);
  if (!target || target < startOfToday()) return 0;
  const today = new Date();
  return Math.max(1, (target.getFullYear() - today.getFullYear()) * 12 + target.getMonth() - today.getMonth());
}

function initTransactions() {
  const form = qs("#transaction-form");
  if (form) {
    form.reset();
    qs("#tx-date").value = toDateString(new Date());
  }

  renderTransactionsTable();

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const state = loadState();
    const payload = {
      id: form.dataset.editId || generateId("tx"),
      type: qs("#tx-type")?.value || "expense",
      amount: parseAmountInput(qs("#tx-amount")?.value),
      category: qs("#tx-category")?.value.trim() || "General",
      date: qs("#tx-date")?.value || toDateString(new Date()),
      description: qs("#tx-description")?.value.trim() || "",
      paymentMethod: qs("#tx-method")?.value || "Other",
      notes: qs("#tx-notes")?.value.trim() || ""
    };

    if (!payload.amount || payload.amount <= 0) {
      alert("Enter a valid amount");
      return;
    }

    const existingIndex = (state.transactions || []).findIndex((item) => item.id === payload.id);
    if (existingIndex >= 0) {
      state.transactions[existingIndex] = payload;
    } else {
      state.transactions.push(payload);
    }

    await persistState(state);
    renderTransactionsTable();
    form.reset();
    qs("#tx-date").value = toDateString(new Date());
    delete form.dataset.editId;
    qs("#transaction-form button[type='submit']").textContent = "Save transaction";
  });

  qs("#reset-transaction-form")?.addEventListener("click", () => {
    form.reset();
    qs("#tx-date").value = toDateString(new Date());
    delete form.dataset.editId;
    qs("#transaction-form button[type='submit']").textContent = "Save transaction";
  });
}

function renderTransactionsTable() {
  const tbody = qs("#transactions-table-body");
  if (!tbody) return;

  const state = loadState();
  const list = [...(state.transactions || [])].sort((a, b) => (parseLocalDate(b.date)?.getTime() || 0) - (parseLocalDate(a.date)?.getTime() || 0));

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6"><p class="empty-state">No transactions yet.</p></td></tr>';
    return;
  }

  tbody.innerHTML = list.map((item) => `
    <tr>
      <td>${parseLocalDate(item.date)?.toLocaleDateString("en-IN") || "-"}</td>
      <td><span class="status-badge ${item.type === "income" ? "ok" : "warn"}">${escapeHtml(item.type)}</span></td>
      <td>${escapeHtml(item.category || "General")}</td>
      <td>${escapeHtml(item.description || "-")}</td>
      <td class="amount-cell ${item.type === "income" ? "income" : "expense"}">${item.type === "income" ? "+" : "-"}${formatMoney(item.amount)}</td>
      <td>
        <button class="btn btn-sm btn-outline-light me-2 tx-edit" data-id="${item.id}" type="button">Edit</button>
        <button class="btn btn-sm btn-danger tx-delete" data-id="${item.id}" type="button">Delete</button>
      </td>
    </tr>
  `).join("");

  qsa(".tx-edit").forEach((button) => {
    button.addEventListener("click", () => {
      const state = loadState();
      const transaction = state.transactions.find((item) => item.id === button.dataset.id);
      if (!transaction) return;
      const form = qs("#transaction-form");
      if (!form) return;
      form.dataset.editId = transaction.id;
      qs("#tx-type").value = transaction.type || "expense";
      qs("#tx-amount").value = formatAmountInput(String(transaction.amount || ""));
      qs("#tx-category").value = transaction.category || "";
      qs("#tx-date").value = toDateString(transaction.date);
      qs("#tx-description").value = transaction.description || "";
      qs("#tx-method").value = transaction.paymentMethod || "Other";
      qs("#tx-notes").value = transaction.notes || "";
      qs("#transaction-form button[type='submit']").textContent = "Update transaction";
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  qsa(".tx-delete").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("Delete this transaction? This cannot be undone.")) return;
      const state = loadState();
      state.transactions = state.transactions.filter((item) => item.id !== button.dataset.id);
      await persistState(state);
      renderTransactionsTable();
    });
  });
}

function initBudgets() {
  const form = qs("#budget-form");
  if (form) {
    const now = new Date();
    qs("#budget-month").value = now.getMonth() + 1;
    qs("#budget-year").value = now.getFullYear();
  }

  renderBudgetList();

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const state = loadState();
    const item = {
      id: form.dataset.editId || generateId("budget"),
      category: qs("#budget-category")?.value.trim() || "General",
      month: Number(qs("#budget-month")?.value) || 1,
      year: Number(qs("#budget-year")?.value) || new Date().getFullYear(),
      limit: parseAmountInput(qs("#budget-limit")?.value)
    };

    const existingIndex = state.budgets.findIndex((budget) => budget.id === item.id);
    if (existingIndex >= 0) state.budgets[existingIndex] = item;
    else state.budgets.push(item);

    await persistState(state);
    renderBudgetList();
    form.reset();
    qs("#budget-month").value = new Date().getMonth() + 1;
    qs("#budget-year").value = new Date().getFullYear();
    delete form.dataset.editId;
  });

  qs("#reset-budget-form")?.addEventListener("click", () => {
    form.reset();
    qs("#budget-month").value = new Date().getMonth() + 1;
    qs("#budget-year").value = new Date().getFullYear();
    delete form.dataset.editId;
  });
}

function renderBudgetList() {
  const container = qs("#budget-list");
  if (!container) return;
  const state = loadState();
  if (!state.budgets.length) {
    renderEmptyState(container, "No budgets created yet.");
    return;
  }

  container.innerHTML = state.budgets.map((budget) => {
    const spent = getBudgetSpent(state, budget.category, budget.month, budget.year);
    const remaining = (Number(budget.limit) || 0) - spent;
    const utilization = (Number(budget.limit) || 0) > 0 ? (spent / Number(budget.limit)) * 100 : 0;
    const over = spent > Number(budget.limit);
    return `
      <div class="budget-card ${over ? "warn" : ""}">
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <strong>${escapeHtml(budget.category)}</strong><br>
            <small>${budget.month}/${budget.year}</small>
          </div>
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-outline-light budget-edit" data-id="${budget.id}" type="button">Edit</button>
            <button class="btn btn-sm btn-danger budget-delete" data-id="${budget.id}" type="button">Delete</button>
          </div>
        </div>
        <div class="mt-3"><strong>Limit:</strong> ${formatMoney(budget.limit)}</div>
        <div><strong>Spent:</strong> ${formatMoney(spent)}</div>
        <div><strong>Remaining:</strong> ${formatMoney(remaining)}</div>
        <div class="progress mt-2"><div class="progress-bar" style="width:${Math.min(utilization, 100)}%"></div></div>
        <small class="d-block mt-1">${utilization.toFixed(0)}% utilized</small>
      </div>
    `;
  }).join("");

  qsa(".budget-edit").forEach((button) => {
    button.addEventListener("click", () => {
      const state = loadState();
      const item = state.budgets.find((budget) => budget.id === button.dataset.id);
      if (!item) return;
      const form = qs("#budget-form");
      form.dataset.editId = item.id;
      qs("#budget-category").value = item.category;
      qs("#budget-month").value = item.month;
      qs("#budget-year").value = item.year;
      qs("#budget-limit").value = formatAmountInput(String(item.limit || ""));
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  qsa(".budget-delete").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("Delete this budget? This cannot be undone.")) return;
      const state = loadState();
      state.budgets = state.budgets.filter((budget) => budget.id !== button.dataset.id);
      await persistState(state);
      renderBudgetList();
    });
  });
}

function initGoals() {
  const form = qs("#goal-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const state = loadState();
    const item = {
      id: form.dataset.editId || generateId("goal"),
      name: qs("#goal-name-input")?.value.trim() || "Goal",
      targetAmount: parseAmountInput(qs("#goal-target")?.value),
      currentSaved: parseAmountInput(qs("#goal-current")?.value),
      targetDate: qs("#goal-date")?.value || toDateString(new Date())
    };

    const existingIndex = state.goals.findIndex((goal) => goal.id === item.id);
    if (existingIndex >= 0) state.goals[existingIndex] = item;
    else state.goals.push(item);

    await persistState(state);
    renderGoalList();
    form.reset();
    delete form.dataset.editId;
  });

  qs("#reset-goal-form")?.addEventListener("click", () => {
    form.reset();
    delete form.dataset.editId;
  });

  renderGoalList();
}

function renderGoalList() {
  const container = qs("#goal-list");
  if (!container) return;
  const state = loadState();
  if (!state.goals.length) {
    renderEmptyState(container, "No goals added yet.");
    return;
  }

  container.innerHTML = state.goals.map((goal) => {
    const target = Number(goal.targetAmount) || 0;
    const current = Number(goal.currentSaved) || 0;
    const progress = target > 0 ? Math.min((current / target) * 100, 100) : 0;
    const remaining = Math.max(0, target - current);
    const months = getMonthsRemaining(goal.targetDate);
    const required = remaining > 0 && months > 0 ? Math.ceil(remaining / months) : 0;
    const goalDate = parseLocalDate(goal.targetDate);
    const status = remaining <= 0 ? "Completed" : (goalDate && goalDate < startOfToday() ? "Overdue" : "On track");

    return `
      <div class="goal-card">
        <div class="d-flex justify-content-between align-items-center">
          <strong>${escapeHtml(goal.name)}</strong>
          <span class="status-badge ${remaining <= 0 ? "ok" : "warn"}">${status}</span>
        </div>
        <div class="progress mt-2"><div class="progress-bar" style="width:${progress}%"></div></div>
        <small>${formatMoney(current)} / ${formatMoney(target)} • ${remaining > 0 ? `${formatMoney(remaining)} left` : "Goal reached"}</small>
        <small class="d-block mt-2">Required monthly contribution: ${formatMoney(required)}</small>
        <div class="d-flex gap-2 mt-2">
          <button class="btn btn-sm btn-outline-light goal-edit" data-id="${goal.id}" type="button">Edit</button>
          <button class="btn btn-sm btn-danger goal-delete" data-id="${goal.id}" type="button">Delete</button>
        </div>
      </div>
    `;
  }).join("");

  qsa(".goal-edit").forEach((button) => {
    button.addEventListener("click", () => {
      const item = loadState().goals.find((goal) => goal.id === button.dataset.id);
      if (!item) return;
      const form = qs("#goal-form");
      form.dataset.editId = item.id;
      qs("#goal-name-input").value = item.name;
      qs("#goal-target").value = formatAmountInput(String(item.targetAmount || ""));
      qs("#goal-current").value = formatAmountInput(String(item.currentSaved || ""));
      qs("#goal-date").value = toDateString(item.targetDate);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  qsa(".goal-delete").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("Delete this savings goal? This cannot be undone.")) return;
      const state = loadState();
      state.goals = state.goals.filter((goal) => goal.id !== button.dataset.id);
      await persistState(state);
      renderGoalList();
    });
  });
}

function initBills() {
  const form = qs("#bill-form");
  renderBillList();

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const state = loadState();
    const item = {
      id: form.dataset.editId || generateId("bill"),
      name: qs("#bill-name")?.value.trim() || "Bill",
      amount: parseAmountInput(qs("#bill-amount")?.value),
      dueDate: qs("#bill-date")?.value || toDateString(new Date()),
      recurrence: qs("#bill-recurrence")?.value || "monthly",
      paid: false,
      seriesId: form.dataset.seriesId || form.dataset.editId || ""
    };

    const existingIndex = state.bills.findIndex((bill) => bill.id === item.id);
    if (existingIndex >= 0) {
      item.paid = state.bills[existingIndex].paid;
      state.bills[existingIndex] = item;
    }
    else state.bills.push(item);

    await persistState(state);
    renderBillList();
    form.reset();
    delete form.dataset.editId;
    delete form.dataset.seriesId;
    qs("#bill-form button[type='submit']").textContent = "Save bill";
  });

  qs("#reset-bill-form")?.addEventListener("click", () => {
    form.reset();
    delete form.dataset.editId;
    delete form.dataset.seriesId;
    qs("#bill-form button[type='submit']").textContent = "Save bill";
  });
}

function getNextBillDate(dueDate, recurrence) {
  const next = parseLocalDate(dueDate);
  if (!next || recurrence === "one-time") return null;

  if (recurrence === "weekly") {
    next.setDate(next.getDate() + 7);
  } else if (recurrence === "monthly") {
    const originalDay = next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(originalDay, lastDay));
  } else if (recurrence === "yearly") {
    const month = next.getMonth();
    const originalDay = next.getDate();
    next.setDate(1);
    next.setFullYear(next.getFullYear() + 1);
    next.setMonth(month);
    const lastDay = new Date(next.getFullYear(), month + 1, 0).getDate();
    next.setDate(Math.min(originalDay, lastDay));
  } else {
    return null;
  }

  return toDateString(next);
}

function renderBillList() {
  const container = qs("#bill-list");
  if (!container) return;
  const state = loadState();
  const bills = [...(state.bills || [])].sort((a, b) => (parseLocalDate(a.dueDate)?.getTime() || 0) - (parseLocalDate(b.dueDate)?.getTime() || 0));

  if (!bills.length) {
    renderEmptyState(container, "No bills scheduled yet.");
    renderBillPaymentHistory(state);
    return;
  }

  container.innerHTML = bills.map((bill) => {
    const due = parseLocalDate(bill.dueDate);
    if (!due) return "";
    const overdue = due < startOfToday() && !bill.paid;
    const status = bill.paid ? "Paid" : (overdue ? "Overdue" : "Upcoming");
    return `
      <div class="bill-card">
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <strong>${escapeHtml(bill.name)}</strong><br>
            <small>${due.toLocaleDateString("en-IN")} • ${escapeHtml(bill.recurrence)}</small>
          </div>
          <span class="status-badge ${bill.paid ? "ok" : overdue ? "warn" : ""}">${status}</span>
        </div>
        <div class="mt-2"><strong>Amount:</strong> ${formatMoney(bill.amount)}</div>
        <div class="d-flex gap-2 mt-2">
          ${bill.paid ? "" : `<button class="btn btn-sm btn-outline-light bill-mark-paid" data-id="${escapeHtml(bill.id)}" type="button">Mark paid</button>
          <button class="btn btn-sm btn-outline-light bill-edit" data-id="${escapeHtml(bill.id)}" type="button">Edit</button>`}
            <button class="btn btn-sm btn-danger bill-delete" data-id="${escapeHtml(bill.id)}" type="button">Delete</button>
        </div>
      </div>
    `;
  }).join("");

  qsa(".bill-mark-paid").forEach((button) => {
    button.addEventListener("click", async () => {
      const state = loadState();
      const item = state.bills.find((bill) => bill.id === button.dataset.id);
      if (!item) return;
      if (!window.confirm(`Mark ${item.name} as paid?`)) return;
      item.paid = true;
      item.paidDate = toDateString(new Date());
      const seriesId = item.seriesId || item.id;
      state.billPayments.push({
        id: generateId("payment"),
        billId: item.id,
        seriesId,
        name: item.name,
        amount: Number(item.amount) || 0,
        dueDate: item.dueDate,
        paidDate: item.paidDate
      });

      let nextDueDate = getNextBillDate(item.dueDate, item.recurrence);
      let attempts = 0;
      while (nextDueDate && parseLocalDate(nextDueDate) <= startOfToday() && attempts < 1200) {
        nextDueDate = getNextBillDate(nextDueDate, item.recurrence);
        attempts += 1;
      }
      if (nextDueDate && !state.bills.some((bill) => (bill.seriesId || bill.id) === seriesId && bill.dueDate === nextDueDate)) {
        state.bills.push({
          id: generateId("bill"),
          seriesId,
          name: item.name,
          amount: item.amount,
          dueDate: nextDueDate,
          recurrence: item.recurrence,
          paid: false
        });
      }
      await persistState(state);
      renderBillList();
    });
  });

  qsa(".bill-edit").forEach((button) => {
    button.addEventListener("click", () => {
      const item = loadState().bills.find((bill) => bill.id === button.dataset.id);
      if (!item) return;
      const form = qs("#bill-form");
      form.dataset.editId = item.id;
      form.dataset.seriesId = item.seriesId || item.id;
      qs("#bill-name").value = item.name;
      qs("#bill-amount").value = formatAmountInput(String(item.amount || ""));
      qs("#bill-date").value = toDateString(item.dueDate);
      qs("#bill-recurrence").value = item.recurrence;
      qs("#bill-form button[type='submit']").textContent = "Update bill";
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  qsa(".bill-delete").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("Delete this bill? This cannot be undone.")) return;
      const state = loadState();
      state.bills = state.bills.filter((bill) => bill.id !== button.dataset.id);
      await persistState(state);
      renderBillList();
    });
  });

  renderBillPaymentHistory(state);
}

function renderBillPaymentHistory(state = loadState()) {
  const history = qs("#bill-payment-history");
  if (!history) return;
  const payments = [...(state.billPayments || [])].sort((a, b) => (parseLocalDate(b.paidDate)?.getTime() || 0) - (parseLocalDate(a.paidDate)?.getTime() || 0));
  if (!payments.length) {
    renderEmptyState(history, "No bill payments recorded yet.");
    return;
  }
  history.innerHTML = payments.map((payment) => `
    <div class="list-item d-flex justify-content-between gap-3">
      <span><strong>${escapeHtml(payment.name)}</strong><small class="d-block">Paid ${parseLocalDate(payment.paidDate)?.toLocaleDateString("en-IN") || "-"}</small></span>
      <strong>${formatMoney(payment.amount)}</strong>
    </div>
  `).join("");
}

function initReports() {
  const now = new Date();
  qs("#report-month")?.setAttribute("value", now.getMonth() + 1);
  qs("#report-year")?.setAttribute("value", now.getFullYear());
  renderReportView();

  qs("#report-load")?.addEventListener("click", renderReportView);
  qs("#report-export")?.addEventListener("click", exportCsv);
  qs("#report-print")?.addEventListener("click", () => window.print());
}

function renderReportView() {
  const state = loadState();
  const month = Number(qs("#report-month")?.value || new Date().getMonth() + 1);
  const year = Number(qs("#report-year")?.value || new Date().getFullYear());
  const summary = getMonthSummary(state, month - 1, year);

  qs("#report-income").textContent = formatMoney(summary.income);
  qs("#report-expenses").textContent = formatMoney(summary.expenses);
  qs("#report-flow").textContent = formatMoney(summary.net);
  qs("#report-rate").textContent = summary.rate === null ? "Unavailable" : `${summary.rate.toFixed(1)}%`;

  const tbody = qs("#report-table-body");
  if (tbody) {
    if (!summary.filtered.length) {
      tbody.innerHTML = '<tr><td colspan="5"><p class="empty-state">No transaction data in the selected period.</p></td></tr>';
      return;
    }

    tbody.innerHTML = summary.filtered.sort((a, b) => (parseLocalDate(b.date)?.getTime() || 0) - (parseLocalDate(a.date)?.getTime() || 0)).map((item) => `
      <tr>
        <td>${parseLocalDate(item.date)?.toLocaleDateString("en-IN") || "-"}</td>
        <td>${escapeHtml(item.type)}</td>
        <td>${escapeHtml(item.category || "General")}</td>
        <td>${escapeHtml(item.description || "-")}</td>
        <td class="amount-cell ${item.type === "income" ? "income" : "expense"}">${item.type === "income" ? "+" : "-"}${formatMoney(item.amount)}</td>
      </tr>
    `).join("");
  }
}

function exportCsv() {
  const state = loadState();
  const month = Number(qs("#report-month")?.value || new Date().getMonth() + 1);
  const year = Number(qs("#report-year")?.value || new Date().getFullYear());
  const rows = getMonthSummary(state, month - 1, year).filtered;

  const csv = [
    ["Date", "Type", "Category", "Description", "Amount"],
    ...rows.map((item) => [
      parseLocalDate(item.date)?.toLocaleDateString("en-IN") || "",
      item.type,
      item.category || "General",
      item.description || "",
      formatMoney(item.amount)
    ])
  ].map((row) => row.map(escapeCsvField).join(",")).join("\r\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `finwise-report-${month}-${year}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeCsvField(value) {
  let text = String(value).replace(/[\r\n]+/g, " ");
  if (/^[\t ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function initLoans() {
  const form = qs("#loan-form");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const principal = parseAmountInput(qs("#loan-principal")?.value);
    const annualRate = Number(qs("#loan-rate")?.value) || 0;
    const months = Number(qs("#loan-months")?.value) || 0;
    const extra = parseAmountInput(qs("#loan-extra")?.value);

    if (principal <= 0 || months <= 0) {
      alert("Enter valid loan inputs.");
      return;
    }

    const result = calculateLoan(principal, annualRate, months, extra);
    qs("#loan-emi").textContent = formatMoney(result.emi);
    qs("#loan-total").textContent = formatMoney(result.totalPayment);
    qs("#loan-interest").textContent = formatMoney(result.totalInterest);
    const extraNote = extra > 0 ? ` with an additional ${formatMoney(extra)} per month` : "";
    qs("#loan-summary").textContent = `Estimated base EMI${extraNote}. With this payment schedule, payoff takes ${result.periods} months. Estimate only, not a lender quotation.`;
  });

  form?.dispatchEvent(new Event("submit"));
}

function calculateLoan(principal, annualRate, months, extra = 0) {
  if (!Number.isFinite(principal) || !Number.isFinite(annualRate) ||
      !Number.isFinite(months) || !Number.isFinite(extra) ||
      principal <= 0 || annualRate < 0 || months <= 0 || extra < 0) {
    return { emi: 0, totalPayment: 0, totalInterest: 0, periods: 0 };
  }

  const monthlyRate = annualRate / 12 / 100;
  const emi = monthlyRate === 0
    ? principal / months
    : (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) /
      (Math.pow(1 + monthlyRate, months) - 1);
  let balance = principal;
  let totalPayment = 0;
  let totalInterest = 0;
  let periods = 0;

  for (let period = 0; period < months && balance > 0; period += 1) {
    const interest = balance * monthlyRate;
    const payment = Math.min(balance + interest, emi + extra);
    balance = Math.max(0, balance + interest - payment);
    totalInterest += interest;
    totalPayment += payment;
    periods += 1;
  }

  return {
    emi,
    totalPayment,
    totalInterest,
    periods
  };
}

function initAi() {
  const chat = qs("#ai-chat");
  if (chat) {
    appendCoachMessage("assistant", answerCoachQuestion(loadState()));
  }

  qs("#ai-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = qs("#ai-question");
    const question = input.value.trim();
    const chat = qs("#ai-chat");

    if (!chat || !question) return;
    appendCoachMessage("user", question);
    appendCoachMessage("assistant", answerCoachQuestion(loadState(), question));
    input.value = "";
  });

  qsa(".coach-prompt").forEach((button) => {
    button.addEventListener("click", () => {
      const input = qs("#ai-question");
      if (!input) return;
      input.value = button.dataset.question || "";
      qs("#ai-form")?.requestSubmit();
    });
  });
}

function appendCoachMessage(role, text) {
  const chat = qs("#ai-chat");
  if (!chat) return;
  const message = document.createElement("div");
  message.className = `chat-message ${role}`;
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  message.append(paragraph);
  chat.append(message);
  chat.scrollTop = chat.scrollHeight;
}

function answerCoachQuestion(state, question = "", currentDate = new Date()) {
  const text = question.trim().toLowerCase().replace(/[’']/g, "").replace(/[?!.,]/g, " ");
  const selectedDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const isComparingWithLastMonth = /\b(compare|compared|versus|vs|than|from)\b.*\b(last|previous|prior)\s+month\b/.test(text);
  if (/\b(last|previous|prior)\s+month\b/.test(text) && !isComparingWithLastMonth) {
    selectedDate.setMonth(selectedDate.getMonth() - 1);
  } else {
    const months = [
      "january", "february", "march", "april", "may", "june",
      "july", "august", "september", "october", "november", "december"
    ];
    const requestedMonth = months.findIndex((name) => new RegExp(`\\b${name}\\b`).test(text));
    if (requestedMonth >= 0) {
      selectedDate.setMonth(requestedMonth);
      const requestedYear = text.match(/\b(20\d{2})\b/);
      selectedDate.setFullYear(requestedYear ? Number(requestedYear[1]) : currentDate.getFullYear());
    }
  }

  const month = selectedDate.getMonth();
  const year = selectedDate.getFullYear();
  const monthLabel = selectedDate.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const summary = getMonthSummary(state, month, year);
  const previousDate = new Date(year, month - 1, 1);
  const previousSummary = getMonthSummary(state, previousDate.getMonth(), previousDate.getFullYear());
  const transactions = state.transactions || [];
  const categories = [...new Set([
    ...transactions.map((item) => item.category),
    ...(state.budgets || []).map((item) => item.category)
  ].filter((category) => typeof category === "string" && category.trim()))]
    .sort((first, second) => second.length - first.length);
  const mentionedCategory = categories.find((category) =>
    text.includes(category.toLowerCase().trim())
  );
  const goals = state.goals || [];
  const mentionedGoal = goals.find((goal) =>
    typeof goal.name === "string" && text.includes(goal.name.toLowerCase())
  );
  const budgets = (state.budgets || []).filter((budget) =>
    Number(budget.month) === month + 1 && Number(budget.year) === year
  ).map((budget) => {
    const spent = getBudgetSpent(state, budget.category, budget.month, budget.year);
    const limit = Number(budget.limit) || 0;
    return { ...budget, spent, limit, remaining: limit - spent, usage: limit > 0 ? spent / limit * 100 : 0 };
  });
  const unpaidBills = (state.bills || []).filter((bill) => !bill.paid && bill.dueDate);
  const mentionedBill = unpaidBills.find((bill) =>
    typeof bill.name === "string" && text.includes(bill.name.toLowerCase())
  );
  const today = toDateString(startOfToday());
  const dueSoonDate = new Date(startOfToday());
  dueSoonDate.setDate(dueSoonDate.getDate() + 30);
  const overdueBills = unpaidBills.filter((bill) => bill.dueDate < today);
  const upcomingBills = unpaidBills
    .filter((bill) => bill.dueDate >= today && bill.dueDate <= toDateString(dueSoonDate))
    .sort((first, second) => first.dueDate.localeCompare(second.dueDate));
  const has = (pattern) => pattern.test(text);
  const transactionAmount = (type, category) => summary.filtered
    .filter((item) => item.type === type && (!category || item.category?.toLowerCase() === category.toLowerCase()))
    .reduce((total, item) => total + (Number(item.amount) || 0), 0);

  if (!text) {
    if (!summary.filtered.length && !budgets.length && !goals.length && !unpaidBills.length) {
      return "I don’t see finance activity yet. Add a few transactions, budgets, goals, or bills, then ask a specific question. Your question and financial details stay on this device.";
    }
    const highlights = [];
    if (summary.categories[0]) {
      highlights.push(`Your highest expense category is ${summary.categories[0].name} at ${formatMoney(summary.categories[0].amount)}.`);
    }
    const overBudget = budgets.filter((budget) => budget.spent > budget.limit);
    if (overBudget.length) {
      highlights.push(`${overBudget.map((budget) => `${budget.category} is ${formatMoney(budget.spent - budget.limit)} over budget`).join("; ")}.`);
    }
    if (overdueBills.length) highlights.push(`${overdueBills.length} unpaid ${overdueBills.length === 1 ? "bill is" : "bills are"} overdue.`);
    if (goals.length) {
      const goal = goals[0];
      const target = Number(goal.targetAmount) || 0;
      const saved = Number(goal.currentSaved) || 0;
      highlights.push(`${goal.name} is ${target ? (saved / target * 100).toFixed(0) : 0}% funded.`);
    }
    if (!highlights.length) highlights.push("You have no over-budget categories or urgent unpaid bills in the data recorded so far.");
    return `Your ${monthLabel} check-in: ${highlights.join(" ")} Ask about a specific category, budget, bill, or goal for details.`;
  }

  if (has(/\bincome\b/) && has(/\b(expense|expenses|spend|spending)\b/)) {
    return `${monthLabel} overview: ${formatMoney(summary.income)} recorded income, ${formatMoney(summary.expenses)} recorded expenses, and ${formatMoney(summary.net)} net cash flow${summary.rate === null ? "" : ` (${summary.rate.toFixed(1)}% savings rate)`}.`;
  }

  if (has(/\b(retire|retirement|corpus|pension)\b/)) {
    const retirement = state.retirement || {};
    const age = Number(retirement.age || state.retAge) || 0;
    const targetAge = Number(retirement.retirementAge || state.retTargetAge) || 0;
    const target = Number(retirement.targetAmount || state.retTargetAmt) || 0;
    if (!age || !targetAge || !target) {
      return "Your retirement estimate is not set up yet. Add your current age, target retirement age, target corpus, and assumed return on the Plan page to calculate a monthly estimate.";
    }
    const years = Math.max(0, targetAge - age);
    const months = years * 12;
    const monthlyRate = (Number(retirement.annualReturn ?? 12) || 0) / 1200;
    const contribution = months
      ? monthlyRate
        ? target * monthlyRate / (Math.pow(1 + monthlyRate, months) - 1)
        : target / months
      : target;
    return `Your plan targets ${formatMoney(target)} by age ${targetAge}, about ${years} years from now. At the assumed ${Number(retirement.annualReturn ?? 12)}% annual return, the simplified estimate is ${formatMoney(Math.ceil(contribution))} per month. Returns are not guaranteed; inflation, fees, and taxes are not included.`;
  }

  if (has(/\b(loan|emi|mortgage|prepay|interest rate)\b/)) {
    return "For a loan estimate, open the Loans page and enter the principal, annual rate, term, and any extra monthly payment. FinWise will calculate an estimated EMI, total interest, and payoff time. Check the final terms and fees with your lender.";
  }

  if (has(/\b(budget|budgets|limit|limits|overspend|over budget)\b/)) {
    if (!budgets.length) return `There is no budget recorded for ${monthLabel}. Add a category limit on the Budgets page to compare it with your recorded expenses.`;
    const relevantBudgets = mentionedCategory
      ? budgets.filter((budget) => budget.category.toLowerCase() === mentionedCategory.toLowerCase())
      : budgets;
    if (!relevantBudgets.length) return `I couldn’t find a ${mentionedCategory} budget for ${monthLabel}. Your other budgets are: ${budgets.map((budget) => budget.category).join(", ")}.`;
    return relevantBudgets.map((budget) => {
      if (budget.limit === 0) return `${budget.category}: ${formatMoney(budget.spent)} spent against a zero limit. Set a positive limit if you want to track this category.`;
      if (budget.spent > budget.limit) {
        return `${budget.category}: ${formatMoney(budget.spent)} spent against a ${formatMoney(budget.limit)} limit. You’re ${formatMoney(budget.spent - budget.limit)} over budget (${budget.usage.toFixed(0)}% used). Check recent transactions and consider adjusting flexible spending.`;
      }
      return `${budget.category}: ${formatMoney(budget.spent)} of ${formatMoney(budget.limit)} used (${budget.usage.toFixed(0)}%). ${formatMoney(budget.remaining)} remains for ${monthLabel}.`;
    }).join(" ");
  }

  if (has(/\b(bill|bills|due|overdue|upcoming payment|upcoming payments)\b/) ||
      (has(/\b(payment|payments|paid|pay)\b/) && has(/\b(upcoming|due|next|bill)\b/)) ||
      (mentionedBill && has(/\b(payment|payments|paid|pay)\b/))) {
    if (mentionedBill) {
      const status = mentionedBill.dueDate < today ? "overdue" : "unpaid";
      return `${mentionedBill.name} is ${status}: ${formatMoney(mentionedBill.amount)}, due ${parseLocalDate(mentionedBill.dueDate)?.toLocaleDateString("en-IN") || mentionedBill.dueDate}.`;
    }
    if (overdueBills.length || upcomingBills.length) {
      const entries = [
        ...overdueBills.map((bill) => `Overdue: ${bill.name}, ${formatMoney(bill.amount)}, due ${parseLocalDate(bill.dueDate)?.toLocaleDateString("en-IN")}.`),
        ...upcomingBills.map((bill) => `Upcoming: ${bill.name}, ${formatMoney(bill.amount)}, due ${parseLocalDate(bill.dueDate)?.toLocaleDateString("en-IN")}.`)
      ];
      return entries.join(" ");
    }
    return "There are no unpaid bills overdue or due in the next 30 days. Check the Bills page for your full schedule.";
  }

  if (has(/\b(goal|goals|target|targets|saving goal|savings goal|savings goals)\b/) || mentionedGoal) {
    const matchingGoals = mentionedGoal
      ? [mentionedGoal]
      : goals.filter((goal) => !mentionedCategory || goal.name.toLowerCase().includes(mentionedCategory.toLowerCase()));
    if (!matchingGoals.length) return goals.length
      ? `I couldn’t find a goal matching “${mentionedCategory}”. Your saved goals are: ${goals.map((goal) => goal.name).join(", ")}.`
      : "You don’t have a savings goal recorded yet. Add a goal name, target amount, current savings, and target date on the Goals page.";
    return matchingGoals.map((goal) => {
      const target = Number(goal.targetAmount) || 0;
      const saved = Number(goal.currentSaved) || 0;
      const remaining = Math.max(0, target - saved);
      const progress = target ? Math.min(100, saved / target * 100) : 0;
      const monthsRemaining = getMonthsRemaining(goal.targetDate);
      const monthly = monthsRemaining ? Math.ceil(remaining / monthsRemaining) : null;
      return remaining === 0
        ? `${goal.name} has reached its ${formatMoney(target)} target.`
        : `${goal.name}: ${formatMoney(saved)} of ${formatMoney(target)} saved (${progress.toFixed(0)}%). ${formatMoney(remaining)} remains${monthly === null ? "; its target date has passed." : `; about ${formatMoney(monthly)} per month for ${monthsRemaining} months would reach the target date.`}`;
    }).join(" ");
  }

  if (has(/\b(income|salary|earnings|earned|earn|paycheck|pay chec[k]?)\b/)) {
    const income = transactionAmount("income");
    const incomeSources = [...new Set(summary.filtered.filter((item) => item.type === "income").map((item) => item.category || "Other"))];
    if (!income) return `No income transactions are recorded for ${monthLabel}. Add an income entry on the Transactions page to include it in your totals.`;
    if (has(/\b(compare|compared|increase|increased|change|versus|vs)\b/) && previousSummary.income) {
      const difference = income - previousSummary.income;
      return `Recorded income for ${monthLabel} is ${formatMoney(income)}; that’s ${formatMoney(Math.abs(difference))} ${difference > 0 ? "more" : difference < 0 ? "less" : "the same"} than ${previousDate.toLocaleDateString("en-IN", { month: "long" })} (${formatMoney(previousSummary.income)}).`;
    }
    return `Recorded income for ${monthLabel} is ${formatMoney(income)}${incomeSources.length ? ` from ${incomeSources.join(", ")}` : ""}. This includes only income transactions you entered.`;
  }

  if (has(/\bsavings rate\b|\bnet\b|\bcash flow\b|\bbalance\b|\bleft over\b|\bleftover\b|\bafford\b|\bavailable\b|\bsav(e|ed|ing|ings)\b/)) {
    if (has(/\b(savings rate|rate)\b/)) {
      return summary.rate === null
        ? `I can’t calculate a savings rate for ${monthLabel} because no income is recorded for that month.`
        : `Your recorded savings rate for ${monthLabel} is ${summary.rate.toFixed(1)}%: ${formatMoney(summary.net)} net cash flow divided by ${formatMoney(summary.income)} income.`;
    }
    if (has(/\bsav(e|ed|ing|ings)\b/)) {
      if (summary.net <= 0) {
        return `There is no positive recorded surplus to save for ${monthLabel}: income is ${formatMoney(summary.income)} and expenses are ${formatMoney(summary.expenses)}. Check for missing or miscategorized entries, then review flexible expenses and essential bills before setting a savings amount.`;
      }
      const suggestedAmount = Math.round(summary.net * 0.2 * 100) / 100;
      return `Your recorded surplus for ${monthLabel} is ${formatMoney(summary.net)}. One optional starting scenario is setting aside 20% of that surplus (${formatMoney(suggestedAmount)}), if essentials and upcoming obligations are covered. That is only a planning example; choose an amount that fits your situation.`;
    }
    if (has(/\bafford\b|\bavailable\b/)) {
      const upcomingTotal = upcomingBills.reduce((total, bill) => total + (Number(bill.amount) || 0), 0);
      const afterBills = summary.net - upcomingTotal;
      return `For ${monthLabel}, recorded income minus expenses is ${formatMoney(summary.net)}. After ${formatMoney(upcomingTotal)} in unpaid bills due within 30 days, the unallocated amount is ${formatMoney(afterBills)}. This is not a full affordability check; account for essentials and other obligations before spending.`;
    }
    return `${monthLabel} cash flow: ${formatMoney(summary.income)} recorded income minus ${formatMoney(summary.expenses)} recorded expenses = ${formatMoney(summary.net)} ${summary.net < 0 ? "deficit" : "remaining"}.`;
  }

  if (mentionedCategory || has(/\b(spend|spending|spent|expense|expenses|cost|costs|purchase|purchases|cut|reduce|highest|biggest|most)\b/) ||
      has(/\bwhere (does|is|did) (my )?money go\b/)) {
    if (!summary.categories.length) return `No expenses are recorded for ${monthLabel}. Add categorized expenses to see where your money is going.`;
    const category = mentionedCategory
      ? summary.categories.find((item) => item.name.toLowerCase() === mentionedCategory.toLowerCase())
      : summary.categories[0];
    if (!category) return `No ${mentionedCategory} expenses are recorded for ${monthLabel}. Your recorded expense categories are ${summary.categories.map((item) => item.name).join(", ")}.`;
    const categoryPrevious = transactionAmountForMonth(state, category.name, previousDate.getMonth(), previousDate.getFullYear());
    const categoryDifference = category.amount - categoryPrevious;
    const categoryBudget = budgets.find((budget) => budget.category.toLowerCase() === category.name.toLowerCase());
    const budgetNote = categoryBudget
      ? ` The ${formatMoney(categoryBudget.limit)} budget has ${categoryBudget.remaining >= 0 ? `${formatMoney(categoryBudget.remaining)} remaining` : `been exceeded by ${formatMoney(Math.abs(categoryBudget.remaining))}`}.`
      : "";
    if (has(/\b(compare|compared|increase|increased|change|versus|vs|than|from)\b/)) {
      return `${category.name} spending was ${formatMoney(category.amount)} in ${monthLabel} and ${formatMoney(categoryPrevious)} in ${previousDate.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}; that’s ${formatMoney(Math.abs(categoryDifference))} ${categoryDifference > 0 ? "more" : categoryDifference < 0 ? "less" : "the same"}.${budgetNote}`;
    }
    if (mentionedCategory) {
      return `You recorded ${formatMoney(category.amount)} for ${category.name} in ${monthLabel}${summary.expenses ? `, which is ${(category.amount / summary.expenses * 100).toFixed(0)}% of your expenses` : ""}.${budgetNote}`;
    }
    return `Your highest expense category in ${monthLabel} is ${category.name} at ${formatMoney(category.amount)} (${(category.amount / summary.expenses * 100).toFixed(0)}% of recorded expenses).${budgetNote} Review that category’s transactions to decide whether any non-essential spending can be adjusted.`;
  }

  if (has(/\b(manage|help|track|advice|improve|doing)\b/)) {
    const flexibleCategory = summary.categories[0];
    const suggestion = flexibleCategory
      ? `Your largest expense category is ${flexibleCategory.name} at ${formatMoney(flexibleCategory.amount)}. Review it for optional costs, while keeping essential spending in mind.`
      : "Record your income and expenses for a few weeks to see where there may be room to save.";
    const deficit = summary.net < 0
      ? ` Recorded spending is ${formatMoney(Math.abs(summary.net))} above income, so start by checking your entries and prioritizing essentials.`
      : "";
    return `${suggestion}${deficit} A practical next step is to set a realistic category budget and review it weekly.`;
  }

  return "I can answer questions about a particular expense category, income, cash flow, a budget, a bill, a savings goal, retirement estimates, or loan calculations. Try asking one of those or include the category or goal name.";
}

function transactionAmountForMonth(state, category, month, year) {
  return getMonthSummary(state, month, year).filtered
    .filter((item) => item.type === "expense" && item.category?.toLowerCase() === category.toLowerCase())
    .reduce((total, item) => total + (Number(item.amount) || 0), 0);
}

function generateAssistantInsight(state, month, year, question = "") {
  const summary = getMonthSummary(state, month, year);
  const previousDate = new Date(year, month - 1, 1);
  const previousSummary = getMonthSummary(state, previousDate.getMonth(), previousDate.getFullYear());
  const periodLabel = new Date(year, month, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const questionText = question.trim().toLowerCase();
  const budgets = (state.budgets || []).filter((budget) =>
    Number(budget.month) === month + 1 && Number(budget.year) === year
  );
  const budgetResults = budgets.map((budget) => {
    const limit = Number(budget.limit) || 0;
    const spent = getBudgetSpent(state, budget.category, budget.month, budget.year);
    return { ...budget, limit, spent, remaining: limit - spent, usage: limit > 0 ? spent / limit * 100 : 0 };
  });
  const now = startOfToday();
  const todayString = toDateString(now);
  const thirtyDaysFromNow = new Date(now);
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
  const dueBills = (state.bills || []).filter((bill) => !bill.paid && bill.dueDate);
  const overdueBills = dueBills.filter((bill) => bill.dueDate < todayString);
  const upcomingBills = dueBills
    .filter((bill) => bill.dueDate >= todayString && bill.dueDate <= toDateString(thirtyDaysFromNow))
    .sort((first, second) => first.dueDate.localeCompare(second.dueDate));
  const activeGoals = (state.goals || []).filter((goal) => {
    const target = Number(goal.targetAmount) || 0;
    const saved = Number(goal.currentSaved) || 0;
    return target > saved;
  });
  const topCategory = summary.categories[0];
  const previousExpenses = previousSummary.expenses;
  const expenseChange = summary.expenses - previousExpenses;
  const monthNames = new Intl.DateTimeFormat("en-IN", { month: "long" });
  const previousMonthLabel = monthNames.format(previousDate);
  const overview = `For ${periodLabel}, your recorded income is ${formatMoney(summary.income)}, spending is ${formatMoney(summary.expenses)}, and net cash flow is ${formatMoney(summary.net)}${summary.rate === null ? "." : `, a savings rate of ${summary.rate.toFixed(1)}%.`}`;

  if (!summary.filtered.length && !summary.income && !summary.expenses && !budgets.length &&
      !(state.goals || []).length && !(state.bills || []).length) {
    return "I don't see any financial activity recorded yet. Add transactions, budgets, goals, or bills and I can help you review them. Your questions and finance data stay on this device; they are not sent to an external AI service.";
  }

  if (!questionText) {
    const observations = [];
    if (topCategory) observations.push(`Your largest expense category is ${topCategory.name} at ${formatMoney(topCategory.amount)}.`);
    const overBudget = budgetResults.filter((budget) => budget.spent > budget.limit);
    const nearlyUsed = budgetResults.filter((budget) => budget.usage >= 80 && budget.spent <= budget.limit);
    if (overBudget.length) {
      observations.push(`${overBudget.map((budget) => `${budget.category} is ${formatMoney(budget.spent - budget.limit)} over budget`).join("; ")}.`);
    } else if (nearlyUsed.length) {
      observations.push(`${nearlyUsed.map((budget) => `${budget.category} has used ${budget.usage.toFixed(0)}% of its budget`).join("; ")}.`);
    }
    if (overdueBills.length) observations.push(`${overdueBills.length} unpaid ${overdueBills.length === 1 ? "bill is" : "bills are"} past due.`);
    else if (upcomingBills.length) observations.push(`${upcomingBills.length} unpaid ${upcomingBills.length === 1 ? "bill is" : "bills are"} due within 30 days.`);
    if (activeGoals.length) {
      const goal = activeGoals[0];
      const target = Number(goal.targetAmount) || 0;
      const saved = Number(goal.currentSaved) || 0;
      observations.push(`${goal.name} is ${target > 0 ? (saved / target * 100).toFixed(0) : 0}% funded.`);
    }
    if (!observations.length) observations.push("Review your transactions weekly and compare them with your plans.");
    return `${overview} ${observations.join(" ")} Ask about a category for a more focused review. This coach only sees the information you record in FinWise.`;
  }

  if (/\bbudget(s|ing)?\b|\blimit(s)?\b/.test(questionText)) {
    if (!budgetResults.length) {
      return `${overview} You haven't set a budget for ${periodLabel} yet. Add monthly category limits to compare your planned amounts with recorded expenses.`;
    }
    const overBudget = budgetResults.filter((budget) => budget.spent > budget.limit);
    const nearlyUsed = budgetResults.filter((budget) => budget.usage >= 80 && budget.spent <= budget.limit);
    const status = budgetResults.map((budget) =>
      `${budget.category}: ${formatMoney(budget.spent)} of ${formatMoney(budget.limit)} (${budget.usage.toFixed(0)}%)`
    ).join("; ");
    if (overBudget.length) {
      return `${overview} Over limit: ${overBudget.map((budget) =>
        `${budget.category} by ${formatMoney(budget.spent - budget.limit)}`
      ).join(", ")}. Consider pausing non-essential spending in those categories and review the limits. Budget check: ${status}.`;
    }
    if (nearlyUsed.length) {
      return `${overview} ${nearlyUsed.map((budget) => `${budget.category} has used ${budget.usage.toFixed(0)}% of its limit`).join("; ")}. Check those categories before taking on extra spending. Budget check: ${status}.`;
    }
    return `${overview} Your recorded expenses are within the budgets you set. Budget check: ${status}.`;
  }

  if (/\bbill(s)?\b|\bdue\b|\bpayment(s)?\b/.test(questionText)) {
    const billList = (bills) => bills.map((bill) =>
      `${bill.name}: ${formatMoney(bill.amount)} due ${parseLocalDate(bill.dueDate)?.toLocaleDateString("en-IN") || bill.dueDate}`
    ).join("; ");
    const parts = [];
    if (overdueBills.length) parts.push(`Overdue: ${billList(overdueBills)}.`);
    if (upcomingBills.length) parts.push(`Due in the next 30 days: ${billList(upcomingBills)}.`);
    if (!parts.length) parts.push("No unpaid bills are overdue or due in the next 30 days.");
    return `${overview} ${parts.join(" ")} Check bill amounts and due dates with the provider before paying.`;
  }

  if (/\bgoal(s)?\b|\bsav(e|ed|ing|ings)?\b|\bemergency fund\b/.test(questionText)) {
    if (!activeGoals.length) {
      return `${overview} Add a savings goal with a target and date to track progress and estimate a monthly contribution.`;
    }
    const goalSummary = activeGoals.map((goal) => {
      const target = Number(goal.targetAmount) || 0;
      const saved = Number(goal.currentSaved) || 0;
      const remaining = target - saved;
      const progress = target > 0 ? saved / target * 100 : 0;
      const months = getMonthsRemaining(goal.targetDate);
      const monthly = months > 0 ? Math.ceil(remaining / months) : null;
      return `${goal.name}: ${formatMoney(saved)} of ${formatMoney(target)} (${progress.toFixed(0)}%); ${monthly === null ? "target date has passed" : `${formatMoney(monthly)} per month to reach the target date`}`;
    }).join("; ");
    return `${overview} Goal progress: ${goalSummary}. Treat the monthly amount as an estimate and choose a contribution that fits your essential expenses.`;
  }

  if (/\bretire(ment)?\b|\bcorpus\b|\bpension\b/.test(questionText)) {
    const retirement = state.retirement || {};
    const currentAge = Number(retirement.age || state.retAge) || 0;
    const retirementAge = Number(retirement.retirementAge || state.retTargetAge) || 0;
    const target = Number(retirement.targetAmount || state.retTargetAmt) || 0;
    if (!currentAge || !retirementAge || !target) {
      return `${overview} Add your current age, target retirement age, and target corpus in your plan to see a basic retirement estimate. Investment returns are uncertain, so treat projections as scenarios rather than promises.`;
    }
    const years = Math.max(0, retirementAge - currentAge);
    const monthlyRate = (Number(retirement.annualReturn ?? 12) || 0) / 1200;
    const months = years * 12;
    const monthlyContribution = months > 0
      ? monthlyRate > 0
        ? target * monthlyRate / (Math.pow(1 + monthlyRate, months) - 1)
        : target / months
      : target;
    return `${overview} Your plan targets ${formatMoney(target)} in about ${years} years. A simplified estimate is around ${formatMoney(Math.ceil(monthlyContribution))} per month at the assumed ${Number(retirement.annualReturn ?? 12)}% annual return. Actual returns, inflation, taxes, and fees can change the result; this is not investment advice.`;
  }

  if (/\bloan(s)?\b|\bemi\b|\binterest rate\b|\bprepay(ment)?\b/.test(questionText)) {
    return `${overview} Use the Loans page to compare an EMI estimate and extra-payment scenarios. The estimate uses the principal, rate, and term you enter; confirm actual rates, charges, and terms with your lender.`;
  }

  if (/\bincome\b|\bear(n|ning|nings)\b|\bsalary\b/.test(questionText)) {
    const incomeCategories = {};
    summary.filtered.filter((transaction) => transaction.type === "income").forEach((transaction) => {
      const category = transaction.category || "Other";
      incomeCategories[category] = (incomeCategories[category] || 0) + (Number(transaction.amount) || 0);
    });
    const sources = Object.entries(incomeCategories).sort((first, second) => second[1] - first[1]);
    const sourceText = sources.length
      ? ` Recorded sources: ${sources.map(([category, amount]) => `${category} ${formatMoney(amount)}`).join(", ")}.`
      : " No income transactions are recorded for this month yet.";
    return `${overview}${sourceText} Compare actual income with expected pay dates and amounts; the app only knows entries you have recorded.`;
  }

  if (/\bspend(ing)?\b|\bexpense(s)?\b|\bwhere\b|\bcategory\b/.test(questionText)) {
    if (!topCategory) {
      return `${overview} No expenses are recorded for this month yet. Add expenses with categories to see where your money is going.`;
    }
    const matchedCategory = summary.categories.find((category) => questionText.includes(category.name.toLowerCase()));
    const focus = matchedCategory
      ? `${matchedCategory.name} spending is ${formatMoney(matchedCategory.amount)} this month.`
      : `Your largest recorded category is ${topCategory.name} at ${formatMoney(topCategory.amount)}${summary.expenses > 0 ? ` (${(topCategory.amount / summary.expenses * 100).toFixed(0)}% of spending)` : ""}.`;
    const comparison = previousSummary.filtered.length
      ? ` Spending is ${formatMoney(Math.abs(expenseChange))} ${expenseChange > 0 ? "higher" : expenseChange < 0 ? "lower" : "unchanged"} than ${previousMonthLabel}.`
      : "";
    const relevantBudget = budgetResults.find((budget) =>
      (matchedCategory?.name || topCategory.name).toLowerCase() === String(budget.category).toLowerCase()
    );
    const budgetNote = relevantBudget
      ? ` ${relevantBudget.category} is at ${relevantBudget.usage.toFixed(0)}% of its budget.`
      : "";
    return `${overview} ${focus}${comparison}${budgetNote} Review recent entries for that category and decide whether any flexible spending can be reduced.`;
  }

  if (/\bsaving(s)? rate\b|\bnet\b|\bcash flow\b|\bmanage\b|\bhelp\b|\btrack\b|\bdoing\b/.test(questionText)) {
    if (summary.net < 0) {
      return `${overview} Recorded spending is above income by ${formatMoney(Math.abs(summary.net))}. First check that entries are accurate, then prioritize essential bills and review flexible costs before making new commitments.`;
    }
    if (summary.rate !== null && summary.rate < 10) {
      return `${overview} Your recorded savings rate is below 10% this month. If it fits your circumstances, look for one manageable recurring cost to adjust and set a realistic savings target.`;
    }
    return `${overview} A helpful routine is to review transactions weekly, compare categories with budgets, and set aside a sustainable amount for goals after essentials. Results only reflect data you have entered.`;
  }

  const suggestion = topCategory
    ? ` Your highest expense category is ${topCategory.name} at ${formatMoney(topCategory.amount)}.`
    : "";
  return `${overview}${suggestion} Try asking about your spending, income, budgets, bills, savings goals, retirement estimates, or loan calculations. I only analyze the data you have saved in FinWise.`;
}
