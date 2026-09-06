// assets/authGuard.js
//
// Include this as the very first <script type="module"> on any page
// that must only be visible to a logged-in Supabase user
// (index.html, invitees.html).
//
// Security notes vs. the previous version:
//  - Page content is hidden (visibility:hidden) until the check
//    resolves, so an unauthenticated visitor never sees a flash of
//    real data before the redirect fires.
//  - Uses supabase.auth.getUser() rather than getSession() for the
//    initial check. getSession() only reads the token that's already
//    sitting in local storage and does NOT verify it; getUser() makes
//    a call to Supabase Auth to confirm the token is still valid.
//    This matters here because the actual protection lives in the
//    database's Row Level Security policies (this guard only decides
//    whether to *show the page* — it is a UX convenience, not the
//    security boundary).
import { supabase } from './supabaseClient.js';

document.documentElement.style.visibility = 'hidden';

function goToLogin() {
  // Relative path (not '/login.html') so this works whether the site
  // is served at a domain root or under a GitHub Pages subpath like
  // https://yourname.github.io/event/.
  window.location.replace('./login.html');
}

async function checkAuth() {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      goToLogin();
      return;
    }
    document.documentElement.style.visibility = 'visible';
  } catch (e) {
    goToLogin();
  }
}

checkAuth();

// If the user signs out (e.g. in another tab), bounce immediately.
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || !session) {
    goToLogin();
  }
});
