/* app.js — Main entry: wires everything together */
import { state, CONSTANTS } from "./state.js";
import { $, safeRender, showToast, applyTheme } from "./utils.js";
import { initAuthUI, initAuthHandlers, buildAuthBackground, startAuthBgCarousel, stopAuthBgCarousel, startTextCarousel } from "./auth.js";
import {
  initInventory, startInventoryListeners, renderInventory, renderDashboardInventory,
  renderLowStockAlerts, renderExpiring, renderMovements, renderCategories, autoFillSku,
  forceCloseScanner, renderInventoryAnalytics,
  autoSyncFromFile, startAutoSyncTicker, stopAutoSyncTicker, updateAutoSyncUI
} from "./inventory.js";
import {
  initPOS, startSalesListener, renderPosProducts, renderPosCart, renderSales,
  updateChange, startPosMiniCarousels, stopPosMiniCarousels, togglePaymentMode
} from "./pos.js";
import {
  initReports, updateStats, renderCharts, destroyCharts, renderSalesOverview,
  populateMonthFilter, populateSalesCategoryFilter,
  renderHistory, renderHistoryCategorySummary,
  renderSalesCategorySummary, renderFastMoving, renderSlowMoving, renderCarousel,
  renderKPIs, renderTopProfitAndRevenue, stopCarousel
} from "./reports.js";
import {
  loadThemePalette,
  startThemeRotationTicker,
  stopThemeRotationTicker
} from "./theme.js";
import {
  initCustomers, startCustomersListeners, renderCustomerPickerOptions
} from "./customers.js";
import { initLabels, renderLabelsPage } from "./labels.js";
import { initGcash, startGcashListeners, renderGcashPage } from "./gcash.js";
import { initMaya, startMayaListeners, renderMayaPage } from "./maya.js";

/* =========================================================
   POPULATE CATEGORY OPTIONS — local function
   ========================================================= */
function populateCategoryOptions() {
  const names = (state.categories || []).map(c => c.name).filter(Boolean);

  // 1) Datalist for the Add/Edit Item form
  const datalist = document.getElementById("category-list");
  if (datalist) {
    datalist.innerHTML = names
      .map(n => `<option value="${n.replace(/"/g, '&quot;')}"></option>`)
      .join("");
  }

  // 2) Add Item page — category filter
  const filterSel = document.getElementById("filter-category");
  if (filterSel) {
    const cur = filterSel.value;
    filterSel.innerHTML = `<option value="">All Categories</option>` +
      names.map(n => `<option value="${n}">${n}</option>`).join("");
    if (cur && names.includes(cur)) filterSel.value = cur;
  }

  // 3) POS — category filter
  const posSel = document.getElementById("sales-cat-filter");
  if (posSel) {
    const cur = posSel.value;
    posSel.innerHTML = `<option value="">All Categories</option>` +
      names.map(n => `<option value="${n}">${n}</option>`).join("");
    if (cur && names.includes(cur)) posSel.value = cur;
  }

  // 4) History — category filter
  const histSel = document.getElementById("history-cat-filter");
  if (histSel) {
    const cur = histSel.value;
    histSel.innerHTML = `<option value="">All Categories</option>` +
      names.map(n => `<option value="${n}">${n}</option>`).join("");
    if (cur && names.includes(cur)) histSel.value = cur;
  }
}

/* =========================================================
   PERSONALIZED GREETING
   ========================================================= */
let greetingTimer = null;

