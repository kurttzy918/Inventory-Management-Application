/* labels.js — Barcode / price label generator (dedicated page) */
import { state, CONSTANTS } from "./state.js";
import {
  $, valOf, esc, debounce, showToast, fmtMoney
} from "./utils.js";

/* =========================================================
   PRESETS — page layout (mm) for common label sheets
   ========================================================= */
const LABEL_SIZES = {
  small: {
    name: "Small · 38×25mm · 65/page (Avery L7651)",
    w: 38, h: 25, cols: 5, rows: 13,
    gapX: 2.5, gapY: 0, marginTop: 21.5, marginLeft: 7,
    showName: false, showSKU: false, nameSize: 6.5, priceSize: 10
  },
  medium: {
    name: "Medium · 50×30mm · 32/page",
    w: 50, h: 30, cols: 4, rows: 8,
    gapX: 2.5, gapY: 0, marginTop: 21.5, marginLeft: 6,
    showName: true, showSKU: true, nameSize: 7, priceSize: 12
  },
  large: {
    name: "Large · 70×37mm · 21/page",
    w: 70, h: 37, cols: 3, rows: 7,
    gapX: 2.5, gapY: 0, marginTop: 21.5, marginLeft: 4,
    showName: true, showSKU: true, nameSize: 9, priceSize: 14
  },
  thermal: {
    name: "Thermal · 58×40mm (roll, single column)",
    w: 58, h: 40, cols: 1, rows: 9999,
    gapX: 0, gapY: 2, marginTop: 3, marginLeft: 3,
    showName: true, showSKU: true, nameSize: 9, priceSize: 14,
    thermal: true
  }
};

const BARCODE_FORMATS = {
  CODE128: "CODE128",
  CODE39:  "CODE39",
  EAN13:   "EAN13",
  UPC:     "UPC"
};

/* =========================================================
   LOCAL STATE
   ========================================================= */
let labelQueue = {};            // { productId: qty }
let labelsSearchTerm = "";
let labelsInitialized = false;

/* =========================================================
   BARCODE SVG
   ========================================================= */
function generateBarcodeSVG(value, format, opts = {}) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  try {
    window.JsBarcode(svg, String(value), {
      format,
      width: opts.width || 1.4,
      height: opts.height || 30,
      displayValue: false,
      margin: 0,
      background: "#ffffff",
      lineColor: "#000000"
    });
    return svg.outerHTML;
  } catch (err) {
    console.warn("[barcode] render failed:", err);
    return `<div class="bc-error">⚠️ ${format} invalid<br>"${esc(value)}"</div>`;
  }
}

/* =========================================================
   RENDER — product list
   ========================================================= */
