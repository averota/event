# Event Registration Portal

Static site, no build step required. Four pages:

| Page             | Who can access it        | Purpose |
|------------------|---------------------------|---------|
| `register.html`  | Public (kiosk, no login)  | Employees/walk-ins self check-in |
| `login.html`     | Public                    | Admin sign-in |
| `dashboard.html` | Logged-in admins only     | Attendance overview + CSV export |
| `invitees.html`  | Logged-in admins only     | Upload/manage the invite list |

## Setup

1. **Database**: run `supabase-security.sql` in your Supabase project's
   SQL editor (adapt table/column names and RPC bodies to match your
   existing schema first — see the comments in that file).
2. **Auth**: in the Supabase dashboard, turn off public sign-up
   (Authentication → Providers → Email) and create admin accounts
   manually (Authentication → Users → Add user).
3. **Config**: copy `assets/config.example.js` to `assets/config.js`
   and fill in your project URL + anon key. This file is gitignored —
   see `.github/workflows/deploy.yml` for how to generate it from
   secrets at deploy time instead of committing it.
4. Serve the folder with any static host (GitHub Pages, Netlify,
   Vercel, or just a local `python -m http.server`).

See `SECURITY.md` for a full explanation of the security changes made
during this refactor and what to double-check before going live.