function getFirstNameFromEmail(email) {
  if (!email) return "there";
  const local = String(email).split("@")[0] || "";
  const clean = local.split(/[._\-+0-9]/)[0] || local;
  if (!clean) return "there";
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

function getGreetingWord(hour) {
  if (hour >= 5 && hour < 12)  return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  if (hour >= 18 && hour < 22) return "Good evening";
  return "Hello";
}

export function updateTopbarGreeting() {
  const nameEl = document.getElementById("topbar-greeting-name");
  const subEl  = document.getElementById("topbar-greeting-sub");
  if (!nameEl) return;

  const email = state.currentUser?.email || "";
  const name = getFirstNameFromEmail(email);
  const now = new Date();
  const hour = now.getHours();

  const emoji = hour < 12 ? "☀️" : hour < 18 ? "🌤️" : "🌙";
  nameEl.textContent = `${emoji} ${getGreetingWord(hour)}, ${name}!`;

  if (subEl) {
    const dateStr = now.toLocaleDateString(undefined, {
      weekday: "long", month: "long", day: "numeric"
    });
    const timeStr = now.toLocaleTimeString(undefined, {
      hour: "2-digit", minute: "2-digit"
    });
    subEl.textContent = `${dateStr} · ${timeStr}`;
  }
}

export function startGreetingTicker() {
  if (greetingTimer) clearInterval(greetingTimer);
  updateTopbarGreeting();
  updateTopbarAvatar();               // ← load the avatar when the user logs in
  greetingTimer = setInterval(() => {
    updateTopbarGreeting();
    updateTopbarAvatar();             // ← keeps it in sync if the photo URL changes
  }, 30 * 1000);
}

export function stopGreetingTicker() {
  if (greetingTimer) { clearInterval(greetingTimer); greetingTimer = null; }
}
/* =========================================================
   PROFILE AVATAR — loads the Google account photo
   Falls back to initials if the photo can't load
   ========================================================= */
let _lastAvatarKey = null;

export function updateTopbarAvatar() {
  const avatarEl = document.getElementById("topbar-avatar");
  if (!avatarEl) return;

  const user = state.currentUser;
  if (!user) {
    avatarEl.classList.add("hidden");
    avatarEl.innerHTML = "";
    _lastAvatarKey = null;
    return;
  }

  const data  = state.currentUserData || {};
  const photo = user.photoURL || data.photoURL || "";
  const email = user.email    || data.email    || "";
  const name  = user.displayName || data.displayName || "";
  const fallbackLetter = ((name || email || "?").trim()[0] || "?").toUpperCase();

  // Skip if nothing changed (prevents flicker on every greeting tick)
  const key = `${photo}|${fallbackLetter}`;
  if (key === _lastAvatarKey && !avatarEl.classList.contains("hidden")) return;
  _lastAvatarKey = key;

  // Start with the initials fallback
  avatarEl.textContent = fallbackLetter;

  // Try to load the Google photo in the background
  if (photo) {
    const img = new Image();
    img.src = photo;
    img.alt = "";
    img.referrerPolicy = "no-referrer";   // helps with Google UserContent URLs
    img.crossOrigin = "anonymous";

    img.onload = () => {
      // Bail out if a newer avatar was requested while we were loading
      if (_lastAvatarKey !== key) return;
      avatarEl.innerHTML = "";
      avatarEl.appendChild(img);
    };

    img.onerror = () => {
      // Silently keep the initials fallback
      console.warn("[avatar] photo failed to load:", photo);
    };
  }

  avatarEl.classList.remove("hidden");

  // Add a native tooltip with the email so hovering shows who's logged in
  avatarEl.title = email || name || "";
}

/* =========================================================
   PWA INSTALL — topbar button, sidebar "Download App", banner
   Platform-aware instructions modal + live diagnostics
   ========================================================= */
let deferredInstallPrompt = null;

/* ---------- Platform detection ---------- */
function detectInstallPlatform() {
  const ua = navigator.userAgent || "";
  const isIPad = /iPad/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

  if (/iPhone|iPod/.test(ua) || isIPad) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

function isRunningStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    window.navigator.standalone === true
  );
}

function isSecureContextOk() {
  return (
    location.protocol === "https:" ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === "[::1]"
  );
}