function renderLabelProductList() {
  const list = $("labels-product-list");
  if (!list) return;
  const term = (labelsSearchTerm || "").toLowerCase();
  const filtered = state.inventory.filter(i => {
    if (!term) return true;
    return (i.name || "").toLowerCase().includes(term)
        || (i.sku || "").toLowerCase().includes(term)
        || (i.barcode || "").toLowerCase().includes(term);
  });

  if (!state.inventory.length) {
    list.innerHTML = `<div class="empty-state"><p>📭 No inventory yet — add items first.</p></div>`;
    updateLabelSummary();
    return;
  }
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><p>🔍 No products match "${esc(term)}".</p></div>`;
    updateLabelSummary();
    return;
  }

  list.innerHTML = filtered.map(item => {
    const code = item.barcode || item.sku || "";
    const qty = labelQueue[item.id] || 0;
    const checked = qty > 0;
    const img = item.image
      ? `<img src="${item.image}" alt="" loading="lazy" />`
      : `<div class="lbl-fallback" style="background:${fallbackColorFor(item.name)}">${esc((item.name || "?").charAt(0).toUpperCase())}</div>`;

    return `
      <div class="label-item ${checked ? "selected" : ""}" data-id="${item.id}">
        <label class="label-check">
          <input type="checkbox" data-role="check" ${checked ? "checked" : ""} />
        </label>
        <div class="label-thumb">${img}</div>
        <div class="label-item-info">
          <div class="label-item-name">${esc(item.name)}</div>
          <div class="label-item-sku">
            SKU ${esc(item.sku)}${code && code !== item.sku ? ` · <code>${esc(code)}</code>` : ""}
          </div>
        </div>
        <div class="label-item-qty">
          <button type="button" class="lbl-qty-btn" data-role="dec" title="Fewer">−</button>
          <input type="number" class="lbl-qty-input" data-role="qty" value="${qty || 1}" min="1" max="500" />
          <button type="button" class="lbl-qty-btn" data-role="inc" title="More">+</button>
        </div>
      </div>`;
  }).join("");

  // Wire rows
  list.querySelectorAll(".label-item").forEach(row => {
    const id = row.dataset.id;
    const check = row.querySelector('[data-role="check"]');
    const qtyInput = row.querySelector('[data-role="qty"]');
    const incBtn = row.querySelector('[data-role="inc"]');
    const decBtn = row.querySelector('[data-role="dec"]');

    check?.addEventListener("change", () => {
      if (check.checked) {
        labelQueue[id] = Math.max(1, Number(qtyInput.value) || 1);
      } else {
        delete labelQueue[id];
      }
      row.classList.toggle("selected", check.checked);
      updateLabelSummary();
    });

    qtyInput?.addEventListener("input", () => {
      const v = Math.max(1, Math.min(500, Number(qtyInput.value) || 1));
      qtyInput.value = v;
      if (check?.checked) {
        labelQueue[id] = v;
        updateLabelSummary();
      }
    });

    incBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const v = Math.min(500, (Number(qtyInput.value) || 0) + 1);
      qtyInput.value = v;
      if (check && !check.checked) {
        check.checked = true;
        row.classList.add("selected");
      }
      labelQueue[id] = v;
      updateLabelSummary();
    });

    decBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const v = Math.max(1, (Number(qtyInput.value) || 1) - 1);
      qtyInput.value = v;
      if (check?.checked) {
        labelQueue[id] = v;
        updateLabelSummary();
      }
    });
  });

  updateLabelSummary();
}

function updateLabelSummary() {
  const ids = Object.keys(labelQueue);
  const total = ids.reduce((s, id) => s + (labelQueue[id] || 0), 0);
  const el = $("labels-summary");
  if (el) {
    el.textContent = ids.length
      ? `${ids.length} product${ids.length !== 1 ? "s" : ""} · ${total} label${total !== 1 ? "s" : ""}`
      : "No products selected";
  }
  const btn = $("labels-print-btn");
  if (btn) btn.disabled = total === 0;
}

/* =========================================================
   PRINT
   ========================================================= */
function buildLabelsHTML() {
  const sizeKey = valOf($("labels-size")) || "small";
  const formatKey = valOf($("labels-format")) || "CODE128";
  const size = LABEL_SIZES[sizeKey] || LABEL_SIZES.small;
  const format = BARCODE_FORMATS[formatKey] || "CODE128";

  const labels = [];
  Object.keys(labelQueue).forEach(id => {
    const item = state.inventory.find(i => i.id === id);
    if (!item) return;
    const qty = Math.max(0, labelQueue[id] || 0);
    for (let i = 0; i < qty; i++) labels.push({ item, size, format });
  });

  if (!labels.length) return null;

  const labelHTML = labels.map(({ item, size, format }) => {
    const code = item.barcode || item.sku || "";
    const barcodeSVG = generateBarcodeSVG(code, format, {
      width: size.thermal ? 1.6 : 1.3,
      height: size.thermal ? 40 : 30
    });
    return `
      <div class="label-cell">
        ${size.showName ? `<div class="lbl-name" style="font-size:${size.nameSize}pt">${esc(item.name)}</div>` : ""}
        <div class="lbl-barcode">${barcodeSVG}</div>
        ${size.showSKU ? `<div class="lbl-code">${esc(code)}</div>` : ""}
        <div class="lbl-price" style="font-size:${size.priceSize}pt">${fmtMoney(item.price)}</div>
      </div>`;
  }).join("");

  return { size, labelHTML, count: labels.length };
}

function printLabels() {
  if (typeof window.JsBarcode === "undefined") {
    showToast("Barcode library not loaded — check your connection ❌");
    return;
  }
  const built = buildLabelsHTML();
  if (!built) { showToast("No labels selected ❌"); return; }
  const { size, labelHTML, count } = built;

  const isThermal = !!size.thermal;
  const pageStyle = isThermal
    ? `@page { size: 58mm auto; margin: 3mm; }`
    : `@page { size: A4 portrait; margin: 0; }`;

  const gridStyle = isThermal
    ? `
      .label-grid {
        display: flex; flex-direction: column;
        gap: ${size.gapY}mm;
        padding: ${size.marginTop}mm ${size.marginLeft}mm;
      }
      .label-cell { width: ${size.w}mm; height: ${size.h}mm; }
    `
    : `
      .label-grid {
        display: grid;
        grid-template-columns: repeat(${size.cols}, ${size.w}mm);
        gap: ${size.gapY}mm ${size.gapX}mm;
        padding-top: ${size.marginTop}mm;
        padding-left: ${size.marginLeft}mm;
        justify-content: start;
      }
      .label-cell { width: ${size.w}mm; height: ${size.h}mm; }
    `;

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8" />
<title>Labels · ${count} label${count !== 1 ? "s" : ""}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #fff; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #000; }
  ${pageStyle}
  ${gridStyle}
  .label-cell {
    background: #fff; padding: 1mm;
    display: flex; flex-direction: column;
    justify-content: space-between; align-items: center;
    overflow: hidden; border: 1px dashed #e0e0e0;
    page-break-inside: avoid; break-inside: avoid;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .lbl-name {
    width: 100%; font-weight: 700; line-height: 1.1; text-align: center;
    overflow: hidden; display: -webkit-box;
    -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .lbl-barcode { width: 100%; display: flex; justify-content: center; align-items: center; overflow: hidden; }
  .lbl-barcode svg { max-width: 100%; height: auto; display: block; }
  .bc-error { font-size: 6pt; color: #b00; text-align: center; }
  .lbl-code { font-family: 'Courier New', monospace; font-size: 6.5pt; letter-spacing: 0.3px; color: #333; }
  .lbl-price { font-weight: 800; text-align: center; width: 100%; }
  @media print { .label-cell { border-color: transparent; } }
</style>
</head><body>
<div class="label-grid">${labelHTML}</div>
</body></html>`;

  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) { showToast("Allow popups to print labels 📄"); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    try { w.print(); } catch (e) { console.warn("[labels] print failed:", e); }
  }, 400);
  showToast(`Preparing ${count} label${count !== 1 ? "s" : ""} 🖨️`);
}

