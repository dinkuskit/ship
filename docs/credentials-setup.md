# PB sandbox credential packet

This is a value-free approval packet. No credential values belong in this
repository, shell history, browser storage, logs, or chat.

Human-only step: Bobby stores the Pitney Bowes sandbox API key and API secret
in 1Password, plus the non-secret Shipper ID. The approved local wrapper must
resolve selector names and inject these process variables only for the local
server:

- `PB_SANDBOX_API_KEY`
- `PB_SANDBOX_API_SECRET`
- `PB_SANDBOX_SHIPPER_ID`

The server consumer contract is fixed: the wrapper supplies all three values,
the server uses Basic API-key/API-secret OAuth against the sandbox host, and
the browser receives neither values nor provider URLs. No vault, item, account,
service, or wrapper is created by this project.

Current status: blocked. The approved wrapper is missing. A future live proof
must record only a sanitized receipt that the wrapper was used; it must not
record secrets, OAuth responses, provider payloads, or PDFs.
