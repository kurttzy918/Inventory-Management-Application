/* ==========================================================
   app.js — Kurt Inventory
   Multi-tenant + Super Admin + POS + Receipt + Exports
   + Profit + In/Out History (with view/delete)
   + Slow Moving + Expiry + Sales History
   + Sales per Category
   + Mobile direct-download exports
   + SCANNER v6
   ========================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, onSnapshot, addDoc, updateDoc,
  deleteDoc, doc, getDoc, setDoc, serverTimestamp,
  query, where, writeBatch, increment
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ----------------------------------------------------------
   CONFIG
   ---------------------------------------------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyALhYN9Wufpqw8OxBlsvmEwpCrZjtGAtQo",
  authDomain: "kurt-inventory-pos.firebaseapp.com",
  projectId: "kurt-inventory-pos",
  storageBucket: "kurt-inventory-pos.firebasestorage.app",
  messagingSenderId: "480909019162",
  appId: "1:480909019162:web:c0c9c6254cac2c021ee9a3",
  measurementId: "G-N3ET64JKNG"
};

const SUPER_ADMIN_EMAIL = "madronerokurt04@gmail.com";
const STORE_NAME = "Kurt Inventory";
const STORE_TAGLINE = "Smart Stock & Sales";

const AUTH_BG_IMAGES = [
  "https://images.unsplash.com/photo-1553413077-190dd305871c?auto=format&fit=crop&w=1920&q=80",
  "https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?auto=format&fit=crop&w=1920&q=80",
  "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=1920&q=80",
  "https://images.unsplash.com/photo-1601598851547-4302969d0614?auto=format&fit=crop&w=1920&q=80"
];
const AUTH_BG_INTERVAL_MS   = 6000;
const NEW_ARRIVAL_WINDOW_MS = 7  * 24 * 60 * 60 * 1000;
const EXPIRY_WARNING_DAYS   = 30;

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);

let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
  console.log("[Firestore] offline persistence enabled");
} catch (e) {
  console.warn("[Firestore] offline persistence failed, using default:", e);
  db = initializeFirestore(app, {});
}

/* ----------------------------------------------------------
   HELPERS
   ---------------------------------------------------------- */
const $ = (id) => document.getElementById(id);
const valOf  = (el) => (el ? String(el.value || "") : "");
const numOf  = (el) => (el ? (Number(el.value) || 0) : 0);
const setVal = (el, v) => { if (el) el.value = v; };
function debounce(fn, ms = 150) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function safeRender(fn) {
  try { if (typeof fn === "function") fn(); }
  catch (e) { console.error("[render] " + (fn.name || "anon") + " failed:", e); }
}

/* ----------------------------------------------------------
   DOM REFS
   ---------------------------------------------------------- */
const authScreen    = $("auth-screen");
const pendingScreen = $("pending-screen");
const appShell      = $("app-shell");

const authForm = $("auth-form"), authSubmit = $("auth-submit"),
  authError = $("auth-error"), emailInput = $("email"),
  passwordInput = $("password"), tabLogin = $("tab-login"),
  tabSignup = $("tab-signup"), logoutBtn = $("logout-btn"),
  userEmailEl = $("user-email"), pendingLogout = $("pending-logout"),
  pendingEmail = $("pending-email");

const themeToggle = $("theme-toggle"), themeIcon = $("theme-icon");
const soundToggle = $("sound-toggle"), soundIcon = $("sound-icon");

const statTotal = $("stat-total"), statLow = $("stat-low"),
  statValue = $("stat-value"), statSales = $("stat-sales"),
  statProfit = $("stat-profit"), statCats = $("stat-cats"),
  lowStockList = $("low-stock-list"),
  expiringList = $("expiring-list"),
  movementsList = $("movements-list"),
  slowMovingList = $("slow-moving-list");

const expiryBanner = $("expiry-banner");
const expiryBannerText = $("expiry-banner-text");
const expiryBannerBtn = $("expiry-banner-btn");

const carouselTrack = $("carousel-track");
const carouselDots  = $("carousel-dots");
const carouselPrev  = $("carousel-prev");
const carouselNext  = $("carousel-next");
const fastMovingList = $("fast-moving-list");

const salesList         = $("sales-list");
const scanSaleBtn       = $("scan-sale-btn");
const salesProductsGrid = $("sales-products-grid");
const salesSearchEl     = $("sales-search");
const salesCatFilterEl  = $("sales-cat-filter");
const salesCatSummaryEl = $("sales-category-summary");
const posCartItems      = $("pos-cart-items");
const posTotalEl        = $("pos-total");
const posCashInput      = $("pos-cash");
const posChangeEl       = $("pos-change");
const posCheckoutBtn    = $("pos-checkout");
const posClearBtn       = $("pos-clear-btn");

const historyList        = $("history-list");
const historySearchEl    = $("history-search");
const historyFilterEl    = $("history-filter");
const historyCatFilterEl = $("history-cat-filter");
const historyCatSummaryEl= $("history-category-summary");
const exportHistoryExcel = $("export-history-excel");
const exportHistoryPdf   = $("export-history-pdf");

const exportSalesExcel   = $("export-sales-excel");
const exportSalesPdf     = $("export-sales-pdf");
const exportInvExcel     = $("export-inv-excel");
const exportInvPdf       = $("export-inv-pdf");
const exportMovementsBtn = $("export-movements");

const itemForm = $("item-form"), itemId = $("item-id"),
  itemName = $("item-name"), itemSku = $("item-sku"),
  itemBarcode = $("item-barcode"),
  itemCategory = $("item-category"), itemQty = $("item-qty"),
  itemCost = $("item-cost"), itemPrice = $("item-price"),
  itemExpiry = $("item-expiry"), itemThreshold = $("item-threshold"),
  categoryList = $("category-list"), searchInput = $("search-input"),
  filterCat = $("filter-category"), inventoryList = $("inventory-list");
const scanBarcodeBtn = $("scan-barcode-btn");

const itemImageData = $("item-image-data"), itemImage = $("item-image"),
  itemImageCamera = $("item-image-camera"),
  photoPreview = $("photo-preview"), photoPickBtn = $("photo-pick-btn"),
  photoCameraBtn = $("photo-camera-btn"),
  photoRemoveBtn = $("photo-remove-btn");

const categoryForm = $("category-form"), newCategory = $("new-category"),
  categoryGrid = $("category-grid");

const navAdmin = $("nav-admin"),
  pendingUsersList = $("pending-users-list"),
  allUsersList = $("all-users-list");

const navButtons = document.querySelectorAll(".nav-btn");
const pages      = document.querySelectorAll(".page");
const toast      = $("toast");

/* Scanner */
const scannerModal = $("scanner-modal"), scannerTitle = $("scanner-title"),
  scannerReader = $("scanner-reader"), scannerStatus = $("scanner-status"),
  scannerClose = $("scanner-close"), scannerManualInput = $("scanner-manual-input"),
  scannerManualBtn = $("scanner-manual-btn");
const scannerRetryBtn   = $("scanner-retry-btn");
const scannerUploadBtn  = $("scanner-upload-btn");
const scannerUploadInput = $("scanner-upload-input");

/* Restock */
const restockModal = $("restock-modal"), restockItemName = $("restock-item-name"),
  restockCurrent = $("restock-current"), restockQty = $("restock-qty"),
  restockClose = $("restock-close"), restockConfirm = $("restock-confirm");

/* Receipt */
const receiptModal    = $("receipt-modal"), receiptContent = $("receipt-content"),
  printReceiptBtn     = $("print-receipt-btn"), closeReceiptBtn = $("close-receipt-btn"),
  deleteReceiptBtn    = $("delete-receipt-btn");

/* Movement modal (NEW) */
const movementModal       = $("movement-modal");
const movementDetailEl    = $("movement-detail-content");
const movementClose       = $("movement-close");
const movementCloseBtn    = $("movement-close-btn");
const movementDeleteBtn   = $("movement-delete-btn");

/* ----------------------------------------------------------
   STATE
   ---------------------------------------------------------- */
let inventory = [], sales = [], categories = [], allUsers = [], movements = [];
let currentUser = null, currentUserData = null, isSignupMode = false;
const unsubscribers = {};
let unsubscribeUserDoc = null;

let stockChart = null, categoryValueChart = null, salesCategoryChart = null;
let chartJsReady = false, chartRenderQueued = false;

let carouselSlides = [], carouselIndex = 0, carouselInterval = null;
let posMiniTimer = null, posMiniIndex = 0;
let authBgTimer = null, authBgIndex = 0;

let soundEnabled = localStorage.getItem("soundEnabled") !== "false";
let manualSku = false, skuInitialized = false;

let posCart = [];
let restockItemId = null;
let currentReceiptGroup = null;

/* Movement modal state */
let currentMovementId = null;

/* ----------------------------------------------------------
   CHART.JS LOADER
   ---------------------------------------------------------- */
(function waitForChartJs() {
  if (typeof Chart !== "undefined") { chartJsReady = true; return; }
  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    if (typeof Chart !== "undefined") {
      clearInterval(iv);
      chartJsReady = true;
      console.log("[Charts] Chart.js ready after", tries * 150, "ms");
      safeRender(renderCharts);
    } else if (tries > 80) {
      clearInterval(iv);
      console.warn("[Charts] Chart.js failed to load");
    }
  }, 150);
})();

function queueChartRender() {
  if (chartRenderQueued) return;
  chartRenderQueued = true;
  setTimeout(() => {
    chartRenderQueued = false;
    safeRender(renderCharts);
  }, 200);
}

/* ----------------------------------------------------------
   MOBILE-FRIENDLY DOWNLOAD HELPER (NEW)
   - Uses Blob + <a download> so that mobile browsers
     download the file directly instead of opening a new tab.
   ---------------------------------------------------------- */
function downloadBlob(blob, filename) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch (e) {}
      try { document.body.removeChild(a); } catch (e) {}
    }, 1500);
  } catch (e) {
    console.error("[download]", e);
    showToast("Download failed ❌");
  }
}
function downloadXLSX(wb, filename) {
  if (typeof XLSX === "undefined") { showToast("Excel library not loaded ❌"); return; }
  try {
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    downloadBlob(blob, filename);
  } catch (e) {
    console.error("[xlsx]", e);
    showToast("Excel export failed ❌");
  }
}
function downloadPDF(doc, filename) {
  try {
    const blob = doc.output("blob");
    downloadBlob(blob, filename);
  } catch (e) {
    console.error("[pdf]", e);
    showToast("PDF export failed ❌");
  }
}

/* ----------------------------------------------------------
   AUTH BACKGROUND CAROUSEL
   ---------------------------------------------------------- */
function buildAuthBackground(containerId) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = AUTH_BG_IMAGES.map((url, i) =>
    `<div class="auth-bg-slide ${i === 0 ? "active" : ""}" style="background-image:url('${url}')"></div>`
  ).join("");
}
function startAuthBgCarousel(containerId) {
  stopAuthBgCarousel();
  const container = $(containerId);
  if (!container) return;
  const slides = container.querySelectorAll(".auth-bg-slide");
  if (slides.length <= 1) return;
  authBgIndex = 0;
  authBgTimer = setInterval(() => {
    slides[authBgIndex].classList.remove("active");
    authBgIndex = (authBgIndex + 1) % slides.length;
    slides[authBgIndex].classList.add("active");
  }, AUTH_BG_INTERVAL_MS);
}
function stopAuthBgCarousel() { if (authBgTimer) { clearInterval(authBgTimer); authBgTimer = null; } }
buildAuthBackground("auth-bg-slides");
buildAuthBackground("pending-bg-slides");

/* ----------------------------------------------------------
   TEXT CAROUSELS
   ---------------------------------------------------------- */
function startTextCarousel(containerSelector, itemSelector, intervalMs = 3000) {
  const container = document.querySelector(containerSelector);
  if (!container) return;
  const items = container.querySelectorAll(itemSelector);
  if (!items.length) return;
  if (items.length === 1) { items[0].classList.add("active"); return; }

  let idx = 0;
  items.forEach((el, i) => el.classList.toggle("active", i === 0));

  setInterval(() => {
    if (!items[idx].isConnected) return;
    items[idx].classList.remove("active");
    idx = (idx + 1) % items.length;
    items[idx].classList.add("active");
  }, intervalMs);
}

startTextCarousel(".subtitle-carousel",      ".carousel-text", 3000);
startTextCarousel(".brand-tagline-carousel", ".brand-tagline", 3000);

/* ----------------------------------------------------------
   THEME
   ---------------------------------------------------------- */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  if (themeIcon) themeIcon.textContent = theme === "dark" ? "☀️" : "🌙";
  destroyCharts();
  queueChartRender();
}
if (themeToggle) themeToggle.addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme") || "light";
  applyTheme(cur === "dark" ? "light" : "dark");
});
if (themeIcon) themeIcon.textContent =
  document.documentElement.getAttribute("data-theme") === "dark" ? "☀️" : "🌙";

window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", (ev) => {
  if (!localStorage.getItem("theme")) applyTheme(ev.matches ? "dark" : "light");
});

/* ----------------------------------------------------------
   SOUND
   ---------------------------------------------------------- */
function updateSoundIcon() { if (soundIcon) soundIcon.textContent = soundEnabled ? "🔊" : "🔇"; }
if (soundToggle) soundToggle.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem("soundEnabled", soundEnabled);
  updateSoundIcon();
});
updateSoundIcon();

let audioCtx = null;
function getAudioCtx() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx || audioCtx.state === "closed") audioCtx = new AC();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  } catch (e) { return null; }
}
document.addEventListener("pointerdown", getAudioCtx, { once: true });

function playBeep(freq, dur, type = "sine") {
  if (!soundEnabled) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    const t = ctx.currentTime;
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t); osc.stop(t + dur);
    osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch (e) {} };
  } catch (e) {}
}
function playSuccessSound() { playBeep(880, 0.12); setTimeout(() => playBeep(1100, 0.12), 120); }
function playErrorSound()   { playBeep(220, 0.35, "sawtooth"); }
function playCashSound()    { playBeep(1320, 0.08); setTimeout(() => playBeep(1760, 0.08), 90); setTimeout(() => playBeep(2093, 0.16), 180); }

/* ----------------------------------------------------------
   AUTH TABS
   ---------------------------------------------------------- */
const authTabs = $("auth-tabs");

function setAuthMode(isSignup) {
  isSignupMode = isSignup;
  if (authTabs) authTabs.classList.toggle("signup-mode", isSignup);
  tabLogin?.classList.toggle("active", !isSignup);
  tabSignup?.classList.toggle("active", isSignup);
  if (authSubmit) authSubmit.textContent = isSignup ? "Create Account" : "Login";
  if (authError) authError.textContent = "";
  const form = $("auth-form");
  if (form) {
    form.style.animation = "none";
    void form.offsetWidth;
    form.style.animation = "";
  }
  setTimeout(() => {
    if (emailInput) emailInput.focus({ preventScroll: true });
  }, 300);
}

if (tabLogin)  tabLogin.addEventListener("click", () => setAuthMode(false));
if (tabSignup) tabSignup.addEventListener("click", () => setAuthMode(true));

/* ----------------------------------------------------------
   SIGNUP / LOGIN
   ---------------------------------------------------------- */
if (authForm) authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (authError) authError.textContent = "";
  const email = valOf(emailInput).trim().toLowerCase();
  const password = valOf(passwordInput);
  if (!email || !password) {
    if (authError) authError.textContent = "Enter email and password.";
    return;
  }
  try {
    if (isSignupMode) {
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
  }
});

function friendlyAuthError(code) {
  const map = {
    "auth/invalid-email": "Invalid email address.",
    "auth/user-not-found": "No account found with this email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/email-already-in-use": "This email is already registered.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/invalid-credential": "Invalid email or password.",
    "auth/too-many-requests": "Too many attempts. Try again later."
  };
  return map[code] || `Login failed (${code || "unknown error"}).`;
}

/* ----------------------------------------------------------
   AUTH STATE
   ---------------------------------------------------------- */
