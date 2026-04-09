// api/analyze.js
// Vercel serverless function — proxies requests to Groq (free tier)
// Tries primary model, falls back to secondary if rate limited

const MODELS = [
  'llama-3.1-8b-instant',      // fast, generous rate limit
  'llama3-8b-8192',            // fallback 1
  'gemma2-9b-it',              // fallback 2
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY not set in Vercel environment variables' });

  const { prompt, systemPrompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  // Try each model in order, fall back if rate limited
  for (const model of MODELS) {
    try {
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          max_tokens: 1200,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: systemPrompt || 'You are a helpful assistant. Always respond with valid JSON only.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      });

      const data = await groqRes.json();

      // Rate limited — try next model
      if (groqRes.status === 429) {
        console.warn(`Rate limited on ${model}, trying next...`);
        continue;
      }

      if (!groqRes.ok) {
        const msg = data?.error?.message || `Groq error ${groqRes.status}`;
        console.error('Groq error:', msg);
        return res.status(groqRes.status).json({ error: msg });
      }

      const text = data?.choices?.[0]?.message?.content ?? '';
      if (!text) return res.status(500).json({ error: 'Empty response from Groq' });

      const result = JSON.parse(text);
      return res.status(200).json({ result });

    } catch (err) {
      console.error(`Error with model ${model}:`, err);
      continue;
    }
  }

  // All models exhausted
  return res.status(429).json({ error: 'All models are currently rate limited. Please wait a moment and try again.' });
}
