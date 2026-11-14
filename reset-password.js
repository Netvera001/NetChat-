import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, verifyPasswordResetCode, confirmPasswordReset, applyActionCode } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCbwcl2SX_oogemIA4Z9pdZmhBAPXQDzA4',
  authDomain: 'example-48a2b.firebaseapp.com',
  projectId: 'example-48a2b',
  storageBucket: 'example-48a2b.firebasestorage.app',
  messagingSenderId: '242187342146',
  appId: '1:242187342146:web:2c9861750c9a69d45bb8db',
  measurementId: 'G-K4BJ5VLEFS'
};

const auth = getAuth(initializeApp(firebaseConfig));
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const mode = params.get('mode');
const oobCode = params.get('oobCode');
const form = $('resetForm');
const checking = $('checking');
const result = $('result');
const submitBtn = $('submitBtn');
let verifiedEmail = '';

$('year').textContent = new Date().getFullYear();

function showResult(message, kind) {
  result.textContent = message;
  result.className = `result ${kind}`;
  result.hidden = false;
}
function showInvalidLink(message = 'This password-reset link is invalid, expired, or has already been used. Request a new reset email from NetChat.') {
  checking.hidden = true;
  form.hidden = true;
  $('pageTitle').textContent = 'Action link unavailable';
  $('introText').textContent = 'For your security, email action links can only be used once and expire after a limited time.';
  $('stateIcon').innerHTML = '<span class="material-symbols-outlined">link_off</span>';
  showResult(message, 'error');
  const link = $('backLink');
  link.textContent = 'Return to NetChat and request a new link';
  link.href = 'auth.html#login';
}

// Firebase's custom action URL is shared by email templates, so handle both
// password-reset and email-verification action codes on this branded page.
if (!oobCode || !['resetPassword', 'verifyEmail'].includes(mode)) {
  showInvalidLink('This link is missing required security information. Request a fresh email from NetChat.');
} else if (mode === 'verifyEmail') {
  try {
    await applyActionCode(auth, oobCode);
    checking.hidden = true;
    form.hidden = true;
    $('stateIcon').innerHTML = '<span class="material-symbols-outlined">mark_email_read</span>';
    $('pageTitle').textContent = 'Email verified';
    $('introText').textContent = 'Your email address has been verified successfully. You can now sign in to NetChat.';
    showResult('Email verification complete. Your NetChat account is ready for sign-in.', 'success');
    $('backLink').textContent = 'Continue to NetChat sign in';
    $('backLink').href = 'auth.html#login';
  } catch (error) {
    console.error('Email verification failed:', error);
    showInvalidLink('This verification link is invalid, expired, or has already been used. Request a new verification email from NetChat.');
  }
} else {
  try {
    verifiedEmail = await verifyPasswordResetCode(auth, oobCode);
    checking.hidden = true;
    form.hidden = false;
    $('introText').textContent = `Choose a new password for ${verifiedEmail}.`;
  } catch (error) {
    console.error('Password reset link verification failed:', error);
    showInvalidLink();
  }
}

document.querySelectorAll('.reveal').forEach((button) => {
  button.addEventListener('click', () => {
    const input = $(button.dataset.target);
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    button.querySelector('.material-symbols-outlined').textContent = reveal ? 'visibility_off' : 'visibility';
    button.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
  });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = $('newPassword').value;
  const confirmation = $('confirmPassword').value;
  result.hidden = true;
  if (password.length < 8) {
    showResult('Your new password must contain at least 8 characters.', 'error');
    $('newPassword').focus();
    return;
  }
  if (password !== confirmation) {
    showResult('The passwords do not match. Please check and try again.', 'error');
    $('confirmPassword').focus();
    return;
  }

  submitBtn.disabled = true;
  submitBtn.querySelector('span:first-child').textContent = 'Updating password…';
  try {
    await confirmPasswordReset(auth, oobCode, password);
    form.hidden = true;
    $('stateIcon').innerHTML = '<span class="material-symbols-outlined">check_circle</span>';
    $('pageTitle').textContent = 'Password updated';
    $('introText').textContent = 'Your NetChat password has been changed successfully.';
    showResult('Your new password is ready. Return to NetChat and sign in with it.', 'success');
    $('backLink').textContent = 'Continue to NetChat sign in';
    $('backLink').href = 'auth.html#login';
  } catch (error) {
    console.error('Password update failed:', error);
    if (['auth/expired-action-code', 'auth/invalid-action-code'].includes(error.code)) {
      showInvalidLink();
    } else if (error.code === 'auth/weak-password') {
      showResult('Firebase rejected that password as too weak. Choose a stronger password and try again.', 'error');
    } else {
      showResult('We could not update your password. Check your connection and try again.', 'error');
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.querySelector('span:first-child').textContent = 'Save new password';
  }
});
