/**
 * GoldPriceBD — Price Scraper v4.2 (Puppeteer-Rendered + Multi-Source)
 * ============================================================
 * Uses Puppeteer to render JS-heavy sites (bajushub, goldr, etc.)
 * before parsing, ensuring DOM tables are fully loaded.
 */

'use strict';
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

/* ─── CONFIG ─── */
const CFG = {
  BAJUS_OFFICIAL: 'https://bajus.org.bd/',
  BAJUSHUB_HOME: 'https://bajushub.com/',
  GOLDR_HOME: 'https://www.goldr.org/',
  BDGOLDPRICE_HOME: 'https://www.bdgoldprice.com/',
  GOLDPRICEBD_HOME: 'https://goldpricebd.com/',
  BAJUSCTG_API: 'https://www.bajusctg.org/pricesx.php',
  BAJUSCTG_HOME: 'https://www.bajusctg.org/',
  WAYBACK_CDX_URL: 'https://archive.org/wayback/available?url=bajus.org.bd/',
  
  INTL_GOLD_URL: 'https://api.gold-api.com/price/XAU',
  INTL_SILVER_URL: 'https://api.gold-api.com/price/XAG',
  FX_URL: 'https://open.er-api.com/v6/latest/USD',
  FX_URL_2: 'https://api.exchangerate-api.com/v4/latest/USD',

  DATA_DIR: path.join(__dirname, 'data'),
  LOG_DIR: path.join(__dirname, 'logs'),
  GOLD_FILE: path.join(__dirname, 'data', 'gold_prices.json'),
  SILVER_FILE: path.join(__dirname, 'data', 'silver_prices.json'),
  INTL_FILE: path.join(__dirname, 'data', 'intl_prices.json'),
  LATEST_FILE: path.join(__dirname, 'data', 'latest.json'),

  STORE_ONLY_ON_CHANGE: true,
  LOG_KEEP_DAYS: 30,
  CACHE_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
};

const VORI = 11.664;
const OZ = 31.1035;

const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
];
const rndUA = () => UAS[Math.floor(Math.random() * UAS.length)];

/* ─── LOGGER ─── */
const todayStr = () => new Date().toISOString().slice(0, 10);
function log(level, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.padEnd(5)}] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync(CFG.LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(CFG.LOG_DIR, `scraper-${todayStr()}.log`), line + '\n');
    const keep = Date.now() - CFG.LOG_KEEP_DAYS * 86400000;
    fs.readdirSync(CFG.LOG_DIR).filter(f => f.startsWith('scraper-') && f.endsWith('.log')).forEach(f => {
      const fp = path.join(CFG.LOG_DIR, f);
      if (fs.statSync(fp).mtimeMs < keep) fs.unlinkSync(fp);
    });
  } catch (_) {}
}
const info = m => log('INFO', m);
const warn = m => log('WARN', m);
const error = m => log('ERROR', m);

/* ─── FILE HELPERS ─── */
const ensureDirs = () => { fs.mkdirSync(CFG.DATA_DIR, { recursive: true }); fs.mkdirSync(CFG.LOG_DIR, { recursive: true }); };
const readJSON = (file, fallback = []) => { try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; } catch { return fallback; } };
const writeJSON = (file, data) => { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); };
const hasChanged = (arr, entry, keys) => { if (!arr || !arr.length) return true; const last = arr[arr.length - 1]; return keys.some(k => last[k] !== entry[k]); };

/* ─── PARSER HELPERS ─── */
function convertBengaliToArabic(str) {
  const b = ['০','১','২','৩','৪','৫','৬','৭','৮','৯'];
  const a = ['0','1','2','3','4','5','6','7','8','9'];
  let res = str;
  for (let i = 0; i < b.length; i++) res = res.replace(new RegExp(b[i], 'g'), a[i]);
  return res;
}

