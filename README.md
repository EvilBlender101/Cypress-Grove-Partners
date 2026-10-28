# Cypress Grove Partners

Website for Cypress Grove Partners: SBA financing for Tampa Bay manufacturers. Capital for Tampa Bay businesses.

Static site served by the Cloudflare Worker `cypress-grove-partners` (see `wrangler.jsonc`). Pushing the production branch deploys it.

- `index.html`: home page
- `privacy.html`: privacy and terms
- `404.html`: not found page
- `cypressgrove-site/assets/`: styles (`site.css`), script (`site.js`) and images
- `.assetsignore`: files kept off the public site

Preview locally from the repo root with `python3 -m http.server 8787` and open http://localhost:8787.
