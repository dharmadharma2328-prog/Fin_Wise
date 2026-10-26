const { randomBytes, randomUUID, scrypt: scryptCallback, createHash, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const express = require("express");
const { OAuth2Client } = require("google-auth-library");
const { db } = require("../db/database");
const { ApiError } = require("../middleware/errors");
const {
  SESSION_COOKIE,
  SESSION_DURATION_MS,
  findSessionUser,
  requireAuth
} = require("../middleware/auth");

const router = express.Router();
const scrypt = promisify(scryptCallback);
const PASSWORD_HASH_BYTES = 64;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim() || "";
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID || undefined);

router.get("/config", (req, res) => {
  res.json({
    googleEnabled: Boolean(GOOGLE_CLIENT_ID),
    googleClientId: GOOGLE_CLIENT_ID || null
  });
});

router.post("/google", async (req, res, next) => {
  try {
    if (!GOOGLE_CLIENT_ID) {
      throw new ApiError(503, "Google sign-in has not been configured by the app owner.", "GOOGLE_NOT_CONFIGURED");
    }

    const credential = req.body?.credential;
    if (typeof credential !== "string" || credential.length < 100 || credential.length > 8192) {
      throw new ApiError(400, "Google did not return a valid sign-in credential.", "INVALID_GOOGLE_CREDENTIAL");
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID
      });
      payload = ticket.getPayload();
    } catch {
      throw new ApiError(401, "Google sign-in could not be verified. Please try again.", "GOOGLE_VERIFICATION_FAILED");
    }

    if (!payload || typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 255 ||
        typeof payload.email !== "string" || payload.email.length > 254 || !EMAIL_PATTERN.test(payload.email) ||
        payload.email_verified !== true) {
      throw new ApiError(401, "Use a Google account with a verified email address.", "GOOGLE_EMAIL_NOT_VERIFIED");
    }

    const email = payload.email.trim().toLowerCase();
    const user = createOrFindGoogleUser(payload.sub, email);
    const sessionToken = randomBytes(32).toString("base64url");
    const sessionHash = createHash("sha256").update(sessionToken).digest("hex");
    db.prepare("delete from sessions where expires_at <= ?").run(Date.now());
    db.prepare("insert into sessions (token_hash, user_id, expires_at) values (?, ?, ?)")
      .run(sessionHash, user.id, Date.now() + SESSION_DURATION_MS);

    setSessionCookie(res, sessionToken);
    res.status(user.created ? 201 : 200).json({ user: { id: user.id, email: user.email } });
  } catch (error) {
    next(error);
  }
});

