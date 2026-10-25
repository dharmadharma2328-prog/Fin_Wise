# FinWise

FinWise is a personal finance app organized into separate `frontend`, `backend`, and `database` folders. The Express API saves the app's financial data to a local SQLite database file.

## Project structure

```text
FinWise/
|-- backend/
|   |-- src/
|   |   |-- db/          SQLite connection and schema
|   |   |-- middleware/  API error handling and validation
|   |   |-- services/    Finance calculations and report helpers
|   |   `-- server.js    Express API and frontend server
|   `-- .env.example     Example local settings
|-- database/            Local SQLite database (not committed)
|-- frontend/            HTML pages, CSS, and browser JavaScript
|-- tests/               Automated tests
|-- .gitignore
|-- package.json
`-- README.md
```

## Run the app

Requirements: Node.js 22 or later.

1. Open Command Prompt or PowerShell in the project folder.
2. Install the project packages once:

   ```powershell
   npm install
   ```

3. Start the app:

   ```powershell
   npm start
   ```

4. Open <http://localhost:3000>.

The server creates `database/finwise.db` automatically the first time it starts. Open this file with a SQLite viewer to inspect your saved data. No Supabase project, URL, or keys are needed. The server listens on this computer only.

Optional settings can be placed in `backend/.env`:

```text
PORT=3000
FINWISE_DB_PATH=./database/finwise.db
```

`FINWISE_DB_PATH` is resolved from the project folder when started with `npm start`. Keep backups of the SQLite database if you need to preserve your data.

## Data and privacy

The `frontend/` folder contains the app pages, styles, and browser code. The `backend/` folder contains the Express API and SQLite schema. The `database/` folder contains `finwise.db`. The frontend loads and saves financial state through the local API and keeps a browser copy so existing browser data can be imported into the database the first time the app runs. Database records are stored in SQLite tables named `finance_state` and `finance_records`. The database and its journal files are excluded from version control and are not served as public website files.

This is a single-user local application, not a hosted or multi-user service. Do not expose its server to a public network.

The project folder is under OneDrive, so the database file may also sync to your OneDrive account depending on its sync settings. Set `FINWISE_DB_PATH` in `backend/.env` to a non-OneDrive location if you want the database to remain outside that synced folder.

## API

- `GET /api/health` — check that the server is running.
- `GET /api/state` — retrieve the saved finance state.
- `PUT /api/state` — save the finance state.
- `DELETE /api/state` — clear the saved finance state.

## Tests

```powershell
npm test
```

## Push to GitHub

Create an empty repository on GitHub, then run these commands from the FinWise project folder. Replace the URL with your repository's URL:

```powershell
git init -b main
git status --short
git add .
git status
git commit -m "Add FinWise personal finance app"
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```

Before committing, confirm that `backend/.env`, `node_modules/`, and `database/finwise.db` do not appear as files to be added. `.gitignore` excludes local settings, dependencies, database files, and SQLite journal files; keep real credentials and personal financial data out of GitHub.
