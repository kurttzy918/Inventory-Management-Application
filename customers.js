/* customers.js — Customer management + credit (utang) ledger */
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, query, where, writeBatch, increment
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { state, CONSTANTS } from "./state.js";
import {
  $, valOf, numOf, setVal, esc, debounce, safeRender, showToast,
  myWorkspace, settleWrite, playSuccessSound, fmtInt, fmtMoney,
  customerTxDoc
} from "./utils.js";

/* =========================================================
   CRUD
   ========================================================= */
function wireCustomerForm() {
  const form = $("customer-form");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const wsId = myWorkspace();
    if (!wsId) { showToast("Workspace not ready ❌"); return; }
    const idEl = $("customer-id");
    const wasEditing = !!(idEl && idEl.value);

    const data = {
      name: valOf($("customer-name")).trim(),
      phone: valOf($("customer-phone")).trim(),
      address: valOf($("customer-address")).trim(),
      notes: valOf($("customer-notes")).trim(),
      workspaceId: wsId,
      updatedAt: serverTimestamp()
    };
    if (!data.name) { showToast("Name is required ❌"); return; }

    try {
      if (wasEditing) {
        await updateDoc(doc(db, "customers", idEl.value), data);
        showToast("Customer updated ✅");
      } else {
        await addDoc(collection(db, "customers"), {
          ...data,
          balance: 0,
          totalPurchases: 0,
          lastPurchaseAt: null,
          createdAt: serverTimestamp()
        });
        showToast("Customer added ✅");
      }
      form.reset();
      if (idEl) idEl.value = "";
      if ($("customer-form-title")) $("customer-form-title").textContent = "Add Customer";
    } catch (err) {
      showToast(`Failed: ${err.code || err.message} ❌`);
    }
  });
}

export function editCustomer(id) {
  const c = state.customers.find(x => x.id === id);
  if (!c) return;
  setVal($("customer-id"), c.id);
  setVal($("customer-name"), c.name || "");
  setVal($("customer-phone"), c.phone || "");
  setVal($("customer-address"), c.address || "");
  setVal($("customer-notes"), c.notes || "");
  if ($("customer-form-title")) $("customer-form-title").textContent = "Edit Customer";
  document.querySelector('[data-page="page-customers"]')?.click();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
window.editCustomer = editCustomer;

export async function deleteCustomer(id) {
  const c = state.customers.find(x => x.id === id);
  if (!c) return;
  if (Number(c.balance) > 0) {
    if (!confirm(`⚠️ ${c.name} still owes ${fmtMoney(c.balance)}.\n\nDelete anyway? Their ledger will be lost.`)) return;
  } else if (!confirm(`Delete customer "${c.name}"?`)) return;
  try {
    await deleteDoc(doc(db, "customers", id));
    playSuccessSound();
    showToast("Customer deleted 🗑️");
  } catch (err) { showToast(`Failed: ${err.code || err.message} ❌`); }
}
window.deleteCustomer = deleteCustomer;

/* =========================================================
   PAYMENT
   ========================================================= */
export function recordPayment(customerId) {
  const c = state.customers.find(x => x.id === customerId);
  if (!c) { showToast("Customer not found ❌"); return; }
  if (Number(c.balance) <= 0) { showToast("No outstanding balance ✅"); return; }
  state.currentCustomerId = customerId;
  const nameEl = $("payment-customer-name");
  const balEl  = $("payment-current-balance");
  const amtEl  = $("payment-amount");
  const noteEl = $("payment-note");
  if (nameEl) nameEl.textContent = c.name;
  if (balEl)  balEl.textContent = `Outstanding: ${fmtMoney(c.balance)}`;
  if (amtEl)  amtEl.value = Number(c.balance).toFixed(2);
  if (noteEl) noteEl.value = "";
  $("payment-modal")?.classList.remove("hidden");
  setTimeout(() => amtEl?.focus(), 100);
}
window.recordPayment = recordPayment;

function wirePaymentModal() {
  const confirmBtn = $("payment-confirm");
  confirmBtn?.addEventListener("click", async () => {
    const id = state.currentCustomerId;
    if (!id) return;
    const c = state.customers.find(x => x.id === id);
    if (!c) return;
    const amount = Number(valOf($("payment-amount")));
    if (!amount || amount <= 0) { showToast("Enter a valid amount ❌"); return; }
    if (amount > Number(c.balance) + 0.001) {
      showToast("Amount exceeds balance ❌"); return;
    }

    confirmBtn.disabled = true;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "customers", id), {
        balance: increment(-amount),
        updatedAt: serverTimestamp()
      });
      batch.set(doc(collection(db, "customer_transactions")), customerTxDoc({
        customerId: id, customerName: c.name,
        type: "payment", amount,
        note: valOf($("payment-note")).trim()
      }));
      await settleWrite(batch.commit(), "Payment");
      playSuccessSound();
      showToast(`Payment recorded · ${fmtMoney(amount)} ✅`);
      $("payment-modal")?.classList.add("hidden");
      state.currentCustomerId = null;
    } catch (err) {
      showToast(`Failed: ${err.code || err.message} ❌`);
    } finally {
      confirmBtn.disabled = false;
    }
  });
}

