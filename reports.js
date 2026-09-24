/* reports.js — Analytics, charts, history, exports */
import {
  collection, doc, writeBatch, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { state, CONSTANTS } from "./state.js";
import {
  $, valOf, esc, safeRender, showToast, debounce,
  fmtMoney, fmtInt, fmtShort, productImageHTML, thumbHTML,
  getSoldMap, getSoldMapLastDays, getSalesByCategory, monthKey, monthLabel,
  getCSSVar, printHTML, downloadXLSX, downloadPDF,
  expiryStatus
} from "./utils.js";
import { stockProgress } from "./inventory.js";

const { CATEGORY_PALETTE } = CONSTANTS;

/* =========================================================
   STATS (stat cards)
   ========================================================= */
export function updateStats() {
  const total = state.inventory.length;
  const low = state.inventory.filter(i => i.quantity <= (i.threshold ?? 5)).length;
  const value = state.inventory.reduce((s, i) => s + (i.quantity * i.price || 0), 0);

  // ✅ Running Sales = all-time sales (matches "Running Sales" in Sales Overview)
  const runningSales = state.sales.reduce((s, x) => s + (Number(x.total) || 0), 0);

  const totalProfit = state.sales.reduce((sum, s) => {
    if (typeof s.profit === "number") return sum + s.profit;
    const it = state.inventory.find(i => i.id === s.itemId);
    const cost = (it && typeof it.cost === "number") ? it.cost : (s.cost || 0);
    return sum + ((s.unitPrice || 0) - cost) * (s.quantity || 0);
  }, 0);

  if ($("stat-total")) $("stat-total").textContent = fmtInt(total);
  if ($("stat-low")) $("stat-low").textContent = fmtInt(low);
  if ($("stat-value")) $("stat-value").textContent = fmtMoney(value);
  if ($("stat-sales")) $("stat-sales").textContent = fmtMoney(runningSales); // ✅ all-time
  if ($("stat-profit")) $("stat-profit").textContent = fmtMoney(totalProfit);
  if ($("stat-cats")) $("stat-cats").textContent = fmtInt(state.categories.length);
}

/* =========================================================
   SALES OVERVIEW (daily / monthly / running)
   ========================================================= */
export function populateMonthFilter() {
  const sel = $("month-filter"); if (!sel) return;
  const set = new Set();
  state.sales.forEach(s => {
    const d = s.createdAt?.toDate?.(); if (d) set.add(monthKey(d));
  });
  const list = [...set].sort().reverse();
  const cur = sel.value || state.soSelectedMonth;
  sel.innerHTML = `<option value="">All Time</option>` +
    list.map(k => `<option value="${k}">${esc(monthLabel(k))}</option>`).join("");
  sel.value = list.includes(cur) ? cur : "";
  state.soSelectedMonth = sel.value;
}

export function renderSalesOverview() {
  const todayEl   = $("so-today");
  const monthEl   = $("so-month");
  const weekEl    = $("so-week");
  const runningEl = $("so-running");
  if (!todayEl || !monthEl || !runningEl) return;

  const now = new Date();

  // ---- Running Sales: all-time ----
  const runningTotal = state.sales.reduce((a, s) => a + (Number(s.total) || 0), 0);

  // ---- Today ----
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayTotal = state.sales
    .filter(s => (s.createdAt?.toDate?.() ?? 0) >= today)
    .reduce((a, s) => a + (Number(s.total) || 0), 0);

  // ---- This Month (respects the month dropdown) ----
  const mk = valOf($("month-filter")) || state.soSelectedMonth || "";
  const monthSalesList = mk
    ? state.sales.filter(s => {
        const d = s.createdAt?.toDate?.();
        return d && monthKey(d) === mk;
      })
    : state.sales;
  const monthTotal = monthSalesList.reduce((a, s) => a + (Number(s.total) || 0), 0);

  // ---- This Week (Monday → now) ----
  const weekStart = new Date(now);
  const dayOfWeek = (now.getDay() + 6) % 7; // Monday = 0
  weekStart.setDate(now.getDate() - dayOfWeek);
  weekStart.setHours(0, 0, 0, 0);
  const weekTotal = state.sales
    .filter(s => (s.createdAt?.toDate?.() ?? 0) >= weekStart)
    .reduce((a, s) => a + (Number(s.total) || 0), 0);

  // ---- Apply to DOM ----
  todayEl.textContent = fmtMoney(todayTotal);
  monthEl.textContent = fmtMoney(monthTotal);
  if (weekEl) weekEl.textContent = fmtMoney(weekTotal);
  runningEl.textContent = fmtMoney(runningTotal);

  // ---- Daily list (unchanged behavior) ----
  const dailyMap = {};
  monthSalesList.forEach(s => {
    const d = s.createdAt?.toDate?.(); if (!d) return;
    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    dailyMap[k] = (dailyMap[k] || 0) + (Number(s.total) || 0);
  });
  const days = Object.entries(dailyMap).sort((a, b) => b[0].localeCompare(a[0]));
  const maxDay = days.reduce((m, [, v]) => Math.max(m, v), 0);

  const listEl = $("so-daily-list"), totalEl = $("so-daily-total");
  if (totalEl) totalEl.textContent = fmtMoney(monthTotal);
  if (!listEl) return;
  if (!days.length) { listEl.innerHTML = `<div class="empty-state"><p>No sales in this period.</p></div>`; return; }

  listEl.innerHTML = days.map(([k, v]) => {
    const d = new Date(k + "T00:00:00");
    const label = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const best = maxDay > 0 && v === maxDay && days.length > 1;
    return `<div class="so-day-row ${best ? "best" : ""}">
      <span>${esc(label)}${best ? " 🏆" : ""}</span>
      <strong>${fmtMoney(v)}</strong>
    </div>`;
  }).join("");
}

/* =========================================================
   ADVANCED ANALYTICS
   ========================================================= */
export function renderKPIs() {
  const salesArr = state.sales;

  // Avg Order Value: total / number of receipts
  const receiptSet = new Set(salesArr.map(s => s.receiptNum || s.id));
  const totalSales = salesArr.reduce((a, s) => a + (Number(s.total) || 0), 0);
  const aov = receiptSet.size ? totalSales / receiptSet.size : 0;
  if ($("kpi-aov")) $("kpi-aov").textContent = fmtMoney(aov);

  // Items sold
  const itemsSold = salesArr.reduce((a, s) => a + (Number(s.quantity) || 0), 0);
  if ($("kpi-items")) $("kpi-items").textContent = fmtInt(itemsSold);

  // Peak hour
  const hourBuckets = new Array(24).fill(0);
  salesArr.forEach(s => {
    const d = s.createdAt?.toDate?.(); if (!d) return;
    hourBuckets[d.getHours()] += 1;
  });
  const peakH = hourBuckets.indexOf(Math.max(...hourBuckets));
  const peakCount = hourBuckets[peakH];
  if ($("kpi-peak")) $("kpi-peak").textContent = peakCount > 0
    ? `${String(peakH).padStart(2,"0")}:00`
    : "–";

  // Profit margin
  const totalProfit = salesArr.reduce((a, s) => {
    if (typeof s.profit === "number") return a + s.profit;
    const it = state.inventory.find(i => i.id === s.itemId);
    const cost = (it && typeof it.cost === "number") ? it.cost : (s.cost || 0);
    return a + ((s.unitPrice || 0) - cost) * (s.quantity || 0);
  }, 0);
  const margin = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;
  if ($("kpi-margin")) $("kpi-margin").textContent = margin.toFixed(1) + "%";
}

function buildLast30DaySeries(getValue) {
  const days = [];
  const now = new Date(); now.setHours(0,0,0,0);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    days.push({ date: d, key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}` });
  }
  const sums = {};
  days.forEach(d => sums[d.key] = 0);
  state.sales.forEach(s => {
    const dt = s.createdAt?.toDate?.(); if (!dt) return;
    const k = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
    if (k in sums) sums[k] += getValue(s);
  });
  return { labels: days.map(d => d.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })),
           values: days.map(d => sums[d.key]) };
}

export function renderTrendCharts() {
  const salesCanvas = $("sales-trend-chart");
  const profitCanvas = $("profit-trend-chart");
  if (!salesCanvas || !profitCanvas) return;

  const textColor = getCSSVar("--text") || "#1e293b";
  const grid = getCSSVar("--border") || "#e2e8f0";
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";

  const salesSeries = buildLast30DaySeries(s => Number(s.total) || 0);
  const profitSeries = buildLast30DaySeries(s => {
    if (typeof s.profit === "number") return s.profit;
    const it = state.inventory.find(i => i.id === s.itemId);
    const cost = (it && typeof it.cost === "number") ? it.cost : (s.cost || 0);
    return ((s.unitPrice || 0) - cost) * (s.quantity || 0);
  });

  // Modern bar options
  const barOpts = (label) => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500, easing: "easeOutQuart" },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: isDark ? "#1E2D34" : "#0F172A",
        titleColor: "#fff",
        bodyColor: "#fff",
        padding: 10,
        cornerRadius: 8,
        displayColors: false,
        callbacks: {
          label: (c) => `${label}: ${fmtMoney(c.parsed.y)}`
        }
      }
    },
    scales: {
      x: {
        ticks: {
          color: textColor,
          font: { size: 10 },
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 8
        },
        grid: { display: false },
        border: { display: false }
      },
      y: {
        beginAtZero: true,
        ticks: {
          color: textColor,
          font: { size: 10 },
          callback: (v) => fmtShort(v)
        },
        grid: { color: grid, drawTicks: false },
        border: { display: false }
      }
    }
  });

  // Sales bar chart
  const sData = {
    labels: salesSeries.labels,
    datasets: [{
      label: "Sales",
      data: salesSeries.values,
      backgroundColor: isDark ? "#2FA38F" : "#12544F",
      hoverBackgroundColor: "#5FC2A6",
      borderRadius: 6,
      borderSkipped: false,
      maxBarThickness: 32,
      categoryPercentage: 0.7,
      barPercentage: 0.85
    }]
  };
  if (state.salesTrendChart?.canvas?.isConnected) {
    state.salesTrendChart.destroy();
  }
  try {
    state.salesTrendChart = new Chart(salesCanvas, {
      type: "bar", data: sData, options: barOpts("Sales")
    });
  } catch (e) { console.error("[bar chart sales]", e); }

  // Profit bar chart
  const pData = {
    labels: profitSeries.labels,
    datasets: [{
      label: "Profit",
      data: profitSeries.values,
      backgroundColor: isDark ? "#10B981" : "#059669",
      hoverBackgroundColor: "#34D399",
      borderRadius: 6,
      borderSkipped: false,
      maxBarThickness: 32,
      categoryPercentage: 0.7,
      barPercentage: 0.85
    }]
  };
  if (state.profitTrendChart?.canvas?.isConnected) {
    state.profitTrendChart.destroy();
  }
  try {
    state.profitTrendChart = new Chart(profitCanvas, {
      type: "bar", data: pData, options: barOpts("Profit")
    });
  } catch (e) { console.error("[bar chart profit]", e); }
}
export function renderTopProfitAndRevenue() {
  const listProfit = $("top-profit-list");
  const listRevenue = $("top-revenue-list");
  if (!listProfit && !listRevenue) return;

  const byProfit = {}, byRevenue = {};
state.sales.forEach(s => {
  const profit = typeof s.profit === "number"
    ? s.profit
    : (() => {
        const it = state.inventory.find(i => i.id === s.itemId);
        const cost = (it && typeof it.cost === "number") ? it.cost : (s.cost || 0);
        return ((s.unitPrice || 0) - cost) * (s.quantity || 0);
      })();
  const rev = Number(s.total) || 0;

  // Look up the current inventory item for its photo
  const invItem = state.inventory.find(i => i.id === s.itemId);
  const image = invItem?.image || s.image || null;

  if (!byProfit[s.itemId]) {
    byProfit[s.itemId] = { itemId: s.itemId, name: s.itemName, image, profit: 0, qty: 0 };
  }
  byProfit[s.itemId].profit += profit;
  byProfit[s.itemId].qty += Number(s.quantity) || 0;

  if (!byRevenue[s.itemId]) {
    byRevenue[s.itemId] = { itemId: s.itemId, name: s.itemName, image, revenue: 0, qty: 0 };
  }
  byRevenue[s.itemId].revenue += rev;
  byRevenue[s.itemId].qty += Number(s.quantity) || 0;
});

  const rankHTML = (arr, valueKey, label) => {
  if (!arr.length) return `<div class="empty-state"><p>No ${label} data yet.</p></div>`;
  const maxVal = arr[0][valueKey] || 1;
  return arr.slice(0, 5).map((it, idx) => {
    const rankClass = idx === 0 ? "rank-1" : idx === 1 ? "rank-2" : idx === 2 ? "rank-3" : "";
    const pct = (it[valueKey] / maxVal) * 100;

    // Look up the inventory item so we can show its photo
    const invItem = state.inventory.find(i => i.id === it.itemId) || {
      id: it.itemId,
      name: it.name,
      image: it.image || null
    };

    return `
      <div class="rank-row">
        <div class="rank-badge ${rankClass}">${idx + 1}</div>
        ${productImageHTML(invItem, "sm")}
        <div class="rank-main">
          <div class="rank-name">${esc(it.name)}</div>
          <div class="rank-sub">${fmtInt(it.qty)} unit${it.qty !== 1 ? "s" : ""} sold</div>
          <div class="progress slim"><div class="progress-bar high" style="width:${pct}%"></div></div>
        </div>
        <div class="rank-qty">${fmtMoney(it[valueKey])}<span>${label}</span></div>
      </div>`;
  }).join("");
};

  const profitArr = Object.values(byProfit).sort((a, b) => b.profit - a.profit);
  const revenueArr = Object.values(byRevenue).sort((a, b) => b.revenue - a.revenue);
  if (listProfit) listProfit.innerHTML = rankHTML(profitArr, "profit", "profit");
  if (listRevenue) listRevenue.innerHTML = rankHTML(revenueArr, "revenue", "revenue");
}

/* =========================================================
   CHARTS — Dashboard (stock status, category value, sales category)
   ========================================================= */
function commonChartOptions(textColor) {
  return {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 400 },
    plugins: { legend: { position: "bottom", labels: { color: textColor, padding: 12, font: { size: 12 }, boxWidth: 14, usePointStyle: true } } }
  };
}

export function renderCharts(retries = 0) {
  if (!state.chartJsReady || typeof Chart === "undefined") {
    if (retries < 40) setTimeout(() => renderCharts(retries + 1), 200);
    return;
  }
  const dashEl = $("page-dashboard");
  if (!dashEl || dashEl.classList.contains("hidden")) return;
  const stockCanvas = $("stock-status-chart");
  const catCanvas = $("category-value-chart");
  const salesCanvas = $("sales-category-chart");
  if (!stockCanvas || !catCanvas || !salesCanvas) return;
  if (stockCanvas.clientWidth <= 0 || stockCanvas.clientHeight <= 0) {
    if (retries < 40) setTimeout(() => renderCharts(retries + 1), 200);
    return;
  }
  const textColor = getCSSVar("--text") || "#1e293b";

  try {
    const inStock  = state.inventory.filter(i => i.quantity >  (i.threshold ?? 5)).length;
    const lowStock = state.inventory.filter(i => i.quantity > 0 && i.quantity <= (i.threshold ?? 5)).length;
    const outStock = state.inventory.filter(i => i.quantity === 0).length;
    const stockData = {
      labels: ["In Stock", "Low Stock", "Out of Stock"],
      datasets: [{ data: [inStock, lowStock, outStock], backgroundColor: ["#22c55e", "#f59e0b", "#ef4444"], borderWidth: 0, hoverOffset: 6 }]
    };
    if (state.stockChart?.canvas?.isConnected) {
      state.stockChart.data = stockData;
      state.stockChart.options.plugins.legend.labels.color = textColor;
      state.stockChart.update("none");
    } else {
      if (state.stockChart) { try { state.stockChart.destroy(); } catch {} }
      state.stockChart = new Chart(stockCanvas, {
        type: "doughnut", data: stockData,
        options: { ...commonChartOptions(textColor), cutout: "62%" }
      });
    }
  } catch (e) { console.error("[chart] stock:", e); }

  try {
    const vbc = {};
    state.inventory.forEach(i => { vbc[i.category] = (vbc[i.category] || 0) + (i.quantity * i.price || 0); });
    const catLabels = Object.keys(vbc), catValues = Object.values(vbc);
    const catData = {
      labels: catLabels.length ? catLabels : ["No data"],
      datasets: [{
        data: catValues.length ? catValues : [1],
        backgroundColor: catLabels.length ? catLabels.map((_, i) => CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]) : ["#e2e8f0"],
        borderWidth: 0, hoverOffset: 6
      }]
    };
    if (state.categoryValueChart?.canvas?.isConnected) {
      state.categoryValueChart.data = catData;
      state.categoryValueChart.options.plugins.legend.labels.color = textColor;
      state.categoryValueChart.update("none");
    } else {
      if (state.categoryValueChart) { try { state.categoryValueChart.destroy(); } catch {} }
      state.categoryValueChart = new Chart(catCanvas, {
        type: "pie", data: catData,
        options: { ...commonChartOptions(textColor),
          plugins: { ...commonChartOptions(textColor).plugins,
            tooltip: { callbacks: { label: (c) => `${c.label}: ${fmtMoney(c.parsed)}` } }
          }
        }
      });
    }
  } catch (e) { console.error("[chart] category value:", e); }

  try {
    const sbc = {};
    state.sales.forEach(s => { const k = s.category || "Unknown"; sbc[k] = (sbc[k] || 0) + (s.total || 0); });
    const sLabels = Object.keys(sbc), sValues = Object.values(sbc);
    const salesData = {
      labels: sLabels.length ? sLabels : ["No sales yet"],
      datasets: [{
        data: sValues.length ? sValues : [1],
        backgroundColor: sLabels.length ? sLabels.map((_, i) => CATEGORY_PALETTE[(i + 3) % CATEGORY_PALETTE.length]) : ["#e2e8f0"],
        borderWidth: 0, hoverOffset: 6
      }]
    };
    if (state.salesCategoryChart?.canvas?.isConnected) {
      state.salesCategoryChart.data = salesData;
      state.salesCategoryChart.options.plugins.legend.labels.color = textColor;
      state.salesCategoryChart.update("none");
    } else {
      if (state.salesCategoryChart) { try { state.salesCategoryChart.destroy(); } catch {} }
      state.salesCategoryChart = new Chart(salesCanvas, {
        type: "pie", data: salesData,
        options: { ...commonChartOptions(textColor),
          plugins: { ...commonChartOptions(textColor).plugins,
            tooltip: { callbacks: { label: (c) => `${c.label}: ${fmtMoney(c.parsed)}` } }
          }
        }
      });
    }
  } catch (e) { console.error("[chart] sales category:", e); }

  // Trend charts (advanced)
  renderTrendCharts();

  requestAnimationFrame(() => {
    [state.stockChart, state.categoryValueChart, state.salesCategoryChart,
     state.salesTrendChart, state.profitTrendChart].forEach(c => { try { c?.resize(); } catch {} });
  });
}

export function destroyCharts() {
  [state.stockChart, state.categoryValueChart, state.salesCategoryChart,
   state.salesTrendChart, state.profitTrendChart].forEach(c => { try { c?.destroy(); } catch {} });
  state.stockChart = null; state.categoryValueChart = null; state.salesCategoryChart = null;
  state.salesTrendChart = null; state.profitTrendChart = null;
}

/* =========================================================
   HISTORY
   ========================================================= */
export function groupSalesByReceipt() {
  const map = new Map();
  state.sales.forEach(s => {
    const key = s.receiptNum || ("LEGACY-" + s.id);
    if (!map.has(key)) {
      map.set(key, {
        receiptNum: key,
        date: s.createdAt?.toDate?.() || new Date(),
        cashier: (s.userId === state.currentUser?.uid ? state.currentUser?.email : "") || "Store",
        cash: s.cash || 0,
        change: s.change || 0,
        items: [], saleIds: [], total: 0
      });
    }
    const g = map.get(key);
    g.items.push(s); g.saleIds.push(s.id); g.total += (s.total || 0);
  });
  return [...map.values()].sort((a, b) => b.date - a.date);
}

export function renderHistory() {
  const list = $("history-list"); if (!list) return;
  let groups = groupSalesByReceipt();

  const range = valOf($("history-filter")) || "all";
  if (range !== "all") {
    const now = Date.now(); const dayMs = 24 * 60 * 60 * 1000;
    let cutoff = 0;
    if (range === "today") { const t = new Date(); t.setHours(0,0,0,0); cutoff = t.getTime(); }
    else if (range === "7") cutoff = now - 7 * dayMs;
    else if (range === "30") cutoff = now - 30 * dayMs;
    groups = groups.filter(g => g.date.getTime() >= cutoff);
  }

  const catFilter = valOf($("history-cat-filter"));
  if (catFilter) {
    groups = groups.map(g => {
      const items = g.items.filter(it => (it.category || "Uncategorized") === catFilter);
      if (!items.length) return null;
      const total = items.reduce((s, it) => s + (it.total || 0), 0);
      return { ...g, items, total, saleIds: items.map(it => it.id) };
    }).filter(Boolean);
  }

  const term = valOf($("history-search")).toLowerCase().trim();
  if (term) {
    groups = groups.filter(g =>
      g.receiptNum.toLowerCase().includes(term) ||
      (g.cashier || "").toLowerCase().includes(term) ||
      g.items.some(it => (it.itemName || "").toLowerCase().includes(term))
    );
  }

  if (!groups.length) { list.innerHTML = `<div class="empty-state"><p>🧾 No sales history found.</p></div>`; return; }

  list.innerHTML = groups.slice(0, 60).map(g => {
    const itemCount = g.items.length;
    const qtyTotal = g.items.reduce((sum, it) => sum + (it.quantity || 0), 0);
    const dateStr = g.date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const itemsHTML = g.items.map(it => `
      <div class="history-item-line">
        <span class="history-item-name">${esc(it.itemName)}</span>
        <span class="history-item-qty">× ${fmtInt(it.quantity)}</span>
        <span class="history-item-price">${fmtMoney(it.total)}</span>
      </div>`).join("");
    return `
      <div class="history-receipt">
        <div class="history-receipt-head">
          <div class="history-receipt-meta">
            <div class="history-receipt-num">🧾 ${esc(g.receiptNum)}</div>
            <div class="history-receipt-date">${dateStr}</div>
          </div>
          <div class="history-receipt-total">${fmtMoney(g.total)}</div>
          <div class="history-receipt-actions">
            <button type="button" class="sale-action-btn receipt" onclick="viewReceiptGroup('${esc(g.receiptNum)}')" title="View">🧾</button>
            <button type="button" class="sale-action-btn" onclick="printReceiptGroup('${esc(g.receiptNum)}')" title="Print">🖨️</button>
            <button type="button" class="sale-action-btn delete" onclick="deleteReceiptGroupFromHistory('${esc(g.receiptNum)}')" title="Delete">🗑️</button>
          </div>
        </div>
        <div class="history-receipt-items">${itemsHTML}</div>
        <div class="history-receipt-footer">
          <span>${itemCount} item${itemCount !== 1 ? "s" : ""} · ${fmtInt(qtyTotal)} unit${qtyTotal !== 1 ? "s" : ""}</span>
          <span>Cashier: ${esc((g.cashier || "-").slice(0, 20))}</span>
        </div>
      </div>`;
  }).join("");
}

export function viewReceiptGroup(receiptNum) {
  const g = groupSalesByReceipt().find(x => x.receiptNum === receiptNum);
  if (!g) { showToast("Receipt not found ❌"); return; }
  import("./pos.js").then(mod => {
    mod.showReceipt({
      items: g.items.map(it => ({ name: it.itemName, qty: it.quantity, price: it.unitPrice || 0 })),
      total: g.total, cash: g.cash || g.total, change: g.change || 0,
      receiptNum: g.receiptNum, date: g.date, cashier: state.currentUser?.email || "-"
    }, { receiptNum: g.receiptNum, saleIds: g.saleIds, total: g.total });
  });
}
window.viewReceiptGroup = viewReceiptGroup;

export function printReceiptGroup(receiptNum) {
  const g = groupSalesByReceipt().find(x => x.receiptNum === receiptNum);
  if (!g) { showToast("Receipt not found ❌"); return; }
  const rows = g.items.map(it => `
    <tr>
      <td>${esc(it.itemName)}</td>
      <td>${fmtInt(it.quantity)}</td>
      <td>${fmtMoney(it.unitPrice, false)}</td>
      <td>${fmtMoney(it.total, false)}</td>
    </tr>`).join("");
  printHTML(`
    <h1>${esc(CONSTANTS.STORE_NAME.toUpperCase())}</h1>
    <div class="meta">Receipt ${esc(g.receiptNum)} · ${esc(g.date.toLocaleString())} · Cashier: ${esc(state.currentUser?.email || "-")}</div>
    <table>
      <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><th colspan="3" style="text-align:right">TOTAL</th><th>${fmtMoney(g.total, false)}</th></tr>
      </tfoot>
    </table>
  `, "Receipt " + receiptNum);
}
window.printReceiptGroup = printReceiptGroup;

export function deleteReceiptGroupFromHistory(receiptNum) {
  const g = groupSalesByReceipt().find(x => x.receiptNum === receiptNum);
  if (!g) { showToast("Receipt not found ❌"); return; }
  import("./pos.js").then(mod => mod.deleteReceiptGroup(g.saleIds, g.receiptNum));
}
window.deleteReceiptGroupFromHistory = deleteReceiptGroupFromHistory;

/* =========================================================
   CATEGORY SUMMARIES
   ========================================================= */
function renderCategorySummaryInto(container, list, emptyText) {
  if (!container) return;
  const map = getSalesByCategory(list);
  const entries = Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  if (!entries.length) { container.innerHTML = `<div class="cat-sum-card empty">${esc(emptyText)}</div>`; return; }
  container.innerHTML = entries.map(([cat, v]) => `
    <div class="cat-sum-card">
      <div class="cat-sum-name" title="${esc(cat)}">${esc(cat)}</div>
      <div class="cat-sum-total">${fmtMoney(v.total)}</div>
      <div class="cat-sum-meta">${fmtInt(v.count)} sale${v.count !== 1 ? "s" : ""} · ${fmtInt(v.qty)} unit${v.qty !== 1 ? "s" : ""}</div>
    </div>
  `).join("");
}

export function renderSalesCategorySummary() {
  renderCategorySummaryInto($("sales-category-summary"), state.sales, "No sales yet — make a sale to see category totals.");
}

export function renderHistoryCategorySummary() {
  let list = state.sales;
  const range = valOf($("history-filter")) || "all";
  if (range !== "all") {
    const now = Date.now(); const dayMs = 24 * 60 * 60 * 1000;
    let cutoff = 0;
    if (range === "today") { const t = new Date(); t.setHours(0,0,0,0); cutoff = t.getTime(); }
    else if (range === "7") cutoff = now - 7 * dayMs;
    else if (range === "30") cutoff = now - 30 * dayMs;
    list = list.filter(s => (s.createdAt?.toMillis?.() ?? 0) >= cutoff);
  }
  const catFilter = valOf($("history-cat-filter"));
  if (catFilter) list = list.filter(s => (s.category || "Uncategorized") === catFilter);
  renderCategorySummaryInto($("history-category-summary"), list, "No sales in this range.");
}

/* =========================================================
   FAST / SLOW MOVING
   ========================================================= */
export function renderFastMoving() {
  const list = $("fast-moving-list"); if (!list) return;
  const soldMap = getSoldMap();
  const ranked = [...state.inventory]
    .map(i => ({ ...i, sold: soldMap[i.id] || 0 }))
    .filter(i => i.sold > 0)
    .sort((a, b) => b.sold - a.sold)
    .slice(0, 5);
  if (!ranked.length) { list.innerHTML = `<div class="empty-state"><p>No sales yet.</p></div>`; return; }
  const maxSold = ranked[0].sold;
  list.innerHTML = ranked.map((item, idx) => {
    const rankClass = idx === 0 ? "rank-1" : idx === 1 ? "rank-2" : idx === 2 ? "rank-3" : "";
    const percent = (item.sold / maxSold) * 100;
    return `
      <div class="rank-row">
        <div class="rank-badge ${rankClass}">${idx + 1}</div>
        ${productImageHTML(item, "sm")}
        <div class="rank-main">
          <div class="rank-name">${esc(item.name)}</div>
          <div class="rank-sub">SKU: ${esc(item.sku)} · ${fmtMoney(item.price)}</div>
          <div class="progress slim"><div class="progress-bar high" style="width:${percent}%"></div></div>
        </div>
        <div class="rank-qty">${fmtInt(item.sold)}<span>sold</span></div>
      </div>`;
  }).join("");
}

function getLastSoldMs(itemId) {
  let last = 0;
  state.sales.forEach(s => {
    if (s.itemId !== itemId) return;
    const ms = s.createdAt?.toMillis?.() ?? 0;
    if (ms > last) last = ms;
  });
  return last;
}

export function renderSlowMoving() {
  const list = $("slow-moving-list"); if (!list) return;
  const sold30 = getSoldMapLastDays(30);
  const ranked = [...state.inventory]
    .map(i => ({ ...i, sold30: sold30[i.id] || 0, lastSold: getLastSoldMs(i.id) }))
    .filter(i => i.quantity > 0)
    .sort((a, b) => { if (a.sold30 !== b.sold30) return a.sold30 - b.sold30; return b.quantity - a.quantity; })
    .slice(0, 5);
  if (!ranked.length) { list.innerHTML = `<div class="empty-state"><p>No slow-moving items.</p></div>`; return; }
  list.innerHTML = ranked.map((item, idx) => {
    const lastSoldTxt = item.lastSold
      ? `${Math.floor((Date.now() - item.lastSold) / (24 * 60 * 60 * 1000))}d ago`
      : "Never sold";
    return `
      <div class="rank-row slow">
        <div class="rank-badge slow">${idx + 1}</div>
        ${productImageHTML(item, "sm")}
        <div class="rank-main">
          <div class="rank-name">${esc(item.name)}</div>
          <div class="rank-sub">SKU: ${esc(item.sku)} · Last sold: ${lastSoldTxt}</div>
        </div>
        <div class="rank-qty">${fmtInt(item.sold30)}<span>sold/30d</span></div>
      </div>`;
  }).join("");
}

/* =========================================================
   SPOTLIGHT CAROUSEL
   ========================================================= */
function buildSlides() {
  const slides = [];
  const soldMap = getSoldMap();
  if (state.inventory.length) {
    const newest = [...state.inventory].sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? 0;
      const tb = b.createdAt?.toMillis?.() ?? 0;
      return tb - ta;
    })[0];
    if (newest) slides.push({
      type: "new", label: "New Arrival", item: newest,
      sold: soldMap[newest.id] || 0, revenue: (soldMap[newest.id] || 0) * (newest.price || 0)
    });
  }
  if (state.inventory.length) {
    const fast = [...state.inventory].sort((a, b) => (soldMap[b.id] || 0) - (soldMap[a.id] || 0))[0];
    if (fast && (soldMap[fast.id] || 0) > 0) slides.push({
      type: "fast", label: "Fast Moving", item: fast,
      sold: soldMap[fast.id] || 0, revenue: (soldMap[fast.id] || 0) * (fast.price || 0)
    });
  }
  if (state.inventory.length) {
    let topItem = null, topRev = 0;
    state.inventory.forEach(item => {
      const rev = (soldMap[item.id] || 0) * (item.price || 0);
      if (rev > topRev) { topRev = rev; topItem = item; }
    });
    if (topItem && topRev > 0) slides.push({
      type: "revenue", label: "Top Revenue", item: topItem,
      sold: soldMap[topItem.id] || 0, revenue: topRev
    });
  }
  if (state.inventory.length) {
    const low = [...state.inventory]
      .filter(i => i.quantity <= (i.threshold ?? 5))
      .sort((a, b) => (a.quantity / (a.threshold ?? 5)) - (b.quantity / (b.threshold ?? 5)))[0];
    if (low) slides.push({
      type: "low", label: "Low Stock", item: low,
      sold: soldMap[low.id] || 0, revenue: (soldMap[low.id] || 0) * (low.price || 0)
    });
  }
  const expiring = state.inventory.filter(i => {
    const e = expiryStatus(i.expiry);
    return e.level === "expiring" || e.level === "expired";
  })[0];
  if (expiring) slides.push({
    type: "expiry", label: "Expiring Soon", item: expiring,
    sold: soldMap[expiring.id] || 0, revenue: (soldMap[expiring.id] || 0) * (expiring.price || 0)
  });
  return slides;
}

export function renderCarousel() {
  const track = $("carousel-track"), dots = $("carousel-dots");
  if (!track || !dots) return;
  state.carouselSlides = buildSlides();
  if (state.carouselIndex >= state.carouselSlides.length) state.carouselIndex = 0;
  if (!state.carouselSlides.length) {
    track.innerHTML = `<div class="carousel-empty">No inventory yet — add items to see spotlight.</div>`;
    dots.innerHTML = ""; stopCarousel(); return;
  }
  track.innerHTML = state.carouselSlides.map((slide, idx) => {
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
              <div class="spotlight-sku">SKU: ${esc(item.sku)}${item.barcode ? " · " + esc(item.barcode) : ""}</div>
              <div class="spotlight-meta">
                <span>📂 ${esc(item.category)}</span>
                <span>💰 ${fmtMoney(item.price)}</span>
              </div>
            </div>
          </div>
          <div class="spotlight-stats">
            <div class="spot-stat"><span class="spot-num">${fmtInt(slide.sold)}</span><span class="spot-lab">Sold</span></div>
            <div class="spot-stat"><span class="spot-num">${fmtMoney(slide.revenue)}</span><span class="spot-lab">Revenue</span></div>
            <div class="spot-stat"><span class="spot-num">${fmtInt(item.quantity)}</span><span class="spot-lab">Stock</span></div>
          </div>
          <div class="progress-wrap">
            <div class="progress"><div class="progress-bar ${level}" style="width:${percent}%"></div></div>
            <span class="progress-label">${percent.toFixed(0)}%</span>
          </div>
        </div>
      </div>`;
  }).join("");
  dots.innerHTML = state.carouselSlides.map((_, idx) =>
    `<button class="dot ${idx === state.carouselIndex ? "active" : ""}" data-index="${idx}"></button>`).join("");
  dots.querySelectorAll(".dot").forEach(dot => {
    dot.addEventListener("click", () => {
      state.carouselIndex = parseInt(dot.dataset.index);
      updateCarouselPosition(); restartCarousel();
    });
  });
  updateCarouselPosition(); restartCarousel();
}
function updateCarouselPosition() {
  const track = $("carousel-track"), dots = $("carousel-dots");
  if (!state.carouselSlides.length || !track) return;
  track.style.transform = `translateX(-${state.carouselIndex * 100}%)`;
  dots?.querySelectorAll(".dot").forEach((d, i) => d.classList.toggle("active", i === state.carouselIndex));
}
function nextSlide() { if (!state.carouselSlides.length) return; state.carouselIndex = (state.carouselIndex + 1) % state.carouselSlides.length; updateCarouselPosition(); }
function prevSlide() { if (!state.carouselSlides.length) return; state.carouselIndex = (state.carouselIndex - 1 + state.carouselSlides.length) % state.carouselSlides.length; updateCarouselPosition(); }
export function restartCarousel() { stopCarousel(); if (state.carouselSlides.length > 1) state.carouselInterval = setInterval(nextSlide, 5000); }
export function stopCarousel() { if (state.carouselInterval) { clearInterval(state.carouselInterval); state.carouselInterval = null; } }

