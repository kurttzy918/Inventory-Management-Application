/* gcash.js — GCash cash-in/cash-out tracking + Auto-generated Payment QR */
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

const OPENING_KEY  = (ws) => `gcashOpeningBalance:${ws}`;
const SETTINGS_KEY = (ws) => `gcashSettings:${ws}`;

/* =========================================================
   OPENING BALANCE
   ========================================================= */
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
   GCASH SETTINGS (number + name only — QR is auto-generated)
   ========================================================= */
function getGcashSettings() {
  const ws = myWorkspace();
  if (!ws) return { number: "", name: "" };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY(ws));
    if (raw) {
      const p = JSON.parse(raw);
      return { number: p.number || "", name: p.name || "" };
    }
  } catch (e) { console.warn("[gcash settings] parse:", e); }
  return { number: "", name: "" };
}

function setGcashSettings(s) {
  const ws = myWorkspace(); if (!ws) return;
  try {
    localStorage.setItem(SETTINGS_KEY(ws), JSON.stringify({
      number: s.number || "",
      name:   s.name   || ""
    }));
  } catch (e) { console.warn("[gcash settings] save:", e); }
}

/* =========================================================
   QR PAYLOAD BUILDER
   Encodes readable payment details for any QR scanner.
   ========================================================= */
function buildQrPayload({ number, name, amount, reference, note }) {
  const lines = [
    "GCASH PAYMENT",
    "─────────────",
    `Amount : ₱${Number(amount || 0).toFixed(2)}`,
    `To     : ${number || "—"}`,
    `Name   : ${name || "—"}`,
    `Ref    : ${reference || "—"}`
  ];
  if (note) lines.push(`Note   : ${note}`);
  return lines.join("\n");
}

/* =========================================================
   QR RENDER HELPER
   ========================================================= */
async function renderQr(canvas, text, opts = {}) {
  if (!canvas) return;
  if (typeof window.QRCode === "undefined") {
    console.warn("[gcash qr] QRCode library not loaded");
    return;
  }
  try {
    await window.QRCode.toCanvas(canvas, text, {
      width: opts.width || 260,
      margin: opts.margin || 2,
      color: opts.color || { dark: "#0B6FDE", light: "#FFFFFF" },
      errorCorrectionLevel: "M"
    });
  } catch (e) {
    console.error("[gcash qr] render:", e);
  }
}

/* =========================================================
   SETTINGS FORM
   ========================================================= */
function renderSettingsPreview() {
  const number = valOf($("gcash-number")).trim();
  const name   = valOf($("gcash-account-name")).trim();
  const canvas = $("gcash-settings-canvas");
  if (!canvas) return;

  if (!number && !name) {
    // Placeholder preview — show dummy QR so user sees the effect
    renderQr(canvas, "GCASH PAYMENT\n─────────────\nSet your number in Settings", {
      width: 200, color: { dark: "#94A3B8", light: "#F1F5F7" }
    });
    return;
  }

  renderQr(canvas, buildQrPayload({
    number: number || "09XXXXXXXXX",
    name:   name   || "Your Name",
    amount: 0,
    reference: "PREVIEW"
  }), { width: 200 });
}

function loadGcashSettingsIntoForm() {
  const s = getGcashSettings();
  setVal($("gcash-number"), s.number);
  setVal($("gcash-account-name"), s.name);
  renderSettingsPreview();
}

function wireGcashSettings() {
  loadGcashSettingsIntoForm();

  // Live preview as user types
  $("gcash-number")?.addEventListener("input", debounce(renderSettingsPreview, 300));
  $("gcash-account-name")?.addEventListener("input", debounce(renderSettingsPreview, 300));

  $("gcash-save-settings")?.addEventListener("click", () => {
    setGcashSettings({
      number: valOf($("gcash-number")).trim(),
      name:   valOf($("gcash-account-name")).trim()
    });
    playSuccessSound();
    showToast("GCash settings saved ✅");
  });
}

/* =========================================================
   PAYMENT QR MODAL
   ========================================================= */
let _currentQrTxn = null;

