/**
 * GoldRateLive — Shared App Logic v2.0
 * Enhanced with: mobile nav, scroll animations, intersection observer,
 * number counter animations, price flash effects, keyboard accessibility
 */
'use strict';

/* ═══ CONSTANTS ═══ */
const VORI = 11.664, OZ = 31.1035, KILO = 1000, ANA = VORI / 16;

const REPO_RAW = '.';
const DATA = {
  latest : `${REPO_RAW}/data/latest.json`,
  gold   : `${REPO_RAW}/data/gold_prices.json`,
  silver : `${REPO_RAW}/data/silver_prices.json`,
  intl   : `${REPO_RAW}/data/intl_prices.json`,
};

/* ═══ I18N ═══ */
const LANGS = {
  en: {
    nav_gold:'Gold', nav_silver:'Silver', nav_live:'Live Market',
    nav_compare:'Compare', nav_history:'History', nav_forecast:'Forecast', nav_calc:'Calculator',
    eyebrow:'BAJUS Official · Live International · Auto-Update',
    loading:'Loading…', awaiting:'Awaiting data', no_change:'No change',
    data_unavail:'Data unavailable', unavail:'Unavailable',
    bajus_ok_gold:'<strong>Note:</strong> Official BAJUS rates. Prices exclude 5% VAT and making charges (≈৳300/gram). 1 Vori = 11.664g = 1 Tola.',
    bajus_ok_silver:'<strong>Note:</strong> Official BAJUS silver rates. Prices exclude 5% VAT and making charges (≈৳26/gram). 1 Vori = 11.664g.',
    bajus_err:'<strong>⚠ BAJUS data not yet available.</strong> The bot runs every 4 hours. <a href="https://bajus.org/gold-price" target="_blank" rel="noopener" style="color:var(--gold)">Check bajus.org directly ↗</a>',
    silver_err:'<strong>⚠ Silver rates not found</strong> in fetched data.',
    prem_note:'<strong>Premium note:</strong> Positive = BD price higher than international (normal — import duty, VAT, BAJUS margin). <span style="color:var(--up);font-weight:600">Green = BD cheaper</span> · <span style="color:var(--dn);font-weight:600">Red = BD more expensive</span>',
    fc_disclaimer:'⚠ Forecasts use linear regression on historical BAJUS data. For informational purposes only — not financial advice.',
  },
  bn: {
    nav_gold:'সোনা', nav_silver:'রুপা', nav_live:'লাইভ বাজার',
    nav_compare:'তুলনা', nav_history:'ইতিহাস', nav_forecast:'পূর্বাস', nav_calc:'ক্যালকুলেটর',
    eyebrow:'বাজুস অফিশিয়াল · লাইভ আন্তর্জাতিক · ৪ ঘণ্টা আপডেট',
    loading:'লোড হচ্ছে…', awaiting:'তথ্যের অপেক্ষায়', no_change:'কোনো পরিবর্তন নেই',
    data_unavail:'তথ্য অনুপলব্ধ', unavail:'অনুপলব্ধ',
    bajus_ok_gold:'<strong>নোট:</strong> সরকারি বাজুস রেট। ৫% ভ্যাট ও তৈরি মজুরি (≈৳৩০০/গ্রাম) ছাড়া। ১ ভরি = ১১.৬৬৪ গ্রাম।',
    bajus_ok_silver:'<strong>নোট:</strong> সরকারি বাজুস রুপার রেট। ৫% ভ্যাট ও তৈরি মজুরি (≈৳২৬/গ্রাম) ছাড়া।',
    bajus_err:'<strong>⚠ বাজুস তথ্য এখনো পাওয়া যায়নি।</strong> বট প্রতি ৪ ঘণ্টায় চলে। <a href="https://bajus.org/gold-price" target="_blank" rel="noopener" style="color:var(--gold)">bajus.org দেখুন ↗</a>',
    silver_err:'<strong>⚠ রুপার দাম পাওয়া যায়নি।</strong>',
    prem_note:'<strong>প্রিমিয়াম নোট:</strong> ধনাত্মক = বাংলাদেশে দাম বেশি (স্বাভাবিক — আমদানি শুল্ক, ভ্যাট)। <span style="color:var(--up);font-weight:600">সবুজ = সস্তা</span> · <span style="color:var(--dn);font-weight:600">লাল = বেশি দাম</span>',
    fc_disclaimer:'⚠ পূর্বাস ঐতিহাসিক ডেটার উপর ভিত্তি করে। শুধুমাত্র তথ্যের জন্য — আর্থিক পরামর্শ নয়।',
  },
  ar: {
    nav_gold:'الذهب', nav_silver:'الفضة', nav_live:'السوق المباشر',
    nav_compare:'مقارنة', nav_history:'التاريخ', nav_forecast:'التوقعات', nav_calc:'حاسبة',
    eyebrow:'بيانات رسمية · أسعار دولية · تحديث كل 4 ساعات',
    loading:'جارٍ التحميل…', awaiting:'في انتظار البيانات', no_change:'لا تغيير',
    data_unavail:'البيانات غير متاحة', unavail:'غير متاح',
    bajus_ok_gold:'<strong>ملاحظة:</strong> أسعار BAJUS الرسمية. تستثني ضريبة القيمة المضافة 5% وأجور الصنعة.',
    bajus_ok_silver:'<strong>ملاحظة:</strong> أسعار فضة BAJUS الرسمية.',
    bajus_err:'<strong>⚠ بيانات BAJUS غير متوفرة.</strong> <a href="https://bajus.org/gold-price" target="_blank" rel="noopener" style="color:var(--gold)">تحقق من bajus.org ↗</a>',
    silver_err:'<strong>⚠ أسعار الفضة غير متوفرة.</strong>',
    prem_note:'<strong>ملاحظة العلاوة:</strong> إيجابي = سعر بنغلاديش أعلى.',
    fc_disclaimer:'⚠ التوقعات للأغراض المعلوماتية فقط.',
  },
  hi: {
    nav_gold:'सोना', nav_silver:'चाँदी', nav_live:'लाइव बाजार',
    nav_compare:'तुलना', nav_history:'इतिहास', nav_forecast:'पूर्वानुमान', nav_calc:'कैलकुलेटर',
    eyebrow:'BAJUS आधिकारिक · लाइव अंतरराष्ट्रीय · 4 घंटे अपडेट',
    loading:'लोड हो रहा है…', awaiting:'डेटा की प्रतीक्षा', no_change:'कोई बदलाव नहीं',
    data_unavail:'डेटा अनुपलब्ध', unavail:'अनुपलब्ध',
    bajus_ok_gold:'<strong>नोट:</strong> आधिकारिक BAJUS दरें। 5% VAT और बनाने का शुल्क (≈৳300/ग्राम) को छोड़कर।',
    bajus_ok_silver:'<strong>नोट:</strong> आधिकारिक BAJUS चाँदी दरें।',
    bajus_err:'<strong>⚠ BAJUS डेटा अभी उपलब्ध नहीं है।</strong> <a href="https://bajus.org/gold-price" target="_blank" rel="noopener" style="color:var(--gold)">bajus.org देखें ↗</a>',
    silver_err:'<strong>⚠ चाँदी की दरें उपलब्ध नहीं हैं।</strong>',
    prem_note:'<strong>प्रीमियम नोट:</strong> धनात्मक = बांग्लादेश में ज्यादा दाम।',
    fc_disclaimer:'⚠ पूर्वानुमान केवल सूचनात्मक उद्देश्यों के लिए हैं।',
  },
};