onAuthStateChanged(auth, async (user) => {
  if (unsubscribeUserDoc) { unsubscribeUserDoc(); unsubscribeUserDoc = null; }
  stopAllListeners();
  stopCarousel();
  stopPosMiniCarousels();
  stopAuthBgCarousel();
  forceCloseScanner();

  if (!user) {
    currentUser = null; currentUserData = null;
    authScreen && authScreen.classList.remove("hidden");
    pendingScreen && pendingScreen.classList.add("hidden");
    appShell && appShell.classList.add("hidden");
    authForm && authForm.reset();
    if (authError) authError.textContent = "";
    startAuthBgCarousel("auth-bg-slides");
    return;
  }

  currentUser = user;
  if (userEmailEl) userEmailEl.textContent = user.email;
  if (pendingEmail) pendingEmail.textContent = user.email;

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
    if (authError) authError.textContent = `Profile setup failed: ${err.code || err.message}`;
    authScreen && authScreen.classList.remove("hidden");
    appShell && appShell.classList.add("hidden");
    pendingScreen && pendingScreen.classList.add("hidden");
    startAuthBgCarousel("auth-bg-slides");
    return;
  }

  unsubscribeUserDoc = onSnapshot(userRef, (docSnap) => {
    if (!docSnap.exists()) return;
    currentUserData = docSnap.data();

    if (!currentUserData.approved) {
      authScreen && authScreen.classList.add("hidden");
      appShell && appShell.classList.add("hidden");
      pendingScreen && pendingScreen.classList.remove("hidden");
      stopAuthBgCarousel();
      startAuthBgCarousel("pending-bg-slides");
      return;
    }

    pendingScreen && pendingScreen.classList.add("hidden");
    authScreen && authScreen.classList.add("hidden");
    appShell && appShell.classList.remove("hidden");
    stopAuthBgCarousel();

    if (navAdmin) navAdmin.classList.toggle("hidden", currentUserData.role !== "superadmin");

    if (!unsubscribers.inventory) startAllListeners();
    if (currentUserData.role === "superadmin" && !unsubscribers.users) startUserAdminListener();
  }, (err) => {
    console.error("[Auth] profile watch FAILED:", err.code, err.message);
    showToast(`Profile stream: ${err.code || err.message} ❌`);
  });
});

if (logoutBtn) logoutBtn.addEventListener("click", () => signOut(auth));
if (pendingLogout) pendingLogout.addEventListener("click", () => signOut(auth));

function myWorkspace() { return currentUser?.uid; }

/* ----------------------------------------------------------
   REAL-TIME LISTENERS
   ---------------------------------------------------------- */
function startAllListeners() {
  const wsId = myWorkspace();
  if (!wsId) return;

  unsubscribers.inventory = onSnapshot(
    query(collection(db, "inventory"), where("workspaceId", "==", wsId)),
    (snap) => {
      inventory = snap.docs
        .map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

      safeRender(renderInventory);
      safeRender(renderLowStockAlerts);
      safeRender(renderExpiring);
      safeRender(renderDashboardInventory);
      safeRender(updateStats);
      safeRender(populateCategoryFilter);
      safeRender(populateCategoryDatalist);
      safeRender(populateSalesCatFilter);
      safeRender(populateHistoryCatFilter);
      safeRender(renderCarousel);
      safeRender(renderPosProducts);
      safeRender(renderFastMoving);
      safeRender(renderSlowMoving);
      safeRender(autoFillSku);
      queueChartRender();
    },
    (err) => {
      console.error("[Inventory listener]", err.code, err.message);
      showToast("Inventory sync failed ❌ — check console");
    }
  );

  unsubscribers.sales = onSnapshot(
    query(collection(db, "sales"), where("workspaceId", "==", wsId)),
    (snap) => {
      sales = snap.docs
        .map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
        .sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        })
        .slice(0, 500);

      safeRender(renderSales);
      safeRender(renderHistory);
      safeRender(updateStats);
      safeRender(renderCarousel);
      safeRender(renderFastMoving);
      safeRender(renderSlowMoving);
      safeRender(renderSalesCategorySummary);
      safeRender(renderHistoryCategorySummary);
      safeRender(populateSalesCatFilter);
      safeRender(populateHistoryCatFilter);
      queueChartRender();
    },
    (err) => console.error("[Sales listener]", err.code, err.message)
  );

  unsubscribers.categories = onSnapshot(
    query(collection(db, "categories"), where("workspaceId", "==", wsId)),
    (snap) => {
      categories = snap.docs
        .map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      safeRender(renderCategories);
      safeRender(updateStats);
      safeRender(populateCategoryDatalist);
    },
    (err) => console.error("[Categories listener]", err.code, err.message)
  );

  unsubscribers.movements = onSnapshot(
    query(collection(db, "movements"), where("workspaceId", "==", wsId)),
    (snap) => {
      movements = snap.docs
        .map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
        .sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        })
        .slice(0, 100);
      safeRender(renderMovements);
    },
    (err) => console.error("[Movements listener]", err.code, err.message)
  );
}

function startUserAdminListener() {
  unsubscribers.users = onSnapshot(
    query(collection(db, "users")),
    (snap) => {
      allUsers = snap.docs
        .map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
        .sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
      safeRender(renderAdminUsers);
    },
    (err) => console.error("[Users listener]", err.code, err.message)
  );
}

function stopAllListeners() {
  Object.values(unsubscribers).forEach((u) => u && u());
  Object.keys(unsubscribers).forEach((k) => delete unsubscribers[k]);
  destroyCharts();
  stopCarousel();
  stopPosMiniCarousels();
}

/* ----------------------------------------------------------
   MOVEMENT LOGGING
   ---------------------------------------------------------- */
function movementDoc({ itemId, itemName, type, quantity, reason, note }) {
  return {
    workspaceId: myWorkspace(), itemId, itemName, type,
    quantity: Number(quantity),
    reason: reason || "other",
    note: note || "",
    userId: currentUser?.uid || null,
    createdAt: serverTimestamp()
  };
}

function settleWrite(promise, label = "Save") {
  const graceMs = navigator.onLine ? 3500 : 0;
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve({ pending: true }); } }, graceMs);
    promise.then(
      () => { if (!done) { done = true; clearTimeout(timer); resolve({ pending: false }); } },
      (err) => {
        console.error(`[${label}] write failed:`, err?.code, err?.message);
        if (!done) { done = true; clearTimeout(timer); reject(err); }
        else showToast(`${label} failed to sync: ${err?.code || err?.message} ❌`);
      }
    );
  });
}

/* ----------------------------------------------------------
   NAV
   ---------------------------------------------------------- */
navButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    forceCloseScanner();

    navButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    pages.forEach(p => p.classList.add("hidden"));
    const target = $(btn.dataset.page);
    if (target) target.classList.remove("hidden");

    if (btn.dataset.page === "page-dashboard") {
      safeRender(renderDashboardInventory);
      safeRender(renderCarousel);
      safeRender(renderFastMoving);
      safeRender(renderSlowMoving);
      safeRender(renderMovements);
      safeRender(renderExpiring);
      queueChartRender();
    }
    if (btn.dataset.page === "page-sales") {
      safeRender(renderPosProducts);
      safeRender(renderPosCart);
      safeRender(updateChange);
      safeRender(renderSalesCategorySummary);
      safeRender(populateSalesCatFilter);
      startPosMiniCarousels();
    }
    if (btn.dataset.page === "page-history") {
      safeRender(renderHistory);
      safeRender(renderHistoryCategorySummary);
      safeRender(populateHistoryCatFilter);
    }
    if (btn.dataset.page === "page-add") {
      safeRender(autoFillSku);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});

/* ----------------------------------------------------------
   PHOTO HANDLING
   ---------------------------------------------------------- */
function compressImage(file, maxSize = 420, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width, height } = img;
        if (width > height) {
          if (width > maxSize) { height *= maxSize / width; width = maxSize; }
        } else {
          if (height > maxSize) { width *= maxSize / height; height = maxSize; }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function showPhotoPreview(dataUrl) {
  if (!photoPreview) return;
  if (dataUrl) {
    photoPreview.classList.add("has-image");
    photoPreview.innerHTML = `<img src="${dataUrl}" alt="Preview" />`;
    photoRemoveBtn && photoRemoveBtn.classList.remove("hidden");
  } else {
    photoPreview.classList.remove("has-image");
    photoPreview.innerHTML = `<span class="photo-placeholder">📷<br>Add Photo</span>`;
    photoRemoveBtn && photoRemoveBtn.classList.add("hidden");
  }
}

async function handlePhotoFile(file) {
  if (!file) return;
  try {
    const dataUrl = await compressImage(file);
    setVal(itemImageData, dataUrl);
    showPhotoPreview(dataUrl);
    showToast("Photo ready ✅");
  } catch (err) {
    console.error("[photo]", err);
    showToast("Failed to process photo ❌");
  }
}

if (photoCameraBtn) photoCameraBtn.addEventListener("click", () => {
  if (itemImageCamera) itemImageCamera.click();
  else if (itemImage) itemImage.click();
});
if (itemImageCamera) itemImageCamera.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  handlePhotoFile(file);
  e.target.value = "";
});
if (photoPickBtn) photoPickBtn.addEventListener("click", () => {
  if (itemImage) itemImage.click();
});
if (itemImage) itemImage.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  handlePhotoFile(file);
  e.target.value = "";
});
if (photoPreview) photoPreview.addEventListener("click", () => {
  if (itemImage) itemImage.click();
});
if (photoRemoveBtn) photoRemoveBtn.addEventListener("click", () => {
  if (itemImage) itemImage.value = "";
  if (itemImageCamera) itemImageCamera.value = "";
  setVal(itemImageData, "");
  showPhotoPreview(null);
});

/* ----------------------------------------------------------
   PRODUCT IMAGE HELPERS
   ---------------------------------------------------------- */
const FALLBACK_COLORS = ["#12544F", "#2FA38F", "#5FC2A6", "#0C3E3A", "#16665F", "#0F4945"];
function fallbackColorFor(name) {
  return FALLBACK_COLORS[((name || "").charCodeAt(0) || 0) % FALLBACK_COLORS.length];
}
function productImageHTML(item, size = "md") {
  const cls = size === "sm" ? "product-img sm" : "product-img";
  if (item.image) return `<img class="${cls}" src="${item.image}" alt="${esc(item.name)}" loading="lazy" />`;
  const initial = (item.name || "?").charAt(0).toUpperCase();
  return `<div class="${cls} fallback" style="background:${fallbackColorFor(item.name)}">${initial}</div>`;
}
function thumbHTML(item) {
  if (item.image) return `<img src="${item.image}" alt="${esc(item.name)}" loading="lazy" />`;
  return esc((item.name || "?").charAt(0).toUpperCase());
}

/* ----------------------------------------------------------
   AUTO SKU
   ---------------------------------------------------------- */
function nextSku() {
  let max = 1000;
  inventory.forEach(item => {
    const n = parseInt(item.sku, 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return String(max + 1);
}
function autoFillSku() {
  if (!itemSku) return;
  if (itemId && itemId.value) return;
  if (manualSku) return;
  const next = nextSku();
  if (itemSku.value !== next) {
    itemSku.value = next;
    skuInitialized = true;
  }
}
if (itemSku) itemSku.addEventListener("input", () => {
  if (!skuInitialized) manualSku = true;
  else if (itemSku.value !== nextSku() && !manualSku) manualSku = true;
});

/* ==========================================================
   BARCODE SCANNER — v6
   ========================================================== */
const SCANNER_STATE = { IDLE: "idle", STARTING: "starting", RUNNING: "running", STOPPING: "stopping" };

let scannerInstance   = null;
let scannerState      = SCANNER_STATE.IDLE;
let scannerOpening    = false;
let scannerTarget     = null;
let scannerSession    = 0;
let lastScanCode      = "";
let lastScanTime      = 0;
let scanHandling      = false;
const SCAN_COOLDOWN_MS = 1500;

const SCAN_FPS = 10;
const SCAN_BOX = { w: 0.88, h: 0.56 };
const SCAN_VIDEO = {
  facingMode: "environment",
  width:  { ideal: 1280 },
  height: { ideal: 720 }
};

const scannerViewEl = $("scanner-view");

function getScannerFormats() {
  const F = window.Html5QrcodeSupportedFormats;
  if (!F) return null;
  return [
    F.QR_CODE, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39
  ].filter(v => v !== undefined && v !== null);
}

function setScannerStatus(html, type = "") {
  if (!scannerStatus) return;
  scannerStatus.innerHTML = html;
  scannerStatus.classList.remove("success", "error");
  if (type) scannerStatus.classList.add(type);
}

function checkCameraEnvironment() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: "This browser doesn't support camera access. Type the barcode below." };
  }
  const isHttps = location.protocol === "https:";
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  const isFile  = location.protocol === "file:";
  if (!isHttps && !isLocal && !isFile) {
    return { ok: false, reason: `Camera needs <b>HTTPS</b> or <b>localhost</b>.<br>Type the barcode below.` };
  }
  return { ok: true };
}

function scannerErrorText(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  return `${err.name || ""} ${err.message || ""}`.trim();
}
function isPermissionError(err) {
  return /NotAllowed|PermissionDenied|Permission denied/i.test(scannerErrorText(err));
}
function cameraErrorMessage(err) {
  const t = scannerErrorText(err);
  if (/NotAllowed|PermissionDenied|Permission denied/i.test(t))
    return "🚫 Camera permission <b>denied</b>. Allow camera in your browser settings and try again.";
  if (/NotFound|DevicesNotFound|no camera/i.test(t))
    return "📷 <b>No camera found</b>. Type the barcode below.";
  if (/NotReadable|TrackStart/i.test(t))
    return "⚠️ Camera is <b>busy</b> — another app is using it. Close it and try again.";
  if (/Overconstrained|ConstraintNotSatisfied/i.test(t))
    return "⚠️ Camera doesn't support the requested settings. Try again.";
  if (/SecurityError/i.test(t))
    return "🔒 Browser blocked camera access. Use HTTPS or localhost.";
  return "❌ Camera error: <code>" + esc(t.slice(0, 80)) + "</code>";
}

let matchFlashTimer = null;
function flashScanFrame() {
  if (!scannerViewEl) return;
  scannerViewEl.classList.add("matched");
  clearTimeout(matchFlashTimer);
  matchFlashTimer = setTimeout(() => scannerViewEl.classList.remove("matched"), 600);
}

function openScanner(target) {
  if (scannerOpening) return;
  if (scannerState !== SCANNER_STATE.IDLE) return;
  if (scannerModal && !scannerModal.classList.contains("hidden")) return;

  scannerOpening = true;
  scannerTarget  = target;
  scanHandling   = false;
  const session  = ++scannerSession;

  if (scannerTitle) {
    scannerTitle.textContent =
      target === "barcode" ? "Scan Product Barcode" :
      target === "sale"    ? "Scan Items for POS"  :
      "Scan Barcode";
  }

  if (scannerManualInput) scannerManualInput.value = "";
  if (scannerViewEl) {
    scannerViewEl.style.setProperty("--scan-w", (SCAN_BOX.w * 100) + "%");
    scannerViewEl.style.setProperty("--scan-h", (SCAN_BOX.h * 100) + "%");
    scannerViewEl.classList.remove("matched");
  }
  if (scannerModal) scannerModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  const env = checkCameraEnvironment();
  if (!env.ok) {
    setScannerStatus(env.reason, "error");
    setTimeout(() => scannerManualInput?.focus(), 250);
    scannerOpening = false;
    return;
  }

  if (typeof Html5Qrcode === "undefined") {
    setScannerStatus("Scanner library not loaded. Type the barcode below.", "error");
    setTimeout(() => scannerManualInput?.focus(), 250);
    scannerOpening = false;
    return;
  }

  setScannerStatus("Starting camera…");
  requestAnimationFrame(() => { startCameraNow(session).catch((e) => console.warn("[Scanner] start:", e)); });
}

