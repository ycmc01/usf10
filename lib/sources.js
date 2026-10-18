// sources.js — 公開資料來源（server-only）。每個主機一條節流佇列＋磁碟快取；失敗時回舊快取並標 stale。
// 實測（2026-10-18）：FRED／ALFRED 下載端點在短時間多次請求後整站逾時（疑似 IP 限流），
// 故殖利率、美元、目標區間、NFCI 改以原始官方來源為主（Fed H.15／H.10、NY Fed、芝加哥 Fed），FRED 只負責 ICE 信用利差、VIXCLS 與 ALFRED 版本。
import fs from 'node:fs';
import path from 'node:path';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) local-research admin@localhost';

export const SOURCE_INFO = {
  H15: { name: 'Fed H.15（公債固定期限殖利率）', url: 'https://www.federalreserve.gov/releases/h15/', note: '即 FRED DGS2／DGS10／DGS3MO 的原始來源；美國公債市場休市日無值' },
  H10: { name: 'Fed H.10（廣義美元指數）', url: 'https://www.federalreserve.gov/releases/h10/', note: '即 FRED DTWEXBGS；每週一發布上週資料，落後約 1 週' },
  NYFED: { name: 'NY Fed 有效聯邦基金利率（EFFR）', url: 'https://www.newyorkfed.org/markets/reference-rates/effr', note: '每日含目標區間上下限（同 FRED DFEDTARU／DFEDTARL）；隔日上午公布前一營業日' },
  CHIFED: { name: '芝加哥 Fed 全國金融條件指數（NFCI）', url: 'https://www.chicagofed.org/research/data/nfci/current-data', note: '週頻，每週三公布截至上週五的資料；舊網址 chicagofed.org/-/media/…/nfci-data-series-csv.csv 停在 2026-04-24，須改用 api.data.chicagofed.org' },
  BLS: { name: 'BLS 公開 API v1', url: 'https://www.bls.gov/developers/', note: '無金鑰每日 25 次；用來核對 XQ 的 CPI、PPI、就業數字（只有目前值，無版本）' },
  TSY: { name: '美國財政部每日殖利率曲線', url: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve', note: 'H.15 固定期限殖利率的原始資料；只用來補 H.15 尚未收錄的最新日期' },
  FRED: { name: 'FRED（聖路易 Fed）', url: 'https://fred.stlouisfed.org/', note: 'ICE BofA 信用利差（BAMLH0A0HYM2、BAMLC0A0CM）與 VIXCLS 只有 FRED 可取得；ICE 授權限制 FRED 只提供近 3 年，故 10 年百分位無法計算；再發布條款需法務確認' },
  ALFRED: { name: 'ALFRED（FRED 版本庫）', url: 'https://alfred.stlouisfed.org/', note: '以月底版本（vintage_date）取得當時可得的值；首次公布值＝最早含該期間的版本' },
  FEDWEB: { name: 'federalreserve.gov', url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', note: 'FOMC 會議日曆、聲明、SEP 點陣圖中位數' },
  XQ: { name: 'XQAPI 總經資料庫', url: null, note: '經濟日曆（只有日期與預估）、指標序列（只有最新修訂值）' },
};

export function createSources({ dataDir, log = () => {}, fredKey = process.env.FRED_API_KEY || '' }) {
  const cacheDir = path.join(dataDir, 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const health = {};   // src → { lastOk, lastErr, message, backoffUntil }
  const lanes = {};    // host → { chain, last }
  const GAP = { 'fred.stlouisfed.org': 3000, 'alfred.stlouisfed.org': 3000, 'api.stlouisfed.org': 600, 'api.bls.gov': 1500, 'www.federalreserve.gov': 1200 };
  const blsCount = { day: '', n: 0 };

  const cacheFile = (key) => path.join(cacheDir, key.replace(/[^\w.-]+/g, '_').slice(0, 180));
  const readCache = (key) => { try { const f = cacheFile(key); return { text: fs.readFileSync(f, 'utf8'), at: fs.statSync(f).mtimeMs }; } catch { return null; } };
  const writeCache = (key, text) => { const f = cacheFile(key); fs.writeFileSync(f + '.tmp', text); fs.renameSync(f + '.tmp', f); };

  function throttled(host, fn) {
    const l = lanes[host] ||= { chain: Promise.resolve(), last: 0 };
    const run = l.chain.then(async () => {
      const wait = (GAP[host] || 300) - (Date.now() - l.last);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      try { return await fn(); } finally { l.last = Date.now(); }
    });
    l.chain = run.catch(() => {});
    return run;
  }

  /** 取文字；ttlMs 內用快取；失敗時回舊快取（stale=true）。immutable 快取永不過期（如過去的 ALFRED 版本）。 */
  async function getText(src, url, { key = url, ttlMs = 6 * 3600e3, timeoutMs = 30000, method = 'GET', body = null, headers = {}, immutable = false, retries = 1, validate = null } = {}) {
    let c = readCache(key);
    if (c && validate && !validate(c.text)) c = null;
    if (c && (immutable || Date.now() - c.at < ttlMs)) { const hh = health[src] ||= {}; if (!hh.lastOk || hh.lastOk < c.at) hh.lastOk = c.at; return { text: c.text, at: c.at, cached: true, stale: false }; }
    const h = health[src] ||= {};
    if (h.backoffUntil && h.backoffUntil > Date.now()) {
      if (c) return { text: c.text, at: c.at, cached: true, stale: true, error: h.message };
      throw new Error(`${src} 暫停請求至 ${new Date(h.backoffUntil).toISOString()}（${h.message}）`);
    }
    const host = new URL(url).host;
    let lastErr;
    for (let i = 0; i <= retries; i++) {
      try {
        const text = await throttled(host, async () => {
          const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
          const t0 = Date.now();
          try {
            const res = await fetch(url, { method, body, headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate', ...headers }, signal: ctrl.signal });
            const txt = await res.text();
            log({ at: Date.now(), src, status: res.status, ms: Date.now() - t0, url: url.replace(/api_key=[^&]+/, 'api_key=***').slice(0, 160) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            if (validate && !validate(txt)) throw new Error(`回應內容不符（${txt.length} 位元組）`);
            return txt;
          } catch (e) {
            if (e.name === 'AbortError') { log({ at: Date.now(), src, status: null, ms: Date.now() - t0, url: url.slice(0, 160), code: 'TIMEOUT' }); throw new Error('逾時'); }
            throw e;
          } finally { clearTimeout(t); }
        });
        writeCache(key, text);
        h.lastOk = Date.now(); h.message = null; h.fails = 0; h.backoffUntil = 0;
        return { text, at: Date.now(), cached: false, stale: false };
      } catch (e) { lastErr = e; if (i < retries) await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
    }
    h.lastErr = Date.now(); h.message = lastErr.message; h.fails = (h.fails || 0) + 1;
    // 連續失敗退避：FRED 類主機 30 分鐘起跳，其他 5 分鐘
    const base = /stlouisfed/.test(url) ? 30 * 60e3 : 5 * 60e3;
    h.backoffUntil = Date.now() + Math.min(base * h.fails, 6 * 3600e3);
    if (c) return { text: c.text, at: c.at, cached: true, stale: true, error: lastErr.message };
    throw lastErr;
  }

  const csvLines = (t) => t.replace(/\r/g, '').split('\n').filter(Boolean).map(l => { const o = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(cur); cur = ''; } else cur += ch; } o.push(cur); return o; });
  const num = (s) => { const v = String(s ?? '').trim(); if (!v || v === '.' || /^(ND|NC|NA|n\/a)$/i.test(v)) return null; const x = +v; return isFinite(x) ? x : null; };
  const meta = (r, src) => ({ src, fetchedAt: r.at, stale: !!r.stale, error: r.error || null });

  // ---- Fed Data Download Program（H.15、H.10）----
  const DDP = 'https://www.federalreserve.gov/datadownload/Output.aspx';
  // 實測：單次請求超過約 500 列回空檔（HTTP 200、0 位元組），故按年分段；過去年度永久快取
  async function ddp(rel, hash, from, src) {
    const y0 = +from.slice(0, 4), y1 = new Date().getUTCFullYear();
    const series = {}; let last = null;
    for (let y = y0; y <= y1; y++) {
      const url = `${DDP}?rel=${rel}&series=${hash}&lastobs=&from=01/01/${y}&to=12/31/${y}&filetype=csv&label=include&layout=seriescolumn`;
      const r = await getText(src, url, { key: `ddp_${rel}_${hash}_${y}`, ttlMs: 3 * 3600e3, timeoutMs: 60000, retries: 4, validate: (t) => t.includes('Time Period'), immutable: y < y1 - 0 && y < new Date(Date.now() - 20 * 864e5).getUTCFullYear() });
      const rows = csvLines(r.text);
      const hi = rows.findIndex(x => x[0] === 'Time Period');
      if (hi < 0) throw new Error(`${src} ${y} 回應格式不符（${r.text.length} 位元組）`);
      const cols = rows[hi].slice(1);
      for (const row of rows.slice(hi + 1)) cols.forEach((c, i) => { (series[c] ||= []).push({ date: row[0], value: num(row[i + 1]) }); });
      if (y === y1) last = r;
    }
    return { series, ...meta(last, src) };
  }
  async function treasuryYields(from = '2015-01-01') {
    const d = await ddp('H15', 'bf17364827e38702b42a58cf8eaa3f78', from, 'H15');
    const pick = (k) => d.series[k] || [];
    const out = { DGS3MO: pick('RIFLGFCM03_N.B'), DGS2: pick('RIFLGFCY02_N.B'), DGS10: pick('RIFLGFCY10_N.B'), meta: { src: 'H15', fetchedAt: d.fetchedAt, stale: d.stale, error: d.error, ext: [] } };
    // H.15 晚一個營業日；財政部每日殖利率曲線（H.15 固定期限殖利率的原始資料）補上 H.15 尚未收錄的日期
    try {
      const y = new Date().getUTCFullYear();
      const r = await getText('TSY', `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${y}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${y}&page&_format=csv`, { key: `tsy_${y}`, ttlMs: 2 * 3600e3, validate: (t) => t.startsWith('Date') });
      const rows = csvLines(r.text); const h = rows[0];
      const col = (n) => h.indexOf(n);
      const last = out.DGS10.filter(x => x.value != null).pop()?.date || '';
      const add = rows.slice(1).map(x => { const m = x[0].match(/(\d+)\/(\d+)\/(\d{4})/); return m ? { date: `${m[3]}-${m[1]}-${m[2]}`, m3: num(x[col('3 Mo')]), y2: num(x[col('2 Yr')]), y10: num(x[col('10 Yr')]) } : null; }).filter(x => x && x.date > last).sort((a, b) => a.date.localeCompare(b.date));
      for (const a of add) { out.DGS3MO.push({ date: a.date, value: a.m3, ext: 'TSY' }); out.DGS2.push({ date: a.date, value: a.y2, ext: 'TSY' }); out.DGS10.push({ date: a.date, value: a.y10, ext: 'TSY' }); out.meta.ext.push(a.date); }
    } catch { /* 財政部檔案失敗時只用 H.15 */ }
    return out;
  }
  async function broadDollar(from = '2015-01-01') {
    const d = await ddp('H10', '122e3bcb627e8e53f1bf72a1a09cfb81', from, 'H10');
    return { DTWEXBGS: d.series['JRXWTFB_N.B'] || [], meta: { src: 'H10', fetchedAt: d.fetchedAt, stale: d.stale, error: d.error } };
  }

  // ---- NY Fed：EFFR＋目標區間（日頻） ----
  async function fedTarget(from = '2015-01-01') {
    const to = new Date().toISOString().slice(0, 10);
    const r = await getText('NYFED', `https://markets.newyorkfed.org/api/rates/unsecured/effr/search.json?startDate=${from}&endDate=${to}`, { key: `nyfed_effr_${from}`, ttlMs: 3 * 3600e3 });
    const rows = (JSON.parse(r.text).refRates || []).map(x => ({ date: x.effectiveDate, effr: num(x.percentRate), lower: num(x.targetRateFrom), upper: num(x.targetRateTo) })).sort((a, b) => a.date.localeCompare(b.date));
    return { rows, meta: meta(r, 'NYFED') };
  }

  // ---- 芝加哥 Fed NFCI ----
  async function nfci() {
    const r = await getText('CHIFED', 'https://api.data.chicagofed.org/NFCI/nfci-data-series-csv.csv', { key: 'chifed_nfci2', validate: (t) => t.startsWith('Friday_of_Week'), ttlMs: 6 * 3600e3 });
    const rows = csvLines(r.text); const h = rows[0].map(x => x.trim());
    const iD = h.indexOf('Friday_of_Week'), iN = h.indexOf('NFCI');
    const toIso = (s) => { const m = s.match(/(\d+)\/(\d+)\/(\d{4})/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : s; };
    return { NFCI: rows.slice(1).map(x => ({ date: toIso(x[iD]), value: num(x[iN]) })).filter(x => x.date).sort((a, b) => a.date.localeCompare(b.date)), meta: meta(r, 'CHIFED') };
  }

  // ---- FRED：fredgraph.csv（無金鑰）或 API（有 FRED_API_KEY） ----
  async function fred(id, cosd = '2015-01-01', { ttlMs = 6 * 3600e3 } = {}) {
    let r, rows;
    if (fredKey) {
      r = await getText('FRED', `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&observation_start=${cosd}&file_type=json&api_key=${fredKey}`, { key: `fredapi_${id}_${cosd}`, ttlMs });
      rows = JSON.parse(r.text).observations.map(o => ({ date: o.date, value: num(o.value) }));
    } else {
      r = await getText('FRED', `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${cosd}`, { key: `fred_${id}_${cosd}`, ttlMs, timeoutMs: 25000 });
      rows = csvLines(r.text).slice(1).map(x => ({ date: x[0], value: num(x[1]) }));
    }
    return { rows: rows.filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.date)), meta: meta(r, 'FRED') };
  }
  /** ALFRED 單一版本：該 vintage_date 當天可得的整條序列（過去的版本不會變，永久快取） */
  async function alfredVintage(id, vintageDate, cosd) {
    const today = new Date().toISOString().slice(0, 10);
    const immutable = vintageDate < today;
    let r, rows;
    if (fredKey) {
      r = await getText('ALFRED', `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&observation_start=${cosd}&realtime_start=${vintageDate}&realtime_end=${vintageDate}&file_type=json&api_key=${fredKey}`, { key: `alfredapi_${id}_${vintageDate}_${cosd}`, immutable, ttlMs: 6 * 3600e3 });
      rows = JSON.parse(r.text).observations.map(o => ({ date: o.date, value: num(o.value) }));
    } else {
      r = await getText('ALFRED', `https://alfred.stlouisfed.org/graph/alfredgraph.csv?id=${id}&cosd=${cosd}&vintage_date=${vintageDate}`, { key: `alfred_${id}_${vintageDate}_${cosd}`, immutable, ttlMs: 6 * 3600e3, timeoutMs: 25000 });
      rows = csvLines(r.text).slice(1).map(x => ({ date: x[0], value: num(x[1]) }));
    }
    return { rows: rows.filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.date)), meta: meta(r, 'ALFRED') };
  }

  // ---- BLS API v1（POST 多序列；每日 25 次上限，本站自行計數） ----
  async function bls(ids, startyear, endyear) {
    const day = new Date().toISOString().slice(0, 10);
    const key = `bls_${ids.join('-')}_${startyear}_${endyear}`;
    const c = readCache(key);
    if (blsCount.day !== day) { blsCount.day = day; blsCount.n = 0; }
    if (!(c && Date.now() - c.at < 6 * 3600e3) && blsCount.n >= 20) {
      if (c) return { series: parseBls(c.text), meta: { src: 'BLS', fetchedAt: c.at, stale: true, error: '本日 BLS 請求已達上限（保留 5 次）' } };
      throw new Error('本日 BLS 請求已達上限');
    }
    const r = await getText('BLS', 'https://api.bls.gov/publicAPI/v1/timeseries/data/', { key, ttlMs: 6 * 3600e3, method: 'POST', body: JSON.stringify({ seriesid: ids, startyear: String(startyear), endyear: String(endyear) }), headers: { 'Content-Type': 'application/json' } });
    if (!r.cached) blsCount.n++;
    const series = parseBls(r.text);
    if (!Object.keys(series).length) throw new Error('BLS 回應無資料：' + r.text.slice(0, 120));
    return { series, meta: meta(r, 'BLS') };
  }
  function parseBls(text) {
    const j = JSON.parse(text); const out = {};
    for (const s of j.Results?.series || []) {
      out[s.seriesID] = (s.data || []).filter(d => /^M(0[1-9]|1[0-2])$/.test(d.period)).map(d => ({ period: `${d.year}-${d.period.slice(1)}`, value: num(d.value) })).sort((a, b) => a.period.localeCompare(b.period));
    }
    return out;
  }

  // ---- federalreserve.gov HTML ----
  async function fomcHtml() { return getText('FEDWEB', 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', { key: 'fed_fomccalendars', ttlMs: 12 * 3600e3 }); }
  async function projHtml(url) { return getText('FEDWEB', url, { key: 'fed_' + url.split('/').pop(), immutable: true }); }

  return { getText, treasuryYields, broadDollar, fedTarget, nfci, fred, alfredVintage, bls, fomcHtml, projHtml, health, hasFredKey: !!fredKey, blsCount };
}
