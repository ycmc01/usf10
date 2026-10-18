// macro.js — 純函式：版本（vintage）、時點查詢、預期差、異常、缺值、百分位、事件反應、相關係數。
import { transform } from './catalog.js';

// ---- 期間鍵 ----
/** 月：YYYY-MM；季：季末月 YYYY-MM；週：週末日期 YYYY-MM-DD。FRED 季資料日期為季初（2026-07-01＝Q3），XQ 為季末（2026-09-30） */
export function periodKey(date, freq, { quarterStart = false } = {}) {
  if (freq === 'W') return date.slice(0, 10);
  if (freq === 'Q' && quarterStart) { const m = +date.slice(5, 7) + 2; return `${date.slice(0, 4)}-${String(m).padStart(2, '0')}`; }
  return date.slice(0, 7);
}

// ---- 版本（macro_observation）：只新增、不覆寫 ----
/** 新增一個版本快照。同一 vintage 已存在 → 不覆寫（回 false）；自行擷取（非 ALFRED）時與前一版完全相同也不新增 */
export function addVintage(db, sid, vintage, rows, { src, at = Date.now() } = {}) {
  const V = db.vintages[sid] ||= {};
  if (V[vintage]) return false;
  const clean = {};
  for (const r of rows) if (r.value != null && isFinite(r.value)) clean[r.period] = r.value; // 缺值不寫 0、不插值
  if (!Object.keys(clean).length) return false;
  if (src !== 'ALFRED') {
    const prev = Object.keys(V).filter(v => v < vintage).sort().pop();
    if (prev) {
      const p = V[prev].rows;
      const same = Object.entries(clean).every(([k, v]) => p[k] === v);
      if (same) return false;
    }
  }
  V[vintage] = { src, at, rows: clean };
  return true;
}

/** 某版本的整條序列（依期間排序），可換算成發布口徑 */
function vintageSeries(v, tf, dec) {
  const obs = Object.entries(v.rows).map(([period, value]) => ({ period, value })).sort((a, b) => a.period.localeCompare(b.period));
  return tf && tf !== 'level' ? transform(obs, tf, dec) : obs;
}

/** 每一期的版本歷史：[{ vintage, value, src }]，只在值改變時列一筆。asOf 給定時只用 vintage ≤ asOf（時點查詢） */
export function history(db, sid, { tf = 'level', dec = 1, asOf = null } = {}) {
  const V = db.vintages[sid] || {};
  const out = {};
  for (const vin of Object.keys(V).sort()) {
    if (asOf && vin.slice(0, 10) > asOf) break; // 自行擷取的版本鍵含時間（YYYY-MM-DDTHH:MM），查詢日當天的版本也算可得
    for (const { period, value } of vintageSeries(V[vin], tf, dec)) {
      if (value == null) continue;
      const h = out[period] ||= [];
      if (!h.length || h[h.length - 1].value !== value) h.push({ vintage: vin, value, src: V[vin].src });
    }
  }
  return out;
}
/** 時點查詢：查詢日當時可得的值 */
export function valueAsOf(db, sid, period, asOf, opts = {}) {
  const h = history(db, sid, { ...opts, asOf })[period];
  return h ? h[h.length - 1] : null;
}
/** 首次公布 vs 目前：first＝最早版本，current＝最新版本，revisions＝改值次數 */
export function firstVsCurrent(hist) {
  if (!hist || !hist.length) return null;
  const first = hist[0], current = hist[hist.length - 1];
  return { first, current, revisions: hist.length - 1, revised: first.value !== current.value };
}

// ---- 預期差 ----
export function surprise(actual, est, dec = 1) {
  if (actual == null || est == null) return null;
  const diff = +(actual - est).toFixed(Math.max(dec, 0) + 2);
  const tol = 0.5 * 10 ** -dec;
  const text = Math.abs(diff) < tol - 1e-12 ? '符合' : diff > 0 ? '高於' : '低於';
  return { diff, text };
}
/** 標準化預期差＝預期差 ÷ 過去 24 次預期差的標準差（樣本 < 6 不計算，只回樣本數） */
export function standardized(diff, past, { window = 24, minN = 6 } = {}) {
  const xs = past.filter(x => x != null && isFinite(x)).slice(-window);
  if (diff == null || xs.length < minN) return { z: null, n: xs.length };
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
  if (!(sd > 0)) return { z: null, n: xs.length };
  return { z: diff / sd, n: xs.length, sd };
}

// ---- 異常預估（「待查」）----
/** 預估與前值差距 > 歷史期間變動 5 個標準差，或量級疑似錯誤 → 回原因；否則 null */
export function estimateAnomaly(est, prior, values, { k = 5 } = {}) {
  if (est == null) return null;
  const vs = values.filter(v => v != null && isFinite(v));
  if (prior != null && Math.abs(prior) >= 1 && est !== 0) {
    const ratio = Math.abs(est / prior);
    if (ratio > 8 || ratio < 1 / 8) return `量級疑似錯誤（預估 ${est}、前值 ${prior}）`;
  }
  if (vs.length >= 12 && prior != null) {
    const d = []; for (let i = 1; i < vs.length; i++) d.push(vs[i] - vs[i - 1]);
    const m = d.reduce((a, b) => a + b, 0) / d.length;
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / (d.length - 1));
    if (sd > 0 && Math.abs(est - prior) > k * sd) return `預估與前值差 ${(est - prior).toFixed(2)}，超過歷史期間變動 ${k} 個標準差（σ=${sd.toFixed(2)}）`;
  }
  if (vs.length >= 12) {
    const mx = Math.max(...vs.map(Math.abs));
    if (mx > 0 && Math.abs(est) > 4 * mx && Math.abs(est) > 5) return `預估 ${est} 超過歷史最大絕對值 ${mx} 的 4 倍`;
  }
  return null;
}

