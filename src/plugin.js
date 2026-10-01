// True sandbox-format entry: plain Block Kit JSON, no React/Kumo/host imports.

const ORDER = Object.freeze({
  number: "Order #1042",
  recipient: "Sample Recipient",
  destination: "100 Example Avenue · Anytown, CA 90210",
  paidTotal: "$48.00 USD · paid · Commerce total immutable",
});

const LINKS = Object.freeze([
  ["Provider dashboard", "https://developerhub-sandbox.shippingapi.pitneybowes.com/"],
  ["Postage balance", "https://developerhub-sandbox.shippingapi.pitneybowes.com/shipping/postage-balance"],
  ["Transaction history", "https://developerhub-sandbox.shippingapi.pitneybowes.com/shipping/transaction-history"],
]);

const COPY = {
  en: {
    orders: "Orders", settings: "Ship settings", synthetic: "Synthetic proof data",
    sample: "Select a sample order to inspect the bounded seam.", open: "Open Order #1042",
    detail: "Order #1042", label: "Make a postage label", back: "Back to Orders",
    shipping: "Shipping", review: "Review postage label", save: "Save Ship settings",
    dashboard: "Show provider dashboard links", saved: "Ship settings saved locally.",
    notConnected: "Not connected", provider: "Disabled · no provider account bound",
    funding: "Merchant funds own postage · not configured", inventory: "Not linked · not required",
    unavailable: "Provider is disabled; no rate lookup, purchase, retry, PDF, or print action is available.",
  },
  ar: {
    orders: "الطلبات", settings: "إعدادات الشحن", synthetic: "بيانات إثبات اصطناعية",
    sample: "اختر طلبًا نموذجيًا لفحص هذا المسار المحدود.", open: "فتح الطلب رقم 1042",
    detail: "الطلب رقم 1042", label: "إنشاء ملصق شحن", back: "العودة إلى الطلبات",
    shipping: "الشحن", review: "مراجعة ملصق الشحن", save: "حفظ إعدادات الشحن",
    dashboard: "إظهار روابط لوحة مزود الخدمة", saved: "تم حفظ إعدادات الشحن محليًا.",
    notConnected: "غير متصل", provider: "معطل · لا يوجد حساب مزود مرتبط",
    funding: "التاجر يمول رسوم الشحن الخاصة به · غير مهيأ", inventory: "غير مرتبط · غير مطلوب",
    unavailable: "المزود معطل؛ لا يتوفر بحث عن الأسعار أو شراء أو إعادة محاولة أو ملف PDF أو طباعة.",
  },
};

const jsonPost = (permission, handler) => ({
  permission,
  methods: ["POST"],
  request: { body: "json", maxBytes: 1024 * 1024 },
  handler,
});

const field = (label, value) => ({ label, value: String(value) });
const button = (action_id, label) => ({ type: "button", action_id, label });
const link = (label, url) => ({ type: "link", label, target: { kind: "external", url } });

function hostUi(routeCtx) {
  const ui = routeCtx?.ui;
  return {
    locale: typeof ui?.locale === "string" ? ui.locale : "en",
    direction: ui?.direction === "rtl" ? "rtl" : "ltr",
  };
}

function copy(locale) {
  return COPY[locale.split("-")[0]] ?? COPY.en;
}

async function preferences(ctx) {
  const value = await ctx.storage.preferences.get("admin");
  return value && typeof value === "object"
    ? { showDashboardLinks: value.showDashboardLinks === true }
    : { showDashboardLinks: true };
}

function context(ui) {
  return `Host locale: ${ui.locale} · Host direction: ${ui.direction} · Commerce: read-only handoff`;
}

