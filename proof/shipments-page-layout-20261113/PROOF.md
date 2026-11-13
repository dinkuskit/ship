# Shipments page laid out like the Commerce order page

The store admin's **Shipments** page (Block Kit, `src/pages.ts`) changes from a long table and a stack of `Label: value` grids to the layout Shopify's, WooCommerce Shipping's and the Commerce order page use. Hosted Ship's own pages at ship.dinkuskit.com are not changed here.

## Captures

Unedited Playwright full-page screenshots at device scale 2, from the local EmDash 1.4.0 admin (Astro 7.1.3, Node 24.22.0). The page is Ship's own built `dist/plugin.mjs` admin handler, registered in that site as a standard-format plugin with id `dinkus-ship` and drawn by EmDash's own Block Kit renderer. Only the network and the plugin's connection setting are stand-ins: a made-up hosted Ship answers the plugin's `/v1/admin/…` calls with ten synthetic orders (#1003 to #1012, example.test names and addresses, one TEST order) and a pass with the right claims. No carrier, DinkusKit.com or hosted Ship was called.

| File | Source | Shows |
| --- | --- | --- |
| `before-main-list-1440.png` | main `119dd73` | The list: one long Ship to line, items string, black status badges, Open buttons. |
| `after-list-1440.png` | this PR | To ship, Fix address and On the way counts; the order number opens the order; name and city; a coloured dot per status. |
| `before-main-list-390.png` / `after-list-390.png` | both | The same at 390px. Main's Open column is cut off; this PR's three columns fit. |
| `before-main-order-prices-1440.png` / `after-order-prices-1440.png` | both | An order after See prices: Ship to beside Package, the Items table with weights in lb and oz, the services as choices with prices. |
| `before-main-order-label-bought-1440.png` / `after-order-label-bought-1440.png` | both | A bought label in transit: the Label beside Ship to, Print label beside the Label bought line, Track on USPS and Cancel label under it, every label in one Labels table. |
| `before-main-order-label-bought-390.png` / `after-order-label-bought-390.png` | both | The same at 390px. |

Every page in both runs had no horizontal page overflow at 1440px or 390px.

## Block Kit limits met

EmDash 1.4's table badge is always black (Kumo has coloured variants, Block Kit passes none), so statuses are plain text with a coloured dot until EmDash supports coloured badges. `columns` never stack, so only short lines sit in them. An `element` column is right-aligned, header included.
