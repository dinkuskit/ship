# @dinkuskit/ship

## 0.1.0-beta.0

### Minor Changes

- [#44](https://github.com/dinkuskit/ship/pull/44) [`e811875`](https://github.com/dinkuskit/ship/commit/e811875ada8d6a5029ff7b9dec3464ebfc9ef4df) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - The Ship plugin for the EmDash store admin: a Shipping page where Editors and
  Administrators see paid orders waiting for a label, see USPS prices, buy a
  label, print it in a new tab and cancel it, all through the hosted Ship
  service. The old sandbox test plugin is gone.

### Patch Changes

- [#45](https://github.com/dinkuskit/ship/pull/45) [`d014509`](https://github.com/dinkuskit/ship/commit/d01450994aa2e1c974d192445d9a065d604e8372) Thanks [@saariuslystoned](https://github.com/saariuslystoned)! - Shipping page: the package weight is a text field, so tenths of an ounce such as 28.5 are accepted (the browser's number field refused most of them and See prices did nothing); cancelling a sandbox label no longer promises a USPS refund, in the toast or in the label's Cancelled line.
