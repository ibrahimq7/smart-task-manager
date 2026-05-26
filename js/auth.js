import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  sendEmailVerification,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc,
  getFirestore,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig, hasFirebaseConfig } from "./firebase-config.js";

const callbacks = [];
let app = null;
let auth = null;
let db = null;
let currentUser = null;

const $ = (id) => document.getElementById(id);

function setMessage(message, type = "") {
  const el = $("authMessage");
  if (!el) return;
  el.textContent = message;
  el.className = `auth-message ${type}`.trim();
}

function friendlyAuthError(error) {
  const code = error?.code || "";
  const host = window.location.hostname;
  const domain = host || "this domain";
  const messages = {
    "auth/unauthorized-domain": `${domain} is not enabled for sign-in yet. Add ${domain}, localhost and 127.0.0.1 to the Authorized domains list in Firebase Console (Authentication → Sign-in method → Authorized domains).`,
    "auth/popup-closed-by-user": "The sign-in window was closed before access was completed.",
    "auth/popup-blocked": "Your browser blocked the sign-in window. Allow popups for this site and try again.",
    "auth/invalid-credential": "The email or password is incorrect.",
    "auth/user-not-found": "No workspace account exists for this email yet.",
    "auth/email-already-in-use": "This email already has an account. Sign in instead.",
    "auth/weak-password": "Use a stronger password with at least 6 characters.",
    "auth/too-many-requests": "Too many attempts. Wait a moment, then try again.",
    "auth/network-request-failed": "Network error. Check your connection and try again."
  };
  // If we don't recognize the code, include the provider error message to aid debugging.
  return messages[code] || error?.message || "We could not complete sign-in. Please try again.";
}

function isGmailAddress(email) {
  return /^[^\s@]+@gmail\.com$/i.test(email || "");
}

function isAllowedUser(user) {
  return Boolean(user && isGmailAddress(user.email) && user.emailVerified);
}

function showApp(user) {
  $("authScreen")?.classList.add("hidden");
  $("appShell")?.classList.remove("hidden");
  const badge = $("userBadge");
  if (badge) badge.textContent = user.email;
}

function showAuth() {
  $("authScreen")?.classList.remove("hidden");
  $("appShell")?.classList.add("hidden");
}

async function recordUserProfile(user) {
  await setDoc(doc(db, "users", user.uid), {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || "",
    photoURL: user.photoURL || "",
    emailVerified: user.emailVerified,
    providerIds: user.providerData.map((provider) => provider.providerId),
    lastLoginAt: serverTimestamp()
  }, { merge: true });
}

async function handleAuthUser(user) {
  if (!user) {
    currentUser = null;
    showAuth();
    return;
  }

  if (!isGmailAddress(user.email)) {
    await signOut(auth);
    setMessage("Use a Gmail account to access this workspace.", "error");
    return;
  }

  if (!user.emailVerified) {
    await sendEmailVerification(user);
    await signOut(auth);
    setMessage("We sent a confirmation link. Verify your email, then sign in again.", "success");
    return;
  }

  currentUser = user;
  await recordUserProfile(user);
  showApp(user);
  callbacks.forEach((callback) => callback(user));
}

function requireConfig() {
  if (hasFirebaseConfig) return true;
  setMessage("Workspace access is not configured yet. Contact the app owner.", "error");
  return false;
}

async function signInGoogle() {
  if (!requireConfig()) return;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account", hd: "gmail.com" });
  await signInWithPopup(auth, provider);
}

async function signUpEmail() {
  if (!requireConfig()) return;
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  if (!isGmailAddress(email)) {
    setMessage("Use a Gmail address to create your workspace account.", "error");
    return;
  }
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(credential.user);
  await signOut(auth);
  setMessage("Verification email sent to your inbox. Please check your Inbox, Spam, or Promotions folders and click the verification link to confirm your account.", "success");
}

async function signInEmail() {
  if (!requireConfig()) return;
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  if (!isGmailAddress(email)) {
    setMessage("Use a Gmail account to access this workspace.", "error");
    return;
  }
  
  // Check if account exists and what authentication methods are available
  const methods = await fetchSignInMethodsForEmail(auth, email);
  if (methods.length > 0 && methods.includes("google.com") && !methods.includes("password")) {
    setMessage("This account was created using Google Sign-In. Please continue using Google Login instead of password login.", "error");
    return;
  }
  
  await signInWithEmailAndPassword(auth, email, password);
}

async function resetPassword() {
  if (!requireConfig()) return;
  const email = $("authEmail").value.trim();
  if (!isGmailAddress(email)) {
    setMessage("Enter your Gmail address first.", "error");
    return;
  }
  await sendPasswordResetEmail(auth, email);
  setMessage("Password reset link sent.", "success");
}

export function getCurrentUser() {
  return currentUser;
}

export function getDb() {
  return db;
}

export function onAuthReady(callback) {
  callbacks.push(callback);
  if (currentUser) callback(currentUser);
}

export async function signOutCurrentUser() {
  if (auth) await signOut(auth);
}

export async function initAuth() {
  showAuth();

  $("googleSignInBtn")?.addEventListener("click", () => signInGoogle().catch((error) => setMessage(friendlyAuthError(error), "error")));
  $("emailSignUpBtn")?.addEventListener("click", () => signUpEmail().catch((error) => setMessage(friendlyAuthError(error), "error")));
  $("emailSignInBtn")?.addEventListener("click", () => signInEmail().catch((error) => setMessage(friendlyAuthError(error), "error")));
  $("passwordResetBtn")?.addEventListener("click", () => resetPassword().catch((error) => setMessage(friendlyAuthError(error), "error")));
  $("signOutBtn")?.addEventListener("click", () => signOutCurrentUser());

  if (!hasFirebaseConfig) {
    requireConfig();
    return;
  }

  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  await setPersistence(auth, browserLocalPersistence);
  onAuthStateChanged(auth, (user) => {
    handleAuthUser(user).catch((error) => {
      // Log full error for debugging and show a friendly message to the user.
      console.error("Auth state handling failed:", error);
      setMessage(friendlyAuthError(error), "error");
      showAuth();
    });
  });
}

export { isAllowedUser };
