# GrievanceAI backend

Node + Express server that serves the GrievanceAI page **and** the API behind it.
Gemini does sentiment, summaries and extra urgency signals; the safety rules stay in code; officers make the final call.

## Run
```
npm install
cp .env.example .env      # then edit .env
npm start                 # http://localhost:3000
npm test                  # offline tests with a fake Gemini
```
`.env`: `GEMINI_API_KEY` (from https://aistudio.google.com/apikey), `SUPERADMIN_USER` (defaults to `superadmin`), `SUPERADMIN_PASSWORD` (choose a strong password), optional `SUPERADMIN_NAME`, `SUPERADMIN_EMAIL`, `GEMINI_MODEL`, and `PORT`. `OFFICER_PIN` is only a migration fallback to seed the initial `superadmin` password when `SUPERADMIN_PASSWORD` has not been configured; the shared-PIN login endpoint is disabled. Prefer a strong `SUPERADMIN_PASSWORD`.
Without a Gemini key everything still works on the built-in rules. Keep all credentials and API keys only in `.env`; never put them in the page.

## API
| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | /api/analyze | public | demo analysis `{text}` |
| POST | /api/complaints | public | submit, returns `{id}` |
| GET | /api/complaints/:id | public | status, log, reply only |
| POST | /api/login | public | `{username,password}` -> bearer token (8 h); legacy `{pin}` is also accepted when configured |
| GET | /api/me | officer/admin | current signed-in user |
| GET | /api/admin/officers | admin/superadmin | list department officer accounts (no hashes/passwords) |
| POST | /api/admin/officers | admin/superadmin | create department officer; omit password to generate one |
| POST | /api/admin/officers/:id/reset-password | admin/superadmin | change password; omit password to generate one |
| PATCH | /api/admin/officers/:id/status | admin/superadmin | activate/deactivate officer |
| DELETE | /api/admin/officers/:id | admin/superadmin | permanently delete a department officer |
| GET | /api/officer/complaints?status=&priority=&dept= | officer/admin | list complaints; officers are restricted to their assigned department |
| PATCH | /api/officer/complaints/:id | officer/admin | `{priority,status,reply}`; department access is enforced on the server |
| GET | /api/officer/stats | officer/admin | analytics scoped to the signed-in user's permissions |
| POST | /api/citizen/register | public | `{fullName,mobile,email?,ward?,password}` -> creates a citizen account and returns a bearer token (8 h) |
| POST | /api/citizen/login | public | `{identifier,password}` (mobile number or email) -> bearer token (8 h) |
| GET | /api/citizen/me | citizen | current signed-in citizen's basic details |
| POST | /api/citizen/logout | citizen | ends the citizen session |
| GET | /api/health | public | shows whether Gemini is on |

## Behaviour worth knowing
- Priority = safety rules OR Gemini's safety flag (so Hindi/Hinglish danger reports are caught), then repeat / timeline / age rules. Sentiment never changes priority.
- Phone numbers and emails in complaint text are masked before text goes to Gemini. The separate contact field is returned only to authorised officers who can access the complaint and to administrators.
- If Gemini fails or times out (20 s), the complaint is still triaged by rules.
- Complaints persist in `data/db.json`; officer accounts persist in `data/officers.json`. Passwords are stored as scrypt hashes, never plain text. Keep the `data` directory private and back it up securely. These JSON stores are suitable for a prototype; use a managed database and stronger operational controls for production.
- Department officers see and update only complaints matching their assigned department. A `admin`/`superadmin` account can view all departments and is the only role allowed to manage officer accounts. Complaint contact details are returned only to authorised users who can access that complaint.
- After a department officer signs in, the authenticated Officer Portal opens in a separate browser tab. If the browser blocks pop-ups, the portal falls back to the current tab. Administrator sign-in stays in the current tab. The top-right profile icon opens an account menu with role/department details, a new-tab portal action, and sign out; the portal also has a visible Sign out button.
- Citizen accounts (name, mobile, optional email and ward) persist in `data/citizens.json` as scrypt password hashes. Citizen sessions are separate from officer sessions: a citizen token never works on officer or admin endpoints, and vice versa. The Citizen Login page is in the top navigation.
- Rate limits and a login limiter are in memory. Run behind HTTPS in production.
- Not built: file attachments (the upload field is on the form but files are not stored).