/* ---------- Live diagnostic ---------- */
async function diagnoseInstallability() {
  const reasons = [];

  if (isRunningStandalone()) reasons.push("Already running as installed app");
  if (!isSecureContextOk())
    reasons.push(`Not a secure origin (current: ${location.protocol}//${location.hostname}) — must be HTTPS or localhost`);
  if (!("serviceWorker" in navigator)) reasons.push("Browser doesn't support service workers");

  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    if (!regs.length) reasons.push("No service worker registered");
    else {
      const anyActive = regs.some(r => r.active || r.installing || r.waiting);
      if (!anyActive) reasons.push("Service worker exists but is not active");
    }
  } catch (e) {
    reasons.push("Could not query service workers: " + e.message);
  }

  try {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) reasons.push('No <link rel="manifest"> in HTML');
    else {
      const res = await fetch(link.href, { cache: "no-store" });
      if (!res.ok) reasons.push(`Manifest not reachable (HTTP ${res.status})`);
      else {
        const manifest = await res.json();
        if (!manifest.name && !manifest.short_name) reasons.push("Manifest missing name/short_name");
        if (!manifest.start_url) reasons.push("Manifest missing start_url");
        if (!manifest.display) reasons.push("Manifest missing display");
        if (!Array.isArray(manifest.icons) || !manifest.icons.length) {
          reasons.push("Manifest has no icons");
        } else {
          const has192 = manifest.icons.some(i => String(i.sizes || "").includes("192"));
          const has512 = manifest.icons.some(i => String(i.sizes || "").includes("512"));
          if (!has192) reasons.push("Manifest icons missing 192x192 size");
          if (!has512) reasons.push("Manifest icons missing 512x512 size");
        }
      }
    }
  } catch (e) {
    reasons.push("Could not read manifest: " + e.message);
  }

  if (!reasons.length && !deferredInstallPrompt) {
    reasons.push("Chrome may have suppressed the prompt (previously dismissed). Try a fresh Chrome profile or clear site data.");
  }

  console.group("🔎 PWA installability check");
  if (reasons.length) {
    console.warn("Install prompt NOT available. Reasons:");
    reasons.forEach(r => console.warn("  •", r));
  } else {
    console.log("✅ PWA is installable. Waiting for beforeinstallprompt…");
  }
  console.groupEnd();

  return reasons;
}

/* ---------- Sidebar Download App button states ---------- */
function setDownloadButtonReady(ready) {
  const btn = document.getElementById("nav-download-app");
  if (!btn || btn.classList.contains("is-installed")) return;
  btn.classList.toggle("is-ready", !!ready);
}

function setDownloadButtonInstalled() {
  const btn = document.getElementById("nav-download-app");
  const label = document.getElementById("nav-download-label");
  if (btn) {
    btn.classList.remove("is-ready");
    btn.classList.add("is-installed");
    btn.disabled = true;
    btn.title = "App installed";
  }
  if (label) label.textContent = "App Installed ✓";
}

/* ---------- Show the correct instruction block ---------- */
function applyPlatformInstructions() {
  const platform = detectInstallPlatform();
  document.querySelectorAll(".install-guide").forEach(el => {
    el.classList.toggle("is-active", el.dataset.platform === platform);
  });

  const wrap = document.querySelector(".install-instructions");
  if (!wrap) return;
  let diag = document.getElementById("install-diagnostic");
  if (!diag) {
    diag = document.createElement("div");
    diag.id = "install-diagnostic";
    diag.className = "install-diagnostic";
    wrap.appendChild(diag);
  }
  diag.innerHTML = `<p style="margin:0 0 6px;"><strong>🔎 Why isn't the install prompt showing?</strong></p>
    <p style="margin:0;font-size:0.78rem;color:var(--text-secondary);">Open DevTools → Console to see the detailed check.</p>`;

  diagnoseInstallability().then(reasons => {
    if (!reasons.length) {
      diag.innerHTML = `<p style="margin:0;color:#10B981;"><strong>✅ Ready to install.</strong> Chrome should offer the install prompt shortly.</p>`;
    } else {
      diag.innerHTML = `<p style="margin:0 0 6px;"><strong>🔎 Install prompt is unavailable because:</strong></p>
        <ul style="margin:0;padding-left:18px;font-size:0.78rem;line-height:1.5;">
          ${reasons.map(r => `<li>${r}</li>`).join("")}
        </ul>`;
    }
  });
}

function openInstallInstructions() {
  const modal = $("install-modal");
  if (!modal) return false;

  const nativeWrap = $("install-native-wrap");
  if (nativeWrap) nativeWrap.classList.toggle("hidden", !deferredInstallPrompt);

  applyPlatformInstructions();

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  return true;
}

