require("dotenv").config({ path: require("node:path").resolve(__dirname, "../.env") });

const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const { ApiError, errorHandler, notFound } = require("./middleware/errors");
const { db } = require("./db/database");

const app = express();
const port = Number(process.env.PORT || 3000);

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null
    }
  },
  referrerPolicy: { policy: "no-referrer" }
}));
app.use(express.json({ limit: "1mb", strict: true }));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "finwise-api" });
});

app.get("/api/state", (req, res, next) => {
  try {
    const row = db.prepare("select state_json, updated_at from finance_state where id = 1").get();
    res.json({ state: row ? JSON.parse(row.state_json) : null, updatedAt: row?.updated_at || null });
  } catch (error) {
    next(error);
  }
});

app.put("/api/state", (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
        !req.body.state || typeof req.body.state !== "object" || Array.isArray(req.body.state)) {
      throw new ApiError(400, "State must be a JSON object.", "INVALID_STATE");
    }
    const { state } = req.body;
    for (const collection of ["transactions", "budgets", "goals", "bills", "billPayments", "expenses"]) {
      if (state[collection] !== undefined && !Array.isArray(state[collection])) {
        throw new ApiError(400, `${collection} must be an array.`, "INVALID_STATE");
      }
    }

    const stateJson = JSON.stringify(state);
    db.exec("begin immediate");
    try {
      db.prepare(`
        insert into finance_state (id, state_json, updated_at)
        values (1, ?, datetime('now'))
        on conflict(id) do update set state_json = excluded.state_json, updated_at = datetime('now')
      `).run(stateJson);
      db.prepare("delete from finance_records").run();
      const insertRecord = db.prepare("insert into finance_records (collection, record_id, data_json) values (?, ?, ?)");
      for (const collection of ["transactions", "budgets", "goals", "bills", "billPayments", "expenses"]) {
        for (const [index, record] of (state[collection] || []).entries()) {
          if (!record || typeof record !== "object" || Array.isArray(record)) {
            throw new ApiError(400, `${collection} entries must be JSON objects.`, "INVALID_STATE");
          }
          const id = typeof record.id === "string" && record.id ? record.id : `${collection}-${index}`;
          insertRecord.run(collection, id, JSON.stringify(record));
        }
      }
      db.exec("commit");
    } catch (error) {
      db.exec("rollback");
      throw error;
    }
    res.json({ saved: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/state", (req, res, next) => {
  try {
    db.exec("begin immediate");
    db.prepare("delete from finance_state").run();
    db.prepare("delete from finance_records").run();
    db.exec("commit");
    res.status(204).end();
  } catch (error) {
    db.exec("rollback");
    next(error);
  }
});

const publicFiles = new Set([
  "/",
  "/index.html",
  "/inputs.html",
  "/dashboard.html",
  "/transactions.html",
  "/budgets.html",
  "/goals.html",
  "/bills.html",
  "/reports.html",
  "/loans.html",
  "/ai.html",
  "/style.css",
  "/script.js"
]);
app.use((req, res, next) => {
  if (!publicFiles.has(req.path)) return next();
  express.static(path.resolve(__dirname, "../../frontend"), {
    dotfiles: "deny",
    index: "index.html",
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-store");
    }
  })(req, res, next);
});
app.use(notFound);
app.use(errorHandler);

if (require.main === module) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  app.listen(port, "127.0.0.1", () => {
    console.log(`FinWise server listening on http://localhost:${port}`);
  });
}

module.exports = app;
