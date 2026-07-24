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
terminal open while using the website or admin panel. Local development can use
a clearly labelled preview checkout when no commerce API URL is configured.
Production fails closed: missing API configuration or unavailable payment
methods disable checkout instead of pretending to accept an order.

Set `VITE_COMMERCE_API_URL=http://localhost:8787/api` in `.env` to exercise the
real local API, then restart the development command. A same-origin production
deployment automatically uses `/api`; set the variable only when the API lives
on another origin. The production build is created with:

```bash
npm run build
npm test
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

Products, orders, webhook receipts and store settings are persisted under
`server/data/` for this single-process local build. Writes are serialized,
inventory operations are idempotent per order, and checkout retries reuse the
same order. Shipping and support changes saved in the admin panel are also
returned to the storefront and shipping values are enforced again by the
checkout server.

The JSON stores are a hardened development bridge, not a production database.
They do not coordinate across multiple server instances. Before real traffic,
move orders, payments, inventory movements, webhook events and shipment jobs to
a transactional database with unique constraints.

## Before accepting real orders

1. Use a long private `ADMIN_PASSWORD` and a separate random
   `ADMIN_SESSION_SECRET`. `npm start` runs in production mode and has no
   development-password fallback.
2. Start with Razorpay Test keys. Configure the Razorpay webhook URL as
   `/api/webhooks/razorpay`, set its dedicated secret, and subscribe to
   `order.paid`, `payment.captured`, `payment.failed`, `refund.created`,
   `refund.processed` and `refund.failed`.
3. Exercise successful, failed, dismissed and delayed-payment paths, then run
   `npm test`. Replace Test keys and the Test webhook with Live configuration
   only after this passes.
4. Add the Shiprocket API-user credentials and exact pickup-location name.
   Import SKU-level weights and packed dimensions from the upcoming seller CSV.
   Until courier configuration is complete, shipment creation fails closed and
   remains visible for manual attention.
5. Keep `ENABLE_COD=false` until COD serviceability, customer verification and
   an operating process for rejected/RTO orders are approved.
6. Put the API and storefront behind HTTPS, set the exact `STORE_ORIGIN`, set
   `TRUST_PROXY=true` only behind the trusted first proxy, and replace the JSON
   stores with the production transactional database.
7. Have the client approve the drafted shipping, return, privacy, refund and
   sale terms before launch. Cancelling a captured online order marks its refund
   as pending; the refund must be issued through the approved Razorpay process,
   and its webhook closes the lifecycle.

Razorpay and Shiprocket secrets stay server-side. The server aggregates
duplicate cart lines, re-prices every cart from the active catalog, requires a
checkout idempotency key, verifies the checkout signature against the stored
provider order, confirms captured amount/currency/status with Razorpay, and
also processes signed, deduplicated raw-body webhooks. Stock and shipment work
are guarded so replayed callbacks cannot fulfil the same payment twice.

## Catalog notes

- The launch catalog contains 17 products across car protection, reflective
  styling, stickers and labels, planning and logs, and business supplies.
- T-shirts/apparel are intentionally excluded.
- Marketplace prices, MRP, ratings, specifications, ASINs, and authorized
  listing images were reviewed on 23 July 2026.
- Product source details are documented in
  [`docs/marketplace-audit.md`](docs/marketplace-audit.md).
