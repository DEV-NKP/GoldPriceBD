#!/usr/bin/env node
/**
 * fb-post.js — SonarGold Facebook Price Update Bot
 *
 * Flow:
 *  1. Load latest.json (new prices from scraper)
 *  2. Load data/fb_last_posted.json (prices at last FB post)
 *  3. Compare Bajus gold & silver prices only
 *  4. If changed → render HTML template → Puppeteer screenshot → POST to FB
 *  5. Save new prices to fb_last_posted.json
 *
 * Env vars required (GitHub Secrets):
 *   FB_PAGE_ACCESS_TOKEN  — long-lived Page Access Token
 *   FB_PAGE_ID            — numeric Facebook Page ID
 */

const fs   = require("fs");
const path = require("path");

// ── helpers ──────────────────────────────────────────────────────────────────

const DATA_DIR        = path.resolve(__dirname, "data");
const LATEST_JSON     = path.join(DATA_DIR, "latest.json");
const LAST_POSTED_JSON= path.join(DATA_DIR, "fb_last_posted.json");
const TEMPLATE_HTML   = path.join(__dirname, "fb-post-template.html");
const OUTPUT_IMAGE    = path.join(__dirname, "fb-post-output.png");

/** Convert English digits → Bengali digits */
function toBengaliNum(num) {
  if (num === null || num === undefined) return "—";
  return String(Number(num).toFixed(2))
    .replace(/0/g,"০").replace(/1/g,"১").replace(/2/g,"২")
    .replace(/3/g,"৩").replace(/4/g,"৪").replace(/5/g,"৫")
    .replace(/6/g,"৬").replace(/7/g,"৭").replace(/8/g,"৮")
    .replace(/9/g,"৯").replace(/\./g,".");
}

/** Format today's date in Bengali */
function bengaliDate() {
  const now = new Date();
  const days = ["রবিবার","সোমবার","মঙ্গলবার","বুধবার","বৃহস্পতিবার","শুক্রবার","শনিবার"];
  const months = ["জানুয়ারি","ফেব্রুয়ারি","মার্চ","এপ্রিল","মে","জুন",
                  "জুলাই","আগস্ট","সেপ্টেম্বর","অক্টোবর","নভেম্বর","ডিসেম্বর"];
  const d = toBengaliNum(now.getDate()).replace(/\./g,"");
  const m = months[now.getMonth()];
  const y = toBengaliNum(now.getFullYear()).replace(/\./g,"");
  const wd = days[now.getDay()];
  return `${wd}, ${d} ${m} ${y}`;
}

/** Compute direction class + arrow + absolute diff */
function delta(newVal, oldVal) {
  const n = parseFloat(newVal) || 0;
  const o = parseFloat(oldVal) || 0;
  const diff = n - o;
  if (!o || diff === 0) return { dir: "neutral", arrow: "➡️", diff: "০.০০" };
  if (diff > 0) return { dir: "up",   arrow: "↑", diff: toBengaliNum(diff) };
  return              { dir: "down",  arrow: "↓", diff: toBengaliNum(Math.abs(diff)) };
}

/** Render HTML template with real data, return filled HTML string */
function renderTemplate(latest, prev) {
  let html = fs.readFileSync(TEMPLATE_HTML, "utf-8");

  const g = latest.gold   || {};
  const s = latest.silver || {};
  const pg= prev.gold     || {};
  const ps= prev.silver   || {};

  const fields = {
    DATE:     bengaliDate(),

    G22_NEW:  toBengaliNum(g.bajus_g22),
    G22_PREV: toBengaliNum(pg.bajus_g22),
    ...prefixDelta("G22", delta(g.bajus_g22, pg.bajus_g22)),

    G21_NEW:  toBengaliNum(g.bajus_g21),
    G21_PREV: toBengaliNum(pg.bajus_g21),
    ...prefixDelta("G21", delta(g.bajus_g21, pg.bajus_g21)),

    G18_NEW:  toBengaliNum(g.bajus_g18),
    G18_PREV: toBengaliNum(pg.bajus_g18),
    ...prefixDelta("G18", delta(g.bajus_g18, pg.bajus_g18)),

    S22_NEW:  toBengaliNum(s.bajus_s22),
    S22_PREV: toBengaliNum(ps.bajus_s22),
    ...prefixDelta("S22", delta(s.bajus_s22, ps.bajus_s22)),

    S21_NEW:  toBengaliNum(s.bajus_s21),
    S21_PREV: toBengaliNum(ps.bajus_s21),
    ...prefixDelta("S21", delta(s.bajus_s21, ps.bajus_s21)),

    S18_NEW:  toBengaliNum(s.bajus_s18),
    S18_PREV: toBengaliNum(ps.bajus_s18),
    ...prefixDelta("S18", delta(s.bajus_s18, ps.bajus_s18)),
  };

  for (const [k, v] of Object.entries(fields)) {
    html = html.replaceAll(`{{${k}}}`, v);
  }
  return html;
}

