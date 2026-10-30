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
workflow now passes a complete `release-file`: checksummed code and attestation
assets plus image URLs pinned to the source commit. The service validates and
stores those images. Publication still requires the existing release and
approval flow; successful local preparation does not mean the registry is
updated. See `RELEASING.md` for upload idempotency and permission scope.

`assets/listing/connect-ship.jpg` is a real capture of the initial Connect
screen in EmDash 1.4.0, using the built Ship 0.3.0 sandbox bundle and a local
synthetic administrator. It illustrates initial setup, not a connected store
or a successful label purchase. Capture provenance is recorded in
`proof/registry-growth-20261030/PROOF.md`.
