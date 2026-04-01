/**
 * SonarGold BD — Price Scraper v3.1 (Enhanced with BAJUS-CTG Fallback)
 * ============================================================
 * Runs every 4 hours via GitHub Actions.
 * Scrapes BAJUS (bajus.org) for BD gold/silver prices.
 * Falls back to bajusctg.org if main site is blocked.
 * Fetches international XAU/XAG spot + USD/BDT from free APIs.
 *
 * KEY FIXES IN v3.1:
 *   1. Added bajusctg.org as a fallback source
 *   2. Uses Cloudflare WARP proxy (residential IP) when WARP_PROXY env is set
 *   3. Tries multiple scraping strategies: direct fetch → curl-impersonate → puppeteer
 *   4. Falls back to Wayback Machine (web.archive.org) snapshot if live site is blocked
 *   5. Caches last successful BAJUS prices and reuses them if scraping fails today
 *   6. Stale-price guard: won't reuse cached prices older than 3 days
 *
 * THREE separate output files:
 *   data/gold_prices.json   — BAJUS gold history (BD only, per-gram BDT)
 *   data/silver_prices.json — BAJUS silver history (BD only, per-gram BDT)
 *   data/intl_prices.json   — International XAU/XAG/FX history
 *   data/latest.json        — Combined snapshot for the website
 *   logs/scraper-YYYY-MM-DD.log — Daily rolling log
 *
 * Run:  node scraper.js
 * Test: node scraper.js --dry-run
 * Proxy: WARP_PROXY=socks5://127.0.0.1:40000 node scraper.js
 */
'use strict';

const puppeteer     = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio       = require('cheerio');
const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');
puppeteer.use(StealthPlugin());

/* ─── CONFIG ─── */
const CFG = {
  BAJUS_URLS: [
    'https://bajus.org/gold-price',
    'https://www.bajus.org/gold-price',
    'https://bajus.org/index.php?action=goldprice',
  ],
  // Alternative BAJUS site
  BAJUSCTG_URLS: [
    'https://www.bajusctg.org/',
  ],
  // Wayback Machine CDX API + snapshot base
  WAYBACK_CDX_URL : 'https://archive.org/wayback/available?url=bajus.org/gold-price',
  WAYBACK_BASE    : 'https://web.archive.org/web/',

  INTL_GOLD_URL  : 'https://api.gold-api.com/price/XAU',
  INTL_SILVER_URL: 'https://api.gold-api.com/price/XAG',
  FX_URL         : 'https://open.er-api.com/v6/latest/USD',

  DATA_DIR    : path.join(__dirname, 'data'),
  LOG_DIR     : path.join(__dirname, 'logs'),
  GOLD_FILE   : path.join(__dirname, 'data', 'gold_prices.json'),
  SILVER_FILE : path.join(__dirname, 'data', 'silver_prices.json'),
  INTL_FILE   : path.join(__dirname, 'data', 'intl_prices.json'),
  LATEST_FILE : path.join(__dirname, 'data', 'latest.json'),

  STORE_ONLY_ON_CHANGE : true,
  HEADLESS             : true,
  TIMEOUT              : 45000,
  MAX_RETRIES          : 2,
  LOG_KEEP_DAYS        : 30,

  // Max age of cached BAJUS price to reuse (in ms). 3 days.
  CACHE_MAX_AGE_MS : 3 * 24 * 60 * 60 * 1000,
};

const VORI = 11.664;
const OZ   = 31.1035;

/* ─── USER AGENTS ─── */
const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Safari/605.1.15',
];
const rndUA = () => UAS[Math.floor(Math.random() * UAS.length)];

/* ─── LOGGER ─── */
const todayStr = () => new Date().toISOString().slice(0, 10);
function log(level, msg) {
  const ts   = new Date().toISOString();
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
const info  = m => log('INFO',  m);
const warn  = m => log('WARN',  m);
const error = m => log('ERROR', m);

/* ─── FILE HELPERS ─── */
const ensureDirs = () => {
  fs.mkdirSync(CFG.DATA_DIR, { recursive: true });
  fs.mkdirSync(CFG.LOG_DIR,  { recursive: true });
};
const readJSON  = (file, fallback = []) => {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; }
  catch { return fallback; }
};
const writeJSON = (file, data) =>
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');

/* ─── CHANGE DETECTION ─── */
const hasChanged = (arr, entry, keys) => {
  if (!arr || !arr.length) return true;
  const last = arr[arr.length - 1];
  return keys.some(k => last[k] !== entry[k]);
};

