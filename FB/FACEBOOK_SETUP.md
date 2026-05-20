# 📱 SonarGold Facebook Auto-Post System

## Overview

This system extends your existing GitHub Actions price bot to **automatically post to your Facebook Page** whenever BAJUS gold or silver prices change.

---

## Files Added

| File | Location | Purpose |
|------|----------|---------|
| `fb-post.js` | repo root | Main script: detect change → generate image → post to FB |
| `fb-post-template.html` | repo root | HTML template rendered into the post image |
| `.github/workflows/gold-price-bot.yml` | workflows folder | Updated workflow (Job 1 = existing, Job 2 = new FB post) |

---

## One-Time Setup

### Step 1: Get a Facebook Long-Lived Page Access Token

1. Go to **[Meta for Developers](https://developers.facebook.com/)** → create an App (type: Business)
2. Add **Facebook Login** product to your app
3. Go to **Graph API Explorer** → select your app → select your **Page** from the dropdown
4. Request these permissions:
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `publish_pages`
5. Click **Generate Access Token** → copy the short-lived token
6. Exchange for a **long-lived token** (valid ~60 days, renewable):
   ```
   GET https://graph.facebook.com/v19.0/oauth/access_token
     ?grant_type=fb_exchange_token
     &client_id=YOUR_APP_ID
     &client_secret=YOUR_APP_SECRET
     &fb_exchange_token=SHORT_LIVED_TOKEN
   ```
7. Then get your **Page Access Token** (this one never expires if the app is live):
   ```
   GET https://graph.facebook.com/v19.0/me/accounts?access_token=LONG_LIVED_USER_TOKEN
   ```
   Use the `access_token` from the response for your page.

### Step 2: Add GitHub Secrets

In your repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret Name | Value |
|-------------|-------|
| `FB_PAGE_ACCESS_TOKEN` | Your Page Access Token (never-expiring) |
| `FB_PAGE_ID` | Your numeric Facebook Page ID |

To find your Page ID: Go to your Facebook Page → **About** → scroll down → **Page ID**

### Step 3: Install npm packages

Add these to your `package.json` devDependencies (or they'll be installed on the fly):

```json
{
  "devDependencies": {
    "puppeteer": "^22.0.0",
    "form-data": "^4.0.0",
    "node-fetch": "^2.7.0"
  }
}
```

### Step 4: Deploy files

Copy these files to your repository root:
- `fb-post.js`
- `fb-post-template.html`

Replace your `.github/workflows/` YAML file with `gold-price-bot.yml`.

---

## How It Works

```
[Every Hour]
     │
     ▼
Job 1: update-prices (UNCHANGED)
  - Scrape Bajus + international prices
  - Save to data/latest.json
  - Commit & push
     │
     ▼ (on success)
Job 2: post-to-facebook (NEW)
  - Pull fresh data/latest.json
  - Compare with data/fb_last_posted.json
  - If NO change → exit (no post)
  - If CHANGED:
      → Render HTML template with new + old prices
      → Puppeteer screenshot → 1080×1080 PNG
      → POST to FB Graph API /photos endpoint
      → Save fb_last_posted.json
      → Commit & push snapshot
```

---

## Data Format Expected (latest.json)

Your existing scraper must produce `data/latest.json` with this shape:

```json
{
  "bajus_ok": true,
  "gold": {
    "bajus_g22": 8500.00,
    "bajus_g21": 8100.00,
    "bajus_g18": 6950.00
  },
  "silver": {
    "bajus_s22": 140.00,
    "bajus_s21": 133.00,
    "bajus_s18": 114.00
  }
}
```

> **Note:** International prices (`intl_usd_oz`) are intentionally ignored for Facebook posts — only BAJUS local prices are used and compared.

---

## Manual Trigger (Force Post)

To force a Facebook post even if prices haven't changed:

1. Go to **Actions** tab in GitHub
2. Select **SonarGold Price Bot** workflow
3. Click **Run workflow**
4. Set `force_fb_post` input to `true`
5. Click **Run workflow**

---

## Image Preview

The generated image (1080×1080 px) features:
- 🌑 Dark luxury background with gold/purple orbs
- Your **NFJS logo** top-left
- Bengali date top-right
- **3 gold karats** (22K, 21K, 18K) with current price, previous price, and change badge
- **3 silver karats** (22K, 21K, 18K) same format
- 🟢 Green UP arrow / 🔴 Red DOWN arrow on price changes
- BAJUS attribution footer

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `Missing FB_PAGE_ACCESS_TOKEN` | Add secrets to GitHub repo settings |
| `Facebook API error: (#200) Requires publish_pages` | Add `publish_pages` permission to your FB app |
| Token expired | Regenerate long-lived page access token |
| Image looks broken | Run locally: `node fb-post.js` and inspect `fb-post-output.png` |
| Bengali fonts missing | The workflow installs `fonts-noto` and `fonts-beng` automatically |
