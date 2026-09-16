/* ==========================================================
   app.js — Kurt Inventory
   Multi-tenant + Super Admin Approval
   + Auth bg carousel + Sales per-card mini carousel + photos
   + Peso currency (₱)
   ========================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, onSnapshot, addDoc, updateDoc,
  deleteDoc, doc, getDoc, setDoc, serverTimestamp,
  query, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ----------------------------------------------------------
   ⚠️ CONFIG
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

/* ==========================================================
   🎨 AUTH BACKGROUND CAROUSEL
   🔁 CHANGE THESE IMAGE URLS ANYTIME
   (local files like "bg1.jpg" or full URLs both work.
    Make sure the file is in the same folder as index.html!)
   ========================================================== */
const AUTH_BG_IMAGES = [
  "gta5version.png",
  "https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?auto=format&fit=crop&w=1920&q=80",
  "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=1920&q=80",
  "https://images.unsplash.com/photo-1601598851547-4302969d0614?auto=format&fit=crop&w=1920&q=80"
];
const AUTH_BG_INTERVAL_MS = 6000; // how long each image stays before fading

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ----------------------------------------------------------
   DOM shorthand
   ---------------------------------------------------------- */
const $ = (id) => document.getElementById(id);

const authScreen = $("auth-screen");
const pendingScreen = $("pending-screen");
const appShell = $("app-shell");

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
  statCats = $("stat-cats"), lowStockList = $("low-stock-list");

const carouselTrack = $("carousel-track");
const carouselDots = $("carousel-dots");
const carouselPrev = $("carousel-prev");
const carouselNext = $("carousel-next");

const fastMovingList = $("fast-moving-list");

const saleForm = $("sale-form"), saleItem = $("sale-item"),
  saleQty = $("sale-qty"), salesList = $("sales-list");
const scanSaleBtn = $("scan-sale-btn");
const salesProductsGrid = $("sales-products-grid");
const salesSearchEl = $("sales-search");

const itemForm = $("item-form"), itemId = $("item-id"),
  itemName = $("item-name"), itemSku = $("item-sku"),
  itemCategory = $("item-category"), itemQty = $("item-qty"),
  itemPrice = $("item-price"), itemThreshold = $("item-threshold"),
  categoryList = $("category-list"), searchInput = $("search-input"),
  filterCat = $("filter-category"), inventoryList = $("inventory-list");
const scanSkuBtn = $("scan-sku-btn");

const itemImageData = $("item-image-data");
const itemImage = $("item-image");
const photoPreview = $("photo-preview");
const photoPickBtn = $("photo-pick-btn");
const photoRemoveBtn = $("photo-remove-btn");

const categoryForm = $("category-form"), newCategory = $("new-category"),
  categoryGrid = $("category-grid");

const navAdmin = $("nav-admin"),
  pendingUsersList = $("pending-users-list"),
  allUsersList = $("all-users-list");

const navButtons = document.querySelectorAll(".nav-btn");
const pages = document.querySelectorAll(".page");
const toast = $("toast");

const scannerModal = $("scanner-modal");
const scannerTitle = $("scanner-title");
const scannerReader = $("scanner-reader");
const scannerStatus = $("scanner-status");
const scannerClose = $("scanner-close");
const scannerManualInput = $("scanner-manual-input");
const scannerManualBtn = $("scanner-manual-btn");

/* ----------------------------------------------------------
   STATE
   ---------------------------------------------------------- */
let inventory = [], sales = [], categories = [], allUsers = [];
let currentUser = null, currentUserData = null, isSignupMode = false;
const unsubscribers = {};
let unsubscribeUserDoc = null;

let stockChart = null, categoryValueChart = null, salesCategoryChart = null;

let carouselSlides = [];
let carouselIndex = 0;
let carouselInterval = null;

let miniCarouselIndex = 0;
let miniCarouselTimer = null;

let authBgTimer = null;
let authBgIndex = 0;

let html5QrCode = null;
let scannerTarget = null;
let scannerActive = false;

let soundEnabled = localStorage.getItem("soundEnabled") !== "false";
let manualSku = false;

/* ==========================================================
   AUTH BACKGROUND CAROUSEL
   ========================================================== */
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

function stopAuthBgCarousel() {
  if (authBgTimer) { clearInterval(authBgTimer); authBgTimer = null; }
}

/* Build both auth backgrounds once at startup */
buildAuthBackground("auth-bg-slides");
buildAuthBackground("pending-bg-slides");

