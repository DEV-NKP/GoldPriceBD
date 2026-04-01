/**
 * SonarGold BD — Price Scraper v2.2 (Advanced BAJUS Bypass)
 * ============================================================
 * Runs every 4 hours via GitHub Actions.
 * Scrapes BAJUS (bajus.org) for BD gold/silver prices.
 * Fetches international XAU/XAG spot + USD/BDT from free APIs.
 *
 * THREE separate output files:
 *   data/gold_prices.json   — BAJUS gold history (BD only, per-gram BDT)
 *   data/silver_prices.json — BAJUS silver history (BD only, per-gram BDT)
 *   data/intl_prices.json   — International XAU/XAG/FX history (separate!)
 *   data/latest.json        — Combined snapshot for the website
 *   logs/scraper-YYYY-MM-DD.log — Daily rolling log
 *
 * Run:  node scraper.js
 * Test: node scraper.js --dry-run
 */

'use strict';

const puppeteer     = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio       = require('cheerio');
const fs            = require('fs');
const path          = require('path');
const dns           = require('dns').promises;

puppeteer.use(StealthPlugin());

/* ─── CONFIG ─── */
const CFG = {
  BAJUS_URLS: [
    'https://bajus.org/gold-price',
    'https://www.bajus.org/gold-price',
    'https://bajus.org/index.php?action=goldprice',
  ],
  INTL_GOLD_URL  : 'https://api.gold-api.com/price/XAU',
  INTL_SILVER_URL: 'https://api.gold-api.com/price/XAG',
  FX_URL         : 'https://open.er-api.com/v6/latest/USD',
  DATA_DIR    : path.join(__dirname, 'data'),
  LOG_DIR     : path.join(__dirname, 'logs'),
  GOLD_FILE   : path.join(__dirname, 'data', 'gold_prices.json'),
  SILVER_FILE : path.join(__dirname, 'data', 'silver_prices.json'),
  INTL_FILE   : path.join(__dirname, 'data', 'intl_prices.json'),
  LATEST_FILE : path.join(__dirname, 'data', 'latest.json'),
  STORE_ONLY_ON_CHANGE: true,
  HEADLESS    : true,
  TIMEOUT     : 45000,
  MAX_RETRIES : 3,
  LOG_KEEP_DAYS: 30,
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
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0'
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
    // Rotate old logs
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
const readJSON = (file, fallback = []) => {
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

/* ─── DNS RESOLUTION HELPER ─── */
async function resolveDNS(hostname) {
  try {
    await dns.lookup(hostname);
    return true;
  } catch (e) {
    warn(`DNS resolution failed for ${hostname}: ${e.message}`);
    return false;
  }
}

/* ─── BENGALI → ARABIC NUMERAL CONVERTER ─── */
function convertBengaliToArabic(str) {
  const bengaliDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  const arabicDigits  = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  for (let i = 0; i < bengaliDigits.length; i++) {
    str = str.replace(new RegExp(bengaliDigits[i], 'g'), arabicDigits[i]);
  }
  return str;
}

/* ─── SCRAPE BAJUS (ADVANCED BOT BYPASS) ─── */
async function scrapeBajus() {
  info('Starting BAJUS scrape (Advanced Bot Bypass)…');
  let browser;

  for (const url of CFG.BAJUS_URLS) {
    for (let attempt = 1; attempt <= CFG.MAX_RETRIES; attempt++) {
      try {
        // Use a more comprehensive stealth configuration
        const stealthOptions = {
          language: 'en-US,en;q=0.9',
          locale: 'en-US',
          colorScheme: 'light',
          timezone: 'America/New_York',
          geolocation: { latitude: 40.7128, longitude: -74.0060 }, // New York
          permissions: ['geolocation'],
          reducedMotion: 'default'
        };

        browser = await puppeteer.launch({
          headless: CFG.HEADLESS,
          args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage', 
            '--disable-gpu',
            '--window-size=1920,1080',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--allow-running-insecure-content',
            '--disable-webgl',
            '--disable-popup-blocking',
            '--disable-extensions',
            '--disable-plugins',
            '--disable-images',
            '--disable-notifications',
            '--disable-default-apps',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-field-trial-config',
            '--disable-ipc-flooding-protection',
            '--enable-automation',
            '--password-store=basic',
            '--use-mock-keychain'
          ],
        });
        
        const page = await browser.newPage();
        
        // Apply stealth options
        await page.emulateTimezone(stealthOptions.timezone);
        await page.setGeolocation(stealthOptions.geolocation);
        await page.setExtraHTTPHeaders({
          'Accept-Language': stealthOptions.language,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Cache-Control': 'max-age=0'
        });
        
        // Enhanced stealth scripts
        await page.evaluateOnNewDocument(() => {
          // Remove webdriver property
          Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined
          });
          
          // Override plugins
          Object.defineProperty(navigator, 'plugins', {
            get: () => [
              {
                0: {
                  type: "application/x-google-chrome-pdf",
                  suffixes: "pdf",
                  description: "Portable Document Format",
                  enabledPlugin: Plugin
                },
                description: "Portable Document Format",
                filename: "internal-pdf-viewer",
                length: 1,
                name: "Chrome PDF Plugin"
              }
            ]
          });
          
          // Override languages
          Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en']
          });
          
          // Add chrome object
          window.chrome = {
            app: {},
            runtime: {}
          };
          
          // Override permissions
          Object.defineProperty(navigator, 'permissions', {
            get: () => ({
              query: () => Promise.resolve({ state: 'granted' })
            })
          });
          
          // Override WebGL
          const getParameter = WebGLRenderingContext.prototype.getParameter;
          WebGLRenderingContext.prototype.getParameter = function(parameter) {
            if (parameter === 37445) {
              return 'Intel Inc.';
            }
            if (parameter === 37446) {
              return 'Intel(R) HD Graphics 630';
            }
            return getParameter(parameter);
          };
          
          // Override the getBoundingClientRect method to prevent size detection
          const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
          Element.prototype.getBoundingClientRect = function() {
            const result = originalGetBoundingClientRect.call(this);
            // Add random small variations to make detection harder
            result.x += Math.random() * 0.1 - 0.05;
            result.y += Math.random() * 0.1 - 0.05;
            return result;
          };
        });

        await page.setUserAgent(rndUA());
        await page.setViewport({ 
          width: 1920, 
          height: 1080,
          deviceScaleFactor: 1,
          isMobile: false,
          hasTouch: false,
          isLandscape: true
        });
        
        // Block unnecessary resources
        await page.setRequestInterception(true);
        page.on('request', req => {
          if (['image', 'stylesheet', 'font', 'media', 'script'].includes(req.resourceType())) {
            req.abort();
          } else {
            req.continue();
          }
        });

        // Random delay before navigation
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
        
        // Navigate to the page
        info(`Attempt ${attempt}: GET ${url}`);
        const response = await page.goto(url, { 
          waitUntil: 'networkidle2', // Wait for network to be idle
          timeout: CFG.TIMEOUT 
        });

        // Check if we got blocked
        if (!response || response.status() >= 400) {
          warn(`HTTP ${response?.status()} — skipping`);
          await browser.close(); browser = null;
          break;
        }

        // Check for common block indicators
        const isBlocked = await page.evaluate(() => {
          // Check for common block indicators
          const blockIndicators = [
            'access denied',
            'forbidden',
            'blocked',
            'captcha',
            'cloudflare',
            'security check',
            'checking your browser',
            'enable javascript',
            'enable cookies'
          ];
          
          const pageText = document.body.innerText.toLowerCase();
          return blockIndicators.some(indicator => pageText.includes(indicator));
        });
        
        if (isBlocked) {
          warn('Page appears to be blocked by bot detection');
          await browser.close(); browser = null;
          continue;
        }

        // Wait a bit for dynamic content
        await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
        
        // Try to scroll a bit to trigger any lazy-loaded content
        await page.evaluate(() => {
          window.scrollBy(0, window.innerHeight);
        });
        await new Promise(r => setTimeout(r, 1000));
        
        const html = await page.content();
        await browser.close(); browser = null;

        const parsed = parseBajusHTML(html, url);
        if (parsed && isValidGold(parsed)) {
          info(`BAJUS OK → gold22=${parsed.gold.g22}/g  silver22=${parsed.silver.s22 || '?'}/g`);
          return parsed;
        }
        warn(`Parse invalid from ${url}`);
        break;

      } catch (e) {
        warn(`Attempt ${attempt} error (${url}): ${e.message}`);
        if (browser) { try { await browser.close(); } catch {} browser = null; }
        if (attempt < CFG.MAX_RETRIES) {
          const delay = 5000 + Math.random() * 5000;
          info(`Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
  }

  error('All BAJUS URLs failed');
  return null;
}

/* ─── PARSE BAJUS HTML ─── */
function parseBajusHTML(html, sourceUrl) {
  if (!html || html.length < 500) return null;

  const $ = cheerio.load(html);

  /* STRATEGY 1: Look for known BAJUS text patterns in visible text */
  const bodyText = $('body').text()
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .toUpperCase();

  info(`Page text sample: ${bodyText.substring(0, 300)}`);

  const result = {
    gold:   { g22: null, g21: null, g18: null, gtr: null },
    silver: { s22: null, s21: null, s18: null, str: null },
    raw:    bodyText.substring(0, 500),
  };

  /* Convert Bengali numerals to Arabic numerals */
  function convertBengaliToArabic(str) {
    const bengaliDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
    const arabicDigits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    
    for (let i = 0; i < bengaliDigits.length; i++) {
      str = str.replace(new RegExp(bengaliDigits[i], 'g'), arabicDigits[i]);
    }
    return str;
  }

  /* Get ticker text specifically */
  const tickerText = $('#tick').text();
  const convertedTickerText = convertBengaliToArabic(tickerText).toUpperCase();
  
  info(`Ticker text: ${convertedTickerText}`);
  
  /* Pattern: "২২ ক্যা: ক্যাডমিয়াম (হলমার্ককৃত) প্রতি গ্রাম স্বর্ণের মূল্য : ২০৭০০/-" */
  const patterns = [
    // Gold patterns
    { key: 'g22', regex: /২২\s*ক্যা[:\s]*.*?স্বর্ণের মূল্য\s*[:\-\s]\s*(\d+)/i },
    { key: 'g21', regex: /২১\s*ক্যা[:\s]*.*?স্বর্ণের মূল্য\s*[:\-\s]\s*(\d+)/i },
    { key: 'g18', regex: /১৮\s*ক্যা[:\s]*.*?স্বর্ণের মূল্য\s*[:\-\s]\s*(\d+)/i },
    { key: 'gtr', regex: /সনাতন পদ্ধতি.*?স্বর্ণের মূল্য\s*[:\-\s]\s*(\d+)/i },
    
    // Silver patterns
    { key: 's22', regex: /২২\s*ক্যা[:\s]*.*?ক্যাডমিয়াম.*?রূপার মূল্য\s*[:\-\s]\s*(\d+)/i },
    { key: 's21', regex: /২১\s*ক্যা[:\s]*.*?ক্যাডমিয়াম.*?রূপার মূল্য\s*[:\-\s]\s*(\d+)/i },
    { key: 's18', regex: /১৮\s*ক্যা[:\s]*.*?ক্যাডমিয়াম.*?রূপার মূল্য\s*[:\-\s]\s*(\d+)/i },
    { key: 'str', regex: /সনাতন পদ্ধতি.*?রূপার মূল্য\s*[:\-\s]\s*(\d+)/i },
  ];

  for (const p of patterns) {
    const match = convertedTickerText.match(p.regex);
    if (match) {
      const val = parseInt(match[1].replace(/,/g, ''), 10);
      if (isFinite(val) && val > 50) {
        const target = ['g22','g21','g18','gtr'].includes(p.key) ? result.gold : result.silver;
        if (target[p.key] === null) target[p.key] = val;
        info(`Found ${p.key}: ${val}`);
      }
    }
  }

  /* STRATEGY 2: Parse table rows if present */
  $('table tr, .price-row, .gold-price, [class*="price"], [class*="gold"], [class*="silver"]').each((_, el) => {
    const rowText = $(el).text().replace(/\s+/g, ' ');
    const convertedRowText = convertBengaliToArabic(rowText);
    const numMatch = convertedRowText.match(/([\d,]{3,})/g);
    if (!numMatch) return;
    const nums = numMatch.map(n => parseInt(n.replace(/,/g,''),10)).filter(n => n > 50 && n < 100000);
    if (nums.length === 0) return;
    const val = nums[nums.length - 1];

    const isSilver = rowText.includes('SILVER') || rowText.includes('রূপার মূল্য');
    const isGold = rowText.includes('GOLD') || rowText.includes('স্বর্ণের মূল্য');
    const isTraditional = rowText.includes('TRADITIONAL') || rowText.includes('সনাতন পদ্ধতি');

    if (rowText.includes('22') && isGold && !result.gold.g22) result.gold.g22 = val;
    else if (rowText.includes('21') && isGold && !result.gold.g21) result.gold.g21 = val;
    else if (rowText.includes('18') && isGold && !result.gold.g18) result.gold.g18 = val;
    else if (isTraditional && isGold && !result.gold.gtr) result.gold.gtr = val;

    else if (rowText.includes('22') && isSilver && !result.silver.s22) result.silver.s22 = val;
    else if (rowText.includes('21') && isSilver && !result.silver.s21) result.silver.s21 = val;
    else if (rowText.includes('18') && isSilver && !result.silver.s18) result.silver.s18 = val;
    else if (isTraditional && isSilver && !result.silver.str) result.silver.str = val;
  });

  /* STRATEGY 3: Extract all numbers from text, use positional logic */
  if (!result.gold.g22) {
    const numBlocks = convertedTickerText.match(/\b(\d{4,6})\b/g) || [];
    const candidates = [...new Set(numBlocks.map(Number))]
      .filter(n => n >= 1000 && n <= 60000)
      .sort((a, b) => b - a);

    if (candidates.length >= 4) {
      for (let i = 0; i <= candidates.length - 4; i++) {
        const [a, b, c, d] = candidates.slice(i, i + 4);
        if (a > b && b > c && c > d
          && a < 60000 && d > 1000
          && a < b * 1.25 && b < c * 1.25 && c < d * 1.6) {
          result.gold.g22 = a;
          result.gold.g21 = b;
          result.gold.g18 = c;
          result.gold.gtr = d;
          info(`Positional gold extraction: ${a}/${b}/${c}/${d}`);
          break;
        }
      }
    }
  }

  if (!result.silver.s22) {
    const numBlocks = convertedTickerText.match(/\b(\d{2,4})\b/g) || [];
    const candidates = [...new Set(numBlocks.map(Number))]
      .filter(n => n >= 100 && n <= 1000)
      .sort((a, b) => b - a);

    if (candidates.length >= 3) {
      for (let i = 0; i <= candidates.length - 3; i++) {
        const [a, b, c] = candidates.slice(i, i + 3);
        if (a > b && b > c
          && a < 1000 && c > 100
          && a < b * 1.1 && b < c * 1.2) {
          result.silver.s22 = a;
          result.silver.s21 = b;
          result.silver.s18 = c;
          info(`Positional silver extraction: ${a}/${b}/${c}`);
          break;
        }
      }
    }
  }

  /* Silver fallback */
  if (result.silver.s22 && !result.silver.s21) {
    result.silver.s21 = Math.round(result.silver.s22 * 0.945);
    result.silver.s18 = Math.round(result.silver.s22 * 0.808);
    result.silver.str = Math.round(result.silver.s22 * 0.615);
    warn('Silver: derived s21/s18/str proportionally from s22');
  }

  if (!result.silver.s22) {
    const cadMatch = convertedTickerText.match(/(?:২২\s*ক্যা[:\s]*)?(?:রূপার|স্বর্ণের)\s*মূল্য\s*[:\-\s]\s*(\d+)/i);
    if (cadMatch) {
      const v = parseInt(cadMatch[1].replace(/,/g,''),10);
      if (v > 50 && v < 10000) {
        result.silver.s22 = v;
        result.silver.s21 = Math.round(v * 0.945);
        result.silver.s18 = Math.round(v * 0.808);
        result.silver.str = Math.round(v * 0.615);
      }
    }
  }

  return result;
}

const isValidGold = p => {
  const g = p?.gold;
  return g && g.g22 > 1000 && g.g21 > 1000 && g.g18 > 1000 && g.gtr > 500
    && g.g22 > g.g21 && g.g21 > g.g18 && g.g18 > g.gtr;
};

/* ─── FETCH INTERNATIONAL PRICES ─── */
async function fetchInternational() {
  info('Fetching international prices from gold-api.com and open.er-api.com…');
  const { default: fetch } = await import('node-fetch');
  let gold = null, silver = null, fx = null;

  try {
    const r = await fetch(CFG.INTL_GOLD_URL, { 
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': rndUA(),
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    gold = await r.json();
    info(`Gold API: ${JSON.stringify(gold)}`);
    if (!isFinite(+gold.price) || +gold.price <= 0) throw new Error('Bad gold data');
    info(`XAU: $${gold.price}/oz`);
  } catch (e) { 
    error(`XAU fetch: ${e.message}`); 
  }

  try {
    const r = await fetch(CFG.INTL_SILVER_URL, { 
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': rndUA(),
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    silver = await r.json();
    info(`Silver API: ${JSON.stringify(silver)}`);
    if (!isFinite(+silver.price) || +silver.price <= 0) throw new Error('Bad silver data');
    info(`XAG: $${silver.price}/oz`);
  } catch (e) { 
    error(`XAG fetch: ${e.message}`); 
  }

  try {
    const r = await fetch(CFG.FX_URL, { 
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': rndUA(),
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    fx = await r.json();
    if (!isFinite(+fx?.rates?.BDT)) throw new Error('No BDT rate');
    info(`USD/BDT: ${fx.rates.BDT}`);
  } catch (e) { 
    error(`FX fetch: ${e.message}`); 
    fx = { rates: { BDT: null } }; 
  }

  const pick = (obj, ...keys) => {
    for (const k of keys) {
      const v = obj?.[k];
      if (v !== undefined && v !== null && isFinite(+v)) return +v;
    }
    return null;
  };

  return {
    goldUSD      : gold   ? +gold.price   : null,
    goldPrevUSD  : gold   ? pick(gold,   'prev_close_price', 'previous_close', 'prev_price') : null,
    goldChg      : gold   ? pick(gold,   'ch', 'change', 'price_change') : null,
    goldChgP     : gold   ? pick(gold,   'chp', 'change_percent', 'percent_change') : null,
    silverUSD    : silver ? +silver.price : null,
    silverPrevUSD: silver ? pick(silver, 'prev_close_price', 'previous_close', 'prev_price') : null,
    silverChg    : silver ? pick(silver, 'ch', 'change', 'price_change') : null,
    silverChgP   : silver ? pick(silver, 'chp', 'change_percent', 'percent_change') : null,
    usdBdt       : fx?.rates?.BDT ? +fx.rates.BDT : null,
  };
}

/* ─── BUILD DATA ENTRIES ─── */
function buildGoldEntry(bajus, now) {
  const g = bajus?.gold || {};
  return {
    date            : now.toISOString().slice(0, 10),
    timestamp       : now.toISOString(),
    bajus_g22       : g.g22 || null,
    bajus_g21       : g.g21 || null,
    bajus_g18       : g.g18 || null,
    bajus_gtr       : g.gtr || null,
    bajus_g22_vori  : g.g22 ? Math.round(g.g22 * VORI) : null,
    bajus_g21_vori  : g.g21 ? Math.round(g.g21 * VORI) : null,
    bajus_g18_vori  : g.g18 ? Math.round(g.g18 * VORI) : null,
    bajus_gtr_vori  : g.gtr ? Math.round(g.gtr * VORI) : null,
  };
}

function buildSilverEntry(bajus, now) {
  const s = bajus?.silver || {};
  return {
    date            : now.toISOString().slice(0, 10),
    timestamp       : now.toISOString(),
    bajus_s22       : s.s22 || null,
    bajus_s21       : s.s21 || null,
    bajus_s18       : s.s18 || null,
    bajus_str       : s.str || null,
    bajus_s22_vori  : s.s22 ? Math.round(s.s22 * VORI) : null,
    bajus_s21_vori  : s.s21 ? Math.round(s.s21 * VORI) : null,
    bajus_s18_vori  : s.s18 ? Math.round(s.s18 * VORI) : null,
    bajus_str_vori  : s.str ? Math.round(s.str  * VORI) : null,
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

/* ─── PERSIST HELPERS ─── */
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
  info('SonarGold Scraper v2.2 (Advanced BAJUS Bypass) starting…');
  info(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'} | Source: ${onlySource || 'all'}`);
  info('══════════════════════════════════════════════');

  ensureDirs();

  const goldHist   = readJSON(CFG.GOLD_FILE,   []);
  const silverHist = readJSON(CFG.SILVER_FILE, []);
  const intlHist   = readJSON(CFG.INTL_FILE,   []);
  info(`History — gold:${goldHist.length} silver:${silverHist.length} intl:${intlHist.length}`);

  const now  = new Date();
  let bajus  = null;
  let intl   = { goldUSD:null, goldPrevUSD:null, goldChg:null, goldChgP:null,
                 silverUSD:null, silverPrevUSD:null, silverChg:null, silverChgP:null,
                 usdBdt:null };

  if (!onlySource || onlySource === 'bajus') {
    bajus = await scrapeBajus();
    if (!bajus) error('BAJUS failed — BD prices null this run');
  }

  if (!onlySource || onlySource === 'intl') {
    intl = await fetchInternational();
  }

  const goldEntry   = buildGoldEntry(bajus, now);
  const silverEntry = buildSilverEntry(bajus, now);
  const intlEntry   = buildIntlEntry(intl, now);

  info('Gold:   ' + JSON.stringify(goldEntry));
  info('Silver: ' + JSON.stringify(silverEntry));
  info('Intl:   ' + JSON.stringify(intlEntry));

  if (dryRun) { info('DRY RUN — no files written'); return; }

  const gR = persist(goldEntry,   goldHist,   CFG.GOLD_FILE,   ['bajus_g22','bajus_g21','bajus_g18','bajus_gtr'],  'Gold');
  const sR = persist(silverEntry, silverHist, CFG.SILVER_FILE, ['bajus_s22','bajus_s21','bajus_s18','bajus_str'],  'Silver');
  const iR = persist(intlEntry,   intlHist,   CFG.INTL_FILE,   ['gold_usd_oz','silver_usd_oz','usd_bdt'],           'Intl');

  const latest = {
    generated_at : now.toISOString(),
    bajus_date   : now.toLocaleDateString('en-US', {
      timeZone:'Asia/Dhaka', weekday:'long', year:'numeric', month:'long', day:'numeric'
    }),
    bajus_ok  : bajus !== null && isValidGold(bajus),
    intl_ok   : intlEntry.gold_usd_oz !== null,
    fx_ok     : intlEntry.usd_bdt !== null,
    gold: {
      ...goldEntry,
      intl_usd_oz     : intlEntry.gold_usd_oz,
      intl_prev_usd_oz: intlEntry.gold_prev_usd_oz,
      intl_chg_usd    : intlEntry.gold_chg_usd,
      intl_chg_pct    : intlEntry.gold_chg_pct,
      intl_gram_bdt   : intlEntry.gold_gram_bdt,
      usd_bdt         : intlEntry.usd_bdt,
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
    counts: { gold: gR.history.length, silver: sR.history.length, intl: iR.history.length },
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
