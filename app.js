/* ==========================================================
   StockFlow — Real-Time Inventory + Sales + Categories
   Adds: Dark/Light theme · Live charts · Progress bars
   ========================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, onSnapshot, addDoc, updateDoc,
  deleteDoc, doc, serverTimestamp, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ----------------------------------------------------------
   ⚠️  PASTE YOUR FIREBASE CONFIG HERE
   ---------------------------------------------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyALhYN9Wufpqw8OxBlsvmEwpCrZjtGAtQo",
  authDomain: "kurt-inventory-pos.firebaseapp.com",
  projectId: "kurt-inventory-pos",
  storageBucket: "kurt-inventory-pos.firebasestorage.app",
  messagingSenderId: "480909019162",
  appId: "1:480909019162:web:c0c9c6254cac2c021ee9a3",
  measurementId: "G-N3ET64JKNG"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

/* ----------------------------------------------------------
   DOM
   ---------------------------------------------------------- */
const $ = (id) => document.getElementById(id);

/* Auth */
const authScreen=$("auth-screen"), appShell=$("app-shell"),
      authForm=$("auth-form"), authSubmit=$("auth-submit"),
      authError=$("auth-error"), emailInput=$("email"),
      passwordInput=$("password"), tabLogin=$("tab-login"),
      tabSignup=$("tab-signup"), logoutBtn=$("logout-btn"),
      userEmailEl=$("user-email");

/* Theme */
const themeToggle = $("theme-toggle");
const themeIcon   = $("theme-icon");

/* Dashboard */
const statTotal=$("stat-total"), statLow=$("stat-low"),
      statValue=$("stat-value"), statSales=$("stat-sales"),
      statCats=$("stat-cats"),   lowStockList=$("low-stock-list");

/* Sales */
const saleForm=$("sale-form"), saleItem=$("sale-item"),
      saleQty=$("sale-qty"),   salesList=$("sales-list");

/* Inventory */
const itemForm=$("item-form"), itemId=$("item-id"),
      itemName=$("item-name"), itemSku=$("item-sku"),
      itemCategory=$("item-category"), itemQty=$("item-qty"),
      itemPrice=$("item-price"), itemThreshold=$("item-threshold"),
      categoryList=$("category-list"), searchInput=$("search-input"),
      filterCat=$("filter-category"), inventoryList=$("inventory-list");

/* Categories */
const categoryForm=$("category-form"), newCategory=$("new-category"),
      categoryGrid=$("category-grid");

/* Nav + toast */
const navButtons=document.querySelectorAll(".nav-btn");
const pages=document.querySelectorAll(".page");
const toast=$("toast");

/* ----------------------------------------------------------
   STATE
   ---------------------------------------------------------- */
let inventory=[], sales=[], categories=[];
let currentUser=null, isSignupMode=false;
const unsubscribers={};

/* Chart instances */
let stockChart=null, categoryValueChart=null, salesCategoryChart=null;

/* ==========================================================
   THEME
   ========================================================== */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  themeIcon.textContent = theme === "dark" ? "☀️" : "🌙";

  // Re-render charts so legends / tooltips pick up the new palette
  if (stockChart || categoryValueChart || salesCategoryChart) {
    destroyCharts();
    renderCharts();
  }
}

themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  applyTheme(current === "dark" ? "light" : "dark");
});

/* Initialise icon on load (html attribute already set by inline script) */
themeIcon.textContent =
  document.documentElement.getAttribute("data-theme") === "dark" ? "☀️" : "🌙";

/* ==========================================================
   AUTH
   ========================================================== */
tabLogin.addEventListener("click", () => {
  isSignupMode=false; tabLogin.classList.add("active");
  tabSignup.classList.remove("active");
  authSubmit.textContent="Login"; authError.textContent="";
});
tabSignup.addEventListener("click", () => {
  isSignupMode=true; tabSignup.classList.add("active");
  tabLogin.classList.remove("active");
  authSubmit.textContent="Create Account"; authError.textContent="";
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.textContent="";
  const email=emailInput.value.trim(), password=passwordInput.value;
  try {
    if (isSignupMode) await createUserWithEmailAndPassword(auth, email, password);
    else               await signInWithEmailAndPassword(auth, email, password);
  } catch (err) { authError.textContent = friendlyAuthError(err.code); }
});