/* ==========================================================
   THEME
   ========================================================== */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  themeIcon.textContent = theme === "dark" ? "☀️" : "🌙";
  if (stockChart || categoryValueChart || salesCategoryChart) {
    destroyCharts(); renderCharts();
  }
}
themeToggle.addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme") || "light";
  applyTheme(cur === "dark" ? "light" : "dark");
});
themeIcon.textContent =
  document.documentElement.getAttribute("data-theme") === "dark" ? "☀️" : "🌙";

/* ==========================================================
   SOUND
   ========================================================== */
function updateSoundIcon() {
  soundIcon.textContent = soundEnabled ? "🔊" : "🔇";
}
soundToggle.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem("soundEnabled", soundEnabled);
  updateSoundIcon();
});
updateSoundIcon();

function playBeep(frequency, duration, type = "sine") {
  if (!soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
    setTimeout(() => ctx.close(), duration * 1000 + 100);
  } catch (e) { /* ignore */ }
}
function playSuccessSound() {
  playBeep(880, 0.12);
  setTimeout(() => playBeep(1100, 0.12), 120);
}
function playErrorSound() { playBeep(220, 0.35, "sawtooth"); }

/* ==========================================================
   AUTH TABS
   ========================================================== */
tabLogin.addEventListener("click", () => {
  isSignupMode = false; tabLogin.classList.add("active");
  tabSignup.classList.remove("active");
  authSubmit.textContent = "Login"; authError.textContent = "";
});
tabSignup.addEventListener("click", () => {
  isSignupMode = true; tabSignup.classList.add("active");
  tabLogin.classList.remove("active");
  authSubmit.textContent = "Create Account"; authError.textContent = "";
});

/* ==========================================================
   SIGNUP / LOGIN
   ========================================================== */
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.textContent = "";
  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;

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
        authError.textContent = "Account created, but profile setup failed. Check Firestore rules.";
      }
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (err) {
    console.error("[Auth] submit error:", err);
    authError.textContent = friendlyAuthError(err.code);
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

/* ==========================================================
   AUTH STATE
   ========================================================== */
onAuthStateChanged(auth, async (user) => {
  if (unsubscribeUserDoc) { unsubscribeUserDoc(); unsubscribeUserDoc = null; }
  stopAllListeners();
  stopCarousel();
  stopMiniCarousels();
  stopAuthBgCarousel();

  if (!user) {
    currentUser = null; currentUserData = null;
    authScreen.classList.remove("hidden");
    pendingScreen.classList.add("hidden");
    appShell.classList.add("hidden");
    authForm.reset(); authError.textContent = "";
    startAuthBgCarousel("auth-bg-slides");
    return;
  }

  currentUser = user;
  userEmailEl.textContent = user.email;
  pendingEmail.textContent = user.email;

  const isSuper =
    (user.email || "").trim().toLowerCase() === SUPER_ADMIN_EMAIL.trim().toLowerCase();

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
    authError.textContent = `Profile setup failed: ${err.code || err.message}`;
    authScreen.classList.remove("hidden");
    appShell.classList.add("hidden");
    pendingScreen.classList.add("hidden");
    startAuthBgCarousel("auth-bg-slides");
    return;
  }

  unsubscribeUserDoc = onSnapshot(userRef, (docSnap) => {
    if (!docSnap.exists()) return;
    currentUserData = docSnap.data();

    if (!currentUserData.approved) {
      authScreen.classList.add("hidden");
      appShell.classList.add("hidden");
      pendingScreen.classList.remove("hidden");
      stopAuthBgCarousel();
      startAuthBgCarousel("pending-bg-slides");
      return;
    }

    pendingScreen.classList.add("hidden");
    authScreen.classList.add("hidden");
    appShell.classList.remove("hidden");
    stopAuthBgCarousel();

    navAdmin.classList.toggle("hidden", currentUserData.role !== "superadmin");

    if (!unsubscribers.inventory) startAllListeners();
    if (currentUserData.role === "superadmin" && !unsubscribers.users) {
      startUserAdminListener();
    }
  }, (err) => {
    console.error("[Auth] profile watch FAILED:", err.code, err.message);
    showToast(`Profile stream: ${err.code || err.message} ❌`);
  });
});

logoutBtn.addEventListener("click", () => signOut(auth));
pendingLogout.addEventListener("click", () => signOut(auth));

function myWorkspace() { return currentUser?.uid; }

/* ==========================================================
   REAL-TIME LISTENERS
   ========================================================== */
