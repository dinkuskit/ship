# Private installed Ship workflow candidate

October 8 authorized implementation slice, stacked on provider PR10 candidate
`5ee5504542f327f2ceef0ebdcecf578cc84552e0`. Provider review was pending when pinned.
No live provider, account, credential, grant, deployment or Registry work occurs.
The default root export remains the existing plain sandbox entry with disabled
provider actions. No request or environment flag enables the workflow.

## Supported injection seam

`@dinkuskit/ship/workflow` exports `createShipWorkflow` and `ShipWorkflowError`.
`@dinkuskit/ship/installed` exports `createShipPlugin({workflowFactory,authorityPort})`.
These are package code exports, not a claim that Registry mediates these ports.

The host builds `workflowFactory(ctx)` using host-owned provider and order ports,
`ctx.storage.operations` CAS methods, and the existing saved origin in
`ctx.storage.preferences.get('origin')`. The store contract is:

- `getOrigin(auth)` returns this installation's saved U.S. origin.
- `getVersioned(key)` returns `{value,revision}` or null.
- `compareAndSet(key,revision|null,value)` returns `{applied:true,revision}` or `{applied:false}`.

No read/put replacement for CAS is supported. A null expected revision means
create-if-absent. Lost claim acknowledgement never dispatches a purchase. A
post-dispatch persistence failure leaves the durable pending claim blocked;
this is conservative crash safety, not an exactly-once provider guarantee.

`authorityPort.authorize({user,ui})` is server-owned and receives only the trusted
HTTP route context. It returns `{shopId,actorId,canManage:true}`. Neither a browser
caller nor `runtime.handlePluginApiRoute` establishes authentication/RBAC/CSRF.
Mount only through enforced private HTTP dispatch. Missing ports or a missing
bound user fail closed. Bound host actor and installation identity are required;
SiteInfo URL is not tenant identity.

`orderPort.getPaidOrder({shopId,orderId,actorId})` returns a trusted immutable
snapshot with matching `shopId`, `orderId`, real monotonic `revision>=1`,
`paymentStatus:'paid'`, `paidTotals:{amount,currency:'USD'}`, U.S. `destination`
and `addressConsent:true`. The canonical order ID is preserved exactly:
Commerce's pinned checkout producer emits `order:${attemptId}`, with the default
UUID attempt giving41 characters. Ship admits that bounded `order:` prefix and
retains its existing100-character request cap without changing actor/shop ID
validation. Commerce's alternate injected attempt generator has no explicit
maximum;100 is a local technical cap, not a newly asserted Commerce contract.
Larger or differently shaped future canonical IDs require a negotiated port.
 **amount is an unsigned decimal minor-unit string**;
no dollars conversion or processor-capture inference occurs. Canonical zero totals
remain `'0'`; actual production order eligibility and consent semantics require
owner decisions and evidence, not this fixture boolean. Current Commerce supplies
none of the missing provenance fields; production handoff remains unavailable.

The provider port preserves PB lab PM/PKG/DOC_8X11 scope. It exposes quote,
createLabel, fetchLabelPdf and reconcileLabel; recovery consumes only provider
attested `recoveryReason`. HTTP500 alone never qualifies. No POST retry, automatic
reprint, polling or replacement purchase occurs. Ordinary printing reuses durable
PDF bytes; provider lost/spoilt reprint is a separate future attended operation.

## Private routes and ordinary UI

The factory adds `journey` POST JSON (`plugins:manage`, 16KiB body) with:

```
{ action: 'load'|'review'|'quote'|'buy'|'reconcile'|'label'|'pdf'|'print',
  orderId, packageValues?: {weightLb,lengthIn,widthIn,heightIn},
  quoteId?, confirmation?: {confirmed:true,service,amount,currency},
  idempotencyKey? }
```

Authority, paid totals, provider URL and order snapshot fields in the body are
never authority. `load` returns a private persisted state projection and current
trusted paid order. `pdf` prepares durable bytes and returns a byte count only.
`label-pdf` POST `{orderId}` returns portable raw `{kind:'bytes',value:Uint8Array}` PDF, attachment
filename `shipping-label.pdf`, private/no-store and nosniff. No public route,
general media storage or public status disclosure is added.

Factory admin `/journey` opens an order identifier form. `journey-load` loads a
trusted order; `journey-quote` edits package and shows origin/destination/paid
minor units/service/price. `journey-buy` requires an explicit unchecked-by-default
confirmation at that quote price and a request key. Reload reads durable state.
`journey-reconcile` checks only an eligible original transaction.
`journey-pdf` stores bytes; `journey-print` records a request, not physical printing.
Existing settings/locale behavior remains delegated to the root admin. The new
workflow retains host locale/direction; labels have partial Arabic translations.
Complete workflow localization is a remaining limit.

**Browser asset prerequisite:** EmDash private routes require X-EmDash-Request,
including GET. Block Kit href links cannot set it. Core needs a header-bearing
asset action or authenticated same-origin read-only label mediator bound to
installation/tenant/actor/order/operation. Ordinary browser view/download/print
is unavailable until that shipped host port exists. Tests injecting global
headers do not fulfill this gate. Retrieval must never implicitly buy/reconcile.

## Durable operation and proof limits

One tenant/order key claims pending before provider dispatch; different request
keys cannot bypass pending/unknown/known-label blocks. Fingerprints cover order
revision, paid money, origin, recipient, package and service. Exact quote
confirmation and expiry precede new dispatch. Completed same-key replay survives
quote expiry. Unknown response and price mismatch remain blocked. PDF failure
leaves known label identity; successfully persisted bytes survive module recreation. PDFs up to5MiB are
written as512KiB private chunks, each below the host1MiB JSON CAS value cap,
then atomically referenced by a digest-checked operation manifest. No partial
manifest is published. Failed/unreferenced chunks may require later private
cleanup; they never establish a usable label download.
Label, PDF, print request and delivery states remain distinct.

Unit tests use fictional addresses and fake provider ports. The reserved proof
owner mounts this exact packed code in an explicitly synthetic host entry with
fixture CAS, proving default absent-port denial separately. That is not production
Commerce, production CAS, provider funding, Registry mounting or browser print
readiness. Full installed journey and responsive browser proof remain pending
owner evidence. The single manifest storage assertion in provider-owned
`test/pb-sandbox.test.js` was admitted to this slice by the coordinator; provider
implementation files remain unchanged.
