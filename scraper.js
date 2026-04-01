/**
 * SonarGold BD — Price Scraper v4.0 (Multi-Source BAJUS)
 * ============================================================
 * ROOT CAUSE FIX:
 *   bajus.org blocks GitHub Actions (Azure datacenter IPs) with HTTP 403.
 *   No Puppeteer/stealth/proxy fixes this — it's pure IP-level blocking.
 *
 * SOLUTION — Waterfall of 6 sources (all publish same official BAJUS rates):
 *   1. alaminjewellers.com  — WordPress, no bot protection, clean table ✅
 *   2. bajusgold.com        — WordPress blog, simple HTML table ✅
 *   3. bajusctg.org         — WordPress, accessible ✅
 *   4. goldpricebd.com      — BD gold aggregator ✅
 *   5. bajus.org (direct)   — Official but 403 from datacenter IPs
 *   6. Cache fallback       — Last known good prices (≤3 days old)
 *
 * Sources 1-4 are simple WordPress/static sites with zero bot protection.
 * They all publish the exact same rates set by BAJUS daily.
 * No Puppeteer, no WARP proxy, no stealth needed.
 *
 * Output files (same structure as before):
 *   data/gold_prices.json   data/silver_prices.json
 *   data/intl_prices.json   data/latest.json
 *   logs/scraper-YYYY-MM-DD.log
 */
'use strict';

const cheerio = require('cheerio');
const fs      = require('fs');
const path    = require('path');