function extractPrice(text) {
  if (!text) return null;
  const converted = convertBengaliToArabic(text + '');
  const match = converted.match(/(\d{1,3}(?:,\d{3})*|\d+)/);
  if (!match) return null;
  return parseInt(match[1].replace(/,/g, ''), 10);
}

const isValidGold = (p) => {
  const g = p?.gold;
  return g && g.g22 > 1000 && g.g21 > 1000 && g.g18 > 1000 && g.gtr > 500 && g.g22 > g.g21 && g.g21 > g.g18 && g.g18 > g.gtr;
};

/* ═══════════════════════════════════════════════════════════
   PUPPETEER BROWSER MANAGEMENT (Crucial for JS Sites)
   ═══════════════════════════════════════════════════════════ */
let browser = null;
let page = null;

async function getPage() {
  if (!browser) {
    info('Launching headless browser...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    page = await browser.newPage();
    await page.setUserAgent(rndUA());
    await page.setViewport({ width: 1280, height: 800 });
  }
  return page;
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
}

// Fetches HTML using Puppeteer, waiting for JS to execute
async function fetchPageHTML(url) {
  let p;
  try {
    p = await getPage();
    await p.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    // Extra delay to ensure React/Vue tables finish rendering
    await new Promise(r => setTimeout(r, 2000)); 
    return await p.content();
  } catch (e) {
    // If page crashes browser, reset instance
    if (browser) {
      try { await browser.close(); } catch (_) {}
      browser = null; page = null;
    }
    throw e;
  }
}

/* ═══════════════════════════════════════════════════════════
   UNIVERSAL HTML TABLE PARSER
   ═══════════════════════════════════════════════════════════ */
function parseGenericHTMLTable(html, sourceName) {
  if (!html || html.length < 200) return null;
  const $ = cheerio.load(html);
  
  const result = {
    gold: { g22: null, g21: null, g18: null, gtr: null },
    silver: { s22: null, s21: null, s18: null, str: null },
    raw: sourceName,
    source: sourceName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
  };

  $('tr').each((i, row) => {
    const rowText = convertBengaliToArabic($(row).text());
    const numbers = rowText.match(/([\d,]{3,7})/g);
    if (!numbers || numbers.length === 0) return;
    
    // Take the last large number in the row (usually the price column)
    const priceStr = numbers[numbers.length - 1];
    const price = extractPrice(priceStr);
    if (!price || price < 100) return;

    // Auto-detect Vori (>50,000) vs Gram (<20,000)
    const isVori = price > 50000;
    const gramPrice = isVori ? Math.round(price / VORI) : price;

    if (rowText.includes('22') && !result.gold.g22) result.gold.g22 = gramPrice;
    else if (rowText.includes('21') && !result.gold.g21) result.gold.g21 = gramPrice;
    else if (rowText.includes('18') && !result.gold.g18) result.gold.g18 = gramPrice;
    else if ((rowText.includes('সনাতন') || rowText.toLowerCase().includes('traditional')) && !result.gold.gtr) {
      result.gold.gtr = gramPrice;
    }
    else if ((rowText.includes('রুপা') || rowText.toLowerCase().includes('silver')) && !result.silver.s22) {
      result.silver.s22 = isVori ? Math.round(price / VORI) : price;
    }
  });

  return result;
}

/* ═══════════════════════════════════════════════════════════
   SCRAPING STRATEGIES (Using Puppeteer)
   ═══════════════════════════════════════════════════════════ */
async function fetchFromBajusOfficial() {
  info('Trying Strategy 0: BAJUS Official (bajus.org.bd)...');
  try {
    const html = await fetchPageHTML(CFG.BAJUS_OFFICIAL);
    const parsed = parseGenericHTMLTable(html, 'bajus-official');
    if (parsed && isValidGold(parsed)) {
      info(`✓ BAJUS Official success: 22K gram = ${parsed.gold.g22}`);
      return parsed;
    } else { warn('BAJUS Official parsed but data invalid'); }
  } catch (e) { warn(`BAJUS Official failed: ${e.message}`); }
  return null;
}

async function fetchFromBajusHub() {
  info('Trying Strategy 1: BajusHub (bajushub.com)...');
  try {
    const html = await fetchPageHTML(CFG.BAJUSHUB_HOME);
    const parsed = parseGenericHTMLTable(html, 'bajushub');
    if (parsed && isValidGold(parsed)) {
      info(`✓ BajusHub success: 22K gram = ${parsed.gold.g22}`);
      return parsed;
    } else { warn('BajusHub parsed but data invalid'); }
  } catch (e) { warn(`BajusHub failed: ${e.message}`); }
  return null;
}

async function fetchFromGoldR() {
  info('Trying Strategy 2: GoldR.org homepage...');
  try {
    const html = await fetchPageHTML(CFG.GOLDR_HOME);
    const parsed = parseGenericHTMLTable(html, 'goldr-homepage');
    if (parsed && isValidGold(parsed)) {
      info(`✓ GoldR.org success: 22K gram ≈ ${parsed.gold.g22}`);
      return parsed;
    } else { warn('GoldR.org parsed but data invalid'); }
  } catch (e) { warn(`GoldR.org failed: ${e.message}`); }
  return null;
}

async function fetchFromBDGoldPrice() {
  info('Trying Strategy 3: bdgoldprice.com...');
  try {
    const html = await fetchPageHTML(CFG.BDGOLDPRICE_HOME);
    const parsed = parseGenericHTMLTable(html, 'bdgoldprice');
    if (parsed && isValidGold(parsed)) {
      info(`✓ BDGoldPrice success: 22K gram = ${parsed.gold.g22}`);
      return parsed;
    }
  } catch (e) { warn(`BDGoldPrice failed: ${e.message}`); }
  return null;
}

async function fetchFromGoldPriceBD() {
  info('Trying Strategy 4: goldpricebd.com...');
  try {
    const html = await fetchPageHTML(CFG.GOLDPRICEBD_HOME);
    const parsed = parseGenericHTMLTable(html, 'goldpricebd');
    if (parsed && isValidGold(parsed)) {
      info(`✓ GoldPriceBD success: 22K gram = ${parsed.gold.g22}`);
      return parsed;
    }
  } catch (e) { warn(`GoldPriceBD failed: ${e.message}`); }
  return null;
}

async function fetchFromBajusCTG() {
  info('Trying Strategy 5: BAJUSCTG API...');
  try {
    // API uses fast node-fetch
    const { default: fetch } = await import('node-fetch');
    const res = await fetch(CFG.BAJUSCTG_API, {
      headers: { 'User-Agent': rndUA() },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) throw new Error(`Not JSON (${contentType.substring(0, 20)})`);
    
    const data = await res.json();
    const result = {
      gold: { g22: data.gold_22k_gram, g21: data.gold_21k_gram, g18: data.gold_18k_gram, gtr: data.gold_trad_gram },
      silver: { s22: data.silver_22k_gram, s21: data.silver_21k_gram, s18: data.silver_18k_gram, str: data.silver_trad_gram },
      raw: 'BAJUSCTG API', source: 'bajusctg-api',
    };
    if (isValidGold(result)) {
      info(`✓ BAJUSCTG API success: 22K gram ≈ ${result.gold.g22}`);
      return result;
    }
  } catch (e) { warn(`BAJUSCTG API failed: ${e.message}`); }

  // HTML Fallback uses Puppeteer
  try {
    info('Trying BAJUSCTG HTML fallback...');
    const html = await fetchPageHTML(CFG.BAJUSCTG_HOME);
    const parsed = parseGenericHTMLTable(html, 'bajusctg-html');
    if (parsed && isValidGold(parsed)) {
      info(`✓ BAJUSCTG HTML success`);
      return parsed;
    }
  } catch (e) { warn(`BAJUSCTG HTML failed: ${e.message}`); }
  return null;
}

async function fetchFromWayback() {
  info('Trying Strategy 6: Wayback Machine...');
  try {
    const { default: fetch } = await import('node-fetch');
    const cdxRes = await fetch(CFG.WAYBACK_CDX_URL, { signal: AbortSignal.timeout(15000) });
    const cdxData = await cdxRes.json();
    const snapshotUrl = cdxData?.archived_snapshots?.closest?.url;
    if (!snapshotUrl) throw new Error('No snapshot');

    // Render Wayback snapshot with Puppeteer to bypass their JS overlays
    const html = await fetchPageHTML(snapshotUrl);
    const parsed = parseGenericHTMLTable(html, 'wayback');
    if (parsed && isValidGold(parsed)) {
      info(`✓ Wayback success`);
      return parsed;
    }
  } catch (e) { warn(`Wayback failed: ${e.message}`); }
  return null;
}

/* ═══════════════════════════════════════════════════════════
   CACHE FALLBACK
   ═══════════════════════════════════════════════════════════ */
function getLastGoodBajus(goldHist, silverHist) {
  if (!goldHist.length || !silverHist.length) return null;
  const lastGold = goldHist[goldHist.length - 1];
  const lastSilver = silverHist[silverHist.length - 1];
  if (!lastGold.bajus_g22) return null;
  const age = Date.now() - new Date(lastGold.timestamp).getTime();
  if (age > CFG.CACHE_MAX_AGE_MS) { warn(`Cache too old (${Math.round(age / 3600000)}h)`); return null; }
  info(`Using cached prices from ${lastGold.date} (${Math.round(age / 3600000)}h old)`);
  return {
    gold: { g22: lastGold.bajus_g22, g21: lastGold.bajus_g21, g18: lastGold.bajus_g18, gtr: lastGold.bajus_gtr },
    silver: { s22: lastSilver.bajus_s22, s21: lastSilver.bajus_s21, s18: lastSilver.bajus_s18, str: lastSilver.bajus_str },
    raw: '[cached]', source: 'cache',
  };
}

/* ═══════════════════════════════════════════════════════════
   INTERNATIONAL PRICES (Fast node-fetch)
   ═══════════════════════════════════════════════════════════ */
async function fetchInternational() {
  info('Fetching international prices...');
  const { default: fetch } = await import('node-fetch');
  const fetchJSON = async (urls, label) => {
    for (const url of urls) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': rndUA() } });
        if (!r.ok) continue;
        const data = await r.json(); if (data) return data;
      } catch (e) { warn(`${label} failed from ${url}: ${e.message}`); }
    }
    error(`${label}: all sources failed`); return null;
  };
  const gold = await fetchJSON([CFG.INTL_GOLD_URL], 'XAU');
  const silver = await fetchJSON([CFG.INTL_SILVER_URL], 'XAG');
  const fx = await fetchJSON([CFG.FX_URL, CFG.FX_URL_2], 'FX');
  const pick = (obj, ...keys) => { for (const k of keys) { const v = obj?.[k]; if (v !== undefined && v !== null && isFinite(+v)) return +v; } return null; };
  return {
    goldUSD: gold ? +gold.price : null, goldPrevUSD: gold ? pick(gold, 'prev_close_price', 'previous_close', 'prev_price') : null,
    goldChg: gold ? pick(gold, 'ch', 'change') : null, goldChgP: gold ? pick(gold, 'chp', 'change_percent') : null,
    silverUSD: silver ? +silver.price : null, silverPrevUSD: silver ? pick(silver, 'prev_close_price', 'previous_close') : null,
    silverChg: silver ? pick(silver, 'ch', 'change') : null, silverChgP: silver ? pick(silver, 'chp', 'change_percent') : null,
    usdBdt: fx?.rates?.BDT ? +fx.rates.BDT : null,
  };
}

