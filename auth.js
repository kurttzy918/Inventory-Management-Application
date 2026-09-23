/* auth.js — Authentication + auth screen + pending screen */
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";
import { state, CONSTANTS } from "./state.js";
import { $, valOf, showToast } from "./utils.js";

const { SUPER_ADMIN_EMAIL } = CONSTANTS;

/* ---------- Auth backgrounds ---------- */
function getConfiguredAuthBgImages() {
  try {
    const raw = localStorage.getItem("authBgImages");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed.map(String).filter(Boolean);
    }
  } catch (e) { console.warn("[auth-bg] bad localStorage value:", e); }
  return CONSTANTS.DEFAULT_AUTH_BG_IMAGES.slice();
}

export function buildAuthBackground(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const urls = getConfiguredAuthBgImages();
  container.innerHTML = urls.map((url, i) => `
    <div class="auth-bg-slide ${i === 0 ? "active" : ""}">
      <img src="${url}" alt="" loading="eager"
           onerror="this.closest('.auth-bg-slide').classList.add('broken'); this.remove();" />
    </div>`).join("");
  setTimeout(() => {
    const slides = container.querySelectorAll(".auth-bg-slide");
    const working = [...slides].filter(s => !s.classList.contains("broken"));
    if (!working.length) {
      container.innerHTML = CONSTANTS.FALLBACK_AUTH_BG_IMAGES.map((url, i) => `
        <div class="auth-bg-slide ${i === 0 ? "active" : ""}">
          <img src="${url}" alt="" loading="eager" />
        </div>`).join("");
    }
  }, 2500);
}

export function startAuthBgCarousel(containerId) {
  stopAuthBgCarousel();
  const container = document.getElementById(containerId);
  if (!container) return;
  const slides = container.querySelectorAll(".auth-bg-slide");
  if (slides.length <= 1) return;
  state.authBgIndex = 0;
  state.authBgTimer = setInterval(() => {
    const cur = container.querySelectorAll(".auth-bg-slide");
    if (!cur.length) return;
    if (cur[state.authBgIndex]) cur[state.authBgIndex].classList.remove("active");
    state.authBgIndex = (state.authBgIndex + 1) % cur.length;
    if (cur[state.authBgIndex]) cur[state.authBgIndex].classList.add("active");
  }, CONSTANTS.AUTH_BG_INTERVAL_MS);
}
export function stopAuthBgCarousel() {
  if (state.authBgTimer) { clearInterval(state.authBgTimer); state.authBgTimer = null; }
}

export function startTextCarousel(containerSelector, itemSelector, intervalMs = 3000) {
  // Support MULTIPLE carousels with the same class (topbar + sidebar)
  const containers = document.querySelectorAll(containerSelector);
  if (!containers.length) return;

  containers.forEach((container) => {
    const items = container.querySelectorAll(itemSelector);
    if (!items.length) return;

    // Single-item: just show it, no timer needed
    if (items.length === 1) {
      items[0].classList.add("active");
      return;
    }

    // Multi-item: rotate
    let idx = 0;
    items.forEach((el, i) => el.classList.toggle("active", i === 0));

    setInterval(() => {
      // If the parent got removed (e.g., page switched), skip
      if (!items[idx] || !items[idx].isConnected) return;
      items[idx].classList.remove("active");
      idx = (idx + 1) % items.length;
      items[idx].classList.add("active");
    }, intervalMs);
  });
}

/* ---------- Auth mode ---------- */
function setAuthMode(isSignup) {
  state.isSignupMode = isSignup;
  const authTabs = $("auth-tabs");
  const tabLogin = $("tab-login"), tabSignup = $("tab-signup");
  const authSubmit = $("auth-submit"), authError = $("auth-error");
  if (authTabs) authTabs.classList.toggle("signup-mode", isSignup);
  tabLogin?.classList.toggle("active", !isSignup);
  tabSignup?.classList.toggle("active", isSignup);
  if (authSubmit) authSubmit.textContent = isSignup ? "Create Account" : "Login";
  if (authError) authError.textContent = "";
  const form = $("auth-form");
  if (form) { form.style.animation = "none"; void form.offsetWidth; form.style.animation = ""; }
  setTimeout(() => $("email")?.focus({ preventScroll: true }), 300);
}

function friendlyAuthError(code) {
  const map = {
    "auth/invalid-email": "Invalid email address.",
    "auth/user-not-found": "No account found with this email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/email-already-in-use": "This email is already registered.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/invalid-credential": "Invalid email or password.",
    "auth/too-many-requests": "Too many attempts. Try again later.",
    "auth/network-request-failed": "Network error. Check your connection."
  };
  return map[code] || `Login failed (${code || "unknown error"}).`;
}