async function startCameraNow(session) {
  const readerEl = document.getElementById("scanner-reader");
  const viewEl   = document.getElementById("scanner-view");
  if (!readerEl) { scannerOpening = false; return; }

  let rect = (viewEl || readerEl).getBoundingClientRect();
  if (rect.width < 40 || rect.height < 40) {
    await new Promise(r => setTimeout(r, 200));
    if (session !== scannerSession) return;
    rect = (viewEl || readerEl).getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) {
      setScannerStatus("Scanner viewport has no size. Type the barcode below.", "error");
      scannerOpening = false;
      return;
    }
  }
  await startScanning(readerEl, session);
}

async function startScanning(readerEl, session) {
  try { readerEl.innerHTML = ""; } catch (e) {}

  let inst;
  try {
    const opts = { verbose: false, useBarCodeDetectorIfSupported: true };
    const formats = getScannerFormats();
    if (formats?.length) opts.formatsToSupport = formats;
    inst = new Html5Qrcode("scanner-reader", opts);
  } catch (e) {
    console.error("[Scanner] init failed:", e);
    setScannerStatus("Scanner init failed. Type the barcode below.", "error");
    scannerOpening = false;
    scannerState = SCANNER_STATE.IDLE;
    return;
  }
  scannerInstance = inst;
  scannerState = SCANNER_STATE.STARTING;

  const baseCfg = {
    fps: SCAN_FPS,
    disableFlip: true,
    qrbox: (vw, vh) => ({
      width:  Math.max(120, Math.floor(vw * SCAN_BOX.w)),
      height: Math.max(80,  Math.floor(vh * SCAN_BOX.h))
    })
  };
  const onDecode = (text) => onScanSuccess(text);
  const onMiss = () => {};

  const attempts = [
    () => inst.start({ facingMode: "environment" }, { ...baseCfg, videoConstraints: SCAN_VIDEO }, onDecode, onMiss),
    async () => {
      const cams = await Html5Qrcode.getCameras();
      if (!cams?.length) throw "NotFoundError: no camera";
      const saved = localStorage.getItem("preferredCameraId") || "";
      const cam = cams.find(c => /back|rear|environment/i.test(c.label || "")) ||
                  cams.find(c => c.id === saved) || cams[0];
      await inst.start(cam.id, baseCfg, onDecode, onMiss);
      try { localStorage.setItem("preferredCameraId", cam.id); } catch (e) {}
    },
    () => inst.start({ facingMode: "user" }, baseCfg, onDecode, onMiss)
  ];

  let lastErr = null;
  for (const attempt of attempts) {
    if (session !== scannerSession) return;
    try {
      await attempt();
      if (session !== scannerSession) {
        try { await inst.stop(); } catch (e) {}
        try { inst.clear(); } catch (e) {}
        return;
      }
      scannerState = SCANNER_STATE.RUNNING;
      scannerOpening = false;
      const invCount = inventory.length;
      const hint = invCount
        ? `${invCount} item${invCount !== 1 ? "s" : ""} loaded`
        : "⚠️ inventory still loading…";
      setScannerStatus(
        scannerTarget === "sale"
          ? `Point at a barcode. Keep scanning to add more. (${hint})`
          : `Point the camera at a barcode… (${hint})`
      );
      return;
    } catch (err) {
      lastErr = err;
      console.warn("[Scanner] start attempt failed:", scannerErrorText(err));
      if (isPermissionError(err)) break;
    }
  }

  if (session !== scannerSession) return;
  scannerOpening = false;
  scannerState = SCANNER_STATE.IDLE;
  scannerInstance = null;
  setScannerStatus(cameraErrorMessage(lastErr), "error");
  setTimeout(() => scannerManualInput?.focus(), 200);
}

async function shutdownScanner() {
  scannerSession++;
  const inst = scannerInstance;
  scannerInstance = null;
  scannerState = SCANNER_STATE.STOPPING;

  const readerEl = document.getElementById("scanner-reader");

  if (inst) {
    try { await inst.stop(); } catch (e) {}
    try { inst.clear?.(); } catch (e) {}
  }

  if (readerEl) {
    try {
      readerEl.querySelectorAll("video").forEach(v => {
        try {
          if (v.srcObject) v.srcObject.getTracks().forEach(t => t.stop());
          v.pause();
          v.srcObject = null;
        } catch (e) {}
      });
      readerEl.innerHTML = "";
    } catch (e) {}
  }

  scannerState    = SCANNER_STATE.IDLE;
  scannerOpening  = false;
  scanHandling    = false;
  lastScanCode    = "";
  lastScanTime    = 0;
}

function forceCloseScanner() {
  if (scannerModal) scannerModal.classList.add("hidden");
  document.body.style.overflow = "";
  shutdownScanner().catch(() => {});
}

function closeScanner() {
  if (scannerModal) scannerModal.classList.add("hidden");
  document.body.style.overflow = "";
  shutdownScanner().catch(() => {});
}

async function retryScanner() {
  await shutdownScanner();
  await new Promise(r => setTimeout(r, 350));
  openScanner(scannerTarget || "sale");
}

function onScanSuccess(decodedText) {
  if (scanHandling) return;
  if (!scannerModal || scannerModal.classList.contains("hidden")) return;

  const code = String(decodedText || "").trim();
  if (!code) return;

  const now = Date.now();
  if (code === lastScanCode && (now - lastScanTime) < SCAN_COOLDOWN_MS) return;

  lastScanCode  = code;
  lastScanTime  = now;
  scanHandling  = true;
  flashScanFrame();

  try {
    handleScanResult(code);
  } finally {
    setTimeout(() => { scanHandling = false; }, 350);
  }
}

function findItemByCode(code) {
  if (!code) return null;
  const norm  = String(code).trim().replace(/\s+/g, "");
  if (!norm) return null;
  const lower = norm.toLowerCase();

  let item = inventory.find(i => i.barcode && String(i.barcode).trim() === norm);
  if (item) return item;
  item = inventory.find(i => i.barcode && String(i.barcode).trim().toLowerCase() === lower);
  if (item) return item;
  item = inventory.find(i => i.sku && String(i.sku).trim() === norm);
  if (item) return item;
  item = inventory.find(i => i.sku && String(i.sku).trim().toLowerCase() === lower);
  if (item) return item;
  item = inventory.find(i =>
    (i.barcode && String(i.barcode).trim().toLowerCase().includes(lower)) ||
    (i.sku && String(i.sku).trim().toLowerCase().includes(lower))
  );
  return item || null;
}

function handleScanResult(text) {
  const code = String(text || "").trim();
  if (!code) return;

  if (scannerTarget === "barcode") {
    if (itemBarcode) itemBarcode.value = code;
    playSuccessSound();
    setScannerStatus("✅ Barcode set: " + code, "success");
    setTimeout(() => forceCloseScanner(), 500);
    return;
  }

  if (scannerTarget === "sale") {
    if (!inventory.length) {
      playErrorSound();
      setScannerStatus("⚠️ Inventory still loading. Wait a moment and scan again.", "error");
      return;
    }
    const item = findItemByCode(code);
    if (!item) {
      playErrorSound();
      setScannerStatus(`❌ No match for: ${code}  ·  ${inventory.length} items loaded`, "error");
      return;
    }
    addToCart(item.id);
    playSuccessSound();
    const cartCount = posCart.reduce((s, c) => s + c.qty, 0);
    setScannerStatus(
      `✅ Added: ${item.name}  ·  Cart: ${cartCount} item${cartCount !== 1 ? "s" : ""}`,
      "success"
    );
  }
}

if (scanBarcodeBtn) scanBarcodeBtn.addEventListener("click", () => openScanner("barcode"));
if (scanSaleBtn)    scanSaleBtn.addEventListener("click", () => openScanner("sale"));
if (scannerClose)   scannerClose.addEventListener("click", closeScanner);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && scannerModal && !scannerModal.classList.contains("hidden")) {
    closeScanner();
  }
});
if (scannerModal) {
  scannerModal.addEventListener("click", (e) => {
    if (e.target === scannerModal) closeScanner();
  });
}
if (scannerManualBtn) scannerManualBtn.addEventListener("click", () => {
  const val = valOf(scannerManualInput).trim();
  if (val) handleScanResult(val);
});
if (scannerManualInput) scannerManualInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); scannerManualBtn?.click(); }
});
if (scannerRetryBtn) scannerRetryBtn.addEventListener("click", retryScanner);

if (scannerUploadBtn && scannerUploadInput) {
  scannerUploadBtn.addEventListener("click", () => scannerUploadInput.click());
  scannerUploadInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setScannerStatus("Scanning image…");
    try {
      await shutdownScanner();
      await new Promise(r => setTimeout(r, 200));
      if (scannerModal) scannerModal.classList.remove("hidden");
      await new Promise(r => requestAnimationFrame(r));
      const temp = new Html5Qrcode("scanner-reader", { verbose: false });
      const result = await temp.scanFile(file, true);
      try { temp.clear(); } catch (err) {}
      handleScanResult(result);
      setTimeout(() => forceCloseScanner(), 700);
    } catch (err) {
      console.warn("[Scanner] image scan failed:", err);
      setScannerStatus("❌ No barcode found in that image.", "error");
    }
  });
}
/* ==========================================================
   END BARCODE SCANNER
   ========================================================== */

/* ----------------------------------------------------------
   DATA HELPERS
   ---------------------------------------------------------- */
function getSoldMap() {
  const map = {};
  sales.forEach(s => { if (s.itemId) map[s.itemId] = (map[s.itemId] || 0) + (s.quantity || 0); });
  return map;
}
function getSoldMapLastDays(days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const map = {};
  sales.forEach(s => {
    const ms = s.createdAt?.toMillis?.() ?? 0;
    if (ms < cutoff) return;
    if (s.itemId) map[s.itemId] = (map[s.itemId] || 0) + (s.quantity || 0);
  });
  return map;
}
function getLastSoldMs(itemId) {
  let last = 0;
  sales.forEach(s => {
    if (s.itemId !== itemId) return;
    const ms = s.createdAt?.toMillis?.() ?? 0;
    if (ms > last) last = ms;
  });
  return last;
}

/* NEW: aggregate sales by category */
function getSalesByCategory(list = sales) {
  const map = {};
  list.forEach(s => {
    const cat = (s.category || "Uncategorized").trim() || "Uncategorized";
    if (!map[cat]) map[cat] = { total: 0, count: 0, qty: 0 };
    map[cat].total += Number(s.total) || 0;
    map[cat].count += 1;
    map[cat].qty   += Number(s.quantity) || 0;
  });
  return map;
}

/* ----------------------------------------------------------
   EXPIRY HELPERS
   ---------------------------------------------------------- */
function parseExpiry(iso) {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}
function daysUntilExpiry(iso) {
  const d = parseExpiry(iso);
  if (!d) return null;
  const now = new Date(); now.setHours(0,0,0,0);
  return Math.round((d - now) / (24 * 60 * 60 * 1000));
}
function expiryStatus(iso) {
  const days = daysUntilExpiry(iso);
  if (days === null) return { level: "none", days: null, label: "" };
  if (days < 0)  return { level: "expired",  days, label: `Expired ${Math.abs(days)}d ago` };
  if (days === 0) return { level: "expired", days, label: "Expires today" };
  if (days <= EXPIRY_WARNING_DAYS) return { level: "expiring", days, label: `Expires in ${days}d` };
  const d = parseExpiry(iso);
  return { level: "ok", days, label: `Expires ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}` };
}

/* ----------------------------------------------------------
   POS — CART
   ---------------------------------------------------------- */
function addToCart(itemId) {
  const item = inventory.find(i => i.id === itemId);
  if (!item) return;
  if (item.quantity <= 0) { playErrorSound(); showToast("Out of stock ❌"); return; }
  const existing = posCart.find(c => c.itemId === itemId);
  if (existing) {
    if (existing.qty + 1 > item.quantity) { playErrorSound(); showToast("Not enough stock ❌"); return; }
    existing.qty++;
  } else {
    posCart.push({ itemId, name: item.name, price: item.price, qty: 1, stock: item.quantity });
  }
  renderPosCart(); updateChange();
}
function updateCartQty(itemId, delta) {
  const entry = posCart.find(c => c.itemId === itemId);
  if (!entry) return;
  const item = inventory.find(i => i.id === itemId);
  if (!item) return;
  const next = entry.qty + delta;
  if (next <= 0) { removeFromCart(itemId); return; }
  if (next > item.quantity) { playErrorSound(); showToast("Not enough stock ❌"); return; }
  entry.qty = next;
  renderPosCart(); updateChange();
}
function removeFromCart(itemId) {
  posCart = posCart.filter(c => c.itemId !== itemId);
  renderPosCart(); updateChange();
}
function getCartTotal() { return posCart.reduce((s, c) => s + c.qty * c.price, 0); }
function clearCart() {
  posCart = [];
  if (posCashInput) posCashInput.value = "";
  renderPosCart(); updateChange();
}
function renderPosCart() {
  if (!posCartItems) return;
  if (!posCart.length) {
    posCartItems.innerHTML = `<div class="pos-cart-empty">Tap a product or scan a barcode to add.</div>`;
  } else {
    posCartItems.innerHTML = posCart.map(c => `
      <div class="pos-cart-item">
        <div class="pos-ci-main">
          <div class="pos-ci-name">${esc(c.name)}</div>
          <div class="pos-ci-meta">₱${c.price.toFixed(2)} × ${c.qty}</div>
        </div>
        <div class="pos-ci-qty">
          <button type="button" class="pos-qty-btn" data-act="dec" data-id="${c.itemId}">−</button>
          <span class="pos-ci-qty-num">${c.qty}</span>
          <button type="button" class="pos-qty-btn" data-act="inc" data-id="${c.itemId}">+</button>
        </div>
        <div class="pos-ci-sub">₱${(c.price * c.qty).toFixed(2)}</div>
        <button type="button" class="pos-ci-remove" data-act="rm" data-id="${c.itemId}" title="Remove">✕</button>
      </div>
    `).join("");
  }
  if (posTotalEl) posTotalEl.textContent = "₱" + getCartTotal().toFixed(2);
}
function updateChange() {
  if (!posChangeEl) return;
  const total = getCartTotal();
  const cash = Number(valOf(posCashInput)) || 0;
  const change = cash - total;
  if (cash === 0) { posChangeEl.textContent = "₱0.00"; posChangeEl.classList.remove("insufficient"); }
  else if (change < 0) { posChangeEl.textContent = "−₱" + Math.abs(change).toFixed(2); posChangeEl.classList.add("insufficient"); }
  else { posChangeEl.textContent = "₱" + change.toFixed(2); posChangeEl.classList.remove("insufficient"); }
}
if (posCartItems) posCartItems.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const id = btn.dataset.id, act = btn.dataset.act;
  if (act === "inc") updateCartQty(id, 1);
  else if (act === "dec") updateCartQty(id, -1);
  else if (act === "rm") removeFromCart(id);
});
if (posCashInput) posCashInput.addEventListener("input", updateChange);
if (posClearBtn) posClearBtn.addEventListener("click", () => { clearCart(); showToast("Cart cleared 🧹"); });

/* ----------------------------------------------------------
   POS — Product grid
   ---------------------------------------------------------- */