/* ═══ STATE ═══ */
const S = {
  lang: 'en',
  latest: null,
  goldHistory: [],
  silverHistory: [],
  intlHistory: [],
  goldUnit: 'vori',
  histPeriod: '30d',
  histMetal: 'gold',
  histDataset: 'bajus',
  histUnit: 'vori',
  histChart: null,
  forecastChart: null,
  tenDayGoldKarat: 'bajus_g22',
  tenDaySilverKarat: 'bajus_s22',
  nextRefresh: 0,
  prevGoldPrice: null,
  prevSilverPrice: null,
};

/* ═══ HELPERS ═══ */
const $ = id => document.getElementById(id);
const fmt  = n => Math.round(n).toLocaleString('en-BD');
const fmtD = (n, d=2) => Number(n).toLocaleString('en-US', { minimumFractionDigits:d, maximumFractionDigits:d });
function set(id, html) { const e=$(id); if(e) e.innerHTML = html; }
function txt(id, t)    { const e=$(id); if(e) e.textContent = t; }
function clz(id, ...c) { const e=$(id); if(e) e.className = c.join(' '); }
const isV = v => v !== null && v !== undefined && isFinite(+v) && +v > 0;
const fBDT = n => isV(n) ? '৳ ' + fmt(n) : '—';
const fUSD = n => isV(n) ? '$ ' + fmtD(n, 2) : '—';

function toUnit(pg, u) {
  if (!isV(pg)) return null;
  return { gram:pg, vori:pg*VORI, tola:pg*VORI, ana:pg*ANA, ounce:pg*OZ, kilo:pg*KILO }[u] || pg;
}
function unitLbl(u) { return { gram:'Gram', vori:'Vori', tola:'Tola', ana:'Ana', ounce:'Troy Oz', kilo:'Kilo' }[u] || u; }

function chgInfo(cur, prev) {
  if (!isV(cur) || !isV(prev) || +prev===0) return { c:'fl', t:'—' };
  const d = +cur - +prev, p = (d / +prev) * 100;
  if (Math.abs(d) < 0.1) return { c:'fl', t:T('no_change') };
  const s = d > 0 ? '+' : '';
  return { c: d>0 ? 'up' : 'dn', t:`${s}${fmt(d)} (${s}${fmtD(p,2)}%)` };
}

function setSt(name, ok, t) {
  const d = $('sd-' + name), e = $('st-' + name);
  if (d) d.className = 'sd ' + (ok ? 'dot-ok' : 'dot-warn');
  if (e) e.textContent = t;
}

function setNotice(id, type, html) {
  const e = $(id); if (!e) return;
  e.className = 'notice' + (type ? ' ' + type : '');
  e.innerHTML = html;
}

function T(k) { return (LANGS[S.lang] || LANGS.en)[k] || LANGS.en[k] || k; }

/* ═══ PRICE FLASH ANIMATION ═══ */
function flashPrice(el) {
  if (!el) return;
  el.classList.remove('price-updated');
  void el.offsetWidth; // reflow
  el.classList.add('price-updated');
}

/* ═══ NUMBER COUNTER ANIMATION ═══ */
function animateNumber(el, targetText, duration = 600) {
  if (!el || !targetText) return;
  const match = targetText.match(/[\d,]+/);
  if (!match) { el.textContent = targetText; return; }
  const target = parseInt(match[0].replace(/,/g,''), 10);
  if (isNaN(target)) { el.textContent = targetText; return; }
  const prefix = targetText.split(match[0])[0];
  const suffix = targetText.split(match[0])[1] || '';
  const start = Date.now();
  const startVal = target * 0.85;
  const step = () => {
    const elapsed = Date.now() - start;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = Math.round(startVal + (target - startVal) * ease);
    el.textContent = prefix + current.toLocaleString('en-BD') + suffix;
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = targetText;
  };
  requestAnimationFrame(step);
}

/* ═══ I18N ENGINE ═══ */
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const t = T(el.dataset.i18n);
    if (t) el.innerHTML = t;
  });
  document.documentElement.lang = S.lang;
  document.documentElement.dir  = S.lang === 'ar' ? 'rtl' : 'ltr';
  const lb = $('lang-btn');
  if (lb) lb.textContent = { en:'🌐 EN', bn:'🌐 বাংলা', ar:'🌐 عربي', hi:'🌐 हिन्दी' }[S.lang] || '🌐';
  document.querySelectorAll('.lang-opt').forEach(o => o.classList.toggle('active', o.dataset.lang === S.lang));
}

function detectLang() {
  const saved = localStorage.getItem('sg-lang');
  if (saved && LANGS[saved]) return saved;
  const nav = (navigator.language || 'en').toLowerCase();
  if (nav.startsWith('bn')) return 'bn';
  if (nav.startsWith('ar')) return 'ar';
  if (nav.startsWith('hi')) return 'hi';
  return 'en';
}

