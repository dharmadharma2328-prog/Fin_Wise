const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const databasePath = path.join(os.tmpdir(), `finwise-test-${process.pid}.sqlite`);
process.env.FINWISE_DB_PATH = databasePath;

const legacyState = {
  income: 2500,
  transactions: [{ id: "legacy-transaction", type: "income", amount: 2500 }],
  budgets: [],
  goals: [],
  bills: [],
  billPayments: []
};
const legacyDb = new DatabaseSync(databasePath);
legacyDb.exec(`
  create table finance_state (
    id integer primary key check (id = 1),
    state_json text not null check (json_valid(state_json)),
    updated_at text not null default (datetime('now'))
  );
  create table finance_records (
    collection text not null,
    record_id text not null,
    data_json text not null check (json_valid(data_json)),
    primary key (collection, record_id)
  );
  create index finance_records_collection_idx on finance_records(collection);
`);
legacyDb.prepare("insert into finance_state (id, state_json) values (1, ?)").run(JSON.stringify(legacyState));
legacyDb.prepare("insert into finance_records (collection, record_id, data_json) values (?, ?, ?)")
  .run("transactions", "legacy-transaction", JSON.stringify(legacyState.transactions[0]));
legacyDb.close();

const app = require("../backend/src/server");
const { db } = require("../backend/src/db/database");

test("authenticates local accounts and isolates migrated SQLite finance data", async (t) => {
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
  const signUp = async (email, password) => {
    const response = await request("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    return { response, cookie };
  };

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    db.close();
    for (const filePath of [databasePath, `${databasePath}-shm`, `${databasePath}-wal`]) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  });

  const protectedPage = await request("/dashboard.html");
  assert.equal(protectedPage.status, 302);
  assert.equal(protectedPage.headers.get("location"), "/login.html");
  assert.equal((await request("/")).headers.get("location"), "/login.html");
  const loginPage = await request("/login.html");
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /google-signin-button/);
  assert.match(loginPage.headers.get("content-security-policy"), /https:\/\/accounts\.google\.com/);

  const unauthenticatedState = await request("/api/state");
  assert.equal(unauthenticatedState.status, 401);

  const { response: firstSignup, cookie: firstCookie } = await signUp("First@Example.com", "first-password-123");
  assert.equal(firstSignup.status, 201);
  assert.ok(firstCookie);
  assert.match(firstSignup.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  const firstUser = (await firstSignup.json()).user;
  assert.equal(firstUser.email, "first@example.com");
  const passwordRow = db.prepare("select password_hash from users where id = ?").get(firstUser.id);
  assert.notEqual(passwordRow.password_hash, "first-password-123");
  assert.equal(passwordRow.password_hash.length, 128);
  assert.notEqual(db.prepare("select token_hash from sessions where user_id = ?").get(firstUser.id).token_hash,
    firstCookie.split("=")[1]);

  const migrated = await request("/api/state", {}, firstCookie);
  assert.equal(migrated.status, 200);
  assert.deepEqual((await migrated.json()).state, legacyState);
  assert.equal(db.prepare("select count(*) as count from finance_records where user_id = ?").get(firstUser.id).count, 1);
  assert.equal(db.prepare("select count(*) as count from sqlite_master where name like 'legacy_finance_%'").get().count, 0);

  const firstState = {
    income: 5000,
    transactions: [{ id: "first-transaction", type: "income", amount: 5000 }],
    budgets: [],
    goals: [],
    bills: [],
    billPayments: []
  };
  const savedFirstState = await request("/api/state", {
    method: "PUT",
    body: JSON.stringify({ state: firstState })
  }, firstCookie);
  assert.equal(savedFirstState.status, 200);

  const duplicateSignup = await signUp("first@example.com", "another-password-123");
  assert.equal(duplicateSignup.response.status, 409);

  const { response: secondSignup, cookie: secondCookie } = await signUp("second@example.com", "second-password-123");
  assert.equal(secondSignup.status, 201);
  assert.ok(secondCookie);
  const secondUser = (await secondSignup.json()).user;

  const emptySecondState = await request("/api/state", {}, secondCookie);
  assert.equal((await emptySecondState.json()).state, null);

  const secondState = {
    income: 9000,
    transactions: [{ id: "second-transaction", type: "income", amount: 9000 }],
    budgets: [],
    goals: [],
    bills: [],
    billPayments: []
  };
  const savedSecondState = await request("/api/state", {
    method: "PUT",
    body: JSON.stringify({ state: secondState })
  }, secondCookie);
  assert.equal(savedSecondState.status, 200);
  assert.equal(db.prepare("select count(*) as count from finance_records where user_id = ?").get(secondUser.id).count, 1);

  const crossOriginWrite = await request("/api/state", {
    method: "PUT",
    headers: { Origin: "http://example.com" },
    body: JSON.stringify({ state: { income: 1 } })
  }, secondCookie);
  assert.equal(crossOriginWrite.status, 403);

  const wrongPassword = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: firstUser.email, password: "incorrect-password" })
  });
  assert.equal(wrongPassword.status, 401);

  const logout = await request("/api/auth/logout", { method: "POST" }, secondCookie);
  assert.equal(logout.status, 204);
  assert.equal((await request("/api/state", {}, secondCookie)).status, 401);

  const login = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "FIRST@example.com", password: "first-password-123" })
  });
  assert.equal(login.status, 200);
  const loginCookie = login.headers.get("set-cookie")?.split(";")[0];
  const firstStateAfterLogin = await request("/api/state", {}, loginCookie);
  assert.deepEqual((await firstStateAfterLogin.json()).state, firstState);
  assert.equal((await request("/dashboard.html", {}, loginCookie)).status, 200);
  const authenticatedSignupPage = await request("/signup.html", {}, loginCookie);
  assert.equal(authenticatedSignupPage.status, 302);
  assert.equal(authenticatedSignupPage.headers.get("location"), "/index.html");

  const hiddenDatabase = await request("/database/finwise.db", {}, loginCookie);
  assert.equal(hiddenDatabase.status, 404);

  const cleared = await request("/api/state", { method: "DELETE" }, loginCookie);
  assert.equal(cleared.status, 204);
  assert.equal((await (await request("/api/state", {}, loginCookie)).json()).state, null);

  const unauthenticatedDelete = await request("/api/auth/account", { method: "DELETE" });
  assert.equal(unauthenticatedDelete.status, 401);
  const deleteAccount = await request("/api/auth/account", { method: "DELETE" }, loginCookie);
  assert.equal(deleteAccount.status, 204);
  assert.match(deleteAccount.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(db.prepare("select count(*) as count from users where id = ?").get(firstUser.id).count, 0);
  assert.equal(db.prepare("select count(*) as count from sessions where user_id = ?").get(firstUser.id).count, 0);
  assert.equal(db.prepare("select count(*) as count from finance_state where user_id = ?").get(firstUser.id).count, 0);
  assert.equal(db.prepare("select count(*) as count from finance_records where user_id = ?").get(firstUser.id).count, 0);
  assert.equal(db.prepare("select count(*) as count from users where id = ?").get(secondUser.id).count, 1);
  assert.equal((await request("/api/state", {}, loginCookie)).status, 401);
});
