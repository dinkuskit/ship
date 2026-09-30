# Parent source review, 2026-09-30

Bound to immutable source identity
`sha256:41c016b30555b1e15b4522bfa9f8b3a6cb96983e614ab7db2c662f91878158a2`
(public docs bundle before this correction pass).

Result: findings. Not clean. No closure.

## Adjudication

| Finding | Class | Decision |
| --- | --- | --- |
| 1. Direct USPS under-described; official COP Label Provider / platform / TEM docs exist | `required_fix` | accepted |
| 2. Tracking/APV comparison incomplete; brief Q7 conflates refund windows | `required_fix` | accepted |
| 3. OSS SDK compare listed only Shippo MIT; verify EasyPost node; PB/USPS HTTP without copying SDK | `required_fix` | accepted |
| 4. Public charter leftovers recite private ops tools and Inventory v1 legacy path | `required_fix` | accepted |
| 5. Contract missing proposed origin/parcel/service, units, tenant buy, idempotency, print proof, credential split | `required_fix` | accepted |
| 6. Proof plan missing installed UI, isolation, unknown/expired quote, sandbox fidelity, TEM credential caveat | `required_fix` | accepted |

No parent finding rejected.

Product locks are not reopened. `vendor-account-funding` stays proposed.
