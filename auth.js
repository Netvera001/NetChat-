import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";

import{
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    sendEmailVerification,
    reload,
    signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js"

import {
    getFirestore,
    collection,
    query,
    where,
    getDocs,
    getDoc,
    setDoc,
    doc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCbwcl2SX_oogemIA4Z9pdZmhBAPXQDzA4",
    authDomain: "example-48a2b.firebaseapp.com",
    projectId: "example-48a2b",
    storageBucket: "example-48a2b.firebasestorage.app",
    messagingSenderId: "242187342146",
    appId: "1:242187342146:web:2c9861750c9a69d45bb8db",
    measurementId: "G-K4BJ5VLEFS"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
const database = getFirestore(app);


(function () {
    'use strict';

    /* ---------- element refs ---------- */
    const $ = function (id) { return document.getElementById(id); };
    const fullNameIn = $('fullName'), nameField = $('nameField'), nameNote = $('nameNote');
    
    const emailIn = $('email'), emailField = $('emailField'), emailNote = $('emailNote');
    const pass = $('password'), passField = $('passField'), meter = $('meter'), meterLabel = $('meterLabel');
    const conf = $('confirm'), confirmField = $('confirmField'), matchNote = $('matchNote'), confirmWrap = $('confirmWrap');
    const form = $('signupForm'), btn = $('createBtn');
    const termsBox = $('terms'), termsWrap = $('termsWrap');
    const rememberBox = $('remember');
    const toast = $('toast');
    const verifyNotice = $('verifyNotice');
    const verifyNoticeText = $('verifyNoticeText');
    const resendVerifyBtn = $('resendVerifyBtn');
    const modal = $('policyModal'), modalTitle = $('modalTitle'), modalBody = $('modalBody');



    /* ---------- helpers ---------- */
    function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
    function setState(field, noteEl, ok, okMsg, errMsg) {
        field.classList.remove('valid', 'invalid');
        if (ok === null) { noteEl.textContent = ''; return; }
        field.classList.add(ok ? 'valid' : 'invalid');
        noteEl.textContent = ok ? (okMsg || '') : errMsg;
        noteEl.className = 'note ' + (ok ? 'ok' : 'err');
    }

    let toastTimer;
    function showToast(msg) {
        toast.textContent = msg;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 3000);
    }

    /* ---------- live validation ---------- */
    fullNameIn.addEventListener('input', function () {
        const v = fullNameIn.value.trim();
        if (!v) { setState(nameField, nameNote, null); return; }
        setState(nameField, nameNote, v.length >= 2, '', 'Name looks too short');
    });

    

    emailIn.addEventListener('input', function () {
        const v = emailIn.value.trim();
        if (!v) { setState(emailField, emailNote, null); return; }
        setState(emailField, emailNote, validEmail(v), '', 'Enter a valid email address');
    });

    /* password strength */
    const strengthNames = ['', 'Weak', 'Fair', 'Good', 'Strong ✓'];
    function strength(v) {
        let s = 0;
        if (v.length >= 8) s++;
        if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++;
        if (/\d/.test(v)) s++;
        if (/[^A-Za-z0-9]/.test(v)) s++;
        return s;
    }
    pass.addEventListener('input', function () {
        const s = pass.value ? strength(pass.value) : 0;
        meter.className = 'meter' + (s ? ' s' + s : '');
        meterLabel.textContent = pass.value ? strengthNames[s] : '';
        checkMatch();
    });

    function checkMatch() {
        if (!conf.value) { matchNote.textContent = ''; confirmWrap.parentElement.classList.remove('valid', 'invalid'); return; }
        if (conf.value === pass.value) {
            setState(confirmField, matchNote, true, 'Passwords match ✓');
            confirmWrap.style.borderColor = 'rgba(52,211,153,.45)';
        } else {
            setState(confirmField, matchNote, false, '', 'Passwords do not match');
            confirmWrap.style.borderColor = 'rgba(248,113,113,.5)';
        }
    }
    conf.addEventListener('input', checkMatch);

    /* show / hide password */
    document.querySelectorAll('.eye-btn').forEach(function (b) {
        b.addEventListener('click', function () {
            const input = $(b.dataset.eye);
            const icon = b.querySelector('.material-symbols-outlined');
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            icon.textContent = show ? 'visibility_off' : 'visibility';
            b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        });
    });

    /* avatar upload */
    let profileImageUrl = "";
    let profileImagePublicId = "";
    const zone = $('avatarZone'), file = $('avatarFile');
    zone.addEventListener('click', function () { file.click(); });
    zone.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
    
    const CLOUD_NAME = "haludoui"; 
    const UPLOAD_PRESET = "My_NetChat_profile";
    
    let isAvatarUploading = false;

    file.addEventListener('change', async function () {
        const f = file.files && file.files[0];
        if (!f) return;

        if (!f.type || !f.type.startsWith('image/')) {
            showToast('Please choose an image file');
            file.value = '';
            return;
        }

        // Avoid very large uploads on mobile data.
        if (f.size > 5 * 1024 * 1024) {
            showToast('Please choose an image smaller than 5 MB');
            file.value = '';
            return;
        }

        isAvatarUploading = true;
        profileImageUrl = '';
        profileImagePublicId = '';

        try {
            const formData = new FormData();
            formData.append('file', f);
            formData.append('upload_preset', UPLOAD_PRESET);

            const cloudinaryURL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
            const res = await fetch(cloudinaryURL, { method: 'POST', body: formData });
            const data = await res.json().catch(() => ({}));

            if (!res.ok || !data.secure_url) {
                throw new Error(data.error?.message || 'Image upload was rejected');
            }

            profileImageUrl = data.secure_url;
            profileImagePublicId = data.public_id || '';

            const img = document.createElement('img');
            img.src = URL.createObjectURL(f);
            img.alt = 'Profile picture';
            $('avatarInner').replaceChildren(img);
            showToast('Profile picture uploaded ✓');
        } catch (error) {
            console.error('Profile picture upload failed:', error);
            profileImageUrl = '';
            profileImagePublicId = '';
            showToast('Picture upload failed. You can try again or continue without one.');
        } finally {
            isAvatarUploading = false;
            file.value = '';
        }
    });

    /* ---------- terms & privacy modal ---------- */
    const policies = {
        terms: {
            title: 'Terms of Service',
            html: '<h4>1. Acceptance</h4><p>By creating a NetChat account you agree to these Terms. If you do not agree, please do not use the service.</p>' +
                  '<h4>2. Your account</h4><p>You are responsible for keeping your password confidential and for all activity under your account. Choose a strong password — our strength meter can help.</p>' +
                  '<h4>3. Acceptable use</h4><p>Do not use NetChat to harass others, spread malware, or share unlawful content. We may suspend accounts that violate these rules.</p>' +
                  '<h4>4. Your content</h4><p>You retain ownership of what you post. You grant NetChat a limited license to store and display it so the service can function.</p>' +
                  '<h4>5. Changes</h4><p>We may update these terms from time to time. Continued use of NetChat after changes means you accept the updated terms.</p>'
        },
        privacy: {
            title: 'Privacy Policy',
            html: '<h4>1. What we collect</h4><p>We store your name, email and profile picture so you can sign in and be recognised by friends.</p>' +
                  '<h4>2. Remember me</h4><p>If you enable "Remember me", your email is saved on this device only (localStorage) so the form is pre-filled next time. Your password is never stored.</p>' +
                  '<h4>3. How we use data</h4><p>Your data is used only to operate NetChat: authentication, message delivery and account recovery. We never sell your personal information.</p>' +
                  '<h4>4. Your rights</h4><p>You can request a copy of your data or permanent deletion of your account at any time from the settings page.</p>' +
                  '<h4>5. Security</h4><p>Firebase and Cloudinary protect data in transit. Account access and database permissions depend on Firebase Authentication and the security rules deployed for this project.</p>'
        }
    };

    function openPolicy(kind) {
        modalTitle.textContent = policies[kind].title;
        modalBody.innerHTML = policies[kind].html;
        modal.classList.add('show');
        $('modalAccept').onclick = function () {
            termsBox.checked = true;
            closePolicy();
        };
    }
    function closePolicy() { modal.classList.remove('show'); }

    $('termsLink').addEventListener('click', function (e) { e.preventDefault(); openPolicy('terms'); });
    $('privacyLink').addEventListener('click', function (e) { e.preventDefault(); openPolicy('privacy'); });
    $('modalClose').addEventListener('click', closePolicy);
    modal.addEventListener('click', function (e) { if (e.target === modal) closePolicy(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePolicy(); });

    /* ---------- remember me (works, device-local) ---------- */
    const REMEMBER_KEY = 'netchat_remembered_email';

    function saveRememberedEmail() {
        if (rememberBox.checked && validEmail(emailIn.value.trim())) {
            localStorage.setItem(REMEMBER_KEY, emailIn.value.trim());
        } else if (!rememberBox.checked) {
            localStorage.removeItem(REMEMBER_KEY);
        }
    }
    rememberBox.addEventListener('change', function () {
        if (rememberBox.checked) {
            if (validEmail(emailIn.value.trim())) {
                localStorage.setItem(REMEMBER_KEY, emailIn.value.trim());
                showToast('Email will be remembered on this device ✓');
            }
        } else {
            localStorage.removeItem(REMEMBER_KEY);
            showToast('Remember me turned off');
        }
    });
    emailIn.addEventListener('change', saveRememberedEmail);

    /* restore remembered email on load */
    (function restoreRemembered() {
        const saved = localStorage.getItem(REMEMBER_KEY);
        if (saved) {
            emailIn.value = saved;
            rememberBox.checked = true;
            setState(emailField, emailNote, true);
        }
    })();

    // Complete the profile only after Firebase confirms ownership of the email.
    async function ensureVerifiedUserProfile(user) {
        const profileRef = doc(database, 'user', user.uid);
        const existing = await getDoc(profileRef);
        if (existing.exists()) return;
        const pendingRaw = localStorage.getItem('netchat_pending_verified_profile');
        if (!pendingRaw) {
            throw new Error('Your email is verified, but your pending profile details are missing. Please contact NetChat support.');
        }
        let pending;
        try { pending = JSON.parse(pendingRaw); } catch (_) { throw new Error('Pending profile data is invalid.'); }
        const fullName = String(pending.fullName || '').trim();
        if (fullName.length < 2 || user.email !== pending.email) throw new Error('Pending profile details do not match this account.');
        let netChatID = '';
        let found = true;
        while (found) {
            const digits = Array.from({ length: 11 }, () => Math.floor(Math.random() * 10)).join('');
            netChatID = 'NC' + digits;
            const matches = await getDocs(query(collection(database, 'user'), where('netChatID', '==', netChatID)));
            found = !matches.empty;
        }
        await setDoc(profileRef, {
            userFullname: fullName,
            userEmail: user.email,
            netChatID,
            theNewCreatedUser: user.uid,
            profileImage: pending.profileImage || '',
            profileImagePublicId: pending.profileImagePublicId || '',
            about: "Hi, I'm using NetChat.",
            privacy: { lastSeen: 'Everyone', pfp: 'Everyone', readReceipts: true, typing: true, grpInv: 'Everyone' }
        });
        localStorage.removeItem('netchat_pending_verified_profile');
    }

    /* ---------- returning-user login and recovery ---------- */
    let authMode = 'signup';
    function setAuthMode(mode) {
        authMode = mode;
        const login = mode === 'login';
        nameField.hidden = login;
        confirmField.hidden = login;
        document.querySelector('.avatar-row').hidden = login;
        document.querySelector('.avatar-hint').hidden = login;
        termsWrap.hidden = login;
        meter.hidden = login;
        meterLabel.hidden = login;
        $('forgotWrap').hidden = !login;
        document.querySelector('.auth-title').textContent = login ? 'Welcome back' : 'Create your account';
        document.querySelector('.auth-sub').textContent = login ? 'Sign in to continue your conversations' : 'Join the neon conversation ✦';
        btn.querySelector('.btn-text').textContent = login ? 'Log In →' : 'Create Account →';
        document.querySelector('.login-link').innerHTML = login ? 'New to NetChat? <a href="#signup" id="loginToggle">Create an account</a>' : 'Already on NetChat? <a href="#login" id="loginToggle">Log in</a>';
        $('loginToggle').addEventListener('click', function (event) { event.preventDefault(); setAuthMode(login ? 'signup' : 'login'); });
        pass.autocomplete = login ? 'current-password' : 'new-password';
    }
    $('loginToggle').addEventListener('click', function (event) { event.preventDefault(); setAuthMode('login'); });
    $('forgotPassword').addEventListener('click', async function (event) {
        event.preventDefault();
        const email = emailIn.value.trim();
        if (!validEmail(email)) { showToast('Enter your account email first'); emailIn.focus(); return; }
        try {
            const actionCodeSettings = {
                url: `${window.location.origin}/auth.html?reset=complete#login`,
                handleCodeInApp: false
            };
            await sendPasswordResetEmail(auth, email, actionCodeSettings);
            showToast('Password reset email sent ✓ Check your inbox.');
        }
        catch (error) { console.error(error); showToast('Reset email could not be sent. Check the address and try again.'); }
    });

    // Resend verification securely: authenticate again, send only for this account, then sign out.
    if (resendVerifyBtn) {
        resendVerifyBtn.addEventListener('click', async function () {
            const emailVal = emailIn.value.trim();
            if (!validEmail(emailVal) || !pass.value) {
                showToast('Enter your email and password first to resend verification.');
                return;
            }
            resendVerifyBtn.disabled = true;
            try {
                const credential = await signInWithEmailAndPassword(auth, emailVal, pass.value);
                await reload(credential.user);
                if (credential.user.emailVerified) {
                    await signOut(auth);
                    verifyNotice.hidden = true;
                    showToast('Your email is already verified. You can log in now.');
                } else {
                    await sendEmailVerification(credential.user);
                    await signOut(auth);
                    showToast('A new verification email has been sent.');
                }
            } catch (error) {
                console.error('Resend verification failed:', error);
                if (auth.currentUser) { try { await signOut(auth); } catch (_) {} }
                showToast('Could not resend verification. Check your email, password and connection.');
            } finally {
                resendVerifyBtn.disabled = false;
            }
        });
    }

    /* ---------- submit ---------- */
    form.addEventListener('submit', async function (e) {
        e.preventDefault();

        if (authMode === 'login') {
            const emailVal = emailIn.value.trim();
            if (!validEmail(emailVal) || !pass.value) { showToast('Enter your email and password'); return; }
            btn.disabled = true; btn.classList.add('loading');
            try {
                const credential = await signInWithEmailAndPassword(auth, emailVal, pass.value);
                await reload(credential.user);
                if (!credential.user.emailVerified) {
                    try { await sendEmailVerification(credential.user); } catch (mailError) { console.error('Verification email resend failed:', mailError); }
                    await signOut(auth);
                    verifyNoticeText.textContent = `Your email address (${emailVal}) is not verified yet. We have requested a fresh verification email. Open it and tap Verify Email, then return here to log in.`;
                    verifyNotice.hidden = false;
                    showToast('Please verify your email before entering NetChat.');
                    btn.disabled = false; btn.classList.remove('loading');
                    return;
                }
                await ensureVerifiedUserProfile(credential.user);
                verifyNotice.hidden = true;
                saveRememberedEmail();
                window.location.href = 'index.html';
            } catch (error) {
                console.error('Login failed:', error);
                showToast(error.code === 'auth/invalid-credential' ? 'Email or password is incorrect' : 'Could not log in. Check your connection and try again.');
                btn.disabled = false; btn.classList.remove('loading');
            }
            return;
        }

        if (isAvatarUploading) {
            showToast('Please wait for the profile picture upload to finish');
            return;
        }

        const problems = [];
        const fullNameVal = fullNameIn.value.trim();
        
        const emailVal = emailIn.value.trim();

        if (!fullNameVal || fullNameVal.length < 2) problems.push('full name');
        
        
        if (!validEmail(emailVal)) problems.push('email');
        if (pass.value.length < 8) problems.push('password (8+ chars)');
        if (!conf.value || conf.value !== pass.value) problems.push('matching passwords');
        if (!termsBox.checked) problems.push('agreeing to Terms & Privacy');

        if (problems.length) {
            showToast('Please fix: ' + problems.join(', '));
            if (!termsBox.checked) {
                termsWrap.classList.remove('shake');
                void termsWrap.offsetWidth; /* restart animation */
                termsWrap.classList.add('shake');
                termsWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            return;
        }

































        /* loading state with spinner */
        btn.disabled = true;
        btn.classList.add('loading');

        try {



const results = await createUserWithEmailAndPassword(auth, emailVal, pass.value);
            await sendEmailVerification(results.user);
            // Keep only the minimum profile fields locally until the email is verified.
            localStorage.setItem('netchat_pending_verified_profile', JSON.stringify({
                fullName: fullNameVal,
                email: emailVal,
                profileImage: profileImageUrl || '',
                profileImagePublicId: profileImagePublicId || ''
            }));
            await signOut(auth);

            saveRememberedEmail();
            setAuthMode('login');
            verifyNoticeText.textContent = `We sent a verification link to ${emailVal}. Open that email and tap Verify Email. Once verified, return to NetChat and log in.`;
            verifyNotice.hidden = false;
            showToast('Account created. Verify your email before signing in.');

            
            
            
        } catch (err) {
            console.error('Account save error:', err);
            showToast('Something went wrong. Please try again.');
        } finally {
            btn.disabled = false;
            btn.classList.remove('loading');
        }
    })
}) ();


