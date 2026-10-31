# @dinkuskit/ship

## 0.3.1

### Patch Changes

- [#81](https://github.com/dinkuskit/ship/pull/81) [`39f79a8`](https://github.com/dinkuskit/ship/commit/39f79a89024bc49725f91264a32e40a7b4010190) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Build and test against EmDash 1.4.0 (blocks 1.4.0, plugin CLI 0.13.5). The runtime peer moves to exact `emdash` 1.4.0. The Ship plugin's behaviour and the hosted Ship service do not change.

- [#87](https://github.com/dinkuskit/ship/pull/87) [`7179d67`](https://github.com/dinkuskit/ship/commit/7179d67a1185a10539db99c33bf00daa7a3dfbf7) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Publish the Registry icon and screenshots through the EmDash release-action
  from emdash-cms/emdash#4467, so a new release carries its listing artwork.

- [#84](https://github.com/dinkuskit/ship/pull/84) [`f3602ee`](https://github.com/dinkuskit/ship/commit/f3602ee8c82d3b0e2e20f0944645d74b15442ede) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Improve the DinkusKit Ship registry listing with branded artwork, website and documentation links, searchable keywords, and explicit sandbox-postage guidance.

- [#69](https://github.com/dinkuskit/ship/pull/69) [`c7f240e`](https://github.com/dinkuskit/ship/commit/c7f240e899a345aaf87a68461e6a91277a691eee) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Put the Ship admin page in a "Dinkus Ship" sidebar folder and name it "Shipments". The page path stays `/shipping`.

- [#88](https://github.com/dinkuskit/ship/pull/88) [`9744422`](https://github.com/dinkuskit/ship/commit/9744422d85fd9902fc01c9004cf17684a1f375cf) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Show the Shipping page's orders 50 at a time with Load more. A store with about 175 or more orders got
  "Plugin returned invalid Block Kit content" instead of the list, because EmDash refuses a page of more
  than 2,000 parts.

- [#86](https://github.com/dinkuskit/ship/pull/86) [`41a139c`](https://github.com/dinkuskit/ship/commit/41a139c1f99e2ca3662ef9ba4d22179ef151676b) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Centre the Registry icon on a transparent 256 × 256 square so the listing's
  square crop shows the whole Ship logo.

## 0.3.0

### Minor Changes

- [#65](https://github.com/dinkuskit/ship/pull/65) [`346f151`](https://github.com/dinkuskit/ship/commit/346f151aad5d7f587c66ea2475fbf8fa6db44caf) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Connect to DinkusKit replaces pasting the Store ID and store key: an Administrator presses Connect on the Shipping page, the business owner approves at DinkusKit.com, and Ship gets its own store key, kept encrypted. Commerce connects first. The Store ID and store key settings are gone; a key DinkusKit.com no longer knows shows Connect again. A store upgraded from 0.2.1 never uses its pasted key: the Shipping page says to Connect once, and Connect removes the old settings.

## 0.2.1

### Patch Changes

- [#62](https://github.com/dinkuskit/ship/pull/62) [`d433d5e`](https://github.com/dinkuskit/ship/commit/d433d5e8c43b65a3a65a1cde741e3b878455f3ae) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Ship 0.2.1 is the first release cut from a release/X.Y.Z branch. The plugin code is unchanged from 0.2.0; the release is how the new release path (GrillTrack release-branches-079) gets proven end to end.

## 0.2.0

### Minor Changes

- [#57](https://github.com/dinkuskit/ship/pull/57) [`5173fd6`](https://github.com/dinkuskit/ship/commit/5173fd627c33442b17d81bc18f4aeccc47e782ba) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - The Shipping page reuses its Ship pass for later clicks for up to a minute instead of trading the store key at DinkusKit.com on every click, so a burst of clicks shares one trade and a labelling session stays clear of the pass rate limit. The pass is kept in the plugin's own KV beside a fingerprint of the key it was traded with, so a newly pasted key takes effect at once, and a key replaced or a Ship turned off at DinkusKit.com stops clicks within a minute. A kept pass Ship no longer accepts is dropped and the call retried once on a fresh one.

## 0.1.0

### Minor Changes

- [#49](https://github.com/dinkuskit/ship/pull/49) [`45b42c7`](https://github.com/dinkuskit/ship/commit/45b42c7a0be8898028a9e9ad92320b4dd59a19d7) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Commerce's "Create shipping label" button lands on the store admin's Shipping page once the Ship plugin has called hosted Ship, opening that order; the plugin's "Open in Ship" links keep Ship's full page.

- [#49](https://github.com/dinkuskit/ship/pull/49) [`787552e`](https://github.com/dinkuskit/ship/commit/787552e67d9e26501d736385c3a9d4ea0ce02ea8) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Live labels show where they are: Pitney Bowes's tracking updates reach hosted Ship, a daily check asks about labels not yet delivered, and the Shipping page and Ship's own page read In transit, Out for delivery, Delivered or Problem.

- [#44](https://github.com/dinkuskit/ship/pull/44) [`e811875`](https://github.com/dinkuskit/ship/commit/e811875ada8d6a5029ff7b9dec3464ebfc9ef4df) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - The Ship plugin for the EmDash store admin: a Shipping page where Editors and
  Administrators see paid orders waiting for a label, see USPS prices, buy a
  label, print it in a new tab and cancel it, all through the hosted Ship
  service. The old sandbox test plugin is gone.

### Patch Changes

- [#45](https://github.com/dinkuskit/ship/pull/45) [`d014509`](https://github.com/dinkuskit/ship/commit/d01450994aa2e1c974d192445d9a065d604e8372) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Shipping page: the package weight is a text field, so tenths of an ounce such as 28.5 are accepted (the browser's number field refused most of them and See prices did nothing); cancelling a sandbox label no longer promises a USPS refund, in the toast or in the label's Cancelled line.

- [#49](https://github.com/dinkuskit/ship/pull/49) [`5285057`](https://github.com/dinkuskit/ship/commit/5285057ab1eef3ed09de3b9b251bce4fb98a1f08) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - When Pitney Bowes does not confirm a label, Ship's page says what came back (the status, or which part of the answer it could not read), in plain words.

## 0.1.0-beta.1

### Minor Changes

- [#49](https://github.com/dinkuskit/ship/pull/49) [`45b42c7`](https://github.com/dinkuskit/ship/commit/45b42c7a0be8898028a9e9ad92320b4dd59a19d7) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Commerce's "Create shipping label" button lands on the store admin's Shipping page once the Ship plugin has called hosted Ship, opening that order; the plugin's "Open in Ship" links keep Ship's full page.

- [#49](https://github.com/dinkuskit/ship/pull/49) [`787552e`](https://github.com/dinkuskit/ship/commit/787552e67d9e26501d736385c3a9d4ea0ce02ea8) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Live labels show where they are: Pitney Bowes's tracking updates reach hosted Ship, a daily check asks about labels not yet delivered, and the Shipping page and Ship's own page read In transit, Out for delivery, Delivered or Problem.

### Patch Changes

- [#49](https://github.com/dinkuskit/ship/pull/49) [`5285057`](https://github.com/dinkuskit/ship/commit/5285057ab1eef3ed09de3b9b251bce4fb98a1f08) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - When Pitney Bowes does not confirm a label, Ship's page says what came back (the status, or which part of the answer it could not read), in plain words.

## 0.1.0-beta.0

### Minor Changes

- [#44](https://github.com/dinkuskit/ship/pull/44) [`e811875`](https://github.com/dinkuskit/ship/commit/e811875ada8d6a5029ff7b9dec3464ebfc9ef4df) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - The Ship plugin for the EmDash store admin: a Shipping page where Editors and
  Administrators see paid orders waiting for a label, see USPS prices, buy a
  label, print it in a new tab and cancel it, all through the hosted Ship
  service. The old sandbox test plugin is gone.

### Patch Changes

- [#45](https://github.com/dinkuskit/ship/pull/45) [`d014509`](https://github.com/dinkuskit/ship/commit/d01450994aa2e1c974d192445d9a065d604e8372) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Shipping page: the package weight is a text field, so tenths of an ounce such as 28.5 are accepted (the browser's number field refused most of them and See prices did nothing); cancelling a sandbox label no longer promises a USPS refund, in the toast or in the label's Cancelled line.
