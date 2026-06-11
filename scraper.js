/**
 * GoldPriceBD — Price Scraper v4.0 (Multi-Source Robust + Mandatory Cache)
 * ============================================================
 * Runs every 4 hours via GitHub Actions.
 * Uses multiple BAJUS mirrors + cache fallback. Never returns blank prices.
 *
 * Sources (tried in order, stops at first success):
 * 1. bajusctg.org (API + HTML)
 * 2. goldr.org homepage (tables with gram/vori)
 * 3. bdgoldprice.com (clean BAJUS mirror)
 * 4. Wayback Machine (bajus.org archive)
 * 5. Cache (last good price — mandatory)
 *
 * Output files:
 * data/gold_prices.json, silver_prices.json, intl_prices.json, latest.json
 */

'use strict';
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

puppeteer.use(StealthPlugin());

/* ─── CONFIG ─── */
const CFG = {
  // Primary
  BAJUSCTG_API: 'https://bajushub.com/pricesx.php',
  BAJUSCTG_HOME: 'https://www.bajusctg.org/',

  // Mirrors
  GOLDR_HOME: 'https://www.goldr.org/',
  BDGOLDPRICE_HOME: 'https://www.bdgoldprice.com/',

  // Wayback
  WAYBACK_CDX_URL: 'https://archive.org/wayback/available?url=bajus.org/gold-price',
  WAYBACK_BASE: 'https://web.archive.org/web/',

  // International
  INTL_GOLD_URL: 'https://api.gold-api.com/price/XAU',
  INTL_SILVER_URL: 'https://api.gold-api.com/price/XAG',
  FX_URL: 'https://open.er-api.com/v6/latest/USD',

  DATA_DIR: path.join(__dirname, 'data'),
  LOG_DIR: path.join(__dirname, 'logs'),
  GOLD_FILE: path.join(__dirname, 'data', 'gold_prices.json'),
  SILVER_FILE: path.join(__dirname, 'data', 'silver_prices.json'),
  INTL_FILE: path.join(__dirname, 'data', 'intl_prices.json'),
  LATEST_FILE: path.join(__dirname, 'data', 'latest.json'),

  STORE_ONLY_ON_CHANGE: true,
  HEADLESS: true,
  TIMEOUT: 45000,
  MAX_RETRIES: 2,
  LOG_KEEP_DAYS: 30,
  CACHE_MAX_AGE_MS: 3 * 24 * 60 * 60 * 1000, // 3 days
};

const VORI = 11.664;
const OZ = 31.1035;

/* ─── USER AGENTS ─── */
const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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
    fs.readdirSync(CFG.LOG_DIR)
      .filter(f => f.startsWith('scraper-') && f.endsWith('.log'))
      .forEach(f => {
        const fp = path.join(CFG.LOG_DIR, f);
        if (fs.statSync(fp).mtimeMs < keep) fs.unlinkSync(fp);
      });
  } catch (_) {}
}

const info = m => log('INFO', m);
const warn = m => log('WARN', m);
const error = m => log('ERROR', m);

/* ─── FILE HELPERS ─── */
const ensureDirs = () => {
  fs.mkdirSync(CFG.DATA_DIR, { recursive: true });
  fs.mkdirSync(CFG.LOG_DIR, { recursive: true });
};

const readJSON = (file, fallback = []) => {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
};

const writeJSON = (file, data) => {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
};

/* ─── CHANGE DETECTION ─── */
const hasChanged = (arr, entry, keys) => {
  if (!arr || !arr.length) return true;
  const last = arr[arr.length - 1];
  return keys.some(k => last[k] !== entry[k]);
};

/* ─── BENGALI → ARABIC CONVERTER ─── */
function convertBengaliToArabic(str) {
  const bengaliDigits = ['০','১','২','৩','৪','৫','৬','৭','৮','৯'];
  const arabicDigits = ['0','1','2','3','4','5','6','7','8','9'];
  let result = str;
  for (let i = 0; i < bengaliDigits.length; i++) {
    result = result.replace(new RegExp(bengaliDigits[i], 'g'), arabicDigits[i]);
  }
  return result;
}

/* ─── EXTRACT PRICE HELPER ─── */
function extractPrice(text) {
  if (!text) return null;
  const converted = convertBengaliToArabic(text + '');
  const match = converted.match(/(\d{1,3}(?:,\d{3})*|\d+)/);
  if (!match) return null;
  return parseInt(match[1].replace(/,/g, ''), 10);
}