function startAllListeners() {
  const wsId = myWorkspace();
  if (!wsId) return;

  unsubscribers.inventory = onSnapshot(
    query(collection(db, "inventory"), where("workspaceId", "==", wsId)),
    (snap) => {
      inventory = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      renderInventory();
      renderLowStockAlerts();
      renderDashboardInventory();
      updateStats();
      populateCategoryFilter();
      populateCategoryDatalist();
      populateSaleItemSelect();
      renderCharts();
      renderCarousel();
      renderSalesProducts();
      renderFastMoving();
      if (!itemId.value) updateSkuField();
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
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        })
        .slice(0, 50);
      renderSales();
      updateStats();
      renderCharts();
      renderCarousel();
      renderSalesProducts();
      renderFastMoving();
    },
    (err) => console.error("[Sales listener]", err.code, err.message)
  );

  unsubscribers.categories = onSnapshot(
    query(collection(db, "categories"), where("workspaceId", "==", wsId)),
    (snap) => {
      categories = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      renderCategories();
      updateStats();
      populateCategoryDatalist();
    },
    (err) => console.error("[Categories listener]", err.code, err.message)
  );
}

function startUserAdminListener() {
  unsubscribers.users = onSnapshot(
    query(collection(db, "users")),
    (snap) => {
      allUsers = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
      renderAdminUsers();
    },
    (err) => console.error("[Users listener]", err.code, err.message)
  );
}

function stopAllListeners() {
  Object.values(unsubscribers).forEach((u) => u && u());
  Object.keys(unsubscribers).forEach((k) => delete unsubscribers[k]);
  destroyCharts();
  stopCarousel();
  stopMiniCarousels();
}

/* ==========================================================
   NAV
   ========================================================== */
navButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    navButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    pages.forEach(p => p.classList.add("hidden"));
    const target = $(btn.dataset.page);
    if (target) target.classList.remove("hidden");

    if (btn.dataset.page === "page-dashboard") {
      renderCharts();
      renderDashboardInventory();
      renderCarousel();
      renderFastMoving();
    }
    if (btn.dataset.page === "page-sales") {
      renderSalesProducts();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});

/* ==========================================================
   PHOTO HANDLING
   ========================================================== */
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
        canvas.width = width; canvas.height = height;
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
  if (dataUrl) {
    photoPreview.classList.add("has-image");
    photoPreview.innerHTML = `<img src="${dataUrl}" alt="Preview" />`;
    photoRemoveBtn.classList.remove("hidden");
  } else {
    photoPreview.classList.remove("has-image");
    photoPreview.innerHTML = `<span class="photo-placeholder">📷<br>Add Photo</span>`;
    photoRemoveBtn.classList.add("hidden");
  }
}

photoPickBtn.addEventListener("click", () => itemImage.click());
photoPreview.addEventListener("click", () => itemImage.click());

itemImage.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await compressImage(file);
    itemImageData.value = dataUrl;
    showPhotoPreview(dataUrl);
    showToast("Photo ready ✅");
  } catch (err) {
    console.error("[photo]", err);
    showToast("Failed to process photo ❌");
  }
});

photoRemoveBtn.addEventListener("click", () => {
  itemImage.value = "";
  itemImageData.value = "";
  showPhotoPreview(null);
});

/* ==========================================================
   PRODUCT IMAGE HELPERS
   ========================================================== */
const FALLBACK_COLORS = ["#12544F", "#2FA38F", "#5FC2A6", "#0C3E3A", "#16665F", "#0F4945"];

function fallbackColorFor(name) {
  return FALLBACK_COLORS[((name || "").charCodeAt(0) || 0) % FALLBACK_COLORS.length];
}
function productImageHTML(item, size = "md") {
  const cls = size === "sm" ? "product-img sm" : "product-img";
  if (item.image) {
    return `<img class="${cls}" src="${item.image}" alt="${esc(item.name)}" loading="lazy" />`;
  }
  const initial = (item.name || "?").charAt(0).toUpperCase();
  return `<div class="${cls} fallback" style="background:${fallbackColorFor(item.name)}">${initial}</div>`;
}
function thumbHTML(item) {
  if (item.image) return `<img src="${item.image}" alt="${esc(item.name)}" loading="lazy" />`;
  return esc((item.name || "?").charAt(0).toUpperCase());
}

/* ==========================================================
   AUTO SKU
   ========================================================== */
function nextSku() {
  let max = 1000;
  inventory.forEach(item => {
    const n = parseInt(item.sku, 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return String(max + 1);
}
function updateSkuField() {
  if (itemId.value) return;
  if (manualSku) return;
  const next = nextSku();
  if (itemSku.value !== next) itemSku.value = next;
}
itemSku.addEventListener("input", () => { manualSku = true; });

/* ==========================================================
   BARCODE SCANNER
   ========================================================== */
function openScanner(target) {
  scannerTarget = target;
  scannerTitle.textContent = target === "sku" ? "Scan SKU / Barcode" : "Scan Item for Sale";
  scannerStatus.textContent = "Point the camera at a barcode…";
  scannerStatus.classList.remove("error");
  scannerManualInput.value = "";
  scannerModal.classList.remove("hidden");

  if (!html5QrCode) html5QrCode = new Html5Qrcode("scanner-reader");

  scannerActive = true;
  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 250, height: 250 } },
    (decodedText) => handleScanResult(decodedText),
    () => {}
  ).catch(err => {
    console.error("[Scanner] start failed:", err);
    scannerStatus.textContent = "Camera error: " + err;
    scannerStatus.classList.add("error");
    scannerActive = false;
  });
}