function pageResponse(page, ui, t, saved, toast) {
  if (page === "settings") {
    const blocks = [
      { type: "header", text: t.settings },
      { type: "banner", title: t.notConnected, description: "Local package proof only.", variant: "alert" },
      { type: "fields", fields: [
        field("Provider status", t.provider),
        field("Postage funding", t.funding),
        field("Inventory", t.inventory),
      ] },
      { type: "form", fields: [{
        type: "toggle", action_id: "showDashboardLinks", label: t.dashboard,
        description: "Display-only links; opening them is outside this proof.",
        initial_value: saved.showDashboardLinks,
      }], submit: { label: t.save, action_id: "save-preferences" } },
    ];
    if (saved.showDashboardLinks) {
      blocks.push({ type: "header", text: "Provider dashboard links" });
      blocks.push({ type: "actions", elements: LINKS.map(([label, url]) => link(label, url)) });
    }
    blocks.push({ type: "context", text: context(ui) });
    return { blocks, ...(toast ? { toast } : {}) };
  }

  if (page === "order-detail") {
    return { blocks: [
      { type: "header", text: t.detail },
      { type: "banner", title: t.synthetic, description: "Display-only sample; this package does not read Commerce.", variant: "alert" },
      { type: "fields", fields: [
        field("Order", ORDER.number), field("Recipient", ORDER.recipient),
        field("Delivery", ORDER.destination), field("Paid total", ORDER.paidTotal),
        field("Inventory", t.inventory),
      ] },
      { type: "actions", elements: [button("make-postage-label", t.label), button("back-orders", t.back)] },
      { type: "context", text: "Commerce owns identity, recipient data, and immutable paid totals. Ship owns future postage state." },
    ] };
  }

  if (page === "shipping") {
    return { blocks: [
      { type: "header", text: t.shipping },
      { type: "banner", title: t.review, description: t.unavailable, variant: "alert" },
      { type: "fields", fields: [
        field("Order", ORDER.number), field("Recipient", `${ORDER.recipient} · ${ORDER.destination}`),
        field("Paid total", ORDER.paidTotal), field("Provider", t.provider),
        field("Postage", "Unavailable · requires provider setup"),
        field("Label / print", "Not created / not available"),
      ] },
      { type: "actions", elements: [button("back-order-detail", t.detail), link(t.settings, "#settings")] },
      { type: "context", text: "Merchant-funded postage remains separate from the immutable paid Commerce total." },
    ] };
  }

  return { blocks: [
    { type: "header", text: t.orders },
    { type: "banner", title: t.synthetic, description: t.sample, variant: "alert" },
    { type: "fields", fields: [field("Order", ORDER.number), field("Status", "Paid · ready for shipment review")] },
    { type: "actions", elements: [button("open-order", t.open)] },
    { type: "context", text: context(ui) },
  ] };
}

async function admin(routeCtx, ctx) {
  const ui = hostUi(routeCtx);
  const t = copy(ui.locale);
  const input = routeCtx?.input ?? {};
  let saved = await preferences(ctx);

  if (input.type === "form_submit" && input.action_id === "save-preferences") {
    saved = {
      showDashboardLinks: input.values?.showDashboardLinks === true ||
        input.values?.showDashboardLinks === "true",
    };
    await ctx.storage.preferences.put("admin", {
      ...saved, locale: ui.locale, direction: ui.direction,
    });
    return pageResponse("settings", ui, t, saved, {
      type: "success", message: t.saved,
    });
  }

  if (input.type === "block_action") {
    if (input.action_id === "open-order") return pageResponse("order-detail", ui, t, saved);
    if (input.action_id === "make-postage-label") return pageResponse("shipping", ui, t, saved);
    if (input.action_id === "back-orders") return pageResponse("orders", ui, t, saved);
    if (input.action_id === "back-order-detail") return pageResponse("order-detail", ui, t, saved);
  }

  const page = input.page?.includes("settings") ? "settings"
    : input.page?.includes("shipping") ? "shipping"
      : input.page?.includes("order-detail") ? "order-detail" : "orders";
  return pageResponse(page, ui, t, saved);
}

const plugin = {
  routes: {
    admin: jsonPost("plugins:manage", admin),
    settings: jsonPost("plugins:manage", async (_routeCtx, ctx) => ({
      ok: true, preferences: await preferences(ctx), writable: false,
    })),
    status: jsonPost("plugins:read", async (_routeCtx, ctx) => ({
      ok: true, preferences: await preferences(ctx), provider: "disabled", operations: [],
    })),
  },
};

export { admin };
export default plugin;
