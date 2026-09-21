/* app.js — Main entry: wires everything together */
import { state, CONSTANTS } from "./state.js";
import { $, safeRender, showToast, applyTheme, playSuccessSound } from "./utils.js";
import { initAuthUI, initAuthHandlers, buildAuthBackground, startAuthBgCarousel, stopAuthBgCarousel, startTextCarousel } from "./auth.js";
import {
  initInventory, startInventoryListeners, renderInventory, renderDashboardInventory,
  renderLowStockAlerts, renderExpiring, renderMovements, renderCategories, autoFillSku,
  forceCloseScanner
} from "./inventory.js";
import {
  initPOS, startSalesListener, renderPosProducts, renderPosCart, renderSales,
  updateChange, startPosMiniCarousels, stopPosMiniCarousels
} from "./pos.js";
import {
  initReports, updateStats, renderCharts, destroyCharts, renderSalesOverview,
  populateMonthFilter, renderHistory, renderHistoryCategorySummary,
  renderSalesCategorySummary, renderFastMoving, renderSlowMoving, renderCarousel,
  renderKPIs, renderTopProfitAndRevenue, stopCarousel,
  exportInventoryToExcel, exportInventoryToPDF
} from "./reports.js";

/* ---------- Startup side effects ---------- */
buildAuthBackground("auth-bg-slides");
buildAuthBackground("pending-bg-slides");

// Start the background slideshow right away (don't wait for auth state).
// If the auth screen is visible, the rotation begins immediately.
requestAnimationFrame(() => {
  startAuthBgCarousel("auth-bg-slides");
});

// Text carousels inside the auth card + topbar tagline.
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

/* ---------- Theme ---------- */
(function initTheme() {
  const saved = document.documentElement.getAttribute("data-theme") ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(saved);
  $("theme-toggle")?.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "light";
    destroyCharts();
    applyTheme(cur === "dark" ? "light" : "dark");
    setTimeout(() => safeRender(renderCharts), 200);
  });
})();

/* ---------- Sound ---------- */
(function initSound() {
  const updateIcon = () => { const el = $("sound-icon"); if (el) el.textContent = state.soundEnabled ? "🔊" : "🔇"; };
  updateIcon();
  $("sound-toggle")?.addEventListener("click", () => {
    state.soundEnabled = !state.soundEnabled;
    localStorage.setItem("soundEnabled", state.soundEnabled);
    updateIcon();
  });
})();

/* ---------- Nav ---------- */
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
        startPosMiniCarousels();
      }
      if (btn.dataset.page === "page-history") {
        safeRender(renderHistory);
        safeRender(renderHistoryCategorySummary);
      }
      if (btn.dataset.page === "page-add") {
        safeRender(autoFillSku);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

/* ---------- Listeners ---------- */
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
    safeRender(renderCharts);
  };
  startInventoryListeners(onAfter);
  startSalesListener(onAfter);
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

/* ---------- Auth handlers (called by auth.js) ---------- */
function onLoggedOut() {
  stopAllListeners();
  stopAuthBgCarousel();
  startAuthBgCarousel("auth-bg-slides"); // <-- ADD THIS LINE
  forceCloseScanner();
}

function onPending() {
  stopAllListeners();
  stopAuthBgCarousel();
  startAuthBgCarousel("pending-bg-slides"); // <-- ADD THIS LINE
}

function onApproved(userData) {
  startAllListeners();
  if (userData.role === "superadmin" && !state.unsubscribers.users) {
    startUserAdminListener();
  }
  // Initial renders once shell is visible
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
    "restock-modal":         { cleanup: () => { state.restockItemId = null; } },
    "receipt-modal":         { cleanup: () => { state.currentReceiptGroup = null; } },
    "movement-modal":        { cleanup: () => { state.currentMovementId = null; } },
    "cat-image-modal":       { cleanup: () => { state.catImageCategoryId = null; } },
    "install-modal":         { cleanup: null },
    "scanner-modal":         { cleanup: () => {
        import("./inventory.js").then(m => m.forceCloseScanner?.()).catch(() => {});
      }
    }
  };

  // Map close-button IDs -> modal IDs
  const BTN_TO_MODAL = {
    "restock-close":      "restock-modal",
    "close-receipt-btn":  "receipt-modal",
    "movement-close":     "movement-modal",
    "movement-close-btn": "movement-modal",
    "cat-image-close":    "cat-image-modal",
    "install-close":      "install-modal",
    "install-later":      "install-modal",
    "scanner-close":      "scanner-modal"
  };

  const closeModal = (modalId) => {
    const m = $(modalId);
    if (!m) return;
    m.classList.add("hidden");
    const cfg = MODAL_MAP[modalId];
    try { cfg?.cleanup?.(); } catch (e) { console.warn("[modal cleanup]", e); }
    // Restore scroll only if no modal remains open
    const stillOpen = document.querySelector(
      ".modal:not(.hidden), .scanner-modal:not(.hidden), .install-modal:not(.hidden)"
    );
    if (!stillOpen) document.body.style.overflow = "";
  };

  /* ---------- 1) Global click delegation ----------
     Catches clicks on any close button — even ones
     created or re-rendered later. */
  document.addEventListener("click", (e) => {
    // Close button?
    const closeBtn = e.target.closest(
      "#restock-close, #close-receipt-btn, #movement-close, #movement-close-btn, " +
      "#cat-image-close, #install-close, #install-later, #scanner-close, " +
      "#install-banner-close, [data-close-modal]"
    );
    if (closeBtn) {
      e.preventDefault();
      e.stopPropagation();

      // Special-case install-later (persist dismissal)
      if (closeBtn.id === "install-later") {
        try { localStorage.setItem("installDismissed", "1"); } catch {}
        $("install-banner")?.classList.add("hidden");
      }
      // Special-case install banner close
      if (closeBtn.id === "install-banner-close") {
        $("install-banner")?.classList.add("hidden");
        try { localStorage.setItem("installDismissed", "1"); } catch {}
        return;
      }

      // Custom data-close-modal override
      const explicit = closeBtn.getAttribute("data-close-modal");
      const modalId = explicit || BTN_TO_MODAL[closeBtn.id];
      if (modalId) closeModal(modalId);
      return;
    }

    // Backdrop click?
    const openModal = e.target.closest(
      ".modal, .scanner-modal, .install-modal"
    );
    if (openModal && e.target === openModal) {
      const mid = openModal.id;
      if (MODAL_MAP[mid]) closeModal(mid);
    }
  });

  /* ---------- 2) ESC key ---------- */
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const order = [
      "install-modal",
      "cat-image-modal",
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
/* ---------- Boot ---------- */
function boot() {
  initAuthUI();
  initInventory();
  initPOS();
  initReports();
  wireNav();
  wireAllModals();          // <--- ADD THIS LINE
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
    }
  });
}
boot();