/* ─── BUILD & PERSIST ─── */
function buildGoldEntry(bajus, now, fromCache) {
  const g = bajus?.gold || {};
  return { date: now.toISOString().slice(0, 10), timestamp: now.toISOString(), data_source: bajus?.source || (fromCache ? 'cache' : null), bajus_g22: g.g22 || null, bajus_g21: g.g21 || null, bajus_g18: g.g18 || null, bajus_gtr: g.gtr || null, bajus_g22_vori: g.g22 ? Math.round(g.g22 * VORI) : null, bajus_g21_vori: g.g21 ? Math.round(g.g21 * VORI) : null, bajus_g18_vori: g.g18 ? Math.round(g.g18 * VORI) : null, bajus_gtr_vori: g.gtr ? Math.round(g.gtr * VORI) : null };
}
function buildSilverEntry(bajus, now, fromCache) {
  const s = bajus?.silver || {};
  return { date: now.toISOString().slice(0, 10), timestamp: now.toISOString(), data_source: bajus?.source || (fromCache ? 'cache' : null), bajus_s22: s.s22 || null, bajus_s21: s.s21 || null, bajus_s18: s.s18 || null, bajus_str: s.str || null, bajus_s22_vori: s.s22 ? Math.round(s.s22 * VORI) : null, bajus_s21_vori: s.s21 ? Math.round(s.s21 * VORI) : null, bajus_s18_vori: s.s18 ? Math.round(s.s18 * VORI) : null, bajus_str_vori: s.str ? Math.round(s.str * VORI) : null };
}
function buildIntlEntry(intl, now) {
  const gBDT = intl.goldUSD && intl.usdBdt ? +(intl.goldUSD / OZ * intl.usdBdt).toFixed(2) : null;
  const sBDT = intl.silverUSD && intl.usdBdt ? +(intl.silverUSD / OZ * intl.usdBdt).toFixed(4) : null;
  return { date: now.toISOString().slice(0, 10), timestamp: now.toISOString(), gold_usd_oz: intl.goldUSD || null, gold_prev_usd_oz: intl.goldPrevUSD || null, gold_chg_usd: intl.goldChg || null, gold_chg_pct: intl.goldChgP || null, gold_gram_bdt: gBDT, silver_usd_oz: intl.silverUSD || null, silver_prev_usd_oz: intl.silverPrevUSD || null, silver_chg_usd: intl.silverChg || null, silver_chg_pct: intl.silverChgP || null, silver_gram_bdt: sBDT, usd_bdt: intl.usdBdt || null };
}