/* ---------- Unified install flow ---------- */
async function runInstallFlow() {
  if (deferredInstallPrompt) {
    try {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === "accepted") showToast("Installing Kurt POS… 📲");
      else showToast("Install dismissed");
    } catch (e) {
      console.warn("[install] prompt failed:", e);
    } finally {
      deferredInstallPrompt = null;
      setDownloadButtonReady(false);
      $("install-btn")?.classList.add("hidden");
      $("install-banner")?.classList.add("hidden");
    }
    return;
  }

  if (isRunningStandalone()) {
    showToast("Kurt POS is already installed ✓");
    setDownloadButtonInstalled();
    return;
  }

  if (openInstallInstructions()) return;

  showToast('Open browser menu → "Install app" or "Add to Home Screen" 📲');
}

/* ---------- Wiring — ONE instance only ---------- */
function wireInstallPrompt() {
  if (isRunningStandalone()) {
    setDownloadButtonInstalled();
    $("install-btn")?.classList.add("hidden");
    $("install-banner")?.classList.add("hidden");
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    $("install-btn")?.classList.remove("hidden");
    setDownloadButtonReady(true);
    console.log("✅ beforeinstallprompt fired — install is available");
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    setDownloadButtonReady(false);
    setDownloadButtonInstalled();
    $("install-btn")?.classList.add("hidden");
    $("install-banner")?.classList.add("hidden");
    document.body.style.overflow = "";
    showToast("Kurt POS installed 🎉");
  });

  $("install-btn")?.addEventListener("click", runInstallFlow);
  $("install-banner-btn")?.addEventListener("click", runInstallFlow);
  document.getElementById("nav-download-app")?.addEventListener("click", runInstallFlow);

  $("install-native-btn")?.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      showToast("Native install prompt isn't available yet ⚠️");
      diagnoseInstallability();
      return;
    }
    try {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === "accepted") showToast("Installing Kurt POS… 📲");
    } catch (e) {
      console.warn("[install] modal prompt failed:", e);
    } finally {
      deferredInstallPrompt = null;
      setDownloadButtonReady(false);
      $("install-modal")?.classList.add("hidden");
      document.body.style.overflow = "";
    }
  });

  setTimeout(() => {
    if (!deferredInstallPrompt && !isRunningStandalone()) {
      diagnoseInstallability();
    }
  }, 3000);
}
  
/* =========================================================
   STARTUP SIDE EFFECTS
   ========================================================= */
buildAuthBackground("auth-bg-slides");
buildAuthBackground("pending-bg-slides");

requestAnimationFrame(() => {
  startAuthBgCarousel("auth-bg-slides");
});

startTextCarousel(".subtitle-carousel", ".carousel-text", 3000);
startTextCarousel(".brand-tagline-carousel", ".brand-tagline", 3000);

/* ---------- Chart.js readiness ---------- */
(function waitForChartJs() {
  if (typeof Chart !== "undefined") { state.chartJsReady = true; safeRender(renderCharts); return; }
  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    if (typeof Chart !== "undefined") { clearInterval(iv); state.chartJsReady = true; safeRender(renderCharts); }
    else if (tries > 80) { clearInterval(iv); console.warn("[Charts] Chart.js failed to load"); }
  }, 150);
})();

/* =========================================================
   THEME — syncs the toggle pill state
   ========================================================= */
function syncThemeToggleUI() {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const themeToggle = $("theme-toggle");
  const icon = $("theme-icon");
  if (icon) icon.textContent = dark ? "🌙" : "☀️";
  themeToggle?.setAttribute("aria-checked", dark ? "true" : "false");
}

(function initTheme() {
  // Priority: saved user preference → HTML attribute → "dark" (app default)
  const stored = (() => {
    try { return localStorage.getItem("theme"); } catch { return null; }
  })();
  const attr  = document.documentElement.getAttribute("data-theme");
  const theme = stored || attr || "dark";

  applyTheme(theme);
  syncThemeToggleUI();

  $("theme-toggle")?.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    destroyCharts();
    applyTheme(cur === "dark" ? "light" : "dark");
    syncThemeToggleUI();
    setTimeout(() => safeRender(renderCharts), 200);
  });
})();

