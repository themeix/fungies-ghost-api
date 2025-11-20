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