function closeScanner() {
  if (html5QrCode && scannerActive) {
    html5QrCode.stop().then(() => {
      scannerActive = false;
      scannerModal.classList.add("hidden");
    }).catch(() => {
      scannerActive = false;
      scannerModal.classList.add("hidden");
    });
  } else {
    scannerModal.classList.add("hidden");
  }
}

function handleScanResult(text) {
  if (!text) return;
  const code = text.trim();

  if (scannerTarget === "sku") {
    itemSku.value = code;
    manualSku = true;
    playSuccessSound();
    scannerStatus.textContent = "✅ SKU set: " + code;
    setTimeout(closeScanner, 400);
  } else if (scannerTarget === "sale") {
    const item = inventory.find(i => i.sku === code);
    if (item) {
      saleItem.value = item.id;
      playSuccessSound();
      scannerStatus.textContent = "✅ Found: " + item.name;
      setTimeout(closeScanner, 400);
    } else {
      playErrorSound();
      scannerStatus.textContent = "❌ No item with SKU: " + code;
      scannerStatus.classList.add("error");
    }
  }
}

scanSkuBtn.addEventListener("click", () => openScanner("sku"));
scanSaleBtn.addEventListener("click", () => openScanner("sale"));
scannerClose.addEventListener("click", closeScanner);

scannerManualBtn.addEventListener("click", () => {
  const val = scannerManualInput.value.trim();
  if (val) handleScanResult(val);
});
scannerManualInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); scannerManualBtn.click(); }
});

/* ==========================================================
   DATA HELPERS
   ========================================================== */
function getSoldMap() {
  const map = {};
  sales.forEach(s => {
    if (s.itemId) map[s.itemId] = (map[s.itemId] || 0) + (s.quantity || 0);
  });
  return map;
}

/* ==========================================================
   SALES PAGE — PRODUCT CARDS with MINI CAROUSEL
   ========================================================== */
const NEW_ARRIVAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function buildMiniSlides(item, sold) {
  const slides = [];
  const isLow = item.quantity > 0 && item.quantity <= (item.threshold ?? 5);
  const isOut = item.quantity === 0;
  const createdMs = item.createdAt?.toMillis?.() ?? 0;
  const isNew = createdMs && (Date.now() - createdMs) < NEW_ARRIVAL_WINDOW_MS;
  const revenue = sold * (item.price || 0);

  if (isNew) slides.push({ cls: "new", text: "✨ New Arrival" });
  if (isOut) slides.push({ cls: "low", text: "🚫 Out of Stock" });
  else if (isLow) slides.push({ cls: "low", text: `⚠️ Low Stock · ${item.quantity} left` });
  if (sold > 0) slides.push({ cls: "hot", text: `🔥 ${sold} pcs sold` });
  if (revenue > 0) slides.push({ cls: "ok", text: `💰 ₱${revenue.toFixed(2)} revenue` });
  slides.push({ cls: "ok", text: `📦 ${item.quantity} in stock` });

  return slides;
}

