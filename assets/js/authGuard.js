// assets/authGuard.js
//
// Include this as the very first <script type="module"> on any page
// that must only be visible to a logged-in Supabase user
// (index.html, invitees.html).
//
// Security notes vs. the previous version:
//  - Page content fades in only after the check resolves, so an
//    unauthenticated visitor never sees a flash of real data before
//    the redirect fires.
//  - We hide document.body (not document.documentElement) and set
//    the html background via CSS (assets/css/styles.css) so the brief
//    hidden window shows the app's own background color instead of
//    a jarring blank-white flash — html itself stays visible and
//    keeps painting its background even while body is hidden.
//  - Uses supabase.auth.getUser() rather than getSession() for the
//    initial check. getSession() only reads the token that's already
//    sitting in local storage and does NOT verify it; getUser() makes
//    a call to Supabase Auth to confirm the token is still valid.
//    This matters here because the actual protection lives in the
//    database's Row Level Security policies (this guard only decides
//    whether to *show the page* — it is a UX convenience, not the
//    security boundary).
import { supabase } from '../../supabase/supabaseClient.js';

document.body.style.opacity = '0';

function goToLogin() {
  // Relative path (not '/login.html') so this works whether the site
  // is served at a domain root or under a GitHub Pages subpath like
  // https://yourname.github.io/event/.
  const depth = window.location.pathname.includes('/pages/') ? '../' : './';
  window.location.replace(new URL(depth + 'login.html', window.location.href).toString());
}

async function checkAuth() {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      goToLogin();
      return;
    }
    document.body.style.opacity = '1';
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
