#!/usr/bin/env node
/**
 * fb-post.js — New Fashion Jewellers (NFJS) Facebook Price Update Bot
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
const DATA_DIR         = path.resolve(__dirname, "data");
const LATEST_JSON      = path.join(DATA_DIR, "latest.json");
const LAST_POSTED_JSON = path.join(DATA_DIR, "fb_last_posted.json");
const TEMPLATE_HTML    = path.join(__dirname, "fb-post-template.html");
const OUTPUT_IMAGE     = path.join(__dirname, "fb-post-output.png");

/** Grams per vori */
const GRAMS_PER_VORI = 11.664;

/** Convert English digits → Bengali digits */
function toBengaliNum(num, decimals = 2) {
  if (num === null || num === undefined || isNaN(parseFloat(num))) return "—";
  return parseFloat(num)
    .toFixed(decimals)
    .replace(/0/g,"০").replace(/1/g,"১").replace(/2/g,"২")
    .replace(/3/g,"৩").replace(/4/g,"৪").replace(/5/g,"৫")
    .replace(/6/g,"৬").replace(/7/g,"৭").replace(/8/g,"৮")
    .replace(/9/g,"৯");
}

/** Convert price-per-gram to price-per-vori in Bengali */
function toVori(pricePerGram) {
  if (!pricePerGram) return "—";
  return toBengaliNum(parseFloat(pricePerGram) * GRAMS_PER_VORI, 0);
}

/** Format today's date in Bengali */
function bengaliDate() {
  const now  = new Date();
  const days = ["রবিবার","সোমবার","মঙ্গলবার","বুধবার","বৃহস্পতিবার","শুক্রবার","শনিবার"];
  const months = ["জানুয়ারি","ফেব্রুয়ারি","মার্চ","এপ্রিল","মে","জুন",
                  "জুলাই","আগস্ট","সেপ্টেম্বর","অক্টোবর","নভেম্বর","ডিসেম্বর"];
  const toInt = (n) => String(n)
    .replace(/0/g,"০").replace(/1/g,"১").replace(/2/g,"২")
    .replace(/3/g,"৩").replace(/4/g,"৪").replace(/5/g,"৫")
    .replace(/6/g,"৬").replace(/7/g,"৭").replace(/8/g,"৮")
    .replace(/9/g,"৯");
  const d  = toInt(now.getDate());
  const m  = months[now.getMonth()];
  const y  = toInt(now.getFullYear());
  const wd = days[now.getDay()];
  return `${wd}, ${d} ${m} ${y}`;
}

/** Bengali time string */
function bengaliTime() {
  const now = new Date();
  return now.toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit" });
}

/** Compute direction class + arrow + icon + absolute diff */
function delta(newVal, oldVal) {
  const n    = parseFloat(newVal) || 0;
  const o    = parseFloat(oldVal) || 0;
  const diff = n - o;
  if (!o || diff === 0) return { dir: "neutral", arrow: "→", icon: "fa-arrow-right", diffBn: "০.০০", diffNum: 0 };
  if (diff > 0) return { dir: "up",   arrow: "↑", icon: "fa-arrow-trend-up",   diffBn: toBengaliNum(diff),          diffNum: diff };
  return              { dir: "down",  arrow: "↓", icon: "fa-arrow-trend-down", diffBn: toBengaliNum(Math.abs(diff)), diffNum: Math.abs(diff) };
}

function prefixDelta(prefix, d) {
  return {
    [`${prefix}_DIR`]:   d.dir,
    [`${prefix}_ARROW`]: d.arrow,
    [`${prefix}_ICON`]:  d.icon,
    [`${prefix}_DIFF`]:  d.diffBn,
  };
}

