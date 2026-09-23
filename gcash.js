/* gcash.js — GCash cash-in/cash-out service tracking */
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, query, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { state, CONSTANTS } from "./state.js";
import {
  $, valOf, setVal, esc, debounce, safeRender, showToast,
  myWorkspace, playSuccessSound,
  fmtInt, fmtMoney, downloadXLSX, downloadPDF, printHTML
} from "./utils.js";

/* =========================================================
   TRANSACTION TYPES
   gcashDir: effect on STORE's GCash balance
   ========================================================= */
const GCASH_TYPES = {
  "cash-in":  { label: "Cash-In",        icon: "📥", gcashDir: "out" },
  "cash-out": { label: "Cash-Out",       icon: "📤", gcashDir: "in"  },
  "send":     { label: "Send Money",     icon: "➡️", gcashDir: "out" },
  "bills":    { label: "Bills Payment",  icon: "🧾", gcashDir: "out" },
  "load":     { label: "Load / Buy",     icon: "📱", gcashDir: "out" },
  "receive":  { label: "Received Money", icon: "💰", gcashDir: "in"  },
  "other":    { label: "Other",          icon: "💠", gcashDir: "out" }
};

const OPENING_KEY = (ws) => `gcashOpeningBalance:${ws}`;

function getOpeningBalance() {
  const ws = myWorkspace(); if (!ws) return 0;
  try { return Number(localStorage.getItem(OPENING_KEY(ws))) || 0; }
  catch { return 0; }
}
function setOpeningBalance(val) {
  const ws = myWorkspace(); if (!ws) return;
  try { localStorage.setItem(OPENING_KEY(ws), String(Number(val) || 0)); } catch {}
}

/* =========================================================
   FORM
   ========================================================= */
function populateTypeSelect() {
  const sel = $("gcash-type"); if (!sel) return;
  sel.innerHTML = Object.entries(GCASH_TYPES)
    .map(([k, v]) => `<option value="${k}">${v.icon} ${esc(v.label)}</option>`)
    .join("");
  sel.value = "cash-in";
}

function wireGcashForm() {
  const form = $("gcash-form"); if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const wsId = myWorkspace();
    if (!wsId) { showToast("Workspace not ready ❌"); return; }

    const idEl = $("gcash-id");
    const wasEditing = !!(idEl && idEl.value);

    const type = valOf($("gcash-type")) || "cash-in";
    const amount = Number(valOf($("gcash-amount")));
    const fee = Number(valOf($("gcash-fee"))) || 0;

    if (!amount || amount <= 0) { showToast("Amount must be greater than 0 ❌"); return; }
    if (fee < 0) { showToast("Fee cannot be negative ❌"); return; }

    const data = {
      workspaceId: wsId,
      type,
      amount,
      fee,
      customerName: valOf($("gcash-customer")).trim(),
      reference: valOf($("gcash-reference")).trim(),
      note: valOf($("gcash-note")).trim(),
      updatedAt: serverTimestamp()
    };

    try {
      if (wasEditing) {
        await updateDoc(doc(db, "gcash_transactions", idEl.value), data);
        showToast("Transaction updated ✅");
      } else {
        await addDoc(collection(db, "gcash_transactions"), {
          ...data,
          createdAt: serverTimestamp(),
          userId: state.currentUser?.uid || null
        });
        showToast("Transaction recorded ✅");
        playSuccessSound();
      }
      resetGcashForm();
    } catch (err) {
      showToast(`Failed: ${err.code || err.message} ❌`);
    }
  });

  $("gcash-cancel-edit")?.addEventListener("click", resetGcashForm);
}

function resetGcashForm() {
  const form = $("gcash-form"); if (!form) return;
  form.reset();
  const idEl = $("gcash-id"); if (idEl) idEl.value = "";
  if ($("gcash-type")) $("gcash-type").value = "cash-in";
  if ($("gcash-form-title")) $("gcash-form-title").textContent = "Record GCash Transaction";
  $("gcash-cancel-edit")?.classList.add("hidden");
}

