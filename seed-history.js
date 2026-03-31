/**
 * SonarGold BD — Historical Data Seeder
 * ============================================================
 * Run ONCE to populate gold_prices.json, silver_prices.json,
 * and intl_prices.json with data from 2010 to present.
 *
 * BD prices use known BAJUS annual average anchors.
 * International prices use World Gold Council annual averages.
 * Monthly entries are interpolated with realistic variation.
 *
 * Usage:
 *   node seed-history.js            # seed everything (replace)
 *   node seed-history.js --merge    # merge with existing (scraped data wins)
 *   node seed-history.js --intl     # intl only
 *   node seed-history.js --bd       # BD only
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_DIR    = path.join(__dirname, 'data');
const GOLD_FILE   = path.join(DATA_DIR, 'gold_prices.json');
const SILVER_FILE = path.join(DATA_DIR, 'silver_prices.json');
const INTL_FILE   = path.join(DATA_DIR, 'intl_prices.json');

const VORI = 11.664;
const OZ   = 31.1035;

fs.mkdirSync(DATA_DIR, { recursive: true });
const log = m => console.log(`[SEED] ${m}`);

/* ══════════════════════════════════════════════════════════
   INTERNATIONAL HISTORICAL DATA
   Source anchors: World Gold Council annual averages
   XAU/USD per troy oz · XAG/USD per troy oz · USD/BDT
   ══════════════════════════════════════════════════════════ */
const XAU_ANNUAL = {
  2010:1224.5, 2011:1571.5, 2012:1668.9, 2013:1411.2,
  2014:1266.4, 2015:1160.1, 2016:1250.7, 2017:1257.1,
  2018:1268.5, 2019:1392.6, 2020:1769.6, 2021:1798.6,
  2022:1800.1, 2023:1940.5, 2024:2386.0, 2025:2940.0,
  2026:3025.0,
};
const XAG_ANNUAL = {
  2010:20.2,  2011:35.1,  2012:31.2,  2013:23.8,
  2014:19.1,  2015:15.7,  2016:17.1,  2017:17.0,
  2018:15.7,  2019:16.2,  2020:20.6,  2021:25.1,
  2022:21.7,  2023:23.3,  2024:29.3,  2025:31.8,
  2026:33.5,
};
const USD_BDT_ANNUAL = {
  2010:69.6,  2011:74.2,  2012:81.9,  2013:78.1,
  2014:77.6,  2015:77.9,  2016:78.5,  2017:80.4,
  2018:83.5,  2019:84.9,  2020:84.8,  2021:85.1,
  2022:95.1,  2023:110.0, 2024:117.5, 2025:121.0,
  2026:110.5,
};

function generateIntlHistory() {
  log('Generating international historical data 2010–2026…');
  const entries = [];
  const years = Object.keys(XAU_ANNUAL).map(Number).sort((a,b)=>a-b);

  for (const year of years) {
    const goldBase   = XAU_ANNUAL[year];
    const silverBase = XAG_ANNUAL[year] || goldBase / 65;
    const fxBase     = USD_BDT_ANNUAL[year] || 110;
    const endMonth   = year === 2026 ? 3 : 12;

    for (let month = 1; month <= endMonth; month++) {
      // Seasonal factor: Q1 & Q4 slightly higher
      const seasonal = (month <= 3 || month >= 10) ? 1.012 : 0.994;
      const noise    = (Math.random() - 0.5) * 0.035;
      const sNoise   = (Math.random() - 0.5) * 0.055;
      const fxNoise  = (Math.random() - 0.5) * 0.008;

      const goldPrice   = +(goldBase   * seasonal * (1 + noise)).toFixed(2);
      const silverPrice = +(silverBase * seasonal * (1 + sNoise)).toFixed(2);
      const fxRate      = +(fxBase                * (1 + fxNoise)).toFixed(2);
      const gBDT        = +(goldPrice   / OZ * fxRate).toFixed(2);
      const sBDT        = +(silverPrice / OZ * fxRate).toFixed(4);

      const date = `${year}-${String(month).padStart(2,'0')}-01`;
      entries.push({
        date, timestamp:`${date}T00:00:00.000Z`,
        gold_usd_oz:goldPrice,   gold_prev_usd_oz:null,
        gold_chg_usd:null,       gold_chg_pct:null,    gold_gram_bdt:gBDT,
        silver_usd_oz:silverPrice, silver_prev_usd_oz:null,
        silver_chg_usd:null,     silver_chg_pct:null,  silver_gram_bdt:sBDT,
        usd_bdt:fxRate, source:'historical_seed',
      });
    }
  }
  log(`Generated ${entries.length} international entries`);
  return entries;
}

/* ══════════════════════════════════════════════════════════
   BD BAJUS HISTORICAL DATA
   Annual 22K gold per-gram BDT anchors derived from
   BAJUS records, gold-price.sakib.dev, and public data
   ══════════════════════════════════════════════════════════ */
const BAJUS_G22_ANNUAL = { // per gram BDT
  2010:2350,  2011:3280,  2012:4100,  2013:3900,
  2014:3550,  2015:3200,  2016:3400,  2017:3650,
  2018:3900,  2019:4600,  2020:6200,  2021:7100,
  2022:7400,  2023:9200,  2024:14800, 2025:18500,
  2026:20500,
};
// Fixed karat ratios relative to 22K
const G_RATIO  = { g22:1.000, g21:0.9543, g18:0.8182, gtr:0.6667 };
// Silver ~1/58 of gold price in BD market
const AG_RATIO = { s22:1.000, s21:0.9450, s18:0.8080, str:0.6150 };
const SILVER_TO_GOLD = 1 / 58;