/* =========================================================
   EXPORTS (Excel / PDF)
   ========================================================= */
export function exportInventoryToExcel() {
  if (!state.inventory.length) { showToast("No inventory to export ❌"); return; }
  const data = state.inventory.map(i => ({
    Name: i.name, SKU: i.sku, Barcode: i.barcode || "",
    Category: i.category, Quantity: i.quantity,
    "Cost (₱)": Number((i.cost || 0).toFixed(2)),
    "Price (₱)": Number((i.price || 0).toFixed(2)),
    Threshold: i.threshold ?? 5, Expiry: i.expiry || "",
    "Stock Value (₱)": Number(((i.quantity || 0) * (i.price || 0)).toFixed(2))
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Inventory");
  downloadXLSX(wb, `inventory_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast("Inventory exported ✅");
}
export function exportInventoryToPDF() {
  if (!state.inventory.length) { showToast("No inventory to export ❌"); return; }
  if (!window.jspdf) { showToast("PDF library not loaded ❌"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16); doc.text("Inventory Report", 14, 18);
  doc.setFontSize(10); doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 24);
  doc.autoTable({
    startY: 30,
    head: [["Name", "SKU", "Barcode", "Category", "Qty", "Cost", "Price", "Expiry"]],
    body: state.inventory.map(i => [i.name, i.sku, i.barcode || "-", i.category, fmtInt(i.quantity), fmtMoney(i.cost, false), fmtMoney(i.price, false), i.expiry || "-"]),
    styles: { fontSize: 8 }, headStyles: { fillColor: [18, 84, 79] }
  });
  downloadPDF(doc, `inventory_${new Date().toISOString().slice(0,10)}.pdf`);
  showToast("Inventory PDF exported ✅");
}
export function exportSalesToExcel() {
  if (!state.sales.length) { showToast("No sales to export ❌"); return; }
  const data = state.sales.map(s => ({
    Date: s.createdAt?.toDate?.().toLocaleString() ?? "",
    Receipt: s.receiptNum || "", Item: s.itemName, Category: s.category,
    Qty: s.quantity,
    "Unit Price (₱)": Number((s.unitPrice || 0).toFixed(2)),
    "Cost (₱)": Number((s.cost || 0).toFixed(2)),
    "Profit (₱)": Number((s.profit || 0).toFixed(2)),
    "Total (₱)": Number((s.total || 0).toFixed(2)),
    Cash: Number((s.cash || 0).toFixed(2)), Change: Number((s.change || 0).toFixed(2))
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sales");
  downloadXLSX(wb, `sales_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast("Sales exported ✅");
}
export function exportSalesToPDF() {
  if (!state.sales.length) { showToast("No sales to export ❌"); return; }
  if (!window.jspdf) { showToast("PDF library not loaded ❌"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16); doc.text("Sales Report", 14, 18);
  doc.setFontSize(10); doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 24);
  doc.autoTable({
    startY: 30,
    head: [["Date", "Receipt", "Item", "Qty", "Unit", "Profit", "Total"]],
    body: state.sales.map(s => [
      s.createdAt?.toDate?.().toLocaleString() ?? "-",
      s.receiptNum || "-", s.itemName, fmtInt(s.quantity),
      fmtMoney(s.unitPrice, false), fmtMoney(s.profit, false), fmtMoney(s.total, false)
    ]),
    styles: { fontSize: 8 }, headStyles: { fillColor: [18, 84, 79] }
  });
  downloadPDF(doc, `sales_${new Date().toISOString().slice(0,10)}.pdf`);
  showToast("Sales PDF exported ✅");
}
export function exportMovementsToExcel() {
  if (!state.movements.length) { showToast("No movements to export ❌"); return; }
  const data = state.movements.map(m => ({
    Date: m.createdAt?.toDate?.().toLocaleString() ?? "",
    Item: m.itemName,
    Type: m.type === "in" ? "IN (+)" : "OUT (−)",
    Quantity: m.quantity, Reason: m.reason || "", Note: m.note || ""
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Movements");
  downloadXLSX(wb, `movements_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast("Movements exported ✅");
}
export function exportHistoryToExcel() {
  const groups = groupSalesByReceipt();
  if (!groups.length) { showToast("No history to export ❌"); return; }
  const rows = [];
  groups.forEach(g => {
    g.items.forEach(it => {
      rows.push({
        Receipt: g.receiptNum, Date: g.date?.toLocaleString() || "",
        Item: it.itemName, Category: it.category || "",
        Qty: it.quantity,
        "Unit (₱)": Number((it.unitPrice || 0).toFixed(2)),
        "Total (₱)": Number((it.total || 0).toFixed(2)),
        Cashier: g.cashier || ""
      });
    });
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "SalesHistory");
  downloadXLSX(wb, `sales_history_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast("History exported ✅");
}
export function exportHistoryToPDF() {
  const groups = groupSalesByReceipt();
  if (!groups.length) { showToast("No history to export ❌"); return; }
  if (!window.jspdf) { showToast("PDF library not loaded ❌"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16); doc.text("Sales History", 14, 18);
  doc.setFontSize(10); doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 24);
  const body = [];
  groups.forEach(g => {
    g.items.forEach((it, idx) => {
      body.push([
        idx === 0 ? g.receiptNum : "",
        idx === 0 ? (g.date?.toLocaleString() || "") : "",
        it.itemName, fmtInt(it.quantity),
        fmtMoney(it.unitPrice, false), fmtMoney(it.total, false)
      ]);
    });
  });
  doc.autoTable({
    startY: 30, head: [["Receipt", "Date", "Item", "Qty", "Unit", "Total"]],
    body, styles: { fontSize: 8 }, headStyles: { fillColor: [18, 84, 79] }
  });
  downloadPDF(doc, `sales_history_${new Date().toISOString().slice(0,10)}.pdf`);
  showToast("History PDF exported ✅");
}

/* =========================================================
   INIT
   ========================================================= */
export function initReports() {
  $("history-search")?.addEventListener("input", debounce(renderHistory, 150));
  $("history-filter")?.addEventListener("change", () => { safeRender(renderHistory); safeRender(renderHistoryCategorySummary); });
  $("history-cat-filter")?.addEventListener("change", () => { safeRender(renderHistory); safeRender(renderHistoryCategorySummary); });
  $("month-filter")?.addEventListener("change", () => {
    state.soSelectedMonth = valOf($("month-filter"));
    safeRender(renderSalesOverview);
  });
  $("carousel-prev")?.addEventListener("click", () => { prevSlide(); restartCarousel(); });
  $("carousel-next")?.addEventListener("click", () => { nextSlide(); restartCarousel(); });
  $("export-inv-excel")?.addEventListener("click", exportInventoryToExcel);
  $("export-inv-pdf")?.addEventListener("click", exportInventoryToPDF);
  $("export-sales-excel")?.addEventListener("click", exportSalesToExcel);
  $("export-sales-pdf")?.addEventListener("click", exportSalesToPDF);
  $("export-movements")?.addEventListener("click", exportMovementsToExcel);
  $("export-history-excel")?.addEventListener("click", exportHistoryToExcel);
  $("export-history-pdf")?.addEventListener("click", exportHistoryToPDF);
}
