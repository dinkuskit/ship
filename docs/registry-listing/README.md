# Ship registry listing

`emdash-plugin.jsonc` owns the public name, short description, author website,
keywords, these three CommonMark sections, and the artwork in `assets/listing/`.
Keep each section within 2,000 graphemes and 20,000 bytes. Keep availability
claims tied to the stable release and the published service documentation.

The existing package profile does not change merely because a release is
published. After review and explicit publication approval, use the pinned
`emdash-plugin update-package` command to preview the stable profile change;
apply only that approved preview. The beta profile has its own identity and
needs a separately staged beta manifest. Do not create a new publisher or
change either stable slug to update the display name.

Artwork is release metadata, not a profile field. The pinned CLI's
`release prepare` command produces the code tarball. The existing delegated
workflow now passes a complete `release-file`: content-addressed, checksummed code and attestation
assets plus image URLs pinned to the source commit. The service validates and
stores those images. Publication still requires the existing release and
approval flow; successful local preparation does not mean the registry is
updated. See `RELEASING.md` for upload idempotency and permission scope.

`assets/listing/icon.webp` is the website's
[ship.webp](https://github.com/dinkuskit/dinkuskit/blob/920aea3f012a14beb90d1be7264121dd7a8dd105/public/brand/ship.webp)
(234 × 256) centred on a transparent 256 × 256 square, because the Registry
crops icons to a square. The artwork pixels are unchanged (lossless WebP,
37,382 bytes, SHA-256 `a6079e76b12e7ccccdfa91a0c046214d8ccacc43324193e6bbb04a2dddba21ad`).

`assets/listing/connect-ship.jpg` is a real capture of the initial Connect
screen in EmDash 1.4.0, using the built Ship 0.3.0 sandbox bundle and a local
synthetic administrator. It illustrates initial setup, not a connected store
or a successful label purchase. Capture provenance is recorded in
`proof/registry-growth-20261030/PROOF.md`.
