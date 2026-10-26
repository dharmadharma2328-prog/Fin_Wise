
require("dotenv").config({
  path: require("node:path").resolve(__dirname, "../.env")
});

const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { ApiError, errorHandler, notFound } = require("./middleware/errors");
const { db } = require("./db/database");
const authRoutes = require("./routes/auth");
const {
  findSessionUser,
  requireAuth,
  requireSameOrigin
} = require("./middleware/auth");

const app = express();
const port = Number(process.env.PORT || 3000);

app.disable("x-powered-by");

app.use(
  helmet({
    crossOriginOpenerPolicy: {
      policy: "same-origin-allow-popups"
    },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "https://cdn.jsdelivr.net",
          "https://accounts.google.com"
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdn.jsdelivr.net"
        ],
        imgSrc: ["'self'", "data:"],
        connectSrc: [
          "'self'",
          "https://accounts.google.com"
        ],
        frameSrc: ["https://accounts.google.com"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests:
          process.env.NODE_ENV === "production" ? [] : null
      }
    },
    referrerPolicy: {
      policy: "no-referrer"
    }
  })
);

app.use(express.json({ limit: "1mb", strict: true }));
app.use("/api", requireSameOrigin);

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "finwise-api"
  });
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many sign-in attempts. Try again later."
    }
  }
});

app.use(
  "/api/auth",
  (req, res, next) => {
    if (req.method === "POST") {
      return authLimiter(req, res, next);
    }

    next();
  },
  authRoutes
);

app.get("/api/state", requireAuth, (req, res, next) => {
  try {
    const row = db
      .prepare(
        "select state_json, updated_at from finance_state where user_id = ?"
      )
      .get(req.user.id);

    res.json({
      state: row ? JSON.parse(row.state_json) : null,
      updatedAt: row?.updated_at || null
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/state", requireAuth, (req, res, next) => {
  try {
    if (
      !req.body ||
      typeof req.body !== "object" ||
      Array.isArray(req.body) ||
      !req.body.state ||
      typeof req.body.state !== "object" ||
      Array.isArray(req.body.state)
    ) {
      throw new ApiError(
        400,
        "State must be a JSON object.",
        "INVALID_STATE"
      );
    }

    const { state } = req.body;

    for (const collection of [
      "transactions",
      "budgets",
      "goals",
      "bills",
      "billPayments",
      "expenses"
    ]) {
      if (
        state[collection] !== undefined &&
        !Array.isArray(state[collection])
      ) {
        throw new ApiError(
          400,
          `${collection} must be an array.`,
          "INVALID_STATE"
        );
      }
    }

    const stateJson = JSON.stringify(state);

    db.exec("begin immediate");

    try {
      db.prepare(`
        insert into finance_state (user_id, state_json, updated_at)
        values (?, ?, datetime('now'))
        on conflict(user_id) do update
        set state_json = excluded.state_json,
            updated_at = datetime('now')
      `).run(req.user.id, stateJson);

      db.prepare(
        "delete from finance_records where user_id = ?"
      ).run(req.user.id);

      const insertRecord = db.prepare(`
        insert into finance_records
        (user_id, collection, record_id, data_json)
        values (?, ?, ?, ?)
      `);

      for (const collection of [
        "transactions",
        "budgets",
        "goals",
        "bills",
        "billPayments",
        "expenses"
      ]) {
        for (const [index, record] of (
          state[collection] || []
        ).entries()) {
          if (
            !record ||
            typeof record !== "object" ||
            Array.isArray(record)
          ) {
            throw new ApiError(
              400,
              `${collection} entries must be JSON objects.`,
              "INVALID_STATE"
            );
          }

          const id =
            typeof record.id === "string" && record.id
              ? record.id
              : `${collection}-${index}`;

          insertRecord.run(
            req.user.id,
            collection,
            id,
            JSON.stringify(record)
          );
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

app.delete("/api/state", requireAuth, (req, res, next) => {
  try {
    db.exec("begin immediate");

    try {
      db.prepare(
        "delete from finance_state where user_id = ?"
      ).run(req.user.id);

      db.prepare(
        "delete from finance_records where user_id = ?"
      ).run(req.user.id);

      db.exec("commit");
    } catch (error) {
      db.exec("rollback");
      throw error;
    }

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

const publicFiles = new Set([
  "/login.html",
  "/signup.html",
  "/script.js",
  "/auth.js",
  "/style.css"
]);

const protectedPages = new Set([
  "/index.html",
  "/inputs.html",
  "/dashboard.html",
  "/transactions.html",
  "/budgets.html",
  "/goals.html",
  "/bills.html",
  "/reports.html",
  "/loans.html",
  "/ai.html"
]);

const frontendPath = path.resolve(__dirname, "../../frontend");

const staticOptions = {
  dotfiles: "deny",
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-store");
    }
  }
};

app.get("/", (req, res, next) => {
  try {
    res.redirect(
      findSessionUser(req) ? "/index.html" : "/login.html"
    );
  } catch (error) {
    next(error);
  }
});

app.use((req, res, next) => {
  if (
    req.path === "/login.html" ||
    req.path === "/signup.html"
  ) {
    try {
      if (findSessionUser(req)) {
        return res.redirect("/index.html");
      }
    } catch (error) {
      return next(error);
    }
  }

  if (protectedPages.has(req.path)) {
    try {
      if (!findSessionUser(req)) {
        return res.redirect("/login.html");
      }

      return express.static(
        frontendPath,
        staticOptions
      )(req, res, next);
    } catch (error) {
      return next(error);
    }
  }

  if (!publicFiles.has(req.path)) {
    return next();
  }

  express.static(frontendPath, {
    ...staticOptions,
    index: "index.html"
  })(req, res, next);
});

app.use(notFound);
app.use(errorHandler);

if (require.main === module) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      "PORT must be an integer between 1 and 65535."
    );
  }

  app.listen(port, "127.0.0.1", () => {
    console.log(
      `FinWise server listening on http://localhost:${port}`
    );
  });
}

module.exports = app;