function friendlyAuthError(code) {
  const map = {
    "auth/invalid-email":"Invalid email address.",
    "auth/user-not-found":"No account found with this email.",
    "auth/wrong-password":"Incorrect password.",
    "auth/email-already-in-use":"This email is already registered.",
    "auth/weak-password":"Password should be at least 6 characters.",
    "auth/invalid-credential":"Invalid email or password."
  };
  return map[code] || "Something went wrong. Please try again.";
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    userEmailEl.textContent = user.email;
    authScreen.classList.add("hidden");
    appShell.classList.remove("hidden");
    startAllListeners();
  } else {
    currentUser = null;
    stopAllListeners();
    appShell.classList.add("hidden");
    authScreen.classList.remove("hidden");
    authForm.reset(); authError.textContent="";
  }
});

logoutBtn.addEventListener("click", () => signOut(auth));

/* ==========================================================
   REAL-TIME LISTENERS
   ========================================================== */
function startAllListeners() {
  unsubscribers.inventory = onSnapshot(
    query(collection(db,"inventory"), orderBy("name")),
    (snap) => {
      inventory = snap.docs.map(d => ({id:d.id, ...d.data()}));
      renderInventory();
      renderLowStockAlerts();
      updateStats();
      populateCategoryFilter();
      populateCategoryDatalist();
      populateSaleItemSelect();
      renderCharts();
    }
  );

  unsubscribers.sales = onSnapshot(
    query(collection(db,"sales"), orderBy("createdAt","desc"), limit(50)),
    (snap) => {
      sales = snap.docs.map(d => ({id:d.id, ...d.data()}));
      renderSales();
      updateStats();
      renderCharts();
    }
  );

  unsubscribers.categories = onSnapshot(
    query(collection(db,"categories"), orderBy("name")),
    (snap) => {
      categories = snap.docs.map(d => ({id:d.id, ...d.data()}));
      renderCategories();
      updateStats();
      populateCategoryDatalist();
    }
  );
}

function stopAllListeners() {
  Object.values(unsubscribers).forEach(u => u && u());
  Object.keys(unsubscribers).forEach(k => delete unsubscribers[k]);
  destroyCharts();
}

/* ==========================================================
   SPA NAVIGATION
   ========================================================== */
navButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    navButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    pages.forEach(p => p.classList.add("hidden"));
    const target = $(btn.dataset.page);
    if (target) target.classList.remove("hidden");
    // Charts must be redrawn if dashboard becomes visible
    if (btn.dataset.page === "page-dashboard") renderCharts();
  });
});

/* ==========================================================
   PROGRESS BAR HELPERS
   ========================================================== */
function stockProgress(item) {
  const threshold = item.threshold ?? 5;
  const capacity  = Math.max(threshold * 3, 1);
  const percent   = Math.min((item.quantity / capacity) * 100, 100);

  let level = "high";
  if (item.quantity === 0 || item.quantity <= threshold) level = "low";
  else if (item.quantity <= threshold * 2)               level = "medium";

  return { percent, level };
}

/* ==========================================================
   RENDER — Inventory cards (with progress bar)
   ========================================================== */
function renderInventory() {
  const searchTerm = searchInput.value.toLowerCase();
  const catFilter  = filterCat.value;

  const filtered = inventory.filter(item => {
    const matchSearch =
      !searchTerm ||
      item.name.toLowerCase().includes(searchTerm) ||
      item.sku.toLowerCase().includes(searchTerm);
    const matchCat = !catFilter || item.category === catFilter;
    return matchSearch && matchCat;
  });

  if (!filtered.length) {
    inventoryList.innerHTML = `<div class="empty-state"><p>📭 No items found.</p></div>`;
    return;
  }

  inventoryList.innerHTML = filtered.map(item => {
    const isLow = item.quantity <= (item.threshold ?? 5);
    const { percent, level } = stockProgress(item);
    return `
      <div class="item-card ${isLow ? "low-stock" : ""}">
        <div class="item-header">
          <div>
            <div class="item-name">${esc(item.name)}</div>
            <div class="item-sku">SKU: ${esc(item.sku)}</div>
          </div>
          <span class="badge ${isLow ? "low" : "ok"}">${isLow ? "Low Stock" : "In Stock"}</span>
        </div>
        <div class="item-meta">
          <span>📂 ${esc(item.category)}</span>
          <span>📦 Qty: ${item.quantity}</span>
          <span>💰 $${Number(item.price).toFixed(2)}</span>
        </div>
        <div class="progress-wrap">
          <div class="progress"><div class="progress-bar ${level}" style="width:${percent}%"></div></div>
          <span class="progress-label">${percent.toFixed(0)}%</span>
        </div>
        <div class="item-actions">
          <button class="btn ghost" onclick="editItem('${item.id}')">Edit</button>
          <button class="btn danger" onclick="deleteItem('${item.id}')">Delete</button>
        </div>
      </div>`;
  }).join("");
}

