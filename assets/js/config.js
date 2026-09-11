// ============================================================
// Copy this file to `assets/js/config.js` (which is gitignored —
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
  url: "https://ozffuczcgozxdpqoumee.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96ZmZ1Y3pjZ296eGRwcW91bWVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0OTg1OTQsImV4cCI6MjEwNDA3NDU5NH0.VTD-H5lg_PdHdcC2Y2aldx_am_pC0gVkSRSwZ-oPDHQ"
};
