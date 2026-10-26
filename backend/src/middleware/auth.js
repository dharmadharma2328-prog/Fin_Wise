const { createHash } = require("node:crypto");
const { db } = require("../db/database");
const { ApiError } = require("./errors");

const SESSION_COOKIE = "finwise_session";
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

function getSessionToken(req) {
  const cookies = (req.headers.cookie || "").split(";");
  const sessionCookie = cookies.find((cookie) => cookie.trim().startsWith(`${SESSION_COOKIE}=`));
  return sessionCookie ? sessionCookie.trim().slice(SESSION_COOKIE.length + 1) : "";
}

function findSessionUser(req) {
  const token = getSessionToken(req);
  if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) return null;

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const session = db.prepare(`
    select users.id, users.email, sessions.expires_at
    from sessions join users on users.id = sessions.user_id
    where sessions.token_hash = ?
  `).get(tokenHash);
  if (!session) return null;
  if (session.expires_at <= Date.now()) {
    db.prepare("delete from sessions where token_hash = ?").run(tokenHash);
    return null;
  }
  return { id: session.id, email: session.email };
}

function requireAuth(req, res, next) {
  try {
    const user = findSessionUser(req);
    if (!user) throw new ApiError(401, "Sign in to continue.", "UNAUTHENTICATED");
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

function requireSameOrigin(req, res, next) {
  const origin = req.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.get("host")) {
        throw new ApiError(403, "This request is not allowed.", "INVALID_ORIGIN");
      }
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      return next(new ApiError(403, "This request is not allowed.", "INVALID_ORIGIN"));
    }
  }
  next();
}

module.exports = {
  SESSION_COOKIE,
  SESSION_DURATION_MS,
  findSessionUser,
  requireAuth,
  requireSameOrigin
};
