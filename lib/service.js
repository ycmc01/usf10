// service.js — 排程擷取（日曆預估快照、序列版本、官方核對、ALFRED 版本回補）與各頁檢視。
import { RELEASES, BY_XQ, BY_KEY, notPublished, releaseTime, etTime, twTime, transform, parseFomc, parseDotMedian } from './catalog.js';
import { periodKey, addVintage, history, valueAsOf, firstVsCurrent, surprise, standardized, estimateAnomaly, gaps, staleness, lastObs, changeN, percentile, inWorst, reaction, pairedChanges, evalCondition } from './macro.js';
import { SOURCE_INFO } from './sources.js';

const COUNTRIES = ['美國', '中國', '加拿大', '英國', '歐元區', '德國', '法國', '義大利', '西班牙', '日本', '台灣', '韓國', '南韓', '澳洲', '紐西蘭', '瑞士', '瑞典', '挪威', '丹麥', '香港', '新加坡', '印度', '印尼', '巴西', '墨西哥', '俄羅斯', '南非', '土耳其', '波蘭', '荷蘭', '比利時', '奧地利', '愛爾蘭', '葡萄牙', '希臘', '芬蘭', '泰國', '馬來西亞', '菲律賓', '越南', '以色列', '智利', '阿根廷', '哥倫比亞', '秘魯', '沙烏地阿拉伯'];
export const countryOf = (name) => COUNTRIES.find(c => name.startsWith(c)) || '其他';
const freqOf = (xq, fallback) => BY_XQ[xq]?.key === 'gdp' ? 'Q' : (fallback || 'M');
const etNow = () => etTime(Date.now());
const vintageKey = () => { const t = etNow(); return `${t.date}T${t.time}`; };   // 自行擷取版本：美東日期＋時間
const isoDate = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
const monthEnd = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

// 跨資產面板 8 序列（F37-1）；worse＝「轉差」方向，規則公開
export const PANEL = [
  { id: 'DGS2', name: '2 年期公債殖利率', unit: '%', chgUnit: 'bp', freq: '日', src: 'H15', worse: 'high', rule: '殖利率越高＝資金成本越高' },
  { id: 'DGS10', name: '10 年期公債殖利率', unit: '%', chgUnit: 'bp', freq: '日', src: 'H15', worse: 'high', rule: '殖利率越高＝估值折現率越高' },
  { id: 'T10Y2Y', name: '10 年 − 2 年利差', unit: 'bp', chgUnit: 'bp', freq: '日', src: 'H15', worse: 'low', rule: '越低（越倒掛）越差；由 H.15 的 10 年減 2 年計算，同 FRED T10Y2Y' },
  { id: 'T10Y3M', name: '10 年 − 3 個月利差', unit: 'bp', chgUnit: 'bp', freq: '日', src: 'H15', worse: 'low', rule: '越低（越倒掛）越差；由 H.15 的 10 年減 3 個月計算，同 FRED T10Y3M' },
  { id: 'DTWEXBGS', name: '廣義美元指數', unit: '指數', chgUnit: '%', freq: '日（週更）', src: 'H10', worse: 'high', rule: '美元越強＝全球金融條件越緊' },
  { id: 'BAMLH0A0HYM2', name: '高收益債 OAS', unit: 'bp', chgUnit: 'bp', freq: '日', src: 'FRED', worse: 'high', rule: '利差越寬＝信用風險越高' },
  { id: 'BAMLC0A0CM', name: '投資級公司債 OAS', unit: 'bp', chgUnit: 'bp', freq: '日', src: 'FRED', worse: 'high', rule: '利差越寬＝信用風險越高' },
  { id: 'NFCI', name: '芝加哥 Fed 金融條件指數', unit: '指數', chgUnit: '點', freq: '週', src: 'CHIFED', worse: 'high', rule: '正值＝比平均緊、負值＝比平均鬆' },
];
export const PROXIES = [
  { sym: 'HYG.US', name: 'iShares 高收益公司債 ETF', for: '高收益債 OAS' },
  { sym: 'LQD.US', name: 'iShares 投資級公司債 ETF', for: '投資級 OAS' },
  { sym: 'UUP.US', name: 'Invesco 美元指數多頭 ETF', for: '美元' },
  { sym: 'SHY.US', name: 'iShares 1–3 年公債 ETF', for: '2 年殖利率（反向）' },
  { sym: 'TLT.US', name: 'iShares 20 年以上公債 ETF', for: '長天期殖利率（反向）' },
];
const INDEXES = [{ sym: 'SP500.FS', name: 'S&P 500' }, { sym: 'NDX.FS', name: '那斯達克 100' }];