/* ═══ DATA LOAD ═══ */
async function loadLatest() {
  try {
    const r = await fetch(DATA.latest + '?t=' + Date.now(), { cache:'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    S.latest = await r.json();
    const ok = S.latest?.bajus_ok || false;
    const ts = S.latest?.generated_at;
    const dt = ts ? new Date(ts).toLocaleString('en-US', {
      timeZone:'Asia/Dhaka', month:'short', day:'numeric',
      hour:'2-digit', minute:'2-digit', hour12:true
    }) : '—';
    setSt('bajus', S.latest?.bajus_ok||false, S.latest?.bajus_ok ? `Live · Gold - ${fUSD(S.latest?.gold?.bajus_g22_vori)}/vori | Silver - ${fUSD(S.latest?.silver?.bajus_s22_vori)}/vori` : 'Not available');
    setSt('intl', S.latest?.intl_ok||false, S.latest?.intl_ok ? `Live · Gold - ${fUSD(S.latest?.gold?.intl_usd_oz)}/oz | Silver - ${fUSD(S.latest?.silver?.intl_usd_oz)}/oz` : 'Not available');
    setSt('fx',   S.latest?.fx_ok||false,   S.latest?.fx_ok   ? `1 USD = ৳${fmtD(S.latest?.gold?.usd_bdt,2)}` : 'Not available');
    txt('st-upd', dt);
    txt('upd-time', S.latest?.bajus_date || '—');
    return true;
  } catch (e) {
    setSt('bajus', false, 'File not found');
    setSt('intl', false, 'File not found');
    setSt('fx', false, 'File not found');
    console.warn('loadLatest:', e.message);
    return false;
  }
}

async function loadHistory() {
  try {
    const [gr, sr, ir] = await Promise.all([
      fetch(DATA.gold   + '?t=' + Date.now(), { cache:'no-cache' }),
      fetch(DATA.silver + '?t=' + Date.now(), { cache:'no-cache' }),
      fetch(DATA.intl   + '?t=' + Date.now(), { cache:'no-cache' }),
    ]);
    S.goldHistory   = gr.ok ? await gr.json() : [];
    S.silverHistory = sr.ok ? await sr.json() : [];
    S.intlHistory   = ir.ok ? await ir.json() : [];
  } catch (e) { console.warn('loadHistory:', e.message); }
}

/* ═══ RENDER: GOLD ═══ */
function renderGold() {
  const d = S.latest?.gold, ok = S.latest?.bajus_ok && isV(d?.bajus_g22);
  if (!ok) {
    setNotice('bajus-gold-notice', 'err', T('bajus_err'));
    ['22','21','18','tr'].forEach(k => {
      clz(`gp-${k}`, 'p-price na'); txt(`gp-${k}`, '—');
      clz(`gc-${k}`, 'p-chg na');   txt(`gc-${k}`, T('data_unavail'));
    });
    ['gram','vori','tola','ana','oz','kg'].forEach(k => { clz(`gv-${k}`, 'conv-val na'); txt(`gv-${k}`, '—'); });
    return;
  }
  setNotice('bajus-gold-notice', '', T('bajus_ok_gold'));
  const u = S.goldUnit;
  const prev = S.goldHistory.length > 1 ? S.goldHistory[S.goldHistory.length - 2] : null;
  const isFirstLoad = !S.prevGoldPrice;

  [['22','bajus_g22'],['21','bajus_g21'],['18','bajus_g18'],['tr','bajus_gtr']].forEach(([id, key]) => {
    const pg = d[key], pp = prev?.[key];
    const price = toUnit(pg, u), prevPrice = toUnit(pp || pg, u);
    clz(`gp-${id}`, 'p-price');
    const el = $(`gp-${id}`);
    const newText = '৳ ' + fmt(price);
    if (el && !isFirstLoad && el.textContent !== newText) {
      flashPrice(el);
      animateNumber(el, newText);
    } else if (el) {
      el.textContent = newText;
    }
    txt(`gu-${id}`, 'BDT / ' + unitLbl(u));
    const { c, t } = chgInfo(price, prevPrice);
    clz(`gc-${id}`, 'p-chg ' + c); txt(`gc-${id}`, t);
  });

  S.prevGoldPrice = d.bajus_g22;
  const pg = d.bajus_g22;
  [['gram',pg],['vori',pg*VORI],['tola',pg*VORI],['ana',pg*ANA],['oz',pg*OZ],['kg',pg*KILO]].forEach(([k,v]) => {
    clz(`gv-${k}`, 'conv-val'); txt(`gv-${k}`, '৳ ' + fmt(v));
  });
}

/* ═══ RENDER: SILVER ═══ */
function renderSilver() {
  const d = S.latest?.silver, ok = S.latest?.bajus_ok && isV(d?.bajus_s22);
  if (!ok) {
    setNotice('bajus-silver-notice', 'err', S.latest?.bajus_ok ? T('silver_err') : T('bajus_err'));
    ['22','21','18','tr'].forEach(k => {
      clz(`sp-${k}`, 'p-price na'); txt(`sp-${k}`, '—');
      clz(`sc-${k}`, 'p-chg na');   txt(`sc-${k}`, T('data_unavail'));
    });
    ['gram','vori','tola','oz','kg'].forEach(k => { clz(`sv-${k}`, 'conv-val na'); txt(`sv-${k}`, '—'); });
    return;
  }
  setNotice('bajus-silver-notice', '', T('bajus_ok_silver'));
  const prev = S.silverHistory.length > 1 ? S.silverHistory[S.silverHistory.length - 2] : null;
  const isFirstLoad = !S.prevSilverPrice;

  [['22','bajus_s22'],['21','bajus_s21'],['18','bajus_s18'],['tr','bajus_str']].forEach(([id, key]) => {
    const pg = d[key], pp = prev?.[key];
    const price = pg * VORI, prevPrice = (pp || pg) * VORI;
    clz(`sp-${id}`, 'p-price');
    const el = $(`sp-${id}`);
    const newText = '৳ ' + fmt(price);
    if (el && !isFirstLoad && el.textContent !== newText) {
      flashPrice(el);
      animateNumber(el, newText);
    } else if (el) {
      el.textContent = newText;
    }
    const { c, t } = chgInfo(price, prevPrice);
    clz(`sc-${id}`, 'p-chg ' + c); txt(`sc-${id}`, t);
  });

  S.prevSilverPrice = d.bajus_s22;
  const pg = d.bajus_s22;
  [['gram',pg],['vori',pg*VORI],['tola',pg*VORI],['oz',pg*OZ],['kg',pg*KILO]].forEach(([k,v]) => {
    clz(`sv-${k}`, 'conv-val'); txt(`sv-${k}`, '৳ ' + fmt(v));
  });
}

/* ═══ RENDER: LIVE INTERNATIONAL ═══ */
function renderLive() {
  const g = S.latest?.gold, sv = S.latest?.silver;
  const rate = g?.usd_bdt, gOk = isV(g?.intl_usd_oz), sOk = isV(sv?.intl_usd_oz), fOk = isV(rate);

  function fillKitco(m, priceUSD, prevUSD) {
    if (!isV(priceUSD)) {
      clz(`km-${m}-usd`, `km-usd ${m} na`); txt(`km-${m}-usd`, T('unavail'));
      ['oz','g','v','k'].forEach(k => { clz(`km-${m}-${k}-u`,'km-rv na'); txt(`km-${m}-${k}-u`,'—'); clz(`km-${m}-${k}-b`,'km-rb na'); txt(`km-${m}-${k}-b`,'—'); });
      clz(`km-${m}-chg`, 'km-chg na'); txt(`km-${m}-chg`, '—');
      clz(`lc-${m}-usd`, 'lc-val na'); txt(`lc-${m}-usd`, '—');
      clz(`lc-${m}-bdt`, 'lc-sub na'); txt(`lc-${m}-bdt`, '—');
      return;
    }
    const gg = +priceUSD / OZ;
    clz(`km-${m}-usd`, `km-usd ${m}`);
    txt(`km-${m}-usd`, '$ ' + fmtD(+priceUSD, 2));
    const rows = { oz:+priceUSD, g:gg, v:gg*VORI, k:gg*KILO };
    Object.entries(rows).forEach(([k,u]) => {
      clz(`km-${m}-${k}-u`, 'km-rv'); txt(`km-${m}-${k}-u`, fUSD(u));
      if (fOk) { clz(`km-${m}-${k}-b`, 'km-rb'); txt(`km-${m}-${k}-b`, fBDT(u * rate)); }
      else { clz(`km-${m}-${k}-b`, 'km-rb na'); txt(`km-${m}-${k}-b`, '—'); }
    });
    const { c, t } = chgInfo(priceUSD, prevUSD);
    clz(`km-${m}-chg`, 'km-chg ' + c); txt(`km-${m}-chg`, t);
    clz(`lc-${m}-usd`, 'lc-val'); txt(`lc-${m}-usd`, '$ ' + fmtD(+priceUSD, 2));
    if (fOk) { clz(`lc-${m}-bdt`, 'lc-sub'); txt(`lc-${m}-bdt`, '≈ ৳' + fmt(+priceUSD * rate) + ' / oz'); }
    else { clz(`lc-${m}-bdt`, 'lc-sub na'); txt(`lc-${m}-bdt`, '—'); }
  }

  fillKitco('g', g?.intl_usd_oz, g?.intl_prev_usd_oz);
  fillKitco('s', sv?.intl_usd_oz, sv?.intl_prev_usd_oz);

  if (fOk) { clz('lc-usd','lc-val'); txt('lc-usd','৳ '+fmtD(rate,2)); clz('lc-usd-src','lc-sub'); txt('lc-usd-src','open.er-api.com'); }
  else     { clz('lc-usd','lc-val na'); txt('lc-usd','—'); clz('lc-usd-src','lc-sub na'); txt('lc-usd-src','—'); }

  if (gOk && sOk) {
    const ratio = +g.intl_usd_oz / +sv.intl_usd_oz;
    clz('lc-ratio','lc-val'); txt('lc-ratio', fmtD(ratio,1) + '×');
    clz('lc-ratio-note','lc-sub');
    txt('lc-ratio-note', ratio>80 ? 'Silver historically cheap' : ratio<50 ? 'Silver historically rich' : 'Near historical avg (~65×)');
  } else {
    clz('lc-ratio','lc-val na'); txt('lc-ratio','—');
    clz('lc-ratio-note','lc-sub na'); txt('lc-ratio-note','—');
  }
}

/* ═══ RENDER: COMPARE TABLE ═══ */
function renderCompare() {
  const g = S.latest?.gold, sv = S.latest?.silver, rate = g?.usd_bdt;
  const intlGg = isV(g?.intl_usd_oz)  && isV(rate) ? (+g.intl_usd_oz  / OZ) * rate : null;
  const intlSg = isV(sv?.intl_usd_oz) && isV(rate) ? (+sv.intl_usd_oz / OZ) * rate : null;

  function buildRows(data, rows, intlBase, spotusd) {
    return rows.map(r => {
      const bdg = data?.[r.k], bdgOk = isV(bdg);
      const bv = bdgOk ? `৳ ${fmt(+bdg * VORI)}` : `<span class="c-na">—</span>`;
      const bg = bdgOk ? `৳ ${fmt(+bdg)}`         : `<span class="c-na">—</span>`;
      const iu = isV(spotusd) ? `$ ${fmtD(spotusd * r.p, 2)}` : `<span class="c-na">—</span>`;
      let ib = '<span class="c-na">—</span>', ph = '<span class="c-na">—</span>';
      if (isV(intlBase)) {
        const ie = intlBase * r.p; ib = `৳ ${fmt(ie)}`;
        if (bdgOk) { const pr = ((+bdg - ie) / ie) * 100; ph = `<span class="prem ${pr>=0?'pos':'neg'}">${(pr>=0?'+':'')+fmtD(pr,1)}%</span>`; }
      }
      return `<tr><td><span class="badge ${r.b}">${r.l}</span></td><td class="c-bdt">${bv}</td><td class="c-bdt">${bg}</td><td class="c-usd">${iu}</td><td class="c-bdt">${ib}</td><td>${ph}</td></tr>`;
    }).join('');
  }

  const gc = $('gold-cmp');
  if (gc) gc.innerHTML = buildRows(g, [
    {l:'22K Standard',  k:'bajus_g22', p:22/24, b:'b22'},
    {l:'21K Hallmark',  k:'bajus_g21', p:21/24, b:'b21'},
    {l:'18K / Diamond', k:'bajus_g18', p:18/24, b:'b18'},
    {l:'Traditional',   k:'bajus_gtr', p:.60,   b:'btr'},
  ], intlGg, g?.intl_usd_oz);

  const sc = $('silver-cmp');
  if (sc) sc.innerHTML = buildRows(sv, [
    {l:'22K Standard', k:'bajus_s22', p:.916, b:'b22'},
    {l:'21K Hallmark', k:'bajus_s21', p:.875, b:'b21'},
    {l:'18K',          k:'bajus_s18', p:.750, b:'b18'},
    {l:'Traditional',  k:'bajus_str', p:.600, b:'btr'},
  ], intlSg, sv?.intl_usd_oz);

  const pn = $('prem-note'); if (pn) pn.innerHTML = T('prem_note');
}

/* ═══ RENDER: 10-DAY TABLE ═══ */
function renderTenDay(metal, karatKey) {
  const hist    = metal === 'gold' ? S.goldHistory : S.silverHistory;
  const tbodyId = metal === 'gold' ? 'ten-day-gold-tbody' : 'ten-day-silver-tbody';
  const tb = $(tbodyId); if (!tb) return;
  if (!hist.length) {
    tb.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--txt3);padding:1.5rem;">No historical data yet — run the bot or seed-history.js first</td></tr>';
    return;
  }
  const last10 = [...hist].slice(-10).reverse();
  const todayDate = last10[0]?.date || '';
  tb.innerHTML = last10.map((e, i) => {
    const vPg = e[karatKey] || 0;
    const pPg = (i < last10.length - 1 ? last10[i + 1][karatKey] : vPg) || vPg;
    const vori = Math.round(vPg * VORI);
    const chg  = vPg - pPg, chgPct = pPg ? (chg / pPg) * 100 : 0;
    const cc = Math.abs(chg) < 0.1 ? 'fl' : chg < 0 ? 'up' : 'dn';
    const isToday = e.date === todayDate && i === 0;
    return `<tr${isToday ? ' class="tr-today"' : ''}>
      <td>${e.date || '—'}${isToday ? ' <span style="font-size:9.5px;color:var(--gold);margin-left:6px;font-weight:700;letter-spacing:.5px;">TODAY</span>' : ''}</td>
      <td>${vPg ? fmt(vPg) : '—'}</td>
      <td>${vori ? fmt(vori) : '—'}</td>
      <td class="chg ${i < last10.length-1 ? cc : 'fl'}">${i < last10.length-1 ? (chg >= 0 ? '+' : '') + fmt(chg) : '—'}</td>
      <td class="chg ${i < last10.length-1 ? cc : 'fl'}">${i < last10.length-1 ? (chg >= 0 ? '+' : '') + fmtD(chgPct, 2) + '%' : '—'}</td>
    </tr>`;
  }).join('');
}

/* ═══ RENDER: AVERAGES ═══ */
function renderAverages(metal) {
  const hist = metal === 'silver' ? S.silverHistory : S.goldHistory;
  const key  = metal === 'silver' ? 'bajus_s22' : 'bajus_g22';
  const pfx  = metal === 'silver' ? 'avg-silver' : 'avg-gold';
  const ids  = ['today','7d','30d','7d-hi','7d-lo','30d-chg'];
  if (!hist.length) { ids.forEach(k => txt(`${pfx}-${k}`, '—')); return; }

  const now = Date.now();
  const r7  = hist.filter(e => new Date(e.timestamp||e.date).getTime() >= now - 7  * 86400000);
  const r30 = hist.filter(e => new Date(e.timestamp||e.date).getTime() >= now - 30 * 86400000);
  const cur  = +hist[hist.length - 1]?.[key] || 0;
  const a7   = r7.length  ? r7.reduce( (s,e) => s + (+e[key]||0), 0) / r7.length  : 0;
  const a30  = r30.length ? r30.reduce((s,e) => s + (+e[key]||0), 0) / r30.length : 0;
  const hi7  = r7.length  ? Math.max(...r7.map(e => +e[key]||0))  : 0;
  const lo7  = r7.length  ? Math.min(...r7.filter(e=>e[key]).map(e => +e[key])) : 0;
  const old30 = r30.length ? +r30[0]?.[key] : 0;
  const chg30 = old30 ? ((cur - old30) / old30) * 100 : 0;

  txt(`${pfx}-today`,   cur  ? '৳ ' + fmt(cur)  : '—');
  txt(`${pfx}-7d`,      a7   ? '৳ ' + fmt(a7)   : '—');
  txt(`${pfx}-30d`,     a30  ? '৳ ' + fmt(a30)  : '—');
  txt(`${pfx}-7d-hi`,   hi7  ? '৳ ' + fmt(hi7)  : '—');
  txt(`${pfx}-7d-lo`,   lo7  ? '৳ ' + fmt(lo7)  : '—');
  const ce = $(`${pfx}-30d-chg`);
  if (ce) {
    ce.textContent = old30 ? (chg30 >= 0 ? '+' : '') + fmtD(chg30, 2) + '%' : '—';
    ce.style.color = chg30 > 0 ? 'var(--dn)' : chg30 < 0 ? 'var(--up)' : 'var(--txt)';
  }
}

/* ═══ RENDER: INSIGHTS ═══ */
function renderInsights() {
  const g = S.latest?.gold, sv = S.latest?.silver;
  const now = Date.now(), d30 = now - 30 * 86400000;
  const rg = S.goldHistory.filter(e => new Date(e.timestamp||e.date).getTime() >= d30);
  const rs = S.silverHistory.filter(e => new Date(e.timestamp||e.date).getTime() >= d30);
  const ri = S.intlHistory.filter(e => new Date(e.timestamp||e.date).getTime() >= d30);

  function setInsight(valId, trendId, val, trendClass, trendHtml) {
    txt(valId, val);
    const te = $(trendId);
    if (te) { te.className = 'ins-trend ' + trendClass; te.innerHTML = trendHtml; }
  }

  if (rg.length >= 2) {
    const f = +rg[0].bajus_g22, l = +rg[rg.length-1].bajus_g22;
    const m = f ? ((l-f)/f*100) : 0;
    setInsight('ins-gold-mom', 'ins-gold-mom-trend',
      (m>=0?'+':'')+fmtD(m,2)+'%',
      m>2?'fc-up':m<-2?'fc-dn':'fc-fl',
      `<i class="fas fa-arrow-${m>2?'up':m<-2?'down':'right'}"></i> ${m>2?'Rising':m<-2?'Falling':'Stable'}`
    );
  }

  if (rs.length >= 2) {
    const f = +rs[0].bajus_s22, l = +rs[rs.length-1].bajus_s22;
    const m = f ? ((l-f)/f*100) : 0;
    setInsight('ins-silver-mom', 'ins-silver-mom-trend',
      (m>=0?'+':'')+fmtD(m,2)+'%',
      m>2?'fc-up':m<-2?'fc-dn':'fc-fl',
      `<i class="fas fa-arrow-${m>2?'up':m<-2?'down':'right'}"></i> ${m>2?'Rising':m<-2?'Falling':'Stable'}`
    );
  }

  const gUSD = g?.intl_usd_oz, sUSD = sv?.intl_usd_oz;
  if (isV(gUSD) && isV(sUSD)) {
    const ratio = +gUSD / +sUSD;
    setInsight('ins-ratio', 'ins-ratio-note',
      fmtD(ratio,1)+'×',
      ratio>80?'fc-dn':ratio<50?'fc-up':'fc-fl',
      ratio>80?'Silver undervalued':ratio<50?'Silver overvalued':'Near historical avg'
    );
  }

  const rate = g?.usd_bdt, bdg22 = g?.bajus_g22;
  const intlGg = isV(gUSD) && isV(rate) ? (+gUSD / OZ) * rate : null;
  if (isV(bdg22) && isV(intlGg)) {
    const prem = ((+bdg22 - intlGg) / intlGg) * 100;
    setInsight('ins-bd-prem', 'ins-bd-prem-note',
      (prem>=0?'+':'')+fmtD(prem,1)+'%',
      prem>20?'fc-dn':'fc-fl',
      prem>20?'High premium':'Normal range'
    );
  }

  if (S.goldHistory.length >= 14) {
    const dayAvg = {};
    S.goldHistory.slice(-90).forEach(e => {
      if (!e.bajus_g22) return;
      const d = new Date(e.date || e.timestamp).getDay();
      if (!dayAvg[d]) dayAvg[d] = { sum:0, cnt:0 };
      dayAvg[d].sum += +e.bajus_g22; dayAvg[d].cnt++;
    });
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const best = Object.entries(dayAvg).reduce((a, [d,v]) =>
      (!a || v.sum/v.cnt < a.avg) ? { day:+d, avg:v.sum/v.cnt } : a, null);
    if (best) setInsight('ins-best-day', 'ins-best-day-note',
      days[best.day], 'fc-up', `<i class="fas fa-thumbs-up"></i> Avg ৳${fmt(best.avg)}/g`);
  }

  if (ri.length >= 2) {
    const f = +ri[0].usd_bdt, l = +ri[ri.length-1].usd_bdt;
    const chg = f ? ((l-f)/f*100) : 0;
    setInsight('ins-fx-trend', 'ins-fx-note',
      fmtD(l,2)+' ৳',
      chg>1?'fc-dn':chg<-1?'fc-up':'fc-fl',
      `${chg>=0?'+':''}${fmtD(chg,2)}% vs 30d ago`
    );
  }
}

/* ═══ RENDER: HISTORY CHART ═══ */
function renderHistory() {
  const now = Date.now();
  const cutoffs = { '7d':7, '30d':30, '90d':90, '1y':365, '3y':1095, 'all':9999 };
  const days = cutoffs[S.histPeriod] || 30;
  const cutoff = now - days * 86400000;
  const filt = arr => arr.filter(e => new Date(e.timestamp||e.date).getTime() >= cutoff);
  const gF = filt(S.goldHistory), sF = filt(S.silverHistory), iF = filt(S.intlHistory);

  const canvas = $('hist-chart'); if (!canvas) return;
  const srcG = S.histDataset === 'bajus' ? gF : iF;
  const srcS = S.histDataset === 'bajus' ? sF : iF;

  if (!srcG.length && !srcS.length) {
    const ctx = canvas.getContext('2d');
    if (S.histChart) { S.histChart.destroy(); S.histChart = null; }
    ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
    ctx.fillStyle='rgba(90,106,122,.5)';
    ctx.font='14px DM Sans,system-ui,sans-serif';
    ctx.textAlign='center';
    ctx.fillText('No data yet — run seed-history.js first', ctx.canvas.width/2, ctx.canvas.height/2);
    return;
  }

  const getVal = (e, metal, ds, unit) => {
    if (ds === 'bajus') {
      const k = metal === 'silver'
        ? (unit === 'vori' ? 'bajus_s22_vori' : 'bajus_s22')
        : (unit === 'vori' ? 'bajus_g22_vori' : 'bajus_g22');
      return isV(e[k]) ? +e[k] : null;
    } else {
      const v = metal === 'silver' ? e.silver_usd_oz : e.gold_usd_oz;
      if (!isV(v)) return null;
      return unit === 'gram' ? +(+v / OZ).toFixed(3) : +v;
    }
  };

  const mkDS = (arr, metal, border, bg, label) => ({
    label, data: arr.map(e => getVal(e, metal, S.histDataset, S.histUnit)),
    borderColor: border, backgroundColor: bg,
    borderWidth: 1.8, fill: true, tension: .4, pointRadius: 0, pointHoverRadius: 5,
  });

  const datasets = [];
  if (S.histMetal !== 'silver' && srcG.length) datasets.push(mkDS(srcG,'gold','rgba(201,168,76,.85)','rgba(201,168,76,.06)','Gold 22K'));
  if (S.histMetal !== 'gold'   && srcS.length) datasets.push(mkDS(srcS,'silver','rgba(155,170,181,.75)','rgba(155,170,181,.05)','Silver 22K'));
  if (!datasets.length) return;

  const base   = srcG.length ? srcG : srcS;
  const labels = base.map(e => e.date || (e.timestamp||'').slice(0,10));
  const isBDT  = S.histDataset === 'bajus';
  const ctx    = canvas.getContext('2d');
  if (S.histChart) S.histChart.destroy();

  S.histChart = new Chart(ctx, {
    type: 'line', data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: {
          display: S.histMetal === 'both',
          labels: { color:'rgba(168,178,192,.55)', font:{ family:'DM Sans,system-ui,sans-serif', size:11 }, boxWidth:10, padding:12 }
        },
        tooltip: {
          backgroundColor:'rgba(9,12,22,.97)', borderColor:'rgba(201,168,76,.2)', borderWidth:.5,
          titleColor:'rgba(168,178,192,.45)', bodyColor:'#EDE9E0',
          titleFont:{ family:'DM Sans,system-ui,sans-serif', size:10 },
          bodyFont:{ family:'Cormorant Garamond,Georgia,serif', size:15 }, padding:12,
          callbacks: { label: c => ` ${isBDT?'৳':'$'}${fmtD(c.parsed.y, isBDT?0:2)} ${isBDT?(S.histUnit==='vori'?'/Vori':'/Gram'):(S.histUnit==='gram'?'/gram':'/oz')}` }
        }
      },
      scales: {
        x: { grid:{ color:'rgba(255,255,255,.03)', drawBorder:false }, ticks:{ color:'rgba(90,106,122,.8)', font:{ family:'DM Sans,system-ui,sans-serif', size:10 }, maxTicksLimit:8 }, border:{ display:false } },
        y: { grid:{ color:'rgba(255,255,255,.03)', drawBorder:false }, ticks:{ color:'rgba(90,106,122,.8)', font:{ family:'DM Sans,system-ui,sans-serif', size:10 }, callback: v => (isBDT?'৳':'$') + fmtD(v, isBDT?0:2) }, border:{ display:false } }
      }
    }
  });
  const hm = $('hist-meta');
  if (hm) hm.textContent = `${base.length} data points · ${days===9999?'All time':days+'d'} · ${isBDT?'BAJUS BDT':'International USD'}`;
}