function buildPosMiniSlides(item, sold) {
  const slides = [];
  const isLow = item.quantity > 0 && item.quantity <= (item.threshold ?? 5);
  const isOut = item.quantity === 0;
  const createdMs = item.createdAt?.toMillis?.() ?? 0;
  const isNew = createdMs && (Date.now() - createdMs) < NEW_ARRIVAL_WINDOW_MS;
  const revenue = sold * (item.price || 0);
  const exp = expiryStatus(item.expiry);
  if (exp.level === "expired") slides.push({ cls: "expiry", text: `⛔ ${exp.label.toUpperCase()}` });
  else if (exp.level === "expiring") slides.push({ cls: "expiry", text: `⏰ ${exp.label.toUpperCase()}` });
  if (isNew) slides.push({ cls: "new", text: "✨ NEW ARRIVAL" });
  if (sold > 0) slides.push({ cls: "hot", text: `🔥 ${sold} SOLD` });
  if (isOut) slides.push({ cls: "low", text: "🚫 OUT OF STOCK" });
  else if (isLow) slides.push({ cls: "low", text: `⚠️ ONLY ${item.quantity} LEFT` });
  if (revenue > 0) slides.push({ cls: "ok", text: `💰 ₱${revenue.toFixed(0)} SALES` });
  slides.push({ cls: "ok", text: `📦 ${item.quantity} IN STOCK` });
  return slides;
}
function renderPosProducts() {
  if (!salesProductsGrid) return;
  const term = valOf(salesSearchEl).toLowerCase().trim();
  const catFilter = valOf(salesCatFilterEl);
  const filtered = inventory.filter(i => {
    if (catFilter && i.category !== catFilter) return false;
    if (!term) return true;
    return (i.name || "").toLowerCase().includes(term) ||
           (i.sku || "").toLowerCase().includes(term) ||
           (i.barcode || "").toLowerCase().includes(term);
  });
  if (!filtered.length) {
    salesProductsGrid.innerHTML = `<div class="empty-state"><p>📭 No products. Add one from Add Item.</p></div>`;
    stopPosMiniCarousels();
    return;
  }
  const soldMap = getSoldMap();
  salesProductsGrid.innerHTML = filtered.map(item => {
    const isOut = item.quantity === 0;
    const isLow = item.quantity > 0 && item.quantity <= (item.threshold ?? 5);
    const sold = soldMap[item.id] || 0;
    const media = item.image
      ? `<img src="${item.image}" alt="${esc(item.name)}" loading="lazy" />`
      : `<div class="fallback" style="background:${fallbackColorFor(item.name)}">${esc((item.name || "?").charAt(0).toUpperCase())}</div>`;
    const stockPill = isOut
      ? `<span class="pos-stock-pill out">Out</span>`
      : isLow
      ? `<span class="pos-stock-pill low">${item.quantity} left</span>`
      : `<span class="pos-stock-pill">${item.quantity}</span>`;
    const slides = buildPosMiniSlides(item, sold);
    const slideHTML = slides.map(s => `<div class="pos-mini-slide ${s.cls}">${esc(s.text)}</div>`).join("");
    return `
      <div class="pos-card ${isOut ? "is-out" : ""}" data-id="${item.id}">
        <div class="pos-media">${media}${stockPill}</div>
        <div class="pos-info">
          <div class="pos-name" title="${esc(item.name)}">${esc(item.name)}</div>
          <div class="pos-price">₱${Number(item.price).toFixed(2)}</div>
          <div class="pos-sku">${esc(item.barcode || item.sku)}</div>
        </div>
        <div class="pos-mini" data-count="${slides.length}">
          <div class="pos-mini-track">${slideHTML}</div>
        </div>
      </div>
    `;
  }).join("");
  salesProductsGrid.querySelectorAll(".pos-card").forEach(card => {
    card.addEventListener("click", () => addToCart(card.dataset.id));
  });
  startPosMiniCarousels();
}
function startPosMiniCarousels() {
  stopPosMiniCarousels();
  posMiniIndex = 0;
  posMiniTimer = setInterval(() => {
    const salesPage = $("page-sales");
    if (salesPage && salesPage.classList.contains("hidden")) return;
    if (scannerModal && !scannerModal.classList.contains("hidden")) return;
    posMiniIndex++;
    document.querySelectorAll(".pos-mini").forEach(carousel => {
      const count = parseInt(carousel.dataset.count || "1");
      if (count <= 1) return;
      const idx = posMiniIndex % count;
      const track = carousel.querySelector(".pos-mini-track");
      if (track) track.style.transform = `translateY(-${idx * 24}px)`;
    });
  }, 2600);
}
function stopPosMiniCarousels() { if (posMiniTimer) { clearInterval(posMiniTimer); posMiniTimer = null; } }
if (salesSearchEl) salesSearchEl.addEventListener("input", debounce(renderPosProducts, 150));
if (salesCatFilterEl) salesCatFilterEl.addEventListener("change", renderPosProducts);

/* ----------------------------------------------------------
   POS — Complete sale
   ---------------------------------------------------------- */
function newReceiptNum() {
  const d = new Date();
  const ymd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
  const sod = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()).toString(36).toUpperCase().padStart(4, "0");
  const rnd = Math.floor(Math.random() * 36).toString(36).toUpperCase();
  return `INV-${ymd}-${sod}${rnd}`;
}

let checkoutBusy = false;
if (posCheckoutBtn) posCheckoutBtn.addEventListener("click", async () => {
  if (checkoutBusy) return;
  if (!posCart.length) { showToast("Cart is empty ❌"); return; }
  const wsId = myWorkspace();
  if (!wsId) { showToast("Workspace not ready ❌"); return; }

  const lines = [];
  for (const ci of posCart) {
    const item = inventory.find(i => i.id === ci.itemId);
    if (!item) { playErrorSound(); showToast(`"${ci.name}" no longer exists — remove it from the cart ❌`); return; }
    if (ci.qty > item.quantity) { playErrorSound(); showToast(`Not enough stock for ${item.name} ❌`); return; }
    lines.push({ item, qty: ci.qty, price: Number(item.price) || 0 });
  }
  const total = lines.reduce((sum, l) => sum + l.qty * l.price, 0);
  const cash = Number(valOf(posCashInput)) || 0;
  if (cash < total) { playErrorSound(); showToast("Insufficient cash ❌"); return; }
  const change = cash - total;
  const receiptNum = newReceiptNum();
  const now = new Date();

  checkoutBusy = true;
  posCheckoutBtn.disabled = true;
  try {
    const batch = writeBatch(db);
    lines.forEach(({ item, qty, price }) => {
      batch.set(doc(collection(db, "sales")), {
        itemId: item.id, itemName: item.name, category: item.category,
        quantity: qty, unitPrice: price, total: qty * price,
        cost: item.cost || 0,
        profit: (price - (item.cost || 0)) * qty,
        workspaceId: wsId, receiptNum, cash, change,
        createdAt: serverTimestamp(), userId: currentUser.uid
      });
      batch.update(doc(db, "inventory", item.id), {
        quantity: increment(-qty), updatedAt: serverTimestamp()
      });
      batch.set(doc(collection(db, "movements")), movementDoc({
        itemId: item.id, itemName: item.name,
        type: "out", quantity: qty, reason: "sale", note: `Receipt ${receiptNum}`
      }));
    });
    await settleWrite(batch.commit(), "Sale");

    showReceipt({
      items: lines.map(l => ({ name: l.item.name, qty: l.qty, price: l.price })),
      total, cash, change, receiptNum, date: now,
      cashier: currentUser.email
    });
    playCashSound();
    clearCart();
    showToast("Sale completed ✅");
  } catch (err) {
    console.error("[POS sale]", err.code, err.message);
    showToast(`Failed: ${err.code || err.message} ❌`);
  } finally {
    checkoutBusy = false;
    posCheckoutBtn.disabled = false;
  }
});

/* ----------------------------------------------------------
   RECEIPT MODAL
   ---------------------------------------------------------- */
function showReceipt(data, groupInfo) {
  if (!receiptContent) return;
  const d = data.date;
  const dateStr = d.toLocaleString(undefined, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  });
  const money = (n) => "₱" + (Number(n) || 0).toFixed(2);
  const itemsHTML = data.items.map(it => `
    <div class="receipt-item">
      <div class="receipt-item-row1">
        <span>${esc(it.name)}</span>
        <span>${money((Number(it.qty) || 0) * (Number(it.price) || 0))}</span>
      </div>
      <div class="receipt-item-row2">
        <span>${Number(it.qty) || 0} × ${money(it.price)}</span>
        <span></span>
      </div>
    </div>
  `).join("");

  receiptContent.innerHTML = `
    <div class="receipt-header">
      <div class="receipt-store">${esc(STORE_NAME.toUpperCase())}</div>
      <div class="receipt-sub">${esc(STORE_TAGLINE)}</div>
    </div>
    <div class="receipt-sep"></div>
    <div class="receipt-meta">
      <div>Date: ${esc(dateStr)}</div>
      <div>Receipt #: ${esc(data.receiptNum)}</div>
      <div>Cashier: ${esc(data.cashier || "-")}</div>
    </div>
    <div class="receipt-sep"></div>
    <div class="receipt-items">${itemsHTML}</div>
    <div class="receipt-sep"></div>
    <div class="receipt-totals">
      <div class="rt-line big"><span>TOTAL</span><span>${money(data.total)}</span></div>
      <div class="rt-line"><span>Cash</span><span>${money(data.cash)}</span></div>
      <div class="rt-line"><span>Change</span><span>${money(data.change)}</span></div>
    </div>
    <div class="receipt-footer">
      <strong>Thank you for your purchase!</strong>
      Please come again 🙏
    </div>
  `;

  currentReceiptGroup = groupInfo || null;
  if (deleteReceiptBtn) {
    deleteReceiptBtn.classList.toggle("hidden", !currentReceiptGroup);
  }
  receiptModal && receiptModal.classList.remove("hidden");
}
if (printReceiptBtn) printReceiptBtn.addEventListener("click", () => window.print());
if (closeReceiptBtn) closeReceiptBtn.addEventListener("click", () => {
  receiptModal && receiptModal.classList.add("hidden");
  currentReceiptGroup = null;
});
if (deleteReceiptBtn) deleteReceiptBtn.addEventListener("click", () => {
  if (!currentReceiptGroup) return;
  const group = currentReceiptGroup;
  receiptModal && receiptModal.classList.add("hidden");
  currentReceiptGroup = null;
  deleteReceiptGroup(group.saleIds, group.receiptNum);
});

/* ----------------------------------------------------------
   VIEW A SALE RECEIPT
   ---------------------------------------------------------- */
window.viewSaleReceipt = (saleId) => {
  const sale = sales.find(s => s.id === saleId);
  if (!sale) { showToast("Sale not found ❌"); return; }
  const receiptNum = sale.receiptNum;
  const lineItems = receiptNum ? sales.filter(s => s.receiptNum === receiptNum) : [sale];
  const items = lineItems.map(s => ({
    name: s.itemName, qty: s.quantity, price: s.unitPrice || 0
  }));
  const total  = lineItems.reduce((sum, s) => sum + (s.total || 0), 0);
  const cash   = sale.cash   || total;
  const change = sale.change || 0;
  const date   = sale.createdAt?.toDate?.() || new Date();
  showReceipt({
    items, total, cash, change,
    receiptNum: receiptNum || ("SALE-" + saleId.slice(0, 8).toUpperCase()),
    date, cashier: currentUser?.email || "-"
  }, {
    receiptNum: receiptNum || ("SALE-" + saleId.slice(0, 8).toUpperCase()),
    saleIds: lineItems.map(s => s.id),
    total
  });
};

/* ----------------------------------------------------------
   DELETE A SINGLE SALE
   ---------------------------------------------------------- */
window.deleteSale = async (id) => {
  const sale = sales.find(s => s.id === id);
  if (!sale) { showToast("Sale not found ❌"); return; }
  const msg = `Delete this sale?\n\n${sale.itemName} × ${sale.quantity} — ₱${Number(sale.total || 0).toFixed(2)}\n\n⚠️ Quantity will be restored to inventory.`;
  if (!confirm(msg)) return;
  try {
    const batch = writeBatch(db);
    queueSaleRemoval(batch, sale, `Sale ${sale.receiptNum || id} deleted`);
    await settleWrite(batch.commit(), "Delete sale");
    playSuccessSound();
    showToast("Sale deleted & stock restored ✅");
  } catch (err) {
    console.error("[delete sale] FAILED:", err.code, err.message);
    showToast(`Failed: ${err.code || err.message} ❌`);
  }
};

function queueSaleRemoval(batch, sale, note) {
  if (sale.itemId && inventory.some(i => i.id === sale.itemId)) {
    batch.update(doc(db, "inventory", sale.itemId), {
      quantity: increment(sale.quantity || 0), updatedAt: serverTimestamp()
    });
    batch.set(doc(collection(db, "movements")), movementDoc({
      itemId: sale.itemId, itemName: sale.itemName,
      type: "in", quantity: sale.quantity || 0, reason: "adjustment", note
    }));
  }
  batch.delete(doc(db, "sales", sale.id));
}

/* ----------------------------------------------------------
   DELETE A RECEIPT GROUP
   ---------------------------------------------------------- */
async function deleteReceiptGroup(saleIds, receiptNum) {
  if (!saleIds || !saleIds.length) return;
  const itemCount = saleIds.length;
  const msg = `Delete this entire receipt?\n\n${itemCount} item${itemCount !== 1 ? "s" : ""} will be removed.\n\n⚠️ All quantities will be restored to inventory.`;
  if (!confirm(msg)) return;
  try {
    const batch = writeBatch(db);
    saleIds.forEach(id => {
      const sale = sales.find(s => s.id === id);
      if (sale) queueSaleRemoval(batch, sale, `Receipt ${receiptNum || id} deleted`);
    });
    await settleWrite(batch.commit(), "Delete receipt");
    playSuccessSound();
    showToast(`Receipt deleted · ${itemCount} item${itemCount !== 1 ? "s" : ""} restored ✅`);
  } catch (err) {
    console.error("[delete receipt group] FAILED:", err.code, err.message);
    showToast(`Failed: ${err.code || err.message} ❌`);
  }
}

/* ----------------------------------------------------------
   RESTOCK
   ---------------------------------------------------------- */
window.restockItem = (id) => {
  const item = inventory.find(i => i.id === id);
  if (!item) return;
  restockItemId = id;
  if (restockItemName) restockItemName.textContent = item.name;
  if (restockCurrent) restockCurrent.textContent = `Current stock: ${item.quantity} · SKU: ${item.sku}${item.barcode ? " · Barcode: " + item.barcode : ""}`;
  if (restockQty) restockQty.value = 10;
  restockModal && restockModal.classList.remove("hidden");
  setTimeout(() => restockQty && restockQty.focus(), 100);
};
if (restockClose) restockClose.addEventListener("click", () => restockModal && restockModal.classList.add("hidden"));
if (restockConfirm) restockConfirm.addEventListener("click", async () => {
  const qty = Number(valOf(restockQty));
  if (!qty || qty <= 0) { showToast("Enter a valid quantity ❌"); return; }
  const item = inventory.find(i => i.id === restockItemId);
  if (!item) return;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "inventory", restockItemId), {
      quantity: increment(qty), updatedAt: serverTimestamp()
    });
    batch.set(doc(collection(db, "movements")), movementDoc({
      itemId: item.id, itemName: item.name,
      type: "in", quantity: qty, reason: "restock", note: ""
    }));
    await settleWrite(batch.commit(), "Restock");
    playSuccessSound();
    showToast(`Restocked +${qty} ✅`);
    restockModal && restockModal.classList.add("hidden");
  } catch (err) {
    console.error("[restock]", err.code, err.message);
    showToast(`Failed: ${err.code || err.message} ❌`);
  }
});

/* ----------------------------------------------------------
   EXPORTS  (mobile-friendly direct download)
   ---------------------------------------------------------- */