/* ---------- Wire buttons ---------- */
export function initAuthUI() {
  const tabLogin = $("tab-login"), tabSignup = $("tab-signup");
  tabLogin?.addEventListener("click", () => setAuthMode(false));
  tabSignup?.addEventListener("click", () => setAuthMode(true));

  const authForm = $("auth-form"), authSubmit = $("auth-submit"), authError = $("auth-error");
  authForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (authError) authError.textContent = "";
    const email = valOf($("email")).trim().toLowerCase();
    const password = valOf($("password"));
    if (!email || !password) { if (authError) authError.textContent = "Enter email and password."; return; }
    if (authSubmit) authSubmit.disabled = true;
    try {
      if (state.isSignupMode) {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        const isSuper = email === SUPER_ADMIN_EMAIL.toLowerCase();
        try {
          await setDoc(doc(db, "users", cred.user.uid), {
            email, workspaceId: cred.user.uid,
            role: isSuper ? "superadmin" : "user",
            approved: isSuper, createdAt: serverTimestamp()
          });
        } catch (profileErr) {
          console.error("[Signup] profile write failed:", profileErr);
          if (authError) authError.textContent = "Account created, but profile setup failed. Check Firestore rules.";
        }
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      console.error("[Auth] submit error:", err);
      if (authError) authError.textContent = friendlyAuthError(err.code);
    } finally {
      if (authSubmit) authSubmit.disabled = false;
    }
  });

  $("logout-btn")?.addEventListener("click", () => signOut(auth));
  $("pending-logout")?.addEventListener("click", () => signOut(auth));
}

/* ---------- Auth state observer ---------- */
export function initAuthHandlers({ onLoggedOut, onPending, onApproved, onTeardown }) {
  onAuthStateChanged(auth, async (user) => {
    // Teardown previous session
    if (state.unsubscribeUserDoc) { try { state.unsubscribeUserDoc(); } catch {} state.unsubscribeUserDoc = null; }
    onTeardown?.();

    const authScreen = $("auth-screen"), pendingScreen = $("pending-screen"), appShell = $("app-shell");

    if (!user) {
      state.currentUser = null; state.currentUserData = null;
      authScreen?.classList.remove("hidden");
      pendingScreen?.classList.add("hidden");
      appShell?.classList.add("hidden");
      $("auth-form")?.reset();
      const authError = $("auth-error"); if (authError) authError.textContent = "";
      startAuthBgCarousel("auth-bg-slides");
      onLoggedOut?.();
      return;
    }

    state.currentUser = user;
    $("user-email") && ($("user-email").textContent = user.email);
    $("pending-email") && ($("pending-email").textContent = user.email);

    const isSuper = (user.email || "").trim().toLowerCase() === SUPER_ADMIN_EMAIL.trim().toLowerCase();
    const userRef = doc(db, "users", user.uid);

    try {
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        await setDoc(userRef, {
          email: user.email, workspaceId: user.uid,
          role: isSuper ? "superadmin" : "user",
          approved: isSuper, createdAt: serverTimestamp()
        });
      } else if (isSuper) {
        const data = snap.data();
        if (data.role !== "superadmin" || data.approved !== true) {
          await updateDoc(userRef, { role: "superadmin", approved: true });
        }
      }
    } catch (err) {
      console.error("[Auth] profile setup FAILED:", err.code, err.message);
      const authError = $("auth-error");
      if (authError) authError.textContent = `Profile setup failed: ${err.code || err.message}`;
      authScreen?.classList.remove("hidden");
      appShell?.classList.add("hidden");
      pendingScreen?.classList.add("hidden");
      startAuthBgCarousel("auth-bg-slides");
      return;
    }

    state.unsubscribeUserDoc = onSnapshot(userRef, (docSnap) => {
      if (!docSnap.exists()) return;
      state.currentUserData = docSnap.data();

      if (!state.currentUserData.approved) {
        authScreen?.classList.add("hidden");
        appShell?.classList.add("hidden");
        pendingScreen?.classList.remove("hidden");
        stopAuthBgCarousel();
        startAuthBgCarousel("pending-bg-slides");
        onPending?.();
        return;
      }

      pendingScreen?.classList.add("hidden");
      authScreen?.classList.add("hidden");
      appShell?.classList.remove("hidden");
      stopAuthBgCarousel();

      const navAdmin = $("nav-admin");
      if (navAdmin) navAdmin.classList.toggle("hidden", state.currentUserData.role !== "superadmin");

      onApproved?.(state.currentUserData);
    }, (err) => {
      console.error("[Auth] profile watch FAILED:", err.code, err.message);
      showToast(`Profile stream: ${err.code || err.message} ❌`);
    });
  });
}