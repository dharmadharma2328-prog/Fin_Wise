const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const databasePath = path.join(os.tmpdir(), `finwise-test-${process.pid}.sqlite`);
process.env.FINWISE_DB_PATH = databasePath;

const app = require("../backend/src/server");
const { db } = require("../backend/src/db/database");

test("persists finance state in SQLite and does not serve the database file", async (t) => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    db.close();
    for (const filePath of [databasePath, `${databasePath}-shm`, `${databasePath}-wal`]) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  });

  const initial = await fetch(`${baseUrl}/api/state`);
  assert.equal(initial.status, 200);
  assert.equal((await initial.json()).state, null);

  const state = {
    income: 2500,
    transactions: [{ id: "transaction-1", type: "income", amount: 2500 }],
    budgets: [],
    goals: [],
    bills: [],
    billPayments: []
  };
  const saved = await fetch(`${baseUrl}/api/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state })
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).saved, true);

  const loaded = await fetch(`${baseUrl}/api/state`);
  assert.deepEqual((await loaded.json()).state, state);
  assert.equal(db.prepare("select count(*) as count from finance_records").get().count, 1);

  const rejected = await fetch(`${baseUrl}/api/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: { transactions: [null] } })
  });
  assert.equal(rejected.status, 400);
  assert.deepEqual((await (await fetch(`${baseUrl}/api/state`)).json()).state, state);

  const hiddenDatabase = await fetch(`${baseUrl}/database/finwise.db`);
  assert.equal(hiddenDatabase.status, 404);

  const cleared = await fetch(`${baseUrl}/api/state`, { method: "DELETE" });
  assert.equal(cleared.status, 204);
  assert.equal((await (await fetch(`${baseUrl}/api/state`)).json()).state, null);
});