export function createService({ xq, src, store, log = () => {}, modules = {} }) {
  const S = () => store.db, P = () => store.priv;
  const jobs = {};
  const mem = { klines: {}, panel: null, quotes: null };

  async function job(name, fn) {
    if (jobs[name]?.running) return jobs[name];
    const j = jobs[name] = { running: true, startedAt: Date.now(), error: null, note: null };
    try { j.note = await fn(j) ?? null; } catch (e) { j.error = e.message; log({ at: Date.now(), src: 'JOB', job: name, code: 'ERROR', msg: e.message }); }
    finally { j.running = false; j.endedAt = Date.now(); S().cursors[name] = Date.now(); store.save(); }
    return j;
  }
  const audit = (e) => {
    const k = e.key || JSON.stringify(e);
    if (S().audit.some(a => a.key === k)) return;
    S().audit.unshift({ at: Date.now(), key: k, ...e }); if (S().audit.length > 500) S().audit.length = 500;
  };

  // ---- 1. 日曆＋預估快照（macro_consensus、macro_release）----
  async function captureCalendar() {
    const cal = await xq.macroCalendar(14);
    const now = Date.now(); let added = 0;
    for (const c of cal) {
      const freq = c.frequency === 'W' ? 'W' : c.frequency === 'Q' ? 'Q' : 'M';
      S().calendarItems[c.id] = { name: c.name, unit: c.unit, dec: +c.decimalPlaces || 1, freq, country: countryOf(c.name) };
      const period = periodKey(c.periodDate, freq);
      const k = `${c.id}|${period}`;
      const r = S().releases[k] ||= { xq: c.id, period, periodDate: c.periodDate, prevPeriodDate: c.previousPeriodDate, publishDate: c.nextPublishDate, firstSeenAt: now, dateHistory: [] };
      if (r.publishDate !== c.nextPublishDate) { r.dateHistory.push({ from: r.publishDate, to: c.nextPublishDate, seenAt: now }); r.publishDate = c.nextPublishDate; }
      r.prevPeriodDate = c.previousPeriodDate;
      const est = c.estimateValue === '' || c.estimateValue == null || !isFinite(+c.estimateValue) ? null : +c.estimateValue;
      const lastYear = c.lastYearValue === '' || !isFinite(+c.lastYearValue) ? null : +c.lastYearValue;
      const prev = [...S().consensus].reverse().find(x => x.xq === c.id && x.period === period);
      if (!prev || prev.est !== est || prev.publishDate !== c.nextPublishDate) { S().consensus.push({ xq: c.id, period, est, lastYear, src: 'XQ 經濟日曆', capturedAt: now, publishDate: c.nextPublishDate }); added++; }
    }
    return `日曆 ${cal.length} 筆，新增預估快照 ${added}`;
  }

  // ---- 2. XQ 序列版本快照（只存最新修訂值 → 本站逐日保存成版本）----
  async function snapshotXq(ids) {
    const v = vintageKey(); const sdate = `${+v.slice(0, 4) - 6}-01-01`, edate = v.slice(0, 10);
    let n = 0, fail = 0;
    for (const id of ids) {
      try {
        const it = await xq.macroItem(id, sdate, edate);
        const freq = S().calendarItems[id]?.freq || freqOf(id, BY_XQ[id]?.key === 'claims' || BY_XQ[id]?.key === 'cont_claims' ? 'W' : 'M');
        // 整列缺漏的期間不寫入（不補 0、不插值）；XQ 回傳的 null／非數值已在 xq.macroItem 轉為 null
        const rows = it.series.map(s => ({ period: periodKey(s.date, freq), value: s.value }));
        if (addVintage(S(), `XQ:${id}`, v, rows, { src: 'XQ' })) n++;
        S().calendarItems[id] ||= { name: it.name, unit: '', dec: 1, freq, country: countryOf(it.name || '') };
      } catch (e) { fail++; }
    }
    return `XQ 序列 ${ids.length} 條，新版本 ${n}，失敗 ${fail}`;
  }
  const catalogIds = () => [...new Set([...RELEASES.map(r => r.xq), ...RELEASES.filter(r => r.alt).map(r => r.alt), 'USGB0103'])];

  // ---- 3. BLS 官方值（第二來源）＋核對 ----
  async function captureBls() {
    const ids = [...new Set(RELEASES.filter(r => r.official?.src === 'BLS').map(r => r.official.id))];
    const y = +etNow().date.slice(0, 4);
    const r = await src.bls(ids, y - 4, y);
    const v = vintageKey(); let n = 0;
    for (const [id, rows] of Object.entries(r.series)) if (addVintage(S(), `BLS:${id}`, v, rows, { src: 'BLS' })) n++;
    crossCheck();
    return `BLS ${ids.length} 條，新版本 ${n}${r.meta.stale ? '（舊快取）' : ''}`;
  }
  function crossCheck() {
    for (const rel of RELEASES.filter(r => r.official)) {
      const off = history(S(), `${rel.official.src}:${rel.official.id}`, { tf: rel.official.tf, dec: rel.dec });
      const xqh = history(S(), `XQ:${rel.xq}`, { dec: rel.dec });
      for (const [p, h] of Object.entries(off)) {
        const o = h[h.length - 1].value, x = xqh[p]?.[xqh[p].length - 1]?.value;
        if (x == null) continue;
        if (Math.abs(o - x) > 0.5 * 10 ** -rel.dec + 1e-9) audit({ key: `conflict|${rel.key}|${p}|${x}|${o}`, type: '來源衝突', release: rel.name, period: p, xq: x, official: o, officialSrc: rel.official.src, rule: '以官方來源為準' });
      }
    }
  }

  // ---- 4. ALFRED 版本回補（首次公布值）----
  async function backfillAlfred(j) {
    const today = etNow().date; const [y, m] = today.split('-').map(Number);
    const tasks = [];
    for (const rel of [...RELEASES].sort((a, b) => b.imp - a.imp)) {
      if (!rel.fred || rel.fred.tf === 'k') continue;
      const months = rel.imp >= 3 ? 24 : 12;
      tasks.push({ rel, vintage: today, live: true }); // 當日版本：讓最新一期也有首次公布值（不標記完成，每日重抓）
      for (let i = 0; i <= months; i++) tasks.push({ rel, vintage: monthEnd(y, m - i) });
    }
    let ok = 0, skipped = 0;
    j.total = tasks.length; j.done = 0;
    for (const t of tasks) {
      j.done++;
      if (t.vintage > today) { skipped++; continue; }
      const k = `${t.rel.fred.id}|${t.vintage}`;
      if (S().alfredDone[k] || (t.live && S().vintages[`FRED:${t.rel.fred.id}`]?.[t.vintage])) { skipped++; continue; }
      const cosd = `${+t.vintage.slice(0, 4) - 3}${t.vintage.slice(4, 8)}01`;
      const r = await src.alfredVintage(t.rel.fred.id, t.vintage, cosd); // 失敗即丟出 → 整個工作停止，等退避結束再續
      const freq = t.rel.key === 'gdp' ? 'Q' : 'M';
      const rows = r.rows.map(x => ({ period: periodKey(x.date, freq, { quarterStart: true }), value: x.value }));
      addVintage(S(), `FRED:${t.rel.fred.id}`, t.vintage, rows, { src: 'ALFRED' });
      if (!t.live) S().alfredDone[k] = true; ok++;
      if (ok % 10 === 0) store.save();
    }
    return `ALFRED 匯入 ${ok} 個版本，略過 ${skipped}`;
  }

  // ---- 5. 聯準會 ----
  async function captureFed() {
    const r = await src.fomcHtml();
    const meetings = parseFomc(r.text);
    if (meetings.length) S().fomc = meetings;
    const seps = meetings.filter(x => x.projections).slice(-6);
    for (const mt of seps) {
      if (S().dots[mt.date]) continue;
      try { const h = await src.projHtml(mt.projections); const d = parseDotMedian(h.text); if (d) S().dots[mt.date] = { median: d, url: mt.projections }; } catch { /* 下次再試 */ }
    }
    return `FOMC ${meetings.length} 場，點陣圖 ${Object.keys(S().dots).length} 份`;
  }

  // ---- 市場收盤（反應計算）----
  async function closes(sym) {
    const c = mem.klines[sym];
    if (c && Date.now() - c.at < 30 * 60e3) return c.rows;
    const bars = await xq.kline(sym, 2600);
    const rows = bars.map(b => ({ date: isoDate(b.date), value: b.close }));
    mem.klines[sym] = { at: Date.now(), rows };
    return rows;
  }

  // ---- 官方市場序列（F37）----
  async function marketSeries() {
    const out = {}, meta = {};
    const [y, d, n] = await Promise.allSettled([src.treasuryYields('2015-01-01'), src.broadDollar('2015-01-01'), src.nfci()]);
    if (y.status === 'fulfilled') {
      const Y = y.value; out.DGS2 = Y.DGS2; out.DGS10 = Y.DGS10; out.DGS3MO = Y.DGS3MO;
      const m2 = new Map(Y.DGS2.map(x => [x.date, x.value])), m3 = new Map(Y.DGS3MO.map(x => [x.date, x.value]));
      out.T10Y2Y = Y.DGS10.map(x => ({ date: x.date, ext: x.ext, value: x.value != null && m2.get(x.date) != null ? Math.round((x.value - m2.get(x.date)) * 100) : null }));
      out.T10Y3M = Y.DGS10.map(x => ({ date: x.date, ext: x.ext, value: x.value != null && m3.get(x.date) != null ? Math.round((x.value - m3.get(x.date)) * 100) : null }));
      for (const k of ['DGS2', 'DGS10', 'DGS3MO', 'T10Y2Y', 'T10Y3M']) meta[k] = Y.meta;
    } else for (const k of ['DGS2', 'DGS10', 'T10Y2Y', 'T10Y3M']) meta[k] = { error: y.reason.message };
    if (d.status === 'fulfilled') { out.DTWEXBGS = d.value.DTWEXBGS; meta.DTWEXBGS = d.value.meta; } else meta.DTWEXBGS = { error: d.reason.message };
    if (n.status === 'fulfilled') { out.NFCI = n.value.NFCI; meta.NFCI = n.value.meta; } else meta.NFCI = { error: n.reason.message };
    for (const id of ['BAMLH0A0HYM2', 'BAMLC0A0CM']) {
      try { const r = await src.fred(id, '2015-01-01'); out[id] = r.rows.map(x => ({ date: x.date, value: x.value == null ? null : Math.round(x.value * 100) })); meta[id] = r.meta; }
      catch (e) { meta[id] = { error: e.message, src: 'FRED' }; }
    }
    return { out, meta };
  }

  async function panel({ force = false } = {}) {
    if (!force && mem.panel && Date.now() - mem.panel.at < 10 * 60e3) return mem.panel.data;
    const { out, meta } = await marketSeries();
    const cards = PANEL.map(p => {
      const s = out[p.id]; const m = meta[p.id] || {};
      const info = SOURCE_INFO[p.src];
      if (!s || !s.length) return { ...p, available: false, error: m.error || '無資料', source: info };
      const last = lastObs(s);
      const weekly = p.id === 'NFCI';
      const ch = changeN(s, weekly ? 4 : 20);
      const per = weekly ? 52 : 250;
      const p3 = percentile(s, 3, { expectedPerYear: per }), p10 = percentile(s, 10, { expectedPerYear: per });
      let chg = null;
      if (ch) chg = p.chgUnit === '%' ? (ch.to.value / ch.from.value - 1) * 100 : p.chgUnit === 'bp' && p.unit === '%' ? ch.diff * 100 : ch.diff;
      const spark = s.filter(x => x.value != null).slice(weekly ? -156 : -750).filter((_, i, a) => weekly || i % 3 === 0 || i === a.length - 1);
      return {
        ...p, available: true, source: info, last, change: chg, changeFrom: ch?.from.date || null, changeLabel: weekly ? '近 4 週' : '近 20 個交易日',
        p3, p10, worst3: inWorst(p3?.pct, p.worse), fetchedAt: m.fetchedAt || null, stale: !!m.stale, error: m.error || null, spark,
        lagNote: p.id === 'NFCI' ? `週頻，資料至 ${last.date.slice(5, 7)} 月 ${last.date.slice(8)} 日（週五）` : p.id === 'DTWEXBGS' ? `H.10 每週一發布，資料至 ${last.date}` : last.ext ? `資料至 ${last.date}（財政部當日值，H.15 尚未收錄）` : `資料至 ${last.date}`,
      };
    });
    const avail = cards.filter(c => c.available && c.p3?.pct != null);
    const worst = cards.filter(c => c.worst3);
    const alert = { evaluated: avail.length, total: PANEL.length, worst: worst.map(c => ({ id: c.id, name: c.name, pct: c.p3.pct })), triggered: worst.length >= 3, rule: '3 個以上序列同時進入近 3 年最差 10%（各序列「轉差」方向見卡片）時提示；不給綜合分數' };
    // ETF 代理與恐慌指數
    let quotes = {};
    try { quotes = await xq.quotes([...PROXIES.map(p => p.sym), 'VIX.TF']); } catch (e) { quotes = { error: e.message }; }
    const proxies = PROXIES.map(p => { const q = quotes[p.sym]; return { ...p, price: q ? +q.Price : null, chg: q && q.PreClose ? (q.Price / q.PreClose - 1) * 100 : null, time: q?.Time || null }; });
    let vixUs = null;
    try { const r = await src.fred('VIXCLS', '2024-01-01'); const l = lastObs(r.rows); vixUs = { value: l?.value ?? null, date: l?.date ?? null, stale: r.meta.stale, error: r.meta.error }; } catch (e) { vixUs = { value: null, error: e.message }; }
    const tq = quotes['VIX.TF'];
    const vix = {
      us: { label: 'Cboe VIX（S&P 500 30 日隱含波動）', source: 'FRED VIXCLS（Cboe 收盤）', ...vixUs },
      tw: { label: '台指選擇權波動率指數（XQ 代碼 VIX.TF，XQ 名稱「恐慌指數」）', source: 'XQAPI 即時報價', value: tq ? +tq.Price : null, chg: tq && tq.PreClose ? (tq.Price / tq.PreClose - 1) * 100 : null, time: tq?.Time || null },
      note: 'XQ 的 VIX.FS、VIX.US 也回同一檔台指 VIX（2026-10-18 實測），XQ 沒有美國 VIX 代碼；兩者是不同市場的指數，不可互換。',
    };
    const data = { cards, alert, proxies, vix, computedAt: Date.now() };
    mem.panel = { at: Date.now(), data, series: out };
    return data;
  }
  async function seriesFor(id) { if (!mem.panel) await panel(); return mem.panel.series[id] || []; }

  // ---- F36 日曆檢視 ----
  // 實測（2026-10-18）：XQ 經濟日曆的 estimateValue 在 160／160 筆都等於前一期數值，並非市場共識。
  // 因此：使用者手動輸入的共識（註明來源）優先；XQ 欄位等於前值時標「XQ 預估＝前值」，不拿來算預期差。
  function estimateBefore(xqId, period, utc, publishDate) {
    const cut = utc || Date.parse(publishDate + 'T23:59:59Z');
    const cands = S().consensus.filter(x => x.xq === xqId && x.period === period && x.capturedAt < cut);
    return [...cands].reverse().find(x => x.user) || cands[cands.length - 1] || null;
  }
  function actualOf(rel, xqId, period, dec) {
    if (rel?.official) {
      const h = history(S(), `${rel.official.src}:${rel.official.id}`, { tf: rel.official.tf, dec })[period];
      if (h) { const x = history(S(), `XQ:${xqId}`, { dec })[period]; return { value: h[h.length - 1].value, src: rel.official.src, vintage: h[h.length - 1].vintage, xq: x ? x[x.length - 1].value : null }; }
    }
    const h = history(S(), `XQ:${xqId}`, { dec })[period];
    return h ? { value: h[h.length - 1].value, src: 'XQ', vintage: h[h.length - 1].vintage } : null;
  }
  // 已開發經濟體的物價年增率 > 15%：疑似量級或代碼錯誤（例：XQ 英國 PPI 年增率 26.5%）。規則公開，無第二來源時採用
  const DEVELOPED = ['美國', '英國', '歐元區', '德國', '法國', '義大利', '西班牙', '日本', '加拿大', '澳洲', '紐西蘭', '瑞士', '瑞典', '挪威', '丹麥', '荷蘭', '比利時', '奧地利', '芬蘭', '愛爾蘭', '台灣', '韓國', '南韓', '新加坡', '香港'];
  function magnitudeRule(name, country, v) {
    if (v == null || !DEVELOPED.includes(country)) return null;
    if (/(物價|PPI|CPI|通膨|零售物價)/.test(name) && /年增/.test(name) && Math.abs(v) > 15) return `已開發經濟體物價年增率 ${v}%（> 15%），疑似量級或代碼錯誤，無第二來源可核對`;
    return null;
  }
  /** 一筆公布的完整判讀：預估（含是否等於前值）、前值與修訂、實績、預期差、標準化預期差、狀態 */
  function releaseRow(r, now = Date.now(), { withStd = true } = {}) {
    const rel = BY_XQ[r.xq]; const item = S().calendarItems[r.xq] || {};
    const dec = rel?.dec ?? Math.min(item.dec ?? 1, 2);
    const name = rel?.name || item.name || r.xq; const country = item.country || countryOf(item.name || '');
    const t = releaseTime(r.publishDate, rel?.et);
    const est = estimateBefore(r.xq, r.period, t.utc, r.publishDate);
    const freq = item.freq || 'M';
    const prevPeriod = r.prevPeriodDate ? periodKey(r.prevPeriodDate, freq) : null;
    const xqHist = history(S(), `XQ:${r.xq}`, { dec });
    const priorBefore = prevPeriod ? valueAsOf(S(), `XQ:${r.xq}`, prevPeriod, addDays(r.publishDate, -1), { dec }) : null;
    const priorNow = prevPeriod && xqHist[prevPeriod] ? xqHist[prevPeriod][xqHist[prevPeriod].length - 1] : null;
    const prior = priorBefore ?? priorNow;
    const seriesVals = Object.entries(xqHist).sort().map(([, h]) => h[h.length - 1].value);
    const estIsPrior = !!(est && !est.user && est.est != null && prior && est.est === prior.value);
    const anomaly = est ? (magnitudeRule(item.name || name, country, est.est) || estimateAnomaly(est.est, prior?.value ?? null, seriesVals)) : null;
    const priorAnomaly = magnitudeRule(item.name || name, country, prior?.value);
    const released = t.utc ? now >= t.utc : now >= Date.parse(r.publishDate + 'T23:59:59Z');
    const np = rel ? notPublished(rel.key, r.period) : null;
    const actual = released ? actualOf(rel, r.xq, r.period, dec) : null;
    const actualAnomaly = actual ? magnitudeRule(item.name || name, country, actual.value) : null;
    const genuine = est && est.est != null && !anomaly && !estIsPrior;
    const sur = actual && genuine && !actualAnomaly ? surprise(actual.value, est.est, dec) : null;
    const std = sur && withStd ? standardized(sur.diff, pastSurprises(r.xq, r.period)) : null;
    const vsPrior = actual && prior && !actualAnomaly && !priorAnomaly ? +(actual.value - prior.value).toFixed(dec + 2) : null;
    let status = released ? (actual ? '已公布' : np ? '未公布' : '待更新') : '預定';
    if (r.dateHistory.length) status += `（日期變更：原 ${r.dateHistory[0].from}）`;
    return {
      key: `${r.xq}|${r.period}`, xq: r.xq, relKey: rel?.key || null, name, xqName: item.name || null, country,
      imp: rel?.imp ?? (country === '美國' ? 1 : 0), theme: rel?.theme || null, agency: rel?.agency || null,
      period: r.period, publishDate: r.publishDate, time: t, timeNote: rel?.et ? '依機構慣例時間（XQ 日曆無時間）' : '時間未提供',
      unit: item.unit || rel?.unit, dec,
      estimate: anomaly || estIsPrior ? null : est?.est ?? null, estimateRaw: est?.est ?? null, estimateAt: est?.capturedAt || null, estimateSrc: est?.src || null, estimateUser: !!est?.user, estIsPrior, anomaly,
      lastYear: est?.lastYear ?? null,
      prior: priorAnomaly ? null : prior?.value ?? null, priorAnomaly, priorNow: priorNow?.value ?? null, priorRevision: priorBefore && priorNow && priorBefore.value !== priorNow.value ? +(priorNow.value - priorBefore.value).toFixed(dec + 2) : null,
      actual: actualAnomaly ? null : actual?.value ?? null, actualAnomaly, actualSrc: actual?.src || null, actualXq: actual?.xq ?? null, actualVintage: actual?.vintage || null,
      surprise: sur, std, vsPrior,
      status, notPublishedReason: np?.reason || null, released,
    };
  }
  function pastSurprises(xqId, beforePeriod) {
    return Object.values(S().releases).filter(r => r.xq === xqId && r.period < beforePeriod).sort((a, b) => a.period.localeCompare(b.period))
      .map(r => releaseRow(r, Date.now(), { withStd: false }).surprise?.diff ?? null);
  }
  /** 手動輸入共識預估（例：財經媒體調查），記錄來源與擷取時間；只新增不覆寫 */
  function addConsensus({ xq: id, period, est, source }) {
    const r = S().releases[`${id}|${period}`]; if (!r) throw new Error('找不到此筆公布');
    const t = releaseTime(r.publishDate, BY_XQ[id]?.et);
    if (t.utc && Date.now() >= t.utc) throw new Error('已過公布時間，不可再輸入預估（避免事後預估）');
    const e = { xq: id, period, est: +est, lastYear: null, src: `使用者輸入：${source}`, user: true, capturedAt: Date.now(), publishDate: r.publishDate };
    S().consensus.push(e); store.save(); return e;
  }
  function estimateStats() {
    let eq = 0, tot = 0;
    for (const c of S().consensus) {
      if (c.user || c.est == null) continue;
      const r = S().releases[`${c.xq}|${c.period}`]; if (!r?.prevPeriodDate) continue;
      const freq = S().calendarItems[c.xq]?.freq || 'M';
      const v = valueAsOf(S(), `XQ:${c.xq}`, periodKey(r.prevPeriodDate, freq), new Date(c.capturedAt).toISOString().slice(0, 10), { dec: 4 });
      if (!v) continue; tot++; if (v.value === c.est) eq++;
    }
    return { equalPrior: eq, total: tot };
  }
  function calendarView({ from, to, nonUS = false, minImp = 0 }) {
    const rows = Object.values(S().releases).filter(r => r.publishDate >= from && r.publishDate <= to).map(r => releaseRow(r))
      .filter(x => (nonUS || x.country === '美國') && x.imp >= minImp);
    // 同日其他事件標記
    const byDate = {};
    for (const x of rows) if (x.country === '美國' && x.imp >= 2) (byDate[x.publishDate] ||= []).push(x.name);
    for (const m of S().fomc) (byDate[m.date] ||= []).push('FOMC 決議');
    for (const x of rows) x.sameDay = (byDate[x.publishDate] || []).filter(n => n !== x.name);
    rows.sort((a, b) => (a.time.utc || Date.parse(a.publishDate)) - (b.time.utc || Date.parse(b.publishDate)) || b.imp - a.imp);
    return rows;
  }
  function weekRange(which) {
    // 以台灣日期為準（使用者週一早上規劃本週）；週六、週日打開時「本週」＝即將到來的週一起
    const d = twTime(Date.now()).date; const wd = new Date(d + 'T12:00:00Z').getUTCDay(); // 0=日
    const thisMon = wd === 0 ? addDays(d, 1) : wd === 6 ? addDays(d, 2) : addDays(d, 1 - wd);
    if (which === 'this') return { from: thisMon, to: addDays(thisMon, 6) };
    if (which === 'next') return { from: addDays(thisMon, 7), to: addDays(thisMon, 13) };
    if (which === 'recent') return { from: addDays(d, -7), to: d };
    return { from: addDays(d, -30), to: addDays(d, 30) };
  }

  // ---- F36-3 單一數據：首次公布 vs 目前、缺值、修訂 ----
  function releaseDetail(key) {
    const rel = BY_KEY[key]; if (!rel) return null;
    const dec = rel.dec; const freq = rel.key === 'gdp' ? 'Q' : ['claims', 'cont_claims'].includes(rel.key) ? 'W' : 'M';
    const xqH = history(S(), `XQ:${rel.xq}`, { dec });
    const offH = rel.official ? history(S(), `${rel.official.src}:${rel.official.id}`, { tf: rel.official.tf, dec }) : {};
    const fredH = rel.fred && rel.fred.tf !== 'k' ? history(S(), `FRED:${rel.fred.id}`, { tf: rel.fred.tf, dec }) : {};
    const altH = rel.alt ? history(S(), `XQ:${rel.alt}`, { dec }) : null;
    const earliestFred = Object.keys(S().vintages[`FRED:${rel.fred?.id}`] || {}).sort()[0] || null;
    const periods = new Set([...Object.keys(xqH), ...Object.keys(offH), ...Object.keys(fredH), ...(altH ? Object.keys(altH) : [])]);
    const sorted = [...periods].sort();
    const recent = sorted.slice(-30);
    const missing = gaps(Object.keys(xqH), freq).filter(p => p >= (recent[0] || ''));
    const offMissing = rel.official ? gaps(Object.keys(offH), freq) : [];
    const allP = [...new Set([...recent, ...missing])].sort();
    const rows = allP.map(p => {
      const x = xqH[p], o = offH[p], f = fredH[p];
      const np = notPublished(rel.key, p);
      const cur = o ? o[o.length - 1] : x ? x[x.length - 1] : f ? f[f.length - 1] : null;
      // 首次公布值只在「看得到該期從無到有」時成立：最早含該期的版本若就是已匯入的最早版本，無法判定首次公布
      const fvc0 = f && f.length ? firstVsCurrent(f) : null;
      const fvc = fvc0 && fvc0.first.vintage !== earliestFred ? fvc0 : null;
      const selfFirst = x ? x[0] : null;
      return {
        period: p, current: cur?.value ?? null, currentSrc: o ? rel.official.src : x ? 'XQ' : f ? 'ALFRED' : null,
        xq: x ? x[x.length - 1].value : null, official: o ? o[o.length - 1].value : null, alt: altH?.[p] ? altH[p][altH[p].length - 1].value : null,
        first: fvc ? fvc.first.value : null, firstVintage: fvc ? fvc.first.vintage : null, alfredCurrent: fvc ? fvc.current.value : null,
        // 修訂次數＝ALFRED 版本間改值次數，加上目前官方值與最新 ALFRED 版本不同（最近一次發布又修訂）
        revisions: fvc ? fvc.revisions + (cur && cur.value !== fvc.current.value ? 1 : 0) : null,
        selfFirst: selfFirst?.value ?? null, selfFirstVintage: selfFirst?.vintage ?? null, selfRevisions: x ? x.length - 1 : null,
        status: cur ? '已公布' : np ? '未公布' : '缺資料', reason: !cur ? (np?.reason || 'XQ 與官方來源皆無此期資料') : null,
        conflict: x && o && Math.abs(x[x.length - 1].value - o[o.length - 1].value) > 0.5 * 10 ** -dec + 1e-9,
      };
    });
    const lastXq = Object.keys(xqH).sort().pop();
    const today = etNow().date;
    const estHist = S().consensus.filter(c => c.xq === rel.xq).slice(-40);
    const rels = Object.values(S().releases).filter(r => r.xq === rel.xq).map(r => releaseRow(r)).sort((a, b) => b.period.localeCompare(a.period));
    return {
      release: rel, freq, rows: rows.reverse(), missing, offMissing,
      xqStale: staleness(lastXq, freq, today), lastXq,
      alfred: { fredId: rel.fred?.id || null, vintages: Object.keys(S().vintages[`FRED:${rel.fred?.id}`] || {}).length },
      self: { since: Object.keys(S().vintages[`XQ:${rel.xq}`] || {}).sort()[0] || null },
      estimates: estHist, releases: rels,
      sources: { xq: `XQ ${rel.xq}`, official: rel.official ? `${rel.official.src} ${rel.official.id}（${rel.official.tf}）` : null, alfred: rel.fred ? `ALFRED ${rel.fred.id}（${rel.fred.tf}）` : null, alt: rel.alt ? `XQ ${rel.alt}` : null },
    };
  }

  // ---- F36-4 公布後跨資產反應 ----
  async function reactionOn(date, sym) {
    const ser = (await marketSeries()).out;
    const assets = [
      { id: 'DGS2', name: '2 年期殖利率', mode: 'bp', s: ser.DGS2, src: 'Fed H.15' },
      { id: 'DGS10', name: '10 年期殖利率', mode: 'bp', s: ser.DGS10, src: 'Fed H.15' },
      { id: 'DTWEXBGS', name: '廣義美元指數', mode: 'pct', s: ser.DTWEXBGS, src: 'Fed H.10（紐約中午匯率）' },
    ];
    for (const ix of INDEXES) assets.push({ id: ix.sym, name: ix.name, mode: 'pct', s: await closes(ix.sym).catch(() => []), src: 'XQ 日K' });
    assets.push({ id: 'UUP.US', name: '美元 ETF（UUP，代理）', mode: 'pct', s: await closes('UUP.US').catch(() => []), src: 'XQ 日K', proxy: true });
    if (sym) assets.push({ id: sym, name: `自選 ${sym.replace('.US', '')}`, mode: 'pct', s: await closes(sym).catch(() => []), src: 'XQ 日K（分割調整、未含股利）' });
    const rows = assets.map(a => { const r = a.s && a.s.length ? reaction(a.s, date, { mode: a.mode }) : null; return { id: a.id, name: a.name, src: a.src, proxy: !!a.proxy, unit: a.mode === 'bp' ? 'bp' : '%', ...(r || { change: null, note: a.s?.length ? `${date} 無收盤（休市或資料尚未更新）` : '無資料' }) }; });
    const others = calendarView({ from: date, to: date }).filter(x => x.imp >= 2).map(x => x.name);
    if (S().fomc.some(m => m.date === date)) others.push('FOMC 決議');
    return { date, rows, others, note: '公布前一交易日收盤 → 公布當日收盤；同日可能有其他事件（財報、談話、地緣政治），變化不等於此數據的影響' };
  }

  // ---- F36-5 聯準會 ----
  async function fedView() {
    const t = await src.fedTarget('2015-01-01');
    const rows = t.rows;
    const changes = [];
    for (let i = 1; i < rows.length; i++) if (rows[i].upper !== rows[i - 1].upper || rows[i].lower !== rows[i - 1].lower) {
      const eff = rows[i].date;
      const mt = [...S().fomc].reverse().find(m => m.date < eff && m.date >= addDays(eff, -7)) || null;
      changes.push({ effective: eff, from: [rows[i - 1].lower, rows[i - 1].upper], to: [rows[i].lower, rows[i].upper], bp: Math.round((rows[i].upper - rows[i - 1].upper) * 100), meeting: mt?.date || null, unscheduled: mt?.unscheduled || false, statement: mt?.statement || null });
    }
    const today = etNow().date;
    const upcoming = S().fomc.filter(m => m.date >= today).slice(0, 4).map(m => ({ ...m, tw: releaseTime(m.date, '14:00').tw }));
    const past = S().fomc.filter(m => m.date < today).slice(-8).reverse();
    const lastSep = Object.keys(S().dots).sort().pop();
    const xqMonthly = (() => { const h = history(S(), 'XQ:EI020122', { dec: 2 }); return Object.entries(h).sort().slice(-14).map(([p, v]) => ({ period: p, value: v[v.length - 1].value })); })();
    const daily = rows.filter((_, i) => i % 1 === 0).map(r => ({ date: r.date, lower: r.lower, upper: r.upper, effr: r.effr }));
    return { current: rows[rows.length - 1], daily, changes: changes.reverse(), upcoming, past, dots: lastSep ? { date: lastSep, ...S().dots[lastSep] } : null, dotsAll: S().dots, xqMonthly, meta: t.meta, note: '市場隱含利率機率（CME FedWatch）需授權，取得前不顯示；點陣圖是與會者個人預測的中位數，不是聯準會承諾。' };
  }

  // ---- F37-6 持股疊加 ----
  async function overlay(sym, seriesId) {
    const s = await seriesFor(seriesId);
    const bars = await closes(sym);
    const st = bars.map(b => ({ date: b.date, close: b.value }));
    const from = addDays(etNow().date, -365);
    const scale = seriesId === 'DGS10' ? 100 : 1; // 10 年殖利率換成 bp；OAS 已是 bp
    const p = pairedChanges(st, s, { from, scale });
    const sMap = new Map(s.map(x => [x.date, x.value]));
    const chart = st.filter(b => b.date >= from).map(b => ({ date: b.date, close: b.close, series: sMap.get(b.date) ?? null }));
    return { sym, seriesId, n: p.n, r: p.r, from, chart, note: `近 1 年同日配對：${sym.replace('.US', '')} 日報酬（%）vs ${seriesId === 'DGS10' ? 'Δ10 年殖利率（bp）' : 'Δ高收益債 OAS（bp）'}；只列相關係數與樣本數，不代表因果` };
  }

  // ---- F36-7 觀察條件 → 模組 01 ----
  function conditionValues(c) {
    if (c.metric === 'surprise') return Object.values(S().releases).filter(r => r.xq === BY_KEY[c.relKey].xq).map(r => releaseRow(r)).filter(x => x.surprise).sort((a, b) => a.period.localeCompare(b.period)).map(x => ({ period: x.period, value: x.surprise.diff }));
    const d = releaseDetail(c.relKey); return d ? d.rows.filter(r => r.current != null).map(r => ({ period: r.period, value: r.current })).sort((a, b) => a.period.localeCompare(b.period)) : [];
  }
  function conditionsView() { return Object.values(P().conditions).map(c => ({ ...c, eval: evalCondition(conditionValues(c), c) })); }

  function xqHealth(id) {
    const h = history(S(), `XQ:${id}`, { dec: 2 }); const ps = Object.keys(h).sort(); const freq = S().calendarItems[id]?.freq || 'M';
    const st = staleness(ps[ps.length - 1], freq, etNow().date);
    return { name: S().calendarItems[id]?.name || null, last: ps[ps.length - 1] || null, count: ps.length, gaps: gaps(ps, freq).filter(p => p >= `${+etNow().date.slice(0, 4) - 2}`), ...st };
  }

  // ---- 排程 ----
  async function refreshAll() {
    await job('calendar', captureCalendar);
    await job('xqSeries', () => snapshotXq(catalogIds()));
    await job('fed', captureFed);
    if (!S().cursors.bls || Date.now() - S().cursors.bls > 20 * 3600e3) await job('bls', captureBls);
    await job('panel', async () => { const p = await panel({ force: true }); return `面板 ${p.cards.filter(c => c.available).length}/${p.cards.length}`; });
    // 非美國日曆指標：每日一次（異常預估偵測用）
    if (!S().cursors.xqOther || Date.now() - S().cursors.xqOther > 20 * 3600e3) {
      const ids = Object.keys(S().calendarItems).filter(id => !catalogIds().includes(id));
      job('xqOther', () => snapshotXq(ids));
    }
    if (!jobs.alfred?.running && (!S().cursors.alfred || Date.now() - S().cursors.alfred > 6 * 3600e3)) job('alfred', backfillAlfred);
  }
  /** 公布日：公布後 60 分鐘內每 5 分鐘重抓該指標（規格：15 分鐘內填入實績） */
  async function tick() {
    const now = Date.now();
    const due = Object.values(S().releases).filter(r => { const t = releaseTime(r.publishDate, BY_XQ[r.xq]?.et); return BY_XQ[r.xq] && t.utc && now >= t.utc && now - t.utc < 90 * 60e3; });
    if (due.length) { await job('postRelease', () => snapshotXq([...new Set(due.map(r => r.xq))])); if (due.some(r => BY_XQ[r.xq].official)) { S().cursors.bls = 0; } }
    if (!S().cursors.full || now - S().cursors.full > 60 * 60e3) { S().cursors.full = now; await refreshAll(); }
  }

  return { jobs, tick, refreshAll, captureCalendar, snapshotXq, captureBls, backfillAlfred, captureFed, panel, calendarView, weekRange, releaseDetail, reactionOn, fedView, overlay, conditionsView, conditionValues, closes, catalogIds, releaseRow, xqHealth, addConsensus, estimateStats };
}
