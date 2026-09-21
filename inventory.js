/* inventory.js — Stock, categories, movements, scanner, photo */
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, query, where, writeBatch, increment
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { state, CONSTANTS } from "./state.js";
import {
  $, valOf, numOf, setVal, esc, debounce, safeRender, showToast,
  myWorkspace, movementDoc, settleWrite, productImageHTML,
  fallbackColorFor, expiryStatus, daysUntilExpiry, printHTML,
  playSuccessSound, playErrorSound,
  fmtInt, fmtMoney
} from "./utils.js";

const { SCANNER_STATE, SCAN_BOX, SCAN_FPS, SCAN_VIDEO, SCAN_COOLDOWN_MS, CATEGORY_IMAGE_API } = CONSTANTS;

/* =========================================================
   AUTO SKU
   ========================================================= */
export function nextSku() {
  let max = 1000;
  state.inventory.forEach(item => {
    const n = parseInt(item.sku, 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return String(max + 1);
}
export function autoFillSku() {
  const itemSku = $("item-sku"), itemId = $("item-id");
  if (!itemSku) return;
  if (itemId && itemId.value) return;
  if (state.manualSku) return;
  const next = nextSku();
  if (itemSku.value !== next) { itemSku.value = next; state.skuInitialized = true; }
}

/* =========================================================
   PHOTO HANDLING
   ========================================================= */
function compressImage(file, maxSize = 420, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width, height } = img;
        if (width > height) { if (width > maxSize) { height *= maxSize / width; width = maxSize; } }
        else { if (height > maxSize) { width *= maxSize / height; height = maxSize; } }
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
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
  const photoPreview = $("photo-preview"), photoRemoveBtn = $("photo-remove-btn");
  if (!photoPreview) return;
  if (dataUrl) {
    photoPreview.classList.add("has-image");
    photoPreview.innerHTML = `<img src="${dataUrl}" alt="Preview" />`;
    photoRemoveBtn?.classList.remove("hidden");
  } else {
    photoPreview.classList.remove("has-image");
    photoPreview.innerHTML = `<span class="photo-placeholder">📷<br>Add Photo</span>`;
    photoRemoveBtn?.classList.add("hidden");
  }
}

async function handlePhotoFile(file) {
  if (!file) return;
  try {
    const dataUrl = await compressImage(file);
    setVal($("item-image-data"), dataUrl);
    showPhotoPreview(dataUrl);
    showToast("Photo ready ✅");
  } catch (err) { console.error("[photo]", err); showToast("Failed to process photo ❌"); }
}

function wirePhotoInputs() {
  const itemImage = $("item-image"), itemImageCamera = $("item-image-camera");
  const photoCameraBtn = $("photo-camera-btn"), photoPickBtn = $("photo-pick-btn");
  const photoPreview = $("photo-preview"), photoRemoveBtn = $("photo-remove-btn");

  photoCameraBtn?.addEventListener("click", () => {
    if (itemImageCamera) itemImageCamera.click(); else itemImage?.click();
  });
  itemImageCamera?.addEventListener("change", (e) => {
    handlePhotoFile(e.target.files?.[0]); e.target.value = "";
  });
  photoPickBtn?.addEventListener("click", () => itemImage?.click());
  itemImage?.addEventListener("change", (e) => {
    handlePhotoFile(e.target.files?.[0]); e.target.value = "";
  });
  photoPreview?.addEventListener("click", () => itemImage?.click());
  photoRemoveBtn?.addEventListener("click", () => {
    if (itemImage) itemImage.value = "";
    if (itemImageCamera) itemImageCamera.value = "";
    setVal($("item-image-data"), "");
    showPhotoPreview(null);
  });
}

/* =========================================================
   ITEM FORM (Add / Edit)
   ========================================================= */
function wireItemForm() {
  const itemForm = $("item-form");
  if (!itemForm) return;
  itemForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const wsId = myWorkspace();
    if (!wsId) { showToast("Workspace not ready ❌"); return; }
    const itemIdEl = $("item-id");
    const wasEditing = !!(itemIdEl && itemIdEl.value);
    const prev = wasEditing ? state.inventory.find(i => i.id === itemIdEl.value) : null;

    const data = {
      name: valOf($("item-name")).trim(),
      sku: valOf($("item-sku")).trim(),
      barcode: valOf($("item-barcode")).trim(),
      category: valOf($("item-category")).trim(),
      quantity: numOf($("item-qty")),
      cost: Number(valOf($("item-cost"))) || 0,
      price: numOf($("item-price")),
      expiry: valOf($("item-expiry")),
      threshold: Number(valOf($("item-threshold"))) || 5,
      image: valOf($("item-image-data")) || null,
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
        batch.update(doc(db, "inventory", itemIdEl.value), data);
        if (prev && data.quantity !== prev.quantity) {
          const diff = data.quantity - prev.quantity;
          batch.set(doc(collection(db, "movements")), movementDoc({
            itemId: itemIdEl.value, itemName: data.name,
            type: diff > 0 ? "in" : "out",
            quantity: Math.abs(diff), reason: "adjustment", note: "Manual edit"
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
            type: "in", quantity: data.quantity, reason: "initial", note: "Item created"
          }));
        }
        await settleWrite(batch.commit(), "Item");
        showToast("Item added ✅");
      }
      itemForm.reset();
      if (itemIdEl) itemIdEl.value = "";
      if ($("item-threshold")) $("item-threshold").value = "5";
      if ($("item-image-data")) $("item-image-data").value = "";
      if ($("item-image")) $("item-image").value = "";
      if ($("item-image-camera")) $("item-image-camera").value = "";
      showPhotoPreview(null);
      state.manualSku = false; state.skuInitialized = false;
      autoFillSku();
    } catch (err) {
      console.error("[add/update item] FAILED:", err);
      showToast(`Failed: ${err.code || err.message} ❌`);
    }
  });

  $("item-sku")?.addEventListener("input", () => {
    if (!state.skuInitialized) state.manualSku = true;
    else if ($("item-sku").value !== nextSku() && !state.manualSku) state.manualSku = true;
  });
}