// ---- 缺值與停更 ----
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
/** 序列中間缺漏的期間（月／季）；週頻不檢查 */
export function gaps(periods, freq) {
  if (freq === 'W' || periods.length < 2) return [];
  const s = [...periods].sort(); const step = freq === 'Q' ? 3 : 1; const set = new Set(s); const out = [];
  for (let p = addMonths(s[0], step); p < s[s.length - 1]; p = addMonths(p, step)) if (!set.has(p)) out.push(p);
  return out;
}
/** 超過 2 個週期（加上一般發布落差）未更新 → 停更 */
export function staleness(lastPeriod, freq, today) {
  if (!lastPeriod) return { stale: true, text: '無資料' };
  if (freq === 'W') { const days = (Date.parse(today) - Date.parse(lastPeriod)) / 864e5; return days > 21 ? { stale: true, text: `停更：最後一期 ${lastPeriod}（${Math.round(days)} 天前）` } : { stale: false }; }
  const step = freq === 'Q' ? 3 : 1;
  const ym = today.slice(0, 7); let n = 0; for (let p = lastPeriod.slice(0, 7); p < ym; p = addMonths(p, 1)) n++;
  const allowed = step * 2 + (freq === 'Q' ? 2 : 1);
  return n > allowed ? { stale: true, text: `停更：最後一期 ${lastPeriod.slice(0, 7)}，已超過 2 個週期未更新` } : { stale: false };
}

// ---- 跨資產：變化、百分位 ----
/** series: [{date, value}] 依日期排序（可含 null）。回傳最後一筆有值的觀測 */
export const lastObs = (s) => { for (let i = s.length - 1; i >= 0; i--) if (s[i].value != null) return s[i]; return null; };
/** 近 n 筆觀測的變化（日頻 20 個交易日；週頻 4 週） */
export function changeN(s, n) {
  const v = s.filter(x => x.value != null); if (v.length <= n) return null;
  const a = v[v.length - 1], b = v[v.length - 1 - n];
  return { from: b, to: a, diff: a.value - b.value };
}
/** 近 years 年的百分位（≤ 最新值的比例）；涵蓋率不足 80% 回 null */
export function percentile(s, years, { expectedPerYear }) {
  const last = lastObs(s); if (!last) return null;
  const start = `${+last.date.slice(0, 4) - years}${last.date.slice(4)}`;
  const w = s.filter(x => x.value != null && x.date > start && x.date <= last.date).map(x => x.value);
  const coverage = w.length / (expectedPerYear * years);
  if (coverage < 0.8) return { pct: null, n: w.length, coverage, reason: `樣本 ${w.length} 筆，不足 ${years} 年` };
  const below = w.filter(v => v <= last.value).length;
  return { pct: (below / w.length) * 100, n: w.length, coverage, min: Math.min(...w), max: Math.max(...w) };
}
/** 「最差 10%」：worse='high' 取百分位 ≥ 90；'low' 取 ≤ 10 */
export const inWorst = (pct, worse, cut = 10) => pct == null ? null : worse === 'high' ? pct >= 100 - cut : pct <= cut;

// ---- 事件反應：公布前一日收盤 → 公布當日收盤 ----
/** s: [{date:'YYYY-MM-DD', value}]；回傳 { prev, curr, change }，當日無值（休市）回 null */
export function reaction(s, date, { mode = 'pct' } = {}) {
  const i = s.findIndex(x => x.date === date && x.value != null);
  if (i < 0) return null;
  let j = i - 1; while (j >= 0 && s[j].value == null) j--;
  if (j < 0) return null;
  const prev = s[j], curr = s[i];
  const change = mode === 'bp' ? (curr.value - prev.value) * 100 : (curr.value / prev.value - 1) * 100;
  return { prevDate: prev.date, prev: prev.value, date: curr.date, curr: curr.value, change };
}

// ---- 相關係數（持股日報酬 vs 序列日變化，同日期配對）----
export function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
/** 以同日配對計算：stock 收盤日報酬（%）vs 序列日變化（bp 或點）；序列缺值日不配對 */
export function pairedChanges(stock, series, { from, scale = 100 } = {}) {
  const sm = new Map(series.filter(x => x.value != null).map(x => [x.date, x.value]));
  const sd = series.filter(x => x.value != null).map(x => x.date);
  const pos = new Map(sd.map((d, i) => [d, i]));
  const xs = [], ys = [], dates = [];
  for (let i = 1; i < stock.length; i++) {
    const d = stock[i].date, d0 = stock[i - 1].date;
    if (from && d < from) continue;
    if (!sm.has(d) || !sm.has(d0)) continue;
    if (pos.get(d) - pos.get(d0) !== 1) continue; // 兩邊都必須是相鄰觀測
    xs.push((stock[i].close / stock[i - 1].close - 1) * 100); ys.push((sm.get(d) - sm.get(d0)) * scale); dates.push(d);
  }
  return { xs, ys, dates, n: xs.length, r: pearson(xs, ys) };
}

// ---- 觀察條件（寫入模組 01 帳本前在本站評估）----
/** values: 依期間排序 [{period, value}]；條件「op value」連續 n 次 */
export function evalCondition(values, { op, value, n = 1 }) {
  const ok = (v) => op === '>' ? v > value : op === '>=' ? v >= value : op === '<' ? v < value : v <= value;
  const vs = values.filter(x => x.value != null);
  let streak = 0; for (let i = vs.length - 1; i >= 0 && ok(vs[i].value); i--) streak++;
  return { met: streak >= n, streak, last: vs[vs.length - 1] || null, checked: vs.slice(-Math.max(n, 3)) };
}
