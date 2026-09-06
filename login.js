// login.js
import { supabase } from './assets/supabaseClient.js';

const form = document.getElementById('loginForm');
const errorBanner = document.getElementById('errorBanner');
const submitBtn = document.getElementById('submitBtn');
const btnText = document.getElementById('btnText');
const loadingSpinner = document.getElementById('loadingSpinner');

const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const rememberMeCheckbox = document.getElementById('remember-me');
const togglePasswordBtn = document.getElementById('togglePassword');

const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
const forgotModal = document.getElementById('forgotModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const forgotForm = document.getElementById('forgotForm');
const resetEmail = document.getElementById('resetEmail');
const resetErrorBanner = document.getElementById('resetErrorBanner');
const resetSuccessBanner = document.getElementById('resetSuccessBanner');
const resetSubmitBtn = document.getElementById('resetSubmitBtn');
const resetBtnText = document.getElementById('resetBtnText');

// Only remember the email address, never the password. This is a
// convenience value, not a credential — fine to keep in localStorage.
const REMEMBER_KEY = 'event_portal_remembered_email';

togglePasswordBtn.addEventListener('click', () => {
  const isHidden = passwordInput.type === 'password';
  passwordInput.type = isHidden ? 'text' : 'password';
  togglePasswordBtn.textContent = isHidden ? 'Hide' : 'Show';
});

window.addEventListener('DOMContentLoaded', () => {
  const savedEmail = localStorage.getItem(REMEMBER_KEY);
  if (savedEmail) {
    emailInput.value = savedEmail;
    rememberMeCheckbox.checked = true;
  }
});

// If already signed in (verified server-side), skip straight to the homepage.
(async function redirectIfLoggedIn() {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) window.location.replace('./index.html');
})();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBanner.classList.add('hidden');
  submitBtn.disabled = true;
  btnText.textContent = 'Signing in…';
  loadingSpinner.classList.remove('hidden');

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (rememberMeCheckbox.checked) {
    localStorage.setItem(REMEMBER_KEY, email);
  } else {
    localStorage.removeItem(REMEMBER_KEY);
  }

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    window.location.replace('./index.html');
  } catch (err) {
    // Deliberately generic — never reveal whether the email exists.
    errorBanner.textContent = 'Invalid email or password.';
    errorBanner.classList.remove('hidden');
    submitBtn.disabled = false;
    btnText.textContent = 'Sign in';
    loadingSpinner.classList.add('hidden');
  }
});

forgotPasswordBtn.addEventListener('click', () => {
  if (emailInput.value) resetEmail.value = emailInput.value;
  resetErrorBanner.classList.add('hidden');
  resetSuccessBanner.classList.add('hidden');
  forgotModal.classList.remove('hidden');
});

closeModalBtn.addEventListener('click', () => forgotModal.classList.add('hidden'));
forgotModal.addEventListener('click', (e) => {
  if (e.target === forgotModal) forgotModal.classList.add('hidden');
});

forgotForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  resetErrorBanner.classList.add('hidden');
  resetSuccessBanner.classList.add('hidden');
  resetSubmitBtn.disabled = true;
  resetBtnText.textContent = 'Sending link…';

  const email = resetEmail.value.trim();

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      // Resolved relative to the current page URL (not origin + a
      // hardcoded path) so this still points at the right place
      // whether the site is served at a domain root or under a
      // GitHub Pages subpath like https://yourname.github.io/event/.
      redirectTo: new URL('login.html', window.location.href).toString()
    });
    if (error) throw error;

    resetSuccessBanner.textContent = 'If that email has an account, reset instructions have been sent.';
    resetSuccessBanner.classList.remove('hidden');
    setTimeout(() => forgotModal.classList.add('hidden'), 4000);
  } catch (err) {
    // Same generic message regardless of outcome — avoids leaking
    // which email addresses have accounts.
    resetSuccessBanner.textContent = 'If that email has an account, reset instructions have been sent.';
    resetSuccessBanner.classList.remove('hidden');
  } finally {
    resetSubmitBtn.disabled = false;
    resetBtnText.textContent = 'Send reset link';
  }
});