/* ─── BENGALI → ARABIC NUMERAL CONVERTER ─── */
function convertBengaliToArabic(str) {
  const bengaliDigits = ['০','১','২','৩','৪','৫','৬','৭','৮','৯'];
  const arabicDigits  = ['0','1','2','3','4','5','6','7','8','9'];
  for (let i = 0; i < bengaliDigits.length; i++) {
    str = str.replace(new RegExp(bengaliDigits[i], 'g'), arabicDigits[i]);
  }
  return str;
}

/* ═══════════════════════════════════════════════════════════
   STRATEGY 1 — Plain fetch with browser-like headers
   Works on your local PC (residential IP), fails on GitHub (datacenter IP).
   We still try it first in case the runner happens to have WARP active.
   ═══════════════════════════════════════════════════════════ */
async function fetchWithHeaders(url) {
  const { default: fetch } = await import('node-fetch');
  const proxyUrl = process.env.WARP_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

  let fetchOptions = {
    headers: {
      'User-Agent'               : rndUA(),
      'Accept'                   : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language'          : 'en-US,en;q=0.9',
      'Accept-Encoding'          : 'gzip, deflate, br',
      'DNT'                      : '1',
      'Connection'               : 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest'           : 'document',
      'Sec-Fetch-Mode'           : 'navigate',
      'Sec-Fetch-Site'           : 'none',
      'Sec-Fetch-User'           : '?1',
      'Cache-Control'            : 'max-age=0',
    },
    signal: AbortSignal.timeout(20000),
  };

  // If a SOCKS/HTTP proxy is configured, use it
  if (proxyUrl) {
    try {
      const { HttpsProxyAgent } = await import('https-proxy-agent');
      const { SocksProxyAgent } = await import('socks-proxy-agent');
      const agent = proxyUrl.startsWith('socks')
        ? new SocksProxyAgent(proxyUrl)
        : new HttpsProxyAgent(proxyUrl);
      fetchOptions.agent = agent;
      info(`Using proxy: ${proxyUrl}`);
    } catch (e) {
      warn(`Proxy agent setup failed: ${e.message}`);
    }
  }

  const res = await fetch(url, fetchOptions);
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/* ═══════════════════════════════════════════════════════════
   STRATEGY 2 — curl with --impersonate (curl-impersonate / curl ≥ 8.x)
   curl on Ubuntu 24 supports --impersonate natively since 8.3.
   This spoofs TLS/JA3 fingerprint. Install via apt if available.
   ═══════════════════════════════════════════════════════════ */
function fetchWithCurl(url) {
  try {
    const proxyArg = process.env.WARP_PROXY
      ? `--proxy ${process.env.WARP_PROXY}`
      : '';

    // Try curl with impersonate (curl ≥ 8.3 built with libngtcp2)
    // Falls back to plain curl with good headers if --impersonate unsupported
    let cmd;
    try {
      execSync('curl --impersonate chrome 2>&1 | head -1', { stdio: 'pipe' });
      cmd = `curl -sL --max-time 20 --impersonate chrome ${proxyArg} \
        -H "Accept-Language: en-US,en;q=0.9" \
        "${url}"`;
      info('curl: using --impersonate chrome');
    } catch {
      cmd = `curl -sL --max-time 20 ${proxyArg} \
        -H "User-Agent: ${rndUA()}" \
        -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
        -H "Accept-Language: en-US,en;q=0.9" \
        -H "Accept-Encoding: gzip, deflate, br" \
        -H "DNT: 1" \
        -H "Upgrade-Insecure-Requests: 1" \
        "${url}"`;
      info('curl: using plain headers');
    }

    const html = execSync(cmd, { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
    if (!html || html.length < 500) throw new Error('Empty response from curl');
    return html;
  } catch (e) {
    throw new Error(`curl failed: ${e.message}`);
  }
}

/* ═══════════════════════════════════════════════════════════
   STRATEGY 3 — Puppeteer with stealth (original approach)
   Last resort — slowest but handles JS-rendered pages.
   ═══════════════════════════════════════════════════════════ */
async function fetchWithPuppeteer(url) {
  let browser;
  try {
    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1920,1080',
    ];

    // Route Puppeteer through proxy if set
    const proxyUrl = process.env.WARP_PROXY || process.env.HTTPS_PROXY;
    if (proxyUrl) {
      launchArgs.push(`--proxy-server=${proxyUrl}`);
      info(`Puppeteer: routing through proxy ${proxyUrl}`);
    }

    browser = await puppeteer.launch({ headless: CFG.HEADLESS, args: launchArgs });
    const page = await browser.newPage();

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      window.chrome = { app: {}, runtime: {} };
    });

    await page.setUserAgent(rndUA());
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.setExtraHTTPHeaders({
      'Accept-Language'          : 'en-US,en;q=0.9',
      'Accept'                   : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'DNT'                      : '1',
      'Upgrade-Insecure-Requests': '1',
    });

    // Block heavy resources to speed up
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CFG.TIMEOUT });

    if (!response || response.status() >= 400) {
      throw new Error(`HTTP ${response?.status()}`);
    }

    await new Promise(r => setTimeout(r, 2500));
    const html = await page.content();
    await browser.close(); browser = null;
    return html;
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
  }
}

