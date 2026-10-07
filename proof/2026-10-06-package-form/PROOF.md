# Installed synthetic package form proof

Base: `16f962eb8f3f373f0231a736a3f4ceb34bac94e6`.
Scope: explicitly isolated synthetic fixture; no Commerce order read, provider quote, purchase, or retry.

- `npm test`: 24 passed.
- `npm run verify:sandbox`: package install and exact host-installed byte match passed; sandbox execution, settings persistence, default Commerce fail-closed state, and host-attested Arabic RTL passed.
- Host: EmDash 1.0.1, sandbox-workerd 0.9.1, Node 22.23.1, workerd 1.20261001.1; localhost port 4351.
- Package SHA256: `1da5075245e442778ad54da49a749d5a0eaeb9188539fb8ea2ebdc5a074c3e6d`.
- Browser: Synthetic package proof → Open synthetic fixture → Make a postage label. Zero weight rejected visibly. 3.5 lb / 12 × 9 × 5 in accepted; destination and $48 paid total unchanged.
- Screenshots retained in task-owned ignored run: `runs/ignoredruns/order-sandbox-quotes-20261006/package-invalid.png` and `package-valid.png`.

Repairs: self-contained sandbox entry (runner does not include sibling modules), supported text_input fields, page-scoped fixture actions, retained valid package values, strict decimal parsing, longest-side length-plus-girth validation, and verifier separation of default versus fixture data.

Limits: no real-order shipping proof. Canonical Commerce order handoff and approved runtime credential binding remain missing. Unknown historical provider operation remains unretried. Review admission was fenced; no alternate or duplicate review dispatched. Not merge-ready.