function exportInventoryToExcel() {
  if (!inventory.length) { showToast("No inventory to export ❌"); return; }
  if (typeof XLSX === "undefined") { showToast("Excel library not loaded ❌"); return; }
  const data = inventory.map(i => ({
    Name: i.name, SKU: i.sku, Barcode: i.barcode || "",
    Category: i.category, Quantity: i.quantity,
    "Cost (₱)": Number((i.cost || 0).toFixed(2)),
    "Price (₱)": Number((i.price || 0).toFixed(2)),
    Threshold: i.threshold ?? 5, Expiry: i.expiry || "",
    "Stock Value (₱)": Number(((i.quantity || 0) * (i.price || 0)).toFixed(2))
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Inventory");
  downloadXLSX(wb, `inventory_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast("Inventory exported ✅");
}
function exportInventoryToPDF() {
  if (!inventory.length) { showToast("No inventory to export ❌"); return; }
  if (!window.jspdf) { showToast("PDF library not loaded ❌"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16); doc.text("Inventory Report", 14, 18);
  doc.setFontSize(10); doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 24);
  doc.autoTable({
    startY: 30,
    head: [["Name", "SKU", "Barcode", "Category", "Qty", "Cost", "Price", "Expiry"]],
    body: inventory.map(i => [i.name, i.sku, i.barcode || "-", i.category, i.quantity, (i.cost||0).toFixed(2), (i.price||0).toFixed(2), i.expiry || "-"]),
    styles: { fontSize: 8 }, headStyles: { fillColor: [18, 84, 79] }
  });
  downloadPDF(doc, `inventory_${new Date().toISOString().slice(0,10)}.pdf`);
  showToast("Inventory PDF exported ✅");
}
function exportSalesToExcel() {
  if (!sales.length) { showToast("No sales to export ❌"); return; }
  if (typeof XLSX === "undefined") { showToast("Excel library not loaded ❌"); return; }
  const data = sales.map(s => ({
    Date: s.createdAt?.toDate?.().toLocaleString() ?? "",
    Receipt: s.receiptNum || "", Item: s.itemName, Category: s.category,
    Qty: s.quantity,
    "Unit Price (₱)": Number((s.unitPrice || 0).toFixed(2)),
    "Cost (₱)": Number((s.cost || 0).toFixed(2)),
    "Profit (₱)": Number((s.profit || 0).toFixed(2)),
    "Total (₱)": Number((s.total || 0).toFixed(2)),
    Cash: Number((s.cash || 0).toFixed(2)),
    Change: Number((s.change || 0).toFixed(2))
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sales");
  downloadXLSX(wb, `sales_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast("Sales exported ✅");
}
function exportSalesToPDF() {
  if (!sales.length) { showToast("No sales to export ❌"); return; }
  if (!window.jspdf) { showToast("PDF library not loaded ❌"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16); doc.text("Sales Report", 14, 18);
  doc.setFontSize(10); doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 24);
  doc.autoTable({
    startY: 30,
    head: [["Date", "Receipt", "Item", "Qty", "Unit", "Profit", "Total"]],
    body: sales.map(s => [
      s.createdAt?.toDate?.().toLocaleString() ?? "-",
      s.receiptNum || "-", s.itemName, s.quantity,
      (s.unitPrice || 0).toFixed(2),
      (s.profit || 0).toFixed(2),
      (s.total || 0).toFixed(2)
    ]),
    styles: { fontSize: 8 }, headStyles: { fillColor: [18, 84, 79] }
  });
  downloadPDF(doc, `sales_${new Date().toISOString().slice(0,10)}.pdf`);
  showToast("Sales PDF exported ✅");
}
function exportMovementsToExcel() {
  if (!movements.length) { showToast("No movements to export ❌"); return; }
  if (typeof XLSX === "undefined") { showToast("Excel library not loaded ❌"); return; }
  const data = movements.map(m => ({
    Date: m.createdAt?.toDate?.().toLocaleString() ?? "",
    Item: m.itemName,
    Type: m.type === "in" ? "IN (+)" : "OUT (−)",
    Quantity: m.quantity, Reason: m.reason || "", Note: m.note || ""
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Movements");
  downloadXLSX(wb, `movements_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast("Movements exported ✅");
}
function exportHistoryToExcel() {
  const groups = groupSalesByReceipt();
  if (!groups.length) { showToast("No history to export ❌"); return; }
  if (typeof XLSX === "undefined") { showToast("Excel library not loaded ❌"); return; }
  const rows = [];
  groups.forEach(g => {
    g.items.forEach(it => {
      rows.push({
        Receipt: g.receiptNum,
        Date: g.date?.toLocaleString() || "",
        Item: it.itemName,
        Category: it.category || "",
        Qty: it.quantity,
        "Unit (₱)": Number((it.unitPrice || 0).toFixed(2)),
        "Total (₱)": Number((it.total || 0).toFixed(2)),
        Cashier: g.cashier || ""
      });
    });
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "SalesHistory");
  downloadXLSX(wb, `sales_history_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast("History exported ✅");
}
function exportHistoryToPDF() {
  const groups = groupSalesByReceipt();
  if (!groups.length) { showToast("No history to export ❌"); return; }
  if (!window.jspdf) { showToast("PDF library not loaded ❌"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16); doc.text("Sales History", 14, 18);
  doc.setFontSize(10); doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 24);
  const body = [];
  groups.forEach(g => {
    g.items.forEach((it, idx) => {
      body.push([
        idx === 0 ? g.receiptNum : "",
        idx === 0 ? (g.date?.toLocaleString() || "") : "",
        it.itemName, it.quantity,
        (it.unitPrice || 0).toFixed(2),
        (it.total || 0).toFixed(2)
      ]);
    });
  });
  doc.autoTable({
    startY: 30,
    head: [["Receipt", "Date", "Item", "Qty", "Unit", "Total"]],
    body,
    styles: { fontSize: 8 }, headStyles: { fillColor: [18, 84, 79] }
  });
  downloadPDF(doc, `sales_history_${new Date().toISOString().slice(0,10)}.pdf`);
  showToast("History PDF exported ✅");
}

if (exportInvExcel)     exportInvExcel.addEventListener("click", exportInventoryToExcel);
if (exportInvPdf)       exportInvPdf.addEventListener("click", exportInventoryToPDF);
if (exportSalesExcel)   exportSalesExcel.addEventListener("click", exportSalesToExcel);
if (exportSalesPdf)     exportSalesPdf.addEventListener("click", exportSalesToPDF);
if (exportMovementsBtn) exportMovementsBtn.addEventListener("click", exportMovementsToExcel);
if (exportHistoryExcel) exportHistoryExcel.addEventListener("click", exportHistoryToExcel);
if (exportHistoryPdf)   exportHistoryPdf.addEventListener("click", exportHistoryToPDF);

/* ----------------------------------------------------------
   GROUP SALES BY RECEIPT
   ---------------------------------------------------------- */
function groupSalesByReceipt() {
  const map = new Map();
  sales.forEach(s => {
    const key = s.receiptNum || ("LEGACY-" + s.id);
    if (!map.has(key)) {
      map.set(key, {
        receiptNum: key,
        date: s.createdAt?.toDate?.() || new Date(),
        cashier: (s.userId && s.userId === currentUser?.uid ? currentUser.email : s.userId) || "",
        cash: s.cash || 0,
        change: s.change || 0,
        items: [],
        saleIds: [],
        total: 0
      });
    }
    const g = map.get(key);
    g.items.push(s);
    g.saleIds.push(s.id);
    g.total += (s.total || 0);
  });
  return [...map.values()].sort((a, b) => b.date - a.date);
}

/* ----------------------------------------------------------
   RENDER — Recent Sales
   ---------------------------------------------------------- */
function renderSales() {
  if (!salesList) return;
  if (!sales.length) {
    salesList.innerHTML = `<div class="empty-state"><p>🛒 No sales recorded yet.</p></div>`;
    return;
  }
  salesList.innerHTML = sales.slice(0, 30).map(s => {
    const item = inventory.find(i => i.id === s.itemId) || { name: s.itemName, image: null };
    const date = s.createdAt?.toDate?.().toLocaleString() ?? "Just now";
    return `
      <div class="sale-row">
        <div class="sale-info">
          ${productImageHTML(item, "sm")}
          <div class="sale-txt">
            <div class="sale-name">${esc(s.itemName)} × ${s.quantity}</div>
            <div class="sale-date">${date}${s.receiptNum ? " · " + esc(s.receiptNum) : ""}</div>
          </div>
        </div>
        <div class="sale-total">₱${Number(s.total).toFixed(2)}</div>
        <div class="sale-actions">
          <button type="button" class="sale-action-btn receipt" onclick="viewSaleReceipt('${s.id}')" title="View receipt">🧾</button>
          <button type="button" class="sale-action-btn delete" onclick="deleteSale('${s.id}')" title="Delete sale">🗑️</button>
        </div>
      </div>`;
  }).join("");
}

/* ----------------------------------------------------------
   RENDER — Sales History
   ---------------------------------------------------------- */
function renderHistory() {
  if (!historyList) return;

  let groups = groupSalesByReceipt();

  const range = valOf(historyFilterEl) || "all";
  if (range !== "all") {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    let cutoff = 0;
    if (range === "today") {
      const t = new Date(); t.setHours(0,0,0,0);
      cutoff = t.getTime();
    } else if (range === "7") cutoff = now - 7 * dayMs;
    else if (range === "30") cutoff = now - 30 * dayMs;
    groups = groups.filter(g => g.date.getTime() >= cutoff);
  }

  const catFilter = valOf(historyCatFilterEl);
  if (catFilter) {
    groups = groups
      .map(g => {
        const items = g.items.filter(it => (it.category || "Uncategorized") === catFilter);
        if (!items.length) return null;
        const total = items.reduce((s, it) => s + (it.total || 0), 0);
        return { ...g, items, total, saleIds: items.map(it => it.id) };
      })
      .filter(Boolean);
  }

  const term = valOf(historySearchEl).toLowerCase().trim();
  if (term) {
    groups = groups.filter(g =>
      g.receiptNum.toLowerCase().includes(term) ||
      (g.cashier || "").toLowerCase().includes(term) ||
      g.items.some(it => (it.itemName || "").toLowerCase().includes(term))
    );
  }

  if (!groups.length) {
    historyList.innerHTML = `<div class="empty-state"><p>🧾 No sales history found.</p></div>`;
    return;
  }

  historyList.innerHTML = groups.slice(0, 60).map(g => {
    const itemCount = g.items.length;
    const qtyTotal = g.items.reduce((sum, it) => sum + (it.quantity || 0), 0);
    const dateStr = g.date.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
    const itemsHTML = g.items.map(it => `
      <div class="history-item-line">
        <span class="history-item-name">${esc(it.itemName)}</span>
        <span class="history-item-qty">× ${it.quantity}</span>
        <span class="history-item-price">₱${Number(it.total || 0).toFixed(2)}</span>
      </div>
    `).join("");

    return `
      <div class="history-receipt">
        <div class="history-receipt-head">
          <div class="history-receipt-meta">
            <div class="history-receipt-num">🧾 ${esc(g.receiptNum)}</div>
            <div class="history-receipt-date">${dateStr}</div>
          </div>
          <div class="history-receipt-total">₱${g.total.toFixed(2)}</div>
          <div class="history-receipt-actions">
            <button type="button" class="sale-action-btn receipt"
                    onclick="viewReceiptGroup('${esc(g.receiptNum)}')"
                    title="View receipt">🧾</button>
            <button type="button" class="sale-action-btn delete"
                    onclick="deleteReceiptGroupFromHistory('${esc(g.receiptNum)}')"
                    title="Delete receipt">🗑️</button>
          </div>
        </div>
        <div class="history-receipt-items">${itemsHTML}</div>
        <div class="history-receipt-footer">
          <span>${itemCount} item${itemCount !== 1 ? "s" : ""} · ${qtyTotal} unit${qtyTotal !== 1 ? "s" : ""}</span>
          <span>Cashier: ${esc((g.cashier || "-").slice(0, 20))}</span>
        </div>
      </div>
    `;
  }).join("");
}

/* ----------------------------------------------------------
   HISTORY ACTIONS
   ---------------------------------------------------------- */
window.viewReceiptGroup = (receiptNum) => {
  const groups = groupSalesByReceipt();
  const g = groups.find(x => x.receiptNum === receiptNum);
  if (!g) { showToast("Receipt not found ❌"); return; }

  const items = g.items.map(it => ({
    name: it.itemName, qty: it.quantity, price: it.unitPrice || 0
  }));

  showReceipt({
    items,
    total: g.total,
    cash: g.cash || g.total,
    change: g.change || 0,
    receiptNum: g.receiptNum,
    date: g.date,
    cashier: currentUser?.email || "-"
  }, {
    receiptNum: g.receiptNum,
    saleIds: g.saleIds,
    total: g.total
  });
};

window.deleteReceiptGroupFromHistory = (receiptNum) => {
  const groups = groupSalesByReceipt();
  const g = groups.find(x => x.receiptNum === receiptNum);
  if (!g) { showToast("Receipt not found ❌"); return; }
  deleteReceiptGroup(g.saleIds, g.receiptNum);
};

if (historySearchEl) historySearchEl.addEventListener("input", debounce(renderHistory, 150));
if (historyFilterEl) historyFilterEl.addEventListener("change", () => {
  safeRender(renderHistory);
  safeRender(renderHistoryCategorySummary);
});
if (historyCatFilterEl) historyCatFilterEl.addEventListener("change", () => {
  safeRender(renderHistory);
  safeRender(renderHistoryCategorySummary);
});

/* ----------------------------------------------------------
   RENDER — Sales per Category summary (NEW)
   ---------------------------------------------------------- */
function renderCategorySummaryInto(container, list, emptyText) {
  if (!container) return;
  const map = getSalesByCategory(list);
  const entries = Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  if (!entries.length) {
    container.innerHTML = `<div class="cat-sum-card empty">${esc(emptyText)}</div>`;
    return;
  }
  container.innerHTML = entries.map(([cat, v]) => `
    <div class="cat-sum-card">
      <div class="cat-sum-name" title="${esc(cat)}">${esc(cat)}</div>
      <div class="cat-sum-total">₱${v.total.toFixed(2)}</div>
      <div class="cat-sum-meta">${v.count} sale${v.count !== 1 ? "s" : ""} · ${v.qty} unit${v.qty !== 1 ? "s" : ""}</div>
    </div>
  `).join("");
}

function renderSalesCategorySummary() {
  renderCategorySummaryInto(salesCatSummaryEl, sales, "No sales yet — make a sale to see category totals.");
}

function renderHistoryCategorySummary() {
  // Respect time + category filters so it mirrors the visible history list
  let list = sales;
  const range = valOf(historyFilterEl) || "all";
  if (range !== "all") {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    let cutoff = 0;
    if (range === "today") {
      const t = new Date(); t.setHours(0,0,0,0);
      cutoff = t.getTime();
    } else if (range === "7") cutoff = now - 7 * dayMs;
    else if (range === "30") cutoff = now - 30 * dayMs;
    list = list.filter(s => (s.createdAt?.toMillis?.() ?? 0) >= cutoff);
  }
  const catFilter = valOf(historyCatFilterEl);
  if (catFilter) list = list.filter(s => (s.category || "Uncategorized") === catFilter);
  renderCategorySummaryInto(historyCatSummaryEl, list, "No sales in this range.");
}

/* ----------------------------------------------------------
   DASHBOARD SPOTLIGHT CAROUSEL
   ---------------------------------------------------------- */
function buildSlides() {
  const slides = [];
  const soldMap = getSoldMap();
  if (inventory.length) {
    const newest = [...inventory].sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? 0;
      const tb = b.createdAt?.toMillis?.() ?? 0;
      return tb - ta;
    })[0];
    if (newest) slides.push({
      type: "new", label: "New Arrival", item: newest,
      sold: soldMap[newest.id] || 0,
      revenue: (soldMap[newest.id] || 0) * (newest.price || 0)
    });
  }
  if (inventory.length) {
    const fast = [...inventory].sort((a, b) => (soldMap[b.id] || 0) - (soldMap[a.id] || 0))[0];
    if (fast && (soldMap[fast.id] || 0) > 0) slides.push({
      type: "fast", label: "Fast Moving", item: fast,
      sold: soldMap[fast.id] || 0,
      revenue: (soldMap[fast.id] || 0) * (fast.price || 0)
    });
  }
  if (inventory.length) {
    let topItem = null, topRev = 0;
    inventory.forEach(item => {
      const rev = (soldMap[item.id] || 0) * (item.price || 0);
      if (rev > topRev) { topRev = rev; topItem = item; }
    });
    if (topItem && topRev > 0) slides.push({
      type: "revenue", label: "Top Revenue", item: topItem,
      sold: soldMap[topItem.id] || 0, revenue: topRev
    });
  }
  if (inventory.length) {
    const low = [...inventory]
      .filter(i => i.quantity <= (i.threshold ?? 5))
      .sort((a, b) => (a.quantity / (a.threshold ?? 5)) - (b.quantity / (b.threshold ?? 5)))[0];
    if (low) slides.push({
      type: "low", label: "Low Stock", item: low,
      sold: soldMap[low.id] || 0,
      revenue: (soldMap[low.id] || 0) * (low.price || 0)
    });
  }
  const expiring = inventory.filter(i => {
    const e = expiryStatus(i.expiry);
    return e.level === "expiring" || e.level === "expired";
  })[0];
  if (expiring) slides.push({
    type: "expiry", label: "Expiring Soon", item: expiring,
    sold: soldMap[expiring.id] || 0,
    revenue: (soldMap[expiring.id] || 0) * (expiring.price || 0)
  });
  return slides;
}

function renderCarousel() {
  if (!carouselTrack || !carouselDots) return;
  carouselSlides = buildSlides();
  if (carouselIndex >= carouselSlides.length) carouselIndex = 0;
  if (!carouselSlides.length) {
    carouselTrack.innerHTML = `<div class="carousel-empty">No inventory yet — add items to see spotlight.</div>`;
    carouselDots.innerHTML = "";
    stopCarousel();
    return;
  }
  carouselTrack.innerHTML = carouselSlides.map((slide, idx) => {
    const item = slide.item;
    const isLow = item.quantity <= (item.threshold ?? 5);
    const { percent, level } = stockProgress(item);
    return `
      <div class="carousel-slide" data-index="${idx}">
        <div class="spotlight-card">
          <div class="spotlight-top">
            <span class="spotlight-badge">${slide.label}</span>
            <span class="badge ${isLow ? "low" : "ok"}">${isLow ? "Low Stock" : "In Stock"}</span>
          </div>
          <div class="spotlight-body">
            <div class="spotlight-thumb">${thumbHTML(item)}</div>
            <div>
              <div class="spotlight-name">${esc(item.name)}</div>
              <div class="spotlight-sku">SKU: ${esc(item.sku)}${item.barcode ? " · " + esc(item.barcode) : ""}</div>
              <div class="spotlight-meta">
                <span>📂 ${esc(item.category)}</span>
                <span>💰 ₱${Number(item.price).toFixed(2)}</span>
              </div>
            </div>
          </div>
          <div class="spotlight-stats">
            <div class="spot-stat"><span class="spot-num">${slide.sold}</span><span class="spot-lab">Sold</span></div>
            <div class="spot-stat"><span class="spot-num">₱${slide.revenue.toFixed(2)}</span><span class="spot-lab">Revenue</span></div>
            <div class="spot-stat"><span class="spot-num">${item.quantity}</span><span class="spot-lab">Stock</span></div>
          </div>
          <div class="progress-wrap">
            <div class="progress"><div class="progress-bar ${level}" style="width:${percent}%"></div></div>
            <span class="progress-label">${percent.toFixed(0)}%</span>
          </div>
        </div>
      </div>
    `;
  }).join("");
  carouselDots.innerHTML = carouselSlides.map((_, idx) =>
    `<button class="dot ${idx === carouselIndex ? "active" : ""}" data-index="${idx}"></button>`
  ).join("");
  carouselDots.querySelectorAll(".dot").forEach(dot => {
    dot.addEventListener("click", () => {
      carouselIndex = parseInt(dot.dataset.index);
      updateCarouselPosition();
      restartCarousel();
    });
  });
  updateCarouselPosition();
  restartCarousel();
}
function updateCarouselPosition() {
  if (!carouselSlides.length || !carouselTrack) return;
  carouselTrack.style.transform = `translateX(-${carouselIndex * 100}%)`;
  carouselDots.querySelectorAll(".dot").forEach((dot, idx) => {
    dot.classList.toggle("active", idx === carouselIndex);
  });
}
function nextSlide() { if (!carouselSlides.length) return; carouselIndex = (carouselIndex + 1) % carouselSlides.length; updateCarouselPosition(); }
function prevSlide() { if (!carouselSlides.length) return; carouselIndex = (carouselIndex - 1 + carouselSlides.length) % carouselSlides.length; updateCarouselPosition(); }
function restartCarousel() { stopCarousel(); if (carouselSlides.length > 1) carouselInterval = setInterval(nextSlide, 5000); }
function stopCarousel() { if (carouselInterval) { clearInterval(carouselInterval); carouselInterval = null; } }
if (carouselPrev) carouselPrev.addEventListener("click", () => { prevSlide(); restartCarousel(); });
if (carouselNext) carouselNext.addEventListener("click", () => { nextSlide(); restartCarousel(); });

/* ----------------------------------------------------------
   FAST MOVING
   ---------------------------------------------------------- */
function renderFastMoving() {
  if (!fastMovingList) return;
  const soldMap = getSoldMap();
  const ranked = [...inventory]
    .map(i => ({ ...i, sold: soldMap[i.id] || 0 }))
    .filter(i => i.sold > 0)
    .sort((a, b) => b.sold - a.sold)
    .slice(0, 5);
  if (!ranked.length) {
    fastMovingList.innerHTML = `<div class="empty-state"><p>No sales yet — record a sale to see fast-moving products.</p></div>`;
    return;
  }
  const maxSold = ranked[0].sold;
  fastMovingList.innerHTML = ranked.map((item, idx) => {
    const rankClass = idx === 0 ? "rank-1" : idx === 1 ? "rank-2" : idx === 2 ? "rank-3" : "";
    const percent = (item.sold / maxSold) * 100;
    return `
      <div class="rank-row">
        <div class="rank-badge ${rankClass}">${idx + 1}</div>
        ${productImageHTML(item, "sm")}
        <div class="rank-main">
          <div class="rank-name">${esc(item.name)}</div>
          <div class="rank-sub">SKU: ${esc(item.sku)} · ₱${Number(item.price).toFixed(2)}</div>
          <div class="progress slim"><div class="progress-bar high" style="width:${percent}%"></div></div>
        </div>
        <div class="rank-qty">${item.sold}<span>sold</span></div>
      </div>
    `;
  }).join("");
}

/* ----------------------------------------------------------
   SLOW MOVING
   ---------------------------------------------------------- */
function renderSlowMoving() {
  if (!slowMovingList) return;
  const sold30 = getSoldMapLastDays(30);
  const ranked = [...inventory]
    .map(i => ({ ...i, sold30: sold30[i.id] || 0, lastSold: getLastSoldMs(i.id) }))
    .filter(i => i.quantity > 0)
    .sort((a, b) => { if (a.sold30 !== b.sold30) return a.sold30 - b.sold30; return b.quantity - a.quantity; })
    .slice(0, 5);
  if (!ranked.length) {
    slowMovingList.innerHTML = `<div class="empty-state"><p>No slow-moving items detected.</p></div>`;
    return;
  }
  slowMovingList.innerHTML = ranked.map((item, idx) => {
    const lastSoldTxt = item.lastSold
      ? `${Math.floor((Date.now() - item.lastSold) / (24 * 60 * 60 * 1000))}d ago`
      : "Never sold";
    return `
      <div class="rank-row slow">
        <div class="rank-badge slow">${idx + 1}</div>
        ${productImageHTML(item, "sm")}
        <div class="rank-main">
          <div class="rank-name">${esc(item.name)}</div>
          <div class="rank-sub">SKU: ${esc(item.sku)} · Last sold: ${lastSoldTxt}</div>
        </div>
        <div class="rank-qty">${item.sold30}<span>sold/30d</span></div>
      </div>
    `;
  }).join("");
}

/* ----------------------------------------------------------
   PROGRESS BAR
   ---------------------------------------------------------- */
function stockProgress(item) {
  const t = item.threshold ?? 5;
  const capacity = Math.max(t * 3, 1);
  const percent = Math.min((item.quantity / capacity) * 100, 100);
  let level = "high";
  if (item.quantity === 0 || item.quantity <= t) level = "low";
  else if (item.quantity <= t * 2) level = "medium";
  return { percent, level };
}

/* ----------------------------------------------------------
   RENDER — Inventory grid
   ---------------------------------------------------------- */
function renderInventory() {
  if (!inventoryList) return;
  const s = valOf(searchInput).toLowerCase();
  const f = valOf(filterCat);
  const filtered = inventory.filter(i => {
    const mS = !s || (i.name || "").toLowerCase().includes(s) || (i.sku || "").toLowerCase().includes(s) || (i.barcode || "").toLowerCase().includes(s);
    const mC = !f || i.category === f;
    return mS && mC;
  });
  if (!filtered.length) {
    inventoryList.innerHTML = `<div class="empty-state"><p>📭 No items found.</p></div>`;
    return;
  }
  inventoryList.innerHTML = filtered.map(item => {
    const isLow = item.quantity <= (item.threshold ?? 5);
    const { percent, level } = stockProgress(item);
    const exp = expiryStatus(item.expiry);
    const expBadge = exp.level === "expired" ? `<span class="badge expired">Expired</span>` : exp.level === "expiring" ? `<span class="badge expiring">Expiring</span>` : "";
    const expMeta = (exp.level === "expired" || exp.level === "expiring") ? `<span class="expiry-tag">⏰ ${esc(exp.label)}</span>` : "";
    return `
      <div class="item-card ${isLow ? "low-stock" : ""} ${exp.level === "expired" ? "expiring" : ""}">
        ${productImageHTML(item)}
        <div class="item-body">
          <div class="item-header">
            <div>
              <div class="item-name">${esc(item.name)}</div>
              <div class="item-sku">SKU: ${esc(item.sku)}${item.barcode ? " · " + esc(item.barcode) : ""}</div>
            </div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">
              ${expBadge}
              <span class="badge ${isLow ? "low" : "ok"}">${isLow ? "Low" : "OK"}</span>
            </div>
          </div>
          <div class="item-meta">
            <span>📂 ${esc(item.category)}</span>
            <span>📦 ${item.quantity}</span>
            <span>💰 ₱${Number(item.price).toFixed(2)}</span>
            ${item.cost ? `<span>📉 Cost: ₱${Number(item.cost).toFixed(2)}</span>` : ""}
            ${expMeta}
          </div>
          <div class="progress-wrap">
            <div class="progress"><div class="progress-bar ${level}" style="width:${percent}%"></div></div>
            <span class="progress-label">${percent.toFixed(0)}%</span>
          </div>
          <div class="item-actions">
            <button type="button" class="btn ghost" onclick="editItem('${item.id}')">Edit</button>
            <button type="button" class="btn primary" onclick="restockItem('${item.id}')">➕ Restock</button>
            <button type="button" class="btn danger" onclick="deleteItem('${item.id}')">Delete</button>
          </div>
        </div>
      </div>`;
  }).join("");
}

/* ----------------------------------------------------------
   RENDER — Dashboard live inventory
   ---------------------------------------------------------- */
function renderDashboardInventory() {
  const container = $("dashboard-inventory");
  if (!container) return;
  const term = valOf($("dash-search")).toLowerCase();
  const filtered = inventory.filter(i => {
    if (!term) return true;
    return (i.name || "").toLowerCase().includes(term) || (i.sku || "").toLowerCase().includes(term) || (i.barcode || "").toLowerCase().includes(term);
  });
  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state"><p>📭 No items yet — add one to get started.</p></div>`;
    return;
  }
  container.innerHTML = filtered.map(item => {
    const isLow = item.quantity <= (item.threshold ?? 5);
    const { percent, level } = stockProgress(item);
    return `
      <div class="item-card ${isLow ? "low-stock" : ""}">
        ${productImageHTML(item)}
        <div class="item-body">
          <div class="item-header">
            <div>
              <div class="item-name">${esc(item.name)}</div>
              <div class="item-sku">SKU: ${esc(item.sku)}</div>
            </div>
            <span class="badge ${isLow ? "low" : "ok"}">${isLow ? "Low" : "OK"}</span>
          </div>
          <div class="item-meta">
            <span>📂 ${esc(item.category)}</span>
            <span>📦 ${item.quantity}</span>
            <span>💰 ₱${Number(item.price).toFixed(2)}</span>
          </div>
          <div class="progress-wrap">
            <div class="progress"><div class="progress-bar ${level}" style="width:${percent}%"></div></div>
            <span class="progress-label">${percent.toFixed(0)}%</span>
          </div>
        </div>
      </div>`;
  }).join("");
}

/* ----------------------------------------------------------
   RENDER — Low stock alerts
   ---------------------------------------------------------- */
function renderLowStockAlerts() {
  if (!lowStockList) return;
  const low = inventory.filter(i => i.quantity <= (i.threshold ?? 5));
  if (!low.length) {
    lowStockList.innerHTML = `<div class="empty-state"><p>✅ All items are well stocked.</p></div>`;
    return;
  }
  lowStockList.innerHTML = low.map(item => {
    const { percent, level } = stockProgress(item);
    return `
      <div class="item-card low-stock">
        ${productImageHTML(item)}
        <div class="item-body">
          <div class="item-header">
            <div><div class="item-name">${esc(item.name)}</div><div class="item-sku">SKU: ${esc(item.sku)}</div></div>
            <span class="badge low">Low</span>
          </div>
          <div class="item-meta"><span>📦 ${item.quantity}</span><span>⚠️ Threshold: ${item.threshold ?? 5}</span></div>
          <div class="progress-wrap">
            <div class="progress"><div class="progress-bar ${level}" style="width:${percent}%"></div></div>
            <span class="progress-label">${percent.toFixed(0)}%</span>
          </div>
          <div class="item-actions"><button type="button" class="btn primary" onclick="restockItem('${item.id}')">➕ Restock</button></div>
        </div>
      </div>`;
  }).join("");
}

/* ----------------------------------------------------------
   RENDER — Expiring items
   ---------------------------------------------------------- */
function renderExpiring() {
  const expiring = inventory
    .filter(i => {
      const e = expiryStatus(i.expiry);
      return e.level === "expiring" || e.level === "expired";
    })
    .sort((a, b) => (daysUntilExpiry(a.expiry) ?? 999) - (daysUntilExpiry(b.expiry) ?? 999));

  if (expiryBanner && expiryBannerText) {
    if (expiring.length) {
      const expiredCount = expiring.filter(i => expiryStatus(i.expiry).level === "expired").length;
      expiryBanner.classList.remove("hidden");
      expiryBannerText.textContent = expiredCount
        ? `${expiredCount} item(s) already expired — ${expiring.length} total need attention.`
        : `${expiring.length} item(s) expiring within ${EXPIRY_WARNING_DAYS} days.`;
    } else {
      expiryBanner.classList.add("hidden");
    }
  }
  if (!expiringList) return;
  if (!expiring.length) {
    expiringList.innerHTML = `<div class="empty-state"><p>✅ No items expiring soon.</p></div>`;
    return;
  }
  expiringList.innerHTML = expiring.map(item => {
    const exp = expiryStatus(item.expiry);
    const cls = exp.level === "expired" ? "expired" : "expiring";
    return `
      <div class="item-card ${exp.level === "expired" ? "expiring" : ""}">
        ${productImageHTML(item)}
        <div class="item-body">
          <div class="item-header">
            <div><div class="item-name">${esc(item.name)}</div><div class="item-sku">SKU: ${esc(item.sku)}</div></div>
            <span class="badge ${cls}">${exp.level === "expired" ? "Expired" : "Expiring"}</span>
          </div>
          <div class="item-meta"><span>⏰ ${esc(exp.label)}</span><span>📦 ${item.quantity}</span></div>
          <div class="item-actions"><button type="button" class="btn primary" onclick="restockItem('${item.id}')">➕ Restock</button></div>
        </div>
      </div>`;
  }).join("");
}
if (expiryBannerBtn) expiryBannerBtn.addEventListener("click", () => {
  const el = $("expiring-list");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
});

/* ----------------------------------------------------------
   RENDER — In/Out movements history (with view + delete)
   ---------------------------------------------------------- */
function renderMovements() {
  if (!movementsList) return;
  if (!movements.length) {
    movementsList.innerHTML = `<div class="empty-state"><p>No stock movements yet. Sales and restocks will appear here.</p></div>`;
    return;
  }
  movementsList.innerHTML = movements.slice(0, 30).map(m => {
    const isIn = m.type === "in";
    const date = m.createdAt?.toDate?.().toLocaleString() ?? "Just now";
    const reasonLabel = { initial: "Initial stock", restock: "Restock", sale: "Sale", adjustment: "Adjustment" }[m.reason] || m.reason || "";
    return `
      <div class="movement-row">
        <div class="movement-icon ${isIn ? "in" : "out"}">${isIn ? "⬇️" : "⬆️"}</div>
        <div class="movement-main">
          <div class="movement-name">${esc(m.itemName || "—")}</div>
          <div class="movement-meta">${date} · ${esc(reasonLabel)}${m.note ? " · " + esc(m.note) : ""}</div>
        </div>
        <div class="movement-qty ${isIn ? "in" : "out"}">${isIn ? "+" : "−"}${m.quantity}</div>
        <div class="movement-actions">
          <button type="button" class="sale-action-btn receipt" onclick="viewMovement('${m.id}')" title="View details">👁️</button>
          <button type="button" class="sale-action-btn delete" onclick="deleteMovement('${m.id}')" title="Delete record">🗑️</button>
        </div>
      </div>
    `;
  }).join("");
}

/* ----------------------------------------------------------
   MOVEMENT view / delete  (NEW)
   ---------------------------------------------------------- */
window.viewMovement = (id) => {
  const m = movements.find(x => x.id === id);
  if (!m) { showToast("Movement not found ❌"); return; }
  currentMovementId = id;

  const isIn = m.type === "in";
  const date = m.createdAt?.toDate?.().toLocaleString() ?? "Just now";
  const reasonLabel = { initial: "Initial stock", restock: "Restock", sale: "Sale", adjustment: "Adjustment" }[m.reason] || m.reason || "—";

  if (movementDetailEl) {
    movementDetailEl.innerHTML = `
      <div class="mv-detail-row">
        <span class="mv-detail-label">Item</span>
        <span class="mv-detail-value">${esc(m.itemName || "—")}</span>
      </div>
      <div class="mv-detail-row">
        <span class="mv-detail-label">Type</span>
        <span class="mv-detail-value ${isIn ? "in" : "out"}">${isIn ? "IN (+)" : "OUT (−)"}</span>
      </div>
      <div class="mv-detail-row">
        <span class="mv-detail-label">Quantity</span>
        <span class="mv-detail-value ${isIn ? "in" : "out"}">${isIn ? "+" : "−"}${m.quantity}</span>
      </div>
      <div class="mv-detail-row">
        <span class="mv-detail-label">Reason</span>
        <span class="mv-detail-value">${esc(reasonLabel)}</span>
      </div>
      <div class="mv-detail-row">
        <span class="mv-detail-label">Note</span>
        <span class="mv-detail-value">${esc(m.note || "—")}</span>
      </div>
      <div class="mv-detail-row">
        <span class="mv-detail-label">Date</span>
        <span class="mv-detail-value">${esc(date)}</span>
      </div>
      <div class="mv-detail-row">
        <span class="mv-detail-label">Record ID</span>
        <span class="mv-detail-value"><code>${esc(m.id.slice(0, 12))}…</code></span>
      </div>
    `;
  }
  movementModal && movementModal.classList.remove("hidden");
};

function closeMovementModal() {
  movementModal && movementModal.classList.add("hidden");
  currentMovementId = null;
}

if (movementClose)    movementClose.addEventListener("click", closeMovementModal);
if (movementCloseBtn) movementCloseBtn.addEventListener("click", closeMovementModal);
if (movementModal) movementModal.addEventListener("click", (e) => {
  if (e.target === movementModal) closeMovementModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && movementModal && !movementModal.classList.contains("hidden")) {
    closeMovementModal();
  }
});

if (movementDeleteBtn) movementDeleteBtn.addEventListener("click", async () => {
  if (!currentMovementId) return;
  const m = movements.find(x => x.id === currentMovementId);
  if (!m) { closeMovementModal(); return; }
  const isIn = m.type === "in";
  const msg =
    `Delete this movement record?\n\n` +
    `${m.itemName}  ·  ${isIn ? "+" : "−"}${m.quantity}  ·  ${m.reason || ""}\n\n` +
    `⚠️ Note: the stock quantity will NOT be reverted. This only removes the log entry.`;
  if (!confirm(msg)) return;
  try {
    await deleteDoc(doc(db, "movements", m.id));
    playSuccessSound();
    showToast("Movement deleted 🗑️");
    closeMovementModal();
  } catch (err) {
    console.error("[delete movement] FAILED:", err.code, err.message);
    showToast(`Failed: ${err.code || err.message} ❌`);
  }
});

window.deleteMovement = async (id) => {
  const m = movements.find(x => x.id === id);
  if (!m) { showToast("Movement not found ❌"); return; }
  const isIn = m.type === "in";
  const msg =
    `Delete this movement record?\n\n` +
    `${m.itemName}  ·  ${isIn ? "+" : "−"}${m.quantity}  ·  ${m.reason || ""}\n\n` +
    `⚠️ Note: the stock quantity will NOT be reverted. This only removes the log entry.`;
  if (!confirm(msg)) return;
  try {
    await deleteDoc(doc(db, "movements", id));
    playSuccessSound();
    showToast("Movement deleted 🗑️");
  } catch (err) {
    console.error("[delete movement] FAILED:", err.code, err.message);
    showToast(`Failed: ${err.code || err.message} ❌`);
  }
};

/* ----------------------------------------------------------
   RENDER — Categories
   ---------------------------------------------------------- */
function renderCategories() {
  if (!categoryGrid) return;
  if (!categories.length) {
    categoryGrid.innerHTML = `<div class="empty-state"><p>🗂️ No categories yet.</p></div>`;
    return;
  }
  categoryGrid.innerHTML = categories.map(cat => {
    const count = inventory.filter(i => i.category === cat.name).length;
    return `<div class="category-card">
      <div><div class="cat-name">${esc(cat.name)}</div><div class="cat-count">${count} item${count !== 1 ? "s" : ""}</div></div>
      <button type="button" class="btn danger" onclick="deleteCategory('${cat.id}')">✕</button>
    </div>`;
  }).join("");
}

/* ----------------------------------------------------------
   STATS
   ---------------------------------------------------------- */
function updateStats() {
  const total = inventory.length;
  const low = inventory.filter(i => i.quantity <= (i.threshold ?? 5)).length;
  const value = inventory.reduce((s, i) => s + (i.quantity * i.price || 0), 0);
  const today = new Date(); today.setHours(0,0,0,0);
  const todaySales = sales
    .filter(s => s.createdAt?.toDate?.() >= today)
    .reduce((s, x) => s + (x.total || 0), 0);
  const totalProfit = sales.reduce((sum, s) => {
    if (typeof s.profit === "number") return sum + s.profit;
    const it = inventory.find(i => i.id === s.itemId);
    const cost = (it && typeof it.cost === "number") ? it.cost : (s.cost || 0);
    return sum + ((s.unitPrice || 0) - cost) * (s.quantity || 0);
  }, 0);

  if (statTotal) statTotal.textContent = total;
  if (statLow) statLow.textContent = low;
  if (statValue) statValue.textContent = "₱" + value.toFixed(2);
  if (statSales) statSales.textContent = "₱" + todaySales.toFixed(2);
  if (statProfit) statProfit.textContent = "₱" + totalProfit.toFixed(2);
  if (statCats) statCats.textContent = categories.length;
}

/* ----------------------------------------------------------
   CHARTS
   ---------------------------------------------------------- */
const CATEGORY_PALETTE = ["#12544F", "#2FA38F", "#5FC2A6", "#0C3E3A", "#16665F", "#0F4945", "#E8B33A", "#D79A6A"];
const getCSSVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function commonChartOptions(textColor) {
  return {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 400 },
    plugins: { legend: { position: "bottom", labels: { color: textColor, padding: 12, font: { size: 12 }, boxWidth: 14, usePointStyle: true } } }
  };
}

function renderCharts(retries = 0) {
  if (!chartJsReady || typeof Chart === "undefined") {
    if (retries < 40) setTimeout(() => renderCharts(retries + 1), 200);
    return;
  }
  const dashEl = $("page-dashboard");
  if (!dashEl || dashEl.classList.contains("hidden")) return;
  const stockCanvas = $("stock-status-chart");
  const catCanvas   = $("category-value-chart");
  const salesCanvas = $("sales-category-chart");
  if (!stockCanvas || !catCanvas || !salesCanvas) return;
  const ready = stockCanvas.clientWidth > 0 && stockCanvas.clientHeight > 0;
  if (!ready) {
    if (retries < 40) setTimeout(() => renderCharts(retries + 1), 200);
    return;
  }
  const textColor = getCSSVar("--text") || "#1e293b";

  try {
    const inStock  = inventory.filter(i => i.quantity >  (i.threshold ?? 5)).length;
    const lowStock = inventory.filter(i => i.quantity > 0 && i.quantity <= (i.threshold ?? 5)).length;
    const outStock = inventory.filter(i => i.quantity === 0).length;
    const stockData = {
      labels: ["In Stock", "Low Stock", "Out of Stock"],
      datasets: [{ data: [inStock, lowStock, outStock], backgroundColor: ["#22c55e", "#f59e0b", "#ef4444"], borderWidth: 0, hoverOffset: 6 }]
    };
    if (stockChart && stockChart.canvas && stockChart.canvas.isConnected) {
      stockChart.data = stockData;
      stockChart.options.plugins.legend.labels.color = textColor;
      stockChart.update("none");
    } else {
      if (stockChart) { try { stockChart.destroy(); } catch (e) {} }
      stockChart = new Chart(stockCanvas, {
        type: "doughnut", data: stockData,
        options: {
          ...commonChartOptions(textColor), cutout: "62%",
          plugins: { ...commonChartOptions(textColor).plugins,
            tooltip: { callbacks: { label: (c) => {
              const t = c.dataset.data.reduce((a, b) => a + b, 0) || 1;
              return `${c.label}: ${c.parsed} (${((c.parsed / t) * 100).toFixed(1)}%)`;
            }}}
          }
        }
      });
    }
  } catch (e) { console.error("[chart] stock:", e); }

  try {
    const vbc = {};
    inventory.forEach(i => { vbc[i.category] = (vbc[i.category] || 0) + (i.quantity * i.price || 0); });
    const catLabels = Object.keys(vbc), catValues = Object.values(vbc);
    const catData = {
      labels: catLabels.length ? catLabels : ["No data"],
      datasets: [{
        data: catValues.length ? catValues : [1],
        backgroundColor: catLabels.length ? catLabels.map((_, i) => CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]) : ["#e2e8f0"],
        borderWidth: 0, hoverOffset: 6
      }]
    };
    if (categoryValueChart && categoryValueChart.canvas && categoryValueChart.canvas.isConnected) {
      categoryValueChart.data = catData;
      categoryValueChart.options.plugins.legend.labels.color = textColor;
      categoryValueChart.update("none");
    } else {
      if (categoryValueChart) { try { categoryValueChart.destroy(); } catch (e) {} }
      categoryValueChart = new Chart(catCanvas, {
        type: "pie", data: catData,
        options: { ...commonChartOptions(textColor),
          plugins: { ...commonChartOptions(textColor).plugins,
            tooltip: { callbacks: { label: (c) => `${c.label}: ₱${Number(c.parsed).toFixed(2)}` } }
          }
        }
      });
    }
  } catch (e) { console.error("[chart] category value:", e); }

  try {
    const sbc = {};
    sales.forEach(s => { const k = s.category || "Unknown"; sbc[k] = (sbc[k] || 0) + (s.total || 0); });
    const sLabels = Object.keys(sbc), sValues = Object.values(sbc);
    const salesData = {
      labels: sLabels.length ? sLabels : ["No sales yet"],
      datasets: [{
        data: sValues.length ? sValues : [1],
        backgroundColor: sLabels.length ? sLabels.map((_, i) => CATEGORY_PALETTE[(i + 3) % CATEGORY_PALETTE.length]) : ["#e2e8f0"],
        borderWidth: 0, hoverOffset: 6
      }]
    };
    if (salesCategoryChart && salesCategoryChart.canvas && salesCategoryChart.canvas.isConnected) {
      salesCategoryChart.data = salesData;
      salesCategoryChart.options.plugins.legend.labels.color = textColor;
      salesCategoryChart.update("none");
    } else {
      if (salesCategoryChart) { try { salesCategoryChart.destroy(); } catch (e) {} }
      salesCategoryChart = new Chart(salesCanvas, {
        type: "pie", data: salesData,
        options: { ...commonChartOptions(textColor),
          plugins: { ...commonChartOptions(textColor).plugins,
            tooltip: { callbacks: { label: (c) => `${c.label}: ₱${Number(c.parsed).toFixed(2)}` } }
          }
        }
      });
    }
  } catch (e) { console.error("[chart] sales category:", e); }

  requestAnimationFrame(() => {
    [stockChart, categoryValueChart, salesCategoryChart].forEach(c => { try { c && c.resize(); } catch (e) {} });
  });
}

function destroyCharts() {
  [stockChart, categoryValueChart, salesCategoryChart].forEach(c => { try { c && c.destroy(); } catch (e) {} });
  stockChart = categoryValueChart = salesCategoryChart = null;
}

/* ----------------------------------------------------------
   SELECTS / DATALISTS
   ---------------------------------------------------------- */
function populateCategoryFilter() {
  if (!filterCat) return;
  const names = [...new Set(inventory.map(i => i.category).filter(Boolean))].sort();
  const cur = filterCat.value;
  filterCat.innerHTML = `<option value="">All Categories</option>` + names.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  filterCat.value = cur;
}
function populateCategoryDatalist() {
  if (!categoryList) return;
  const names = [...new Set([...categories.map(c => c.name), ...inventory.map(i => i.category)].filter(Boolean))].sort();
  categoryList.innerHTML = names.map(c => `<option value="${esc(c)}">`).join("");
}

/* NEW: category filter dropdowns sourced from inventory + sales */
function buildCategoryOptions() {
  const set = new Set();
  inventory.forEach(i => { if (i.category) set.add(i.category); });
  sales.forEach(s => { if (s.category) set.add(s.category); });
  categories.forEach(c => { if (c.name) set.add(c.name); });
  return [...set].sort((a, b) => a.localeCompare(b));
}
function populateSalesCatFilter() {
  if (!salesCatFilterEl) return;
  const cur = salesCatFilterEl.value;
  const names = buildCategoryOptions();
  salesCatFilterEl.innerHTML = `<option value="">All Categories</option>` +
    names.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  salesCatFilterEl.value = names.includes(cur) ? cur : "";
}
function populateHistoryCatFilter() {
  if (!historyCatFilterEl) return;
  const cur = historyCatFilterEl.value;
  const names = buildCategoryOptions();
  historyCatFilterEl.innerHTML = `<option value="">All Categories</option>` +
    names.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  historyCatFilterEl.value = names.includes(cur) ? cur : "";
}

if (searchInput) searchInput.addEventListener("input", debounce(renderInventory, 150));
if (filterCat)   filterCat.addEventListener("change", renderInventory);
const dashSearchEl = $("dash-search");
if (dashSearchEl) dashSearchEl.addEventListener("input", debounce(renderDashboardInventory, 150));

/* ----------------------------------------------------------
   CRUD — Inventory items
   ---------------------------------------------------------- */
if (itemForm) itemForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const wsId = myWorkspace();
  if (!wsId) { showToast("Workspace not ready ❌"); return; }
  const wasEditing = !!(itemId && itemId.value);
  const prev = wasEditing ? inventory.find(i => i.id === itemId.value) : null;

  const data = {
    name: valOf(itemName).trim(),
    sku: valOf(itemSku).trim(),
    barcode: itemBarcode ? valOf(itemBarcode).trim() : "",
    category: valOf(itemCategory).trim(),
    quantity: numOf(itemQty),
    cost: itemCost ? (Number(valOf(itemCost)) || 0) : 0,
    price: numOf(itemPrice),
    expiry: itemExpiry ? valOf(itemExpiry) : "",
    threshold: itemThreshold ? (Number(valOf(itemThreshold)) || 5) : 5,
    image: itemImageData ? (valOf(itemImageData) || null) : null,
    workspaceId: wsId,
    updatedAt: serverTimestamp()
  };

  if (!data.name)     { showToast("Name is required ❌"); return; }
  if (!data.sku)      { showToast("SKU is required ❌"); return; }
  if (!data.category) { showToast("Category is required ❌"); return; }
  if (!data.price || data.price <= 0) { showToast("Price must be greater than 0 ❌"); return; }

  try {
    const batch = writeBatch(db);
    if (wasEditing) {
      batch.update(doc(db, "inventory", itemId.value), data);
      if (prev && data.quantity !== prev.quantity) {
        const diff = data.quantity - prev.quantity;
        batch.set(doc(collection(db, "movements")), movementDoc({
          itemId: itemId.value, itemName: data.name,
          type: diff > 0 ? "in" : "out",
          quantity: Math.abs(diff),
          reason: "adjustment", note: "Manual edit"
        }));
      }
      await settleWrite(batch.commit(), "Item");
      showToast("Item updated ✅");
    } else {
      const newRef = doc(collection(db, "inventory"));
      batch.set(newRef, { ...data, createdAt: serverTimestamp() });
      if (data.quantity > 0) {
        batch.set(doc(collection(db, "movements")), movementDoc({
          itemId: newRef.id, itemName: data.name,
          type: "in", quantity: data.quantity,
          reason: "initial", note: "Item created"
        }));
      }
      await settleWrite(batch.commit(), "Item");
      showToast("Item added ✅");
    }
    itemForm.reset();
    if (itemId) itemId.value = "";
    if (itemThreshold) itemThreshold.value = "5";
    if (itemImageData) itemImageData.value = "";
    if (itemImage) itemImage.value = "";
    if (itemImageCamera) itemImageCamera.value = "";
    showPhotoPreview(null);
    manualSku = false; skuInitialized = false;
    autoFillSku();
  } catch (err) {
    console.error("[add/update item] FAILED:", err.code, err.message, err);
    showToast(`Failed: ${err.code || err.message} ❌`);
  }
});

