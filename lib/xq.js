// xq.js — XQAPI 接入（server-only）。所有上游請求走同一條序列化 lane（concurrency=1）＋斷路器。
// path 與語義以 MANIFEST 為準（2026-10-17 以 NVDA.US、TSM.US 實測）。
import { performance } from 'node:perf_hooks';

export class AdapterError extends Error {
  constructor(code, message, { retryable = false, status = null, mappingId = null } = {}) { super(message); this.code = code; this.retryable = retryable; this.status = status; this.mappingId = mappingId; }
}

export const MANIFEST = {
  symbols: { path: '/symbolinfo/symbols', note: 'stockIDs 逗號分隔；無效代號回空 data 而非 errors，需逐檔檢查' },
  quotes: { path: '/rtquote/quotes', note: '每次最多 10 檔（超過回 HTTP 500）；Time 為台北時間，美股收盤 04:00 跨午夜' },
  kline: { path: '/symbolinfo/kline', note: '美股 freqType=11（還原）回空陣列，只能用 8（分割調整、未含股利）；指數 SOXX.FS／NDX.FS／SP500.FS 的日K收盤正確（費半 10/16 收 11,137.29），即時報價的 SOXX.FS Price 卻回 49339，不可用；freqType=8 日K，新→舊；美股為分割調整價；美東盤中含未完成當日K' },
  minuteKline: { path: '/rtquote/minutekline', note: '美股回空資料（實測 NVDA/TSM），盤中事件定位暫用日K' },
  news: { path: '/news/stock2', note: 'date/time 為台北時間；titleOnly=false 帶約 200 字 content 與 relatedIDs；count==maxCount 視為可能截斷' },
  rating: { path: '/research-report/us-stock-rating', note: 'rating 為平均評等分數（方向待確認，只報數值）；dDate＝資料可得日，比 date 晚 2–5 天' },
  targetPrice: { path: '/research-report/us-stock-target-price', note: '最多約 20 筆；lastRevDate 修訂日、dDate 可得日' },
  callSummary: { path: '/research-report/us-earnings-call-summary-v2', note: 'repDate 會議日（只到日）；publishOn 為台北時間；metrics 的 Beat/Meet 相對公司財測' },
  transcript: { path: '/research-report/us-earnings-call-transcript', note: '必須帶 startDate/endDate（不帶回 0 筆）；預設只回 5 筆，maxCount 可放大；講者為 SPEAKER_nn／None，無時間碼；撇號被轉成雙引號；偶有錯誤字串（MSFT 2024/1Q 回 36 字 Python 例外訊息）' },
  researchStock: { path: '/research-report/stock', note: '研報摘要：symbol 參數；reports[].content 五段（公司簡介、營運概況、產業競爭、未來發展、目標價），未標示原始研究機構；TSM.US 回 0 篇（實測 2026-10-17）' },
  relation: { path: '/datamatrix/basic/relation', note: 'dataType=company-relationship：依產品列 vendors／customers／competitors；只支援台股（NVDA.US 回 HTTP 400）；無日期、來源、營收占比；同一客戶可重複出現；非上市實體 ticker 為空字串（2026-10-17 實測）' },
  macroCalendar: { path: '/macroeconomic/calendar', note: '只回未來 days 天（預設 7）的預定公布：nextPublishDate（只有日期、無時間）、預估值、去年同期值、前期日期；沒有實績與前值；查不到過去日期' },
  macroItem: { path: '/macroeconomic/item', note: '指標序列只存最新修訂值、無版本；USCA0019 缺 2025-10；USGB0103 停在 2026-02；EI020122 為月底值且有缺月' },
  xsField: { path: '/xs/field-data', note: 'frequency=8（日）才有值；季頻 14 回日曆季空值（實測）。3661 EPS 預估、3662 法說公佈 EPS：每季一列，日期約在前一季財報後 2 天，內容是「下一季」的預估與（事後回填的）實績' },
  groups: { path: '/symbolinfo/groups', note: 'keyword 搜尋分類與成分股；美股指數群組 G11530010 道瓊、G11530020 那斯達克100、G11530030 費城半導體、G11530040 標普500' },
  basicInfo: { path: '/datamatrix/basic/information', note: '市值文字單位逐筆不同（兆／億），只用於大群組的同業排序，不用於估值' },
  finance: { path: '/datamatrix/finance', note: '含 Financial Report Release Date（歷史公布日）；季別為財政季' },
};

