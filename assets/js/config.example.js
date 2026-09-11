// ============================================================
// Copy this file to `assets/config.js` (which is gitignored —
// see .gitignore) and fill in your project's own values.
//
// assets/config.js must NEVER be committed to git. In CI/CD
// (e.g. GitHub Actions deploying to GitHub Pages), generate it
// at build time from GitHub Secrets instead of committing it —
// see .github/workflows/deploy.yml for an example.
//
// The Supabase "anon" key is not a secret by design (Supabase's
// own docs say it's safe to ship in client code), but keeping it
// out of the repo entirely means:
//   - the key can be rotated without a code change / git history
//   - no habit of hardcoding forms if a real secret gets added later
//   - different keys per environment (staging/prod) without branches
// ============================================================
window.__SUPABASE_CONFIG__ = {
  url: "https://YOUR-PROJECT.supabase.co",
  anonKey: "YOUR_SUPABASE_ANON_KEY"
};
