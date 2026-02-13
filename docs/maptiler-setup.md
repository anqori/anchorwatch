# MapTiler Setup (PWA Map + Satellite)

This document defines how Anqori AnchorWatch should use MapTiler for the `Map` and `Satellite` pages in the PWA.

## 1) Which account to use

Use a dedicated Anqori-owned MapTiler Cloud account, not a personal developer account.

Recommended ownership model:

- Primary owner: Anqori-controlled mailbox (for example `infra@anqori.com`)
- At least one backup admin from the team
- Billing method owned by Anqori business entity

Why:

- avoids lock-in to one person
- keeps token rotation and billing under company control
- keeps production continuity when team members change

## 2) Plan choice and spending control

If strict monthly spend control is required, use a paid MapTiler plan with spend limits.

Recommended:

- Start with `Flex` plan.
- Set a monthly spending limit in billing settings.

Notes:

- Free plan has hard daily/monthly request limits and then pauses.
- Paid plans can run with overage; use explicit spending limits to cap costs.

## 3) Create an API key

In MapTiler Cloud:

1. Go to `Keys`.
2. Create a new key.
3. Name it clearly, for example:
   - `anqori-anchorwatch-dev`
   - `anqori-anchorwatch-release`
4. Restrict allowed URL patterns, at minimum:
   - `https://aw.anqori.com/*`
   - `https://dev-aw.anqori.com/*`
   - `http://localhost:5173/*`
   - `http://127.0.0.1:5173/*`
5. Save and copy the key.

## 4) Store in repo config

MapTiler key is used in browser requests for map tiles, so keep it in tracked `.env` (not `.env.secret`).

```bash
# MapTiler public client key
VITE_MAPTILER_API_KEY=replace_with_maptiler_key

# Optional style IDs
VITE_MAPTILER_STYLE_MAP=streets-v2
VITE_MAPTILER_STYLE_SATELLITE=hybrid
```

Because `just pwa-run` / `just cloudflare-dev` / `just cloudflare-release` source `.env`, these vars are available to Vite builds.

## 5) Implementation notes (current repo)

Current implementation uses `@maptiler/sdk` in `app/src/App.svelte`:

- `Map` page and `Satellite` page use MapTiler style JSON endpoints.
- Track overlay is rendered as GeoJSON line + current-position point layer.
- If `VITE_MAPTILER_API_KEY` is missing, app shows a direct "token missing" message.

Validate environments:

1. `just pwa-run` on localhost
2. `just cloudflare-dev` on `https://dev-aw.anqori.com`
3. `just cloudflare-release` on `https://aw.anqori.com`

## References

- MapTiler pricing and plans: <https://www.maptiler.com/cloud/pricing/>
- MapTiler key management: <https://docs.maptiler.com/cloud/account/keys/>
- MapTiler billing and spend limits: <https://docs.maptiler.com/cloud/account/billing/>
