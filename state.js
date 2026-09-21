/* state.js — shared app state + constants */
export const state = {
  inventory: [],
  sales: [],
  categories: [],
  allUsers: [],
  movements: [],
  currentUser: null,
  currentUserData: null,
  isSignupMode: false,
  posCart: [],
  unsubscribers: {},
  unsubscribeUserDoc: null,

  // charts
  stockChart: null,
  categoryValueChart: null,
  salesCategoryChart: null,
  salesTrendChart: null,
  profitTrendChart: null,
  chartJsReady: false,
  chartRenderQueued: false,

  // carousel
  carouselSlides: [],
  carouselIndex: 0,
  carouselInterval: null,
  posMiniTimer: null,
  posMiniIndex: 0,
  authBgTimer: null,
  authBgIndex: 0,

  // sound
  soundEnabled: localStorage.getItem("soundEnabled") !== "false",

  // sku
  manualSku: false,
  skuInitialized: false,

  // modal state
  restockItemId: null,
  currentReceiptGroup: null,
  currentMovementId: null,
  catImageCategoryId: null,
  soSelectedMonth: "",
  checkoutBusy: false,

  // scanner
  scanner: {
    instance: null,
    state: "idle",
    opening: false,
    target: null,
    session: 0,
    lastScanCode: "",
    lastScanTime: 0,
    scanHandling: false,
    matchFlashTimer: null
  }
};

export const CONSTANTS = {
  SUPER_ADMIN_EMAIL: "madronerokurt04@gmail.com",
  STORE_NAME: "Kurt Inventory",
  STORE_TAGLINE: "Smart Stock & Sales",
  NEW_ARRIVAL_WINDOW_MS: 24 * 60 * 60 * 1000,
  FAST_SELLING: { minTotalSold: 10, lookbackDays: 7, minPerDay: 1 },
  EXPIRY_WARNING_DAYS: 30,
  CATEGORY_IMAGE_API: {
  /* "pexels" (recommended for product photos) | "unsplash" | "openverse" | "wikipedia" */
  provider: "pexels",
  keys: {
    pexels:    "LVoL2s2p3Ur7lFt1T6D5dvICH64tWmP2u4Fis5GbVGGlX1luCCuvtzcu",
    unsplash:  ""   // optional
  },
  perPage: 15,
  timeoutMs: 10000,
  /* Appended to every category name. "grocery product philippines"
     returns actual store-shelf photos on Pexels. */
  keyword: "grocery product",
  /* Optional: boost per-category terms. If the category name
     contains one of these words, the mapped keyword is used. */
  keywordMap: {
    snacks:     "snack packet",
    drinks:     "beverage bottle",
    beverages:  "beverage bottle",
    canned:     "canned goods",
    noodles:    "instant noodles",
    rice:       "rice sack",
    soap:       "bar soap",
    shampoo:    "shampoo bottle",
    detergent:  "laundry detergent",
    coffee:     "coffee sachet",
    milk:       "milk carton",
    bread:      "bread loaf",
    candy:      "candy sweets",
    cigarettes: "cigarette pack",
    school:     "school supplies",
    toiletries: "toiletries",
    household:  "household cleaning"
  }
},
  DEFAULT_AUTH_BG_IMAGES: ["THUMB.png", "1.jpg", "4.jpg", "2.jpg"],
  FALLBACK_AUTH_BG_IMAGES: [
    "https://picsum.photos/seed/kurt-store-1/1920/1080",
    "https://picsum.photos/seed/kurt-store-2/1920/1080",
    "https://picsum.photos/seed/kurt-store-3/1920/1080"
  ],
  AUTH_BG_INTERVAL_MS: 6000,
  FALLBACK_COLORS: ["#12544F", "#2FA38F", "#5FC2A6", "#0C3E3A", "#16665F", "#0F4945"],
  CATEGORY_PALETTE: ["#12544F", "#2FA38F", "#5FC2A6", "#0C3E3A", "#16665F", "#0F4945", "#E8B33A", "#D79A6A"],
  SCAN_COOLDOWN_MS: 1500,
  SCAN_FPS: 10,
  SCAN_BOX: { w: 0.88, h: 0.56 },
  SCAN_VIDEO: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
  SCANNER_STATE: { IDLE: "idle", STARTING: "starting", RUNNING: "running", STOPPING: "stopping" }
};