window.editItem = (id) => {
  const item = inventory.find(i => i.id === id);
  if (!item) return;
  if (itemId) itemId.value = item.id;
  setVal(itemName, item.name);
  setVal(itemSku, item.sku);
  if (itemBarcode) itemBarcode.value = item.barcode || "";
  setVal(itemCategory, item.category);
  setVal(itemQty, item.quantity);
  if (itemCost) itemCost.value = item.cost ?? "";
  setVal(itemPrice, item.price);
  if (itemExpiry) itemExpiry.value = item.expiry || "";
  if (itemThreshold) itemThreshold.value = item.threshold ?? 5;
  if (itemImageData) itemImageData.value = item.image || "";
  showPhotoPreview(item.image || null);
  manualSku = true; skuInitialized = true;
  const addBtn = document.querySelector('[data-page="page-add"]');
  if (addBtn) addBtn.click();
  window.scrollTo({ top: 0, behavior: "smooth" });
};

window.deleteItem = async (id) => {
  if (!confirm("Delete this item permanently?")) return;
  try {
    await deleteDoc(doc(db, "inventory", id));
    showToast("Item deleted 🗑️");
  } catch (err) {
    console.error("[delete item] FAILED:", err.code, err.message, err);
    showToast(`Failed: ${err.code || err.message} ❌`);
  }
};