function renderSalesProducts() {
  if (!salesProductsGrid) return;

  const term = (salesSearchEl?.value || "").toLowerCase().trim();
  const filtered = inventory.filter(i => {
    if (!term) return true;
    return i.name.toLowerCase().includes(term) || i.sku.toLowerCase().includes(term);
  });

  if (!filtered.length) {
    salesProductsGrid.innerHTML = `<div class="empty-state"><p>📭 No products yet — add one from the Add Item tab.</p></div>`;
    stopMiniCarousels();
    return;
  }

  const soldMap = getSoldMap();

  salesProductsGrid.innerHTML = filtered.map(item => {
    const sold = soldMap[item.id] || 0;
    const isLow = item.quantity > 0 && item.quantity <= (item.threshold ?? 5);
    const isOut = item.quantity === 0;

    const createdMs = item.createdAt?.toMillis?.() ?? 0;
    const isNew = createdMs && (Date.now() - createdMs) < NEW_ARRIVAL_WINDOW_MS;

    let topTag = "";
    if (isOut) topTag = `<span class="product-tag low">Out</span>`;
    else if (isLow) topTag = `<span class="product-tag low">Low</span>`;
    else if (sold > 0) topTag = `<span class="product-tag hot">🔥 Hot</span>`;
    else if (isNew) topTag = `<span class="product-tag new">New</span>`;

    let qtyCls = "";
    if (isOut) qtyCls = "danger";
    else if (isLow) qtyCls = "warn";

    const media = item.image
      ? `<img src="${item.image}" alt="${esc(item.name)}" loading="lazy" />`
      : `<div class="fallback" style="background:${fallbackColorFor(item.name)}">${esc((item.name || "?").charAt(0).toUpperCase())}</div>`;

    const slides = buildMiniSlides(item, sold);
    const slideHTML = slides.map(s => `<div class="mini-slide ${s.cls}">${esc(s.text)}</div>`).join("");
    const dotHTML = slides.map((_, i) =>
      `<button class="mini-dot ${i === 0 ? "active" : ""}" data-i="${i}" aria-label="Slide ${i + 1}"></button>`
    ).join("");

    return `
      <div class="product-card ${isLow ? "is-low" : ""} ${isOut ? "is-out" : ""}">
        <div class="product-media">
          ${media}
          ${topTag}
        </div>
        <div class="product-body">
          <div>
            <div class="product-name" title="${esc(item.name)}">${esc(item.name)}</div>
            <div class="product-sub">SKU: ${esc(item.sku)} · ${esc(item.category)}</div>
          </div>
          <div class="product-price-row">
            <span class="product-price">₱${Number(item.price).toFixed(2)}</span>
            <span class="product-qty ${qtyCls}">📦 ${item.quantity}</span>
          </div>
          <div class="mini-carousel" data-count="${slides.length}">
            <div class="mini-track">${slideHTML}</div>
          </div>
          <div class="mini-dots">${dotHTML}</div>
        </div>
      </div>
    `;
  }).join("");

  salesProductsGrid.querySelectorAll(".mini-carousel").forEach(carousel => {
    const track = carousel.querySelector(".mini-track");
    const dots = carousel.parentElement.querySelectorAll(".mini-dot");
    dots.forEach((dot, i) => {
      dot.addEventListener("click", () => {
        track.style.transform = `translateX(-${i * 100}%)`;
        dots.forEach((d, j) => d.classList.toggle("active", j === i));
      });
    });
    track.style.transform = "translateX(0%)";
  });

  startMiniCarousels();
}

function startMiniCarousels() {
  stopMiniCarousels();
  miniCarouselTimer = setInterval(() => {
    miniCarouselIndex++;
    document.querySelectorAll(".mini-carousel").forEach(carousel => {
      const count = parseInt(carousel.dataset.count || "1");
      if (count <= 1) return;
      const idx = miniCarouselIndex % count;
      const track = carousel.querySelector(".mini-track");
      if (track) track.style.transform = `translateX(-${idx * 100}%)`;
      const dots = carousel.parentElement.querySelectorAll(".mini-dot");
      dots.forEach((d, j) => d.classList.toggle("active", j === idx));
    });
  }, 2800);
}

function stopMiniCarousels() {
  if (miniCarouselTimer) {
    clearInterval(miniCarouselTimer);
    miniCarouselTimer = null;
  }
}

if (salesSearchEl) {
  salesSearchEl.addEventListener("input", renderSalesProducts);
}

/* ==========================================================
   DASHBOARD SPOTLIGHT CAROUSEL
   ========================================================== */
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

  return slides;
}

function renderCarousel() {
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
              <div class="spotlight-sku">SKU: ${esc(item.sku)}</div>
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
  if (!carouselSlides.length) return;
  carouselTrack.style.transform = `translateX(-${carouselIndex * 100}%)`;
  carouselDots.querySelectorAll(".dot").forEach((dot, idx) => {
    dot.classList.toggle("active", idx === carouselIndex);
  });
}
function nextSlide() {
  if (!carouselSlides.length) return;
  carouselIndex = (carouselIndex + 1) % carouselSlides.length;
  updateCarouselPosition();
}
function prevSlide() {
  if (!carouselSlides.length) return;
  carouselIndex = (carouselIndex - 1 + carouselSlides.length) % carouselSlides.length;
  updateCarouselPosition();
}
function restartCarousel() {
  stopCarousel();
  if (carouselSlides.length > 1) carouselInterval = setInterval(nextSlide, 5000);
}
function stopCarousel() {
  if (carouselInterval) { clearInterval(carouselInterval); carouselInterval = null; }
}
carouselPrev.addEventListener("click", () => { prevSlide(); restartCarousel(); });
carouselNext.addEventListener("click", () => { nextSlide(); restartCarousel(); });

