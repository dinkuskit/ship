// True sandbox-format entry: plain Block Kit JSON, no React/Kumo/host imports.

const MAX_WEIGHT_LB = 70;
const MAX_PRIORITY_LENGTH_PLUS_GIRTH_IN = 108;

const SYNTHETIC_DESTINATION = Object.freeze({
  country: "US",
  addressLine: "100 Example Avenue",
  city: "Anytown",
  region: "CA",
  postalCode: "90210",
});

const SYNTHETIC_PAID_TOTAL = Object.freeze({
  amount: 48,
  currency: "USD",
  status: "paid",
});

function invalid(code, message) {
  return Object.freeze({ ok: false, code, message });
}

function decimal(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.length > 30 || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validatePackage(packageInput) {
  const weightLb = decimal(packageInput?.weightLb);
  const lengthIn = decimal(packageInput?.lengthIn);
  const widthIn = decimal(packageInput?.widthIn);
  const heightIn = decimal(packageInput?.heightIn);
  if ([weightLb, lengthIn, widthIn, heightIn].some((value) => value === null)) {
    return invalid("invalid_number", "Weight and dimensions must be finite decimal values.");
  }
  if ([weightLb, lengthIn, widthIn, heightIn].some((value) => value <= 0)) {
    return invalid("nonpositive", "Weight and dimensions must be greater than zero.");
  }
  if (weightLb > MAX_WEIGHT_LB) {
    return invalid("weight_out_of_range", `Weight must be no more than ${MAX_WEIGHT_LB} lb.`);
  }
  const [longest, middle, shortest] = [lengthIn, widthIn, heightIn].sort((a, b) => b - a);
  if (longest + (2 * (middle + shortest)) > MAX_PRIORITY_LENGTH_PLUS_GIRTH_IN) {
    return invalid(
      "dimensions_out_of_range",
      `Length plus girth must be no more than ${MAX_PRIORITY_LENGTH_PLUS_GIRTH_IN} in.`,
    );
  }
  return Object.freeze({ ok: true, package: Object.freeze({
    weight: weightLb,
    weightUnit: "lb",
    dimensions: Object.freeze({ length: lengthIn, width: widthIn, height: heightIn, unit: "in" }),
  }) });
}

export function projectSyntheticQuoteRequest({ order, package: packageInput } = {}) {
  if (order?.fixture !== "synthetic-order-1042") {
    return invalid("no_order", "A synthetic fixture order is required before package review.");
  }
  const result = validatePackage(packageInput);
  if (!result.ok) return result;
  return Object.freeze({
    ok: true,
    request: Object.freeze({
      destination: SYNTHETIC_DESTINATION,
      package: result.package,
      service: "USPS Priority Mail",
      quotePrerequisite: "commerce_unavailable",
      operationGate: "original_provider_unknown",
    }),
    paidTotal: SYNTHETIC_PAID_TOTAL,
  });
}

export { SYNTHETIC_DESTINATION, SYNTHETIC_PAID_TOTAL, validatePackage };


const LINK_URLS = Object.freeze([
  "https://developerhub-sandbox.shippingapi.pitneybowes.com/",
  "https://developerhub-sandbox.shippingapi.pitneybowes.com/shipping/postage-balance",
  "https://developerhub-sandbox.shippingapi.pitneybowes.com/shipping/transaction-history",
]);

const COPY = {
  en: {
    orders: "Orders", settings: "Ship settings", unavailableData: "Commerce order data unavailable",
    emptyOrders: "No trusted Commerce order is mounted. This package is ready for a bounded Core handoff.",
    handoff: "No Commerce order mounted",
    handoffDescription: "Core has not mounted an immutable paid order snapshot; Ship remains read-only.",
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
    providerStatus: "Provider status", postageFunding: "Postage funding",
    postageUnavailable: "Unavailable · requires provider setup", labelPrint: "Label / print",
    labelUnavailable: "Not created / not available", providerField: "Provider",
    providerDashboard: "Provider dashboard", postageBalance: "Postage balance", transactionHistory: "Transaction history",
    package: "Package", weight: "Weight (lb)", dimensions: "Dimensions (in)",
    quotePrerequisite: "Quote prerequisite", quoteUnavailable: "Unavailable · Commerce order binding is not available",
    operationGate: "Operation gate", operationUnknown: "Original provider outcome unknown · blocked",
    validation: "Package validation", valid: "Valid fixture package · quote request projection ready",
    editPackage: "Edit package", updatePackage: "Update package", invalidPackage: "Package needs correction",
    context: (ui) => `Host locale: ${ui.locale} · Host direction: ${ui.direction} · Commerce: read-only handoff`,
    commerceReadOnly: "Commerce: read-only handoff",
    fixtureBanner: "Display-only isolated test fixture; this package does not read Commerce.",
    fixtureOrder: { number: "Order #1042", recipient: "Sample Recipient", destination: "100 Example Avenue · Anytown, CA 90210", paidTotal: "$48.00 USD · paid · Commerce total immutable" },
  },
  ar: {
    orders: "الطلبات", settings: "إعدادات الشحن", unavailableData: "بيانات طلب Commerce غير متاحة",
    emptyOrders: "لا يوجد طلب موثوق من Commerce. الحزمة جاهزة لتسليم محدود إلى Core.",
    handoff: "لا يوجد طلب Commerce مركّب",
    handoffDescription: "لم يركّب Core لقطة ثابتة لطلب مدفوع؛ يظل Ship للقراءة فقط.",
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
    providerStatus: "حالة المزود", postageFunding: "تمويل رسوم الشحن",
    postageUnavailable: "غير متاح · يتطلب إعداد المزود", labelPrint: "الملصق / الطباعة",
    labelUnavailable: "لم يُنشأ / غير متاح", providerField: "المزود",
    providerDashboard: "لوحة مزود الخدمة", postageBalance: "رصيد رسوم الشحن", transactionHistory: "سجل المعاملات",
    package: "الطرد", weight: "الوزن (رطل)", dimensions: "الأبعاد (بوصة)",
    quotePrerequisite: "متطلب عرض السعر", quoteUnavailable: "غير متاح · ربط طلب Commerce غير متاح",
    operationGate: "بوابة العملية", operationUnknown: "نتيجة المزود الأصلية غير معروفة · محظورة",
    validation: "التحقق من الطرد", valid: "طرد الاختبار صالح · إسقاط طلب عرض السعر جاهز",
    editPackage: "تعديل الطرد", updatePackage: "تحديث الطرد", invalidPackage: "يحتاج الطرد إلى تصحيح",
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

const DEFAULT_PACKAGE = Object.freeze({ weightLb: "2", lengthIn: "10", widthIn: "8", heightIn: "4" });

function packageForm(t, values, submitLabel = t.updatePackage) {
  return {
    type: "form",
    fields: [
      { type: "text_input", action_id: "weightLb", label: t.weight, initial_value: values.weightLb },
      { type: "text_input", action_id: "lengthIn", label: "Length", initial_value: values.lengthIn },
      { type: "text_input", action_id: "widthIn", label: "Width", initial_value: values.widthIn },
      { type: "text_input", action_id: "heightIn", label: "Height", initial_value: values.heightIn },
    ],
    submit: { label: submitLabel, action_id: "update-package" },
  };
}

function pageResponse(page, ui, t, saved, toast, fixture = false, packageValues = DEFAULT_PACKAGE, packageResult = null) {
  const fixtureOrder = t.fixtureOrder;
  if (page === "settings") {
    const blocks = [
      { type: "header", text: t.settings },
      ...(fixture ? [{ type: "banner", title: t.synthetic, description: t.fixtureBanner, variant: "alert" }] : []),
      { type: "banner", title: t.notConnected, description: t.localProof, variant: "alert" },
      { type: "fields", fields: [
        field(t.providerStatus, t.provider),
        field(t.postageFunding, t.funding),
        field(t.inventoryLabel, t.inventory),
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
    const packageStatus = packageResult?.ok ? t.valid : packageResult ? `${t.invalidPackage} · ${packageResult.message}` : t.valid;
    return { blocks: [
      { type: "header", text: t.shipping },
      { type: "banner", title: t.synthetic, description: t.fixtureBanner, variant: "alert" },
      { type: "banner", title: t.review, description: t.unavailable, variant: "alert" },
      { type: "fields", fields: [
        field(t.order, t.fixtureOrder.number), field(t.recipient, `${t.fixtureOrder.recipient} · ${t.fixtureOrder.destination}`),
        field(t.paidTotal, t.fixtureOrder.paidTotal), field(t.providerField, t.provider),
        field(t.package, `${packageValues.weightLb} lb · ${packageValues.lengthIn} × ${packageValues.widthIn} × ${packageValues.heightIn} in`),
        field(t.validation, packageStatus),
        field(t.quotePrerequisite, t.quoteUnavailable),
        field(t.operationGate, t.operationUnknown),
        field(t.postage, t.postageUnavailable),
        field(t.labelPrint, t.labelUnavailable),
      ] },
      packageForm(t, packageValues),
      { type: "actions", elements: [button("back-order-detail", t.detail), button("open-settings", t.settings)] },
      { type: "context", text: t.postageOwnership },
    ] };
  }

  return { blocks: [
    { type: "header", text: t.orders },
    ...(fixture ? [
      { type: "banner", title: t.synthetic, description: t.fixtureBanner, variant: "alert" },
      { type: "fields", fields: [field(t.order, fixtureOrder.number), field(t.recipient, fixtureOrder.recipient), field(t.paidTotal, fixtureOrder.paidTotal)] },
      { type: "actions", elements: [button("open-order", t.open)] },
    ] : [
      { type: "banner", title: t.unavailableData, description: t.emptyOrders, variant: "alert" },
      { type: "fields", fields: [field(t.status, t.handoff), field(t.commerceReadOnly, t.handoffDescription)] },
    ]),
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

  const isolatedFixture = input.fixture === "synthetic-order-1042" || input.page === "/proof-fixture";
  const storedPackage = isolatedFixture ? await ctx.storage.preferences.get("synthetic-package") : null;
  const submitted = input.type === "form_submit" && input.action_id === "update-package";
  const source = submitted ? input.values : storedPackage ?? DEFAULT_PACKAGE;
  const packageValues = Object.fromEntries(Object.keys(DEFAULT_PACKAGE).map(key => [key,
    typeof source?.[key] === "string" ? source[key].slice(0, 30) :
    typeof source?.[key] === "number" ? String(source[key]) : "",
  ]));
  if (isolatedFixture && input.type === "form_submit" && input.action_id === "update-package") {
    const packageResult = projectSyntheticQuoteRequest({
      order: { fixture: "synthetic-order-1042" },
      package: packageValues,
    });
    if (packageResult.ok) await ctx.storage.preferences.put("synthetic-package", packageValues);
    return pageResponse("shipping", ui, t, saved, undefined, true, packageValues, packageResult);
  }
  if (input.type === "block_action" && input.action_id === "open-settings") {
    return pageResponse("settings", ui, t, saved, undefined, isolatedFixture);
  }
  if (input.type === "block_action" && isolatedFixture) {
    if (input.action_id === "open-order") {
      return pageResponse("order-detail", ui, t, saved);
    }
    if (input.action_id === "make-postage-label") return pageResponse("shipping", ui, t, saved, undefined, true, packageValues);
    if (input.action_id === "back-orders") return pageResponse("orders", ui, t, saved, undefined, true);
    if (input.action_id === "back-order-detail") return pageResponse("order-detail", ui, t, saved);
  }

  const page = input.page === "/settings" ? "settings"
    : isolatedFixture && input.page === "/shipping" ? "shipping"
    : isolatedFixture && input.page === "/order-detail" ? "order-detail"
    : "orders";
  return pageResponse(page, ui, t, saved, undefined, isolatedFixture, packageValues);
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