/* =========================================================
   SOUND — syncs the toggle pill state
   ========================================================= */
function syncSoundToggleUI() {
  const soundToggle = $("sound-toggle");
  const icon = $("sound-icon");
  if (icon) icon.textContent = state.soundEnabled ? "🔊" : "🔇";
  soundToggle?.setAttribute("aria-checked", state.soundEnabled ? "true" : "false");
}

(function initSound() {
  syncSoundToggleUI();

  $("sound-toggle")?.addEventListener("click", () => {
    state.soundEnabled = !state.soundEnabled;
    try { localStorage.setItem("soundEnabled", state.soundEnabled); } catch {}
    syncSoundToggleUI();
  });
})();

/* =========================================================
   NAV
   ========================================================= */
function wireNav() {
  const navButtons = document.querySelectorAll(".nav-btn");
  const pages = document.querySelectorAll(".page");
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
        safeRender(populateMonthFilter);
        safeRender(populateSalesCategoryFilter);
        safeRender(renderSalesOverview);
        safeRender(renderKPIs);
        safeRender(renderTopProfitAndRevenue);
        safeRender(renderCharts);
      }
      if (btn.dataset.page === "page-sales") {
        safeRender(renderPosProducts);
        safeRender(renderPosCart);
        safeRender(updateChange);
        safeRender(renderSalesCategorySummary);
        safeRender(renderCustomerPickerOptions);
        safeRender(togglePaymentMode);
        startPosMiniCarousels();
      }
      if (btn.dataset.page === "page-history") {
        safeRender(renderHistory);
        safeRender(renderHistoryCategorySummary);
      }
      if (btn.dataset.page === "page-add") {
        safeRender(autoFillSku);
        safeRender(populateCategoryOptions);
        safeRender(renderInventoryAnalytics); // 👈 Render analytics when opening Add Item
      }
      if (btn.dataset.page === "page-categories") {
        safeRender(renderCategories);
      }
      if (btn.dataset.page === "page-customers") {
        safeRender(renderCustomerPickerOptions);
      }
      if (btn.dataset.page === "page-labels") {
        safeRender(renderLabelsPage);
      }
      if (btn.dataset.page === "page-gcash") {
        safeRender(renderGcashPage);
      }
      if (btn.dataset.page === "page-maya") {
        safeRender(renderMayaPage);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

/* =========================================================
   MOBILE NAV DRAWER
   ========================================================= */
function wireMobileNav() {
  const toggle = $("nav-toggle");
  const nav = document.querySelector(".bottom-nav");
  const backdrop = $("nav-backdrop");
  if (!toggle || !nav) return;

  const isMobile = () => window.matchMedia("(max-width: 899px)").matches;
  const isOpen = () => nav.classList.contains("open");

  const openDrawer = () => {
    nav.classList.add("open");
    toggle.classList.add("open");
    backdrop?.classList.add("open");
    toggle.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
  };

  const closeDrawer = () => {
    nav.classList.remove("open");
    toggle.classList.remove("open");
    backdrop?.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
  };

  window.closeMobileNav = closeDrawer;

  toggle.addEventListener("click", () => {
    isOpen() ? closeDrawer() : openDrawer();
  });

  backdrop?.addEventListener("click", closeDrawer);

  nav.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (isMobile()) closeDrawer();
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) closeDrawer();
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!isMobile() && isOpen()) closeDrawer();
    }, 150);
  });
}

/* =========================================================
   DASHBOARD REFRESH
   ========================================================= */
