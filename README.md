# Reading Rocket 📚

A kids' reading trainer with speed tests, voice analysis (Claude AI), and flash training.

## Architecture

| Layer    | Service              | Free Tier |
|----------|----------------------|-----------|
| Database | Supabase (PostgreSQL)| 500 MB    |
| Backend  | Render (Node.js)     | 750 h/mo  |
| Frontend | Vercel (Static)      | Unlimited |

---

## Step 1 — Database (Supabase)

1. Sign up at **https://supabase.com** → create a new project (pick any region, set a password).
2. Wait ~2 min for the project to provision.
3. Go to **SQL Editor** (left sidebar) → paste the contents of `database/schema.sql` → click **Run**.
4. Go to **Settings → API**:
   - Copy **Project URL** → this is `SUPABASE_URL`
   - Copy **service_role** key (not anon!) → this is `SUPABASE_SERVICE_KEY`

---

## Step 2 — Backend (Render)

### Option A — One-click via render.yaml (easiest)

1. Push this repo to GitHub.
2. Sign up at **https://render.com** → New → **Blueprint** → connect your GitHub repo.
3. Render reads `render.yaml` and creates the service automatically.
4. In the Render dashboard, set the three `sync: false` env vars:
   - `SUPABASE_URL` — from Step 1
   - `SUPABASE_SERVICE_KEY` — from Step 1
   - `FRONTEND_URL` — leave blank for now (fill in after Step 3)
5. Click **Deploy** — Render will install deps and start the server.
6. Copy your Render URL, e.g. `https://reading-rocket-backend.onrender.com`.

> **Note:** The free Render plan spins down after 15 min of inactivity.
> The first request after a sleep takes ~30 s to wake up. This is normal.

### Option B — Manual

1. Sign up at **https://render.com** → New → **Web Service** → connect repo.
2. Set:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Node version**: 18 or later
3. Add env vars (Environment tab):
   ```
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_SERVICE_KEY=eyJ...
   ENCRYPTION_KEY=<run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
   FRONTEND_URL=https://reading-rocket.vercel.app
   ```

---

## Step 3 — Frontend (Vercel)

1. **Update the backend URL** in `frontend/index.html`:
   ```js
   // Line near top of <script>
   const BACKEND_URL = 'https://reading-rocket-backend.onrender.com'; // ← your Render URL
   ```
2. Sign up at **https://vercel.com** → New Project → import your GitHub repo.
3. Set **Output Directory** to `frontend` (or Vercel reads `vercel.json` automatically).
4. Click **Deploy** — you get a URL like `https://reading-rocket.vercel.app`.
5. **Go back to Render** and update `FRONTEND_URL` to your Vercel URL, then **redeploy**.

---

## Local Development

```bash
# Install backend deps
cd backend
npm install

# Create .env from example
cp .env.example .env
# → fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, ENCRYPTION_KEY

# Generate a local encryption key:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Run backend
npm run dev   # starts on http://localhost:3001

# Open frontend (no build step needed)
open ../frontend/index.html
# then update BACKEND_URL to http://localhost:3001
```

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/users` | Register / ensure user exists |
| POST | `/api/keys` | Save encrypted Claude API key |
| GET  | `/api/keys/:userId` | Check if key exists + masked preview |
| POST | `/api/history` | Save a speed or voice test result |
| GET  | `/api/history/:userId` | Fetch 20 most recent entries |
| DELETE | `/api/history/:userId` | Clear all history for user |
| POST | `/api/analyze` | Proxy voice reading to Claude AI |
| GET  | `/health` | Health check |

---

## Security Notes

- Claude API keys are encrypted at rest with **AES-256-GCM** before storing in Supabase.
- The encryption key lives only in Render's environment — never in the database or frontend.
- Users are identified by a **UUID** generated in their browser (`localStorage`). No passwords or email required.
- CORS is locked to the frontend URL in production.
