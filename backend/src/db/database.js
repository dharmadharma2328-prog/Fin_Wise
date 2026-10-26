const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const projectRoot = path.resolve(__dirname, "../../..");
const databasePath = path.resolve(process.env.FINWISE_DB_PATH || path.join(projectRoot, "database", "finwise.db"));
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec("pragma foreign_keys = on; pragma journal_mode = wal; pragma busy_timeout = 5000;");

const existingStateColumns = db.prepare("pragma table_info(finance_state)").all();
if (existingStateColumns.length && !existingStateColumns.some((column) => column.name === "user_id")) {
  db.exec(`
    begin immediate;
    alter table finance_state rename to legacy_finance_state;
    drop index if exists finance_records_collection_idx;
    alter table finance_records rename to legacy_finance_records;
    commit;
  `);
}

db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));

module.exports = { db, databasePath };
