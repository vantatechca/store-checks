# Store Checks

Monitors all of your Shopify store domains twice a day, screenshots each site, classifies problems (with AI for ambiguous cases), and reports everything to Discord — with a simple web dashboard.

## What it does

1. **Upload** a CSV or Excel file with your store domains (one per cell/row — extra columns are fine, anything that looks like a domain is picked up). Uploading a new file **replaces** the previous list entirely.
2. **Twice a day** (8 AM & 8 PM Toronto time by default) the app visits every domain with a real headless browser and takes a screenshot.
3. Each store is classified as one of:
   - ✅ **Up and Running**
   - **DNS Issue** — the domain doesn't resolve
   - **Store Unavailable** — Shopify's "this store is unavailable" page
   - **Raw Shopify Domain** — the site redirects to `*.myshopify.com` (no public domain connected)
   - **Password Protected** — Shopify password/"Opening soon" page
   - **Site Error** — HTTP 4xx/5xx or connection failure
   - **Timed Out / Unknown**
4. Most classification is rule-based (fast + free). Only ambiguous pages are sent to **AI** (Gemini or OpenAI, switchable) for screenshot analysis.
5. **Error screenshots are uploaded to Cloudinary**; healthy stores are not stored.
6. A **Discord report** is sent after every run:
   - `757/800 — Up and Running` summary
   - **New Issues** — problems that appeared this run
   - **Ongoing Issues** grouped by *"Issues since [date]"* — problems that persist across checks
   - each issue shows `domain — error` with the screenshot embedded
   - recovery notices when a store comes back up
7. The **dashboard** shows stores monitored, up/down counts, open issues with screenshots grouped by first-seen date, a status breakdown, and check history.

## Setup

### 1. Create your accounts (all have free tiers)

- **Discord webhook**: in your Discord channel → ⚙️ Edit Channel → Integrations → Webhooks → *New Webhook* → *Copy Webhook URL*.
- **Cloudinary**: [cloudinary.com](https://cloudinary.com) → Dashboard → copy *Cloud name*, *API Key*, *API Secret*.
- **Gemini key**: [aistudio.google.com](https://aistudio.google.com) → *Get API key* (recommended, generous free tier), and/or an **OpenAI key** from [platform.openai.com](https://platform.openai.com).

### 2. Configure

Copy `.env.example` to `.env` and fill in the values. `AI_PROVIDER` picks the primary AI (`gemini` or `openai`); if the primary fails and the other key is set, it falls back automatically.

### 3. Deploy to Railway (recommended)

1. Push this repo to GitHub and create a new Railway project → *Deploy from GitHub repo*. Railway detects the `Dockerfile` automatically.
2. Add a **Volume** mounted at `/data` (this is where the SQLite database lives — without it, data is lost on redeploys).
3. Add the environment variables from `.env.example` (leave `DATABASE_URL` as `file:/data/store-checks.db`).
4. Generate a public domain for the service (Settings → Networking) and open the dashboard.

Render works the same way (Web Service from Dockerfile + a persistent disk mounted at `/data`).

### 4. Local development

```bash
npm install
npx playwright install chromium   # once
cp .env.example .env              # fill in your keys
npm run db:push                   # create the SQLite database
npm run dev                       # dashboard on http://localhost:3000
```

Trigger a check any time with the **Run Check Now** button, or from the CLI with `npm run check:once`.

## Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `file:./dev.db` | SQLite database location |
| `DISCORD_WEBHOOK_URL` | — | where reports are sent |
| `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` | — | error screenshot storage |
| `AI_PROVIDER` | `gemini` | primary AI (`gemini` or `openai`) |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | — | AI keys (set one or both) |
| `CHECK_CRON` | `0 8,20 * * *` | check schedule (cron format) |
| `TZ` | `America/Toronto` | timezone for the schedule and reports |
| `CHECK_CONCURRENCY` | `6` | stores checked in parallel |
| `NAV_TIMEOUT_MS` | `30000` | per-site page load timeout |

## Notes

- ~800 stores at concurrency 6 takes roughly 30–45 minutes per run.
- The store list, check runs, results, and issue history all live in SQLite — no external database needed.
- Issues keep their original **first seen** date across runs, which powers the "Issues since [date]" grouping in Discord and on the dashboard.