/* ═══ RENDER: FORECAST ═══ */
function renderForecast() {
  function linearReg(hist, key, nFwd) {
    const pts = hist.filter(e => e[key]).slice(-30);
    if (pts.length < 5) return { pts, nextVals:[], slope:0, r2:0, cur:0 };
    const n = pts.length;
    const xs = pts.map((_,i) => i), ys = pts.map(e => +e[key]);
    const xm = xs.reduce((a,b)=>a+b,0)/n, ym = ys.reduce((a,b)=>a+b,0)/n;
    const ssxy = xs.reduce((a,x,i) => a+(x-xm)*(ys[i]-ym), 0);
    const ssxx = xs.reduce((a,x)   => a+(x-xm)**2, 0);
    const slope = ssxx ? ssxy/ssxx : 0;
    const intcp = ym - slope * xm;
    const yhat  = xs.map(x => slope*x+intcp);
    const sst   = ys.reduce((a,y)=>a+(y-ym)**2,0);
    const sse   = ys.reduce((a,y,i)=>a+(y-yhat[i])**2,0);
    const r2    = sst ? 1 - sse/sst : 0;
    const nextVals = Array.from({ length:nFwd }, (_,i) => Math.max(0, slope*(n+i)+intcp));
    return { pts, nextVals, slope, r2, cur: ys[n-1] };
  }

  const gFc = linearReg(S.goldHistory,   'bajus_g22', 7);
  const sFc = linearReg(S.silverHistory, 'bajus_s22', 7);

  function fillCard(pfx, fc, unit) {
    const cur  = fc.cur, next = fc.nextVals?.[6] || cur;
    const chg  = cur ? ((next - cur) / cur * 100) : 0;
    const disp = unit === 'vori' ? next * VORI : next;
    txt(`fc-${pfx}-val`, next ? '৳ ' + fmt(disp) + (unit==='vori'?' /vori':' /gram') : '—');
    txt(`fc-${pfx}-desc`, cur
      ? `Current 22K: ৳${fmt(cur)}/g. Slope: ${fmtD(fc.slope,1)} ৳/day over ${fc.pts.length} days. R²=${fmtD(fc.r2,2)} (confidence: ${fc.r2>.7?'high':fc.r2>.4?'moderate':'low'}).`
      : 'Insufficient data — need at least 5 data points.');
    const te = $(`fc-${pfx}-trend`);
    if (te) {
      te.className = 'fc-trend ' + (chg>1?'fc-up':chg<-1?'fc-dn':'fc-fl');
      te.innerHTML = `<i class="fas fa-arrow-${chg>1?'up':chg<-1?'down':'right'}"></i> ${(chg>=0?'+':'')+fmtD(chg,2)}% projected over 7 days`;
    }
  }

  fillCard('gold',   gFc, 'vori');
  fillCard('silver', sFc, 'vori');

  const fcCanvas = $('forecast-chart'); if (!fcCanvas) return;
  if (gFc.pts.length < 5 && sFc.pts.length < 5) return;

  const ctx = fcCanvas.getContext('2d');
  if (S.forecastChart) S.forecastChart.destroy();

  const gHist  = gFc.pts.map(e => +(+e.bajus_g22 * VORI).toFixed(0));
  const sHist  = sFc.pts.map(e => +(+e.bajus_s22 * VORI).toFixed(0));
  const gFwd   = [...Array(gFc.pts.length).fill(null), ...(gFc.nextVals||[]).map(v => +(v*VORI).toFixed(0))];
  const sFwd   = [...Array(sFc.pts.length).fill(null), ...(sFc.nextVals||[]).map(v => +(v*VORI).toFixed(0))];
  const histLbls = gFc.pts.map(e => e.date || '');
  const fwdLbls  = Array.from({ length:7 }, (_,i) => { const d=new Date(); d.setDate(d.getDate()+i+1); return d.toISOString().slice(0,10); });
  const allLbls  = [...histLbls, ...fwdLbls];

  S.forecastChart = new Chart(ctx, {
    type: 'line',
    data: { labels: allLbls, datasets: [
      { label:'Gold 22K (Historical)', data:[...gHist,...Array(7).fill(null)], borderColor:'rgba(201,168,76,.9)', backgroundColor:'rgba(201,168,76,.07)', borderWidth:1.8, tension:.4, fill:true, pointRadius:0 },
      { label:'Gold 22K (Forecast)',   data:gFwd, borderColor:'rgba(201,168,76,.45)', backgroundColor:'transparent', borderWidth:1.8, borderDash:[5,5], tension:.4, pointRadius:3, pointBackgroundColor:'rgba(201,168,76,.7)' },
      { label:'Silver 22K (Historical)', data:[...sHist,...Array(7).fill(null)], borderColor:'rgba(155,170,181,.8)', backgroundColor:'rgba(155,170,181,.05)', borderWidth:1.8, tension:.4, fill:true, pointRadius:0 },
      { label:'Silver 22K (Forecast)', data:sFwd, borderColor:'rgba(155,170,181,.4)', backgroundColor:'transparent', borderWidth:1.8, borderDash:[5,5], tension:.4, pointRadius:3, pointBackgroundColor:'rgba(155,170,181,.6)' },
    ]},
    options: {
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins: {
        legend: { labels:{ color:'rgba(168,178,192,.5)', font:{ family:'DM Sans,system-ui,sans-serif', size:11 }, boxWidth:10, padding:10 } },
        tooltip: { backgroundColor:'rgba(9,12,22,.97)', borderColor:'rgba(201,168,76,.2)', borderWidth:.5, titleColor:'rgba(168,178,192,.4)', bodyColor:'#EDE9E0', padding:11, callbacks:{ label:c=>` ৳${fmt(c.parsed.y)} /vori` } }
      },
      scales: {
        x: { grid:{ color:'rgba(255,255,255,.03)', drawBorder:false }, ticks:{ color:'rgba(90,106,122,.8)', font:{ family:'DM Sans,system-ui,sans-serif', size:10 }, maxTicksLimit:8 }, border:{ display:false } },
        y: { grid:{ color:'rgba(255,255,255,.03)', drawBorder:false }, ticks:{ color:'rgba(90,106,122,.8)', font:{ family:'DM Sans,system-ui,sans-serif', size:10 }, callback: v => '৳'+fmt(v) }, border:{ display:false } }
      }
    }
  });
}