function prefixDelta(prefix, d) {
  return {
    [`${prefix}_DIR`]:   d.dir,
    [`${prefix}_ARROW`]: d.arrow,
    [`${prefix}_DIFF`]:  d.diff,
  };
}

/** Use Puppeteer to screenshot the filled HTML → PNG */
async function generateImage(html) {
  const puppeteer = require("puppeteer");
  const tmpHtml = path.join(__dirname, "_tmp_post.html");
  fs.writeFileSync(tmpHtml, html, "utf-8");

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--font-render-hinting=none",
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 2 });
  await page.goto(`file://${tmpHtml}`, { waitUntil: "networkidle0", timeout: 30000 });
  // Extra wait for Google Fonts
  await new Promise(r => setTimeout(r, 2500));
  await page.screenshot({ path: OUTPUT_IMAGE, type: "png", fullPage: false });
  await browser.close();
  fs.unlinkSync(tmpHtml);
  console.log(`✅ Image saved: ${OUTPUT_IMAGE}`);
  return OUTPUT_IMAGE;
}

/** Build Bengali caption for the FB post */
function buildCaption(latest, prev) {
  const g  = latest.gold   || {};
  const s  = latest.silver || {};
  const pg = prev.gold     || {};
  const ps = prev.silver   || {};

  const d22  = delta(g.bajus_g22, pg.bajus_g22);
  const ds22 = delta(s.bajus_s22, ps.bajus_s22);

  const dir22  = d22.dir  === "up" ? "📈 বৃদ্ধি পেয়েছে" : d22.dir  === "down" ? "📉 কমেছে" : "অপরিবর্তিত";
  const dirs22 = ds22.dir === "up" ? "📈 বৃদ্ধি পেয়েছে" : ds22.dir === "down" ? "📉 কমেছে" : "অপরিবর্তিত";

  const now = new Date();
  const timeStr = now.toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit" });

  return `🔔 বাজুস অনুমোদিত স্বর্ণ ও রূপার নতুন মূল্য!

🥇 স্বর্ণের মূল্য (প্রতি গ্রাম):
• ২২ ক্যারেট: ${g.bajus_g22 || "—"} ৳ — ${dir22} (${d22.arrow} ${d22.diff} ৳)
• ২১ ক্যারেট: ${g.bajus_g21 || "—"} ৳
• ১৮ ক্যারেট: ${g.bajus_g18 || "—"} ৳

🥈 রূপার মূল্য (প্রতি গ্রাম):
• ২২ ক্যারেট: ${s.bajus_s22 || "—"} ৳ — ${dirs22} (${ds22.arrow} ${ds22.diff} ৳)
• ২১ ক্যারেট: ${s.bajus_s21 || "—"} ৳
• ১৮ ক্যারেট: ${s.bajus_s18 || "—"} ৳

📅 তারিখ: ${bengaliDate()}
🕐 সময়: ${timeStr}

✅ তথ্যসূত্র: বাংলাদেশ জুয়েলার্স সমিতি (বাজুস)
🌐 সঠিক ও আপডেট মূল্য জানতে আমাদের পেজ ফলো করুন!

#স্বর্ণমূল্য #রূপামূল্য #বাজুস #সোনারদাম #GoldPriceBD #SilverPriceBD #বাংলাদেশ #জুয়েলারি`;
}

