// Beta Registry routing for prerelease versions (GrillTrack
// release-beta-flow-066 in dinkuskit/dinkuskit). The Registry has no
// prerelease filter, so a beta under the real slug would become the
// latest version for every install. Prereleases therefore publish
// under a separate beta package whose manifest is the stable manifest
// with only identity fields rewritten; code and declared access are
// byte-identical to the stable build from the same prebundle.

export const BETA_SLUG_SUFFIX = "-beta";

export function isPrereleaseVersion(version) {
  return typeof version === "string" && version.includes("-");
}

/**
 * Maps a Changesets selector (`slug@version`) to the selector the
 * Registry publish must use. Stable versions keep the real slug;
 * prereleases route to the beta slug. Returns null for malformed
 * selectors or a beta slug carrying a stable version.
 */
export function effectiveSelector(selector) {
  const at = selector?.lastIndexOf("@") ?? -1;
  if (at <= 0 || at === selector.length - 1) return null;
  const slug = selector.slice(0, at);
  const version = selector.slice(at + 1);
  if (slug.endsWith(BETA_SLUG_SUFFIX)) {
    return isPrereleaseVersion(version) ? selector : null;
  }
  return isPrereleaseVersion(version) ? `${slug}${BETA_SLUG_SUFFIX}@${version}` : selector;
}

/**
 * The beta package manifest: stable manifest with slug and display
 * name rewritten. Publisher, version, capabilities, storage, and
 * every other field stay exactly as staged.
 */
export function betaManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || typeof manifest.slug !== "string") {
    throw new Error("beta manifest requires a stable manifest with a slug");
  }
  if (manifest.slug.endsWith(BETA_SLUG_SUFFIX)) {
    throw new Error("beta manifest requires the stable slug");
  }
  return {
    ...manifest,
    slug: `${manifest.slug}${BETA_SLUG_SUFFIX}`,
    ...(typeof manifest.name === "string" ? { name: `${manifest.name} Beta` } : {}),
  };
}
