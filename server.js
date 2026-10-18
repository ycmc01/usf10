// server.js — 美股總經風險台（XQ 美股版 模組10）。單一 Node 行程：靜態前端＋/api＋排程。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLane, createXq, MANIFEST } from './lib/xq.js';
import { openStore, uid } from './lib/store.js';
import { createSources, SOURCE_INFO } from './lib/sources.js';
import { createService, PANEL, PROXIES } from './lib/service.js';
import { RELEASES, BY_KEY, NOT_PUBLISHED } from './lib/catalog.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 10505);
const XQ_BASE = (process.env.XQ_BASE_URL || 'https://mrtuat.xq.com.tw/SysjustMCP').replace(/\/$/, '');
const MOD = { m01: 'http://127.0.0.1:10496', m09: 'http://127.0.0.1:10504' };
const providerLog = [];
const logp = (e) => { providerLog.unshift(e); if (providerLog.length > 400) providerLog.length = 400; };
const lane = createLane({ baseUrl: XQ_BASE, log: logp });
const xq = createXq(lane);
const store = openStore(path.join(ROOT, 'data'));
const src = createSources({ dataDir: path.join(ROOT, 'data'), log: logp });
const svc = createService({ xq, src, store, log: logp, modules: MOD });

class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const need = (c, s, m) => { if (!c) throw new ApiError(s, m); };
const normSym = (s) => { const x = String(s || '').trim().toUpperCase(); need(/^[A-Z0-9.\-]{1,12}$/.test(x), 400, '代碼格式錯誤'); return x.endsWith('.US') ? x : x + '.US'; };
const getJson = async (url, opt = {}) => { const r = await fetch(url, { ...opt, signal: AbortSignal.timeout(8000) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new ApiError(502, j.error || `HTTP ${r.status}`); return j; };

const routes = [];
const R = (m, p, fn) => routes.push({ method: m, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });
R('GET', '/health/live', () => ({ ok: true }));
R('GET', '/api/meta', () => ({ now: Date.now(), modules: MOD, sources: SOURCE_INFO, releases: RELEASES.map(r => ({ key: r.key, name: r.name, xq: r.xq, agency: r.agency, et: r.et, imp: r.imp, unit: r.unit, theme: r.theme })), panel: PANEL, proxies: PROXIES, notPublished: NOT_PUBLISHED, fredKey: src.hasFredKey }));
R('GET', '/api/calendar', ({ q }) => {
  const range = q.get('range') || 'this';
  const w = svc.weekRange(range);
  return { range, ...w, rows: svc.calendarView({ ...w, nonUS: q.get('nonUS') === '1' }), lastCapture: store.db.cursors.calendar || null, estimateStats: svc.estimateStats(), consensusCount: store.db.consensus.length, since: store.db.meta.createdAt };
});
R('GET', '/api/release/:key', ({ params }) => { const d = svc.releaseDetail(params.key); need(d, 404, '找不到此數據'); return d; });
R('GET', '/api/reaction', async ({ q }) => { const d = q.get('date'); need(/^\d{4}-\d{2}-\d{2}$/.test(d || ''), 400, '日期格式 YYYY-MM-DD'); return svc.reactionOn(d, q.get('sym') ? normSym(q.get('sym')) : null); });
R('POST', '/api/consensus', ({ body }) => { need(body.est !== '' && isFinite(+body.est), 400, '預估須為數字'); need(String(body.source || '').trim(), 400, '請註明預估來源'); try { return svc.addConsensus({ xq: body.xq, period: body.period, est: +body.est, source: String(body.source).trim().slice(0, 60) }); } catch (e) { throw new ApiError(400, e.message); } });
R('GET', '/api/fed', () => svc.fedView());
R('GET', '/api/panel', ({ q }) => svc.panel({ force: q.get('force') === '1' }));
R('GET', '/api/overlay', async ({ q }) => { const s = q.get('series') || 'DGS10'; need(['DGS10', 'BAMLH0A0HYM2'].includes(s), 400, '序列須為 DGS10 或 BAMLH0A0HYM2'); return svc.overlay(normSym(q.get('sym')), s); });
R('GET', '/api/search', ({ q }) => {
  const k = String(q.get('q') || '').trim(); need(k, 400, '請輸入關鍵字');
  const out = [];
  if (/恐慌|VIX|波動/i.test(k)) out.push({ kind: 'vix', title: 'Cboe VIX（S&P 500 30 日隱含波動）', where: '跨資產 → 恐慌指數對照', src: 'FRED VIXCLS' }, { kind: 'vix', title: '台指選擇權波動率指數（XQ VIX.TF「恐慌指數」）', where: '跨資產 → 恐慌指數對照', src: 'XQAPI' });
  for (const r of RELEASES) if (r.name.includes(k) || r.key.includes(k.toLowerCase()) || r.xq === k.toUpperCase()) out.push({ kind: 'release', title: r.name, key: r.key, where: '數據詳情' });
  for (const p of PANEL) if (p.name.includes(k) || p.id.includes(k.toUpperCase())) out.push({ kind: 'panel', title: p.name, id: p.id, where: '跨資產' });
  return out;
});

R('GET', '/api/holdings', () => store.priv.holdings);
R('POST', '/api/holdings', ({ body }) => { const h = [...new Set((body.holdings || []).map(normSym))].slice(0, 30); store.priv.holdings = h; store.savePrivate(); return h; });

R('GET', '/api/conditions', () => svc.conditionsView());
R('POST', '/api/conditions', ({ body }) => {
  need(BY_KEY[body.relKey], 400, '數據不存在');
  need(['actual', 'surprise'].includes(body.metric), 400, '指標須為 actual 或 surprise');
  need(['>', '>=', '<', '<='].includes(body.op), 400, '比較運算錯誤');
  need(body.value !== '' && isFinite(+body.value), 400, '門檻須為數字');
  const n = Math.max(1, Math.min(12, +body.n || 1));
  const rel = BY_KEY[body.relKey];
  const label = String(body.label || '').trim() || `${rel.name}${body.metric === 'surprise' ? '預期差' : ''} ${body.op} ${body.value}${rel.unit === '%' ? '%' : ''}${n > 1 ? ` 連 ${n} 次` : ''}`;
  const id = uid('m');
  store.priv.conditions[id] = { id, relKey: body.relKey, metric: body.metric, op: body.op, value: +body.value, n, label, createdAt: Date.now(), pushed: [] };
  store.savePrivate();
  return store.priv.conditions[id];
});
R('DELETE', '/api/conditions/:id', ({ params }) => { need(store.priv.conditions[params.id], 404, '找不到條件'); delete store.priv.conditions[params.id]; store.savePrivate(); return { ok: true }; });
R('GET', '/api/m01/theses', async () => { try { return { ok: true, theses: await getJson(`${MOD.m01}/api/theses`) }; } catch (e) { return { ok: false, error: `模組 01 未啟動或無法連線（${e.message}）` }; } });
// 寫入模組 01 論點帳本：在該持股論點新增一條「總經觀察假設」，保留其餘內容（模組 01 會產生新版本）
R('POST', '/api/conditions/:id/push', async ({ params, body }) => {
  const c = store.priv.conditions[params.id]; need(c, 404, '找不到條件');
  const sym = normSym(body.sym);
  const t = await getJson(`${MOD.m01}/api/theses/${encodeURIComponent(sym)}`);
  const cur = t.thesis?.current;
  need(cur, 400, `模組 01 尚無 ${sym} 的論點，請先在模組 01 建立論點後再加入總經觀察條件`);
  const text = `【總經觀察・模組10】${c.label}`;
  if (!cur.assumptions.some(a => a.text === text)) {
    const payload = { claim: cur.claim, stance: cur.stance, evidence: cur.evidence, nextCheck: cur.nextCheck, invalidations: cur.invalidations.map(i => ({ id: i.id, text: i.text, quant: i.quant, conditionId: i.conditionId })), assumptions: [...cur.assumptions, { text, metric: null, target: null, unit: null, deadline: '' }] };
    await getJson(`${MOD.m01}/api/theses/${encodeURIComponent(sym)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  }
  c.pushed = [...new Set([...(c.pushed || []), sym])]; store.savePrivate();
  return { ok: true, sym, text };
});

R('GET', '/api/status', () => {
  const db = store.db;
  const vint = Object.fromEntries(Object.entries(db.vintages).map(([k, v]) => [k, Object.keys(v).length]));
  return { lane: lane.status(), log: providerLog.slice(0, 200), manifest: MANIFEST, jobs: svc.jobs, health: src.health, sources: SOURCE_INFO, audit: db.audit.slice(0, 200), vintages: vint, alfredDone: Object.keys(db.alfredDone).length, consensus: db.consensus.length, releases: Object.keys(db.releases).length, cursors: db.cursors, estimateStats: svc.estimateStats(), bls: src.blsCount, fredKey: src.hasFredKey, xqStale: ['USCA0019', 'USGB0103', 'EI020122', 'EI020025'].map(id => ({ id, ...svc.xqHealth(id) })) };
});
R('POST', '/api/refresh', async () => { store.db.cursors.full = 0; svc.tick(); return { ok: true }; });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/health/')) {
      if (req.method !== 'GET') { const o = req.headers.origin; if (o && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(o)) throw new ApiError(403, '來源不允許'); }
      const r = routes.find(x => x.method === req.method && x.re.test(u.pathname));
      if (!r) throw new ApiError(404, '找不到 API');
      let body = {};
      if (req.method !== 'GET') { const ch = []; for await (const c of req) ch.push(c); const t = Buffer.concat(ch).toString('utf8'); if (t) body = JSON.parse(t); }
      const params = Object.fromEntries(Object.entries(r.re.exec(u.pathname).groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
      const out = await r.fn({ params, q: u.searchParams, body });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(out ?? null));
      return;
    }
    let p = path.normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, '');
    if (!p || p === '.') p = 'index.html';
    const file = path.join(ROOT, 'public', p);
    if (!file.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: e.message || String(e) }));
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`美股總經風險台（XQ 美股版 模組10） http://127.0.0.1:${PORT}`);
  // 啟動即擷取一次；之後每 5 分鐘檢查（公布後 90 分鐘內重抓實績；每小時完整更新）
  store.db.cursors.full = 0; // 啟動即完整更新一次
  svc.tick(); setInterval(() => svc.tick(), 5 * 60e3);
});
process.on('SIGINT', () => { store.flushNow(); process.exit(0); });