router.post("/signup", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim()) || email.trim().length > 254) {
      throw new ApiError(400, "Enter a valid email address.", "INVALID_EMAIL");
    }
    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
      throw new ApiError(400, "Password must be between 8 and 128 characters.", "INVALID_PASSWORD");
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = db.prepare("select id from users where email = ?").get(normalizedEmail);
    if (existingUser) throw new ApiError(409, "An account with this email already exists.", "EMAIL_EXISTS");

    const userId = randomUUID();
    const salt = randomBytes(16).toString("hex");
    const passwordHash = await scrypt(password, salt, PASSWORD_HASH_BYTES);
    const sessionToken = randomBytes(32).toString("base64url");
    const sessionHash = createHash("sha256").update(sessionToken).digest("hex");
    const sessionExpiry = Date.now() + SESSION_DURATION_MS;

    db.exec("begin immediate");
    try {
      db.prepare(`
        insert into users (id, email, password_hash, password_salt)
        values (?, ?, ?, ?)
      `).run(userId, normalizedEmail, passwordHash.toString("hex"), salt);

      const userCount = db.prepare("select count(*) as count from users").get().count;
      if (userCount === 1) migrateLegacyData(userId);

      db.prepare("delete from sessions where expires_at <= ?").run(Date.now());
      db.prepare("insert into sessions (token_hash, user_id, expires_at) values (?, ?, ?)")
        .run(sessionHash, userId, sessionExpiry);
      db.exec("commit");
    } catch (error) {
      db.exec("rollback");
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new ApiError(409, "An account with this email already exists.", "EMAIL_EXISTS");
      }
      throw error;
    }

    setSessionCookie(res, sessionToken);
    res.status(201).json({ user: { id: userId, email: normalizedEmail } });
  } catch (error) {
    next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim()) || email.trim().length > 254 ||
        typeof password !== "string" || password.length > 128) {
      throw new ApiError(400, "Enter a valid email address and password.", "INVALID_CREDENTIALS");
    }

    const user = db.prepare("select id, email, password_hash, password_salt from users where email = ?")
      .get(email.trim().toLowerCase());
    if (!user) throw new ApiError(401, "Email or password is incorrect.", "LOGIN_FAILED");

    const candidate = await scrypt(password, user.password_salt, PASSWORD_HASH_BYTES);
    const storedHash = Buffer.from(user.password_hash, "hex");
    if (storedHash.length !== candidate.length || !timingSafeEqual(storedHash, candidate)) {
      throw new ApiError(401, "Email or password is incorrect.", "LOGIN_FAILED");
    }

    const sessionToken = randomBytes(32).toString("base64url");
    const sessionHash = createHash("sha256").update(sessionToken).digest("hex");
    const sessionExpiry = Date.now() + SESSION_DURATION_MS;
    db.prepare("delete from sessions where expires_at <= ?").run(Date.now());
    db.prepare("insert into sessions (token_hash, user_id, expires_at) values (?, ?, ?)")
      .run(sessionHash, user.id, sessionExpiry);

    setSessionCookie(res, sessionToken);
    res.json({ user: { id: user.id, email: user.email } });
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post("/logout", (req, res, next) => {
  try {
    const user = findSessionUser(req);
    const token = getSessionToken(req);
    if (user && token) {
      const tokenHash = createHash("sha256").update(token).digest("hex");
      db.prepare("delete from sessions where token_hash = ?").run(tokenHash);
    }
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; ${getSessionCookieAttributes()}; Max-Age=0`);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.delete("/account", requireAuth, (req, res, next) => {
  try {
    db.exec("begin immediate");
    try {
      db.prepare("delete from users where id = ?").run(req.user.id);
      db.exec("commit");
    } catch (error) {
      db.exec("rollback");
      throw error;
    }
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; ${getSessionCookieAttributes()}; Max-Age=0`);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

function migrateLegacyData(userId) {
  const legacyStateExists = db.prepare(`
    select 1 as exists_flag from sqlite_master
    where type = 'table' and name = 'legacy_finance_state'
  `).get();

  if (legacyStateExists) {
    const legacyState = db.prepare("select state_json from legacy_finance_state limit 1").get();
    if (legacyState) {
      db.prepare("insert into finance_state (user_id, state_json) values (?, ?)")
        .run(userId, legacyState.state_json);
    }
  }

  const legacyRecordsExist = db.prepare(`
    select 1 as exists_flag from sqlite_master
    where type = 'table' and name = 'legacy_finance_records'
  `).get();
  if (legacyRecordsExist) {
    db.prepare(`
      insert into finance_records (user_id, collection, record_id, data_json)
      select ?, collection, record_id, data_json from legacy_finance_records
    `).run(userId);
  }

  if (legacyRecordsExist) db.exec("drop table legacy_finance_records");
  if (legacyStateExists) db.exec("drop table legacy_finance_state");
}

function getSessionToken(req) {
  const cookies = (req.headers.cookie || "").split(";");
  const sessionCookie = cookies.find((cookie) => cookie.trim().startsWith(`${SESSION_COOKIE}=`));
  return sessionCookie ? decodeURIComponent(sessionCookie.trim().slice(SESSION_COOKIE.length + 1)) : "";
}

function setSessionCookie(res, token) {
  const maxAge = Math.floor(SESSION_DURATION_MS / 1000);
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; ${getSessionCookieAttributes()}; Max-Age=${maxAge}`
  );
}

function getSessionCookieAttributes() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `HttpOnly; SameSite=Strict; Path=/${secure}`;
}

function createOrFindGoogleUser(googleSubject, email) {
  db.exec("begin immediate");
  try {
    const linkedAccount = db.prepare(`
      select users.id, users.email
      from google_accounts join users on users.id = google_accounts.user_id
      where google_accounts.google_subject = ?
    `).get(googleSubject);
    if (linkedAccount) {
      db.exec("commit");
      return { ...linkedAccount, created: false };
    }

    if (db.prepare("select id from users where email = ?").get(email)) {
      throw new ApiError(
        409,
        "This email already has a password account. Sign in with your password; Google sign-in cannot be linked automatically.",
        "EMAIL_ALREADY_REGISTERED"
      );
    }

    const userId = randomUUID();
    db.prepare(`
      insert into users (id, email, password_hash, password_salt)
      values (?, ?, ?, ?)
    `).run(userId, email, randomBytes(PASSWORD_HASH_BYTES).toString("hex"), randomBytes(16).toString("hex"));
    const userCount = db.prepare("select count(*) as count from users").get().count;
    if (userCount === 1) migrateLegacyData(userId);
    db.prepare("insert into google_accounts (google_subject, user_id, email) values (?, ?, ?)")
      .run(googleSubject, userId, email);
    db.exec("commit");
    return { id: userId, email, created: true };
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}

module.exports = router;
