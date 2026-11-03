# Cypress Grove Partners

Website for Cypress Grove Partners: SBA financing for Tampa Bay manufacturers. Capital for Tampa Bay businesses.

Static site served by the Cloudflare Worker `cypress-grove-partners` (see `wrangler.jsonc`). Pushing the production branch deploys it.

- `index.html`: home page
- `privacy.html`: privacy and terms, served by Cloudflare at `/privacy` (the site links there; in the Python preview open `/privacy.html`)
- `404.html`: not found page
- `get-started.html`: the Get started form (served at `/get-started`)
- `worker/`: the Worker behind the form, `POST /api/intake`: checks Turnstile, saves to Twenty, sends an ntfy push. Tests: `node worker/test.js`. Secrets live in Cloudflare, not here: `TURNSTILE_SECRET`, `TWENTY_API_KEY`, `NTFY_TOPIC`
- `_headers`: security headers for every page
- `cypressgrove-site/assets/`: styles (`site.css`), script (`site.js`) and images
- `.assetsignore`: files kept off the public site

Preview locally from the repo root with `python3 -m http.server 8787` and open http://localhost:8787.