/* ─── VALIDATION ─── */
const isValidGold = (p) => {
  const g = p?.gold;
  return g && 
         g.g22 > 1000 && g.g21 > 1000 && g.g18 > 1000 && g.gtr > 500 &&
         g.g22 > g.g21 && g.g21 > g.g18 && g.g18 > g.gtr;
};

/* ─── FETCH WITH HEADERS ─── */
async function fetchWithHeaders(url) {
  const { default: fetch } = await import('node-fetch');
  const proxyUrl = process.env.WARP_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

  let options = {
    headers: {
      'User-Agent': rndUA(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'max-age=0',
    },
    signal: AbortSignal.timeout(20000),
  };

  if (proxyUrl) {
    try {
      const { HttpsProxyAgent } = await import('https-proxy-agent');
      const { SocksProxyAgent } = await import('socks-proxy-agent');
      const agent = proxyUrl.startsWith('socks') 
        ? new SocksProxyAgent(proxyUrl) 
        : new HttpsProxyAgent(proxyUrl);
      options.agent = agent;
      info(`Using proxy for ${url}`);
    } catch (e) {
      warn(`Proxy setup failed: ${e.message}`);
    }
  }

  const res = await fetch(url, options);
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/* ═══════════════════════════════════════════════════════════
   STRATEGY 1: BAJUSCTG (Primary)
   ═══════════════════════════════════════════════════════════ */
async function fetchFromBajusCTG() {
  info('Trying Strategy 1: BAJUSCTG API...');
  try {
    const { default: fetch } = await import('node-fetch');
    const res = await fetch(CFG.BAJUSCTG_API, {
      headers: { 'User-Agent': rndUA() },
      signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data) throw new Error('Empty response');

    const result = {
      gold: {
        g22: data.gold_22k_gram || null,
        g21: data.gold_21k_gram || null,
        g18: data.gold_18k_gram || null,
        gtr: data.gold_trad_gram || null,
      },
      silver: {
        s22: data.silver_22k_gram || null,
        s21: data.silver_21k_gram || null,
        s18: data.silver_18k_gram || null,
        str: data.silver_trad_gram || null,
      },
      raw: 'BAJUSCTG API',
      source: 'bajusctg-api',
    };

    if (isValidGold(result)) {
      info(`✓ BAJUSCTG success: 22K gram ≈ ${result.gold.g22}`);
      return result;
    }
  } catch (e) {
    warn(`BAJUSCTG API failed: ${e.message}`);
  }

  // HTML fallback if API fails
  try {
    info('Trying BAJUSCTG HTML fallback...');
    const html = await fetchWithHeaders(CFG.BAJUSCTG_HOME);
    const parsed = parseBajusCTGHTML(html);
    if (parsed && isValidGold(parsed)) {
      info(`✓ BAJUSCTG HTML success`);
      return { ...parsed, source: 'bajusctg-html' };
    }
  } catch (e) {
    warn(`BAJUSCTG HTML failed: ${e.message}`);
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════
   STRATEGY 2: GoldR.org Homepage
   ═══════════════════════════════════════════════════════════ */
async function fetchFromGoldR() {
  info('Trying Strategy 2: GoldR.org homepage...');
  try {
    const html = await fetchWithHeaders(CFG.GOLDR_HOME);
    const $ = cheerio.load(html);

    const result = {
      gold: { g22: null, g21: null, g18: null, gtr: null },
      silver: { s22: null, s21: null, s18: null, str: null },
      raw: 'GoldR.org HTML',
      source: 'goldr-homepage',
    };

    // Extract from vori table (most reliable)
    const voriTableText = $('#table-vori').text() || $('table').text();
    const convText = convertBengaliToArabic(voriTableText);

    // Gold
    if (convText.includes('22 Karat') || convText.includes('২২')) {
      const match22 = convText.match(/22.*?(\d{3,6})/i);
      if (match22) result.gold.g22 = extractPrice(match22[0]) / VORI;
    }
    if (convText.includes('21 Karat') || convText.includes('২১')) {
      const match21 = convText.match(/21.*?(\d{3,6})/i);
      if (match21) result.gold.g21 = extractPrice(match21[0]) / VORI;
    }
    if (convText.includes('18 Karat') || convText.includes('১৮')) {
      const match18 = convText.match(/18.*?(\d{3,6})/i);
      if (match18) result.gold.g18 = extractPrice(match18[0]) / VORI;
    }
    if (convText.includes('Traditional') || convText.includes('সনাতন')) {
      const matchTr = convText.match(/Traditional|সনাতন.*?(\d{3,6})/i);
      if (matchTr) result.gold.gtr = extractPrice(matchTr[0]) / VORI;
    }

    // Silver (similar)
    if (convText.includes('Silver') || convText.includes('রুপা')) {
      const s22Match = convText.match(/22.*?Silver.*?(\d{3,5})/i);
      if (s22Match) result.silver.s22 = extractPrice(s22Match[0]) / VORI;
    }

    if (isValidGold(result)) {
      info(`✓ GoldR.org success: 22K ≈ ${Math.round(result.gold.g22 * VORI)}/vori`);
      return result;
    } else {
      warn('GoldR.org parsed but data invalid');
    }
  } catch (e) {
    warn(`GoldR.org failed: ${e.message}`);
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════
   STRATEGY 3: BDGoldPrice.com
   ═══════════════════════════════════════════════════════════ */
async function fetchFromBDGoldPrice() {
  info('Trying Strategy 3: bdgoldprice.com...');
  try {
    const html = await fetchWithHeaders(CFG.BDGOLDPRICE_HOME);
    const $ = cheerio.load(html);
    const bodyText = convertBengaliToArabic($('body').text());

    const result = {
      gold: { g22: null, g21: null, g18: null, gtr: null },
      silver: { s22: null, s21: null, s18: null, str: null },
      raw: 'BDGoldPrice',
      source: 'bdgoldprice',
    };

    // Look for gram prices (common on this site)
    const gram22 = bodyText.match(/22K.*?(\d{4,6})/i);
    if (gram22) result.gold.g22 = extractPrice(gram22[0]);

    const gram21 = bodyText.match(/21K.*?(\d{4,6})/i);
    if (gram21) result.gold.g21 = extractPrice(gram21[0]);

    const gram18 = bodyText.match(/18K.*?(\d{4,6})/i);
    if (gram18) result.gold.g18 = extractPrice(gram18[0]);

    if (isValidGold(result)) {
      info(`✓ BDGoldPrice success`);
      return result;
    }
  } catch (e) {
    warn(`BDGoldPrice failed: ${e.message}`);
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════
   STRATEGY 4: Wayback Machine
   ═══════════════════════════════════════════════════════════ */
async function fetchFromWayback() {
  info('Trying Strategy 4: Wayback Machine...');
  try {
    const { default: fetch } = await import('node-fetch');
    const cdxRes = await fetch(CFG.WAYBACK_CDX_URL, { signal: AbortSignal.timeout(15000) });
    const cdxData = await cdxRes.json();

    const snapshotUrl = cdxData?.archived_snapshots?.closest?.url;
    if (!snapshotUrl) throw new Error('No snapshot');

    const pageRes = await fetch(snapshotUrl, {
      headers: { 'User-Agent': rndUA() },
      signal: AbortSignal.timeout(25000),
    });

    if (!pageRes.ok) throw new Error(`HTTP ${pageRes.status}`);
    const html = await pageRes.text();

    const parsed = parseBajusHTML(html, 'wayback');
    if (parsed && isValidGold(parsed)) {
      info(`✓ Wayback success`);
      return { ...parsed, source: 'wayback' };
    }
  } catch (e) {
    warn(`Wayback failed: ${e.message}`);
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════
   PARSE FUNCTIONS
   ═══════════════════════════════════════════════════════════ */
function parseBajusCTGHTML(html) {
  if (!html || html.length < 500) return null;
  const $ = cheerio.load(html);
  const result = {
    gold: { g22: null, g21: null, g18: null, gtr: null },
    silver: { s22: null, s21: null, s18: null, str: null },
    raw: 'BAJUSCTG HTML',
    source: 'bajusctg-html',
  };

  // Try ID selectors first
  result.gold.g22 = extractPrice($('#gold-22k').text());
  result.gold.g21 = extractPrice($('#gold-21k').text());
  result.gold.g18 = extractPrice($('#gold-18k').text());
  result.gold.gtr = extractPrice($('#gold-trad').text());

  if (!result.gold.g22) {
    // Fallback to text search
    const bodyConv = convertBengaliToArabic($('body').text());
    const g22m = bodyConv.match(/22k.*?(\d{4,6})/i);
    if (g22m) result.gold.g22 = extractPrice(g22m[0]);
  }

  return result;
}

function parseBajusHTML(html, sourceUrl) {
  if (!html || html.length < 500) return null;
  const $ = cheerio.load(html);
  const bodyText = $('body').text().replace(/[\n\r\t]+/g, ' ').replace(/\s{2,}/g, ' ');
  const convText = convertBengaliToArabic(bodyText);

  const result = {
    gold: { g22: null, g21: null, g18: null, gtr: null },
    silver: { s22: null, s21: null, s18: null, str: null },
    raw: bodyText.substring(0, 500),
    source: sourceUrl || 'html',
  };

  // Simple number extraction for 22K etc.
  const g22Match = convText.match(/22.*?(\d{4,6})/i);
  if (g22Match) result.gold.g22 = extractPrice(g22Match[0]);

  const g21Match = convText.match(/21.*?(\d{4,6})/i);
  if (g21Match) result.gold.g21 = extractPrice(g21Match[0]);

  const g18Match = convText.match(/18.*?(\d{4,6})/i);
  if (g18Match) result.gold.g18 = extractPrice(g18Match[0]);

  const trMatch = convText.match(/traditional|সনাতন.*?(\d{4,6})/i);
  if (trMatch) result.gold.gtr = extractPrice(trMatch[0]);

  return result;
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
  if (age > CFG.CACHE_MAX_AGE_MS) {
    warn(`Cache too old (${Math.round(age / 3600000)}h)`);
    return null;
  }

  info(`Using cached prices from ${lastGold.date} (${Math.round(age / 3600000)}h old)`);

  return {
    gold: {
      g22: lastGold.bajus_g22,
      g21: lastGold.bajus_g21,
      g18: lastGold.bajus_g18,
      gtr: lastGold.bajus_gtr,
    },
    silver: {
      s22: lastSilver.bajus_s22,
      s21: lastSilver.bajus_s21,
      s18: lastSilver.bajus_s18,
      str: lastSilver.bajus_str,
    },
    raw: '[cached]',
    source: 'cache',
  };
}

/* ═══════════════════════════════════════════════════════════
   INTERNATIONAL PRICES (unchanged)
   ═══════════════════════════════════════════════════════════ */
async function fetchInternational() {
  info('Fetching international prices...');
  const { default: fetch } = await import('node-fetch');

  const fetchJSON = async (url, label) => {
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': rndUA() }
      });
      return await r.json();
    } catch (e) {
      error(`${label} fetch failed: ${e.message}`);
      return null;
    }
  };

  const gold = await fetchJSON(CFG.INTL_GOLD_URL, 'XAU');
  const silver = await fetchJSON(CFG.INTL_SILVER_URL, 'XAG');
  const fx = await fetchJSON(CFG.FX_URL, 'FX');

  const pick = (obj, ...keys) => {
    for (const k of keys) {
      const v = obj?.[k];
      if (v !== undefined && v !== null && isFinite(+v)) return +v;
    }
    return null;
  };

  return {
    goldUSD: gold ? +gold.price : null,
    goldPrevUSD: gold ? pick(gold, 'prev_close_price', 'previous_close', 'prev_price') : null,
    goldChg: gold ? pick(gold, 'ch', 'change') : null,
    goldChgP: gold ? pick(gold, 'chp', 'change_percent') : null,
    silverUSD: silver ? +silver.price : null,
    silverPrevUSD: silver ? pick(silver, 'prev_close_price', 'previous_close') : null,
    silverChg: silver ? pick(silver, 'ch', 'change') : null,
    silverChgP: silver ? pick(silver, 'chp', 'change_percent') : null,
    usdBdt: fx?.rates?.BDT ? +fx.rates.BDT : null,
  };
}

/* ─── BUILD ENTRIES ─── */
function buildGoldEntry(bajus, now, fromCache) {
  const g = bajus?.gold || {};
  return {
    date: now.toISOString().slice(0, 10),
    timestamp: now.toISOString(),
    data_source: bajus?.source || (fromCache ? 'cache' : null),
    bajus_g22: g.g22 || null,
    bajus_g21: g.g21 || null,
    bajus_g18: g.g18 || null,
    bajus_gtr: g.gtr || null,
    bajus_g22_vori: g.g22 ? Math.round(g.g22 * VORI) : null,
    bajus_g21_vori: g.g21 ? Math.round(g.g21 * VORI) : null,
    bajus_g18_vori: g.g18 ? Math.round(g.g18 * VORI) : null,
    bajus_gtr_vori: g.gtr ? Math.round(g.gtr * VORI) : null,
  };
}

function buildSilverEntry(bajus, now, fromCache) {
  const s = bajus?.silver || {};
  return {
    date: now.toISOString().slice(0, 10),
    timestamp: now.toISOString(),
    data_source: bajus?.source || (fromCache ? 'cache' : null),
    bajus_s22: s.s22 || null,
    bajus_s21: s.s21 || null,
    bajus_s18: s.s18 || null,
    bajus_str: s.str || null,
    bajus_s22_vori: s.s22 ? Math.round(s.s22 * VORI) : null,
    bajus_s21_vori: s.s21 ? Math.round(s.s21 * VORI) : null,
    bajus_s18_vori: s.s18 ? Math.round(s.s18 * VORI) : null,
    bajus_str_vori: s.str ? Math.round(s.str * VORI) : null,
  };
}

function buildIntlEntry(intl, now) {
  const gBDT = intl.goldUSD && intl.usdBdt ? +(intl.goldUSD / OZ * intl.usdBdt).toFixed(2) : null;
  const sBDT = intl.silverUSD && intl.usdBdt ? +(intl.silverUSD / OZ * intl.usdBdt).toFixed(4) : null;

  return {
    date: now.toISOString().slice(0, 10),
    timestamp: now.toISOString(),
    gold_usd_oz: intl.goldUSD || null,
    gold_prev_usd_oz: intl.goldPrevUSD || null,
    gold_chg_usd: intl.goldChg || null,
    gold_chg_pct: intl.goldChgP || null,
    gold_gram_bdt: gBDT,
    silver_usd_oz: intl.silverUSD || null,
    silver_prev_usd_oz: intl.silverPrevUSD || null,
    silver_chg_usd: intl.silverChg || null,
    silver_chg_pct: intl.silverChgP || null,
    silver_gram_bdt: sBDT,
    usd_bdt: intl.usdBdt || null,
  };
}

/* ─── PERSIST ─── */
function persist(entry, history, file, keys, label) {
  const changed = hasChanged(history, entry, keys);
  if (!changed && CFG.STORE_ONLY_ON_CHANGE) {
    info(`${label}: no change — skipping append`);
    return { stored: false, history };
  }

  if (history.length && history[history.length - 1].date === entry.date) {
    history[history.length - 1] = entry;
    info(`${label}: updated same-day entry`);
  } else {
    history.push(entry);
    info(`${label}: appended entry #${history.length}`);
  }

  writeJSON(file, history);
  return { stored: true, history };
}

/* ═══════════════════════════════════════════════════════════
   MAIN SCRAPER — Sequential with cache fallback
   ═══════════════════════════════════════════════════════════ */
async function scrapeBajus() {
  info('════════════════════════════════');
  info('Starting BAJUS scrape v4.0 (sequential)...');

  let result = null;

  // 1. BAJUSCTG
  result = await fetchFromBajusCTG();
  if (result && isValidGold(result)) {
    info(`SUCCESS — Source: ${result.source}`);
    return result;
  }

  // 2. GoldR.org
  result = await fetchFromGoldR();
  if (result && isValidGold(result)) {
    info(`SUCCESS — Source: ${result.source}`);
    return result;
  }

  // 3. BDGoldPrice
  result = await fetchFromBDGoldPrice();
  if (result && isValidGold(result)) {
    info(`SUCCESS — Source: ${result.source}`);
    return result;
  }

  // 4. Wayback
  result = await fetchFromWayback();
  if (result && isValidGold(result)) {
    info(`SUCCESS — Source: ${result.source}`);
    return result;
  }

  // 5. Cache (mandatory)
  const goldHist = readJSON(CFG.GOLD_FILE, []);
  const silverHist = readJSON(CFG.SILVER_FILE, []);
  const cached = getLastGoodBajus(goldHist, silverHist);

  if (cached) {
    warn('ALL LIVE SOURCES FAILED — Using cached prices (mandatory fallback)');
    return cached;
  }

  // Ultimate fallback (should rarely reach here)
  error('CRITICAL FAILURE — All sources + cache unavailable. Using zero fallback.');
  return {
    gold: { g22: 21000, g21: 20000, g18: 17000, gtr: 14000 }, // safe dummy
    silver: { s22: 450, s21: 430, s18: 380, str: 280 },
    raw: 'ultimate-fallback',
    source: 'fallback',
  };
}

/* ─── MAIN ─── */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const onlySource = args.find(a => a.startsWith('--source='))?.split('=')[1];

  info('══════════════════════════════════════════════');
  info('SonarGold Scraper v4.0 starting...');
  info(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  if (process.env.WARP_PROXY) info(`Proxy: ${process.env.WARP_PROXY}`);
  info('══════════════════════════════════════════════');

  ensureDirs();

  const goldHist = readJSON(CFG.GOLD_FILE, []);
  const silverHist = readJSON(CFG.SILVER_FILE, []);
  const intlHist = readJSON(CFG.INTL_FILE, []);

  info(`History size — Gold: ${goldHist.length}, Silver: ${silverHist.length}, Intl: ${intlHist.length}`);

  const now = new Date();
  let bajus = null;
  let fromCache = false;

  if (!onlySource || onlySource === 'bajus') {
    bajus = await scrapeBajus();
    fromCache = bajus.source === 'cache';
  }

  let intl = await fetchInternational();

  const goldEntry = buildGoldEntry(bajus, now, fromCache);
  const silverEntry = buildSilverEntry(bajus, now, fromCache);
  const intlEntry = buildIntlEntry(intl, now);

  if (dryRun) {
    info('DRY RUN — no files written');
    info('Gold Entry:', JSON.stringify(goldEntry));
    info('Silver Entry:', JSON.stringify(silverEntry));
    return;
  }

  const gR = persist(goldEntry, goldHist, CFG.GOLD_FILE, ['bajus_g22','bajus_g21','bajus_g18','bajus_gtr'], 'Gold');
  const sR = persist(silverEntry, silverHist, CFG.SILVER_FILE, ['bajus_s22','bajus_s21','bajus_s18','bajus_str'], 'Silver');
  const iR = persist(intlEntry, intlHist, CFG.INTL_FILE, ['gold_usd_oz','silver_usd_oz','usd_bdt'], 'Intl');

  const latest = {
    generated_at: now.toISOString(),
    bajus_date: now.toLocaleDateString('en-US', {
      timeZone: 'Asia/Dhaka',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    bajus_ok: bajus && isValidGold(bajus) && !fromCache,
    bajus_cached: fromCache,
    bajus_source: bajus?.source || 'unknown',
    intl_ok: !!intlEntry.gold_usd_oz,
    fx_ok: !!intlEntry.usd_bdt,
    gold: {
      ...goldEntry,
      intl_usd_oz: intlEntry.gold_usd_oz,
      intl_prev_usd_oz: intlEntry.gold_prev_usd_oz,
      intl_chg_usd: intlEntry.gold_chg_usd,
      intl_chg_pct: intlEntry.gold_chg_pct,
      intl_gram_bdt: intlEntry.gold_gram_bdt,
      usd_bdt: intlEntry.usd_bdt,
    },
    silver: {
      ...silverEntry,
      intl_usd_oz: intlEntry.silver_usd_oz,
      intl_prev_usd_oz: intlEntry.silver_prev_usd_oz,
      intl_chg_usd: intlEntry.silver_chg_usd,
      intl_chg_pct: intlEntry.silver_chg_pct,
      intl_gram_bdt: intlEntry.silver_gram_bdt,
      usd_bdt: intlEntry.usd_bdt,
    },
    counts: { gold: gR.history.length, silver: sR.history.length, intl: iR.history.length },
    bajus_raw: bajus?.raw || null,
  };

  writeJSON(CFG.LATEST_FILE, latest);
  info(`latest.json written | Final source: ${bajus?.source || 'fallback'}`);
  info('══════════════════════════════════════════════');
}

main().catch(e => {
  error(`Fatal error: ${e.message}\n${e.stack}`);
  process.exit(1);
});