/* ═══ RENDER: TICKER ═══ */
function renderTicker() {
  const g = S.latest?.gold, sv = S.latest?.silver;
  const items = [];
  if (isV(g?.bajus_g22)) {
    const prev = S.goldHistory.length > 1 ? S.goldHistory[S.goldHistory.length-2] : null;
    items.push({ n:'Gold 22K/Vori', v:'৳ '+fmt(+g.bajus_g22*VORI), chg:chgInfo(+g.bajus_g22*VORI, prev?.bajus_g22_vori) });
    items.push({ n:'Gold 21K/Vori', v:'৳ '+fmt(+g.bajus_g21*VORI), chg:{c:'fl',t:''} });
    items.push({ n:'Gold 18K/Gram', v:'৳ '+fmt(+g.bajus_g18),       chg:{c:'fl',t:''} });
    items.push({ n:'Gold Trad/Vori',v:'৳ '+fmt(+g.bajus_gtr*VORI),  chg:{c:'fl',t:''} });
  }
  if (isV(sv?.bajus_s22)) {
    const prev = S.silverHistory.length > 1 ? S.silverHistory[S.silverHistory.length-2] : null;
    items.push({ n:'Silver 22K/Vori', v:'৳ '+fmt(+sv.bajus_s22*VORI), chg:chgInfo(+sv.bajus_s22*VORI, prev?.bajus_s22_vori) });
    items.push({ n:'Silver 21K/Gram', v:'৳ '+fmt(+sv.bajus_s21),       chg:{c:'fl',t:''} });
  }
  if (isV(g?.intl_usd_oz))  items.push({ n:'Gold XAU/oz',   v:'$ '+fmtD(+g.intl_usd_oz,2),   chg:{c:'fl',t:''} });
  if (isV(sv?.intl_usd_oz)) items.push({ n:'Silver XAG/oz', v:'$ '+fmtD(+sv.intl_usd_oz,2),  chg:{c:'fl',t:''} });
  if (isV(g?.usd_bdt))      items.push({ n:'USD/BDT',       v:'৳ '+fmtD(+g.usd_bdt,2),        chg:{c:'fl',t:''} });

  if (!items.length) { const tk=$('ticker'); if(tk) tk.innerHTML='<div class="ti"><span class="tn">Loading live prices…</span></div>'; return; }
  const all = [...items, ...items];
  const tk = $('ticker');
  if (tk) tk.innerHTML = all.map(i =>
    `<div class="ti"><span class="tn">${i.n}</span><span class="tv">${i.v}</span>${i.chg.t ? `<span class="tc ${i.chg.c}">${i.chg.t}</span>` : ''}</div>`
  ).join('');
}