/** Render HTML template with real data */
function renderTemplate(latest, prev) {
  let html = fs.readFileSync(TEMPLATE_HTML, "utf-8");

  const g  = latest.gold   || {};
  const s  = latest.silver || {};
  const pg = prev.gold     || {};
  const ps = prev.silver   || {};

  const fields = {
    DATE: bengaliDate(),

    // Gold — gram price
    G22_NEW:  toBengaliNum(g.bajus_g22, 0),
    G22_PREV: toBengaliNum(pg.bajus_g22, 0),
    ...prefixDelta("G22", delta(g.bajus_g22, pg.bajus_g22)),

    G21_NEW:  toBengaliNum(g.bajus_g21, 0),
    G21_PREV: toBengaliNum(pg.bajus_g21, 0),
    ...prefixDelta("G21", delta(g.bajus_g21, pg.bajus_g21)),

    G18_NEW:  toBengaliNum(g.bajus_g18, 0),
    G18_PREV: toBengaliNum(pg.bajus_g18, 0),
    ...prefixDelta("G18", delta(g.bajus_g18, pg.bajus_g18)),

    // Gold — traditional (সনাতন)
    GTR_NEW:  toBengaliNum(g.bajus_gtr, 0),
    GTR_PREV: toBengaliNum(pg.bajus_gtr, 0),
    ...prefixDelta("GTR", delta(g.bajus_gtr, pg.bajus_gtr)),

    // Gold — vori prices
    G22_VORI: toVori(g.bajus_g22),
    G21_VORI: toVori(g.bajus_g21),
    G18_VORI: toVori(g.bajus_g18),
    GTR_VORI: toVori(g.bajus_gtr),

    // Silver — gram price
    S22_NEW:  toBengaliNum(s.bajus_s22, 0),
    S22_PREV: toBengaliNum(ps.bajus_s22, 0),
    ...prefixDelta("S22", delta(s.bajus_s22, ps.bajus_s22)),

    S21_NEW:  toBengaliNum(s.bajus_s21, 0),
    S21_PREV: toBengaliNum(ps.bajus_s21, 0),
    ...prefixDelta("S21", delta(s.bajus_s21, ps.bajus_s21)),

    S18_NEW:  toBengaliNum(s.bajus_s18, 0),
    S18_PREV: toBengaliNum(ps.bajus_s18, 0),
    ...prefixDelta("S18", delta(s.bajus_s18, ps.bajus_s18)),

    // Silver — traditional (সনাতন)
    STR_NEW:  toBengaliNum(s.bajus_str, 0),
    STR_PREV: toBengaliNum(ps.bajus_str, 0),
    ...prefixDelta("STR", delta(s.bajus_str, ps.bajus_str)),

    // Silver — vori prices
    S22_VORI: toVori(s.bajus_s22),
    S21_VORI: toVori(s.bajus_s21),
    S18_VORI: toVori(s.bajus_s18),
    STR_VORI: toVori(s.bajus_str),
  };

  for (const [k, v] of Object.entries(fields)) {
    html = html.replaceAll(`{{${k}}}`, v);
  }
  return html;
}
/** Use Puppeteer to screenshot the filled HTML → PNG */
async function generateImage(html) {
  const puppeteer = require("puppeteer");
  const tmpHtml   = path.join(__dirname, "_tmp_post.html");
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
  await new Promise(r => setTimeout(r, 3000)); // wait for Google Fonts
  await page.screenshot({ path: OUTPUT_IMAGE, type: "png", fullPage: false });
  await browser.close();

  fs.unlinkSync(tmpHtml);
  console.log(`✅ Image saved: ${OUTPUT_IMAGE}`);
  return OUTPUT_IMAGE;
}

/** Build professional Bengali caption for the FB post */
function buildCaption(latest, prev) {
  const g  = latest.gold   || {};
  const s  = latest.silver || {};
  const pg = prev.gold     || {};
  const ps = prev.silver   || {};

  const d22  = delta(g.bajus_g22, pg.bajus_g22);
  const ds22 = delta(s.bajus_s22, ps.bajus_s22);

  function dirLabel(d, diffBn) {
    if (d.dir === "up")   return `📈 ${diffBn} ৳ বৃদ্ধি`;
    if (d.dir === "down") return `📉 ${diffBn} ৳ হ্রাস`;
    return "অপরিবর্তিত";
  }

  const fmt  = (v) => v ? Number(v).toLocaleString("en-BD") : "—";
  const vori = (v) => v ? Math.round(parseFloat(v) * GRAMS_PER_VORI).toLocaleString("en-BD") : "—";

  const date   = bengaliDate();
  const time   = bengaliTime();
  const dir22  = dirLabel(d22,  d22.diffBn);
  const dirs22 = dirLabel(ds22, ds22.diffBn);

  return `✨ নিউ ফ্যাশন জুয়েলার্স (NFJ) — আজকের স্বর্ণ ও রূপার মূল্য
📅 ${date} | 🕐 ${time}
━━━━━━━━━━━━━━━━━━
🥇 স্বর্ণের মূল্য (বাজুস অনুমোদিত)
━━━━━━━━━━━━━━━━━━
▸ ২২ ক্যারেট
   প্রতি গ্রাম : ${fmt(g.bajus_g22)} ৳  |  প্রতি ভরি : ${vori(g.bajus_g22)} ৳
   পরিবর্তন   : ${dir22}
▸ ২১ ক্যারেট
   প্রতি গ্রাম : ${fmt(g.bajus_g21)} ৳  |  প্রতি ভরি : ${vori(g.bajus_g21)} ৳
▸ ১৮ ক্যারেট
   প্রতি গ্রাম : ${fmt(g.bajus_g18)} ৳  |  প্রতি ভরি : ${vori(g.bajus_g18)} ৳
▸ সনাতন পদ্ধতি
   প্রতি গ্রাম : ${fmt(g.bajus_gtr)} ৳  |  প্রতি ভরি : ${vori(g.bajus_gtr)} ৳
━━━━━━━━━━━━━━━━━━
🥈 রূপার মূল্য (বাজুস অনুমোদিত)
━━━━━━━━━━━━━━━━━━
▸ ২২ ক্যারেট
   প্রতি গ্রাম : ${fmt(s.bajus_s22)} ৳  |  প্রতি ভরি : ${vori(s.bajus_s22)} ৳
   পরিবর্তন   : ${dirs22}
▸ ২১ ক্যারেট
   প্রতি গ্রাম : ${fmt(s.bajus_s21)} ৳  |  প্রতি ভরি : ${vori(s.bajus_s21)} ৳
▸ ১৮ ক্যারেট
   প্রতি গ্রাম : ${fmt(s.bajus_s18)} ৳  |  প্রতি ভরি : ${vori(s.bajus_s18)} ৳
▸ সনাতন পদ্ধতি
   প্রতি গ্রাম : ${fmt(s.bajus_str)} ৳  |  প্রতি ভরি : ${vori(s.bajus_str)} ৳
━━━━━━━━━━━━━━━━━━
📌 তথ্যসূত্র : বাংলাদেশ জুয়েলার্স সমিতি (বাজুস)
🌐 ওয়েবসাইট  : https://nfjs.odoo.com
📞 যোগাযোগ   : +880 1911-367421
💍 নিউ ফ্যাশন জুয়েলার্স — ৩৫+ বছরের বিশ্বস্ততা ও অভিজ্ঞতায় আপনার পাশে।
সোনা কেনা বা বেচার আগে সঠিক মূল্য জানুন — আমাদের পেজ ফলো করুন এবং বন্ধুদের সাথে শেয়ার করুন! 🔔
#NFJ #নিউফ্যাশনজুয়েলার্স #স্বর্ণমূল্য #রূপামূল্য #বাজুস #আজকেরসোনারদাম #GoldPriceBD #SilverPriceBD #SonarDam #বাংলাদেশ #ঢাকা #জুয়েলারি #NewFashionJewellers #GoldRate #HallmarkedGold`;
}