function renderLowStockAlerts() {
  const low = inventory.filter(i => i.quantity <= (i.threshold ?? 5));
  if (!low.length) {
    lowStockList.innerHTML = `<div class="empty-state"><p>✅ All items are well stocked.</p></div>`;
    return;
  }
  lowStockList.innerHTML = low.map(item => {
    const { percent, level } = stockProgress(item);
    return `
      <div class="item-card low-stock">
        <div class="item-header">
          <div>
            <div class="item-name">${esc(item.name)}</div>
            <div class="item-sku">SKU: ${esc(item.sku)}</div>
          </div>
          <span class="badge low">Low Stock</span>
        </div>
        <div class="item-meta">
          <span>📦 Qty: ${item.quantity}</span>
          <span>⚠️ Threshold: ${item.threshold ?? 5}</span>
        </div>
        <div class="progress-wrap">
          <div class="progress"><div class="progress-bar ${level}" style="width:${percent}%"></div></div>
          <span class="progress-label">${percent.toFixed(0)}%</span>
        </div>
      </div>`;
  }).join("");
}

/* ==========================================================
   RENDER — Sales
   ========================================================== */
function renderSales() {
  if (!sales.length) {
    salesList.innerHTML = `<div class="empty-state"><p>🛒 No sales recorded yet.</p></div>`;
    return;
  }
  salesList.innerHTML = sales.map(s => {
    const date = s.createdAt?.toDate?.().toLocaleString() ?? "Just now";
    return `
      <div class="sale-row">
        <div>
          <div>${esc(s.itemName)} × ${s.quantity}</div>
          <div class="sale-date">${date}</div>
        </div>
        <div class="sale-total">$${Number(s.total).toFixed(2)}</div>
      </div>`;
  }).join("");
}

/* ==========================================================
   RENDER — Categories
   ========================================================== */
function renderCategories() {
  if (!categories.length) {
    categoryGrid.innerHTML = `<div class="empty-state"><p>🗂️ No categories yet.</p></div>`;
    return;
  }
  categoryGrid.innerHTML = categories.map(cat => {
    const count = inventory.filter(i => i.category === cat.name).length;
    return `
      <div class="category-card">
        <div>
          <div class="cat-name">${esc(cat.name)}</div>
          <div class="cat-count">${count} item${count !== 1 ? "s" : ""}</div>
        </div>
        <button class="btn danger" onclick="deleteCategory('${cat.id}')">✕</button>
      </div>`;
  }).join("");
}

/* ==========================================================
   STATS
   ========================================================== */
function updateStats() {
  const total = inventory.length;
  const low   = inventory.filter(i => i.quantity <= (i.threshold ?? 5)).length;
  const value = inventory.reduce((s, i) => s + (i.quantity * i.price || 0), 0);

  const today = new Date(); today.setHours(0,0,0,0);
  const todaySales = sales
    .filter(s => s.createdAt?.toDate?.() >= today)
    .reduce((s, sale) => s + (sale.total || 0), 0);

  statTotal.textContent = total;
  statLow.textContent   = low;
  statValue.textContent = "$" + value.toFixed(2);
  statSales.textContent = "$" + todaySales.toFixed(2);
  statCats.textContent  = categories.length;
}

/* ==========================================================
   CHART.JS — real-time analytics
   ========================================================== */
const CATEGORY_PALETTE = [
  "#6366f1","#8b5cf6","#ec4899","#f59e0b",
  "#10b981","#06b6d4","#f43f5e","#84cc16"
];

function getCSSVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function commonChartOptions(legendColor) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          color: legendColor,
          padding: 12,
          font: { size: 12 },
          boxWidth: 14,
          usePointStyle: true
        }
      }
    }
  };
}