/* ----------------------------------------------------------
   CATEGORIES CRUD
   ---------------------------------------------------------- */
if (categoryForm) categoryForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const wsId = myWorkspace();
  if (!wsId) { showToast("Workspace not ready ❌"); return; }
  const name = valOf(newCategory).trim();
  if (!name) return;
  if (categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    showToast("Category already exists ❌"); return;
  }
  try {
    await addDoc(collection(db, "categories"), { name, workspaceId: wsId, createdAt: serverTimestamp() });
    if (newCategory) newCategory.value = "";
    showToast("Category added ✅");
  } catch (err) {
    console.error("[add category]", err.code, err.message);
    showToast(`Failed: ${err.code || err.message} ❌`);
  }
});

window.deleteCategory = async (id) => {
  if (!confirm("Delete this category?")) return;
  try {
    await deleteDoc(doc(db, "categories", id));
    showToast("Category deleted 🗑️");
  } catch (err) {
    console.error("[delete category]", err.code, err.message);
    showToast(`Failed: ${err.code || err.message} ❌`);
  }
};

/* ----------------------------------------------------------
   ADMIN
   ---------------------------------------------------------- */
function renderAdminUsers() {
  if (!pendingUsersList || !allUsersList) return;
  const pending = allUsers.filter(u => !u.approved);
  pendingUsersList.innerHTML = pending.length ? pending.map(userRowHTML).join("") : `<div class="empty-state"><p>✅ No pending approvals.</p></div>`;
  allUsersList.innerHTML = allUsers.length ? allUsers.map(userRowHTML).join("") : `<div class="empty-state"><p>No users yet.</p></div>`;
}
function userRowHTML(u) {
  const isSuper = u.role === "superadmin";
  return `
    <div class="user-row ${u.approved ? "approved" : "pending"}">
      <div class="user-info">
        <div class="user-mail">
          ${esc(u.email)}
          ${isSuper ? `<span class="role-badge super">SUPER ADMIN</span>` : ""}
        </div>
        <div class="user-meta">
          Workspace: <code>${esc((u.workspaceId || "").slice(0, 8))}…</code>
          · ${u.approved ? "Approved" : "Pending"}
        </div>
      </div>
      <div class="user-actions">
        ${u.approved
          ? `<button type="button" class="btn ghost" onclick="toggleApproval('${u.id}', false)">Revoke</button>`
          : `<button type="button" class="btn primary" onclick="toggleApproval('${u.id}', true)">Approve</button>`}
        ${isSuper ? "" : `<button type="button" class="btn danger" onclick="deleteUser('${u.id}')">Delete</button>`}
      </div>
    </div>`;
}
window.toggleApproval = async (userId, approved) => {
  if (!currentUserData || currentUserData.role !== "superadmin") return;
  try {
    await updateDoc(doc(db, "users", userId), { approved });
    showToast(approved ? "User approved ✅" : "Approval revoked");
  } catch (err) {
    console.error("[Admin] toggle failed:", err);
    showToast(`Failed: ${err.code || err.message} ❌`);
  }
};
window.deleteUser = async (userId) => {
  if (!currentUserData || currentUserData.role !== "superadmin") return;
  if (!confirm("Delete this user profile? (Their workspace data will remain)")) return;
  try {
    await deleteDoc(doc(db, "users", userId));
    showToast("User deleted 🗑️");
  } catch (err) {
    console.error("[Admin] delete failed:", err);
    showToast(`Failed: ${err.code || err.message} ❌`);
  }
};

