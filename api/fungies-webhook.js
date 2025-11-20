import crypto from "crypto";
import getRawBody from "raw-body";

function verifySignature(raw, secret, signature) {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const provided = String(signature).replace(/^sha256=/, "").trim();
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function base64urlEncode(obj) {
  const json = typeof obj === "string" ? obj : JSON.stringify(obj);
  return Buffer.from(json).toString("base64").replace(/=+/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function createGhostAdminToken(key) {
  if (!key) throw new Error("Missing GHOST_ADMIN_API_KEY");
  const [id, secretHex] = key.split(":");
  const secret = Buffer.from(secretHex, "hex");
  const header = { alg: "HS256", kid: id, typ: "JWT" };
  const iat = Math.floor(Date.now() / 1000);
  const payload = { iat, exp: iat + 300, aud: "/admin/" };
  const encodedHeader = base64urlEncode(header);
  const encodedPayload = base64urlEncode(payload);
  const toSign = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac("sha256", secret).update(toSign).digest("base64").replace(/=+/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${toSign}.${signature}`;
}

async function ghostFetch(url, token, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Ghost ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ghost API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function findMemberByEmail(base, token, email) {
  const u = `${base}/members/?filter=email:${encodeURIComponent(email)}&limit=1`;
  const j = await ghostFetch(u, token);
  return (j.members && j.members[0]) || null;
}

async function getMemberById(base, token, id) {
  const u = `${base}/members/${encodeURIComponent(id)}/`;
  const j = await ghostFetch(u, token);
  return (j.members && j.members[0]) || null;
}

async function createMember(base, token, member) {
  const body = { members: [member] };
  const j = await ghostFetch(`${base}/members/`, token, { method: "POST", body: JSON.stringify(body) });
  return (j.members && j.members[0]) || null;
}

async function updateMember(base, token, member) {
  const body = { members: [member] };
  const j = await ghostFetch(`${base}/members/${encodeURIComponent(member.id)}/`, token, { method: "PUT", body: JSON.stringify(body) });
  return (j.members && j.members[0]) || null;
}

function ensureLabelSet(labels, label, shouldHave) {
  const names = (labels || []).map((l) => (typeof l === "string" ? l : l.name));
  const has = names.includes(label);
  if (shouldHave && !has) names.push(label);
  if (!shouldHave && has) {
    const i = names.indexOf(label);
    names.splice(i, 1);
  }
  return names.map((n) => ({ name: n }));
}

function extractEventType(payload) {
  return (
    payload?.type || payload?.event || payload?.action || payload?.event?.type || payload?.data?.type || payload?.data?.event
  );
}

function extractEmail(payload) {
  return (
    payload?.email || payload?.customer_email || payload?.customer?.email || payload?.user?.email || payload?.data?.customer?.email || payload?.subscription?.customer?.email
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const raw = await getRawBody(req);
  const signature = req.headers["x-fungies-signature"]; 
  const ok = verifySignature(raw, process.env.FUNGIES_WEBHOOK_SECRET, signature);
  if (!ok) {
    res.status(401).json({ error: "invalid_signature" });
    return;
  }
  let payload;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    res.status(400).json({ error: "invalid_json" });
    return;
  }
  const evt = extractEventType(payload);
  const email = extractEmail(payload);
  if (!email) {
    res.status(400).json({ error: "missing_email" });
    return;
  }
  const key = process.env.GHOST_ADMIN_API_KEY;
  const token = createGhostAdminToken(key);
  const siteUrl = (process.env.GHOST_ADMIN_API_URL || process.env.GHOST_SITE_URL || "").replace(/\/$/, "");
  if (!siteUrl) {
    res.status(500).json({ error: "missing_ghost_url" });
    return;
  }
  const base = `${siteUrl}/ghost/api/admin`;
  let member = await findMemberByEmail(base, token, email);
  if (!member) {
    member = await createMember(base, token, { email, labels: [] });
  }
  const label = "active-subscriber";
  const addEvents = ["subscription.created", "subscription.updated", "subscription.renewed"]; 
  const removeEvents = ["subscription.cancelled", "payment.failed"]; 
  if (addEvents.includes(evt)) {
    const refreshed = await getMemberById(base, token, member.id);
    const labels = ensureLabelSet(refreshed?.labels || member.labels || [], label, true);
    await updateMember(base, token, { id: member.id, labels });
    res.status(200).json({ ok: true, event: evt, action: "label_added" });
    return;
  }
  if (removeEvents.includes(evt)) {
    const refreshed = await getMemberById(base, token, member.id);
    const labels = ensureLabelSet(refreshed?.labels || member.labels || [], label, false);
    await updateMember(base, token, { id: member.id, labels });
    res.status(200).json({ ok: true, event: evt, action: "label_removed" });
    return;
  }
  res.status(200).json({ ok: true, ignored: true, event: evt });
}