/* ==========================================================
   FAST MOVING
   ========================================================== */
function renderFastMoving() {
  const soldMap = getSoldMap();
  const ranked = [...inventory]
    .map(i => ({ ...i, sold: soldMap[i.id] || 0 }))
    .filter(i => i.sold > 0)
    .sort((a, b) => b.sold - a.sold)
    .slice(0, 5);

  if (!ranked.length) {
    fastMovingList.innerHTML =
      `<div class="empty-state"><p>No sales yet — record a sale to see fast-moving products.</p></div>`;
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

/* ==========================================================
   PROGRESS BAR
   ========================================================== */
function stockProgress(item) {
  const t = item.threshold ?? 5;
  const capacity = Math.max(t * 3, 1);
  const percent = Math.min((item.quantity / capacity) * 100, 100);
  let level = "high";
  if (item.quantity === 0 || item.quantity <= t) level = "low";
  else if (item.quantity <= t * 2) level = "medium";
  return { percent, level };
}

/* ==========================================================
   RENDER — Inventory grid
   ========================================================== */
function renderInventory() {
  const s = (searchInput?.value || "").toLowerCase();
  const f = filterCat?.value || "";
  const filtered = inventory.filter(i => {
    const mS = !s || i.name.toLowerCase().includes(s) || i.sku.toLowerCase().includes(s);
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
          <div class="item-actions">
            <button class="btn ghost" onclick="editItem('${item.id}')">Edit</button>
            <button class="btn danger" onclick="deleteItem('${item.id}')">Delete</button>
          </div>
        </div>
      </div>`;
  }).join("");
}

/* ==========================================================
   RENDER — Dashboard live inventory
   ========================================================== */
function renderDashboardInventory() {
  const container = $("dashboard-inventory");
  if (!container) return;

  const term = ($("dash-search")?.value || "").toLowerCase();
  const filtered = inventory.filter(i => {
    if (!term) return true;
    return i.name.toLowerCase().includes(term) || i.sku.toLowerCase().includes(term);
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

/* ==========================================================
   RENDER — Low stock alerts
   ========================================================== */
function renderLowStockAlerts() {
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
          <div class="item-meta">
            <span>📦 ${item.quantity}</span>
            <span>⚠️ Threshold: ${item.threshold ?? 5}</span>
          </div>
          <div class="progress-wrap">
            <div class="progress"><div class="progress-bar ${level}" style="width:${percent}%"></div></div>
            <span class="progress-label">${percent.toFixed(0)}%</span>
          </div>
        </div>
      </div>`;
  }).join("");
}

/* ==========================================================
   RENDER — Recent Sales
   ========================================================== */
function renderSales() {
  if (!sales.length) {
    salesList.innerHTML = `<div class="empty-state"><p>🛒 No sales recorded yet.</p></div>`;
    return;
  }
  salesList.innerHTML = sales.map(s => {
    const item = inventory.find(i => i.id === s.itemId) || { name: s.itemName, image: null };
    const date = s.createdAt?.toDate?.().toLocaleString() ?? "Just now";
    return `
      <div class="sale-row">
        <div class="sale-info">
          ${productImageHTML(item, "sm")}
          <div class="sale-txt">
            <div class="sale-name">${esc(s.itemName)} × ${s.quantity}</div>
            <div class="sale-date">${date}</div>
          </div>
        </div>
        <div class="sale-total">₱${Number(s.total).toFixed(2)}</div>
      </div>`;
  }).join("");
}

/* ==========================================================
   RENDER — Categories
   ========================================================== */
function renderCategories() {
  if (!categories.length) {
    categoryGrid.innerHTML = `<div class="empty-state"><p>🗂️ No categories yet.</p></div>`;
    return;
  }
  categoryGrid.innerHTML = categories.map(cat => {
    const count = inventory.filter(i => i.category === cat.name).length;
    return `<div class="category-card">
      <div><div class="cat-name">${esc(cat.name)}</div><div class="cat-count">${count} item${count !== 1 ? "s" : ""}</div></div>
      <button class="btn danger" onclick="deleteCategory('${cat.id}')">✕</button>
    </div>`;
  }).join("");
}

/* ==========================================================
   STATS
   ========================================================== */
function updateStats() {
  const total = inventory.length;
  const low = inventory.filter(i => i.quantity <= (i.threshold ?? 5)).length;
  const value = inventory.reduce((s, i) => s + (i.quantity * i.price || 0), 0);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todaySales = sales
    .filter(s => s.createdAt?.toDate?.() >= today)
    .reduce((s, x) => s + (x.total || 0), 0);

  statTotal.textContent = total;
  statLow.textContent = low;
  statValue.textContent = "₱" + value.toFixed(2);
  statSales.textContent = "₱" + todaySales.toFixed(2);
  statCats.textContent = categories.length;
}

/* ==========================================================
   CHARTS
   ========================================================== */
const CATEGORY_PALETTE = ["#12544F", "#2FA38F", "#5FC2A6", "#0C3E3A", "#16665F", "#0F4945", "#E8B33A", "#D79A6A"];
const getCSSVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function commonChartOptions(textColor) {
  return {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 400 },
    plugins: { legend: { position: "bottom", labels: { color: textColor, padding: 12, font: { size: 12 }, boxWidth: 14, usePointStyle: true } } }
  };
}

function renderCharts() {
  if (typeof Chart === "undefined") return;
  if (!inventory.length && !sales.length) return;
  const textColor = getCSSVar("--text") || "#1e293b";

  const inStock = inventory.filter(i => i.quantity > (i.threshold ?? 5)).length;
  const lowStock = inventory.filter(i => i.quantity > 0 && i.quantity <= (i.threshold ?? 5)).length;
  const outStock = inventory.filter(i => i.quantity === 0).length;
  const stockData = {
    labels: ["In Stock", "Low Stock", "Out of Stock"],
    datasets: [{ data: [inStock, lowStock, outStock], backgroundColor: ["#22c55e", "#f59e0b", "#ef4444"], borderWidth: 0, hoverOffset: 6 }]
  };
  if (stockChart) {
    stockChart.data = stockData;
    stockChart.options.plugins.legend.labels.color = textColor;
    stockChart.update("none");
  } else {
    stockChart = new Chart($("stock-status-chart"), {
      type: "doughnut", data: stockData,
      options: {
        ...commonChartOptions(textColor), cutout: "62%",
        plugins: {
          ...commonChartOptions(textColor).plugins,
          tooltip: {
            callbacks: {
              label: (c) => {
                const t = c.dataset.data.reduce((a, b) => a + b, 0) || 1;
                return `${c.label}: ${c.parsed} (${((c.parsed / t) * 100).toFixed(1)}%)`;
              }
            }
          }
        }
      }
    });
  }

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
  if (categoryValueChart) {
    categoryValueChart.data = catData;
    categoryValueChart.options.plugins.legend.labels.color = textColor;
    categoryValueChart.update("none");
  } else {
    categoryValueChart = new Chart($("category-value-chart"), {
      type: "pie", data: catData,
      options: {
        ...commonChartOptions(textColor),
        plugins: {
          ...commonChartOptions(textColor).plugins,
          tooltip: { callbacks: { label: (c) => `${c.label}: ₱${Number(c.parsed).toFixed(2)}` } }
        }
      }
    });
  }

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
  if (salesCategoryChart) {
    salesCategoryChart.data = salesData;
    salesCategoryChart.options.plugins.legend.labels.color = textColor;
    salesCategoryChart.update("none");
  } else {
    salesCategoryChart = new Chart($("sales-category-chart"), {
      type: "pie", data: salesData,
      options: {
        ...commonChartOptions(textColor),
        plugins: {
          ...commonChartOptions(textColor).plugins,
          tooltip: { callbacks: { label: (c) => `${c.label}: ₱${Number(c.parsed).toFixed(2)}` } }
        }
      }
    });
  }
}

function destroyCharts() {
  [stockChart, categoryValueChart, salesCategoryChart].forEach(c => c && c.destroy());
  stockChart = categoryValueChart = salesCategoryChart = null;
}

/* ==========================================================
   SELECTS / DATALISTS
   ========================================================== */
function populateCategoryFilter() {
  const names = [...new Set(inventory.map(i => i.category))].sort();
  const cur = filterCat.value;
  filterCat.innerHTML = `<option value="">All Categories</option>` +
    names.map(c => `<option value="${c}">${c}</option>`).join("");
  filterCat.value = cur;
}
function populateCategoryDatalist() {
  const names = [...new Set([...categories.map(c => c.name), ...inventory.map(i => i.category)])].sort();
  categoryList.innerHTML = names.map(c => `<option value="${c}">`).join("");
}
function populateSaleItemSelect() {
  const cur = saleItem.value;
  saleItem.innerHTML = `<option value="">Select item…</option>` +
    inventory.map(i => `<option value="${i.id}">${esc(i.name)} (${i.quantity} left)</option>`).join("");
  saleItem.value = cur;
}

searchInput.addEventListener("input", renderInventory);
filterCat.addEventListener("change", renderInventory);

const dashSearchEl = $("dash-search");
if (dashSearchEl) dashSearchEl.addEventListener("input", renderDashboardInventory);

/* ==========================================================
   CRUD — Inventory items
   ========================================================== */
itemForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const wsId = myWorkspace();
  if (!wsId) { showToast("Workspace not ready ❌"); return; }

  const data = {
    name: itemName.value.trim(),
    sku: itemSku.value.trim(),
    category: itemCategory.value.trim(),
    quantity: Number(itemQty.value),
    price: Number(itemPrice.value),
    threshold: Number(itemThreshold.value),
    image: itemImageData.value || null,
    workspaceId: wsId,
    updatedAt: serverTimestamp()
  };

  try {
    if (itemId.value) {
      await updateDoc(doc(db, "inventory", itemId.value), data);
      showToast("Item updated ✅");
    } else {
      await addDoc(collection(db, "inventory"), { ...data, createdAt: serverTimestamp() });
      showToast("Item added ✅");
    }
    itemForm.reset();
    itemId.value = ""; itemThreshold.value = 5;
    itemImageData.value = ""; itemImage.value = "";
    showPhotoPreview(null);
    manualSku = false;
    updateSkuField();
  } catch (err) {
    console.error("[add/update item]", err.code, err.message);
    showToast(`Failed: ${err.code || err.message} ❌`);
  }
});