function wireDashboardRefresh() {
  const btn = $("dash-refresh-btn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    const icon = btn.querySelector(".dash-refresh-icon");
    if (icon) {
      icon.style.transition = "transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)";
      icon.style.transform = "rotate(360deg)";
      setTimeout(() => { icon.style.transform = ""; }, 650);
    }
    btn.classList.add("is-refreshing");
    btn.disabled = true;

    safeRender(renderInventory);
    safeRender(renderDashboardInventory);
    safeRender(renderLowStockAlerts);
    safeRender(renderExpiring);
    safeRender(renderMovements);
    safeRender(renderCategories);
    safeRender(populateCategoryOptions);
    safeRender(updateStats);
    safeRender(populateMonthFilter);
    safeRender(populateSalesCategoryFilter);
    safeRender(renderSalesOverview);
    safeRender(renderKPIs);
    safeRender(renderTopProfitAndRevenue);
    safeRender(renderFastMoving);
    safeRender(renderSlowMoving);
    safeRender(renderCarousel);
    safeRender(renderSales);
    safeRender(renderPosProducts);
    safeRender(renderPosCart);
    safeRender(renderCustomerPickerOptions);
    safeRender(renderCharts);
    safeRender(renderInventoryAnalytics); // 👈 Add to refresh

    showToast("Dashboard refreshed ✅");

    setTimeout(() => {
      btn.classList.remove("is-refreshing");
      btn.disabled = false;
    }, 700);
  });
}

/* =========================================================
   LISTENERS
   ========================================================= */
function startAllListeners() {
  const onAfter = () => {
    safeRender(updateStats);
    safeRender(populateMonthFilter);
    safeRender(populateSalesCategoryFilter);
    safeRender(populateCategoryOptions);
    safeRender(renderSalesOverview);
    safeRender(renderKPIs);
    safeRender(renderTopProfitAndRevenue);
    safeRender(renderFastMoving);
    safeRender(renderSlowMoving);
    safeRender(renderCarousel);
    safeRender(renderPosProducts);
    safeRender(renderCustomerPickerOptions);
    safeRender(renderCharts);
    safeRender(renderInventoryAnalytics); // 👈 Ensure it refreshes on data change
  };
  startInventoryListeners(onAfter);
  startSalesListener(onAfter);
  startCustomersListeners(onAfter);
  startGcashListeners(onAfter);
  startMayaListeners(onAfter);
}

function stopAllListeners() {
  Object.values(state.unsubscribers).forEach(u => { try { u && u(); } catch {} });
  Object.keys(state.unsubscribers).forEach(k => delete state.unsubscribers[k]);
  destroyCharts();
  stopCarousel();
  stopPosMiniCarousels();
}

/* ---------- Super Admin users listener ---------- */
function startUserAdminListener() {
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js").then(async ({ collection, onSnapshot, query }) => {
    const { db } = await import("./firebase.js");
    state.unsubscribers.users = onSnapshot(query(collection(db, "users")), (snap) => {
      state.allUsers = snap.docs
        .map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
        .sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
      safeRender(renderAdminUsers);
    });
  });
}