function renderCharts() {
  if (typeof Chart === "undefined") return;       // Chart.js not loaded yet
  if (!inventory.length && !sales.length) return;

  const textColor = getCSSVar("--text") || "#1e293b";

  /* ---------- 1. Stock Status (doughnut) ---------- */
  const inStock  = inventory.filter(i => i.quantity >  (i.threshold ?? 5)).length;
  const lowStock = inventory.filter(i => i.quantity > 0 && i.quantity <= (i.threshold ?? 5)).length;
  const outStock = inventory.filter(i => i.quantity === 0).length;

  const stockData = {
    labels: ["In Stock", "Low Stock", "Out of Stock"],
    datasets: [{
      data: [inStock, lowStock, outStock],
      backgroundColor: ["#22c55e", "#f59e0b", "#ef4444"],
      borderWidth: 0,
      hoverOffset: 6
    }]
  };

  if (stockChart) {
    stockChart.data = stockData;
    stockChart.options.plugins.legend.labels.color = textColor;
    stockChart.update("none");
  } else {
    stockChart = new Chart($("stock-status-chart"), {
      type: "doughnut",
      data: stockData,
      options: {
        ...commonChartOptions(textColor),
        cutout: "62%",
        plugins: {
          ...commonChartOptions(textColor).plugins,
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((a,b)=>a+b,0) || 1;
                const pct = ((ctx.parsed / total) * 100).toFixed(1);
                return `${ctx.label}: ${ctx.parsed} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  /* ---------- 2. Value by Category (pie) ---------- */
  const valueByCat = {};
  inventory.forEach(i => {
    valueByCat[i.category] = (valueByCat[i.category] || 0) + (i.quantity * i.price || 0);
  });
  const catLabels = Object.keys(valueByCat);
  const catValues = Object.values(valueByCat);

  const catData = {
    labels: catLabels.length ? catLabels : ["No data"],
    datasets: [{
      data: catValues.length ? catValues : [1],
      backgroundColor: catLabels.length
        ? catLabels.map((_, i) => CATEGORY_PALETTE[i % CATEGORY_PALETTE.length])
        : ["#e2e8f0"],
      borderWidth: 0,
      hoverOffset: 6
    }]
  };

  if (categoryValueChart) {
    categoryValueChart.data = catData;
    categoryValueChart.options.plugins.legend.labels.color = textColor;
    categoryValueChart.update("none");
  } else {
    categoryValueChart = new Chart($("category-value-chart"), {
      type: "pie",
      data: catData,
      options: {
        ...commonChartOptions(textColor),
        plugins: {
          ...commonChartOptions(textColor).plugins,
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: $${Number(ctx.parsed).toFixed(2)}`
            }
          }
        }
      }
    });
  }

  /* ---------- 3. Sales by Category (pie) ---------- */
  const salesByCat = {};
  sales.forEach(s => {
    const key = s.category || "Unknown";
    salesByCat[key] = (salesByCat[key] || 0) + (s.total || 0);
  });
  const salesLabels = Object.keys(salesByCat);
  const salesValues = Object.values(salesByCat);

  const salesData = {
    labels: salesLabels.length ? salesLabels : ["No sales yet"],
    datasets: [{
      data: salesValues.length ? salesValues : [1],
      backgroundColor: salesLabels.length
        ? salesLabels.map((_, i) => CATEGORY_PALETTE[(i + 3) % CATEGORY_PALETTE.length])
        : ["#e2e8f0"],
      borderWidth: 0,
      hoverOffset: 6
    }]
  };

  if (salesCategoryChart) {
    salesCategoryChart.data = salesData;
    salesCategoryChart.options.plugins.legend.labels.color = textColor;
    salesCategoryChart.update("none");
  } else {
    salesCategoryChart = new Chart($("sales-category-chart"), {
      type: "pie",
      data: salesData,
      options: {
        ...commonChartOptions(textColor),
        plugins: {
          ...commonChartOptions(textColor).plugins,
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: $${Number(ctx.parsed).toFixed(2)}`
            }
          }
        }
      }
    });
  }
}

function destroyCharts() {
  [stockChart, categoryValueChart, salesCategoryChart].forEach(c => c && c.destroy());
  stockChart = categoryValueChart = salesCategoryChart = null;
}

/* ==========================================================
   SELECTS / DATALISTS
   ========================================================== */
function populateCategoryFilter() {
  const names = [...new Set(inventory.map(i => i.category))].sort();
  const current = filterCat.value;
  filterCat.innerHTML = `<option value="">All Categories</option>` +
    names.map(c => `<option value="${c}">${c}</option>`).join("");
  filterCat.value = current;
}

function populateCategoryDatalist() {
  const names = [...new Set([
    ...categories.map(c => c.name),
    ...inventory.map(i => i.category)
  ])].sort();
  categoryList.innerHTML = names.map(c => `<option value="${c}">`).join("");
}

function populateSaleItemSelect() {
  const current = saleItem.value;
  saleItem.innerHTML = `<option value="">Select item…</option>` +
    inventory.map(i => `<option value="${i.id}">${esc(i.name)} (${i.quantity} left)</option>`).join("");
  saleItem.value = current;
}

searchInput.addEventListener("input", renderInventory);
filterCat.addEventListener("change", renderInventory);

/* ==========================================================
   ADD / EDIT ITEM
   ========================================================== */
itemForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = {
    name:      itemName.value.trim(),
    sku:       itemSku.value.trim(),
    category:  itemCategory.value.trim(),
    quantity:  Number(itemQty.value),
    price:     Number(itemPrice.value),
    threshold: Number(itemThreshold.value),
    updatedAt: serverTimestamp()
  };
  try {
    if (itemId.value) {
      await updateDoc(doc(db, "inventory", itemId.value), data);
      showToast("Item updated ✅");
    } else {
      await addDoc(collection(db, "inventory"), { ...data, createdAt: serverTimestamp() });
      showToast("Item added ✅");
    }
    itemForm.reset(); itemId.value=""; itemThreshold.value=5;
  } catch (err) { console.error(err); showToast("Failed to save item ❌"); }
});

window.editItem = (id) => {
  const item = inventory.find(i => i.id === id);
  if (!item) return;
  itemId.value        = item.id;
  itemName.value      = item.name;
  itemSku.value       = item.sku;
  itemCategory.value  = item.category;
  itemQty.value       = item.quantity;
  itemPrice.value     = item.price;
  itemThreshold.value = item.threshold ?? 5;
  document.querySelector('[data-page="page-add"]').click();
  window.scrollTo({ top: 0, behavior: "smooth" });
};

window.deleteItem = async (id) => {
  if (!confirm("Delete this item permanently?")) return;
  try { await deleteDoc(doc(db,"inventory", id)); showToast("Item deleted 🗑️"); }
  catch (err) { console.error(err); showToast("Failed to delete ❌"); }
};

/* ==========================================================
   RECORD A SALE
   ========================================================== */
saleForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const chosenId = saleItem.value;
  const qty      = Number(saleQty.value);
  const item     = inventory.find(i => i.id === chosenId);

  if (!item)         { showToast("Please select an item ❌"); return; }
  if (qty > item.quantity) { showToast("Not enough stock ❌"); return; }

  try {
    await addDoc(collection(db, "sales"), {
      itemId:    item.id,
      itemName:  item.name,
      category:  item.category,         // <-- stored for the pie chart
      quantity:  qty,
      unitPrice: item.price,
      total:     qty * item.price,
      createdAt: serverTimestamp(),
      userId:    currentUser.uid
    });
    await updateDoc(doc(db, "inventory", item.id), {
      quantity:  item.quantity - qty,
      updatedAt: serverTimestamp()
    });
    saleForm.reset();
    showToast("Sale recorded ✅");
  } catch (err) { console.error(err); showToast("Failed to record sale ❌"); }
});

/* ==========================================================
   CATEGORIES
   ========================================================== */
categoryForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = newCategory.value.trim();
  if (!name) return;
  if (categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    showToast("Category already exists ❌"); return;
  }
  try {
    await addDoc(collection(db, "categories"), { name, createdAt: serverTimestamp() });
    newCategory.value = "";
    showToast("Category added ✅");
  } catch (err) { console.error(err); showToast("Failed to add category ❌"); }
});

window.deleteCategory = async (id) => {
  if (!confirm("Delete this category?")) return;
  try { await deleteDoc(doc(db,"categories", id)); showToast("Category deleted 🗑️"); }
  catch (err) { console.error(err); showToast("Failed to delete ❌"); }
};

/* ==========================================================
   UTILITIES
   ========================================================== */
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.add("hidden"), 2500);
}

function esc(str) {
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}