export function openGcashPaymentQR(txnId) {
  const t = state.gcashTransactions.find(x => x.id === txnId);
  if (!t) { showToast("Transaction not found ❌"); return; }
  _currentQrTxn = t;

  const meta = GCASH_TYPES[t.type] || GCASH_TYPES.other;
  const s = getGcashSettings();

  if (!s.number) {
    showToast("Set your GCash number in Settings first ⚠️");
    // Scroll to settings
    document.querySelector(".gcash-settings-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const amtEl = $("gcash-pay-amount");
  const refEl = $("gcash-pay-ref");
  const numEl = $("gcash-pay-number");
  const nameEl = $("gcash-pay-name");
  const canvasEl = $("gcash-pay-qr-canvas");
  const hintEl = $("gcash-payment-hint");

  const ref = t.reference || t.id.slice(0, 10).toUpperCase();

  if (amtEl) amtEl.textContent = fmtMoney(t.amount);
  if (refEl) refEl.textContent = ref;
  if (numEl) numEl.textContent = s.number;
  if (nameEl) nameEl.textContent = s.name || "—";

  // Generate the QR from real transaction data
  const payload = buildQrPayload({
    number: s.number,
    name: s.name,
    amount: t.amount,
    reference: ref,
    note: t.note || ""
  });
  renderQr(canvasEl, payload, { width: 260 });

  if (hintEl) {
    hintEl.textContent =
      "Show this to the customer. They can scan the QR with any phone to see the amount, your number, and the reference — then send via their GCash app.";
  }

  $("gcash-payment-modal")?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
window.openGcashPaymentQR = openGcashPaymentQR;

function closeGcashPaymentQR() {
  $("gcash-payment-modal")?.classList.add("hidden");
  document.body.style.overflow = "";
  _currentQrTxn = null;
}

function printCurrentGcashPayment() {
  const t = _currentQrTxn;
  if (!t) return;
  const meta = GCASH_TYPES[t.type] || GCASH_TYPES.other;
  const s = getGcashSettings();
  const date = t.createdAt?.toDate?.().toLocaleString() || "—";
  const ref = t.reference || t.id.slice(0, 10).toUpperCase();

  const qrImgSrc = document.getElementById("gcash-pay-qr-canvas")?.toDataURL?.("image/png") || "";

  printHTML(`
    <h1>GCash Payment</h1>
    <div class="meta">${esc(CONSTANTS.STORE_NAME)} · ${esc(date)}</div>
    <table>
      <tr><th style="width:180px">Transaction</th><td>${esc(meta.label)}</td></tr>
      <tr><th>Amount to Pay</th><td><strong>${fmtMoney(t.amount)}</strong></td></tr>
      <tr><th>Reference</th><td>${esc(ref)}</td></tr>
      <tr><th>GCash Number</th><td>${esc(s.number || "—")}</td></tr>
      <tr><th>Account Name</th><td>${esc(s.name || "—")}</td></tr>
    </table>
    ${qrImgSrc ? `<div style="text-align:center;margin-top:24px;"><img src="${qrImgSrc}" alt="QR" style="max-width:260px;border:1px solid #ccc;border-radius:12px;padding:8px;" /></div>` : ""}
    <p style="margin-top:18px;text-align:center;font-size:12px;color:#666;">
      Scan the QR to see payment details.
    </p>
  `, "GCash Payment");
}

function wireGcashPaymentModal() {
  $("gcash-payment-close")?.addEventListener("click", closeGcashPaymentQR);
  $("gcash-pay-done")?.addEventListener("click", closeGcashPaymentQR);
  $("gcash-pay-print")?.addEventListener("click", printCurrentGcashPayment);
  $("gcash-payment-modal")?.addEventListener("click", (e) => {
    if (e.target === $("gcash-payment-modal")) closeGcashPaymentQR();
  });
}

/* =========================================================
   TRANSACTION FORM
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
          <button type="button" class="sale-action-btn qr" onclick="openGcashPaymentQR('${t.id}')" title="Show Payment QR">📱</button>
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
   OPENING BALANCE PROMPT
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
  wireGcashSettings();
  wireGcashPaymentModal();

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