/** Check if Bajus gold or silver prices changed vs last post */
function pricesChanged(latest, prev) {
  const g  = latest.gold   || {};
  const s  = latest.silver || {};
  const pg = prev.gold     || {};
  const ps = prev.silver   || {};

  const gKeys = ["bajus_g22","bajus_g21","bajus_g18","bajus_gtr"];
  const sKeys = ["bajus_s22","bajus_s21","bajus_s18","bajus_str"];

  for (const k of gKeys) {
    if (parseFloat(g[k]) !== parseFloat(pg[k])) {
      console.log(`📊 Gold price changed: ${k} ${pg[k]} → ${g[k]}`);
      return true;
    }
  }
  for (const k of sKeys) {
    if (parseFloat(s[k]) !== parseFloat(ps[k])) {
      console.log(`📊 Silver price changed: ${k} ${ps[k]} → ${s[k]}`);
      return true;
    }
  }
  return false;
}


/** Upload image + caption to Facebook Page */
async function postToFacebook(imagePath, caption) {
  const token  = process.env.FB_PAGE_ACCESS_TOKEN;
  const pageId = process.env.FB_PAGE_ID;
  if (!token || !pageId) {
    throw new Error("❌ Missing FB_PAGE_ACCESS_TOKEN or FB_PAGE_ID env vars");
  }

  const FormData = require("form-data");
  const fetch    = require("node-fetch");

  const form = new FormData();
  form.append("source", fs.createReadStream(imagePath), {
    filename: "nfj-gold-price.png",
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

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(LATEST_JSON)) {
    console.log("⚠️  latest.json not found — skipping FB post");
    process.exit(0);
  }

  const latest = JSON.parse(fs.readFileSync(LATEST_JSON, "utf-8"));

  if (!latest.bajus_ok) {
    console.log("⚠️  bajus_ok is false — skipping FB post (no reliable Bajus data)");
    process.exit(0);
  }

  const prev = fs.existsSync(LAST_POSTED_JSON)
    ? JSON.parse(fs.readFileSync(LAST_POSTED_JSON, "utf-8"))
    : { gold: {}, silver: {} };

  if (!pricesChanged(latest, prev)) {
    console.log("✅ No Bajus price change detected — skipping FB post");
    process.exit(0);
  }

  console.log("🔔 Price change detected! Generating Facebook post...");

  const html      = renderTemplate(latest, prev);
  const imagePath = await generateImage(html);
  const caption   = buildCaption(latest, prev);

  console.log("\n📝 Caption preview:\n" + caption.slice(0, 300) + "...\n");

  await postToFacebook(imagePath, caption);

  const snapshot = {
    posted_at: new Date().toISOString(),
    gold:      latest.gold   || {},
    silver:    latest.silver || {},
  };
  fs.writeFileSync(LAST_POSTED_JSON, JSON.stringify(snapshot, null, 2), "utf-8");
  console.log(`💾 Saved snapshot to ${LAST_POSTED_JSON}`);

  if (fs.existsSync(OUTPUT_IMAGE)) fs.unlinkSync(OUTPUT_IMAGE);
}

main().catch(err => {
  console.error("❌ FB post failed:", err.message || err);
  process.exit(1);
});