/* ═══ CALCULATOR ═══ */
function calculate() {
  const wt = parseFloat($('c-wt').value), unit = $('c-unit').value, karat = $('c-karat').value;
  if (!wt || wt <= 0) { showToast('⚠ Enter a valid weight.'); return; }
  let grams = wt;
  if (unit === 'vori' || unit === 'tola') grams = wt * VORI;
  else if (unit === 'ounce') grams = wt * OZ;
  else if (unit === 'ana')   grams = wt * ANA;
  const g = S.latest?.gold, sv = S.latest?.silver;
  const pgMap = { g22:g?.bajus_g22, g21:g?.bajus_g21, g18:g?.bajus_g18, gtr:g?.bajus_gtr, s22:sv?.bajus_s22, s21:sv?.bajus_s21, s18:sv?.bajus_s18, str:sv?.bajus_str };
  const pg = pgMap[karat];
  if (!isV(pg)) { showToast('⚠ Price unavailable for this karat.'); return; }
  const isGold = karat.startsWith('g'), mpg = isGold ? 300 : 26;
  const val = grams * +pg, vat = val * 1.05, make = vat + grams * mpg;
  const metalLabel = {g22:'Gold 22K',g21:'Gold 21K',g18:'Gold 18K',gtr:'Gold Traditional',s22:'Silver 22K',s21:'Silver 21K',s18:'Silver 18K',str:'Silver Traditional'}[karat] || karat;
  txt('c-lbl', `${wt} ${unit} of ${metalLabel} (≈${grams.toFixed(3)}g)`);
  set('c-val', '৳ ' + fmt(val));
  txt('c-vat',  '৳ ' + fmt(vat));
  txt('c-make', '৳ ' + fmt(make));
  txt('c-make-note', `(+5% VAT + ৳${mpg}/g making charge)`);
  const res = $('calc-res');
  if (res) res.classList.add('show');
}