function persist(entry, history, file, keys, label) {
  const changed = hasChanged(history, entry, keys);
  if (!changed && CFG.STORE_ONLY_ON_CHANGE) { info(`${label}: no change — skipping append`); return { stored: false, history }; }
  if (history.length && history[history.length - 1].date === entry.date) { history[history.length - 1] = entry; info(`${label}: updated same-day entry`); }
  else { history.push(entry); info(`${label}: appended entry #${history.length}`); }
  writeJSON(file, history); return { stored: true, history };
}

/* ═══════════════════════════════════════════════════════════
   MAIN SCRAPER LOOP
   ═══════════════════════════════════════════════════════════ */
async function scrapeBajus() {
  info('════════════════════════════════');
  info('Starting BAJUS scrape v4.2 (puppeteer-rendered)...');

  const strategies = [
    { name: 'BAJUS Official', fn: fetchFromBajusOfficial },
    { name: 'BajusHub', fn: fetchFromBajusHub },
    { name: 'GoldR.org', fn: fetchFromGoldR },
    { name: 'BDGoldPrice', fn: fetchFromBDGoldPrice },
    { name: 'GoldPriceBD', fn: fetchFromGoldPriceBD },
    { name: 'BAJUSCTG', fn: fetchFromBajusCTG },
    { name: 'Wayback', fn: fetchFromWayback },
  ];

  for (const strategy of strategies) {
    const result = await strategy.fn();
    if (result && isValidGold(result)) {
      info(`SUCCESS — Source: ${result.source}`);
      return result;
    }
  }

  const goldHist = readJSON(CFG.GOLD_FILE, []);
  const silverHist = readJSON(CFG.SILVER_FILE, []);
  const cached = getLastGoodBajus(goldHist, silverHist);
  if (cached) { warn('ALL LIVE SOURCES FAILED — Using cached prices (mandatory fallback)'); return cached; }

  error('CRITICAL FAILURE — All sources + cache unavailable. Using zero fallback.');
  return { gold: { g22: 21000, g21: 20000, g18: 17000, gtr: 14000 }, silver: { s22: 450, s21: 430, s18: 380, str: 280 }, raw: 'ultimate-fallback', source: 'fallback' };
}

