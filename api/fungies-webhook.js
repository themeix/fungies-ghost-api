// api/create-payment.js
const axios = require('axios');

const FUNGIES_PUBLIC_KEY = process.env.FUNGIES_PUBLIC_KEY || 'pub_kblEOEVp1m18vSSkr20FUer7vbrm88eQXtIrngC87wI=';
const FUNGIES_SECRET_KEY = process.env.FUNGIES_SECRET_KEY || 'sec_pRg0uSwV4Ea5FVWwBUf7O9iPZQYLZoiF/RQbiynNA7A=';
const FUNGIES_PUBLIC_KEY = process.env.FUNGIES_PUBLIC_KEY || 'pub_kblEOEVp1m18vSSkr20FUer7vbrm88eQXtIrngC87wI=';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { amount, email, name } = req.body;

    if (!amount || !email || !name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const response = await axios.post(
      'https://api.fungies.io/v1/sessions',
      {
        amount: amount,
        currency: 'USD',
        successUrl: `${process.env.VERCEL_URL || req.headers.host}/payment-success`,
        cancelUrl: `${process.env.VERCEL_URL || req.headers.host}/payment-cancel`,
        metadata: {
          email: email,
          name: name
        }
      },
      {
        headers: {
          'x-fngs-public-key': FUNGIES_PUBLIC_KEY,
          'x-fngs-secret-key': FUNGIES_SECRET_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    res.status(200).json({ 
      sessionId: response.data.id,
      checkoutUrl: response.data.url 
    });
  } catch (error) {
    console.error('Fungies API Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to create payment session' });
  }
}

// api/webhook.js
const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const FUNGIES_SECRET_KEY = process.env.FUNGIES_SECRET_KEY || 'sec_pRg0uSwV4Ea5FVWwBUf7O9iPZQYLZoiF/RQbiynNA7A=';
const FUNGIES_PUBLIC_KEY = process.env.FUNGIES_PUBLIC_KEY || 'pub_kblEOEVp1m18vSSkr20FUer7vbrm88eQXtIrngC87wI=';
const GHOST_ADMIN_KEY = process.env.GHOST_ADMIN_KEY || '691f32998338c8000199ee57:e35d2e5924d76a802a03f14d4a9b179b90ab0e99769d9c3d395fa3e7ce70dff4';
const GHOST_API_URL = process.env.GHOST_API_URL || 'https://diary-of-the-libertine-muse.ghost.io';

// Disable body parsing, need raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

// Helper to get raw body
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
    });
    req.on('end', () => {
      resolve(data);
    });
    req.on('error', reject);
  });
}

// Generate Ghost Admin API JWT token
function generateGhostToken() {
  const [id, secret] = GHOST_ADMIN_KEY.split(':');
  const token = jwt.sign({}, Buffer.from(secret, 'hex'), {
    keyid: id,
    algorithm: 'HS256',
    expiresIn: '5m',
    audience: `/admin/`
  });
  return token;
}

// Create a member in Ghost
async function createGhostMember(email, name) {
  try {
    const token = generateGhostToken();
    const response = await axios.post(
      `${GHOST_API_URL}/ghost/api/admin/members/`,
      {
        members: [{
          email: email,
          name: name,
          note: 'Created via Fungies payment'
        }]
      },
      {
        headers: {
          'Authorization': `Ghost ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Ghost API Error:', error.response?.data || error.message);
    throw error;
  }
}

// Verify Fungies webhook signature
function verifyFungiesSignature(rawBody, signature) {
  const hmac = crypto.createHmac('sha256', FUNGIES_SECRET_KEY);
  hmac.update(rawBody);
  const calculatedSignature = hmac.digest('base64');
  return calculatedSignature === signature;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers['x-fungies-signature'];
    
    // Verify webhook signature
    if (!verifyFungiesSignature(rawBody, signature)) {
      console.error('Invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(rawBody);

    // Handle successful payment
    if (event.type === 'payment.succeeded') {
      const { email, name } = event.data.metadata;
      
      if (!email || !name) {
        console.error('Missing email or name in metadata');
        return res.status(400).json({ error: 'Missing required metadata' });
      }

      // Create user in Ghost
      const ghostMember = await createGhostMember(email, name);
      
      console.log('Ghost member created:', ghostMember.members[0].id);
      
      return res.status(200).json({ 
        success: true, 
        message: 'User created successfully',
        memberId: ghostMember.members[0].id
      });
    } else {
      return res.status(200).json({ success: true, message: 'Event received' });
    }
  } catch (error) {
    console.error('Webhook Error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

// api/payment-status.js
const axios = require('axios');

const FUNGIES_SECRET_KEY = process.env.FUNGIES_SECRET_KEY || 'sec_pRg0uSwV4Ea5FVWwBUf7O9iPZQYLZoiF/RQbiynNA7A=';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { sessionId } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }

    const response = await axios.get(
      `https://api.fungies.io/v1/sessions/${sessionId}`,
      {
        headers: {
          'x-fngs-public-key': FUNGIES_PUBLIC_KEY,
          'x-fngs-secret-key': FUNGIES_SECRET_KEY
        }
      }
    );

    res.status(200).json(response.data);
  } catch (error) {
    console.error('Error checking payment:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to check payment status' });
  }
}