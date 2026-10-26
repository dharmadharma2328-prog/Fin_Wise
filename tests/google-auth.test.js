const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const databasePath = path.join(os.tmpdir(), `finwise-google-test-${process.pid}.sqlite`);
process.env.FINWISE_DB_PATH = databasePath;
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";

const { OAuth2Client } = require("google-auth-library");
const googleCredentials = new Map();
OAuth2Client.prototype.verifyIdToken = async ({ idToken, audience }) => {
  assert.equal(audience, process.env.GOOGLE_CLIENT_ID);
  const payload = googleCredentials.get(idToken);
  if (!payload) throw new Error("Unknown test credential");
  return { getPayload: () => payload };
};

function createGoogleCredential(subject, email, emailVerified = true) {
  const credential = `${"g".repeat(120)}-${subject}`;
  googleCredentials.set(credential, {
    sub: subject,
    email,
    email_verified: emailVerified
  });
  return credential;
}

const app = require("../backend/src/server");
const { db } = require("../backend/src/db/database");

test("verifies Google identities and creates safe local sessions", async (t) => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = (route, options = {}, cookie = "") => fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...options.headers
    },
    redirect: "manual"
  });

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    db.close();
    for (const filePath of [databasePath, `${databasePath}-shm`, `${databasePath}-wal`]) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  });

  const configResponse = await request("/api/auth/config");
  assert.deepEqual(await configResponse.json(), {
    googleEnabled: true,
    googleClientId: process.env.GOOGLE_CLIENT_ID
  });
  const loginPage = await request("/login.html");
  assert.match(await loginPage.text(), /google-signin-button/);
  assert.match(loginPage.headers.get("content-security-policy"), /https:\/\/accounts\.google\.com/);
  const signupPage = await request("/signup.html");
  assert.match(await signupPage.text(), /google-signin-button/);

  const invalidCredential = await request("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ credential: "x".repeat(120) })
  });
  assert.equal(invalidCredential.status, 401);

  const unverifiedCredential = createGoogleCredential("unverified-subject", "unverified@example.com", false);
  const unverifiedSignIn = await request("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ credential: unverifiedCredential })
  });
  assert.equal(unverifiedSignIn.status, 401);

  const credential = createGoogleCredential("google-subject-1", "Google@Example.com");
  const signUp = await request("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ credential })
  });
  assert.equal(signUp.status, 201);
  assert.match(signUp.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  const cookie = signUp.headers.get("set-cookie").split(";")[0];
  const user = (await signUp.json()).user;
  assert.equal(user.email, "google@example.com");
  assert.equal(db.prepare("select email from google_accounts where google_subject = ?").get("google-subject-1").email,
    user.email);
  assert.equal((await (await request("/api/state", {}, cookie)).json()).state, null);

  const login = await request("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ credential })
  });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).user.id, user.id);

  const localSignUp = await request("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email: "local@example.com", password: "local-password-123" })
  });
  assert.equal(localSignUp.status, 201);
  const collisionCredential = createGoogleCredential("google-subject-collision", "local@example.com");
  const collision = await request("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ credential: collisionCredential })
  });
  assert.equal(collision.status, 409);
});
