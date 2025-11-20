import crypto from "crypto";
import getRawBody from "raw-body";

function candidatesFromSecret(secret) {
  const s = String(secret || "").trim();
  const arr = [];
  const b64 = s.startsWith("sec_") ? s.slice(4) : s;
  try { arr.push(Buffer.from(b64, "base64")); } catch {}
  try { arr.push(Buffer.from(s, "hex")); } catch {}
  arr.push(Buffer.from(s, "utf8"));
  return arr.filter((b) => b && b.length > 0);
}

function bufferFromSignature(sig) {
  const raw = String(sig || "").trim();
  const cleaned = raw.replace(/^sha256=/, "");
  const tryHex = /^[0-9a-fA-F]+$/.test(cleaned);
  if (tryHex) {
    try { return Buffer.from(cleaned, "hex"); } catch {}
  }
  const b64 = cleaned.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? b64 : b64 + "=".repeat(4 - (b64.length % 4));
  try { return Buffer.from(pad, "base64"); } catch {}
  return null;
}

function verifySignature(raw, secret, signature) {
  if (!secret || !signature) return false;
  const sigBuf = bufferFromSignature(signature);
  if (!sigBuf) return false;
  for (const keyBuf of candidatesFromSecret(secret)) {
    const digestRaw = crypto.createHmac("sha256", keyBuf).update(raw).digest();
    if (digestRaw.length === sigBuf.length && crypto.timingSafeEqual(digestRaw, sigBuf)) return true;
  }
  return false;
}

function getSignatureHeader(req) {
  const h = req.headers || {};
  return (
    h["x-fungies-signature"] || h["x-fungies-signature-sha256"] || h["x-signature"] || h["x-webhook-signature"] || h["x-hub-signature"]
  );
}

function stableStringify(obj) {
  const sortObj = (o) => {
    if (Array.isArray(o)) return o.map(sortObj);
    if (o && typeof o === "object") {
      const keys = Object.keys(o).sort();
      const out = {};
      for (const k of keys) out[k] = sortObj(o[k]);
      return out;
    }
    return o;
  };
  return JSON.stringify(sortObj(obj));
}

function verifyWithFallbacks(raw, secret, payload, signature) {
  if (verifySignature(raw, secret, signature)) return true;
  let candidates = [];
  try { candidates.push(Buffer.from(stableStringify(payload))); } catch {}
  try { candidates.push(Buffer.from(JSON.stringify(payload))); } catch {}
  const id = payload?.id;
  const key = payload?.idempotencyKey;
  const type = payload?.type;
  for (const s of [id, key, type, key && id && `${id}.${key}`, key && type && `${type}.${key}`].filter(Boolean)) {
    candidates.push(Buffer.from(String(s)));
  }
  for (const c of candidates) {
    if (verifySignature(c, secret, signature)) return true;
  }
  return false;
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

function extractProductId(payload) {
  return (
    payload?.product_id || payload?.productId || payload?.product?.id || payload?.subscription?.product?.id || payload?.data?.product_id || payload?.data?.product?.id || (Array.isArray(payload?.line_items) && payload.line_items[0]?.product_id) || (Array.isArray(payload?.items) && payload.items[0]?.product?.id)
  );
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const envName = process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
    const hasGhostUrl = Boolean(process.env.GHOST_SITE_URL || process.env.GHOST_ADMIN_API_URL);
    const hasGhostKey = Boolean(process.env.GHOST_ADMIN_API_KEY);
    const hasFungiesSecret = Boolean(process.env.FUNGIES_WEBHOOK_SECRET);
    res.status(200).json({ ok: true, env: envName, ghostUrl: hasGhostUrl, ghostKey: hasGhostKey, fungiesSecret: hasFungiesSecret });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const raw = await getRawBody(req);
  const signature = getSignatureHeader(req);
  const secret = process.env.FUNGIES_WEBHOOK_SECRET;
  let payload;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    res.status(400).json({ error: "invalid_json" });
    return;
  }
  const writeKey = process.env.FUNGIES_WRITE_API_KEY;
  const readKey = process.env.FUNGIES_READ_API_KEY;
  const headerWrite = req.headers["x-write-api-key"];
  const headerRead = req.headers["x-api-key"];
  if (writeKey || readKey) {
    const okHeader = (writeKey && headerWrite === writeKey) || (readKey && headerRead === readKey);
    if (!okHeader) {
      res.status(401).json({ error: "invalid_api_key" });
      return;
    }
  }
  const ok = verifyWithFallbacks(raw, secret, payload, signature);
  if (!ok) {
    res.status(401).json({ error: "invalid_signature" });
    return;
  }
  const evt = extractEventType(payload);
  const evtName = typeof evt === "string" ? evt.toLowerCase() : "";
  const evtKey = evtName.replace(/_/g, ".");
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
  const allowedProductId = process.env.FUNGIES_PRODUCT_ID || "83b916a0-77c8-49b8-82b0-fdec2f39da9a";
  const productId = extractProductId(payload);
  if (!productId || String(productId) !== String(allowedProductId)) {
    res.status(200).json({ ok: true, ignored: true, reason: "product_mismatch", configured_product_id: Boolean(process.env.FUNGIES_PRODUCT_ID), event: evtKey || evt });
    return;
  }
  let member = await findMemberByEmail(base, token, email);
  if (!member) {
    member = await createMember(base, token, { email, labels: [] });
  }
  const label = "active-subscriber";
  const addEvents = [
    "subscription.created",
    "subscription.updated",
    "subscription.renewed",
    "subscription.interval",
    "payment.success",
  ];
  const removeEvents = [
    "subscription.cancelled",
    "payment.failed",
    "payment.refunded",
  ];
  if (addEvents.includes(evtKey)) {
    const refreshed = await getMemberById(base, token, member.id);
    const labels = ensureLabelSet(refreshed?.labels || member.labels || [], label, true);
    await updateMember(base, token, { id: member.id, labels });
    res.status(200).json({ ok: true, event: evt, action: "label_added" });
    return;
  }
  if (removeEvents.includes(evtKey)) {
    const refreshed = await getMemberById(base, token, member.id);
    const labels = ensureLabelSet(refreshed?.labels || member.labels || [], label, false);
    await updateMember(base, token, { id: member.id, labels });
    res.status(200).json({ ok: true, event: evt, action: "label_removed" });
    return;
  }
  res.status(200).json({ ok: true, ignored: true, event: evtKey || evt });
}