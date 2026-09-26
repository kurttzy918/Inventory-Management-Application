/* pos.js — Point of Sale: cart, checkout, receipt */
import {
  collection, onSnapshot, doc, writeBatch, serverTimestamp, Timestamp,
  query, where, increment
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { state, CONSTANTS } from "./state.js";
import {
  $, valOf, esc, debounce, safeRender, showToast,
  myWorkspace, movementDoc, customerTxDoc, settleWrite, fmtMoney, fmtInt,
  fallbackColorFor, productImageHTML, playSuccessSound, playErrorSound, playCashSound,
  expiryStatus, getSoldMap, getFastSellingInfo
} from "./utils.js";
import { renderCustomerPickerOptions } from "./customers.js";

const { NEW_ARRIVAL_WINDOW_MS } = CONSTANTS;

/* =========================================================
   CART
   ========================================================= */
export function addToCart(itemId) {
  const item = state.inventory.find(i => i.id === itemId);
  if (!item) return;
  if (item.quantity <= 0) { playErrorSound(); showToast("Out of stock ❌"); return; }
  const existing = state.posCart.find(c => c.itemId === itemId);
  if (existing) {
    if (existing.qty + 1 > item.quantity) { playErrorSound(); showToast("Not enough stock ❌"); return; }
    existing.qty++;
    existing.stock = item.quantity;
  } else {
    state.posCart.push({ itemId, name: item.name, price: Number(item.price) || 0, qty: 1, stock: item.quantity });
  }
  renderPosCart(); updateChange();
}

function updateCartQty(itemId, delta) {
  const entry = state.posCart.find(c => c.itemId === itemId);
  if (!entry) return;
  const item = state.inventory.find(i => i.id === itemId);
  if (!item) { removeFromCart(itemId); return; }
  const next = entry.qty + delta;
  if (next <= 0) { removeFromCart(itemId); return; }
  if (next > item.quantity) { playErrorSound(); showToast("Not enough stock ❌"); return; }
  entry.qty = next; entry.stock = item.quantity;
  renderPosCart(); updateChange();
}
function removeFromCart(itemId) {
  state.posCart = state.posCart.filter(c => c.itemId !== itemId);
  renderPosCart(); updateChange();
}
function getCartTotal() { return state.posCart.reduce((s, c) => s + c.qty * c.price, 0); }
function clearCart() {
  state.posCart = [];
  if ($("pos-cash")) $("pos-cash").value = "";
  renderPosCart(); updateChange();
}

export function renderPosCart() {
  const el = $("pos-cart-items"); if (!el) return;
  if (!state.posCart.length) {
    el.innerHTML = `<div class="pos-cart-empty">Tap a product or scan a barcode to add.</div>`;
  } else {
    el.innerHTML = state.posCart.map(c => `
      <div class="pos-cart-item">
        <div class="pos-ci-main">
          <div class="pos-ci-name">${esc(c.name)}</div>
          <div class="pos-ci-meta">${fmtMoney(c.price)} × ${c.qty}</div>
        </div>
        <div class="pos-ci-qty">
          <button type="button" class="pos-qty-btn" data-act="dec" data-id="${c.itemId}">−</button>
          <span class="pos-ci-qty-num">${c.qty}</span>
          <button type="button" class="pos-qty-btn" data-act="inc" data-id="${c.itemId}">+</button>
        </div>
        <div class="pos-ci-sub">${fmtMoney(c.price * c.qty)}</div>
        <button type="button" class="pos-ci-remove" data-act="rm" data-id="${c.itemId}" title="Remove">✕</button>
      </div>
    `).join("");
  }
  if ($("pos-total")) $("pos-total").textContent = fmtMoney(getCartTotal());
}

export function updateChange() {
  const el = $("pos-change"); if (!el) return;
  const total = getCartTotal();
  const cash = Number(valOf($("pos-cash"))) || 0;
  const change = cash - total;
  if (cash === 0) { el.textContent = fmtMoney(0); el.classList.remove("insufficient"); }
  else if (change < 0) { el.textContent = "−" + fmtMoney(Math.abs(change)); el.classList.add("insufficient"); }
  else { el.textContent = fmtMoney(change); el.classList.remove("insufficient"); }
}

/* =========================================================
   PAYMENT MODE TOGGLE
   ========================================================= */
export function togglePaymentMode() {
  const mode = $("pos-payment-mode")?.value || "cash";
  const isCredit = mode === "credit";
  $("pos-cash-row")?.classList.toggle("hidden", isCredit);
  $("pos-change-row")?.classList.toggle("hidden", isCredit);
  $("pos-customer-row")?.classList.toggle("hidden", !isCredit);
  $("pos-credit-note")?.classList.toggle("hidden", !isCredit);
  if (isCredit) {
    renderCustomerPickerOptions();
    if ($("pos-cash")) $("pos-cash").value = "";
    updateChange();
  }
}
window.togglePaymentMode = togglePaymentMode;

/* =========================================================
   PRODUCT GRID
   ========================================================= */
function buildPosMiniSlides(item, sold) {
  const slides = [];
  const isLow = item.quantity > 0 && item.quantity <= (item.threshold ?? 5);
  const isOut = item.quantity === 0;
  const createdMs = item.createdAt?.toMillis?.() ?? 0;
  const isNew = createdMs && (Date.now() - createdMs) < NEW_ARRIVAL_WINDOW_MS;
  const fast = getFastSellingInfo(item.id, sold);
  const revenue = sold * (item.price || 0);
  const exp = expiryStatus(item.expiry);

  if (exp.level === "expired") slides.push({ cls: "expiry", text: `⛔ ${exp.label.toUpperCase()}` });
  else if (exp.level === "expiring") slides.push({ cls: "expiry", text: `⏰ ${exp.label.toUpperCase()}` });

  if (isNew) slides.push({ cls: "new", text: "✨ NEW ARRIVAL" });

  if (fast.isFast) slides.push({ cls: "hot", text: `🔥 FAST SELLING · ${fast.perDay.toFixed(1)}/DAY` });
  else if (sold > 0) slides.push({ cls: "hot", text: `🔥 ${fmtInt(sold)} SOLD` });

  if (isOut) slides.push({ cls: "low", text: "🚫 OUT OF STOCK" });
  else if (isLow) slides.push({ cls: "low", text: `⚠️ ONLY ${fmtInt(item.quantity)} LEFT` });

  if (revenue > 0) slides.push({ cls: "ok", text: `💰 ${fmtMoney(revenue)} SALES` });
  slides.push({ cls: "ok", text: `📦 ${fmtInt(item.quantity)} IN STOCK` });
  return slides;
}

export function renderPosProducts() {
  const grid = $("sales-products-grid"); if (!grid) return;
  const term = valOf($("sales-search")).toLowerCase().trim();
  const catFilter = valOf($("sales-cat-filter"));
  const filtered = state.inventory.filter(i => {
    if (catFilter && i.category !== catFilter) return false;
    if (!term) return true;
    return (i.name || "").toLowerCase().includes(term) ||
           (i.sku || "").toLowerCase().includes(term) ||
           (i.barcode || "").toLowerCase().includes(term);
  });
  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state"><p>📭 No products.</p></div>`;
    stopPosMiniCarousels();
    return;
  }
  const soldMap = getSoldMap();
  grid.innerHTML = filtered.map(item => {
    const isOut = item.quantity === 0;
    const isLow = item.quantity > 0 && item.quantity <= (item.threshold ?? 5);
    const sold = soldMap[item.id] || 0;
    const media = item.image
      ? `<img src="${item.image}" alt="${esc(item.name)}" loading="lazy" />`
      : `<div class="fallback" style="background:${fallbackColorFor(item.name)}">${esc((item.name || "?").charAt(0).toUpperCase())}</div>`;
    const stockPill = isOut
      ? `<span class="pos-stock-pill out">Out</span>`
      : isLow
      ? `<span class="pos-stock-pill low">${fmtInt(item.quantity)} left</span>`
      : `<span class="pos-stock-pill">${fmtInt(item.quantity)}</span>`;
    const slides = buildPosMiniSlides(item, sold);
    const slideHTML = slides.map(s => `<div class="pos-mini-slide ${s.cls}">${esc(s.text)}</div>`).join("");
    return `
      <div class="pos-card ${isOut ? "is-out" : ""}" data-id="${item.id}">
        <div class="pos-media">${media}${stockPill}</div>
        <div class="pos-info">
          <div class="pos-name" title="${esc(item.name)}">${esc(item.name)}</div>
          <div class="pos-price">${fmtMoney(item.price)}</div>
          <div class="pos-sku">${esc(item.barcode || item.sku)}</div>
        </div>
        <div class="pos-mini" data-count="${slides.length}">
          <div class="pos-mini-track">${slideHTML}</div>
        </div>
      </div>
    `;
  }).join("");
  grid.querySelectorAll(".pos-card").forEach(card => {
    card.addEventListener("click", () => addToCart(card.dataset.id));
  });
  startPosMiniCarousels();
}

