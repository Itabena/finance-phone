# Phone page (PLAN-43 C)

A static page, published with GitHub Pages, that shows the encrypted copy the PC writes into Google Drive.
It holds **code only** — every figure it shows comes from `snapshot.fin`, encrypted with the owner's passphrase.

| File | What it does |
|---|---|
| `index.html`, `shell.css` | the shell: sign-in, unlock, tabs, the sandboxed frame |
| `app.js` | Google sign-in, Drive download, unlock, remembering the key 30 days (IndexedDB, non-extractable) |
| `crypto.js` | the file format — mirror of `finance/sync/crypto.py`; change both together |
| `render.js` | turns one decrypted page into a self-contained document; answers its data requests from the snapshot |
| `config.js` | the Google client ID (not a secret) |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | offline start and the turtle on the home screen |

**Publishing:** copy these files to the root of the `finance-phone` repository → Settings → Pages → *Deploy from a
branch*, `main`, `/ (root)`.