function renderAdminUsers() {
  const pendingList = $("pending-users-list"), allList = $("all-users-list");
  if (!pendingList || !allList) return;
  const pending = state.allUsers.filter(u => !u.approved);
  pendingList.innerHTML = pending.length ? pending.map(userRowHTML).join("") : `<div class="empty-state"><p>✅ No pending approvals.</p></div>`;
  allList.innerHTML = state.allUsers.length ? state.allUsers.map(userRowHTML).join("") : `<div class="empty-state"><p>No users yet.</p></div>`;
}
function userRowHTML(u) {
  const isSuper = u.role === "superadmin";
  const email = u.email ? String(u.email).replace(/[<>&"']/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c])) : "";
  return `
    <div class="user-row ${u.approved ? "approved" : "pending"}">
      <div class="user-info">
        <div class="user-mail">${email}${isSuper ? ` <span class="role-badge super">SUPER ADMIN</span>` : ""}</div>
        <div class="user-meta">Workspace: <code>${(u.workspaceId || "").slice(0, 8)}…</code> · ${u.approved ? "Approved" : "Pending"}</div>
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
  if (!state.currentUserData || state.currentUserData.role !== "superadmin") return;
  const { doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  const { db } = await import("./firebase.js");
  try { await updateDoc(doc(db, "users", userId), { approved }); showToast(approved ? "User approved ✅" : "Approval revoked"); }
  catch (err) { showToast(`Failed: ${err.code || err.message} ❌`); }
};
window.deleteUser = async (userId) => {
  if (!state.currentUserData || state.currentUserData.role !== "superadmin") return;
  if (!confirm("Delete this user profile?")) return;
  const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  const { db } = await import("./firebase.js");
  try { await deleteDoc(doc(db, "users", userId)); showToast("User deleted 🗑️"); }
  catch (err) { showToast(`Failed: ${err.code || err.message} ❌`); }
};

/* ---------- Online / Offline ---------- */
function wireOnlineOffline() {
  const banner = $("offline-banner");
  const update = () => {
    const online = navigator.onLine;
    banner?.classList.toggle("hidden", online);
    document.documentElement.classList.toggle("is-offline", !online);
  };
  window.addEventListener("online", () => { update(); showToast("Back online ✅ — syncing…"); });
  window.addEventListener("offline", () => { update(); showToast("Offline mode 📡 — changes will sync later"); });
  update();
}

/* ---------- Keyboard shortcuts ---------- */
function wireKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    if (e.key === "/") {
      e.preventDefault();
      const s = $("search-input") || $("dash-search") || $("sales-search");
      s?.focus();
    }
  });
}

/* ---------- Service worker ---------- */
function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { scope: "./" })
      .then(reg => {
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing; if (!nw) return;
          nw.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller) {
              showToast("New version ready — refresh to update 🔄");
            }
          });
        });
      })
      .catch(err => console.warn("[SW] registration failed:", err));
  });
}

/* ---------- Auth handlers ---------- */
function onLoggedOut() {
  stopAllListeners();
  stopAuthBgCarousel();
  startAuthBgCarousel("auth-bg-slides");
  forceCloseScanner();
  stopGreetingTicker();
  stopAutoSyncTicker();
  stopthemeRotationTicker();
  updateTopbarAvatar();
}

function onPending() {
  stopAllListeners();
  stopAuthBgCarousel();
  startAuthBgCarousel("pending-bg-slides");
  stopGreetingTicker();
  stopAutoSyncTicker();
}

function onApproved(userData) {
  startAllListeners();
  startGreetingTicker();
  syncThemeToggleUI();
  syncSoundToggleUI();

  updateAutoSyncUI();
  setTimeout(() => {
    autoSyncFromFile({ silent: true });
  }, 2500);
  startAutoSyncTicker();
  if (userData.role === "superadmin" && !state.unsubscribers.users) {
    startUserAdminListener();
  }
  setTimeout(() => {
    safeRender(renderInventory);
    safeRender(renderDashboardInventory);
    safeRender(renderLowStockAlerts);
    safeRender(renderExpiring);
    safeRender(renderMovements);
    safeRender(renderCategories);
    safeRender(renderSales);
    safeRender(renderPosProducts);
    safeRender(renderPosCart);
    safeRender(renderCustomerPickerOptions);
    safeRender(populateCategoryOptions);
    safeRender(updateStats);
    safeRender(populateMonthFilter);
    safeRender(populateSalesCategoryFilter);
    safeRender(renderSalesOverview);
    safeRender(renderKPIs);
    safeRender(renderTopProfitAndRevenue);
    safeRender(renderFastMoving);
    safeRender(renderSlowMoving);
    safeRender(renderCarousel);
    safeRender(renderHistory);
    safeRender(renderHistoryCategorySummary);
    safeRender(renderSalesCategorySummary);
    safeRender(renderCharts);
    safeRender(renderInventoryAnalytics); // 👈 Initial render
  }, 200);
}

/* =========================================================
   MODAL CLOSE HANDLING (event delegation — bulletproof)
   ========================================================= */
function wireAllModals() {
  const MODAL_MAP = {
    "restock-modal":          { cleanup: () => { state.restockItemId = null; } },
    "receipt-modal":          { cleanup: () => { state.currentReceiptGroup = null; } },
    "movement-modal":         { cleanup: () => { state.currentMovementId = null; } },
    "cat-image-modal":        { cleanup: () => { state.catImageCategoryId = null; } },
    "payment-modal":          { cleanup: () => { state.currentCustomerId = null; } },
    "customer-detail-modal":  { cleanup: () => { state.currentCustomerId = null; } },
    "gcash-payment-modal":    { cleanup: () => { /* nothing */ } },
    "install-modal":          { cleanup: null },
    "scanner-modal":          { cleanup: () => {
        import("./inventory.js").then(m => m.forceCloseScanner?.()).catch(() => {});
      }
    }
  };

  const BTN_TO_MODAL = {
    "restock-close":         "restock-modal",
    "close-receipt-btn":     "receipt-modal",
    "movement-close":        "movement-modal",
    "movement-close-btn":    "movement-modal",
    "cat-image-close":       "cat-image-modal",
    "customer-detail-close": "customer-detail-modal",
    "install-close":         "install-modal",
    "install-later":         "install-modal",
    "scanner-close":         "scanner-modal"
  };

  const closeModal = (modalId) => {
    const m = $(modalId);
    if (!m) return;
    m.classList.add("hidden");
    const cfg = MODAL_MAP[modalId];
    try { cfg?.cleanup?.(); } catch (e) { console.warn("[modal cleanup]", e); }
    const stillOpen = document.querySelector(
      ".modal:not(.hidden), .scanner-modal:not(.hidden), .install-modal:not(.hidden)"
    );
    if (!stillOpen) document.body.style.overflow = "";
  };

  document.addEventListener("click", (e) => {
    const closeBtn = e.target.closest(
      "#restock-close, #close-receipt-btn, #movement-close, #movement-close-btn, " +
      "#cat-image-close, #customer-detail-close, #install-close, #install-later, #scanner-close, " +
      "#install-banner-close, [data-close-modal]"
    );
    if (closeBtn) {
      e.preventDefault();
      e.stopPropagation();

      if (closeBtn.id === "install-later") {
        try { localStorage.setItem("installDismissed", "1"); } catch {}
        $("install-banner")?.classList.add("hidden");
      }
      if (closeBtn.id === "install-banner-close") {
        $("install-banner")?.classList.add("hidden");
        try { localStorage.setItem("installDismissed", "1"); } catch {}
        return;
      }

      const explicit = closeBtn.getAttribute("data-close-modal");
      const modalId = explicit || BTN_TO_MODAL[closeBtn.id];
      if (modalId) closeModal(modalId);
      return;
    }

    const openModal = e.target.closest(
      ".modal, .scanner-modal, .install-modal"
    );
    if (openModal && e.target === openModal) {
      const mid = openModal.id;
      if (MODAL_MAP[mid]) closeModal(mid);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const order = [
      "install-modal",
      "cat-image-modal",
      "customer-detail-modal",
      "payment-modal",
      "gcash-payment-modal",
      "movement-modal",
      "receipt-modal",
      "restock-modal",
      "scanner-modal"
    ];
    for (const mid of order) {
      const m = $(mid);
      if (m && !m.classList.contains("hidden")) {
        closeModal(mid);
        return;
      }
    }
  });
}

/* =========================================================
   SAFETY — reset any stuck state on load
   ========================================================= */
window.addEventListener("load", () => {
  document.querySelector(".bottom-nav")?.classList.remove("open");
  document.querySelector(".nav-toggle")?.classList.remove("open");
  document.getElementById("nav-backdrop")?.classList.remove("open");
  document.body.style.overflow = "";
  syncThemeToggleUI();
  syncSoundToggleUI();
});

/* =========================================================
   BOOT
   ========================================================= */
function boot() {
  loadThemePalette();
  startThemeRotationTicker();
  initAuthUI();
  initInventory();
  initPOS();
  initReports();
  initCustomers();
  initLabels();
  initGcash();
  initMaya();
  wireNav();
  wireMobileNav();
  wireDashboardRefresh();
  wireInstallPrompt();
  wireAllModals();
  wireOnlineOffline();
  wireKeyboard();
  registerSW();
  initAuthHandlers({
    onLoggedOut,
    onPending,
    onApproved,
    onTeardown: () => {
      stopAllListeners();
      forceCloseScanner();
      stopGreetingTicker();
      stopAutoSyncTicker();
      stopThemeRotationTicker();
    }
  });
}
boot();