export function startPosMiniCarousels() {
  stopPosMiniCarousels();
  state.posMiniIndex = 0;
  state.posMiniTimer = setInterval(() => {
    const salesPage = $("page-sales");
    if (salesPage && salesPage.classList.contains("hidden")) return;
    if (!$("scanner-modal")?.classList.contains("hidden")) return;
    state.posMiniIndex++;
    document.querySelectorAll(".pos-mini").forEach(carousel => {
      const count = parseInt(carousel.dataset.count || "1");
      if (count <= 1) return;
      const idx = state.posMiniIndex % count;
      const track = carousel.querySelector(".pos-mini-track");
      if (track) track.style.transform = `translateY(-${idx * 24}px)`;
    });
  }, 2600);
}
export function stopPosMiniCarousels() {
  if (state.posMiniTimer) { clearInterval(state.posMiniTimer); state.posMiniTimer = null; }
}

/* =========================================================
   CHECKOUT
   ========================================================= */
function newReceiptNum() {
  const d = new Date();
  const ymd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
  const sod = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()).toString(36).toUpperCase().padStart(4, "0");
  const rnd = Math.floor(Math.random() * 36).toString(36).toUpperCase();
  return `INV-${ymd}-${sod}${rnd}`;
}

async function handleCheckout() {
  if (state.checkoutBusy) return;
  if (!state.posCart.length) { showToast("Cart is empty ❌"); return; }
  const wsId = myWorkspace();
  if (!wsId) { showToast("Workspace not ready ❌"); return; }

  const lines = [];
  for (const ci of state.posCart) {
    const item = state.inventory.find(i => i.id === ci.itemId);
    if (!item) { playErrorSound(); showToast(`"${ci.name}" no longer exists ❌`); return; }
    if (ci.qty > item.quantity) { playErrorSound(); showToast(`Not enough stock for ${item.name} ❌`); return; }
    ci.price = Number(item.price) || 0;
    lines.push({ item, qty: ci.qty, price: ci.price });
  }
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);

  const mode = $("pos-payment-mode")?.value || "cash";
  const customerId = valOf($("pos-customer"));
  let cash = 0, change = 0, customer = null;

  if (mode === "cash") {
    cash = Number(valOf($("pos-cash"))) || 0;
    if (cash < total) { playErrorSound(); showToast("Insufficient cash ❌"); return; }
    change = cash - total;
  } else {
    if (!customerId) { playErrorSound(); showToast("Select a customer for utang ❌"); return; }
    customer = state.customers.find(c => c.id === customerId);
    if (!customer) { playErrorSound(); showToast("Customer not found ❌"); return; }
  }

  const receiptNum = newReceiptNum();
  const now = new Date();
  const cashier = state.currentUser?.email || "-";

  // ✅ Use ONE shared Timestamp for every write in this batch.
  // Mixing multiple `serverTimestamp()` sentinels with `increment()`
  // triggers Firestore 10.12's "Unexpected state" assertion error.
  const nowTs = Timestamp.fromDate(now);

  state.checkoutBusy = true;
  const btn = $("pos-checkout"); if (btn) btn.disabled = true;

  try {
    const batch = writeBatch(db);
    const saleIds = [];

    lines.forEach(({ item, qty, price }) => {
      const saleRef = doc(collection(db, "sales"));
      saleIds.push(saleRef.id);
      const lineTotal = qty * price;
      const isCash = mode === "cash";
      batch.set(saleRef, {
        itemId: item.id, itemName: item.name, category: item.category,
        quantity: qty, unitPrice: price, total: lineTotal,
        cost: Number(item.cost) || 0,
        profit: (price - (Number(item.cost) || 0)) * qty,
        workspaceId: wsId, receiptNum, cash, change,
        paymentMode: mode,
        customerId: customer?.id || null,
        customerName: customer?.name || null,
        // 💰 cash-basis accounting flags:
        paid: isCash,
        paidAt: isCash ? nowTs : null,
        amountPaid: isCash ? lineTotal : 0,
        unpaidAmount: isCash ? 0 : lineTotal,
        createdAt: nowTs,
        userId: state.currentUser?.uid || null
      });
      batch.update(doc(db, "inventory", item.id), {
        quantity: increment(-qty), updatedAt: nowTs
      });
      // Movement — override createdAt to the same shared timestamp
      const mov = movementDoc({
        itemId: item.id, itemName: item.name,
        type: "out", quantity: qty, reason: "sale", note: `Receipt ${receiptNum}`
      });
      mov.createdAt = nowTs;
      batch.set(doc(collection(db, "movements")), mov);
    });

    if (mode === "credit" && customer) {
      batch.update(doc(db, "customers", customer.id), {
        balance: increment(total),
        totalPurchases: increment(total),
        lastPurchaseAt: nowTs,
        updatedAt: nowTs
      });
      const cTx = customerTxDoc({
        customerId: customer.id,
        customerName: customer.name,
        type: "purchase",
        amount: total,
        receiptNum,
        saleIds,
        note: "Credit sale"
      });
      cTx.createdAt = nowTs;
      batch.set(doc(collection(db, "customer_transactions")), cTx);
    }

    await settleWrite(batch.commit(), "Sale");

    showReceipt({
      items: lines.map(l => ({ name: l.item.name, qty: l.qty, price: l.price })),
      total, cash, change, receiptNum, date: now, cashier,
      paymentMode: mode,
      customerName: customer?.name || null
    });
    playCashSound();
    clearCart();
    if ($("pos-customer")) $("pos-customer").value = "";
    if ($("pos-payment-mode")) $("pos-payment-mode").value = "cash";
    togglePaymentMode();
    showToast(mode === "credit"
      ? `Utang recorded · ${fmtMoney(total)} for ${customer.name} ✅`
      : `Sale completed · ${fmtMoney(total)} ✅`);
  } catch (err) {
    console.error("[POS sale]", err.code, err.message);
    showToast(`Failed: ${err.code || err.message} ❌`);
  } finally {
    state.checkoutBusy = false;
    if (btn) btn.disabled = false;
  }
}