/* ----------------------------------------------------------
   PWA — Service Worker & Install Prompt
   ---------------------------------------------------------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js", { scope: "./" })
      .then((reg) => {
        console.log("[SW] registered:", reg.scope);
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller) {
              showToast("New version ready — refresh to update 🔄");
            }
          });
        });
      })
      .catch((err) => console.warn("[SW] registration failed:", err));
  });
}

/* ---------- ONLINE / OFFLINE ---------- */
const offlineBanner = $("offline-banner");
function updateOnlineStatus() {
  const online = navigator.onLine;
  if (offlineBanner) offlineBanner.classList.toggle("hidden", online);
  document.documentElement.classList.toggle("is-offline", !online);
}
window.addEventListener("online", () => {
  updateOnlineStatus();
  showToast("Back online ✅ — syncing…");
});
window.addEventListener("offline", () => {
  updateOnlineStatus();
  showToast("Offline mode 📡 — changes will sync later");
});
updateOnlineStatus();

/* ---------- Keyboard shortcuts ---------- */
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select")) return;
  if (e.key === "/") {
    e.preventDefault();
    const s = $("search-input") || $("dash-search") || $("sales-search");
    s && s.focus();
  }
});

/* ----------------------------------------------------------
   UTILITIES
   ---------------------------------------------------------- */
function showToast(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.add("hidden"), 3000);
}
function esc(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ==========================================================
   PWA INSTALL — works on mobile, handles in-app browsers
   ========================================================== */
const installBtn         = $("install-btn");
const installModal       = $("install-modal");
const installClose       = $("install-close");
const installLater       = $("install-later");
const installTitle       = $("install-title");
const installSubtitle    = $("install-subtitle");
const installInstr       = $("install-instructions");
const installNativeWrap  = $("install-native-wrap");
const installNativeBtn   = $("install-native-btn");
const installBanner      = $("install-banner");
const installBannerBtn   = $("install-banner-btn");
const installBannerClose = $("install-banner-close");

let deferredPrompt = null;

const UA          = navigator.userAgent || "";
const IS_IOS      = /iPhone|iPad|iPod/i.test(UA) ||
                    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const IS_ANDROID  = /Android/i.test(UA);
const IS_MOBILE   = IS_IOS || IS_ANDROID || /Mobile/i.test(UA);

const IS_IN_APP_BROWSER =
  /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|TikTok|BytedanceWebview|Line\/|WhatsApp|Snapchat|Twitter/i.test(UA) ||
  (IS_ANDROID && /; wv\)/i.test(UA) && !/Chrome\/[0-9]+/i.test(UA)) ||
  (IS_IOS && !/Safari/i.test(UA) && !/CriOS|FxiOS|EdgiOS/i.test(UA));

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
         window.matchMedia("(display-mode: fullscreen)").matches ||
         navigator.standalone === true;
}
function isDismissed()   { return localStorage.getItem("installDismissed") === "1"; }
function markDismissed() { localStorage.setItem("installDismissed", "1"); }

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (!isStandalone() && !isDismissed() && IS_MOBILE && !IS_IN_APP_BROWSER) {
    setTimeout(() => installBanner?.classList.remove("hidden"), 2500);
  }
});

window.addEventListener("appinstalled", () => {
  showToast("Kurt POS installed 🎉");
  deferredPrompt = null;
  installModal?.classList.add("hidden");
  installBanner?.classList.add("hidden");
  markDismissed();
});

function buildInstructions() {
  if (IS_IN_APP_BROWSER) {
    return {
      icon: "🌐",
      title: "Open in your browser first",
      subtitle: "You are viewing this page inside an app. To install Kurt POS, open it in Chrome or Safari.",
      html: IS_IOS
        ? `<ol>
             <li>Tap the <span class="step-icon">⋯</span> or <span class="step-icon">⤴</span> button at the top-right.</li>
             <li>Choose <span class="step-icon">Open in Safari</span>.</li>
             <li>Then in Safari, tap the <span class="step-icon">⬆️ Share</span> button.</li>
             <li>Tap <span class="step-icon">➕ Add to Home Screen</span>.</li>
           </ol>`
        : `<ol>
             <li>Tap the <span class="step-icon">⋮</span> menu at the top-right.</li>
             <li>Choose <span class="step-icon">Open in Chrome</span>.</li>
             <li>Then in Chrome, tap the <span class="step-icon">⋮</span> menu again.</li>
             <li>Tap <span class="step-icon">Install app</span> or <span class="step-icon">Add to Home screen</span>.</li>
           </ol>`,
    };
  }

  if (IS_IOS) {
    return {
      icon: "🍎",
      title: "Install on iPhone / iPad",
      subtitle: "Add Kurt POS to your home screen for one-tap access.",
      html: `<ol>
               <li>Tap the <span class="step-icon">⬆️ Share</span> button at the bottom of Safari.</li>
               <li>Scroll down and tap <span class="step-icon">➕ Add to Home Screen</span>.</li>
               <li>Tap <span class="step-icon">Add</span> in the top-right corner.</li>
             </ol>`,
    };
  }

  if (IS_ANDROID) {
    return {
      icon: "🤖",
      title: "Install on Android",
      subtitle: deferredPrompt
        ? "Tap Install Now to add Kurt POS to your home screen."
        : "Add Kurt POS to your home screen for fast offline access.",
      html: deferredPrompt
        ? `<p>Tap <b>Install Now</b> below to add Kurt POS.</p>`
        : `<ol>
             <li>Tap the <span class="step-icon">⋮</span> menu in Chrome (top-right).</li>
             <li>Tap <span class="step-icon">Install app</span> or <span class="step-icon">Add to Home screen</span>.</li>
             <li>Tap <span class="step-icon">Install</span> to confirm.</li>
           </ol>`,
    };
  }

  return {
    icon: "💻",
    title: "Install Kurt POS",
    subtitle: "Open the app in its own window for a native-like experience.",
    html: deferredPrompt
      ? `<p>Tap <b>Install Now</b> below, or use the ⊕ icon in your address bar.</p>`
      : `<ol>
           <li><b>Chrome / Edge:</b> click the <span class="step-icon">⊕</span> icon in the address bar.</li>
           <li><b>Safari (macOS 14+):</b> File menu → <span class="step-icon">Add to Dock</span>.</li>
           <li><b>Firefox:</b> PWA install not supported — use Chrome or Edge.</li>
         </ol>`,
  };
}

function openInstallModal() {
  if (isStandalone()) { showToast("App is already installed ✅"); return; }
  const info = buildInstructions();
  if (installTitle)    installTitle.textContent    = info.title;
  if (installSubtitle) installSubtitle.textContent = info.subtitle;
  if (installInstr)    installInstr.innerHTML      = info.html;
  if (installNativeWrap) {
    installNativeWrap.classList.toggle("hidden", !deferredPrompt || IS_IN_APP_BROWSER);
  }
  installModal?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
function closeInstallModal() {
  installModal?.classList.add("hidden");
  document.body.style.overflow = "";
}

async function triggerInstall() {
  if (deferredPrompt) {
    try {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") { showToast("Installing… 🎉"); markDismissed(); }
      deferredPrompt = null;
    } catch (e) { console.warn("[PWA] install prompt error:", e); }
    closeInstallModal();
    installBanner?.classList.add("hidden");
  } else {
    openInstallModal();
  }
}

if (installBtn) installBtn.addEventListener("click", () => {
  if (isStandalone()) { showToast("App is already installed ✅"); return; }
  if (deferredPrompt && !IS_IN_APP_BROWSER) triggerInstall();
  else openInstallModal();
});
if (installNativeBtn) installNativeBtn.addEventListener("click", triggerInstall);
if (installClose)     installClose.addEventListener("click", closeInstallModal);
if (installLater)     installLater.addEventListener("click", () => {
  closeInstallModal(); markDismissed(); installBanner?.classList.add("hidden");
});
if (installModal) installModal.addEventListener("click", (e) => {
  if (e.target === installModal) closeInstallModal();
});
if (installBannerBtn) installBannerBtn.addEventListener("click", () => {
  if (deferredPrompt && !IS_IN_APP_BROWSER) triggerInstall();
  else { installBanner?.classList.add("hidden"); openInstallModal(); }
});
if (installBannerClose) installBannerClose.addEventListener("click", () => {
  installBanner?.classList.add("hidden"); markDismissed();
});

if (IS_MOBILE && !isStandalone() && !isDismissed() && !IS_IN_APP_BROWSER) {
  const iv = setInterval(() => {
    if (appShell && !appShell.classList.contains("hidden")) {
      installBanner?.classList.remove("hidden");
      clearInterval(iv);
    }
  }, 2000);
  setTimeout(() => clearInterval(iv), 60000);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && installModal && !installModal.classList.contains("hidden")) {
    closeInstallModal();
  }
});