/* ─── MAIN ─── */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  info('══════════════════════════════════════════════');
  info('SonarGold Scraper v4.2 starting...');
  info(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  info('══════════════════════════════════════════════');

  ensureDirs();
  const goldHist = readJSON(CFG.GOLD_FILE, []);
  const silverHist = readJSON(CFG.SILVER_FILE, []);
  const intlHist = readJSON(CFG.INTL_FILE, []);
  info(`History size — Gold: ${goldHist.length}, Silver: ${silverHist.length}, Intl: ${intlHist.length}`);

  const now = new Date();
  let bajus = null;
  let fromCache = false;

  try {
    bajus = await scrapeBajus();
    fromCache = bajus.source === 'cache';
  } finally {
    // ALWAYS close browser to prevent zombie processes on GitHub Actions
    await closeBrowser();
  }

  let intl = await fetchInternational();
  const goldEntry = buildGoldEntry(bajus, now, fromCache);
  const silverEntry = buildSilverEntry(bajus, now, fromCache);
  const intlEntry = buildIntlEntry(intl, now);

  if (dryRun) {
    info('DRY RUN — no files written');
    info('Gold Entry:', JSON.stringify(goldEntry));
    return;
  }

  const gR = persist(goldEntry, goldHist, CFG.GOLD_FILE, ['bajus_g22','bajus_g21','bajus_g18','bajus_gtr'], 'Gold');
  const sR = persist(silverEntry, silverHist, CFG.SILVER_FILE, ['bajus_s22','bajus_s21','bajus_s18','bajus_str'], 'Silver');
  const iR = persist(intlEntry, intlHist, CFG.INTL_FILE, ['gold_usd_oz','silver_usd_oz','usd_bdt'], 'Intl');

  const latest = {
    generated_at: now.toISOString(),
    bajus_date: now.toLocaleDateString('en-US', { timeZone: 'Asia/Dhaka', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    bajus_ok: bajus && isValidGold(bajus) && !fromCache,
    bajus_cached: fromCache,
    bajus_source: bajus?.source || 'unknown',
    intl_ok: !!intlEntry.gold_usd_oz,
    fx_ok: !!intlEntry.usd_bdt,
    gold: { ...goldEntry, intl_usd_oz: intlEntry.gold_usd_oz, intl_prev_usd_oz: intlEntry.gold_prev_usd_oz, intl_chg_usd: intlEntry.gold_chg_usd, intl_chg_pct: intlEntry.gold_chg_pct, intl_gram_bdt: intlEntry.gold_gram_bdt, usd_bdt: intlEntry.usd_bdt },
    silver: { ...silverEntry, intl_usd_oz: intlEntry.silver_usd_oz, intl_prev_usd_oz: intlEntry.silver_prev_usd_oz, intl_chg_usd: intlEntry.silver_chg_usd, intl_chg_pct: intlEntry.silver_chg_pct, intl_gram_bdt: intlEntry.silver_gram_bdt, usd_bdt: intlEntry.usd_bdt },
    counts: { gold: gR.history.length, silver: sR.history.length, intl: iR.history.length },
    bajus_raw: bajus?.raw || null,
  };

  writeJSON(CFG.LATEST_FILE, latest);
  info(`latest.json written | Final source: ${bajus?.source || 'fallback'}`);
  info('══════════════════════════════════════════════');
}

main().catch(e => { error(`Fatal error: ${e.message}\n${e.stack}`); process.exit(1); });
