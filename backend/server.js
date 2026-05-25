require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Supabase (service role — server only, never expose to client) ──────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// ── Encryption helpers (AES-256-GCM) ──────────────────────────────────────
const ENC_KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':');
}

function decrypt(encoded) {
  const [ivHex, tagHex, dataHex] = encoded.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

// ── Validation helpers ─────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUUID(id) { return UUID_RE.test(id); }

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── Users ──────────────────────────────────────────────────────────────────

// POST /api/users — create user if not exists (idempotent)
app.post('/api/users', async (req, res) => {
  const { userId } = req.body;
  if (!userId || !isValidUUID(userId)) return res.status(400).json({ error: 'Valid userId UUID required' });

  const { data, error } = await supabase
    .from('users')
    .upsert({ id: userId }, { onConflict: 'id' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ user: data });
});

// ── API Keys ───────────────────────────────────────────────────────────────

// POST /api/keys — encrypt and store the user's Claude API key
app.post('/api/keys', async (req, res) => {
  const { userId, apiKey } = req.body;
  if (!userId || !isValidUUID(userId)) return res.status(400).json({ error: 'Valid userId UUID required' });
  if (!apiKey || !apiKey.startsWith('sk-ant-')) return res.status(400).json({ error: 'API key must start with sk-ant-' });

  const encryptedKey = encrypt(apiKey);

  const { error } = await supabase
    .from('api_keys')
    .upsert(
      { user_id: userId, encrypted_key: encryptedKey, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// GET /api/keys/:userId — return whether a key exists + masked preview
app.get('/api/keys/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!isValidUUID(userId)) return res.status(400).json({ error: 'Invalid userId' });

  const { data, error } = await supabase
    .from('api_keys')
    .select('encrypted_key, updated_at')
    .eq('user_id', userId)
    .single();

  if (error || !data) return res.json({ hasKey: false });

  try {
    const key = decrypt(data.encrypted_key);
    const masked = key.slice(0, 10) + '...' + key.slice(-4);
    res.json({ hasKey: true, masked, updatedAt: data.updated_at });
  } catch {
    res.json({ hasKey: false });
  }
});

// ── Reading History ────────────────────────────────────────────────────────

// POST /api/history — persist a speed or voice test result
app.post('/api/history', async (req, res) => {
  const { userId, passageTitle, wpm, accuracy, testType } = req.body;
  if (!userId || !isValidUUID(userId)) return res.status(400).json({ error: 'Valid userId UUID required' });
  if (!passageTitle) return res.status(400).json({ error: 'passageTitle required' });
  if (!['speed', 'voice'].includes(testType)) return res.status(400).json({ error: 'testType must be speed or voice' });

  const { data, error } = await supabase
    .from('reading_history')
    .insert({
      user_id: userId,
      passage_title: passageTitle,
      wpm: wpm ?? null,
      accuracy: accuracy ?? null,
      test_type: testType
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ entry: data });
});

// GET /api/history/:userId — fetch up to 20 most recent entries
app.get('/api/history/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!isValidUUID(userId)) return res.status(400).json({ error: 'Invalid userId' });

  const { data, error } = await supabase
    .from('reading_history')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ history: data || [] });
});

// DELETE /api/history/:userId — wipe all history for the user
app.delete('/api/history/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!isValidUUID(userId)) return res.status(400).json({ error: 'Invalid userId' });

  const { error } = await supabase
    .from('reading_history')
    .delete()
    .eq('user_id', userId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Claude API Proxy ───────────────────────────────────────────────────────

// POST /api/analyze — look up the stored key, proxy the Claude call
app.post('/api/analyze', async (req, res) => {
  const { userId, passageTitle, expectedText, transcript } = req.body;
  if (!userId || !isValidUUID(userId)) return res.status(400).json({ error: 'Valid userId required' });
  if (!passageTitle || !expectedText || !transcript) return res.status(400).json({ error: 'passageTitle, expectedText, and transcript are required' });

  // Retrieve encrypted API key
  const { data: keyRow, error: keyErr } = await supabase
    .from('api_keys')
    .select('encrypted_key')
    .eq('user_id', userId)
    .single();

  if (keyErr || !keyRow) {
    return res.status(400).json({ error: 'No API key found. Please save your Claude API key first.' });
  }

  let apiKey;
  try {
    apiKey = decrypt(keyRow.encrypted_key);
  } catch {
    return res.status(500).json({ error: 'Failed to decrypt API key. Try saving it again.' });
  }

  const prompt = `You are a friendly, encouraging reading coach for a 3rd grader (about 8-9 years old) who is a slow reader working to improve.

The child just read this passage aloud:
PASSAGE TITLE: ${passageTitle}
EXPECTED TEXT: "${expectedText}"

WHAT THE CHILD ACTUALLY SAID (captured via speech recognition, so may have minor transcription errors):
"${transcript}"

Please analyze the child's reading and respond in this exact JSON format:
{
  "accuracy_score": <number 0-100>,
  "fluency_rating": "<Needs Practice | Getting Better | Good | Great | Excellent>",
  "words_correct": <estimated number>,
  "words_total": <total words in passage>,
  "missed_or_wrong_words": ["word1", "word2"],
  "what_went_well": "<2-3 sentences of genuine praise, warm and specific>",
  "areas_to_practice": "<1-2 specific, kind suggestions for improvement>",
  "fun_encouragement": "<one short, fun, energetic cheer for the child — keep it age-appropriate and exciting>"
}

Be generous and encouraging. Minor transcription differences from speech recognition should not be penalized. Focus on genuine errors.`;

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.json();
      return res.status(claudeRes.status).json({ error: err.error?.message || `Claude API error ${claudeRes.status}` });
    }

    const data = await claudeRes.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: `Network error reaching Claude: ${err.message}` });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Reading Rocket backend listening on port ${PORT}`);
});