/* =========================================================
   RECEIPT MODAL
   ========================================================= */
export function showReceipt(data, groupInfo) {
  const content = $("receipt-content"); if (!content) return;
  const d = data.date;
  const dateStr = d.toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const money = (n) => fmtMoney(n);
  const isCredit = data.paymentMode === "credit";

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

  content.innerHTML = `
    <div class="receipt-header">
      <div class="receipt-store">${esc(CONSTANTS.STORE_NAME.toUpperCase())}</div>
      <div class="receipt-sub">${esc(CONSTANTS.STORE_TAGLINE)}</div>
    </div>
    <div class="receipt-sep"></div>
    <div class="receipt-meta">
      <div>Date: ${esc(dateStr)}</div>
      <div>Receipt #: ${esc(data.receiptNum)}</div>
      <div>Cashier: ${esc(data.cashier || "-")}</div>
      ${isCredit ? `<div>Customer: ${esc(data.customerName || "-")}</div>` : ""}
    </div>
    <div class="receipt-sep"></div>
    <div class="receipt-items">${itemsHTML}</div>
    <div class="receipt-sep"></div>
    <div class="receipt-totals">
      <div class="rt-line big"><span>TOTAL</span><span>${money(data.total)}</span></div>
      ${isCredit
        ? `<div class="rt-line"><span>UTANG (Credit)</span><span>${money(data.total)}</span></div>`
        : `<div class="rt-line"><span>Cash</span><span>${money(data.cash)}</span></div>
           <div class="rt-line"><span>Change</span><span>${money(data.change)}</span></div>`}
    </div>
    <div class="receipt-footer">
      <strong>Thank you for your purchase!</strong>
      Please come again 🙏
    </div>
  `;
  state.currentReceiptGroup = groupInfo || null;
  const delBtn = $("delete-receipt-btn");
  if (delBtn) delBtn.classList.toggle("hidden", !state.currentReceiptGroup);
  $("receipt-modal")?.classList.remove("hidden");
}

