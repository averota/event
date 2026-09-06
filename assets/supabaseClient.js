// assets/supabaseClient.js
//
// Single source of truth for the Supabase client. Every page imports
// this instead of re-creating its own client with a copy-pasted URL
// and key (that duplication is how login.html previously shipped with
// a placeholder URL/key that was never wired up).
//
// Configuration comes from assets/config.js (gitignored — see
// assets/config.example.js and .gitignore). If that file is missing,
// fail loudly instead of silently using a bad/placeholder client.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const config = window.__SUPABASE_CONFIG__;

if (!config || !config.url || !config.anonKey) {
  document.body.innerHTML =
    '<div style="font-family:sans-serif;max-width:560px;margin:10vh auto;padding:24px;' +
    'border:1px solid #E1E4E9;border-radius:10px;background:#fff;color:#1B1F27;">' +
    '<h2 style="margin-top:0;">Missing Supabase configuration</h2>' +
    '<p>Copy <code>assets/config.example.js</code> to <code>assets/config.js</code> ' +
    'and fill in your project URL and anon key, or set it via your deploy pipeline.</p>' +
    '</div>';
  throw new Error('Missing window.__SUPABASE_CONFIG__ — see assets/config.example.js');
}

export const supabase = createClient(config.url, config.anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