/* =========================================================
   PUBLIC ENTRY POINTS
   ========================================================= */
/* Called from the 🏷️ icon on each inventory item card */
export function openLabelFor(productId) {
  // Navigate to Labels page
  document.querySelector('[data-page="page-labels"]')?.click();
  // Pre-select the product
  labelQueue = { [productId]: 1 };
  labelsSearchTerm = "";
  if ($("labels-search")) $("labels-search").value = "";
  // Delay render a tick so the page is visible
  requestAnimationFrame(() => renderLabelProductList());
}
window.openLabelFor = openLabelFor;

/* Called when the user just wants to open the Labels page */
export function openLabelSheet() {
  document.querySelector('[data-page="page-labels"]')?.click();
}
window.openLabelSheet = openLabelSheet;

/* Called by app.js when the Labels page becomes visible */
export function renderLabelsPage() {
  if (!labelsInitialized) return;
  renderLabelProductList();
}

/* =========================================================
   INIT — called once from app.js boot()
   ========================================================= */
export function initLabels() {
  const sizeSel = $("labels-size");
  if (sizeSel) {
    sizeSel.innerHTML = Object.entries(LABEL_SIZES)
      .map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`)
      .join("");
    sizeSel.value = "small";
  }

  const formatSel = $("labels-format");
  if (formatSel) {
    formatSel.innerHTML = `
      <option value="CODE128">Code 128 · any text/SKU (recommended)</option>
      <option value="CODE39">Code 39 · A-Z, 0-9, dash</option>
      <option value="EAN13">EAN-13 · 12–13 digits only</option>
      <option value="UPC">UPC-A · 11–12 digits only</option>
    `;
    formatSel.value = "CODE128";
  }

  $("labels-search")?.addEventListener("input", debounce((e) => {
    labelsSearchTerm = e.target.value || "";
    renderLabelProductList();
  }, 150));

  $("labels-select-all")?.addEventListener("click", () => {
    const term = (labelsSearchTerm || "").toLowerCase();
    const visible = state.inventory.filter(i => {
      if (!term) return true;
      return (i.name || "").toLowerCase().includes(term)
          || (i.sku || "").toLowerCase().includes(term)
          || (i.barcode || "").toLowerCase().includes(term);
    });
    const allSelected = visible.length && visible.every(i => labelQueue[i.id] > 0);
    visible.forEach(i => {
      if (allSelected) delete labelQueue[i.id];
      else labelQueue[i.id] = 1;
    });
    renderLabelProductList();
  });

  $("labels-clear")?.addEventListener("click", () => {
    labelQueue = {};
    renderLabelProductList();
  });

  $("labels-print-btn")?.addEventListener("click", printLabels);

  labelsInitialized = true;
}

/* =========================================================
   HELPERS
   ========================================================= */
function fallbackColorFor(name) {
  const arr = CONSTANTS.FALLBACK_COLORS;
  return arr[((name || "").charCodeAt(0) || 0) % arr.length];
}