/* ═══ TOAST ═══ */
let _tt = null;
function showToast(msg) {
  let t = document.getElementById('sg-toast');
  if (!t) {
    t = document.createElement('div'); t.id = 'sg-toast';
    Object.assign(t.style, {
      position:'fixed', bottom:'1.5rem', left:'50%', transform:'translateX(-50%)',
      zIndex:'9999', background:'var(--bg3)',
      border:'.5px solid var(--line2)', borderRadius:'10px',
      padding:'.75rem 1.35rem', fontSize:'13.5px', color:'var(--txt2)',
      boxShadow:'0 4px 30px rgba(0,0,0,.45)', fontFamily:'DM Sans,system-ui,sans-serif',
      whiteSpace:'nowrap', transition:'opacity .3s', backdropFilter:'blur(12px)',
    });
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.opacity = '1'; t.style.display = 'block';
  clearTimeout(_tt); _tt = setTimeout(() => { t.style.opacity='0'; setTimeout(()=>t.style.display='none', 300); }, 4000);
}

/* ═══ CLOCK ═══ */
function tick() {
  const now = new Date();
  const nc = $('nav-clock');
  if (nc) nc.textContent = now.toLocaleTimeString('en-US', {
    timeZone:'Asia/Dhaka', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:true
  }) + ' BST';
  if (S.nextRefresh) {
    const rem = Math.max(0, Math.floor((S.nextRefresh - Date.now()) / 1000));
    txt('st-cd', `${String(Math.floor(rem/60)).padStart(2,'0')}:${String(rem%60).padStart(2,'0')}`);
  }
}

/* ═══ PARTICLES ═══ */
function initParticles() {
  const canvas = $('particles-canvas'); if (!canvas) return;
  // Skip particles on mobile for performance
  if (window.innerWidth < 768) { canvas.style.display = 'none'; return; }
  const ctx = canvas.getContext('2d');
  let W = canvas.width = window.innerWidth;
  let H = canvas.height = window.innerHeight;
  let rafId;

  const onResize = () => {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
    if (W < 768) { canvas.style.display='none'; cancelAnimationFrame(rafId); }
  };
  window.addEventListener('resize', onResize, { passive:true });

  const pts = Array.from({ length:50 }, () => ({
    x: Math.random()*W, y: Math.random()*H,
    vx: (Math.random()-.5)*.3, vy: (Math.random()-.5)*.3,
    r: Math.random()*1.5+.3,
    a: Math.random()*.5+.08,
    gold: Math.random() > .45,
  }));
  let mx = -999, my = -999;
  window.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; }, { passive:true });

  (function draw() {
    ctx.clearRect(0,0,W,H);
    pts.forEach(p => {
      const dx = mx-p.x, dy = my-p.y, dist = Math.hypot(dx,dy);
      if (dist < 160) { p.vx += dx/dist*.01; p.vy += dy/dist*.01; }
      p.vx *= .985; p.vy *= .985;
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = p.gold ? `rgba(201,168,76,${p.a})` : `rgba(155,170,181,${p.a*.5})`;
      ctx.fill();
    });
    for (let i = 0; i < pts.length; i++) {
      for (let j = i+1; j < pts.length; j++) {
        const d = Math.hypot(pts[i].x-pts[j].x, pts[i].y-pts[j].y);
        if (d < 85) {
          ctx.beginPath(); ctx.moveTo(pts[i].x,pts[i].y); ctx.lineTo(pts[j].x,pts[j].y);
          ctx.strokeStyle = `rgba(201,168,76,${.06*(1-d/85)})`; ctx.lineWidth = .5; ctx.stroke();
        }
      }
    }
    rafId = requestAnimationFrame(draw);
  })();
}

