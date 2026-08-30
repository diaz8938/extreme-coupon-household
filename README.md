# Extreme Coupon Household v0.4

GitHub-ready local-first prototype for a household shopping optimizer.

## Seeded data
- H-E-B transaction #1: 2026-08-29, Store #734, 101 items, $485.97 paid, $15.12 saved.
- Dollar General transaction #1: 2026-08-29, Store #16310.
- Known household product/price catalog.
- Preference rule: H-E-B for produce unless another store meaningfully wins.
- Only clipped coupons count.
- Unverified prices are excluded.
- Quantity impact matters.

## Run
Open `index.html` locally, or host via GitHub Pages.

## GitHub Pages
After uploading to a new repo:
Settings -> Pages -> Deploy from branch -> main / root

## Next milestones
1. Receipt image importer with confirmation flow
2. Historical price table per product/store
3. Exact UPC/size matching
4. Walmart/H-E-B/DG comparison
5. Coupon wallet
6. Checkout prediction and receipt reconciliation