window.editItem = (id) => {
  const item = inventory.find(i => i.id === id);
  if (!item) return;
  itemId.value = item.id; itemName.value = item.name; itemSku.value = item.sku;
  itemCategory.value = item.category; itemQty.value = item.quantity;
  itemPrice.value = item.price; itemThreshold.value = item.threshold ?? 5;
  itemImageData.value = item.image || "";
  showPhotoPreview(item.image || null);
  manualSku = true;
  document.querySelector('[data-page="page-add"]').click();
  window.scrollTo({ top: 0, behavior: "smooth" });
};

window.deleteItem = async (id) => {
  if (!confirm("Delete this item permanently?")) return;
  try {
    await deleteDoc(doc(db, "inventory", id));
    showToast("Item deleted 🗑️");
  } catch (err) {
    console.error("[delete item]", err.code, err.message);
    showToast(`Failed: ${err.code || err.message} ❌`);
  }
};

/* ==========================================================
   RECORD SALE
   ========================================================== */
saleForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const wsId = myWorkspace();
  if (!wsId) { showToast("Workspace not ready ❌"); return; }

  const item = inventory.find(i => i.id === saleItem.value);
  const qty = Number(saleQty.value);
  if (!item) { showToast("Select an item ❌"); return; }
  if (qty > item.quantity) { showToast("Not enough stock ❌"); return; }

  try {
    await addDoc(collection(db, "sales"), {
      itemId: item.id, itemName: item.name, category: item.category,
      quantity: qty, unitPrice: item.price, total: qty * item.price,
      workspaceId: wsId,
      createdAt: serverTimestamp(), userId: currentUser.uid
    });
    await updateDoc(doc(db, "inventory", item.id), {
      quantity: item.quantity - qty,
      updatedAt: serverTimestamp()
    });
    saleForm.reset();
    playSuccessSound();
    showToast("Sale recorded ✅");
  } catch (err) {
    console.error("[record sale]", err.code, err.message);
    showToast(`Failed: ${err.code || err.message} ❌`);
  }
});