/** Upload image + caption to Facebook Page */
async function postToFacebook(imagePath, caption) {
  const token  = process.env.FB_PAGE_ACCESS_TOKEN;
  const pageId = process.env.FB_PAGE_ID;

  if (!token || !pageId) {
    throw new Error("❌ Missing FB_PAGE_ACCESS_TOKEN or FB_PAGE_ID env vars");
  }

  // Use form-data + node-fetch to upload image
  const FormData = require("form-data");
  const fetch    = require("node-fetch");

  const form = new FormData();
  form.append("source", fs.createReadStream(imagePath), {
    filename: "gold-price.png",
    contentType: "image/png",
  });
  form.append("caption", caption);
  form.append("access_token", token);

  const url = `https://graph.facebook.com/v19.0/${pageId}/photos`;
  console.log(`📤 Posting to Facebook page ${pageId}...`);

  const res  = await fetch(url, { method: "POST", body: form });
  const body = await res.json();

  if (!res.ok || body.error) {
    throw new Error(`Facebook API error: ${JSON.stringify(body.error || body)}`);
  }

  console.log(`✅ Posted! Post ID: ${body.id}`);
  return body.id;
}

/** Check if Bajus gold or silver prices changed vs last post */
function pricesChanged(latest, prev) {
  const g  = latest.gold   || {};
  const s  = latest.silver || {};
  const pg = prev.gold     || {};
  const ps = prev.silver   || {};

  const keys = ["bajus_g22","bajus_g21","bajus_g18"];
  const skeys= ["bajus_s22","bajus_s21","bajus_s18"];

  for (const k of keys) {
    if (parseFloat(g[k]) !== parseFloat(pg[k])) {
      console.log(`📊 Gold price changed: ${k} ${pg[k]} → ${g[k]}`);
      return true;
    }
  }
  for (const k of skeys) {
    if (parseFloat(s[k]) !== parseFloat(ps[k])) {
      console.log(`📊 Silver price changed: ${k} ${ps[k]} → ${s[k]}`);
      return true;
    }
  }
  return false;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Load latest scraped prices
  if (!fs.existsSync(LATEST_JSON)) {
    console.log("⚠️  latest.json not found — skipping FB post");
    process.exit(0);
  }
  const latest = JSON.parse(fs.readFileSync(LATEST_JSON, "utf-8"));

  if (!latest.bajus_ok) {
    console.log("⚠️  bajus_ok is false — skipping FB post (no reliable Bajus data)");
    process.exit(0);
  }

  // 2. Load last-posted prices (if exists)
  const prev = fs.existsSync(LAST_POSTED_JSON)
    ? JSON.parse(fs.readFileSync(LAST_POSTED_JSON, "utf-8"))
    : { gold: {}, silver: {} };

  // 3. Compare
  if (!pricesChanged(latest, prev)) {
    console.log("✅ No Bajus price change detected — skipping FB post");
    process.exit(0);
  }

  console.log("🔔 Price change detected! Generating Facebook post...");

  // 4. Render HTML
  const html = renderTemplate(latest, prev);

  // 5. Screenshot → PNG
  const imagePath = await generateImage(html);

  // 6. Build caption
  const caption = buildCaption(latest, prev);
  console.log("\n📝 Caption preview:\n" + caption.slice(0, 200) + "...\n");

  // 7. Post to Facebook
  await postToFacebook(imagePath, caption);

  // 8. Save new "last posted" snapshot
  const snapshot = {
    posted_at: new Date().toISOString(),
    gold:   latest.gold   || {},
    silver: latest.silver || {},
  };
  fs.writeFileSync(LAST_POSTED_JSON, JSON.stringify(snapshot, null, 2), "utf-8");
  console.log(`💾 Saved snapshot to ${LAST_POSTED_JSON}`);

  // Cleanup image
  if (fs.existsSync(OUTPUT_IMAGE)) fs.unlinkSync(OUTPUT_IMAGE);
}

main().catch(err => {
  console.error("❌ FB post failed:", err.message || err);
  process.exit(1);
});