/* ═══════════════════════════════════════════════════════════
   STRATEGY 4 — BAJUSCTG alternative site
   This site has a simpler structure and might be easier to scrape.
   ═══════════════════════════════════════════════════════════ */
async function fetchFromBajusCTG() {
  info('Trying BAJUSCTG alternative site…');
  
  // Try to fetch the prices API directly
  try {
    const { default: fetch } = await import('node-fetch');
    const proxyUrl = process.env.WARP_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    
    let fetchOptions = {
      headers: {
        'User-Agent'     : rndUA(),
        'Accept'         : 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer'        : 'https://www.bajusctg.org/',
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: AbortSignal.timeout(15000),
    };

    // If a proxy is configured, use it
    if (proxyUrl) {
      try {
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        const { SocksProxyAgent } = await import('socks-proxy-agent');
        const agent = proxyUrl.startsWith('socks')
          ? new SocksProxyAgent(proxyUrl)
          : new HttpsProxyAgent(proxyUrl);
        fetchOptions.agent = agent;
      } catch (e) {
        warn(`Proxy agent setup failed: ${e.message}`);
      }
    }

    const pricesUrl = 'https://www.bajusctg.org/pricesx.php';
    const res = await fetch(pricesUrl, fetchOptions);
    
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
    const priceData = await res.json();
    
    if (!priceData) throw new Error('Empty or invalid price data');
    
    info(`BAJUSCTG API success: gold_22k=${priceData.gold_22k_gram}`);
    
    // Convert the API response to our standard format
    return {
      gold: {
        g22: priceData.gold_22k_gram,
        g21: priceData.gold_21k_gram,
        g18: priceData.gold_18k_gram,
        gtr: priceData.gold_trad_gram,
      },
      silver: {
        s22: priceData.silver_22k_gram,
        s21: priceData.silver_21k_gram,
        s18: priceData.silver_18k_gram,
        str: priceData.silver_trad_gram,
      },
      raw: 'BAJUSCTG API',
      source: 'bajusctg-api',
    };
  } catch (e) {
    warn(`BAJUSCTG API failed: ${e.message}`);
    
    // If API fails, try scraping the HTML page
    try {
      const html = await fetchWithHeaders('https://www.bajusctg.org/');
      const parsed = parseBajusCTGHTML(html);
      if (parsed && isValidGold(parsed)) {
        info(`BAJUSCTG HTML success: gold22=${parsed.gold.g22}`);
        return { ...parsed, source: 'bajusctg-html' };
      }
    } catch (e2) {
      warn(`BAJUSCTG HTML failed: ${e2.message}`);
    }
    
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════
   STRATEGY 5 — Wayback Machine fallback
   Fetches today's or yesterday's snapshot from archive.org.
   archive.org is a public service with no IP restrictions.
   ═══════════════════════════════════════════════════════════ */
async function fetchFromWayback() {
  const { default: fetch } = await import('node-fetch');
  try {
    info('Trying Wayback Machine fallback…');
    const cdxRes = await fetch(CFG.WAYBACK_CDX_URL, { signal: AbortSignal.timeout(15000) });
    const cdxData = await cdxRes.json();

    const snapshotUrl = cdxData?.archived_snapshots?.closest?.url;
    if (!snapshotUrl) throw new Error('No Wayback snapshot found');

    const ts  = cdxData.archived_snapshots.closest.timestamp;
    const age = Date.now() - new Date(
      `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)}T${ts.slice(8,10)}:${ts.slice(10,12)}:${ts.slice(12,14)}Z`
    ).getTime();

    info(`Wayback snapshot found: ${snapshotUrl} (age: ${Math.round(age / 3600000)}h)`);

    // Reject if snapshot is older than 36 hours (prices would be stale)
    if (age > 36 * 3600000) {
      warn(`Wayback snapshot too old (${Math.round(age / 3600000)}h), skipping`);
      return null;
    }

    const pageRes = await fetch(snapshotUrl, {
      headers: { 'User-Agent': rndUA() },
      signal: AbortSignal.timeout(25000),
    });
    if (pageRes.status >= 400) throw new Error(`Wayback HTTP ${pageRes.status}`);
    return await pageRes.text();
  } catch (e) {
    warn(`Wayback Machine failed: ${e.message}`);
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════
   MAIN BAJUS SCRAPER — tries all strategies in order
   ═══════════════════════════════════════════════════════════ */
async function scrapeBajus() {
  info('Starting BAJUS scrape (v3.1 — multi-strategy with BAJUSCTG fallback)…');

  // Try each live URL with each strategy
  for (const url of CFG.BAJUS_URLS) {
    // Strategy 1: plain fetch
    for (let attempt = 1; attempt <= CFG.MAX_RETRIES; attempt++) {
      try {
        info(`[fetch] Attempt ${attempt}: GET ${url}`);
        const html   = await fetchWithHeaders(url);
        const parsed = parseBajusHTML(html, url);
        if (parsed && isValidGold(parsed)) {
          info(`[fetch] ✓ gold22=${parsed.gold.g22}/g`);
          return { ...parsed, source: 'live-fetch' };
        }
        warn('[fetch] Parsed but invalid — trying next');
        break;
      } catch (e) {
        warn(`[fetch] Attempt ${attempt} failed: ${e.message}`);
        if (attempt < CFG.MAX_RETRIES) await sleep(3000);
      }
    }

    // Strategy 2: curl
    for (let attempt = 1; attempt <= CFG.MAX_RETRIES; attempt++) {
      try {
        info(`[curl] Attempt ${attempt}: GET ${url}`);
        const html   = fetchWithCurl(url);
        const parsed = parseBajusHTML(html, url);
        if (parsed && isValidGold(parsed)) {
          info(`[curl] ✓ gold22=${parsed.gold.g22}/g`);
          return { ...parsed, source: 'live-curl' };
        }
        warn('[curl] Parsed but invalid — trying next');
        break;
      } catch (e) {
        warn(`[curl] Attempt ${attempt} failed: ${e.message}`);
        if (attempt < CFG.MAX_RETRIES) await sleep(3000);
      }
    }

    // Strategy 3: Puppeteer (slowest, last resort for live)
    for (let attempt = 1; attempt <= CFG.MAX_RETRIES; attempt++) {
      try {
        info(`[puppeteer] Attempt ${attempt}: GET ${url}`);
        const html   = await fetchWithPuppeteer(url);
        const parsed = parseBajusHTML(html, url);
        if (parsed && isValidGold(parsed)) {
          info(`[puppeteer] ✓ gold22=${parsed.gold.g22}/g`);
          return { ...parsed, source: 'live-puppeteer' };
        }
        warn('[puppeteer] Parsed but invalid — trying next');
        break;
      } catch (e) {
        warn(`[puppeteer] Attempt ${attempt} failed: ${e.message}`);
        if (attempt < CFG.MAX_RETRIES) await sleep(5000);
      }
    }
  }

  // Strategy 4: BAJUSCTG alternative site
  try {
    const bajusctgResult = await fetchFromBajusCTG();
    if (bajusctgResult) {
      return bajusctgResult;
    }
  } catch (e) {
    warn(`[bajusctg] Error: ${e.message}`);
  }

  // Strategy 5: Wayback Machine
  try {
    const html = await fetchFromWayback();
    if (html) {
      const parsed = parseBajusHTML(html, 'wayback');
      if (parsed && isValidGold(parsed)) {
        info(`[wayback] ✓ gold22=${parsed.gold.g22}/g`);
        return { ...parsed, source: 'wayback' };
      }
    }
  } catch (e) {
    warn(`[wayback] Error: ${e.message}`);
  }

  error('All BAJUS strategies failed');
  return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ─── PARSE BAJUS HTML (unchanged from v2.2) ─── */
function parseBajusHTML(html, sourceUrl) {
  if (!html || html.length < 500) return null;
  const $ = cheerio.load(html);

  const bodyText = $('body').text()
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .toUpperCase();
  info(`Page text sample (${sourceUrl}): ${bodyText.substring(0, 200)}`);

  const result = {
    gold:   { g22: null, g21: null, g18: null, gtr: null },
    silver: { s22: null, s21: null, s18: null, str: null },
    raw:    bodyText.substring(0, 500),
  };

  const tickerText          = $('#tick').text() || $('[id*="tick"]').text() || $('[class*="tick"]').text();
  const convertedTickerText = convertBengaliToArabic(tickerText).toUpperCase();
  const convertedBodyText   = convertBengaliToArabic(bodyText);

  // Use body if ticker is empty
  const searchText = convertedTickerText.length > 50 ? convertedTickerText : convertedBodyText;
  info(`Ticker text (${searchText.length} chars): ${searchText.substring(0, 200)}`);

  /* STRATEGY 1: Bengali regex patterns */
  const patterns = [
    { key: 'g22', regex: /২২\s*ক্যা[:\s]*.*?স্বর্ণের মূল্য\s*[:\-\s]\s*(\d+)/i },
    { key: 'g21', regex: /২১\s*ক্যা[:\s]*.*?স্বর্ণের মূল্য\s*[:\-\s]\s*(\d+)/i },
    { key: 'g18', regex: /১৮\s*ক্যা[:\s]*.*?স্বর্ণের মূল্য\s*[:\-\s]\s*(\d+)/i },
    { key: 'gtr', regex: /সনাতন পদ্ধতি.*?স্বর্ণের মূল্য\s*[:\-\s]\s*(\d+)/i },
    { key: 's22', regex: /২২\s*ক্যা[:\s]*.*?রূপার মূল্য\s*[:\-\s]\s*(\d+)/i },
    { key: 's21', regex: /২১\s*ক্যা[:\s]*.*?রূপার মূল্য\s*[:\-\s]\s*(\d+)/i },
    { key: 's18', regex: /১৮\s*ক্যা[:\s]*.*?রূপার মূল্য\s*[:\-\s]\s*(\d+)/i },
    { key: 'str', regex: /সনাতন পদ্ধতি.*?রূপার মূল্য\s*[:\-\s]\s*(\d+)/i },
  ];

  for (const p of patterns) {
    const match = convertBengaliToArabic(tickerText).match(p.regex);
    if (match) {
      const val = parseInt(match[1].replace(/,/g, ''), 10);
      if (isFinite(val) && val > 50) {
        const target = ['g22','g21','g18','gtr'].includes(p.key) ? result.gold : result.silver;
        if (target[p.key] === null) { target[p.key] = val; info(`Found ${p.key}: ${val}`); }
      }
    }
  }

  /* STRATEGY 2: Table/DOM rows */
  $('table tr, .price-row, .gold-price, [class*="price"], [class*="gold"], [class*="silver"]').each((_, el) => {
    const rowText          = $(el).text().replace(/\s+/g, ' ');
    const convertedRowText = convertBengaliToArabic(rowText);
    const numMatch         = convertedRowText.match(/([\d,]{3,})/g);
    if (!numMatch) return;
    const nums = numMatch.map(n => parseInt(n.replace(/,/g,''), 10)).filter(n => n > 50 && n < 100000);
    if (nums.length === 0) return;
    const val       = nums[nums.length - 1];
    const isSilver  = rowText.includes('SILVER')     || rowText.includes('রূপার মূল্য');
    const isGold    = rowText.includes('GOLD')        || rowText.includes('স্বর্ণের মূল্য');
    const isTrad    = rowText.includes('TRADITIONAL') || rowText.includes('সনাতন পদ্ধতি');
    if      (rowText.includes('22') && isGold && !result.gold.g22)   result.gold.g22   = val;
    else if (rowText.includes('21') && isGold && !result.gold.g21)   result.gold.g21   = val;
    else if (rowText.includes('18') && isGold && !result.gold.g18)   result.gold.g18   = val;
    else if (isTrad && isGold && !result.gold.gtr)                    result.gold.gtr   = val;
    else if (rowText.includes('22') && isSilver && !result.silver.s22) result.silver.s22 = val;
    else if (rowText.includes('21') && isSilver && !result.silver.s21) result.silver.s21 = val;
    else if (rowText.includes('18') && isSilver && !result.silver.s18) result.silver.s18 = val;
    else if (isTrad && isSilver && !result.silver.str)                result.silver.str = val;
  });

  /* STRATEGY 3: Positional extraction from large numbers */
  if (!result.gold.g22) {
    const numBlocks  = searchText.match(/\b(\d{4,6})\b/g) || [];
    const candidates = [...new Set(numBlocks.map(Number))]
      .filter(n => n >= 1000 && n <= 60000)
      .sort((a, b) => b - a);
    if (candidates.length >= 4) {
      for (let i = 0; i <= candidates.length - 4; i++) {
        const [a, b, c, d] = candidates.slice(i, i + 4);
        if (a > b && b > c && c > d && a < 60000 && d > 1000
            && a < b * 1.25 && b < c * 1.25 && c < d * 1.6) {
          result.gold.g22 = a; result.gold.g21 = b;
          result.gold.g18 = c; result.gold.gtr = d;
          info(`Positional gold: ${a}/${b}/${c}/${d}`);
          break;
        }
      }
    }
  }

  if (!result.silver.s22) {
    const numBlocks  = searchText.match(/\b(\d{2,4})\b/g) || [];
    const candidates = [...new Set(numBlocks.map(Number))]
      .filter(n => n >= 100 && n <= 5000)
      .sort((a, b) => b - a);
    if (candidates.length >= 3) {
      for (let i = 0; i <= candidates.length - 3; i++) {
        const [a, b, c] = candidates.slice(i, i + 3);
        if (a > b && b > c && a < 5000 && c > 100 && a < b * 1.1 && b < c * 1.2) {
          result.silver.s22 = a; result.silver.s21 = b; result.silver.s18 = c;
          info(`Positional silver: ${a}/${b}/${c}`);
          break;
        }
      }
    }
  }

  /* Silver fallbacks */
  if (result.silver.s22 && !result.silver.s21) {
    result.silver.s21 = Math.round(result.silver.s22 * 0.945);
    result.silver.s18 = Math.round(result.silver.s22 * 0.808);
    result.silver.str = Math.round(result.silver.s22 * 0.615);
    warn('Silver: derived s21/s18/str proportionally');
  }

  return result;
}

/* ─── PARSE BAJUSCTG HTML ─── */
function parseBajusCTGHTML(html) {
  if (!html || html.length < 500) return null;
  const $ = cheerio.load(html);

  const bodyText = $('body').text()
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .toUpperCase();
  info(`BAJUSCTG page text sample: ${bodyText.substring(0, 200)}`);

  const result = {
    gold:   { g22: null, g21: null, g18: null, gtr: null },
    silver: { s22: null, s21: null, s18: null, str: null },
    raw:    bodyText.substring(0, 500),
  };

  // Try to extract prices from the HTML table
  try {
    const gold22k = $('#gold-22k').text();
    const gold21k = $('#gold-21k').text();
    const gold18k = $('#gold-18k').text();
    const goldTrad = $('#gold-trad').text();
    
    const silver22k = $('#silver-22k').text();
    const silver21k = $('#silver-21k').text();
    const silver18k = $('#silver-18k').text();
    const silverTrad = $('#silver-trad').text();

    // Convert Bengali numerals and extract numbers
    const extractPrice = (text) => {
      if (!text) return null;
      const converted = convertBengaliToArabic(text);
      const match = converted.match(/(\d+(?:,\d+)*)/);
      return match ? parseInt(match[1].replace(/,/g, ''), 10) : null;
    };

    result.gold.g22 = extractPrice(gold22k);
    result.gold.g21 = extractPrice(gold21k);
    result.gold.g18 = extractPrice(gold18k);
    result.gold.gtr = extractPrice(goldTrad);
    
    result.silver.s22 = extractPrice(silver22k);
    result.silver.s21 = extractPrice(silver21k);
    result.silver.s18 = extractPrice(silver18k);
    result.silver.str = extractPrice(silverTrad);

    info(`BAJUSCTG extracted: gold22=${result.gold.g22}, silver22=${result.silver.s22}`);
  } catch (e) {
    warn(`BAJUSCTG HTML parsing error: ${e.message}`);
  }

  return result;
}

const isValidGold = p => {
  const g = p?.gold;
  return g && g.g22 > 1000 && g.g21 > 1000 && g.g18 > 1000 && g.gtr > 500
    && g.g22 > g.g21 && g.g21 > g.g18 && g.g18 > g.gtr;
};

/* ─── CACHE: reuse last good BAJUS prices if scraping fails ─── */
function getLastGoodBajus(goldHist, silverHist) {
  if (!goldHist.length || !silverHist.length) return null;

  const lastGold   = goldHist[goldHist.length - 1];
  const lastSilver = silverHist[silverHist.length - 1];

  if (!lastGold.bajus_g22) return null; // last entry was also a failure

  const age = Date.now() - new Date(lastGold.timestamp).getTime();
  if (age > CFG.CACHE_MAX_AGE_MS) {
    warn(`Last cached BAJUS price is ${Math.round(age / 3600000)}h old — too stale to reuse`);
    return null;
  }

  info(`Reusing cached BAJUS prices from ${lastGold.timestamp} (${Math.round(age / 3600000)}h ago)`);
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
    raw:    '[cached from ' + lastGold.date + ']',
    source: 'cache',
  };
}

/* ─── FETCH INTERNATIONAL PRICES ─── */
async function fetchInternational() {
  info('Fetching international prices…');
  const { default: fetch } = await import('node-fetch');

  let gold = null, silver = null, fx = null;

  const fetchJSON = async (url, label) => {
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': rndUA(), 'Accept': 'application/json' },
      });
      return await r.json();
    } catch (e) {
      error(`${label} fetch: ${e.message}`);
      return null;
    }
  };

  gold   = await fetchJSON(CFG.INTL_GOLD_URL,   'XAU');
  silver = await fetchJSON(CFG.INTL_SILVER_URL,  'XAG');
  fx     = await fetchJSON(CFG.FX_URL,           'FX');

  if (gold)   info(`XAU: $${gold.price}/oz`);
  if (silver) info(`XAG: $${silver.price}/oz`);
  if (fx)     info(`USD/BDT: ${fx?.rates?.BDT}`);

  const pick = (obj, ...keys) => {
    for (const k of keys) {
      const v = obj?.[k];
      if (v !== undefined && v !== null && isFinite(+v)) return +v;
    }
    return null;
  };

  return {
    goldUSD      : gold   ? +gold.price   : null,
    goldPrevUSD  : gold   ? pick(gold,   'prev_close_price','previous_close','prev_price') : null,
    goldChg      : gold   ? pick(gold,   'ch','change','price_change') : null,
    goldChgP     : gold   ? pick(gold,   'chp','change_percent','percent_change') : null,
    silverUSD    : silver ? +silver.price : null,
    silverPrevUSD: silver ? pick(silver, 'prev_close_price','previous_close','prev_price') : null,
    silverChg    : silver ? pick(silver, 'ch','change','price_change') : null,
    silverChgP   : silver ? pick(silver, 'chp','change_percent','percent_change') : null,
    usdBdt       : fx?.rates?.BDT ? +fx.rates.BDT : null,
  };
}

/* ─── BUILD DATA ENTRIES ─── */
function buildGoldEntry(bajus, now, fromCache) {
  const g = bajus?.gold || {};
  return {
    date          : now.toISOString().slice(0, 10),
    timestamp     : now.toISOString(),
    data_source   : bajus?.source || (fromCache ? 'cache' : null),
    bajus_g22     : g.g22 || null,
    bajus_g21     : g.g21 || null,
    bajus_g18     : g.g18 || null,
    bajus_gtr     : g.gtr || null,
    bajus_g22_vori: g.g22 ? Math.round(g.g22 * VORI) : null,
    bajus_g21_vori: g.g21 ? Math.round(g.g21 * VORI) : null,
    bajus_g18_vori: g.g18 ? Math.round(g.g18 * VORI) : null,
    bajus_gtr_vori: g.gtr ? Math.round(g.gtr * VORI) : null,
  };
}

function buildSilverEntry(bajus, now, fromCache) {
  const s = bajus?.silver || {};
  return {
    date           : now.toISOString().slice(0, 10),
    timestamp      : now.toISOString(),
    data_source    : bajus?.source || (fromCache ? 'cache' : null),
    bajus_s22      : s.s22 || null,
    bajus_s21      : s.s21 || null,
    bajus_s18      : s.s18 || null,
    bajus_str      : s.str || null,
    bajus_s22_vori : s.s22 ? Math.round(s.s22 * VORI) : null,
    bajus_s21_vori : s.s21 ? Math.round(s.s21 * VORI) : null,
    bajus_s18_vori : s.s18 ? Math.round(s.s18 * VORI) : null,
    bajus_str_vori : s.str ? Math.round(s.str  * VORI) : null,
  };
}

function buildIntlEntry(intl, now) {
  const gBDT = intl.goldUSD   && intl.usdBdt ? +(intl.goldUSD   / OZ * intl.usdBdt).toFixed(2)  : null;
  const sBDT = intl.silverUSD && intl.usdBdt ? +(intl.silverUSD / OZ * intl.usdBdt).toFixed(4)  : null;
  return {
    date               : now.toISOString().slice(0, 10),
    timestamp          : now.toISOString(),
    gold_usd_oz        : intl.goldUSD       || null,
    gold_prev_usd_oz   : intl.goldPrevUSD   || null,
    gold_chg_usd       : intl.goldChg       || null,
    gold_chg_pct       : intl.goldChgP      || null,
    gold_gram_bdt      : gBDT,
    silver_usd_oz      : intl.silverUSD     || null,
    silver_prev_usd_oz : intl.silverPrevUSD || null,
    silver_chg_usd     : intl.silverChg     || null,
    silver_chg_pct     : intl.silverChgP    || null,
    silver_gram_bdt    : sBDT,
    usd_bdt            : intl.usdBdt        || null,
  };
}

/* ─── PERSIST ─── */
function persist(entry, history, file, keys, label) {
  const changed = hasChanged(history, entry, keys);
  if (!changed && CFG.STORE_ONLY_ON_CHANGE) {
    info(`${label}: no change — skipping history append`);
    return { stored: false, history };
  }
  if (history.length && history[history.length - 1].date === entry.date) {
    history[history.length - 1] = entry;
    info(`${label}: updated same-day entry (${entry.date})`);
  } else {
    history.push(entry);
    info(`${label}: appended entry #${history.length} (${entry.date})`);
  }
  writeJSON(file, history);
  return { stored: true, history };
}

/* ─── MAIN ─── */
async function main() {
  const args       = process.argv.slice(2);
  const dryRun     = args.includes('--dry-run');
  const onlySource = args.find(a => a.startsWith('--source='))?.split('=')[1];

  info('══════════════════════════════════════════════');
  info('SonarGold Scraper v3.1 (Enhanced with BAJUSCTG Fallback) starting…');
  info(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'} | Source: ${onlySource || 'all'}`);
  if (process.env.WARP_PROXY) info(`WARP proxy: ${process.env.WARP_PROXY}`);
  info('══════════════════════════════════════════════');

  ensureDirs();

  const goldHist   = readJSON(CFG.GOLD_FILE,   []);
  const silverHist = readJSON(CFG.SILVER_FILE, []);
  const intlHist   = readJSON(CFG.INTL_FILE,   []);
  info(`History — gold:${goldHist.length} silver:${silverHist.length} intl:${intlHist.length}`);

  const now  = new Date();
  let bajus  = null;
  let fromCache = false;
  let intl   = {
    goldUSD: null, goldPrevUSD: null, goldChg: null, goldChgP: null,
    silverUSD: null, silverPrevUSD: null, silverChg: null, silverChgP: null,
    usdBdt: null,
  };

  if (!onlySource || onlySource === 'bajus') {
    bajus = await scrapeBajus();

    // If all live + wayback strategies failed, fall back to last cached price
    if (!bajus) {
      const cached = getLastGoodBajus(goldHist, silverHist);
      if (cached) {
        bajus     = cached;
        fromCache = true;
        warn('Using cached BAJUS prices (live scraping failed)');
      } else {
        error('BAJUS failed — no cache available either');
      }
    }
  }

  if (!onlySource || onlySource === 'intl') {
    intl = await fetchInternational();
  }

  const goldEntry   = buildGoldEntry(bajus, now, fromCache);
  const silverEntry = buildSilverEntry(bajus, now, fromCache);
  const intlEntry   = buildIntlEntry(intl, now);

  info('Gold:   ' + JSON.stringify(goldEntry));
  info('Silver: ' + JSON.stringify(silverEntry));
  info('Intl:   ' + JSON.stringify(intlEntry));

  if (dryRun) { info('DRY RUN — no files written'); return; }

  // Don't persist cache data as new history entries if values haven't changed
  const gR = persist(goldEntry,   goldHist,   CFG.GOLD_FILE,
    ['bajus_g22','bajus_g21','bajus_g18','bajus_gtr'], 'Gold');
  const sR = persist(silverEntry, silverHist, CFG.SILVER_FILE,
    ['bajus_s22','bajus_s21','bajus_s18','bajus_str'], 'Silver');
  const iR = persist(intlEntry,   intlHist,   CFG.INTL_FILE,
    ['gold_usd_oz','silver_usd_oz','usd_bdt'],          'Intl');

  const latest = {
    generated_at  : now.toISOString(),
    bajus_date    : now.toLocaleDateString('en-US', {
      timeZone: 'Asia/Dhaka', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    }),
    bajus_ok      : bajus !== null && isValidGold(bajus) && !fromCache,
    bajus_cached  : fromCache,
    bajus_source  : bajus?.source || null,
    intl_ok       : intlEntry.gold_usd_oz !== null,
    fx_ok         : intlEntry.usd_bdt     !== null,
    gold: {
      ...goldEntry,
      intl_usd_oz      : intlEntry.gold_usd_oz,
      intl_prev_usd_oz : intlEntry.gold_prev_usd_oz,
      intl_chg_usd     : intlEntry.gold_chg_usd,
      intl_chg_pct     : intlEntry.gold_chg_pct,
      intl_gram_bdt    : intlEntry.gold_gram_bdt,
      usd_bdt          : intlEntry.usd_bdt,
    },
    silver: {
      ...silverEntry,
      intl_usd_oz      : intlEntry.silver_usd_oz,
      intl_prev_usd_oz : intlEntry.silver_prev_usd_oz,
      intl_chg_usd     : intlEntry.silver_chg_usd,
      intl_chg_pct     : intlEntry.silver_chg_pct,
      intl_gram_bdt    : intlEntry.silver_gram_bdt,
      usd_bdt          : intlEntry.usd_bdt,
    },
    counts  : { gold: gR.history.length, silver: sR.history.length, intl: iR.history.length },
    bajus_raw: bajus?.raw || null,
  };

  writeJSON(CFG.LATEST_FILE, latest);
  info('latest.json written');
  info(`Done — gold:${gR.stored?'stored':'no-change'} silver:${sR.stored?'stored':'no-change'} intl:${iR.stored?'stored':'no-change'}`);
  info('══════════════════════════════════════════════');
}

main().catch(e => {
  error(`Fatal: ${e.message}\n${e.stack}`);
  process.exit(1);
});
