// api/create-payment.js
const axios = require('axios');

const FUNGIES_PUBLIC_KEY = process.env.FUNGIES_PUBLIC_KEY || 'pub_kblEOEVp1m18vSSkr20FUer7vbrm88eQXtIrngC87wI=';
const FUNGIES_SECRET_KEY = process.env.FUNGIES_SECRET_KEY || 'sec_pRg0uSwV4Ea5FVWwBUf7O9iPZQYLZoiF/RQbiynNA7A=';
 

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