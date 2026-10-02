// True sandbox-format entry: plain Block Kit JSON, no React/Kumo/host imports.

const LINK_URLS = Object.freeze([
  "https://developerhub-sandbox.shippingapi.pitneybowes.com/",
  "https://developerhub-sandbox.shippingapi.pitneybowes.com/shipping/postage-balance",
  "https://developerhub-sandbox.shippingapi.pitneybowes.com/shipping/transaction-history",
]);

const COPY = {
  en: {
    orders: "Orders", settings: "Ship settings", unavailableData: "Commerce order data unavailable",
    emptyOrders: "No trusted Commerce order is mounted. This package is ready for a bounded Core handoff.",
    proposeHandoff: "Propose a Commerce order handoff", handoff: "Proposed handoff · not mounted",
    handoffDescription: "Core may provide one immutable paid order snapshot here; no Commerce capability is mounted.",
    synthetic: "Synthetic proof fixture",
    sample: "Use the explicit isolated fixture only to test this package seam.",
    open: "Open synthetic fixture", detail: "Synthetic order fixture",
    label: "Make a postage label", back: "Back to Orders", shipping: "Shipping",
    review: "Review postage label", save: "Save Ship settings",
    dashboard: "Show provider dashboard links", saved: "Ship settings saved locally.",
    notConnected: "Not connected", provider: "Disabled · no provider account bound",
    funding: "Merchant funds own postage · not configured", inventory: "Not linked · not required",
    unavailable: "Provider is disabled; no rate lookup, purchase, retry, PDF, or print action is available.",
    localProof: "Local package proof only.", dashboardLinks: "Provider dashboard links",
    displayOnlyLinks: "Display-only links; opening them is outside this proof.",
    commerceOwnership: "Commerce owns identity, recipient data, and immutable paid totals. Ship owns future postage state.",
    postageOwnership: "Merchant-funded postage remains separate from the immutable paid Commerce total.",
    order: "Order", recipient: "Recipient", delivery: "Delivery", paidTotal: "Paid total",
    status: "Status", ready: "Paid · ready for shipment review", inventoryLabel: "Inventory", postage: "Postage",
    postageUnavailable: "Unavailable · requires provider setup", labelPrint: "Label / print",
    labelUnavailable: "Not created / not available", providerField: "Provider",
    providerDashboard: "Provider dashboard", postageBalance: "Postage balance", transactionHistory: "Transaction history",
    context: (ui) => `Host locale: ${ui.locale} · Host direction: ${ui.direction} · Commerce: read-only handoff`,
    commerceReadOnly: "Commerce: read-only handoff",
    fixtureBanner: "Display-only isolated test fixture; this package does not read Commerce.",
    fixtureOrder: { number: "Order #1042", recipient: "Sample Recipient", destination: "100 Example Avenue · Anytown, CA 90210", paidTotal: "$48.00 USD · paid · Commerce total immutable" },
  },
  ar: {
    orders: "الطلبات", settings: "إعدادات الشحن", unavailableData: "بيانات طلب Commerce غير متاحة",
    emptyOrders: "لا يوجد طلب موثوق من Commerce. الحزمة جاهزة لتسليم محدود إلى Core.",
    proposeHandoff: "اقتراح تسليم طلب Commerce", handoff: "تسليم مقترح · غير مركّب",
    handoffDescription: "يمكن لـ Core توفير لقطة واحدة ثابتة لطلب مدفوع هنا؛ لا توجد قدرة Commerce مركّبة.",
    synthetic: "بيانات اختبار اصطناعية", sample: "استخدم بيانات الاختبار المعزولة الصريحة فقط لاختبار هذه الحزمة.",
    open: "فتح بيانات الاختبار", detail: "طلب اختبار اصطناعي",
    label: "إنشاء ملصق شحن", back: "العودة إلى الطلبات", shipping: "الشحن",
    review: "مراجعة ملصق الشحن", save: "حفظ إعدادات الشحن",
    dashboard: "إظهار روابط لوحة مزود الخدمة", saved: "تم حفظ إعدادات الشحن محليًا.",
    notConnected: "غير متصل", provider: "معطل · لا يوجد حساب مزود مرتبط",
    funding: "التاجر يمول رسوم الشحن الخاصة به · غير مهيأ", inventory: "غير مرتبط · غير مطلوب",
    unavailable: "المزود معطل؛ لا يتوفر بحث عن الأسعار أو شراء أو إعادة محاولة أو ملف PDF أو طباعة.",
    localProof: "إثبات الحزمة المحلية فقط.", dashboardLinks: "روابط لوحة مزود الخدمة",
    displayOnlyLinks: "روابط للعرض فقط؛ فتحها خارج نطاق هذا الإثبات.",
    commerceOwnership: "يمتلك Commerce الهوية وبيانات المستلم والإجماليات المدفوعة الثابتة. يمتلك Ship حالة الشحن المستقبلية.",
    postageOwnership: "تبقى رسوم الشحن التي يمولها التاجر منفصلة عن إجمالي Commerce المدفوع والثابت.",
    order: "الطلب", recipient: "المستلم", delivery: "التسليم", paidTotal: "الإجمالي المدفوع",
    status: "الحالة", inventoryLabel: "المخزون", ready: "مدفوع · جاهز لمراجعة الشحن", postage: "رسوم الشحن",
    postageUnavailable: "غير متاح · يتطلب إعداد المزود", labelPrint: "الملصق / الطباعة",
    labelUnavailable: "لم يُنشأ / غير متاح", providerField: "المزود",
    providerDashboard: "لوحة مزود الخدمة", postageBalance: "رصيد رسوم الشحن", transactionHistory: "سجل المعاملات",
    context: (ui) => `لغة المضيف: ${ui.locale} · اتجاه المضيف: ${ui.direction} · Commerce: تسليم للقراءة فقط`,
    commerceReadOnly: "Commerce: تسليم للقراءة فقط",
    fixtureBanner: "بيانات اختبار معزولة للعرض فقط؛ هذه الحزمة لا تقرأ Commerce.",
    fixtureOrder: { number: "الطلب رقم 1042", recipient: "مستلم نموذجي", destination: "100 شارع المثال · أني تاون، كاليفورنيا 90210", paidTotal: "48.00 دولار أمريكي · مدفوع · إجمالي Commerce ثابت" },
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

function pageResponse(page, ui, t, saved, toast) {
  if (page === "settings") {
    const blocks = [
      { type: "header", text: t.settings },
      { type: "banner", title: t.notConnected, description: t.localProof, variant: "alert" },
      { type: "fields", fields: [
        field("Provider status", t.provider),
        field("Postage funding", t.funding),
        field("Inventory", t.inventory),
      ] },
      { type: "form", fields: [{
        type: "toggle", action_id: "showDashboardLinks", label: t.dashboard,
        description: t.displayOnlyLinks,
        initial_value: saved.showDashboardLinks,
      }], submit: { label: t.save, action_id: "save-preferences" } },
    ];
    if (saved.showDashboardLinks) {
      blocks.push({ type: "header", text: t.dashboardLinks });
      blocks.push({ type: "actions", elements: LINK_URLS.map((url, index) => link([
        t.providerDashboard, t.postageBalance, t.transactionHistory,
      ][index], url)) });
    }
    blocks.push({ type: "context", text: t.context(ui) });
    return { blocks, ...(toast ? { toast } : {}) };
  }

  if (page === "order-detail") {
    return { blocks: [
      { type: "header", text: t.detail },
      { type: "banner", title: t.synthetic, description: t.fixtureBanner, variant: "alert" },
      { type: "fields", fields: [
        field(t.order, t.fixtureOrder.number), field(t.recipient, t.fixtureOrder.recipient),
        field(t.delivery, t.fixtureOrder.destination), field(t.paidTotal, t.fixtureOrder.paidTotal),
        field(t.inventoryLabel, t.inventory),
      ] },
      { type: "actions", elements: [button("make-postage-label", t.label), button("back-orders", t.back)] },
      { type: "context", text: t.commerceOwnership },
    ] };
  }

  if (page === "shipping") {
    return { blocks: [
      { type: "header", text: t.shipping },
      { type: "banner", title: t.review, description: t.unavailable, variant: "alert" },
      { type: "fields", fields: [
        field(t.order, t.fixtureOrder.number), field(t.recipient, `${t.fixtureOrder.recipient} · ${t.fixtureOrder.destination}`),
        field(t.paidTotal, t.fixtureOrder.paidTotal), field(t.providerField, t.provider),
        field(t.postage, t.postageUnavailable),
        field(t.labelPrint, t.labelUnavailable),
      ] },
      { type: "actions", elements: [button("back-order-detail", t.detail), link(t.settings, "#settings")] },
      { type: "context", text: t.postageOwnership },
    ] };
  }

  return { blocks: [
    { type: "header", text: t.orders },
    { type: "banner", title: t.unavailableData, description: t.emptyOrders, variant: "alert" },
    { type: "fields", fields: [field(t.status, t.handoff), field(t.commerceReadOnly, t.handoffDescription)] },
    { type: "actions", elements: [button("propose-order-handoff", t.proposeHandoff)] },
    { type: "context", text: t.context(ui) },
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
    if (input.action_id === "open-order" && input.fixture === "synthetic-order-1042") {
      return pageResponse("order-detail", ui, t, saved);
    }
    if (input.action_id === "make-postage-label") return pageResponse("shipping", ui, t, saved);
    if (input.action_id === "back-orders") return pageResponse("orders", ui, t, saved);
    if (input.action_id === "back-order-detail") return pageResponse("order-detail", ui, t, saved);
  }

  const page = input.fixture === "synthetic-order-1042" && input.page?.includes("order-detail")
    ? "order-detail"
    : input.page?.includes("settings") ? "settings"
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
