const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const projectRoot = path.resolve(__dirname, "../../..");
const databasePath = path.resolve(process.env.FINWISE_DB_PATH || path.join(projectRoot, "database", "finwise.db"));
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec("pragma foreign_keys = on; pragma journal_mode = wal; pragma busy_timeout = 5000;");
db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));

module.exports = { db, databasePath };
