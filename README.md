# GTA Junk and Property Cleanout — Website

Premium white-glove junk removal & property cleanouts, Toronto & the GTA. Static site (plain HTML/CSS, no build step), Netlify-ready.

## Structure
- `/` home · `/services/` hub + 5 service pages · `/locations/` hub + 9 city pages
- `/about/` `/reviews/` `/blog/` `/contact/` (quote form w/ photo upload, Netlify Forms) · `/thanks/` (noindex)
- `assets/site.css` shared styles · Rocky logo system SVGs · `og-image.png`
- `sitemap.xml`, `robots.txt`, `_redirects`

## SEO layer
LocalBusiness JSON-LD (home + contact), Service + FAQPage schema on service/location pages, BreadcrumbList site-wide, unique titles/descriptions, canonical URLs, OG/Twitter cards.

## Placeholders to replace before promoting
1. Phone: `(416) XXX-XXXX` / `tel:+14160000000` (site-wide find & replace)
2. HST number in footer (`HST# ______`)
3. Google review link: `https://g.page/r/PLACEHOLDER/review` (reviews page)
4. Social URLs in JSON-LD `sameAs` (PLACEHOLDER entries)
5. `assets/rocky-hero.png` — drop in the full-body Rocky illustration
6. Review placeholder cards — replace with real Google reviews only
7. Domain assumed `.ca` — if different TLD, find & replace `gtajunkandpropertycleanout.ca`

## Deploy
Netlify + GitHub; every push to `main` auto-deploys. Enable form notifications: Site settings → Forms.