/* ==========================================================
   CATEGORIES CRUD
   ========================================================== */
categoryForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const wsId = myWorkspace();
  if (!wsId) { showToast("Workspace not ready ❌"); return; }

  const name = newCategory.value.trim();
  if (!name) return;
  if (categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    showToast("Category already exists ❌"); return;
  }

  try {
    await addDoc(collection(db, "categories"), {
      name, workspaceId: wsId, createdAt: serverTimestamp()
    });
    newCategory.value = "";
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

/* ==========================================================
   ADMIN
   ========================================================== */
function renderAdminUsers() {
  const pending = allUsers.filter(u => !u.approved);
  pendingUsersList.innerHTML = pending.length
    ? pending.map(userRowHTML).join("")
    : `<div class="empty-state"><p>✅ No pending approvals.</p></div>`;
  allUsersList.innerHTML = allUsers.length
    ? allUsers.map(userRowHTML).join("")
    : `<div class="empty-state"><p>No users yet.</p></div>`;
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
          ? `<button class="btn ghost" onclick="toggleApproval('${u.id}', false)">Revoke</button>`
          : `<button class="btn primary" onclick="toggleApproval('${u.id}', true)">Approve</button>`}
        ${isSuper ? "" : `<button class="btn danger" onclick="deleteUser('${u.id}')">Delete</button>`}
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

/* ==========================================================
   UTILITIES
   ========================================================== */
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.add("hidden"), 3000);
}

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}