export function editGcash(id) {
  const t = state.gcashTransactions.find(x => x.id === id);
  if (!t) return;
  setVal($("gcash-id"), t.id);
  setVal($("gcash-type"), t.type || "cash-in");
  setVal($("gcash-amount"), t.amount ?? "");
  setVal($("gcash-fee"), t.fee ?? "");
  setVal($("gcash-customer"), t.customerName || "");
  setVal($("gcash-reference"), t.reference || "");
  setVal($("gcash-note"), t.note || "");
  if ($("gcash-form-title")) $("gcash-form-title").textContent = "Edit GCash Transaction";
  $("gcash-cancel-edit")?.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
window.editGcash = editGcash;

export async function deleteGcash(id) {
  const t = state.gcashTransactions.find(x => x.id === id);
  if (!t) return;
  const meta = GCASH_TYPES[t.type] || GCASH_TYPES.other;
  if (!confirm(`Delete this GCash transaction?\n\n${meta.label} · ${fmtMoney(t.amount)}`)) return;
  try {
    await deleteDoc(doc(db, "gcash_transactions", id));
    showToast("Transaction deleted 🗑️");
  } catch (err) { showToast(`Failed: ${err.code || err.message} ❌`); }
}
window.deleteGcash = deleteGcash;

/* =========================================================
   SUMMARY
   ========================================================= */
function getTodayBounds() {
  const t = new Date(); t.setHours(0,0,0,0);
  const start = t.getTime();
  return { start, end: start + 24 * 60 * 60 * 1000 };
}
function getMonthStart() {
  const d = new Date(); d.setDate(1); d.setHours(0,0,0,0);
  return d.getTime();
}

function renderGcashSummary() {
  const { start, end } = getTodayBounds();
  const monthStart = getMonthStart();

  let inToday = 0, outToday = 0, feeToday = 0;
  let inCount = 0, outCount = 0;
  let feeMonth = 0, totalIn = 0, totalOut = 0;

  state.gcashTransactions.forEach(t => {
    const ms = t.createdAt?.toMillis?.() ?? 0;
    const meta = GCASH_TYPES[t.type] || GCASH_TYPES.other;
    const amt = Number(t.amount) || 0;
    const fee = Number(t.fee) || 0;

    if (meta.gcashDir === "in") totalIn += amt;
    else totalOut += amt;

    if (ms >= start && ms < end) {
      if (meta.gcashDir === "in") { inToday += amt; inCount++; }
      else { outToday += amt; outCount++; }
      feeToday += fee;
    }
    if (ms >= monthStart) feeMonth += fee;
  });

  const opening = getOpeningBalance();
  const balance = opening + totalIn - totalOut;

  const setTxt = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  setTxt("gcash-in-today", fmtMoney(inToday));
  setTxt("gcash-out-today", fmtMoney(outToday));
  setTxt("gcash-fee-today", fmtMoney(feeToday));
  setTxt("gcash-balance", fmtMoney(balance));

  const setCount = (id, n) => {
    const el = $(id);
    if (el) el.textContent = `${fmtInt(n)} transaction${n !== 1 ? "s" : ""}`;
  };
  setCount("gcash-in-count", inCount);
  setCount("gcash-out-count", outCount);
  setTxt("gcash-fee-month", `This month: ${fmtMoney(feeMonth)}`);
}

/* =========================================================
   LIST
   ========================================================= */
function getFilteredGcash() {
  const term = valOf($("gcash-search")).toLowerCase().trim();
  const typeFilter = valOf($("gcash-filter-type"));
  const range = valOf($("gcash-filter-range"));

  let list = state.gcashTransactions.slice();

  if (typeFilter) list = list.filter(t => t.type === typeFilter);

  if (range) {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    let cutoff = 0;
    if (range === "today") { const t = new Date(); t.setHours(0,0,0,0); cutoff = t.getTime(); }
    else if (range === "7") cutoff = now - 7 * dayMs;
    else if (range === "30") cutoff = now - 30 * dayMs;
    list = list.filter(t => (t.createdAt?.toMillis?.() ?? 0) >= cutoff);
  }

  if (term) {
    list = list.filter(t =>
      (t.customerName || "").toLowerCase().includes(term) ||
      (t.reference || "").toLowerCase().includes(term) ||
      (t.note || "").toLowerCase().includes(term)
    );
  }
  return list;
}

function renderGcashList() {
  const list = $("gcash-list"); if (!list) return;
  const filtered = getFilteredGcash();

  if (!filtered.length) {
        list.innerHTML = `
      <div class="empty-state">
        <img src="gcash.png" alt="" class="gcash-empty-logo" />
        <p>No GCash transactions yet — record one above.</p>
      </div>`;
    return;
  }

  list.innerHTML = filtered.slice(0, 100).map(t => {
    const meta = GCASH_TYPES[t.type] || GCASH_TYPES.other;
    const date = t.createdAt?.toDate?.().toLocaleString() || "—";
    const isIn = meta.gcashDir === "in";
    return `
      <div class="gcash-row">
        <div class="gcash-icon ${isIn ? "in" : "out"}">${meta.icon}</div>
        <div class="gcash-main">
          <div class="gcash-title">
            <strong>${esc(meta.label)}</strong>
            ${t.customerName ? `<span class="gcash-cust">· ${esc(t.customerName)}</span>` : ""}
          </div>
          <div class="gcash-meta">
            ${esc(date)}
            ${t.reference ? ` · Ref ${esc(t.reference)}` : ""}
            ${t.note ? ` · ${esc(t.note)}` : ""}
          </div>
        </div>
        <div class="gcash-amounts">
          <div class="gcash-amt ${isIn ? "in" : "out"}">${isIn ? "+" : "−"}${fmtMoney(t.amount)}</div>
          ${Number(t.fee) > 0 ? `<div class="gcash-fee">+${fmtMoney(t.fee)} fee</div>` : ""}
        </div>
        <div class="gcash-actions">
          <button type="button" class="sale-action-btn receipt" onclick="printGcash('${t.id}')" title="Print slip">🖨️</button>
          <button type="button" class="sale-action-btn" onclick="editGcash('${t.id}')" title="Edit">✏️</button>
          <button type="button" class="sale-action-btn delete" onclick="deleteGcash('${t.id}')" title="Delete">🗑️</button>
        </div>
      </div>`;
  }).join("");
}

export function renderGcashPage() {
  renderGcashSummary();
  renderGcashList();
}

/* =========================================================
   PRINT SLIP
   ========================================================= */
export function printGcash(id) {
  const t = state.gcashTransactions.find(x => x.id === id);
  if (!t) { showToast("Transaction not found ❌"); return; }
  const meta = GCASH_TYPES[t.type] || GCASH_TYPES.other;
  const date = t.createdAt?.toDate?.().toLocaleString() || "—";
  printHTML(`
    <h1>GCash Transaction</h1>
    <div class="meta">${esc(CONSTANTS.STORE_NAME)} · ${esc(date)}</div>
    <table>
      <tr><th style="width:180px">Type</th><td>${esc(meta.label)}</td></tr>
      <tr><th>Amount</th><td>${fmtMoney(t.amount)}</td></tr>
      <tr><th>Service Fee</th><td>${fmtMoney(t.fee || 0)}</td></tr>
      ${t.customerName ? `<tr><th>Customer</th><td>${esc(t.customerName)}</td></tr>` : ""}
      ${t.reference ? `<tr><th>Reference #</th><td>${esc(t.reference)}</td></tr>` : ""}
      ${t.note ? `<tr><th>Note</th><td>${esc(t.note)}</td></tr>` : ""}
    </table>
  `, "GCash");
}
window.printGcash = printGcash;

/* =========================================================
   EXPORTS
   ========================================================= */
export function exportGcashExcel() {
  const list = getFilteredGcash();
  if (!list.length) { showToast("No GCash data to export ❌"); return; }
  const rows = list.map(t => {
    const meta = GCASH_TYPES[t.type] || GCASH_TYPES.other;
    return {
      Date: t.createdAt?.toDate?.().toLocaleString() ?? "",
      Type: meta.label,
      Customer: t.customerName || "",
      Reference: t.reference || "",
      "Amount (₱)": Number((Number(t.amount) || 0).toFixed(2)),
      "Fee (₱)": Number((Number(t.fee) || 0).toFixed(2)),
      Note: t.note || ""
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "GCash");
  downloadXLSX(wb, `gcash_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast("GCash exported ✅");
}

export function exportGcashPDF() {
  const list = getFilteredGcash();
  if (!list.length) { showToast("No GCash data to export ❌"); return; }
  if (!window.jspdf) { showToast("PDF library not loaded ❌"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16); doc.text("GCash Transactions", 14, 18);
  doc.setFontSize(10); doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 24);
  doc.autoTable({
    startY: 30,
    head: [["Date", "Type", "Customer", "Ref", "Amount", "Fee"]],
    body: list.map(t => {
      const meta = GCASH_TYPES[t.type] || GCASH_TYPES.other;
      return [
        t.createdAt?.toDate?.().toLocaleString() ?? "-",
        meta.label,
        t.customerName || "-",
        t.reference || "-",
        fmtMoney(t.amount, false),
        fmtMoney(t.fee || 0, false)
      ];
    }),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [18, 84, 79] }
  });
  downloadPDF(doc, `gcash_${new Date().toISOString().slice(0,10)}.pdf`);
  showToast("GCash PDF exported ✅");
}

/* =========================================================
   OPENING BALANCE
   ========================================================= */
function promptOpeningBalance() {
  const cur = getOpeningBalance();
  const val = prompt("Set your GCash opening balance (₱):", cur || "0");
  if (val === null) return;
  const n = Number(val);
  if (isNaN(n)) { showToast("Invalid amount ❌"); return; }
  setOpeningBalance(n);
  showToast(`Opening balance set to ${fmtMoney(n)} ✅`);
  safeRender(renderGcashSummary);
}

/* =========================================================
   INIT + LISTENERS
   ========================================================= */
export function initGcash() {
  populateTypeSelect();
  wireGcashForm();

  const filterType = $("gcash-filter-type");
  if (filterType) {
    filterType.innerHTML = `<option value="">All Types</option>` +
      Object.entries(GCASH_TYPES)
        .map(([k, v]) => `<option value="${k}">${v.icon} ${esc(v.label)}</option>`)
        .join("");
  }

  $("gcash-search")?.addEventListener("input", debounce(() => safeRender(renderGcashList), 150));
  $("gcash-filter-type")?.addEventListener("change", renderGcashList);
  $("gcash-filter-range")?.addEventListener("change", renderGcashList);
  $("gcash-export-excel")?.addEventListener("click", exportGcashExcel);
  $("gcash-export-pdf")?.addEventListener("click", exportGcashPDF);
  $("gcash-set-opening")?.addEventListener("click", promptOpeningBalance);
}

export function startGcashListeners(onAfter) {
  const wsId = myWorkspace();
  if (!wsId) return;
  state.unsubscribers.gcash = onSnapshot(
    query(collection(db, "gcash_transactions"), where("workspaceId", "==", wsId)),
    (snap) => {
      state.gcashTransactions = snap.docs
        .map(d => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
        .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      safeRender(renderGcashPage);
      onAfter?.();
    },
    (err) => console.error("[GCash listener]", err.code, err.message)
  );
}