/* =========================================================
   RENDER — list
   ========================================================= */
function renderCustomers() {
  const list = $("customers-list");
  if (!list) return;
  const term = valOf($("customers-search")).toLowerCase().trim();
  const filtered = state.customers.filter(c => {
    if (!term) return true;
    return (c.name || "").toLowerCase().includes(term)
        || (c.phone || "").toLowerCase().includes(term);
  });

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><p>👥 No customers yet — add one to start tracking utang.</p></div>`;
    return;
  }

  const sorted = [...filtered].sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0));

  list.innerHTML = sorted.map(c => {
    const balance = Number(c.balance) || 0;
    const owes = balance > 0;
    const last = c.lastPurchaseAt?.toDate?.();
    const lastTxt = last ? last.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
    const initial = (c.name || "?").charAt(0).toUpperCase();
    return `
      <div class="customer-card ${owes ? "has-balance" : ""}">
        <div class="customer-avatar">${esc(initial)}</div>
        <div class="customer-main">
          <div class="customer-name">${esc(c.name)}</div>
          <div class="customer-meta">
            ${c.phone ? `📞 ${esc(c.phone)}` : ""}
            ${c.phone && c.address ? " · " : ""}
            ${c.address ? `📍 ${esc(c.address)}` : ""}
          </div>
          <div class="customer-stats">
            <span>💵 ${fmtMoney(c.totalPurchases || 0)} purchases</span>
            <span>🕐 Last: ${lastTxt}</span>
          </div>
          ${owes ? `<div class="customer-balance">Utang: <strong>${fmtMoney(balance)}</strong></div>` : `<div class="customer-balance paid">✅ Fully paid</div>`}
        </div>
        <div class="customer-actions">
          ${owes ? `<button type="button" class="btn primary sm" onclick="recordPayment('${c.id}')">💵 Pay</button>` : ""}
          <button type="button" class="btn ghost sm" onclick="viewCustomer('${c.id}')">👁️</button>
          <button type="button" class="btn ghost sm" onclick="editCustomer('${c.id}')">✏️</button>
          <button type="button" class="btn danger sm" onclick="deleteCustomer('${c.id}')">✕</button>
        </div>
      </div>`;
  }).join("");
}

/* =========================================================
   DETAIL / LEDGER
   ========================================================= */
export function viewCustomer(id) {
  const c = state.customers.find(x => x.id === id);
  if (!c) { showToast("Customer not found ❌"); return; }
  state.currentCustomerId = id;

  const titleEl = $("customer-detail-title");
  if (titleEl) titleEl.textContent = c.name;
  const metaEl = $("customer-detail-meta");
  if (metaEl) {
    metaEl.innerHTML = `
      ${c.phone ? `<span>📞 ${esc(c.phone)}</span>` : ""}
      ${c.address ? `<span>📍 ${esc(c.address)}</span>` : ""}
      <span>💵 Total: ${fmtMoney(c.totalPurchases || 0)}</span>
      <span class="detail-balance ${Number(c.balance) > 0 ? "owes" : "paid"}">
        ${Number(c.balance) > 0 ? `Utang: ${fmtMoney(c.balance)}` : "✅ Paid"}
      </span>`;
  }

  const txns = state.customerTransactions
    .filter(t => t.customerId === id)
    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));

  const list = $("customer-detail-txns");
  if (list) {
    if (!txns.length) {
      list.innerHTML = `<div class="empty-state"><p>No transactions yet.</p></div>`;
    } else {
      let running = 0;
      const chronological = [...txns].reverse();
      const balances = {};
      chronological.forEach(t => {
        running += t.type === "purchase" ? Number(t.amount) : -Number(t.amount);
        balances[t.id] = running;
      });
      list.innerHTML = txns.map(t => {
        const isPurchase = t.type === "purchase";
        const date = t.createdAt?.toDate?.().toLocaleString() || "—";
        return `
          <div class="txn-row">
            <div class="txn-icon ${isPurchase ? "purchase" : "payment"}">
              ${isPurchase ? "🛒" : "💵"}
            </div>
            <div class="txn-main">
              <div class="txn-title">${isPurchase ? "Credit purchase" : "Payment"}${t.receiptNum ? ` · ${esc(t.receiptNum)}` : ""}</div>
              <div class="txn-meta">${esc(date)}${t.note ? " · " + esc(t.note) : ""}</div>
            </div>
            <div class="txn-amount ${isPurchase ? "out" : "in"}">
              ${isPurchase ? "+" : "−"}${fmtMoney(t.amount)}
            </div>
            <div class="txn-balance">Bal: ${fmtMoney(balances[t.id] || 0)}</div>
          </div>`;
      }).join("");
    }
  }

  $("customer-detail-modal")?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
window.viewCustomer = viewCustomer;

function closeCustomerDetail() {
  $("customer-detail-modal")?.classList.add("hidden");
  document.body.style.overflow = "";
  state.currentCustomerId = null;
}

function wireCustomerDetail() {
  $("customer-detail-close")?.addEventListener("click", closeCustomerDetail);
  $("customer-detail-modal")?.addEventListener("click", (e) => {
    if (e.target === $("customer-detail-modal")) closeCustomerDetail();
  });
  $("customer-detail-pay")?.addEventListener("click", () => {
    const id = state.currentCustomerId;
    closeCustomerDetail();
    if (id) recordPayment(id);
  });
}

/* =========================================================
   INIT + LISTENERS
   ========================================================= */
export function initCustomers() {
  wireCustomerForm();
  wirePaymentModal();
  wireCustomerDetail();
  $("customers-search")?.addEventListener("input", debounce(renderCustomers, 150));
}

export function startCustomersListeners(onAfter) {
  const wsId = myWorkspace();
  if (!wsId) return;

  state.unsubscribers.customers = onSnapshot(
    query(collection(db, "customers"), where("workspaceId", "==", wsId)),
    (snap) => {
      state.customers = snap.docs
        .map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      safeRender(renderCustomers);
      safeRender(renderCustomerPickerOptions);
      onAfter?.();
    },
    (err) => console.error("[Customers listener]", err.code, err.message)
  );

  state.unsubscribers.customerTxns = onSnapshot(
    query(collection(db, "customer_transactions"), where("workspaceId", "==", wsId)),
    (snap) => {
      state.customerTransactions = snap.docs
        .map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
        .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
        .slice(0, 300);
      if (state.currentCustomerId) safeRender(() => viewCustomer(state.currentCustomerId));
    },
    (err) => console.error("[Customer txns listener]", err.code, err.message)
  );
}

/* =========================================================
   POS INTEGRATION — customer picker
   ========================================================= */
export function renderCustomerPickerOptions() {
  const sel = $("pos-customer");
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">— Walk-in customer —</option>` +
    state.customers.map(c => {
      const owes = Number(c.balance) > 0 ? ` (utang ${fmtMoney(c.balance)})` : "";
      return `<option value="${c.id}">${esc(c.name)}${owes}</option>`;
    }).join("");
  if (cur && state.customers.some(c => c.id === cur)) sel.value = cur;
}