/* ─── CONFIG ─── */
const CFG = {
  // Ordered: most accessible from datacenter IPs first
  BAJUS_SOURCES: [
    { name:'alaminjewellers', url:'https://www.alaminjewellers.com/gold-price/', parser:'parseAlAmin' },
    { name:'bajusgold',       url:'https://bajusgold.com/',                      parser:'parseBajusGold' },
    { name:'bajusctg',        url:'https://www.bajusctg.org/',                   parser:'parseGeneric' },
    { name:'goldpricebd',     url:'https://www.goldpricebd.com/',                parser:'parseGeneric' },
    { name:'bajus_official',  url:'https://bajus.org/gold-price',                parser:'parseBajusOfficial' },
    { name:'bajus_www',       url:'https://www.bajus.org/gold-price',            parser:'parseBajusOfficial' },
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

  STORE_ONLY_ON_CHANGE : true,
  TIMEOUT              : 20000,
  LOG_KEEP_DAYS        : 30,
  CACHE_MAX_AGE_MS     : 3 * 24 * 60 * 60 * 1000,
};

const VORI = 11.664;
const OZ   = 31.1035;

const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
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

const hasChanged = (arr, entry, keys) => {
  if (!arr || !arr.length) return true;
  const last = arr[arr.length - 1];
  return keys.some(k => last[k] !== entry[k]);
};

/* ─── BENGALI NUMERALS → ARABIC ─── */
function bn2ar(str) {
  if (!str) return '';
  const b = ['০','১','২','৩','৪','৫','৬','৭','৮','৯'];
  const a = ['0','1','2','3','4','5','6','7','8','9'];
  for (let i = 0; i < b.length; i++) str = str.replace(new RegExp(b[i], 'g'), a[i]);
  return str;
}

/* ─── PLAIN FETCH (no Puppeteer) ─── */
async function fetchHTML(url) {
  const { default: fetch } = await import('node-fetch');
  const res = await fetch(url, {
    headers: {
      'User-Agent'               : rndUA(),
      'Accept'                   : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language'          : 'en-US,en;q=0.9',
      'Accept-Encoding'          : 'gzip, deflate, br',
      'Connection'               : 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control'            : 'no-cache',
    },
    signal: AbortSignal.timeout(CFG.TIMEOUT),
  });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/* ═══════════════════════════════════════════════════════════
   PARSERS
   ═══════════════════════════════════════════════════════════ */

/**
 * Al-Amin Jewellers (alaminjewellers.com)
 * Table format: | CARAT | Per Gram Price | Per Bhori Price |
 * Col[1] = per-gram BDT (what we want directly)
 * Example row: | 22/22 CARAT | 21260 | 247977 |
 */
function parseAlAmin(html) {
  const $ = cheerio.load(html);
  const result = emptyResult();

  $('table tr').each((_, row) => {
    const cells = $(row).find('td, th').map((__, td) => $(td).text().trim()).get();
    if (cells.length < 2) return;

    const label   = bn2ar(cells[0]).toUpperCase().replace(/[\s/]/g, '');
    const perGram = parseInt(bn2ar(cells[1]).replace(/[,\s৳.]/g, ''), 10);

    if (!isFinite(perGram) || perGram < 1000 || perGram > 60000) return;

    const isSilver = label.includes('SILVER') || label.includes('SILVER') || cells[0].includes('রূপা');

    if (!isSilver) {
      if      (label.includes('22')) { if (!result.gold.g22) result.gold.g22 = perGram; }
      else if (label.includes('21')) { if (!result.gold.g21) result.gold.g21 = perGram; }
      else if (label.includes('18')) { if (!result.gold.g18) result.gold.g18 = perGram; }
      else if (label.includes('TRADITIONAL') || label.includes('METHOD') || label.includes('SONATON'))
                                     { if (!result.gold.gtr) result.gold.gtr = perGram; }
    } else {
      if      (label.includes('22')) { if (!result.silver.s22) result.silver.s22 = perGram; }
      else if (label.includes('21')) { if (!result.silver.s21) result.silver.s21 = perGram; }
      else if (label.includes('18')) { if (!result.silver.s18) result.silver.s18 = perGram; }
    }
  });

  result.raw = $('table').first().text().replace(/\s+/g, ' ').trim().substring(0, 200);
  return result;
}

/**
 * bajusgold.com
 * Tables contain per-BHORI prices. Convert to per-gram by dividing by VORI.
 * Table 0 = gold, Table 1 = silver.
 */
function parseBajusGold(html) {
  const $ = cheerio.load(html);
  const result = emptyResult();

  $('table').each((tIdx, table) => {
    if (tIdx > 1) return;
    const isGold   = tIdx === 0;
    const isSilver = tIdx === 1;

    $(table).find('tr').each((_, row) => {
      const cells = $(row).find('td, th').map((__, td) => $(td).text().trim()).get();
      if (cells.length < 2) return;

      const label  = bn2ar(cells[0]).toUpperCase();
      const valStr = bn2ar(cells[cells.length - 1]).replace(/[,\s৳.]/g, '');
      const rawVal = parseInt(valStr, 10);
      if (!isFinite(rawVal) || rawVal < 100) return;

      // Values > 20000 are per-bhori; convert to per-gram
      const perGram = rawVal > 20000 ? Math.round(rawVal / VORI) : rawVal;
      if (perGram < 1000 || perGram > 60000) return;

      const is22  = label.includes('২২') || label.match(/\b22\b/);
      const is21  = label.includes('২১') || label.match(/\b21\b/);
      const is18  = label.includes('১৮') || label.match(/\b18\b/);
      const isTrd = label.includes('সনাতন') || label.includes('SONATON') || label.includes('TRADITIONAL');

      if (isGold) {
        if      (is22 && !result.gold.g22) result.gold.g22 = perGram;
        else if (is21 && !result.gold.g21) result.gold.g21 = perGram;
        else if (is18 && !result.gold.g18) result.gold.g18 = perGram;
        else if (isTrd && !result.gold.gtr) result.gold.gtr = perGram;
      } else if (isSilver) {
        if      (is22 && !result.silver.s22) result.silver.s22 = perGram;
        else if (is21 && !result.silver.s21) result.silver.s21 = perGram;
        else if (is18 && !result.silver.s18) result.silver.s18 = perGram;
        else if (isTrd && !result.silver.str) result.silver.str = perGram;
      }
    });
  });

  result.raw = $('table').first().text().replace(/\s+/g, ' ').trim().substring(0, 200);
  return result;
}

/**
 * Generic parser — works for bajusctg.org, goldpricebd.com, and similar sites.
 * Searches tables, list items, paragraphs for price patterns.
 */
function parseGeneric(html) {
  const $ = cheerio.load(html);
  const result = emptyResult();

  // Scan all text-bearing elements
  $('table tr, li, p, td, div').each((_, el) => {
    const text    = bn2ar($(el).text()).replace(/\s+/g, ' ').trim();
    const textUC  = text.toUpperCase();
    if (text.length < 3 || text.length > 300) return;

    const numMatches = text.match(/[\d,]{4,}/g) || [];
    const nums = numMatches
      .map(n => parseInt(n.replace(/,/g, ''), 10))
      .filter(n => n >= 1000 && n <= 500000);
    if (!nums.length) return;

    const rawVal  = nums[nums.length - 1];
    const perGram = rawVal > 20000 ? Math.round(rawVal / VORI) : rawVal;
    if (perGram < 1000 || perGram > 60000) return;

    const isSilver = textUC.includes('SILVER') || text.includes('রূপা') || text.includes('রুপা');
    const isTrad   = textUC.includes('TRADITIONAL') || textUC.includes('SANATON') || text.includes('সনাতন');
    const is22     = textUC.match(/\b22\b/) || text.includes('২২');
    const is21     = textUC.match(/\b21\b/) || text.includes('২১');
    const is18     = textUC.match(/\b18\b/) || text.includes('১৮');

    if (isSilver) {
      if      (is22 && !result.silver.s22) result.silver.s22 = perGram;
      else if (is21 && !result.silver.s21) result.silver.s21 = perGram;
      else if (is18 && !result.silver.s18) result.silver.s18 = perGram;
      else if (isTrad && !result.silver.str) result.silver.str = perGram;
    } else {
      if      (is22 && !result.gold.g22) result.gold.g22 = perGram;
      else if (is21 && !result.gold.g21) result.gold.g21 = perGram;
      else if (is18 && !result.gold.g18) result.gold.g18 = perGram;
      else if (isTrad && !result.gold.gtr) result.gold.gtr = perGram;
    }
  });

  result.raw = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 200);
  return result;
}

/**
 * Official bajus.org — original positional/ticker logic from v2.2.
 * Still included in case the IP ban is lifted or changes.
 */
function parseBajusOfficial(html) {
  if (!html || html.length < 500) return null;
  const $ = cheerio.load(html);
  const result = emptyResult();

  const rawText = bn2ar(
    $('#tick').text() || $('[id*="tick"]').text() || $('body').text()
  ).toUpperCase().replace(/\s+/g, ' ');
  result.raw = rawText.substring(0, 300);

  // Positional extraction from sequential numbers
  const numBlocks  = rawText.match(/\b(\d{4,6})\b/g) || [];
  const candidates = [...new Set(numBlocks.map(Number))]
    .filter(n => n >= 1000 && n <= 60000).sort((a, b) => b - a);

  for (let i = 0; i <= candidates.length - 4; i++) {
    const [a, b, c, d] = candidates.slice(i, i + 4);
    if (a > b && b > c && c > d && a < 60000 && d > 1000
        && a < b * 1.25 && b < c * 1.25 && c < d * 1.6) {
      result.gold.g22 = a; result.gold.g21 = b;
      result.gold.g18 = c; result.gold.gtr = d;
      info(`[bajus_official] Positional extraction: ${a}/${b}/${c}/${d}`);
      break;
    }
  }

  // Also try table rows
  $('table tr').each((_, row) => {
    const cells = $(row).find('td').map((__, td) => $(td).text().trim()).get();
    if (cells.length < 2) return;
    const label = bn2ar(cells[0]).toUpperCase();
    const val   = parseInt(bn2ar(cells[1]).replace(/[,৳\s]/g, ''), 10);
    if (!isFinite(val)) return;
    const pg = val > 20000 ? Math.round(val / VORI) : val;
    if (pg < 1000 || pg > 60000) return;
    if      (label.includes('22') && !result.gold.g22) result.gold.g22 = pg;
    else if (label.includes('21') && !result.gold.g21) result.gold.g21 = pg;
    else if (label.includes('18') && !result.gold.g18) result.gold.g18 = pg;
  });

  return result;
}

/* ─── HELPERS ─── */
function emptyResult() {
  return {
    gold  : { g22: null, g21: null, g18: null, gtr: null },
    silver: { s22: null, s21: null, s18: null, str: null },
    raw   : '',
  };
}

const PARSERS = { parseAlAmin, parseBajusGold, parseGeneric, parseBajusOfficial };

const isValidGold = p => {
  const g = p?.gold;
  return g && g.g22 > 1000 && g.g21 > 1000 && g.g18 > 1000 && g.gtr > 500
    && g.g22 > g.g21 && g.g21 > g.g18 && g.g18 > g.gtr;
};

function fillSilver(result) {
  if (result.silver.s22 && !result.silver.s21) {
    result.silver.s21 = Math.round(result.silver.s22 * 0.945);
    result.silver.s18 = Math.round(result.silver.s22 * 0.808);
    result.silver.str = Math.round(result.silver.s22 * 0.615);
    warn('Silver: derived s21/s18/str proportionally from s22');
  }
  return result;
}

/* ═══════════════════════════════════════════════════════════
   MAIN SCRAPER — waterfall through all sources
   ═══════════════════════════════════════════════════════════ */
async function scrapeBajus() {
  info('Starting BAJUS scrape (v4.0 — multi-source waterfall)…');

  for (const source of CFG.BAJUS_SOURCES) {
    try {
      info(`[${source.name}] Fetching ${source.url}…`);
      const html   = await fetchHTML(source.url);
      const parser = PARSERS[source.parser];
      if (!parser) { warn(`[${source.name}] Unknown parser: ${source.parser}`); continue; }

      const parsed = parser(html);
      if (!parsed) { warn(`[${source.name}] Parser returned null`); continue; }

      fillSilver(parsed);

      info(`[${source.name}] Parsed: gold=${JSON.stringify(parsed.gold)} silver=${JSON.stringify(parsed.silver)}`);

      if (isValidGold(parsed)) {
        info(`[${source.name}] ✅ SUCCESS — g22=${parsed.gold.g22} g21=${parsed.gold.g21} g18=${parsed.gold.g18} gtr=${parsed.gold.gtr}`);
        return { ...parsed, source: source.name };
      }

      warn(`[${source.name}] Gold validation failed`);

    } catch (e) {
      warn(`[${source.name}] Error: ${e.message}`);
    }

    // Small pause between sources
    await new Promise(r => setTimeout(r, 1000));
  }

  error('All BAJUS sources failed');
  return null;
}

/* ─── CACHE FALLBACK ─── */
function getLastGoodBajus(goldHist, silverHist) {
  if (!goldHist.length || !silverHist.length) return null;
  const lg = goldHist[goldHist.length - 1];
  const ls = silverHist[silverHist.length - 1];
  if (!lg.bajus_g22) {
    // Walk back to find last non-null entry
    for (let i = goldHist.length - 1; i >= 0; i--) {
      if (goldHist[i].bajus_g22) {
        const age = Date.now() - new Date(goldHist[i].timestamp).getTime();
        if (age > CFG.CACHE_MAX_AGE_MS) { warn(`Cache too old (${Math.round(age/3600000)}h)`); return null; }
        info(`Reusing cache from ${goldHist[i].date} (${Math.round(age/3600000)}h ago)`);
        const ls2 = silverHist[i] || {};
        return {
          gold  : { g22:goldHist[i].bajus_g22, g21:goldHist[i].bajus_g21, g18:goldHist[i].bajus_g18, gtr:goldHist[i].bajus_gtr },
          silver: { s22:ls2.bajus_s22, s21:ls2.bajus_s21, s18:ls2.bajus_s18, str:ls2.bajus_str },
          raw   : `[cached from ${goldHist[i].date}]`, source: 'cache',
        };
      }
    }
    return null;
  }
  const age = Date.now() - new Date(lg.timestamp).getTime();
  if (age > CFG.CACHE_MAX_AGE_MS) { warn(`Cache too old (${Math.round(age/3600000)}h)`); return null; }
  info(`Reusing cache from ${lg.date} (${Math.round(age/3600000)}h ago)`);
  return {
    gold  : { g22:lg.bajus_g22, g21:lg.bajus_g21, g18:lg.bajus_g18, gtr:lg.bajus_gtr },
    silver: { s22:ls.bajus_s22, s21:ls.bajus_s21, s18:ls.bajus_s18, str:ls.bajus_str },
    raw   : `[cached from ${lg.date}]`, source: 'cache',
  };
}

/* ─── INTERNATIONAL PRICES ─── */
async function fetchInternational() {
  info('Fetching international prices…');
  const { default: fetch } = await import('node-fetch');
  const fetchJSON = async (url, label) => {
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': rndUA(), 'Accept': 'application/json' },
      });
      return await r.json();
    } catch (e) { error(`${label}: ${e.message}`); return null; }
  };

  const [gold, silver, fx] = await Promise.all([
    fetchJSON(CFG.INTL_GOLD_URL, 'XAU'),
    fetchJSON(CFG.INTL_SILVER_URL, 'XAG'),
    fetchJSON(CFG.FX_URL, 'FX'),
  ]);

  if (gold)   info(`XAU: $${gold.price}/oz`);
  if (silver) info(`XAG: $${silver.price}/oz`);
  if (fx)     info(`USD/BDT: ${fx?.rates?.BDT}`);

  const pick = (obj, ...keys) => {
    for (const k of keys) { const v = obj?.[k]; if (v != null && isFinite(+v)) return +v; }
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

/* ─── BUILD ENTRIES ─── */
function buildGoldEntry(bajus, now) {
  const g = bajus?.gold || {};
  return {
    date           : now.toISOString().slice(0, 10),
    timestamp      : now.toISOString(),
    data_source    : bajus?.source || null,
    bajus_g22      : g.g22 || null,
    bajus_g21      : g.g21 || null,
    bajus_g18      : g.g18 || null,
    bajus_gtr      : g.gtr || null,
    bajus_g22_vori : g.g22 ? Math.round(g.g22 * VORI) : null,
    bajus_g21_vori : g.g21 ? Math.round(g.g21 * VORI) : null,
    bajus_g18_vori : g.g18 ? Math.round(g.g18 * VORI) : null,
    bajus_gtr_vori : g.gtr ? Math.round(g.gtr * VORI) : null,
  };
}
function buildSilverEntry(bajus, now) {
  const s = bajus?.silver || {};
  return {
    date           : now.toISOString().slice(0, 10),
    timestamp      : now.toISOString(),
    data_source    : bajus?.source || null,
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
  const gBDT = intl.goldUSD   && intl.usdBdt ? +(intl.goldUSD   / OZ * intl.usdBdt).toFixed(2) : null;
  const sBDT = intl.silverUSD && intl.usdBdt ? +(intl.silverUSD / OZ * intl.usdBdt).toFixed(4) : null;
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
  if (!changed && CFG.STORE_ONLY_ON_CHANGE) { info(`${label}: no change — skipping`); return { stored: false, history }; }
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
  info('SonarGold Scraper v4.0 (Multi-Source BAJUS)');
  info(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'} | Source: ${onlySource || 'all'}`);
  info('══════════════════════════════════════════════');

  ensureDirs();
  const goldHist   = readJSON(CFG.GOLD_FILE,   []);
  const silverHist = readJSON(CFG.SILVER_FILE, []);
  const intlHist   = readJSON(CFG.INTL_FILE,   []);
  info(`History — gold:${goldHist.length} silver:${silverHist.length} intl:${intlHist.length}`);

  const now = new Date();
  let bajus = null;
  let intl  = {
    goldUSD: null, goldPrevUSD: null, goldChg: null, goldChgP: null,
    silverUSD: null, silverPrevUSD: null, silverChg: null, silverChgP: null,
    usdBdt: null,
  };

  if (!onlySource || onlySource === 'bajus') {
    bajus = await scrapeBajus();
    if (!bajus) {
      warn('All live sources failed — trying cache…');
      bajus = getLastGoodBajus(goldHist, silverHist);
      if (!bajus) error('No cache available either — BD prices will be null');
    }
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

  const gR = persist(goldEntry,   goldHist,   CFG.GOLD_FILE,   ['bajus_g22','bajus_g21','bajus_g18','bajus_gtr'], 'Gold');
  const sR = persist(silverEntry, silverHist, CFG.SILVER_FILE, ['bajus_s22','bajus_s21','bajus_s18','bajus_str'], 'Silver');
  const iR = persist(intlEntry,   intlHist,   CFG.INTL_FILE,   ['gold_usd_oz','silver_usd_oz','usd_bdt'],         'Intl');

  const latest = {
    generated_at  : now.toISOString(),
    bajus_date    : now.toLocaleDateString('en-US', {
      timeZone: 'Asia/Dhaka', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    }),
    bajus_ok      : bajus !== null && isValidGold(bajus) && bajus.source !== 'cache',
    bajus_cached  : bajus?.source === 'cache',
    bajus_source  : bajus?.source || null,
    intl_ok       : intlEntry.gold_usd_oz !== null,
    fx_ok         : intlEntry.usd_bdt !== null,
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
      intl_usd_oz     : intlEntry.silver_usd_oz,
      intl_prev_usd_oz: intlEntry.silver_prev_usd_oz,
      intl_chg_usd    : intlEntry.silver_chg_usd,
      intl_chg_pct    : intlEntry.silver_chg_pct,
      intl_gram_bdt   : intlEntry.silver_gram_bdt,
      usd_bdt         : intlEntry.usd_bdt,
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