/* ═══ SCROLL ANIMATIONS ═══ */
function initScrollAnimations() {
  if (!('IntersectionObserver' in window)) return;
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

  // Animate sections, cards, and grid items
  const selectors = [
    '.p-card', '.lc', '.conv-cell', '.avg-cell',
    '.ins-card', '.fc-card', '.about-card',
    '.kitco-box', '.ten-day-wrap', '.chart-box',
    '.forecast-chart-box', '.author-card', '.calc-box'
  ];

  selectors.forEach(sel => {
    document.querySelectorAll(sel).forEach((el, i) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';
      el.style.transition = `opacity .5s ease ${i * 0.05}s, transform .5s ease ${i * 0.05}s`;
      obs.observe(el);
    });
  });
}

/* ═══ EVENTS ═══ */
function bindEvents() {
  // Gold unit tabs
  const gut = $('gold-utabs');
  if (gut) gut.querySelectorAll('.u-tab').forEach(b => b.addEventListener('click', () => {
    gut.querySelectorAll('.u-tab').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-selected','false'); });
    b.classList.add('active'); b.setAttribute('aria-selected','true');
    S.goldUnit = b.dataset.u; renderGold();
  }));

  // History period
  const ptabs = $('p-tabs');
  if (ptabs) ptabs.querySelectorAll('.p-tab').forEach(b => b.addEventListener('click', () => {
    ptabs.querySelectorAll('.p-tab').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); S.histPeriod = b.dataset.p; renderHistory();
  }));

  // Metal toggle
  const mt = $('m-toggle');
  if (mt) mt.querySelectorAll('.m-btn').forEach(b => b.addEventListener('click', () => {
    mt.querySelectorAll('.m-btn').forEach(x => x.className = 'm-btn');
    b.classList.add(b.dataset.m === 'silver' ? 'as' : 'ag');
    S.histMetal = b.dataset.m; renderHistory();
  }));

  // Dataset toggle
  const dst = $('ds-toggle');
  if (dst) dst.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    dst.querySelectorAll('button').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); S.histDataset = b.dataset.ds;
    const hut = $('h-utabs'); if (hut) hut.style.display = b.dataset.ds === 'bajus' ? '' : 'none';
    renderHistory();
  }));

  // History unit
  const hut = $('h-utabs');
  if (hut) hut.querySelectorAll('.u-tab').forEach(b => b.addEventListener('click', () => {
    hut.querySelectorAll('.u-tab').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); S.histUnit = b.dataset.u; renderHistory();
  }));

  // 10-day gold karat tabs
  const tgk = $('ten-day-karat-tabs');
  if (tgk) tgk.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    tgk.querySelectorAll('button').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); S.tenDayGoldKarat = b.dataset.k; renderTenDay('gold', S.tenDayGoldKarat);
  }));

  // 10-day silver karat tabs
  const tsk = $('ten-day-silver-tabs');
  if (tsk) tsk.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    tsk.querySelectorAll('button').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); S.tenDaySilverKarat = b.dataset.k; renderTenDay('silver', S.tenDaySilverKarat);
  }));

  // Language — all lang-opt elements on page (inc. mobile)
  document.querySelectorAll('.lang-opt').forEach(o => o.addEventListener('click', () => {
    S.lang = o.dataset.lang; localStorage.setItem('sg-lang', S.lang);
    applyI18n(); renderAll();
  }));
  // Keyboard for lang options
  document.querySelectorAll('.lang-opt').forEach(o => o.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); o.click(); }
  }));

  // Calculator enter key
  const cwt = $('c-wt');
  if (cwt) cwt.addEventListener('keydown', e => { if (e.key === 'Enter') calculate(); });

  // Scroll effects
  window.addEventListener('scroll', () => {
    const nav = document.getElementById('nav');
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 50);
    const st = document.getElementById('scrollTop');
    if (st) st.classList.toggle('vis', window.scrollY > 400);
  }, { passive:true });

  // Close mobile menu on outside click
  document.addEventListener('click', e => {
    const menu = document.getElementById('mobile-menu');
    const toggle = document.getElementById('nav-toggle');
    if (menu && toggle && menu.classList.contains('open')) {
      if (!menu.contains(e.target) && !toggle.contains(e.target)) {
        menu.classList.remove('open');
        toggle.classList.remove('open');
        toggle.setAttribute('aria-expanded','false');
        menu.setAttribute('aria-hidden','true');
        document.body.style.overflow = '';
      }
    }
  });

  // ESC closes mobile menu
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const menu = document.getElementById('mobile-menu');
      const toggle = document.getElementById('nav-toggle');
      if (menu && menu.classList.contains('open')) {
        menu.classList.remove('open');
        toggle?.classList.remove('open');
        toggle?.setAttribute('aria-expanded','false');
        menu.setAttribute('aria-hidden','true');
        document.body.style.overflow = '';
        toggle?.focus();
      }
    }
  });

  // Touch swipe to close mobile menu
  let touchStartX = 0;
  const menu = document.getElementById('mobile-menu');
  if (menu) {
    menu.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive:true });
    menu.addEventListener('touchend', e => {
      const diff = touchStartX - e.changedTouches[0].clientX;
      if (diff > 60) { // swipe left to close
        menu.classList.remove('open');
        document.getElementById('nav-toggle')?.classList.remove('open');
        document.body.style.overflow = '';
      }
    }, { passive:true });
  }
}

/* ═══ RENDER ALL ═══ */
function renderAll() {
  if ($('gp-22'))  renderGold();
  if ($('sp-22'))  renderSilver();
  if ($('km-g-usd')) renderLive();
  if ($('gold-cmp')) renderCompare();
  renderTicker();
  if ($('ten-day-gold-tbody'))   renderTenDay('gold',   S.tenDayGoldKarat);
  if ($('ten-day-silver-tbody')) renderTenDay('silver', S.tenDaySilverKarat);
  if ($('avg-gold-today'))   renderAverages('gold');
  if ($('avg-silver-today')) renderAverages('silver');
  if ($('ins-ratio'))  renderInsights();
  if ($('fc-gold-val')) renderForecast();
}

/* ═══ MAIN LOAD & INIT ═══ */
async function load() {
  S.nextRefresh = Date.now() + 30 * 60 * 1000;
  await loadLatest();
  await loadHistory();
  renderAll();
  renderHistory();
}

async function init() {
  S.lang = detectLang();
  applyI18n();

  // Set active nav link
  const path = window.location.pathname;
  const gLink = $('nav-gold-link'), sLink = $('nav-silver-link'), hLink = $('nav-home-link');
  if (path.includes('gold.html')   && gLink) gLink.classList.add('active');
  if (path.includes('silver.html') && sLink) sLink.classList.add('active');
  if (!path.includes('silver.html') && !path.includes('gold.html') && hLink) hLink.classList.add('active');

  bindEvents();
  initParticles();
  setInterval(tick, 1000);
  tick();
  await load();
  // Init scroll animations after first render
  setTimeout(initScrollAnimations, 300);
  setInterval(load, 30 * 60 * 1000);
}

document.addEventListener('DOMContentLoaded', init);
