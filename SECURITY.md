# What changed, and why

## 1. Design / consistency
- All four pages now share one design system: `assets/css/styles.css`, built
  on top of Bootstrap 5 (CDN) instead of four separate, drifting sets of
  hand-rolled CSS variables and component styles.
- Page-specific rules that genuinely don't belong on every page
  (`register.css`, `invitees.css`) are kept small and layered on top,
  instead of ~300 lines of duplicated `<style>` blocks per file.

## 2. Structure
- Every page's inline `<script>` block was moved into its own file
  (`login.js`, `register.js`, `dashboard.js`, `invitees.js`), all loaded
  as ES modules.
- All inline `onclick=`/`onchange=`/`oninput=` attributes were replaced
  with `addEventListener` calls in the matching `.js` file. This isn't
  just tidiness — inline handlers are incompatible with a strict
  `script-src` Content-Security-Policy, which you should add once this
  is deployed (see below).
- **One Supabase client, one place**: `assets/supabaseClient.js`. Previously
  the URL/anon key were pasted into `dashboard.html`, `register.html`,
  `invitees.html`, and (as a placeholder that was never filled in)
  `login.html`. Now every page imports the same module — which is also
  why `login.html` now actually works, since it was previously not
  wired up to any real Supabase project.

## 3. Config out of git history
- `assets/config.js` (real URL/anon key) is **gitignored**.
  `assets/config.example.js` is committed as the template.
- `.github/workflows/deploy.yml` shows how to generate the real
  `config.js` at deploy time from GitHub Actions secrets, so the key
  never touches your git history at all — useful if you rotate it, or
  if you later add anything more sensitive.
- The Supabase **anon** key is designed by Supabase to be public
  (it's meaningless without Row Level Security behind it), so this
  step is about hygiene and rotation flexibility, not hiding a secret.
  The **service_role** key must never appear in any client file or
  commit — `.gitignore` also blocks anything matching `*service_role*`.

## 4. The real fix: anon → authenticated
This is the important part, and it lives in `supabase-security.sql`,
not in the JavaScript:

- **Before**: `invitees.html` called
  `db.from('invitees').select()/.insert()/.delete()` directly with the
  anon key. If Row Level Security on that table were ever off or
  misconfigured, *anyone* holding the anon key (which is sitting in
  public JS, by design) could read, insert into, or wipe the table —
  with no login required — by calling the Supabase REST API directly,
  completely bypassing `login.html` and `authGuard.js`.
- **After**: the `invitees` and `attendees` tables have RLS enabled
  with **no policy for `anon` at all**, and table grants are revoked
  from `anon`/`public` outright. All reads/writes go through
  `SECURITY DEFINER` RPC functions:
  - `check_employee`, `register_participant` — the only two functions
    granted to `anon`, used exclusively by the public kiosk
    (`register.html`). Deliberately narrow: check one employee ID,
    register one participant.
  - `get_dashboard_stats`, `list_attendees`, `admin_list_employee_ids`,
    `admin_list_invitees`, `admin_append_invitees`,
    `admin_overwrite_invitees`, `admin_delete_attendee`,
    `admin_clear_attendees`, `admin_delete_invitee`,
    `admin_clear_invitees` — granted **only** to `authenticated`,
    revoked from `anon`. These back `index.html`/`invitees.html`,
    including the per-row delete buttons and the "Danger zone" clear-
    table actions.
- `authGuard.js` was upgraded from `getSession()` (reads whatever
  token is in local storage, unverified) to `getUser()` (round-trips
  to Supabase Auth to confirm the token is actually still valid). This
  matters because `authGuard.js` is only a UX convenience that decides
  whether to show the page — the actual security boundary is always
  the database grants/RLS above, not anything running in the browser.

**You must run `supabase-security.sql`** (adjusting table/column names
and the `check_employee`/`register_participant`/`get_dashboard_stats`/
`list_attendees` bodies to match whatever you already have) for any of
this to take effect — shipping the new HTML/JS alone doesn't change
your database's permissions.

## 5. Login uses real Supabase Auth users
- `login.html` previously had `SUPABASE_URL = 'YOUR_SUPABASE_URL'` —
  a placeholder that meant login never actually worked against your
  project. It's now wired to the real project via
  `assets/supabaseClient.js` and calls
  `supabase.auth.signInWithPassword(...)`.
- There is intentionally **no public sign-up form**. Create accounts
  for dashboard/invitees admins in the Supabase dashboard under
  **Authentication → Users → Add user**, and turn off "Allow new users
  to sign up" under **Authentication → Providers → Email** so the only
  way to get an account is for you to create one.
- Login errors are deliberately generic ("Invalid email or password")
  and the password-reset flow doesn't reveal whether an email has an
  account — both avoid leaking who has a login.

## 6. Other fixes carried over / added
- CSV export still neutralizes formula-injection characters
  (`=`, `+`, `-`, `@`) and quote-escapes every field.
- Table rendering still uses `textContent`, never `innerHTML`, for any
  user-submitted data (stored-XSS prevention) — this was already
  correct in `dashboard.html` and is preserved as-is.
- `escapeHtml()` is used consistently in `invitees.js` wherever
  user-controlled strings are placed into `innerHTML`.

## Recommended next steps (not code changes, but worth doing)
1. Run `supabase-security.sql`, adapted to your actual schema.
2. In Supabase: disable public sign-ups, add a Content-Security-Policy
   header at your host/CDN, and restrict Auth redirect URLs to your
   real domain.
3. Rotate the anon key once (Project Settings → API → "Reset" —
   optional, since it's not a secret, but reasonable since this
   version's key had been sitting in a public repo).
4. Turn on GitHub's secret scanning + push protection for this repo
   (Settings → Code security and analysis) so any future accidental
   commit of a real secret (e.g. a service_role key) is blocked/flagged
   automatically.
5. Enable a branch protection rule on `main` (require PR review before
   merge) so changes to `supabase-security.sql` or auth logic get a
   second pair of eyes.