export function editItem(id) {
  const item = state.inventory.find(i => i.id === id);
  if (!item) return;
  setVal($("item-id"), item.id);
  setVal($("item-name"), item.name);
  setVal($("item-sku"), item.sku);
  setVal($("item-barcode"), item.barcode || "");
  setVal($("item-category"), item.category);
  setVal($("item-qty"), item.quantity);
  setVal($("item-cost"), item.cost ?? "");
  setVal($("item-price"), item.price);
  setVal($("item-expiry"), item.expiry || "");
  setVal($("item-threshold"), item.threshold ?? 5);
  setVal($("item-image-data"), item.image || "");
  showPhotoPreview(item.image || null);
  state.manualSku = true; state.skuInitialized = true;
  document.querySelector('[data-page="page-add"]')?.click();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
window.editItem = editItem;

export async function deleteItem(id) {
  if (!confirm("Delete this item permanently?")) return;
  try { await deleteDoc(doc(db, "inventory", id)); showToast("Item deleted 🗑️"); }
  catch (err) { showToast(`Failed: ${err.code || err.message} ❌`); }
}
window.deleteItem = deleteItem;

/* =========================================================
   RESTOCK
   ========================================================= */
export function restockItem(id) {
  const item = state.inventory.find(i => i.id === id);
  if (!item) return;
  state.restockItemId = id;
  const nameEl = $("restock-item-name"), curEl = $("restock-current"), qtyEl = $("restock-qty");
  if (nameEl) nameEl.textContent = item.name;
  if (curEl) curEl.textContent = `Current stock: ${fmtInt(item.quantity)} · SKU: ${item.sku}${item.barcode ? " · Barcode: " + item.barcode : ""}`;
  if (qtyEl) qtyEl.value = 10;
  $("restock-modal")?.classList.remove("hidden");
  setTimeout(() => qtyEl?.focus(), 100);
}
window.restockItem = restockItem;

function wireRestock() {
  $("restock-close")?.addEventListener("click", () => $("restock-modal")?.classList.add("hidden"));
  $("restock-confirm")?.addEventListener("click", async () => {
    const qty = Number(valOf($("restock-qty")));
    if (!qty || qty <= 0) { showToast("Enter a valid quantity ❌"); return; }
    const item = state.inventory.find(i => i.id === state.restockItemId);
    if (!item) return;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "inventory", state.restockItemId), {
        quantity: increment(qty), updatedAt: serverTimestamp()
      });
      batch.set(doc(collection(db, "movements")), movementDoc({
        itemId: item.id, itemName: item.name,
        type: "in", quantity: qty, reason: "restock", note: ""
      }));
      await settleWrite(batch.commit(), "Restock");
      playSuccessSound();
      showToast(`Restocked +${fmtInt(qty)} ✅`);
      $("restock-modal")?.classList.add("hidden");
    } catch (err) { showToast(`Failed: ${err.code || err.message} ❌`); }
  });
}

/* =========================================================
   RENDERS — Inventory
   ========================================================= */
function stockProgress(item) {
  const t = item.threshold ?? 5;
  const capacity = Math.max(t * 3, 1);
  const percent = Math.min((item.quantity / capacity) * 100, 100);
  let level = "high";
  if (item.quantity === 0 || item.quantity <= t) level = "low";
  else if (item.quantity <= t * 2) level = "medium";
  return { percent, level };
}
export { stockProgress };

