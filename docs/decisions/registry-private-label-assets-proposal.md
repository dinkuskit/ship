# Proposal: Registry-only private label assets

Status: **unapproved platform proposal**, researched 2026-10-08. This document
records a capability gap and proposed acceptance criteria; it does not approve
an API, authentication policy, implementation, publication, or production use.
Ship's default Registry entry and unavailable label behavior remain unchanged.

## Problem and existing support

Ship needs an authenticated browser path to view and download a stored private
PDF and explicitly attempt printing, without a per-plugin native companion.
Private binary transport already exists in EmDash. The missing part in the
inspected source is a generic Block Kit browser handoff for those bytes.

The inspected upstream revision is
[`c16e2a6ad84e42201477954fac0ee283616e4259`](https://github.com/emdash-cms/emdash/commit/c16e2a6ad84e42201477954fac0ee283616e4259).
Core, admin, and blocks package manifests at that revision declare **1.2.0**.
This pins source evidence; it does not establish that the published 1.2.0
artifacts contain every change at that revision. Ship's existing disposable
host separately pins EmDash 1.2.0. No upstream execution or upgrade is claimed.

| Surface | Verified behavior | Consequence |
| --- | --- | --- |
| [Private dispatcher](https://github.com/emdash-cms/emdash/blob/c16e2a6ad84e42201477954fac0ee283616e4259/packages/core/src/plugins/http-route-dispatch.ts#L49) | Checks route permission and admin token scope; cookie-authenticated requests require `X-EmDash-Request: 1`, including GET | An ordinary PDF hyperlink cannot supply the required header |
| [Raw response policy](https://github.com/emdash-cms/emdash/blob/c16e2a6ad84e42201477954fac0ee283616e4259/packages/core/src/plugins/route-wire.ts) | Supports bounded bytes, filters headers, rejects active document MIME types, and adds nosniff and sandbox CSP | PDF transport exists; active plugin HTML is not a viewer solution |
| [Block Kit response types](https://github.com/emdash-cms/emdash/blob/c16e2a6ad84e42201477954fac0ee283616e4259/packages/blocks/src/types.ts#L522) | Defines blocks, toast, patch, refresh, and navigation effects | No private binary asset effect is defined |
| [Sandboxed admin page](https://github.com/emdash-cms/emdash/blob/c16e2a6ad84e42201477954fac0ee283616e4259/packages/admin/src/components/SandboxedPluginPage.tsx#L32) | Sends interactions to the admin route and parses a JSON BlockResponse | Returning raw PDF bytes from that action does not open a viewer or download |
| [Link renderer](https://github.com/emdash-cms/emdash/blob/c16e2a6ad84e42201477954fac0ee283616e4259/packages/blocks/src/elements/link.tsx) | Resolves an href and navigates | It does not fetch authenticated bytes |
| [Admin fetch helper](https://github.com/emdash-cms/emdash/blob/c16e2a6ad84e42201477954fac0ee283616e4259/packages/admin/src/lib/api/client.ts#L14) | Adds the CSRF header to programmatic calls | The host has an existing authenticated request mechanism to reuse |

The [official API-route documentation](https://docs.emdashcms.com/plugins/creating-plugins/api-routes/)
confirms raw text/Uint8Array bodies bounded to 8 MiB, private authentication,
filtered response headers, and private/no-store responses. The
[Block Kit documentation](https://docs.emdashcms.com/plugins/creating-plugins/block-kit/)
describes host-rendered UI and server-handled interactions. The conclusion above
is limited to these documented and inspected surfaces, not unpublished branches.

## Relationship to Ship's current adapter

The [installed workflow contract](../contracts/installed-ship-workflow.md#optional-authenticated-browser-label-mount)
already defines an optional native Astro adapter in
[`src/host-label-assets.js`](../../src/host-label-assets.js). It authorizes a fixed
installation, user, permission, and operation before retrieving stored PDF bytes.
Its [existing proof](../../.grilltrack/proof/browser-label-assets-20261008.md)
covers a composed synthetic host, not a Registry-only installation.

The Registry entry in [`src/plugin.ts`](../../src/plugin.ts) wraps the default
[`src/plugin.js`](../../src/plugin.js); it does not bind the installed workflow's
host ports or mount the native adapter. The existing GrillTrack decision
`browser-stored-label-assets` covers that optional adapter, not the proposed
platform capability. This proposal changes no recorded product decision.

A public raw route, public media copy, bearer credential in a URL, or a separate
native companion would not satisfy this private Registry-only requirement.
A new adapter duplicating Ship's current native implementation would not close it.

## Minimal platform proposal

EmDash core and admin/Block Kit could provide one declarative **private asset
action**. A sandbox plugin would identify a private raw route, bounded input,
and a view, download, or print-preview intent. These are conceptual semantics,
not proposed stable field names or an approved API shape.

The host would resolve the current installed plugin and call its private route
through existing authenticated HTTP dispatch, preserving CSRF, permission, and
scope checks. The plugin would still authorize its domain object and operation
on every retrieval. The host would validate the bounded response and present a
passive PDF viewer or sanitized attachment. No arbitrary fetch URL or
plugin-supplied script would be accepted.

An explicit user control could attempt browser printing. Merely viewing or
retrieving bytes would not print or record a durable print request. Ship's
`journey-print` write remains separate. A browser attempt, an observed print
dialog, physical printing, dispatch, and delivery remain different claims.

A private POST fetch can reuse existing binary transport. The exact passive
viewer, CSP, and temporary byte lifetime need upstream security/design review;
this proposal does not select Blob URLs, new public GET routes, access tokens,
or a server-side artifact cache. Later requests must reauthorize. A downloaded
file cannot be revoked after delivery, so revocation tests concern later server
retrieval rather than already-delivered bytes.

## Minimum acceptance criteria

1. A clean Registry artifact installation on Node/workerd and Cloudflare sandbox
   hosts supports synthetic private PDF view and exact-byte download through
   Block Kit, with no plugin-specific native code. Record package versions and
   artifact digests.
2. Prove a supported local synthetic sign-in flow. Existing Ship browser proof
   uses a dev-bypass session and does not establish real sign-in. No external
   accounts or actual shipping data are needed.
3. Deny absent/expired sessions, insufficient permissions or token scope,
   disabled/uninstalled plugins, cross-plugin selection, wrong tenant/object,
   and stale operation. New retrievals reauthorize and disclose no private bytes
   or object metadata on denial. Domain authorization stays with the plugin.
4. Preserve CSRF checks; reject forged/cross-origin actions and unbounded input.
   Enforce MIME, byte-size, filename, private/no-store, and response-header
   constraints. Prove passive-viewer CSP and byte lifetime without broad CSP
   relaxation, public media storage, or credentials in links/logs.
5. Capture actual browser preview and download evidence. Printing requires an
   explicit control and reports an attempt only; distinguish any observed dialog
   from physical output. Show honest unavailable/error states and browser limits.
6. Repeated asset reads do not buy postage, reconcile, fetch missing provider
   bytes, or mutate print-request state. Preserve operation binding and exact
   stored-byte integrity through the sandbox boundary.

## Consumer prerequisites remain separate

Even an accepted asset action would not enable Ship's complete Registry journey.
The [installed workflow contract](../contracts/installed-ship-workflow.md#supported-injection-seam)
requires authoritative user/shop binding, trusted paid-order destination,
revision and consent, durable installation-scoped CAS storage, provider ports,
and a supported Registry binding for these services. The platform must not infer
Commerce tenancy or treat caller-supplied order fields as authority.

After a versioned platform API is available, Ship needs a separately approved
consumer integration and fresh installed Registry/browser proof. Until then,
its default workflow remains unavailable. Existing synthetic native proof is
reference evidence only; no production sign-in, provider, or printing claim is
introduced here.

## Related upstream work and next owner

- [PR #3190](https://github.com/emdash-cms/emdash/pull/3190), bounded raw sandbox
  routes, merged on 2026-09-20 as `6daffea679d3104fd94781f0cd706756c4da6289`.
  This is the transport foundation.
- [PR #3073](https://github.com/emdash-cms/emdash/pull/3073), raw plugin HTTP
  requests/responses, closed without merge; it is not shipped evidence.
- [Issue #1314](https://github.com/emdash-cms/emdash/issues/1314), Block Kit links,
  is closed. Its download use case is related, but navigation does not supply
  the private-route CSRF header.

Bounded issue/PR searches on 2026-10-08 for private assets, authenticated
downloads, PDF plugins and raw responses found no exact private Block Kit asset
proposal. This is not an exhaustive absence claim.

The next action is an **EmDash core + admin/Block Kit maintainer design review**
of a generic private asset handoff, referencing #3190 and #1314. API acceptance
and security review belong upstream; Ship is a prospective consumer. This Ship
document does not post an upstream issue or authorize platform implementation.
