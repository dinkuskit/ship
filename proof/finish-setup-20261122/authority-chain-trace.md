# Finish setup authority chain: Ship plugin against DinkusKit.com

Run 2026-11-22. Ship plugin: this branch at 696ddb4. DinkusKit.com: built Worker from dinkuskit/dinkuskit#145 at ad88252, local D1 and KV. Released plugin for the upgrade check: main at 6ce0537. Keys and passes are redacted.

## 1. An Administrator joins a store its business already connected with Finish setup
- PASS: before Ship connects, Ship is off for the store (Commerce cannot send it orders)
- PASS: an Editor sees Finish setup is needed but gets no button ([])
- PASS: an Editor pressing Finish setup anyway (a forged press) makes no key ([])
- PASS: an Administrator sees the Finish setup button, not Connect (["Finish setup"])
- PASS: pressing it shows the Shipments list straight away (["Refresh"])
- PASS: Ship saved its own key, different from Commerce's (dk_store_[redacted])
- PASS: DinkusKit.com read the receipt from the store's own proof route
- PASS: Ship is now on: Commerce can send it orders
- PASS: the list names the business and the plugins on the store (Connected to Acme Goods on DinkusKit. DinkusKit plugins on this store: Commerce and Ship. To disconnect one, open Your stores at DinkusKit.com. )
- PASS: the owner got the "joined your store" email (["Dinkus Ship joined your store on DinkusKit"])

## 2. Another business, or another address, gets nothing
- PASS: an installation claiming Acme's address, but not answering there, gets no key (Connect Ship again | Connect did not finish. Press Connect to start again.)
- PASS: Ship on Other Shop joins Other Shop's own business (Connected to Other Shop on DinkusKit. DinkusKit plugins on this store: Commerce and Ship. To disconnect one, open Your stores at DinkusKit.com. )
- PASS: Acme's Ship key cannot trade passes for Other Shop
- PASS: Other Shop's key cannot read Acme's connection
- PASS: a store no business connected shows Connect, not Finish setup (["Connect"])
- PASS: pressing Finish setup there anyway asks for Commerce first and saves nothing (Connect Ship again | Connect Commerce first. Press Connect in the Commerce plugin, then come back here and press Connect.)

## 3. Uninstall cancels only Ship's key
- PASS: Ship's key no longer trades any pass
- PASS: nor reads the connected-to details
- PASS: Commerce's key still works, and Ship stays on for its orders
- PASS: Other Shop's Ship key still works
- PASS: a reinstall shows Finish setup again (an uninstall is not a Disconnect) (["Finish setup"])
- PASS: and joins with a new key

## 4. After the owner's Disconnect, only the owner's Approve brings Ship back
- PASS: Disconnect ended the key and turned Ship off
- PASS: once its last pass lapses, the installed plugin says to connect again (Connect Ship again | DinkusKit.com no longer knows this plugin's store key. An Administrator presses Connect again.)
- PASS: a fresh page shows Connect, not Finish setup (["Connect"])
- PASS: a Finish setup press (an old page) gets the owner's Approve link, and no key (["Check","Cancel"])
- PASS: another business's owner cannot approve it: Check still waits, no key (303 /account/connect?connection_id=e4049628-5dd0-458a-89ab-367f2788fdf4&error=ownership_conflict)
- PASS: the owner's Approve sends them back to the Shipments page (https://acme-goods.example/_emdash/admin/plugins/r_ehdlg5cxkb3ffqvr/shipping)
- PASS: Check then connects with a key and Ship is on again (["Refresh"])

## 5. Upgrade: a store connected with the released plugin keeps working
- PASS: the released plugin (main) connected with the owner's Approve (["Refresh"])
- PASS: after the upgrade the same storage loads the Shipments list with the same key (["Refresh"])
- PASS: the upgraded page shows the connected-to line and no Finish setup
- PASS: uninstalling the upgraded plugin cancels the key the released plugin saved
- PASS: and leaves that store's Commerce key working

All checks passed.