/* =========================================================
   VIEW / DELETE SALE
   ========================================================= */
export function viewSaleReceipt(saleId) {
  const sale = state.sales.find(s => s.id === saleId);
  if (!sale) { showToast("Sale not found ❌"); return; }
  const receiptNum = sale.receiptNum;
  const lineItems = receiptNum ? state.sales.filter(s => s.receiptNum === receiptNum) : [sale];
  const items = lineItems.map(s => ({ name: s.itemName, qty: s.quantity, price: s.unitPrice || 0 }));
  const total  = lineItems.reduce((sum, s) => sum + (s.total || 0), 0);
  const cash   = sale.cash   || total;
  const change = sale.change || 0;
  const date   = sale.createdAt?.toDate?.() || new Date();
  showReceipt({
    items, total, cash, change,
    receiptNum: receiptNum || ("SALE-" + saleId.slice(0, 8).toUpperCase()),
    date, cashier: state.currentUser?.email || "-",
    paymentMode: sale.paymentMode || "cash",
    customerName: sale.customerName || null
  }, {
    receiptNum: receiptNum || ("SALE-" + saleId.slice(0, 8).toUpperCase()),
    saleIds: lineItems.map(s => s.id),
    total
  });
}
window.viewSaleReceipt = viewSaleReceipt;