export function renderInventory() {
  const list = $("inventory-list"); if (!list) return;
  const s = valOf($("search-input")).toLowerCase();
  const f = valOf($("filter-category"));
  const filtered = state.inventory.filter(i => {
    const mS = !s || (i.name || "").toLowerCase().includes(s) || (i.sku || "").toLowerCase().includes(s) || (i.barcode || "").toLowerCase().includes(s);
    const mC = !f || i.category === f;
    return mS && mC;
  });
  if (!filtered.length) { list.innerHTML = `<div class="empty-state"><p>📭 No items found.</p></div>`; return; }
  list.innerHTML = filtered.map(item => {
    const isLow = item.quantity <= (item.threshold ?? 5);
    const { percent, level } = stockProgress(item);
    const exp = expiryStatus(item.expiry);
    const expBadge = exp.level === "expired" ? `<span class="badge expired">Expired</span>` :
                     exp.level === "expiring" ? `<span class="badge expiring">Expiring</span>` : "";
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
            <span>📦 ${fmtInt(item.quantity)}</span>
            <span>💰 ${fmtMoney(item.price)}</span>
            ${item.cost ? `<span>📉 Cost: ${fmtMoney(item.cost)}</span>` : ""}
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

export function renderDashboardInventory() {
  const container = $("dashboard-inventory"); if (!container) return;
  const term = valOf($("dash-search")).toLowerCase();
  const filtered = state.inventory.filter(i => {
    if (!term) return true;
    return (i.name || "").toLowerCase().includes(term) ||
           (i.sku || "").toLowerCase().includes(term) ||
           (i.barcode || "").toLowerCase().includes(term);
  });
  if (!filtered.length) { container.innerHTML = `<div class="empty-state"><p>📭 No items yet — add one to get started.</p></div>`; return; }
  container.innerHTML = filtered.map(item => {
    const isLow = item.quantity <= (item.threshold ?? 5);
    const { percent, level } = stockProgress(item);
    return `
      <div class="item-card ${isLow ? "low-stock" : ""}">
        ${productImageHTML(item)}
        <div class="item-body">
          <div class="item-header">
            <div><div class="item-name">${esc(item.name)}</div><div class="item-sku">SKU: ${esc(item.sku)}</div></div>
            <span class="badge ${isLow ? "low" : "ok"}">${isLow ? "Low" : "OK"}</span>
          </div>
          <div class="item-meta">
            <span>📂 ${esc(item.category)}</span>
            <span>📦 ${fmtInt(item.quantity)}</span>
            <span>💰 ${fmtMoney(item.price)}</span>
          </div>
          <div class="progress-wrap">
            <div class="progress"><div class="progress-bar ${level}" style="width:${percent}%"></div></div>
            <span class="progress-label">${percent.toFixed(0)}%</span>
          </div>
        </div>
      </div>`;
  }).join("");
}

export function renderLowStockAlerts() {
  const list = $("low-stock-list"); if (!list) return;
  const low = state.inventory.filter(i => i.quantity <= (i.threshold ?? 5));
  if (!low.length) { list.innerHTML = `<div class="empty-state"><p>✅ All items are well stocked.</p></div>`; return; }
  list.innerHTML = low.map(item => {
    const { percent, level } = stockProgress(item);
    return `
      <div class="item-card low-stock">
        ${productImageHTML(item)}
        <div class="item-body">
          <div class="item-header">
            <div><div class="item-name">${esc(item.name)}</div><div class="item-sku">SKU: ${esc(item.sku)}</div></div>
            <span class="badge low">Low</span>
          </div>
          <div class="item-meta"><span>📦 ${fmtInt(item.quantity)}</span><span>⚠️ Threshold: ${fmtInt(item.threshold ?? 5)}</span></div>
          <div class="progress-wrap">
            <div class="progress"><div class="progress-bar ${level}" style="width:${percent}%"></div></div>
            <span class="progress-label">${percent.toFixed(0)}%</span>
          </div>
          <div class="item-actions"><button type="button" class="btn primary" onclick="restockItem('${item.id}')">➕ Restock</button></div>
        </div>
      </div>`;
  }).join("");
}

export function renderExpiring() {
  const expiring = state.inventory
    .filter(i => { const e = expiryStatus(i.expiry); return e.level === "expiring" || e.level === "expired"; })
    .sort((a, b) => (daysUntilExpiry(a.expiry) ?? 999) - (daysUntilExpiry(b.expiry) ?? 999));
  const banner = $("expiry-banner"), bannerText = $("expiry-banner-text");
  if (banner && bannerText) {
    if (expiring.length) {
      const expiredCount = expiring.filter(i => expiryStatus(i.expiry).level === "expired").length;
      banner.classList.remove("hidden");
      bannerText.textContent = expiredCount
        ? `${expiredCount} item(s) already expired — ${expiring.length} total need attention.`
        : `${expiring.length} item(s) expiring within ${CONSTANTS.EXPIRY_WARNING_DAYS} days.`;
    } else banner.classList.add("hidden");
  }
  const list = $("expiring-list"); if (!list) return;
  if (!expiring.length) { list.innerHTML = `<div class="empty-state"><p>✅ No items expiring soon.</p></div>`; return; }
  list.innerHTML = expiring.map(item => {
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
          <div class="item-meta"><span>⏰ ${esc(exp.label)}</span><span>📦 ${fmtInt(item.quantity)}</span></div>
          <div class="item-actions"><button type="button" class="btn primary" onclick="restockItem('${item.id}')">➕ Restock</button></div>
        </div>
      </div>`;
  }).join("");
}

/* =========================================================
   MOVEMENTS — render + filter + search + print + view + delete
   ========================================================= */
function getFilteredMovements() {
  const term = valOf($("movement-search")).toLowerCase().trim();
  const type = valOf($("movement-filter"));
  const range = valOf($("movement-range"));

  let list = state.movements.slice();

  if (type) list = list.filter(m => m.type === type);

  if (range) {
    const now = Date.now(); const dayMs = 24 * 60 * 60 * 1000;
    let cutoff = 0;
    if (range === "today") { const t = new Date(); t.setHours(0,0,0,0); cutoff = t.getTime(); }
    else if (range === "7") cutoff = now - 7 * dayMs;
    else if (range === "30") cutoff = now - 30 * dayMs;
    list = list.filter(m => (m.createdAt?.toMillis?.() ?? 0) >= cutoff);
  }

  if (term) {
    list = list.filter(m =>
      (m.itemName || "").toLowerCase().includes(term) ||
      (m.reason || "").toLowerCase().includes(term) ||
      (m.note || "").toLowerCase().includes(term) ||
      (m.createdAt?.toDate?.().toLocaleString() || "").toLowerCase().includes(term)
    );
  }
  return list;
}

const REASON_LABEL = { initial: "Initial stock", restock: "Restock", sale: "Sale", adjustment: "Adjustment" };

export function renderMovements() {
  const list = $("movements-list"); if (!list) return;
  const filtered = getFilteredMovements();
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><p>No matching stock movements.</p></div>`;
    return;
  }
  list.innerHTML = filtered.slice(0, 60).map(m => {
  const isIn = m.type === "in";
  const date = m.createdAt?.toDate?.().toLocaleString() ?? "—";
  const reasonLabel = REASON_LABEL[m.reason] || m.reason || "";

  // Look up the item for its photo
  const item = state.inventory.find(i => i.id === m.itemId) || {
    id: m.itemId, name: m.itemName, image: null
  };

  return `
    <div class="movement-row">
      ${productImageHTML(item, "sm")}
      <div class="movement-icon ${isIn ? "in" : "out"}">${isIn ? "⬇️" : "⬆️"}</div>
      <div class="movement-main">
        <div class="movement-name">${esc(m.itemName || "—")}</div>
        <div class="movement-meta">${date} · ${esc(reasonLabel)}${m.note ? " · " + esc(m.note) : ""}</div>
      </div>
      <div class="movement-qty ${isIn ? "in" : "out"}">${isIn ? "+" : "−"}${fmtInt(m.quantity)}</div>
      <div class="movement-actions">
        <button type="button" class="sale-action-btn receipt" onclick="viewMovement('${m.id}')" title="View">👁️</button>
        <button type="button" class="sale-action-btn" onclick="printMovement('${m.id}')" title="Print">🖨️</button>
        <button type="button" class="sale-action-btn delete" onclick="deleteMovement('${m.id}')" title="Delete">🗑️</button>
      </div>
    </div>`;
}).join("");
}

export function viewMovement(id) {
  const m = state.movements.find(x => x.id === id);
  if (!m) { showToast("Movement not found ❌"); return; }
  state.currentMovementId = id;
  const isIn = m.type === "in";
  const date = m.createdAt?.toDate?.().toLocaleString() ?? "—";
  const reasonLabel = REASON_LABEL[m.reason] || m.reason || "—";
  const detail = $("movement-detail-content");
  if (detail) {
    detail.innerHTML = `
      <div class="mv-detail-row"><span class="mv-detail-label">Item</span><span class="mv-detail-value">${esc(m.itemName || "—")}</span></div>
      <div class="mv-detail-row"><span class="mv-detail-label">Type</span><span class="mv-detail-value ${isIn ? "in" : "out"}">${isIn ? "IN (+)" : "OUT (−)"}</span></div>
      <div class="mv-detail-row"><span class="mv-detail-label">Quantity</span><span class="mv-detail-value ${isIn ? "in" : "out"}">${isIn ? "+" : "−"}${fmtInt(m.quantity)}</span></div>
      <div class="mv-detail-row"><span class="mv-detail-label">Reason</span><span class="mv-detail-value">${esc(reasonLabel)}</span></div>
      <div class="mv-detail-row"><span class="mv-detail-label">Note</span><span class="mv-detail-value">${esc(m.note || "—")}</span></div>
      <div class="mv-detail-row"><span class="mv-detail-label">Date</span><span class="mv-detail-value">${esc(date)}</span></div>
      <div class="mv-detail-row"><span class="mv-detail-label">Record ID</span><span class="mv-detail-value"><code>${esc(m.id.slice(0, 12))}…</code></span></div>
    `;
  }
  $("movement-modal")?.classList.remove("hidden");
}
window.viewMovement = viewMovement;

export function printMovement(id) {
  const m = state.movements.find(x => x.id === id);
  if (!m) { showToast("Movement not found ❌"); return; }
  const isIn = m.type === "in";
  const date = m.createdAt?.toDate?.().toLocaleString() || "—";
  const reasonLabel = REASON_LABEL[m.reason] || m.reason || "—";
  printHTML(`
    <h1>Stock Movement Record</h1>
    <div class="meta">${CONSTANTS.STORE_NAME} · ${new Date().toLocaleString()}</div>
    <table>
      <tr><th style="width:180px">Item</th><td>${esc(m.itemName || "—")}</td></tr>
      <tr><th>Type</th><td>${isIn ? "IN (+)" : "OUT (−)"}</td></tr>
      <tr><th>Quantity</th><td>${isIn ? "+" : "−"}${fmtInt(m.quantity)}</td></tr>
      <tr><th>Reason</th><td>${esc(reasonLabel)}</td></tr>
      <tr><th>Note</th><td>${esc(m.note || "—")}</td></tr>
      <tr><th>Date</th><td>${esc(date)}</td></tr>
      <tr><th>Record ID</th><td>${esc(m.id)}</td></tr>
    </table>
  `, "Movement");
}
window.printMovement = printMovement;

export function printMovementsList() {
  const list = getFilteredMovements();
  if (!list.length) { showToast("No movements to print ❌"); return; }
  const rows = list.slice(0, 200).map(m => {
    const isIn = m.type === "in";
    return `<tr>
      <td>${esc(m.createdAt?.toDate?.().toLocaleString() || "—")}</td>
      <td>${esc(m.itemName || "—")}</td>
      <td>${isIn ? "IN (+)" : "OUT (−)"}</td>
      <td>${isIn ? "+" : "−"}${fmtInt(m.quantity)}</td>
      <td>${esc(REASON_LABEL[m.reason] || m.reason || "")}</td>
      <td>${esc(m.note || "")}</td>
    </tr>`;
  }).join("");
  printHTML(`
    <h1>In / Out History</h1>
    <div class="meta">${CONSTANTS.STORE_NAME} · Generated ${new Date().toLocaleString()} · ${list.length} record(s)</div>
    <table>
      <thead><tr><th>Date</th><th>Item</th><th>Type</th><th>Qty</th><th>Reason</th><th>Note</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `, "Movements");
}

export async function deleteMovement(id) {
  const m = state.movements.find(x => x.id === id);
  if (!m) { showToast("Movement not found ❌"); return; }
  const isIn = m.type === "in";
  const msg = `Delete this movement record?\n\n${m.itemName} · ${isIn ? "+" : "−"}${m.quantity} · ${m.reason || ""}\n\n⚠️ Stock quantity will NOT be reverted — this only removes the log entry.`;
  if (!confirm(msg)) return;
  try {
    await deleteDoc(doc(db, "movements", id));
    playSuccessSound();
    showToast("Movement deleted 🗑️");
  } catch (err) { showToast(`Failed: ${err.code || err.message} ❌`); }
}
window.deleteMovement = deleteMovement;

function closeMovementModal() {
  $("movement-modal")?.classList.add("hidden");
  state.currentMovementId = null;
}
function wireMovementModal() {
  $("movement-close")?.addEventListener("click", closeMovementModal);
  $("movement-close-btn")?.addEventListener("click", closeMovementModal);
  $("movement-modal")?.addEventListener("click", (e) => {
    if (e.target === $("movement-modal")) closeMovementModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("movement-modal")?.classList.contains("hidden")) closeMovementModal();
  });
  $("movement-delete-btn")?.addEventListener("click", async () => {
    if (!state.currentMovementId) return;
    const m = state.movements.find(x => x.id === state.currentMovementId);
    if (!m) { closeMovementModal(); return; }
    const isIn = m.type === "in";
    const msg = `Delete this movement record?\n\n${m.itemName} · ${isIn ? "+" : "−"}${m.quantity} · ${m.reason || ""}\n\n⚠️ Stock quantity will NOT be reverted — this only removes the log entry.`;
    if (!confirm(msg)) return;
    try {
      await deleteDoc(doc(db, "movements", m.id));
      playSuccessSound(); showToast("Movement deleted 🗑️"); closeMovementModal();
    } catch (err) { showToast(`Failed: ${err.code || err.message} ❌`); }
  });
  $("movement-print-btn")?.addEventListener("click", () => {
    if (state.currentMovementId) printMovement(state.currentMovementId);
  });
  $("movement-search")?.addEventListener("input", debounce(renderMovements, 150));
  $("movement-filter")?.addEventListener("change", renderMovements);
  $("movement-range")?.addEventListener("change", renderMovements);
  $("print-movements")?.addEventListener("click", printMovementsList);
}

/* =========================================================
   CATEGORY IMAGE API — Pexels-first with graceful fallback
   ========================================================= */
const IMG_KEYWORD_MAP = CONSTANTS.CATEGORY_IMAGE_API.keywordMap || {};
const IMG_DEFAULT_KW  = CONSTANTS.CATEGORY_IMAGE_API.keyword || "grocery product";

async function fetchWithTimeout(url, opts = {}, ms = CATEGORY_IMAGE_API.timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

/* Build a smart, specific query for each category. */
function buildCategoryImageQuery(name) {
  const clean = String(name || "").trim().toLowerCase();
  if (!clean) return IMG_DEFAULT_KW;
  // Look for a mapped keyword (e.g. "Snacks" → "snack packet")
  for (const [key, kw] of Object.entries(IMG_KEYWORD_MAP)) {
    if (clean.includes(key)) return kw;
  }
  // Fall back to "<name> <default keyword>"
  return `${name} ${IMG_DEFAULT_KW}`;
}

/* ---------- Pexels (best for product photos) ---------- */
async function fetchPexelsImages(query, perPage, apiKey) {
  if (!apiKey) throw new Error("Pexels API key missing");
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
  const res = await fetchWithTimeout(url, { headers: { Authorization: apiKey } });
  if (!res.ok) throw new Error(`Pexels HTTP ${res.status}`);
  const data = await res.json();
  return (data.photos || []).map(p => ({
    url: p.src?.large2x || p.src?.large || p.src?.original,
    thumb: p.src?.medium || p.src?.small || p.src?.tiny,
    credit: p.photographer || "Pexels",
    creditUrl: p.url,
    source: "Pexels"
  })).filter(x => x.url);
}

/* ---------- Unsplash (great fallback) ---------- */
async function fetchUnsplashImages(query, perPage, apiKey) {
  if (!apiKey) throw new Error("Unsplash access key missing");
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
  const res = await fetchWithTimeout(url, { headers: { Authorization: `Client-ID ${apiKey}` } });
  if (!res.ok) throw new Error(`Unsplash HTTP ${res.status}`);
  const data = await res.json();
  return (data.results || []).map(p => ({
    url: p.urls?.regular || p.urls?.full,
    thumb: p.urls?.small || p.urls?.thumb,
    credit: p.user?.name || "Unsplash",
    creditUrl: p.links?.html,
    source: "Unsplash"
  })).filter(x => x.url);
}

/* ---------- Openverse (no key needed) ---------- */
async function fetchOpenverseImages(query, perPage) {
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=${perPage}&mature=false`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Openverse HTTP ${res.status}`);
  const data = await res.json();
  return (data.results || []).map(r => ({
    url: r.url, thumb: r.thumbnail || r.url,
    credit: r.creator || r.source || "Openverse",
    creditUrl: r.foreign_landing_url || r.url,
    source: "Openverse"
  })).filter(x => x.url);
}

/* ---------- Wikipedia (last resort) ---------- */
async function fetchWikipediaImages(query, perPage) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&generator=search` +
    `&gsrsearch=${encodeURIComponent(query)}&gsrlimit=${perPage}&gsrnamespace=6` +
    `&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=600&format=json&origin=*`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
  const data = await res.json();
  const pages = data.query?.pages || {};
  return Object.values(pages).map(p => {
    const info = p.imageinfo?.[0]; if (!info) return null;
    const artist = (info.extmetadata?.Artist?.value || "").replace(/<[^>]*>/g, "").trim();
    return {
      url: info.thumburl || info.url, thumb: info.thumburl || info.url,
      credit: artist || "Wikipedia",
      creditUrl: info.descriptionurl || info.url, source: "Wikipedia"
    };
  }).filter(Boolean);
}

/* ---------- Provider chain (tries each in order) ---------- */
async function fetchCategoryImages(query) {
  const cfg = CONSTANTS.CATEGORY_IMAGE_API;
  const perPage = cfg.perPage || 12;
  const keys = cfg.keys || {};

  // Attempt order: user's primary provider first, then fallbacks.
  const order = [];
  const push = (p) => { if (!order.includes(p)) order.push(p); };
  push((cfg.provider || "pexels").toLowerCase());
  push("pexels");
  push("unsplash");
  push("openverse");
  push("wikipedia");

  let lastErr = null;
  for (const p of order) {
    try {
      if (p === "pexels") {
        if (!keys.pexels) { console.warn("[cat image] Pexels key empty — skipping"); continue; }
        return await fetchPexelsImages(query, perPage, keys.pexels);
      }
      if (p === "unsplash") {
        if (!keys.unsplash) { console.warn("[cat image] Unsplash key empty — skipping"); continue; }
        return await fetchUnsplashImages(query, perPage, keys.unsplash);
      }
      if (p === "openverse") return await fetchOpenverseImages(query, perPage);
      if (p === "wikipedia") return await fetchWikipediaImages(query, perPage);
    } catch (e) {
      lastErr = e;
      console.warn(`[cat image] ${p} failed →`, e.message);
    }
  }
  throw lastErr || new Error("No image provider available");
}

/* ---------- Picker UI (unchanged from before) ---------- */
function setCatImageStatus(text, isError = false) {
  const el = $("cat-image-status"); if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("error", !!isError);
}
function renderCatImageSkeletons(n = 8) {
  const grid = $("cat-image-grid"); if (!grid) return;
  grid.innerHTML = Array.from({ length: n }).map(() => `<div class="cat-pick-skel"></div>`).join("");
}
function renderCatImageResults(results, currentUrl) {
  const grid = $("cat-image-grid"); if (!grid) return;
  if (!results.length) { grid.innerHTML = ""; setCatImageStatus("No photos found. Try a different search."); return; }
  grid.innerHTML = results.map((r, i) => `
    <button type="button"
            class="cat-pick-btn ${r.url === currentUrl ? "is-current" : ""}"
            data-index="${i}" title="${esc(r.credit || "")}">
      <img src="${esc(r.thumb || r.url)}" alt="" loading="lazy"
           onerror="this.style.opacity='.25'" />
    </button>
  `).join("");
  grid.querySelectorAll(".cat-pick-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const r = results[parseInt(btn.dataset.index, 10)];
      if (r) pickCategoryImage(r);
    });
  });
  const src = $("cat-image-source");
  if (src && results[0]) src.textContent = `Photos via ${results[0].source}`;
}
async function searchCategoryImages(query) {
  if (!query) query = IMG_DEFAULT_KW;
  renderCatImageSkeletons();
  setCatImageStatus(`Searching “${query}”…`);
  try {
    const results = await fetchCategoryImages(query);
    const cat = state.categories.find(c => c.id === state.catImageCategoryId);
    renderCatImageResults(results, cat?.image);
    setCatImageStatus(`${results.length} result${results.length !== 1 ? "s" : ""} — tap a photo to use it.`);
  } catch (err) {
    console.warn("[cat image] search failed:", err);
    $("cat-image-grid").innerHTML = "";
    setCatImageStatus("Couldn't load photos. Check your key / connection, or try another search.", true);
  }
}
async function pickCategoryImage(result) {
  if (!state.catImageCategoryId) return;
  try {
    await updateDoc(doc(db, "categories", state.catImageCategoryId), {
      image: result.url, imageThumb: result.thumb || result.url,
      imageCredit: result.credit || "", imageCreditUrl: result.creditUrl || "",
      imageSource: result.source || "", imageUpdatedAt: serverTimestamp()
    });
    playSuccessSound(); showToast("Category image updated ✅");
    closeCategoryImagePicker();
  } catch (err) { showToast(`Failed: ${err.code || err.message} ❌`); }
}
async function autoAssignCategoryImage(categoryId, name) {
  if (!name) return;
  try {
    const results = await fetchCategoryImages(buildCategoryImageQuery(name));
    if (!results.length) return;
    const top = results[0];
    await updateDoc(doc(db, "categories", categoryId), {
      image: top.url, imageThumb: top.thumb || top.url,
      imageCredit: top.credit || "", imageCreditUrl: top.creditUrl || "",
      imageSource: top.source || "", imageUpdatedAt: serverTimestamp()
    });
    showToast(`Image added for “${name}” 📷`);
  } catch (e) { console.warn("[cat image] auto-assign skipped:", e.message); }
}
function openCategoryImagePicker(categoryId) {
  const cat = state.categories.find(c => c.id === categoryId);
  if (!cat) { showToast("Category not found ❌"); return; }
  state.catImageCategoryId = categoryId;
  const t = $("cat-image-title"); if (t) t.textContent = `Image for “${cat.name}”`;
  const query = buildCategoryImageQuery(cat.name);
  const q = $("cat-image-query"); if (q) q.value = query;
  $("cat-image-modal")?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  searchCategoryImages(query);
}
function closeCategoryImagePicker() {
  $("cat-image-modal")?.classList.add("hidden");
  document.body.style.overflow = "";
  state.catImageCategoryId = null;
}

/* =========================================================
   RENDER — Categories
   ========================================================= */
function categoryThumbHTML(cat) {
  const src = cat.imageThumb || cat.image;
  const letter = (cat.name || "?").charAt(0).toUpperCase();
  const bg = fallbackColorFor(cat.name);
  return `
    <div class="cat-thumb-fallback" style="background:${bg}">${letter}</div>
    ${src ? `<img class="cat-thumb-img" src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()" />` : ""}
  `;
}
export function renderCategories() {
  const grid = $("category-grid"); if (!grid) return;
  if (!state.categories.length) { grid.innerHTML = `<div class="empty-state"><p>🗂️ No categories yet.</p></div>`; return; }
  grid.innerHTML = state.categories.map(cat => {
    const count = state.inventory.filter(i => i.category === cat.name).length;
    const creditHTML = cat.imageCredit
      ? (cat.imageCreditUrl
          ? `<a class="cat-credit" href="${esc(cat.imageCreditUrl)}" target="_blank" rel="noopener">📷 ${esc(cat.imageCredit)}</a>`
          : `<span class="cat-credit">📷 ${esc(cat.imageCredit)}</span>`)
      : "";
    return `<div class="category-card">
      <button type="button" class="cat-thumb" data-cat-id="${esc(cat.id)}" title="Change image">
        ${categoryThumbHTML(cat)}
        <span class="cat-thumb-edit">✎</span>
      </button>
      <div class="cat-info">
        <div class="cat-name">${esc(cat.name)}</div>
        <div class="cat-count">${fmtInt(count)} item${count !== 1 ? "s" : ""}</div>
        ${creditHTML}
      </div>
      <div class="cat-actions">
        <button type="button" class="btn danger" onclick="deleteCategory('${cat.id}')">✕</button>
      </div>
    </div>`;
  }).join("");
  grid.querySelectorAll(".cat-thumb").forEach(btn => {
    btn.addEventListener("click", () => openCategoryImagePicker(btn.dataset.catId));
  });
}

export async function deleteCategory(id) {
  if (!confirm("Delete this category?")) return;
  try { await deleteDoc(doc(db, "categories", id)); showToast("Category deleted 🗑️"); }
  catch (err) { showToast(`Failed: ${err.code || err.message} ❌`); }
}
window.deleteCategory = deleteCategory;

/* =========================================================
   CATEGORY CRUD
   ========================================================= */
function wireCategoryForm() {
  const form = $("category-form"); if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const wsId = myWorkspace();
    if (!wsId) { showToast("Workspace not ready ❌"); return; }
    const name = valOf($("new-category")).trim();
    if (!name) return;
    if (state.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      showToast("Category already exists ❌"); return;
    }
    try {
      const ref = await addDoc(collection(db, "categories"), {
        name, workspaceId: wsId, createdAt: serverTimestamp()
      });
      if ($("new-category")) $("new-category").value = "";
      showToast("Category added ✅ — fetching image…");
      autoAssignCategoryImage(ref.id, name);
    } catch (err) { showToast(`Failed: ${err.code || err.message} ❌`); }
  });
}

/* =========================================================
   SCANNER
   ========================================================= */
function getScannerFormats() {
  const F = window.Html5QrcodeSupportedFormats;
  if (!F) return null;
  return [F.QR_CODE, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39].filter(v => v !== undefined && v !== null);
}
function setScannerStatus(html, type = "") {
  const el = $("scanner-status"); if (!el) return;
  el.innerHTML = html;
  el.classList.remove("success", "error");
  if (type) el.classList.add(type);
}
function checkCameraEnvironment() {
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, reason: "This browser doesn't support camera. Type the barcode below." };
  const isHttps = location.protocol === "https:";
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  const isFile  = location.protocol === "file:";
  if (!isHttps && !isLocal && !isFile) return { ok: false, reason: `Camera needs <b>HTTPS</b> or <b>localhost</b>.<br>Type the barcode below.` };
  return { ok: true };
}
function scannerErrorText(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  return `${err.name || ""} ${err.message || ""}`.trim();
}
function isPermissionError(err) { return /NotAllowed|PermissionDenied|Permission denied/i.test(scannerErrorText(err)); }
function cameraErrorMessage(err) {
  const t = scannerErrorText(err);
  if (/NotAllowed|PermissionDenied|Permission denied/i.test(t)) return "🚫 Camera permission <b>denied</b>.";
  if (/NotFound|DevicesNotFound|no camera/i.test(t)) return "📷 <b>No camera found</b>. Type the barcode below.";
  if (/NotReadable|TrackStart/i.test(t)) return "⚠️ Camera is <b>busy</b> — another app is using it.";
  if (/Overconstrained|ConstraintNotSatisfied/i.test(t)) return "⚠️ Camera settings unsupported.";
  if (/SecurityError/i.test(t)) return "🔒 Browser blocked camera. Use HTTPS or localhost.";
  return "❌ Camera error: <code>" + esc(t.slice(0, 80)) + "</code>";
}
function flashScanFrame() {
  const v = $("scanner-view"); if (!v) return;
  v.classList.add("matched");
  clearTimeout(state.scanner.matchFlashTimer);
  state.scanner.matchFlashTimer = setTimeout(() => v.classList.remove("matched"), 600);
}

export function openScanner(target) {
  const S = state.scanner;
  if (S.opening) return;
  if (S.state !== SCANNER_STATE.IDLE) return;
  const modal = $("scanner-modal");
  if (modal && !modal.classList.contains("hidden")) return;

  S.opening = true;
  S.target = target;
  S.scanHandling = false;
  const session = ++S.session;

  const title = $("scanner-title");
  if (title) title.textContent =
    target === "barcode" ? "Scan Product Barcode" :
    target === "sale"    ? "Scan Items for POS"  : "Scan Barcode";

  if ($("scanner-manual-input")) $("scanner-manual-input").value = "";
  const view = $("scanner-view");
  if (view) {
    view.style.setProperty("--scan-w", (SCAN_BOX.w * 100) + "%");
    view.style.setProperty("--scan-h", (SCAN_BOX.h * 100) + "%");
    view.classList.remove("matched");
  }
  if (modal) modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  const env = checkCameraEnvironment();
  if (!env.ok) { setScannerStatus(env.reason, "error"); setTimeout(() => $("scanner-manual-input")?.focus(), 250); S.opening = false; return; }
  if (typeof Html5Qrcode === "undefined") { setScannerStatus("Scanner library not loaded. Type the barcode below.", "error"); S.opening = false; return; }
  setScannerStatus("Starting camera…");
  requestAnimationFrame(() => { startCameraNow(session).catch(e => console.warn("[Scanner] start:", e)); });
}

async function startCameraNow(session) {
  const readerEl = document.getElementById("scanner-reader");
  const viewEl = document.getElementById("scanner-view");
  if (!readerEl) { state.scanner.opening = false; return; }
  let rect = (viewEl || readerEl).getBoundingClientRect();
  if (rect.width < 40 || rect.height < 40) {
    await new Promise(r => setTimeout(r, 200));
    if (session !== state.scanner.session) return;
    rect = (viewEl || readerEl).getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) { setScannerStatus("Scanner viewport has no size.", "error"); state.scanner.opening = false; return; }
  }
  await startScanning(readerEl, session);
}

async function startScanning(readerEl, session) {
  try { readerEl.innerHTML = ""; } catch {}
  let inst;
  try {
    const opts = { verbose: false, useBarCodeDetectorIfSupported: true };
    const formats = getScannerFormats();
    if (formats?.length) opts.formatsToSupport = formats;
    inst = new Html5Qrcode("scanner-reader", opts);
  } catch (e) { setScannerStatus("Scanner init failed.", "error"); state.scanner.opening = false; state.scanner.state = SCANNER_STATE.IDLE; return; }
  state.scanner.instance = inst;
  state.scanner.state = SCANNER_STATE.STARTING;

  const baseCfg = {
    fps: SCAN_FPS, disableFlip: true,
    qrbox: (vw, vh) => ({ width: Math.max(120, Math.floor(vw * SCAN_BOX.w)), height: Math.max(80, Math.floor(vh * SCAN_BOX.h)) })
  };
  const onDecode = (text) => onScanSuccess(text);
  const onMiss = () => {};
  const attempts = [
    () => inst.start({ facingMode: "environment" }, { ...baseCfg, videoConstraints: SCAN_VIDEO }, onDecode, onMiss),
    async () => {
      const cams = await Html5Qrcode.getCameras();
      if (!cams?.length) throw "NotFoundError: no camera";
      const cam = cams.find(c => /back|rear|environment/i.test(c.label || "")) || cams[0];
      await inst.start(cam.id, baseCfg, onDecode, onMiss);
    },
    () => inst.start({ facingMode: "user" }, baseCfg, onDecode, onMiss)
  ];
  let lastErr = null;
  for (const attempt of attempts) {
    if (session !== state.scanner.session) return;
    try {
      await attempt();
      if (session !== state.scanner.session) { try { await inst.stop(); } catch {} try { inst.clear(); } catch {} return; }
      state.scanner.state = SCANNER_STATE.RUNNING;
      state.scanner.opening = false;
      const invCount = state.inventory.length;
      const hint = invCount ? `${invCount} item${invCount !== 1 ? "s" : ""} loaded` : "⚠️ inventory still loading…";
      setScannerStatus(state.scanner.target === "sale"
        ? `Point at a barcode. Keep scanning to add more. (${hint})`
        : `Point the camera at a barcode… (${hint})`);
      return;
    } catch (err) {
      lastErr = err;
      if (isPermissionError(err)) break;
    }
  }
  if (session !== state.scanner.session) return;
  state.scanner.opening = false;
  state.scanner.state = SCANNER_STATE.IDLE;
  state.scanner.instance = null;
  setScannerStatus(cameraErrorMessage(lastErr), "error");
  setTimeout(() => $("scanner-manual-input")?.focus(), 200);
}

async function shutdownScanner() {
  const S = state.scanner;
  S.session++;
  const inst = S.instance;
  S.instance = null;
  S.state = SCANNER_STATE.STOPPING;
  const readerEl = document.getElementById("scanner-reader");
  if (inst) { try { await inst.stop(); } catch {} try { inst.clear?.(); } catch {} }
  if (readerEl) {
    try {
      readerEl.querySelectorAll("video").forEach(v => {
        try { if (v.srcObject) v.srcObject.getTracks().forEach(t => t.stop()); v.pause(); v.srcObject = null; } catch {}
      });
      readerEl.innerHTML = "";
    } catch {}
  }
  S.state = SCANNER_STATE.IDLE;
  S.opening = false;
  S.scanHandling = false;
  S.lastScanCode = "";
  S.lastScanTime = 0;
}

export function forceCloseScanner() {
  $("scanner-modal")?.classList.add("hidden");
  document.body.style.overflow = "";
  shutdownScanner().catch(() => {});
}
function closeScanner() { forceCloseScanner(); }

async function retryScanner() {
  await shutdownScanner();
  await new Promise(r => setTimeout(r, 350));
  openScanner(state.scanner.target || "sale");
}

function onScanSuccess(decodedText) {
  const S = state.scanner;
  if (S.scanHandling) return;
  const modal = $("scanner-modal");
  if (!modal || modal.classList.contains("hidden")) return;
  const code = String(decodedText || "").trim();
  if (!code) return;
  const now = Date.now();
  if (code === S.lastScanCode && (now - S.lastScanTime) < SCAN_COOLDOWN_MS) return;
  S.lastScanCode = code; S.lastScanTime = now; S.scanHandling = true;
  flashScanFrame();
  try { handleScanResult(code); }
  finally { setTimeout(() => { state.scanner.scanHandling = false; }, 350); }
}

function findItemByCode(code) {
  if (!code) return null;
  const norm = String(code).trim().replace(/\s+/g, "");
  if (!norm) return null;
  const lower = norm.toLowerCase();
  let item = state.inventory.find(i => i.barcode && String(i.barcode).trim() === norm);
  if (item) return item;
  item = state.inventory.find(i => i.barcode && String(i.barcode).trim().toLowerCase() === lower);
  if (item) return item;
  item = state.inventory.find(i => i.sku && String(i.sku).trim() === norm);
  if (item) return item;
  item = state.inventory.find(i => i.sku && String(i.sku).trim().toLowerCase() === lower);
  if (item) return item;
  return state.inventory.find(i =>
    (i.barcode && String(i.barcode).trim().toLowerCase().includes(lower)) ||
    (i.sku && String(i.sku).trim().toLowerCase().includes(lower))
  ) || null;
}

function handleScanResult(text) {
  const code = String(text || "").trim();
  if (!code) return;
  if (state.scanner.target === "barcode") {
    if ($("item-barcode")) $("item-barcode").value = code;
    playSuccessSound();
    setScannerStatus("✅ Barcode set: " + code, "success");
    setTimeout(() => forceCloseScanner(), 500);
    return;
  }
  if (state.scanner.target === "sale") {
    if (!state.inventory.length) { playErrorSound(); setScannerStatus("⚠️ Inventory still loading.", "error"); return; }
    const item = findItemByCode(code);
    if (!item) { playErrorSound(); setScannerStatus(`❌ No match for: ${code}`, "error"); return; }
    // dynamic import to avoid circular dep with pos.js
    import("./pos.js").then(mod => mod.addToCart(item.id));
    playSuccessSound();
    const cartCount = state.posCart.reduce((s, c) => s + c.qty, 0);
    setScannerStatus(`✅ Added: ${item.name} · Cart: ${cartCount} item${cartCount !== 1 ? "s" : ""}`, "success");
  }
}

function wireScanner() {
  $("scan-barcode-btn")?.addEventListener("click", () => openScanner("barcode"));
  $("scan-sale-btn")?.addEventListener("click", () => openScanner("sale"));
  $("scanner-close")?.addEventListener("click", closeScanner);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("scanner-modal")?.classList.contains("hidden")) closeScanner();
  });
  $("scanner-modal")?.addEventListener("click", (e) => { if (e.target === $("scanner-modal")) closeScanner(); });
  $("scanner-manual-btn")?.addEventListener("click", () => {
    const val = valOf($("scanner-manual-input")).trim();
    if (val) handleScanResult(val);
  });
  $("scanner-manual-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("scanner-manual-btn")?.click(); }
  });
  $("scanner-retry-btn")?.addEventListener("click", retryScanner);
  if ($("scanner-upload-btn") && $("scanner-upload-input")) {
    $("scanner-upload-btn").addEventListener("click", () => $("scanner-upload-input").click());
    $("scanner-upload-input").addEventListener("change", async (e) => {
      const file = e.target.files?.[0]; if (!file) return; e.target.value = "";
      setScannerStatus("Scanning image…");
      try {
        await shutdownScanner();
        await new Promise(r => setTimeout(r, 200));
        $("scanner-modal")?.classList.remove("hidden");
        await new Promise(r => requestAnimationFrame(r));
        const temp = new Html5Qrcode("scanner-reader", { verbose: false });
        const result = await temp.scanFile(file, true);
        try { temp.clear(); } catch {}
        handleScanResult(result);
        setTimeout(() => forceCloseScanner(), 700);
      } catch { setScannerStatus("❌ No barcode found in that image.", "error"); }
    });
  }
}

/* =========================================================
   INIT
   ========================================================= */
export function initInventory() {
  wirePhotoInputs();
  wireItemForm();
  wireRestock();
  wireMovementModal();
  wireScanner();
  wireCategoryForm();
  $("search-input")?.addEventListener("input", debounce(renderInventory, 150));
  $("filter-category")?.addEventListener("change", renderInventory);
  $("dash-search")?.addEventListener("input", debounce(renderDashboardInventory, 150));
  $("expiry-banner-btn")?.addEventListener("click", () => {
    $("expiring-list")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

/* =========================================================
   LISTENERS
   ========================================================= */
export function startInventoryListeners(onAfterInventoryChange) {
  const wsId = myWorkspace(); if (!wsId) return;

  state.unsubscribers.inventory = onSnapshot(
    query(collection(db, "inventory"), where("workspaceId", "==", wsId)),
    (snap) => {
      state.inventory = snap.docs
        .map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      safeRender(renderInventory);
      safeRender(renderLowStockAlerts);
      safeRender(renderExpiring);
      safeRender(renderDashboardInventory);
      safeRender(autoFillSku);
      onAfterInventoryChange?.();
    },
    (err) => { console.error("[Inventory listener]", err.code, err.message); showToast("Inventory sync failed ❌"); }
  );

  state.unsubscribers.categories = onSnapshot(
    query(collection(db, "categories"), where("workspaceId", "==", wsId)),
    (snap) => {
      state.categories = snap.docs
        .map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      safeRender(renderCategories);
      onAfterInventoryChange?.();
    },
    (err) => console.error("[Categories listener]", err.code, err.message)
  );

  state.unsubscribers.movements = onSnapshot(
    query(collection(db, "movements"), where("workspaceId", "==", wsId)),
    (snap) => {
      state.movements = snap.docs
        .map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
        .sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        })
        .slice(0, 200);
      safeRender(renderMovements);
    },
    (err) => console.error("[Movements listener]", err.code, err.message)
  );
}