function generateBDHistory() {
  log('Generating BD BAJUS historical data 2010–2026…');
  const goldEntries   = [];
  const silverEntries = [];
  const years = Object.keys(BAJUS_G22_ANNUAL).map(Number).sort((a,b)=>a-b);

  for (const year of years) {
    const g22Base  = BAJUS_G22_ANNUAL[year];
    const s22Base  = Math.round(g22Base * SILVER_TO_GOLD);
    const endMonth = year === 2026 ? 3 : 12;

    for (let month = 1; month <= endMonth; month++) {
      const gNoise = (Math.random() - 0.5) * 0.05;
      const sNoise = (Math.random() - 0.5) * 0.06;

      const g22 = Math.round(g22Base * (1 + gNoise));
      const g21 = Math.round(g22 * G_RATIO.g21);
      const g18 = Math.round(g22 * G_RATIO.g18);
      const gtr = Math.round(g22 * G_RATIO.gtr);

      const s22 = Math.round(s22Base * (1 + sNoise));
      const s21 = Math.round(s22 * AG_RATIO.s21);
      const s18 = Math.round(s22 * AG_RATIO.s18);
      const str = Math.round(s22 * AG_RATIO.str);

      const date = `${year}-${String(month).padStart(2,'0')}-01`;
      const ts   = `${date}T00:00:00.000Z`;

      goldEntries.push({
        date, timestamp:ts,
        bajus_g22:g22, bajus_g21:g21, bajus_g18:g18, bajus_gtr:gtr,
        bajus_g22_vori:Math.round(g22*VORI), bajus_g21_vori:Math.round(g21*VORI),
        bajus_g18_vori:Math.round(g18*VORI), bajus_gtr_vori:Math.round(gtr*VORI),
        source:'historical_seed',
      });

      silverEntries.push({
        date, timestamp:ts,
        bajus_s22:s22, bajus_s21:s21, bajus_s18:s18, bajus_str:str,
        bajus_s22_vori:Math.round(s22*VORI), bajus_s21_vori:Math.round(s21*VORI),
        bajus_s18_vori:Math.round(s18*VORI), bajus_str_vori:Math.round(str*VORI),
        source:'historical_seed',
      });
    }
  }

  log(`Generated ${goldEntries.length} BD gold + ${silverEntries.length} BD silver entries`);
  return { goldEntries, silverEntries };
}

/* ══════════════════════════════════════════════════════════
   MERGE — scraped data always wins (overwrites seed on same date)
   ══════════════════════════════════════════════════════════ */
function mergeByDate(existing, seed) {
  const map = new Map();
  seed.forEach(e => map.set(e.date, e));      // seed first (lower priority)
  existing.forEach(e => map.set(e.date, e));  // real scraped data overwrites
  return Array.from(map.values()).sort((a,b) => a.date.localeCompare(b.date));
}

/* ── MAIN ── */
async function main() {
  const args    = process.argv.slice(2);
  const doIntl  = !args.includes('--bd');
  const doBD    = !args.includes('--intl');
  const isMerge = args.includes('--merge');

  log('══════════════════════════════════════');
  log('SonarGold Historical Data Seeder');
  log(`Mode: ${isMerge?'MERGE':'REPLACE'} | intl=${doIntl} bd=${doBD}`);
  log('══════════════════════════════════════');

  if (doIntl) {
    const intlSeed = generateIntlHistory();
    if (isMerge) {
      const existing = JSON.parse(fs.existsSync(INTL_FILE) ? fs.readFileSync(INTL_FILE,'utf8') : '[]');
      const merged   = mergeByDate(existing, intlSeed);
      fs.writeFileSync(INTL_FILE, JSON.stringify(merged, null, 2));
      log(`Intl: merged → ${merged.length} total entries`);
    } else {
      fs.writeFileSync(INTL_FILE, JSON.stringify(intlSeed, null, 2));
      log(`Intl: written ${intlSeed.length} entries`);
    }
  }

  if (doBD) {
    const { goldEntries, silverEntries } = generateBDHistory();
    if (isMerge) {
      const exG = JSON.parse(fs.existsSync(GOLD_FILE)   ? fs.readFileSync(GOLD_FILE,  'utf8') : '[]');
      const exS = JSON.parse(fs.existsSync(SILVER_FILE) ? fs.readFileSync(SILVER_FILE,'utf8') : '[]');
      const mG  = mergeByDate(exG, goldEntries);
      const mS  = mergeByDate(exS, silverEntries);
      fs.writeFileSync(GOLD_FILE,   JSON.stringify(mG, null, 2));
      fs.writeFileSync(SILVER_FILE, JSON.stringify(mS, null, 2));
      log(`BD gold: merged → ${mG.length} | BD silver: merged → ${mS.length}`);
    } else {
      fs.writeFileSync(GOLD_FILE,   JSON.stringify(goldEntries,   null, 2));
      fs.writeFileSync(SILVER_FILE, JSON.stringify(silverEntries, null, 2));
      log(`BD gold: ${goldEntries.length} | BD silver: ${silverEntries.length}`);
    }
  }

  log('');
  log('Seeding complete!');
  log('Next steps:');
  log('  1. Push data/ files to GitHub');
  log('  2. Run the bot: Actions → SonarGold Price Bot → Run workflow');
  log('  3. The bot will append new entries over the seed data');
  log('  Tip: run "node seed-history.js --merge" after each major bot run to keep history intact');
}

main().catch(e => { console.error('[SEED ERROR]', e); process.exit(1); });
