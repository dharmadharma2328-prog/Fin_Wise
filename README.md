# FinWise

FinWise is a personal finance app organized into separate `frontend`, `backend`, and `database` folders. Sign up or sign in to use a local account; each account's finance data is isolated in the SQLite database on this device.

## Project structure

```text
FinWise/
|-- backend/
|   |-- src/
|   |   |-- db/          SQLite connection and schema
|   |   |-- middleware/  Authentication, validation, and API errors
|   |   |-- routes/      Local signup, login, and logout endpoints
|   |   |-- services/    Finance calculations and report helpers
|   |   `-- server.js    Express API and frontend server
|   `-- .env.example     Example local settings
|-- database/            Local SQLite database (not committed)
|-- frontend/            Login/signup pages, finance pages, CSS, and browser JavaScript
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

4. Open <http://localhost:3000>. Create an account the first time, then sign in on later visits.

The server creates `database/finwise.db` automatically the first time it starts. Open this file with a SQLite viewer to inspect your saved data. No Supabase project, URL, or keys are needed. The server listens on this computer only.

Optional settings can be placed in `backend/.env`:

```text
PORT=3000
FINWISE_DB_PATH=./database/finwise.db
GOOGLE_CLIENT_ID=
```

`FINWISE_DB_PATH` is resolved from the project folder when started with `npm start`. Keep backups of the SQLite database if you need to preserve your data.

### Enable Google sign-in

Google sign-in is optional. To enable it, create an OAuth 2.0 **Web application** client in Google Cloud Console, configure the OAuth consent screen, and add `http://localhost:3000` as an authorized JavaScript origin. Copy the client ID (not a client secret) into `GOOGLE_CLIENT_ID` in `backend/.env`, then restart FinWise. Keep local settings in `backend/.env` and never put a client secret in frontend code.

Google verifies the sign-in identity and verified email. New Google accounts are stored in the local SQLite database. For safety, Google sign-in does not silently attach itself to an existing password account with the same email; use that account's password sign-in instead. Google authentication sends sign-in details to Google, but FinWise does not send your finance records or Money Guide questions to Google.

## Data and privacy

The `frontend/` folder contains the app pages, styles, and browser code. The `backend/` folder contains the Express API, account authentication, and SQLite schema. The `database/` folder contains `finwise.db`. Passwords are stored as salted scrypt hashes, and sign-in sessions use random tokens whose hashes are stored in SQLite. Financial state is stored per account in the `finance_state` and `finance_records` tables. Data from the previous single-user database is assigned to the first account created. Browser storage is refreshed from the signed-in account, and cleared on sign out. The database and its journal files are excluded from version control and are not served as public website files.

FinWise account records exist in this local database. Passwords must be at least 8 characters. There is no remote password recovery, cloud synchronization, or multi-device account service. Do not expose this server to a public network.

The project folder is under OneDrive, so the database file may also sync to your OneDrive account depending on its sync settings. Set `FINWISE_DB_PATH` in `backend/.env` to a non-OneDrive location if you want the database to remain outside that synced folder.

You can permanently delete your signed-in account from the app navigation. FinWise asks you to confirm and type `DELETE`; deleting removes the account, its sessions, and its finance data from the local database. This cannot be undone.

## Private money coach

The Money Guide analyzes the signed-in account's saved transactions, budgets, goals, bills, and retirement assumptions in browser JavaScript. It uses local finance rules and calculations, not a generative AI model. The question and finance figures are not sent to an AI provider; chat messages are not saved and disappear when the page is closed or refreshed. The underlying account data remains in the local SQLite database and is loaded through the local FinWise server. The guide offers estimates and general educational suggestions, not professional financial, tax, or investment advice.

## API

- `GET /api/health` — check that the server is running.
- `POST /api/auth/signup` — create an account with `{ "email": "...", "password": "..." }`.
- `POST /api/auth/login` — sign in and create a local session.
- `POST /api/auth/logout` — end the current session.
- `DELETE /api/auth/account` — permanently delete the signed-in account and its associated local data.
- `GET /api/auth/me` — retrieve the current account.
- `GET /api/auth/config` — return public sign-in configuration, including whether Google sign-in is enabled.
- `POST /api/auth/google` — verify a Google Identity Services ID token and create a local session.
- `GET /api/state`, `PUT /api/state`, `DELETE /api/state` — retrieve, save, or clear the signed-in account's finance state.

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
