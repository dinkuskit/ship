# Draft upstream issue: authenticated private asset handoff for Block Kit

> Draft only. Do not post from this repository. Ship is a prospective consumer;
> EmDash core/admin/Block Kit owns API names, security review, and acceptance.

## Summary

EmDash already transports bounded private raw plugin responses, but a
host-rendered Block Kit page cannot use a normal link to view or download one.
Cookie-authenticated private routes require `X-EmDash-Request: 1`, while a
Block Kit external link navigates without that header. The result is a precise
browser handoff gap, not a missing plugin byte route.

## Reproduction

From the Ship qualification branch, run:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run verify:private-assets
```

The dedicated fixture under
[`test-support/private-assets`](../../test-support/private-assets) is bundled
with the official plugin CLI and loaded by a disposable pinned EmDash 1.2.0
sandbox host. It uses `pluginResponse()` for a deterministic PDF
`Uint8Array`, a private `GET` raw route, and a normal Block Kit external link.
The runner uses a local dev-bypass session (not normal sign-in proof) and sends:

1. authenticated route request with `X-EmDash-Request: 1`: exact PDF bytes and
   filtered security headers;
2. cookie-authenticated request without that header: 403;
3. request with the header but no session: 401;
4. HTTP GET to the Block Kit link target with cookie but no CSRF header: 403.
   This is not an observed browser click.

Proof artifacts are written under the ignored
`runs/private-asset-qualification-runs/probe-*/` directory. This runner seeds
local post-install plugin state; it is not a signed/public Registry install.
It performs no provider or credentialed network calls.

Relevant upstream source at
[`c16e2a6`](https://github.com/emdash-cms/emdash/tree/c16e2a6ad84e42201477954fac0ee283616e4259):

- [`http-route-dispatch.ts`](https://github.com/emdash-cms/emdash/blob/c16e2a6ad84e42201477954fac0ee283616e4259/packages/core/src/plugins/http-route-dispatch.ts)
- [`route-wire.ts`](https://github.com/emdash-cms/emdash/blob/c16e2a6ad84e42201477954fac0ee283616e4259/packages/core/src/plugins/route-wire.ts)
- [`BlockResponse`](https://github.com/emdash-cms/emdash/blob/c16e2a6ad84e42201477954fac0ee283616e4259/packages/blocks/src/types.ts#L522)
- [raw route documentation](https://github.com/emdash-cms/emdash/blob/c16e2a6ad84e42201477954fac0ee283616e4259/skills/creating-plugins/references/api-routes.md)

## Requested design review

Please design and security-review one generic private asset handoff for
host-rendered Block Kit. The plugin should identify a private raw route and
bounded view/download intent; the host should resolve the
installed plugin, invoke the route through the existing authenticated
dispatcher, and render a passive document or sanitized attachment. It must
not accept an arbitrary URL, plugin script, public media copy, bearer token in
the URL, or a plugin-specific native companion.

The plugin remains responsible for domain authorization on every retrieval.
Core remains responsible for authentication, permission/scope, CSRF, method and
size limits, response-header filtering, private/no-store behavior, `nosniff`,
and passive-document CSP. Later reads must reauthorize. View/download must not
implicitly mutate business or print state. A browser print control may only
report an attempted browser action; it cannot claim a dialog or physical
output.

Stable field names, viewer CSP, temporary byte lifetime, filename policy, and
the concrete viewer/mediator are intentionally left to upstream core/admin
maintainers. Ship should consume a versioned API after acceptance; it should
not define a parallel bridge. Existing related work: [#3190](https://github.com/emdash-cms/emdash/pull/3190) and [#1314](https://github.com/emdash-cms/emdash/issues/1314).


## Qualification still required after design acceptance

Real Registry artifact installation and normal local sign-in, browser PDF
viewing, exact downloaded bytes, and explicit browser Print invocation remain
unexecuted. The current reproduction does not install a signed Registry artifact
or patch the admin renderer. One-click printing is deferred. See the existing
[proposal acceptance matrix](registry-private-label-assets-proposal.md#minimum-acceptance-criteria)
for Node/workerd and Cloudflare hosts, denied identity/object/permission cases,
viewer CSP/resource lifetime, and read-only consumer invariants.

The next bounded upstream slice is design qualification of the host-owned
handoff: select a supported API and viewer isolation/lifetime policy, then
implement against this fixture and run real Registry/browser acceptance.
Ship's trusted shop/user/paid-order/revision/consent/CAS/provider bindings remain
separate prerequisites. This draft authorizes neither posting nor implementation.
