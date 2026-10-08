# Private installed Ship workflow candidate

October 8 authorized implementation slice, stacked on provider PR10 candidate
`5ee5504542f327f2ceef0ebdcecf578cc84552e0`. Provider review was pending when pinned.
No live provider, account, credential, grant, deployment or Registry work occurs.
The default root export remains the existing plain sandbox entry with disabled
provider actions. No request or environment flag enables the workflow.

## Supported injection seam

`@dinkuskit/ship/workflow` exports `createShipWorkflow` and `ShipWorkflowError`.
`@dinkuskit/ship/installed` exports
`createShipPlugin({workflowFactory,authorityPort,browserAssetPort})`.
`browserAssetPort` is optional and has a host-owned `links` function.
`@dinkuskit/ship/host-label-assets` exports `createHostLabelAssets` and
`createLabelLinks` for an explicitly configured native host mount.
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

## Optional authenticated browser label mount

EmDash private plugin routes require `X-EmDash-Request`, including GET. Block Kit
href links cannot set it. The optional `./host-label-assets` export supplies a
native host adapter; installing the sandbox plugin alone does not mount it and
no global request header or plugin CSRF exemption is introduced.

The host owns a fixed native Astro route under `/_emdash/api`, with prerendering
disabled, so EmDash authenticates its actual `locals` before the adapter runs.
The mount exports the `GET` returned by `createHostLabelAssets({pluginId,path,
hasPermission,hasScope})`. `pluginId` selects the fixed installed plugin;
`path` is the fixed same-origin native route (default
`/_emdash/api/ship-label-assets`). The policy helpers must be the host's public
`@emdash-cms/auth` exports. Do not substitute browser fields, fixture actors or
permissive policy helpers for actual authenticated locals.

The adapter checks user identity, `plugins:manage`, admin scope for token
credentials, enabled installation, and private `label-stored` route metadata
before using the low-level trusted dispatch API. Session authentication has its
ordinary full host scope. The underlying dispatch API does not establish these
policies itself. Missing host runtime, disabled installation or mismatched
permission/method/body/raw-response metadata fails closed.

Bind the installed factory's `browserAssetPort.links` to the adapter's `links`,
or to the function returned by `createLabelLinks({path})` for the same fixed
mount. The packaged admin page then exposes View label, Download label and Open
print controls only for a created label with stored PDF bytes. Missing binding
keeps browser access unavailable; these exports are not a Registry port binding.

The native GET accepts exactly `orderId`, `operationId` and `intent`, where
intent is `view`, `download` or `preview`. Browser input never selects an
installation, tenant or actor. It dispatches the private `label-stored` POST
with exactly `{orderId,operationId}` after host policy checks. That private
route reauthorizes through the existing authority/order ports, requires stored
PDF status, checks operation identity before and after a read-only workflow
reads digest-checked chunks, and cannot obtain missing bytes from a provider.
Wrong tenant/order/operation, absent bytes and invalid PDF data are unavailable.
Browser retrieval never buys postage, reconciles a purchase, or records a print
request; existing `journey-print` remains a separate state-changing action.

`view` returns a private HTML control page with a same-origin CSP, explicit View
and Print attempt buttons, and a Download link. View loads the stored PDF only
on a click. Print attempt explicitly calls the browser print control; success
of that call does not establish a print dialog, physical printing or delivery.
`preview` returns inline PDF bytes and `download` an attachment named
`shipping-label.pdf`. Responses are private/no-store, nosniff and no-referrer;
PDFs are bounded to 5MiB. No public media copy or public label route is added.

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

Unit tests use fictional addresses and fake provider ports. Independent proof
installed the packed code in disposable EmDash 1.2.0 with actual workerd and
SQLite CAS, while order/provider/authority inputs remained explicitly synthetic.
The installed browser-host test proves actual locals/session/RBAC and
operation/tenant denials, exact stored bytes, private response headers and no
additional provider fetch/create/reconcile. Ordinary Chrome rendered the
synthetic PDF, downloaded identical bytes and exercised the explicit Print
attempt button. No print dialog was captured. The in-app browser's blank frame
and Chrome's blocked stale-operation navigation are excluded from visible
success; HTTP denials have separate installed test evidence.

See [browser asset proof](../../.grilltrack/proof/browser-label-assets-20261008.md)
for source fingerprints, commands, counters and fidelity limits. This does not
prove production Commerce/authority/mounting, real provider behavior, physical
printing/delivery or Registry installation. The default absent-port denial
remains separately tested. Provider implementation files are unchanged.
