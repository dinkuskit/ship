# Changesets

Every pull request that changes the Ship plugin adds a changeset file here
declaring its version bump. While Ship is on 0.x, bug fixes are `patch` and
everything else is `minor`; `major` is rejected until the 1.0.0 gate. Docs,
tests, CI-only and hosted-service-only pull requests use an empty changeset
(`npx changeset --empty`): the hosted service under `service/` is deployed
from Ronald's Mac, not released through the Registry.

See [RELEASING.md](../RELEASING.md) for the full release flow.
