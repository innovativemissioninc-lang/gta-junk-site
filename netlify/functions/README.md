# See Your Price — setup

## 1. Set the API key (required)
Netlify → Site configuration → Environment variables → Add:

    ANTHROPIC_API_KEY = sk-ant-...

Scope it to **Functions** only. Never commit it, never put it in any HTML file.

## 2. Database (optional)
The function logs every estimate to **Netlify Blobs** automatically — no setup.

For queryable SQL logs, add a Postgres database (Neon is already available in
your Netlify extensions), run `schema.sql`, then add:

    DATABASE_URL = postgres://...

## 3. Where the money logic lives
`estimate.js` only. Tier prices, the buffer multipliers, and the cubic-yard
signal model are constants at the top of that file and are never serialised to
the browser. `buildClientResponse()` is an explicit allow-list — if a field
isn't written there, the customer cannot see it.

To recalibrate after real jobs: change `BUFFER`, `SIGNAL_PER_CUBIC_YARD`, or the
boundary numbers in `decideTier()`. Nothing else needs touching.

## 4. Cost per estimate
Eight frames at ~900px through Claude Sonnet runs roughly a few cents per
estimate. Worth watching in the Anthropic console for the first week — if the
tool gets scraped or abused, add rate limiting by `client_ip_hash`.

## 5. Booking flow — ACTION REQUIRED
Result screens currently point at `/contact/` (your Netlify quote form) and
`tel:+16472040632`. If you move to Jobber, Workiz, or a calendar link, update
`actions.book_url` in `buildClientResponse()` — three places.