function queueSaleRemoval(batch, sale, note) {
  if (sale.itemId && state.inventory.some(i => i.id === sale.itemId)) {
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

export async function deleteSale(id) {
  const sale = state.sales.find(s => s.id === id);
  if (!sale) { showToast("Sale not found ❌"); return; }
  const msg = `Delete this sale?\n\n${sale.itemName} × ${sale.quantity} — ${fmtMoney(sale.total)}\n\n⚠️ Quantity will be restored to inventory.`;
  if (!confirm(msg)) return;
  try {
    const batch = writeBatch(db);
    queueSaleRemoval(batch, sale, `Sale ${sale.receiptNum || id} deleted`);
    await settleWrite(batch.commit(), "Delete sale");
    playSuccessSound(); showToast("Sale deleted & stock restored ✅");
  } catch (err) { showToast(`Failed: ${err.code || err.message} ❌`); }
}
window.deleteSale = deleteSale;

export async function deleteReceiptGroup(saleIds, receiptNum) {
  if (!saleIds?.length) return;
  const count = saleIds.length;
  const msg = `Delete this entire receipt?\n\n${count} item${count !== 1 ? "s" : ""} will be removed.\n\n⚠️ All quantities will be restored to inventory.`;
  if (!confirm(msg)) return;
  try {
    const batch = writeBatch(db);
    saleIds.forEach(id => {
      const sale = state.sales.find(s => s.id === id);
      if (sale) queueSaleRemoval(batch, sale, `Receipt ${receiptNum || id} deleted`);
    });
    await settleWrite(batch.commit(), "Delete receipt");
    playSuccessSound();
    showToast(`Receipt deleted · ${count} item${count !== 1 ? "s" : ""} restored ✅`);
  } catch (err) { showToast(`Failed: ${err.code || err.message} ❌`); }
}

/* =========================================================
   RENDER — Recent sales list
   ========================================================= */
export function renderSales() {
  const list = $("sales-list"); if (!list) return;
  if (!state.sales.length) { list.innerHTML = `<div class="empty-state"><p>🛒 No sales recorded yet.</p></div>`; return; }
  list.innerHTML = state.sales.slice(0, 30).map(s => {
    const item = state.inventory.find(i => i.id === s.itemId) || { name: s.itemName, image: null };
    const date = s.createdAt?.toDate?.().toLocaleString() ?? "Just now";
    const wasCredit = s.paymentMode === "credit";
    const creditTag = wasCredit ? ` · <span class="sale-utang-badge">📝 Utang paid</span>` : "";
    return `
      <div class="sale-row">
        <div class="sale-info">
          ${productImageHTML(item, "sm")}
          <div class="sale-txt">
            <div class="sale-name">${esc(s.itemName)} × ${fmtInt(s.quantity)}</div>
            <div class="sale-date">${date}${s.receiptNum ? " · " + esc(s.receiptNum) : ""}${creditTag}</div>
          </div>
        </div>
        <div class="sale-total">${fmtMoney(s.total)}</div>
        <div class="sale-actions">
          <button type="button" class="sale-action-btn receipt" onclick="viewSaleReceipt('${s.id}')" title="View receipt">🧾</button>
          <button type="button" class="sale-action-btn delete" onclick="deleteSale('${s.id}')" title="Delete sale">🗑️</button>
        </div>
      </div>`;
  }).join("");
}

/* =========================================================
   INIT + LISTENERS
   ========================================================= */
export function initPOS() {
  $("pos-cart-items")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]"); if (!btn) return;
    const id = btn.dataset.id, act = btn.dataset.act;
    if (act === "inc") updateCartQty(id, 1);
    else if (act === "dec") updateCartQty(id, -1);
    else if (act === "rm") removeFromCart(id);
  });
  $("pos-cash")?.addEventListener("input", updateChange);
  $("pos-clear-btn")?.addEventListener("click", () => { clearCart(); showToast("Cart cleared 🧹"); });
  $("pos-checkout")?.addEventListener("click", handleCheckout);
  $("pos-payment-mode")?.addEventListener("change", togglePaymentMode);
  $("sales-search")?.addEventListener("input", debounce(renderPosProducts, 150));
  $("sales-cat-filter")?.addEventListener("change", renderPosProducts);
  $("print-receipt-btn")?.addEventListener("click", () => window.print());
  $("close-receipt-btn")?.addEventListener("click", () => {
    $("receipt-modal")?.classList.add("hidden");
    state.currentReceiptGroup = null;
  });
  $("delete-receipt-btn")?.addEventListener("click", () => {
    if (!state.currentReceiptGroup) return;
    const group = state.currentReceiptGroup;
    $("receipt-modal")?.classList.add("hidden");
    state.currentReceiptGroup = null;
    deleteReceiptGroup(group.saleIds, group.receiptNum);
  });
}

export function startSalesListener(onAfterSalesChange) {
  const wsId = myWorkspace(); if (!wsId) return;
  state.unsubscribers.sales = onSnapshot(
    query(collection(db, "sales"), where("workspaceId", "==", wsId)),
    (snap) => {
      const all = snap.docs
        .map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
        .sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        });

      // ✅ Cash sales + already-paid credit sales — these count as revenue
      state.sales = all
        .filter(s => s.paymentMode !== "credit" || s.paid === true)
        .slice(0, 500);

      // 🕒 Unpaid credit sales — kept separate for customer payment distribution
      state.creditSales = all
        .filter(s => s.paymentMode === "credit" && s.paid !== true);

      safeRender(renderSales);
      onAfterSalesChange?.();
    },
    (err) => console.error("[Sales listener]", err.code, err.message)
  );
}