export function createLane({ baseUrl, timeoutMs = 20000, log = () => {} }) {
  const queue = [];
  let running = false;
  const cb = { consecutive: 0, openUntil: 0 };
  const stats = { requests: 0, errors: 0, lastLatencyMs: null };
  async function pump() {
    if (running) return; running = true;
    while (queue.length) {
      const t = queue.shift();
      try { t.resolve(await doRequest(t.mappingId, t.query)); } catch (e) { t.reject(e); }
    }
    running = false;
  }
  async function doRequest(mappingId, query) {
    const now = Date.now();
    if (cb.openUntil > now) throw new AdapterError('UPSTREAM_FAILED', '斷路器開啟中', { retryable: true, mappingId });
    const halfOpen = cb.openUntil && cb.openUntil <= now;
    const url = new URL(baseUrl + MANIFEST[mappingId].path);
    for (const [k, v] of Object.entries(query || {})) if (v != null && v !== '') url.searchParams.set(k, String(v));
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const t0 = performance.now(); let status = null, err = null, body = null;
    stats.requests++;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
      status = res.status;
      const text = await res.text();
      try { body = JSON.parse(text); } catch { body = null; }
      const msg = body && typeof body.error === 'string' ? body.error : null;
      if (status === 401) err = new AdapterError('AUTH_FAILED', '未授權', { status, mappingId });
      else if (status === 403) err = new AdapterError('NOT_ENTITLED', '帳戶未授權此資料', { status, mappingId });
      else if (status === 429) err = new AdapterError('RATE_LIMITED', '上游限流', { status, retryable: true, mappingId });
      else if (status === 400 || status === 404) err = new AdapterError('BAD_REQUEST', msg || `HTTP ${status}`, { status, mappingId });
      else if (status >= 500 && msg && /最多|格式|代碼|不支援|參數/.test(msg)) err = new AdapterError('BAD_REQUEST', msg, { status, mappingId });
      else if (status >= 500) err = new AdapterError('UPSTREAM_FAILED', msg || `HTTP ${status}`, { status, retryable: true, mappingId });
      else if (msg) err = new AdapterError('BAD_REQUEST', msg, { status, mappingId });
      else if (body == null) err = new AdapterError('SCHEMA_DRIFT', '回應不是 JSON', { status, mappingId });
    } catch (e) {
      err = new AdapterError('TIMEOUT', e.name === 'AbortError' ? '逾時' : `連線失敗：${e.message}`, { retryable: true, mappingId });
    } finally { clearTimeout(timer); }
    const ms = Math.round(performance.now() - t0);
    stats.lastLatencyMs = ms;
    log({ at: Date.now(), src: 'XQ', mappingId, status, ms, code: err?.code || 'OK', sym: query?.stockID || query?.symbol || query?.symbols || null });
    if (err?.retryable) {
      stats.errors++; cb.consecutive++;
      if (cb.consecutive >= 5 || halfOpen) { cb.openUntil = Date.now() + 3 * 60e3; cb.consecutive = 0; }
      throw err;
    }
    cb.consecutive = 0; if (halfOpen) cb.openUntil = 0;
    if (err) { stats.errors++; throw err; }
    return body;
  }
  return {
    call(mappingId, query) { return new Promise((resolve, reject) => { queue.push({ mappingId, query, resolve, reject }); pump(); }); },
    status: () => ({ queued: queue.length, circuitOpenUntil: cb.openUntil || null, ...stats }),
  };
}

const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

