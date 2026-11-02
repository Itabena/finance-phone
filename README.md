# Phone page (PLAN-43 C)

A static page, published with GitHub Pages, that shows the encrypted copy the PC writes into Google Drive.
It holds **code only** — every figure it shows comes from `snapshot.fin`, encrypted with the owner's passphrase.

| File | What it does |
|---|---|
| `index.html`, `app.css` | the shell: sign-in, unlock, top bar, bottom tab bar, sheets (PLAN-44) |
| `app.js` | Google sign-in, Drive download, unlock, remembering the key 30 days, the queue of phone changes, uploads |
| `ui.js` | the phone's own screens — Today, Budget, Review, Money, Send — drawn from `payload.phone` |
| `crypto.js` | the file format — mirror of `finance/sync/crypto.py`; change both together |
| `config.js` | the Google client ID (not a secret) |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | offline start and the turtle on the home screen |

The data comes from `finance/sync/phone_data.py` on the PC. Rule: each tab fits on one screen; detail opens in a
bottom sheet.

**Publishing:** double-click `tools/publish-phone.cmd` (pushes with your SSH key), or copy these files to the root of the `finance-phone` repository → Settings → Pages → *Deploy from a
branch*, `main`, `/ (root)`.
