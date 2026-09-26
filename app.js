/* app.js — Main entry: wires everything together */
import { state, CONSTANTS } from "./state.js";
import { $, safeRender, showToast, applyTheme } from "./utils.js";
import { initAuthUI, initAuthHandlers, buildAuthBackground, startAuthBgCarousel, stopAuthBgCarousel, startTextCarousel } from "./auth.js";
import {
  initInventory, startInventoryListeners, renderInventory, renderDashboardInventory,
  renderLowStockAlerts, renderExpiring, renderMovements, renderCategories, autoFillSku,
  forceCloseScanner
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
  initCustomers, startCustomersListeners, renderCustomerPickerOptions
} from "./customers.js";
import { initLabels, renderLabelsPage } from "./labels.js";
import { initGcash, startGcashListeners, renderGcashPage } from "./gcash.js";

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
  greetingTimer = setInterval(updateTopbarGreeting, 30 * 1000);
}

export function stopGreetingTicker() {
  if (greetingTimer) { clearInterval(greetingTimer); greetingTimer = null; }
}

/* =========================================================
   PWA INSTALL
   ========================================================= */
let deferredInstallPrompt = null;

function wireInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    $("install-btn")?.classList.add("hidden");
    $("install-banner")?.classList.add("hidden");
    showToast("App installed 🎉");
  });

  $("install-btn")?.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      try {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === "accepted") showToast("Installing… 📱");
      } catch (e) {
        console.warn("[install] prompt failed:", e);
      }
      deferredInstallPrompt = null;
      return;
    }
    $("install-modal")?.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  });

  $("install-banner-btn")?.addEventListener("click", () => {
    $("install-btn")?.click();
  });
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
  const saved = document.documentElement.getAttribute("data-theme") ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(saved);
  syncThemeToggleUI();

  $("theme-toggle")?.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "light";
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
   LISTENERS
   ========================================================= */
function startAllListeners() {
  const onAfter = () => {
    safeRender(updateStats);
    safeRender(populateMonthFilter);
    safeRender(renderSalesOverview);
    safeRender(renderKPIs);
    safeRender(renderTopProfitAndRevenue);
    safeRender(renderFastMoving);
    safeRender(renderSlowMoving);
    safeRender(renderCarousel);
    safeRender(renderPosProducts);
    safeRender(renderCustomerPickerOptions);
    safeRender(renderCharts);
  };
  startInventoryListeners(onAfter);
  startSalesListener(onAfter);
  startCustomersListeners(onAfter);
  startGcashListeners(onAfter);
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
}

function onPending() {
  stopAllListeners();
  stopAuthBgCarousel();
  startAuthBgCarousel("pending-bg-slides");
  stopGreetingTicker();
}

function onApproved(userData) {
  startAllListeners();
  startGreetingTicker();
  syncThemeToggleUI();
  syncSoundToggleUI();
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
    safeRender(updateStats);
    safeRender(populateMonthFilter);
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
  // Ensure pills reflect actual state after everything loads
  syncThemeToggleUI();
  syncSoundToggleUI();
});

/* =========================================================
   BOOT
   ========================================================= */
function boot() {
  initAuthUI();
  initInventory();
  initPOS();
  initReports();
  initCustomers();
  initLabels();
  initGcash();
  wireNav();
  wireMobileNav();
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
    }
  });
}
boot();