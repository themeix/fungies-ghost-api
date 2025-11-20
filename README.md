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
- `subscription.created` → adds `active-subscriber` label
- `subscription.updated` → ensures `active-subscriber` label exists
- `subscription.renewed` → ensures `active-subscriber` label exists
- `subscription.cancelled` → removes `active-subscriber` label
- `payment.failed` → removes `active-subscriber` label

Notes
- Uses Ghost Admin API JWT with HS256 and `kid` header.
- Verifies request signature with HMAC SHA256 over raw body.
