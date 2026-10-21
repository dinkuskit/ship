# @dinkuskit/ship

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
