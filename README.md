# Kelenate direct-to-customer storefront

A responsive React storefront built from Kelenate's current non-apparel
marketplace catalog. It includes product discovery, search and sorting, product
quick views, dedicated product-detail URLs, a persistent cart, shipping
calculations, policies, checkout, Razorpay order verification, and Shiprocket
order creation.

Each active catalog item is available at `/products/:productId`. Product pages
include complete pricing, stock state, specifications, related items, mobile
purchase controls, dynamic metadata, canonical URLs, and Product structured
data. The customer experience also includes an instant search palette, locally
saved products, recently viewed items, large product-image previews, native
sharing, PIN-code delivery guidance, smart cart recommendations, and a
mobile-first quick navigation dock.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

`npm run dev` starts both the storefront and commerce/admin API. Keep that
terminal open while using the website or admin panel. The frontend falls back
to preview checkout when payment credentials are not configured.

Set `VITE_COMMERCE_API_URL=http://localhost:8787/api` in `.env`, then restart
the development command. The production build is created with:

```bash
npm run build
npm start
```

## Admin control panel

Open [`http://localhost:5173/admin`](http://localhost:5173/admin) while the
frontend and commerce server are running. In local development only, the
fallback password is `kelenate-admin`. Set `ADMIN_PASSWORD` and a separate
`ADMIN_SESSION_SECRET` in `.env` before any deployment.

The panel currently supports:

- dashboard totals, revenue, pending fulfilment and integration readiness;
- customer order review and fulfilment-status changes;
- product creation and editing, including custom categories;
- selling price, MRP, inventory and storefront visibility;
- one-click inventory adjustments, catalog-health filters, and explicit archived
  product restoration;
- JPG, PNG and WebP product-image uploads;
- reversible storefront removal through product archiving;
- order action summaries plus copy, call, email, print, and fulfilment controls;
- editable shipping charges, free-shipping threshold, return window and support
  contact details;
- low-stock visibility and live Razorpay/Shiprocket configuration status.

Products, orders and store settings are persisted under `server/data/` for
this local build. Shipping and support changes saved in the admin panel are
also returned to the storefront and shipping values are enforced again by the
checkout server. For production, connect these stores to the deployment
database so data remains durable across server restarts and multiple instances.

## Before accepting real orders

1. Replace the local admin password and session secret.
2. Add live or test Razorpay keys to `.env`.
3. Add the Shiprocket API-user credentials and exact pickup-location name.
4. Import product weights and packed dimensions from the upcoming seller CSV.
   Until measurements are configured, paid/COD orders are recorded and marked
   `shipment_pending` instead of sending guessed parcel data to Shiprocket.
5. Put the API and storefront behind HTTPS, set `STORE_ORIGIN`, and replace the
   local JSON order store with the production database used by the hosting
   environment.
6. Have the client approve the drafted shipping, return, privacy, and sale
   terms before launch.

Razorpay and Shiprocket secrets stay server-side. The server re-prices every
cart from the local catalog, verifies Razorpay signatures, and never trusts
prices sent by the browser.

## Catalog notes

- The launch catalog contains 17 products across car protection, reflective
  styling, stickers and labels, planning and logs, and business supplies.
- T-shirts/apparel are intentionally excluded.
- Marketplace prices, MRP, ratings, specifications, ASINs, and authorized
  listing images were reviewed on 23 July 2026.
- Product source details are documented in
  [`docs/marketplace-audit.md`](docs/marketplace-audit.md).
