# fungies-ghost-api

 

Webhook automation between Fungies and Ghost. Roughly:
On successful subscription purchase:
	•	Create/update the member in Ghost
	•	Add a complimentary plan or the appropriate tier so they have access

On subscription cancellation / payment failure:
	•	Update the Ghost member record
	•	Remove the complimentary plan (so access is revoked)
	•	Optionally add a label (e.g. “cancelled”)?

On subscription renewal:
	•	Ensure member access remains active

Setup
- Deploy this repository to Vercel.
- Set environment variables:
- `GHOST_SITE_URL` = `https://diary.thelibertinemuse.com`
- `GHOST_ADMIN_API_KEY` = Ghost Admin API key in `id:secret` format
- `FUNGIES_WEBHOOK_SECRET` = HMAC secret used to sign Fungies webhooks
- The webhook endpoint is `https://<your-vercel-deployment>/api/fungies-webhook`.

Behavior
- `subscription.created` → adds `active-subscriber`
- `subscription.updated` → ensures `active-subscriber`
- `subscription.renewed` → ensures `active-subscriber`
- `subscription.interval` → ensures `active-subscriber`
- `payment.success` → ensures `active-subscriber`
- `subscription.cancelled` → removes `active-subscriber`
- `payment.failed` → removes `active-subscriber`
- `payment.refunded` → removes `active-subscriber`

Notes
- Uses Ghost Admin API JWT with HS256 and `kid` header.
- Verifies request signature with HMAC SHA256 over raw body.

Local Development
- Copy `.env.example` to `.env.local` and fill values.
- Run `npm install`.
- Start local server: `npm run dev`.
- Health check: `GET http://localhost:3000/api/fungies-webhook` returns env info booleans.
- Send test POST with valid signature and minimal payload containing `email` and `type`.

Vercel Environments
- Vercel sets `VERCEL_ENV` to `development`, `preview`, or `production`.
- Configure env vars in Vercel for each environment.
- The function will read values from `process.env` without exposing secrets.

Product Filter
- Set `FUNGIES_PRODUCT_ID` to the subscription product ID to act on.
- Events are ignored unless the payload contains a matching product ID.
- Supported extraction paths include `product_id`, `product.id`, and `subscription.product.id`.
