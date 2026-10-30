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

Artwork is release metadata, not a profile field. The pinned CLI's direct
publish path uploads images, while its `release prepare` command produces a
code tarball. The dry prepared directory retains the referenced copy and image
files, but successful preparation is not proof that the delegated release
service publishes those images. Confirm the supported media-publication path
before promising that the icon is visible in the public registry. Do not
replace an existing immutable release to add artwork.

No current Ship screenshot is included: the available historical proofs do
not contain a reusable image of this release's installed admin. Add a real,
sanitized screenshot from the current stable plugin, with capture and source
provenance, before declaring the screenshot part complete. A drawing of Block
Kit JSON is not a product screenshot.