export function createXq(lane) {
  return {
    async symbols(ids) {
      const out = {};
      for (const part of chunk(ids, 40)) {
        const r = await lane.call('symbols', { stockIDs: part.join(',') });
        for (const d of r.data || []) if (d.data && d.data.Name) out[d.stockID] = { ...d.data, groups: d.groups || [] };
      }
      return out;
    },
    async quotes(ids) {
      const out = {};
      for (const part of chunk(ids, 10)) {
        const r = await lane.call('quotes', { symbols: part.join(','), fieldname: 'english' });
        for (const q of (Array.isArray(r) ? r : r.data || [])) if (q && q.ID && q.Price != null) out[q.ID] = q;
      }
      return out;
    },
    async kline(id, count = 260) {
      const r = await lane.call('kline', { stockID: id, freqType: 8, baseDate: 0, count });
      return (r.data || []).map(b => ({ date: String(b.date), open: +b.open, high: +b.high, low: +b.low, close: +b.close, volume: +b.volume })).filter(b => b.close > 0).sort((a, b) => a.date.localeCompare(b.date));
    },
    async news(id, beginDate, endDate, maxCount = 200, { titleOnly = false } = {}) {
      const r = await lane.call('news', { symbol: id, beginDate, endDate, maxCount, titleOnly });
      return { items: r.news || [], truncated: (r.count ?? 0) >= maxCount };
    },
    /** XS 欄位（日頻）：回 [{ date:'YYYY-MM-DD', value, publishDate? }]，舊→新，空值剔除 */
    async xsField(id, fieldId, limit = 400) {
      const r = await lane.call('xsField', { symbolId: id, fieldId, frequency: 8, limit, from: -1 });
      const arr = Array.isArray(r) ? r : r.data || r.value || [];
      return arr.filter(x => x && x.value != null && isFinite(+x.value)).map(x => ({ date: String(x.date).slice(0, 10), value: +x.value, publishDate: x.publishDate || null })).sort((a, b) => a.date.localeCompare(b.date));
    },
    /** XS 欄位（月頻 frequency=10）：回 [{ month:'YYYY-MM', value, publishDate:'YYYYMMDD'|null }] 舊→新 */
    async xsMonthly(id, fieldId, limit = 30) {
      const r = await lane.call('xsField', { symbolId: id, fieldId, frequency: 10, limit, from: -1 });
      const arr = Array.isArray(r) ? r : r.data || [];
      return arr.map(x => ({ month: String(x.date).slice(0, 7), value: x.value == null || !isFinite(+x.value) ? null : +x.value, publishDate: /^\d{8}$/.test(String(x.publishDate || '')) ? String(x.publishDate) : null })).sort((a, b) => a.month.localeCompare(b.month));
    },
    async relation(id) { const r = await lane.call('relation', { symbol: id, dataType: 'company-relationship' }); return Array.isArray(r) ? r : (r.data || []); },
    async searchGroups(keyword) { const r = await lane.call('groups', { keyword }); const a = Array.isArray(r) ? r : r.data || []; return [...new Map(a.map(g => [g.id, g])).values()]; },
    async macroCalendar(days = 14) { const r = await lane.call('macroCalendar', { days }); return r.data || []; },
    async macroItem(id, sdate, edate) { const r = await lane.call('macroItem', { id, sdate, edate }); return { id: r.id, name: r.name, series: (r.series || []).map(s => ({ date: String(s.date).slice(0, 10), value: s.value == null || !isFinite(+s.value) ? null : +s.value })).sort((a, b) => a.date.localeCompare(b.date)) }; },
    async groupMembers(keyword, id) {
      const r = await lane.call('groups', { keyword });
      const g = (Array.isArray(r) ? r : r.data || []).find(x => x.id === id);
      return g ? { id: g.id, name: g.name, members: (g.stocks || []).filter(s => /\.US$/.test(s)) } : null;
    },
    async basicInfo(id) {
      const r = await lane.call('basicInfo', { symbol: id });
      const f = Array.isArray(r) ? r : r.fields || r.data || [];
      const get = (n) => f.find(x => x.name === n)?.values?.[0] || null;
      const mv = get('Market Value'), unit = f.find(x => x.name === 'Market Value')?.unit;
      return { marketValueText: mv ? `${mv.value} ${unit}` : null, marketValue: mv ? +mv.value * ({ '兆': 1e12, '億': 1e8, '萬': 1e4 }[unit] || 1) : null, industry: get('Industry')?.value || '', zack: get('Zack Industry Classification')?.value || '' };
    },
    async ratings(id) { const r = await lane.call('rating', { stockID: id }); return r.ratings || []; },
    async targetPrices(id) { const r = await lane.call('targetPrice', { stockID: id, count: 20 }); return r.targetPrices || []; },
    async transcripts(id, startDate, endDate, maxCount = 12) { const r = await lane.call('transcript', { stockID: id, startDate, endDate, maxCount, includeTranscript: true }); return { items: r.transcripts || [], total: r.total ?? null }; },
    async researchReports(id, count = 10) { const r = await lane.call('researchStock', { symbol: id, count }); return r.reports || []; },
    /** 全市場法說摘要（不帶 stockID）：includeSummary=true 才有完整欄位，否則只有 takeaway 等輕量欄位 */
    async marketSummaries(startDate, endDate, maxCount = 200) { const r = await lane.call('callSummary', { startDate, endDate, maxCount, includeSummary: true, language: 'tw' }); return { items: r.summaries || [], total: r.total ?? null }; },
    async callSummaries(id, maxCount = 4) { const r = await lane.call('callSummary', { stockID: id, maxCount, includeSummary: true, language: 'tw' }); return r.summaries || []; },
    /** 季報三表：回傳 { fieldName: { cName, unit, values: { '2027/Q2': '123.0' } } } */
    async financeReport(id, count = 20) {
      const r = await lane.call('finance', { symbol: id, metrics: 'financial-report', count });
      const v = r['financial-report'];
      if (typeof v === 'string' || !v) throw new AdapterError('NO_DATA', typeof v === 'string' ? v.slice(0, 160) : '無季報資料', { mappingId: 'finance' });
      const q = (Array.isArray(v) ? v : [v]).find(b => b.period === 'Q');
      if (!q) throw new AdapterError('NO_DATA', '無季報（Q）區塊', { mappingId: 'finance' });
      const out = {};
      for (const f of q.fields || []) out[f.name] = { cName: f.cName, unit: f.unit, values: Object.fromEntries((f.values || []).map(x => [x.date, x.value])) };
      return out;
    },
    async releaseDates(id) {
      const r = await lane.call('finance', { symbol: id, metrics: 'eps', count: 8 });
      const blocks = Array.isArray(r.eps) ? r.eps : [];
      const q = blocks.find(b => b.period !== 'Y') || blocks[0];
      const rel = (q?.fields || []).find(f => f.name === 'Financial Report Release Date');
      return (rel?.values || []).map(v => ({ period: v.date, release: String(v.value || '').replace(/\D/g, '') })).filter(v => v.release.length === 8);
    },
  };
}
