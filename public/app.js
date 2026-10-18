// app.js — 美股總經風險台前端。規則：預期差用「高於／低於／符合」文字＋數值，不用紅綠暗示好壞；
// 每個數字標來源與資料日期；缺值顯示「未公布」不插值；ETF 價格標「代理，非利差」；不給綜合分數。
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(p, o = {}) {
  const r = await fetch(p, { method: o.method || 'GET', headers: o.body ? { 'Content-Type': 'application/json' } : {}, body: o.body ? JSON.stringify(o.body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j;
}
const NA = '<span class="faint">—</span>';
const num = (v, d = 1) => v == null ? NA : (+v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const sgn = (v, d = 1, u = '') => v == null ? NA : `${v > 0 ? '+' : ''}${(+v).toFixed(d)}${u}`;
// 台灣習慣：漲紅跌綠（只用於市場價格，不用於經濟數據的預期差）
const pct = (v, d = 2) => v == null ? NA : `<span class="${v > 0 ? 'pos up' : v < 0 ? 'neg down' : ''}">${v > 0 ? '+' : ''}${(+v).toFixed(d)}%</span>`;
const stars = (n) => n > 0 ? `<span class="stars" title="重要性 ${n}／3">${'★'.repeat(n)}${'☆'.repeat(3 - n)}</span>` : '<span class="faint small">—</span>';
const tw = (ms) => ms ? new Date(ms).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const ago = (ms) => { if (!ms) return '—'; const m = Math.round((Date.now() - ms) / 60e3); return m < 60 ? `${m} 分鐘前` : m < 1440 ? `${Math.round(m / 60)} 小時前` : `${Math.round(m / 1440)} 天前`; };
let META = null, HOLD = [];

function hp() { const h = location.hash || '#/week'; const [p, qs] = h.slice(1).split('?'); return { parts: p.split('/').filter(Boolean), q: new URLSearchParams(qs || '') }; }
async function route() {
  if (!location.hash) { location.replace('#/week'); return; }
  const { parts, q } = hp();
  for (const a of $$('#tabs a')) a.classList.toggle('on', a.dataset.r === parts[0]);
  view.innerHTML = '<div class="empty">載入中…</div>';
  try {
    const V = { week: viewWeek, data: viewData, reaction: viewReaction, fed: viewFed, cross: viewCross, conditions: viewConditions, status: viewStatus }[parts[0]];
    if (!V) return location.replace('#/week');
    await V(parts, q);
  } catch (e) { view.innerHTML = `<div class="banner bad">載入失敗：${esc(e.message)}</div>`; console.error(e); }
}
window.addEventListener('hashchange', route);

// ---- 圖表：時間軸折線（可階梯），滑鼠顯示同日數值 ----
function chart(el, series, { h = 240, step = false, yfmt = (v) => v.toFixed(2), right = null, marks = [] } = {}) {
  const W = el.clientWidth || 900, H = h, L = 52, R = right ? 56 : 14, T = 12, B = 26;
  const all = series.flatMap(s => s.pts.filter(p => p[1] != null && !s.axis2));
  const all2 = series.flatMap(s => s.axis2 ? s.pts.filter(p => p[1] != null) : []);
  if (!all.length) { el.innerHTML = '<div class="empty small">無資料</div>'; return; }
  const xs = series.flatMap(s => s.pts.map(p => Date.parse(p[0])));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const rng = (a) => { let lo = Math.min(...a.map(p => p[1])), hi = Math.max(...a.map(p => p[1])); if (lo === hi) { lo -= 1; hi += 1; } const pad = (hi - lo) * 0.06; return [lo - pad, hi + pad]; };
  const [y0, y1] = rng(all); const [z0, z1] = all2.length ? rng(all2) : [0, 1];
  const X = (d) => L + (Date.parse(d) - x0) / Math.max(1, x1 - x0) * (W - L - R);
  const Y = (v, s) => s?.axis2 ? T + (1 - (v - z0) / (z1 - z0)) * (H - T - B) : T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const ticks = 5; let g = '';
  for (let i = 0; i <= ticks; i++) { const v = y0 + (y1 - y0) * i / ticks; const y = Y(v); g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${esc(yfmt(v))}</text>`; if (right && all2.length) { const v2 = z0 + (z1 - z0) * i / ticks; g += `<text x="${W - R + 6}" y="${y + 4}" font-size="11" fill="var(--muted)">${esc(right(v2))}</text>`; } }
  const yrs = []; for (let y = new Date(x0).getUTCFullYear(); y <= new Date(x1).getUTCFullYear(); y++) yrs.push(y);
  const span = (x1 - x0) / 864e5;
  if (span > 500) for (const y of yrs) { const d = `${y}-01-01`; if (Date.parse(d) < x0) continue; g += `<text x="${X(d)}" y="${H - 8}" font-size="11" fill="var(--muted)" text-anchor="middle">${y}</text>`; }
  else { const n = 6; for (let i = 0; i <= n; i++) { const t = new Date(x0 + (x1 - x0) * i / n).toISOString().slice(0, 10); g += `<text x="${X(t)}" y="${H - 8}" font-size="11" fill="var(--muted)" text-anchor="middle">${t.slice(span > 200 ? 0 : 5, span > 200 ? 7 : 10)}</text>`; } }
  for (const m of marks) if (Date.parse(m.date) >= x0 && Date.parse(m.date) <= x1) g += `<line x1="${X(m.date)}" x2="${X(m.date)}" y1="${T}" y2="${H - B}" stroke="var(--faint)" stroke-dasharray="3 3"><title>${esc(m.label)}</title></line>`;
  for (const s of series) {
    let d = '', pen = false, prevY = null;
    for (const [dt, v] of s.pts) {
      if (v == null) { pen = false; continue; }
      const x = X(dt).toFixed(1), y = Y(v, s).toFixed(1);
      if (!pen) d += `M${x},${y}`; else d += step ? `H${x}V${y}` : `L${x},${y}`;
      pen = true; prevY = y;
    }
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.w || 1.8}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>`;
    if (s.dots) for (const [dt, v] of s.pts) if (v != null) g += `<circle cx="${X(dt)}" cy="${Y(v, s)}" r="2.6" fill="${s.color}"/>`;
  }
  el.innerHTML = `<div class="legend" style="margin-bottom:4px">${series.map(s => `<span><i class="swatch" style="background:${s.color}"></i> ${esc(s.name)}</span>`).join('')}</div><svg viewBox="0 0 ${W} ${H}" height="${H}">${g}<line class="cur" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--muted)" visibility="hidden"/></svg><div class="tip" style="display:none"></div>`;
  const svg = $('svg', el), tip = $('.tip', el), cur = $('.cur', el);
  const maps = series.map(s => ({ s, m: s.pts.filter(p => p[1] != null) }));
  svg.addEventListener('mousemove', (ev) => {
    const r = svg.getBoundingClientRect(); const px = (ev.clientX - r.left) * W / r.width;
    const t = x0 + (px - L) / (W - L - R) * (x1 - x0);
    const rows = maps.map(({ s, m }) => { let best = null; for (const p of m) { if (Date.parse(p[0]) <= t + 864e5 / 2) best = p; else break; } return best ? `<div><i class="swatch" style="background:${s.color}"></i> ${esc(s.name)}：<b>${esc((s.fmt || yfmt)(best[1]))}</b> <span class="faint">${best[0]}</span></div>` : ''; }).join('');
    cur.setAttribute('x1', px); cur.setAttribute('x2', px); cur.setAttribute('visibility', 'visible');
    tip.innerHTML = rows; tip.style.display = 'block'; tip.style.left = Math.min(r.width - 220, (ev.clientX - r.left) + 12) + 'px'; tip.style.top = '28px';
  });
  svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; cur.setAttribute('visibility', 'hidden'); });
}
function spark(pts, color = 'var(--accent)') {
  const v = pts.filter(p => p.value != null); if (v.length < 2) return '';
  const W = 200, H = 46; const lo = Math.min(...v.map(p => p.value)), hi = Math.max(...v.map(p => p.value)) || 1;
  const d = v.map((p, i) => `${i ? 'L' : 'M'}${(i / (v.length - 1) * W).toFixed(1)},${(H - 3 - (p.value - lo) / ((hi - lo) || 1) * (H - 6)).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}

// ---- 預期差文字（中性色）----
const surCell = (r) => {
  if (!r.surprise) return r.released && r.actual != null ? '<span class="faint small">無共識預估</span>' : NA;
  const s = r.surprise; const cls = s.text === '高於' ? 'hi' : s.text === '低於' ? 'lo' : '';
  return `<span class="neu ${cls}">${s.text}</span> <span class="mono">${sgn(s.diff, r.dec)}</span>${r.std?.z != null ? `<div class="small muted">標準化 ${sgn(r.std.z, 2)}σ（樣本 ${r.std.n}）</div>` : r.std ? `<div class="small faint">標準化：樣本 ${r.std.n}／24，累積中</div>` : ''}`;
};
const estCell = (r) => {
  if (r.anomaly) return `<span class="badge warn" title="${esc(r.anomaly)}">待查</span>`;
  if (r.estimate != null) return `<span class="mono">${num(r.estimate, r.dec)}</span><div class="small faint" title="擷取 ${tw(r.estimateAt)}">${esc(r.estimateSrc)}</div>`;
  if (r.estIsPrior) return `<span class="faint small" title="XQ 日曆預估欄位 ${r.estimateRaw} 等於前值，非市場共識">無共識（XQ＝前值）</span>`;
  return NA;
};
const unitTxt = (u) => u && u !== '%' ? `<span class="faint small">${esc(u)}</span>` : '';

// ======== 本週總經（F36-1、F36-2）========
async function viewWeek(parts, q) {
  const range = q.get('range') || 'this'; const nonUS = q.get('nonUS') === '1';
  const [c, fed] = await Promise.all([api(`/api/calendar?range=${range}${nonUS ? '&nonUS=1' : ''}`), api('/api/fed').catch(() => null)]);
  const nx = fed?.upcoming?.[0];
  const lnk = (r, n) => `#/week?range=${r}${n ? '&nonUS=1' : ''}`;
  view.innerHTML = `<div class="row spread"><h1>本週總經</h1><div class="flex seg2">
      <a href="${lnk('this', nonUS)}" class="${range === 'this' ? 'on' : ''}">本週</a><a href="${lnk('next', nonUS)}" class="${range === 'next' ? 'on' : ''}">下週</a><a href="${lnk('recent', nonUS)}" class="${range === 'recent' ? 'on' : ''}">近 7 日已公布</a>
      <label class="small"><input type="checkbox" id="nonus" ${nonUS ? 'checked' : ''}> 顯示非美國</label></div></div>
    <p class="small muted">${c.from} ～ ${c.to}（台灣時間，自動處理美國夏令時間）。日曆每 5 分鐘檢查；重要數據公布後 90 分鐘內每 5 分鐘重抓實績。上次擷取 ${tw(c.lastCapture)}。</p>
    ${fed ? `<div class="card" style="margin-bottom:12px"><div class="flex"><b>聯邦基金目標區間</b> <span class="mono">${num(fed.current.lower, 2)}%–${num(fed.current.upper, 2)}%</span><span class="small muted">（NY Fed，${fed.current.date}；EFFR ${num(fed.current.effr, 2)}%）</span>
      ${nx ? `<span>｜下次 FOMC：<b>${nx.start.slice(5)}～${nx.date.slice(5)}</b>${nx.sep ? '（含點陣圖）' : ''}，決議約台灣時間 ${esc(nx.tw || '')}</span>` : ''}<a href="#/fed" class="small">聯準會頁 →</a></div></div>` : ''}
    <div class="banner warn small">實測：XQ 經濟日曆的「預估值」欄位在 ${c.estimateStats.total} 筆中有 ${c.estimateStats.equalPrior} 筆<b>完全等於前一期數值</b>，不是市場共識；本站因此不以它計算預期差（顯示「無共識」）。公布前可按「輸入共識」填入你取得的預估並註明來源（例：財經媒體調查），系統記錄擷取時間，公布後才計算預期差與標準化預期差。</div>
    <div class="card tbl-wrap"><table><thead><tr><th>台灣時間</th><th>重要性</th><th>數據</th><th>期間</th><th class="num">預估</th><th class="num">前值</th><th class="num">實績</th><th>預期差（實績−預估）</th><th class="num">對前值</th><th>狀態</th><th>同日其他事件</th></tr></thead><tbody>
    ${c.rows.length ? c.rows.map(r => `<tr class="${r.relKey ? 'clickrow' : ''} ${r.released ? 'past' : ''}" data-k="${r.relKey || ''}">
      <td class="mono small">${r.time.tw ? esc(r.time.tw) : `${r.publishDate.slice(5)}<div class="faint">時間未提供</div>`}${r.time.tw ? `<div class="faint" title="${esc(r.timeNote)}">${r.time.dst ? '夏令' : '冬令'}・${esc(r.agency || '')}</div>` : ''}</td>
      <td>${stars(r.imp)}</td>
      <td>${r.country !== '美國' ? `<span class="badge">${esc(r.country)}</span> ` : ''}${esc(r.name)}${r.relKey ? '' : ''} ${unitTxt(r.unit)}</td>
      <td class="mono small">${esc(r.period)}</td>
      <td class="num">${estCell(r)}${!r.released && r.relKey ? `<div><button class="btn sm" data-est="${esc(r.key)}">輸入共識</button></div>` : ''}</td>
      <td class="num">${r.priorAnomaly ? `<span class="badge warn" title="${esc(r.priorAnomaly)}">待查</span>` : num(r.prior, r.dec)}${r.priorRevision != null ? `<div class="small muted">修訂 ${sgn(r.priorRevision, r.dec)} → ${num(r.priorNow, r.dec)}</div>` : ''}</td>
      <td class="num">${r.actualAnomaly ? `<span class="badge warn" title="${esc(r.actualAnomaly)}">待查</span>` : r.actual != null ? `<b>${num(r.actual, r.dec)}</b><div class="small faint">${esc(r.actualSrc)}${r.actualXq != null && r.actualXq !== r.actual ? `（XQ ${r.actualXq}）` : ''}</div>` : r.notPublishedReason ? '<span class="badge">未公布</span>' : NA}</td>
      <td>${surCell(r)}</td>
      <td class="num">${r.vsPrior != null ? sgn(r.vsPrior, r.dec) : NA}</td>
      <td class="small">${esc(r.status)}${r.notPublishedReason ? `<div class="muted">${esc(r.notPublishedReason)}</div>` : ''}</td>
      <td class="small">${r.sameDay.length ? `<span class="muted" title="同日可能有其他事件">${esc(r.sameDay.slice(0, 3).join('、'))}${r.sameDay.length > 3 ? '…' : ''}</span>` : ''}</td></tr>`).join('') : `<tr><td colspan="11" class="empty">此區間沒有本站擷取到的公布。XQ 經濟日曆只提供未來 14 天；本站從 ${new Date(c.since).toLocaleDateString('zh-TW')} 開始累積，過去的預估與公布日無法回補。</td></tr>`}
    </tbody></table></div>
    <p class="note">時間：XQ 日曆只有日期，本站依各機構慣例時間（美東 08:30／10:00、FOMC 14:00）換算台灣時間，夏令 20:30、冬令 21:30。★ 依本站對美股影響的分級；未列入目錄的美國數據顯示「時間未提供」。實績以官方來源（BLS）為準，與 XQ 不同時記入稽核日誌。</p>`;
  $('#nonus').onchange = (e) => { location.hash = lnk(range, e.target.checked); };
  $$('tr.clickrow').forEach(tr => tr.addEventListener('click', (e) => { if (e.target.closest('button')) return; location.hash = `#/data/${tr.dataset.k}`; }));
  $$('[data-est]').forEach(b => b.onclick = async () => {
    const [xq, period] = b.dataset.est.split('|');
    const est = prompt('輸入公布前的共識預估值（數字）'); if (est == null || est === '') return;
    const source = prompt('預估來源（例：Bloomberg 調查、Reuters poll、WSJ）'); if (!source) return;
    try { await api('/api/consensus', { method: 'POST', body: { xq, period, est, source } }); route(); } catch (e) { alert(e.message); }
  });
}

// ======== 數據詳情（F36-3、F36-6、F36-7）========
async function viewData(parts) {
  const key = parts[1];
  if (!key) {
    const by = {}; for (const r of META.releases) (by[r.theme] ||= []).push(r);
    view.innerHTML = `<h1>數據詳情</h1><p class="small muted">每個數據：目前值、首次公布值（ALFRED 版本）、修訂次數、XQ 與官方來源核對、未公布期間。</p>
      ${Object.entries(by).map(([t, rs]) => `<div class="card"><h2 style="margin-top:0">${esc(t)}</h2><div class="flex">${rs.map(r => `<a class="btn" href="#/data/${r.key}">${stars(r.imp)} ${esc(r.name)}</a>`).join('')}</div></div>`).join('')}`;
    return;
  }
  const d = await api(`/api/release/${key}`);
  const R = d.release; const dec = R.dec;
  const latestPublished = d.releases.find(x => x.released);
  view.innerHTML = `<div class="row spread"><h1>${stars(R.imp)} ${esc(R.name)}</h1><a href="#/data" class="small">← 全部數據</a></div>
    <div class="card"><div class="kv"><div>發布機構</div><div>${esc(R.agency)}，慣例時間美東 ${R.et}（台灣 ${R.et === '08:30' ? '夏令 20:30／冬令 21:30' : R.et === '10:00' ? '夏令 22:00／冬令 23:00' : '夏令 02:00／冬令 03:00（隔日）'}）</div>
      <div>來源</div><div class="small">${[d.sources.official && `官方：${esc(d.sources.official)}`, `XQ：${esc(d.sources.xq)}`, d.sources.alfred && `版本：${esc(d.sources.alfred)}`, d.sources.alt && `對照：${esc(d.sources.alt)}`].filter(Boolean).join('<br>')}</div>
      <div>XQ 序列狀態</div><div>${d.xqStale.stale ? `<span class="badge bad">${esc(d.xqStale.text)}</span>` : `<span class="badge ok">正常</span> 最新 ${esc(d.lastXq || '—')}`}</div>
      <div>首次公布值</div><div class="small">${d.alfred.vintages ? `ALFRED 已匯入 ${d.alfred.vintages} 個月底版本（每期取最早含該期的版本）` : 'ALFRED 版本尚未匯入（背景回補中，或 FRED 連線受限）'}；本站自 ${esc(d.self.since?.slice(0, 10) || '—')} 起每日保存 XQ／官方值的版本</div>
      ${d.missing.length ? `<div>缺漏期間</div><div>${d.missing.map(p => `<span class="badge">${p}</span>`).join(' ')}（XQ 序列中間缺漏，不插值）</div>` : ''}</div></div>
    <div class="card"><div class="row spread"><h2 style="margin:0">走勢</h2><div class="flex seg2" id="mode"><a href="javascript:void 0" data-m="cur" class="on">目前值</a><a href="javascript:void 0" data-m="first">首次公布</a><a href="javascript:void 0" data-m="both">兩者並列</a></div></div><div class="chart" id="ch" style="margin-top:8px"></div>
      <p class="note">缺漏期間（如 2025-10 CPI）在圖上留白，不連線、不插值。</p></div>
    <div class="card tbl-wrap"><h2 style="margin-top:0">各期數值與版本</h2><table><thead><tr><th>期間</th><th class="num">目前值</th><th class="num">首次公布（ALFRED）</th><th class="num">修訂次數</th><th class="num">XQ</th><th class="num">${esc(R.agency)} 官方</th>${d.sources.alt ? '<th class="num">XQ ' + esc(d.sources.alt.replace('XQ ', '')) + '</th>' : ''}<th>狀態</th></tr></thead><tbody>
    ${d.rows.map(r => `<tr><td class="mono">${r.period}</td><td class="num"><b>${num(r.current, dec)}</b>${r.currentSrc ? `<div class="small faint">${esc(r.currentSrc)}</div>` : ''}</td>
      <td class="num">${r.first != null ? `${num(r.first, dec)}<div class="small faint">版本 ${r.firstVintage}</div>` : NA}</td>
      <td class="num">${r.revisions != null ? r.revisions + (r.first != null && r.alfredCurrent !== r.first ? `<div class="small muted">${sgn(r.alfredCurrent - r.first, dec)}</div>` : '') : NA}</td>
      <td class="num">${num(r.xq, dec)}${r.conflict ? ' <span class="badge warn" title="與官方值不同，以官方為準（已記入稽核日誌）">≠</span>' : ''}</td><td class="num">${num(r.official, dec)}</td>${d.sources.alt ? `<td class="num">${num(r.alt, dec)}</td>` : ''}
      <td class="small">${r.status === '已公布' ? '<span class="faint">已公布</span>' : `<span class="badge ${r.status === '未公布' ? '' : 'warn'}">${r.status}</span> <span class="muted">${esc(r.reason || '')}</span>`}</td></tr>`).join('')}
    </tbody></table><p class="note">「目前值」以官方來源為準；XQ 與官方不同時標 ≠。修訂次數＝ALFRED 月底版本中此期數值改變的次數。</p></div>
    <div class="card tbl-wrap"><h2 style="margin-top:0">本站記錄的公布</h2>${d.releases.length ? `<table><tr><th>公布日</th><th>期間</th><th class="num">預估</th><th class="num">前值</th><th class="num">實績</th><th>預期差</th><th></th></tr>${d.releases.map(r => `<tr><td class="mono small">${esc(r.time.tw || r.publishDate)}</td><td class="mono">${r.period}</td><td class="num">${estCell(r)}</td><td class="num">${num(r.prior, dec)}</td><td class="num">${num(r.actual, dec)}</td><td>${surCell(r)}</td><td>${r.released ? `<a class="btn sm" href="#/reaction?date=${r.publishDate}">公布後反應</a>` : ''}</td></tr>`).join('')}</table>` : '<p class="small muted">尚無（XQ 日曆只給未來 14 天，本站從啟用日起累積）。</p>'}</div>
    <div class="card"><h2 style="margin-top:0">設成觀察條件（寫入模組 01 論點帳本）</h2>
      <div class="flex"><select id="cm"><option value="actual">實績</option><option value="surprise">預期差（需有共識預估）</option></select><select id="cop"><option>&gt;</option><option>&gt;=</option><option>&lt;</option><option>&lt;=</option></select>
      <input type="number" id="cv" step="any" style="width:90px" placeholder="門檻"> 連 <input type="number" id="cn" value="1" min="1" max="12" style="width:60px"> 次 <input type="text" id="cl" placeholder="描述（可留空自動產生）" style="min-width:240px"> <button class="btn primary" id="cadd">新增條件</button></div>
      <p class="note">例：核心 PCE 物價月增率 實績 &gt; 0.3 連 2 次。條件在本站以官方／XQ 數值評估，可到「觀察條件」頁寫入模組 01 某檔持股的論點。</p></div>`;
  const ch = $('#ch');
  const cur = d.rows.slice().reverse().map(r => [r.period.length === 7 ? r.period + '-15' : r.period, r.current]);
  const fst = d.rows.slice().reverse().map(r => [r.period.length === 7 ? r.period + '-15' : r.period, r.first]);
  const fmt = (v) => (+v).toFixed(dec);
  const draw = (m) => chart(ch, [m !== 'first' && { name: '目前值', color: 'var(--accent)', pts: cur, dots: true, fmt }, m !== 'cur' && { name: '首次公布（ALFRED）', color: 'var(--warn)', pts: fst, dots: true, dash: m === 'both' ? '4 3' : null, fmt }].filter(Boolean), { yfmt: fmt, h: 230 });
  draw('cur');
  $$('#mode a').forEach(a => a.onclick = () => { $$('#mode a').forEach(x => x.classList.toggle('on', x === a)); draw(a.dataset.m); });
  $('#cadd').onclick = async () => { try { await api('/api/conditions', { method: 'POST', body: { relKey: key, metric: $('#cm').value, op: $('#cop').value, value: $('#cv').value, n: $('#cn').value, label: $('#cl').value } }); location.hash = '#/conditions'; } catch (e) { alert(e.message); } };
}

// ======== 公布後反應（F36-4）========
async function viewReaction(parts, q) {
  HOLD = await api('/api/holdings');
  const [cal, fed] = await Promise.all([api('/api/calendar?range=all'), api('/api/fed').catch(() => null)]);
  const dates = [...new Map([...cal.rows.filter(r => r.released && r.imp >= 2).map(r => [r.publishDate, r.name]), ...(fed?.past || []).map(m => [m.date, 'FOMC 決議'])]).entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);
  const date = q.get('date') || dates[0]?.[0] || new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const sym = q.get('sym') || HOLD[0] || '';
  view.innerHTML = `<h1>公布後跨資產反應</h1><p class="small muted">公布前一交易日收盤 → 公布當日收盤（美東）。殖利率以基點、其餘以百分比。可輸入任何日期，例如 BLS 公布 CPI 的日期，用公開收盤價重算。</p>
    <div class="card flex"><label class="f">公布日（美東）<input type="date" id="rd" value="${date}"></label><label class="f">自選股<input type="text" id="rs" value="${esc(sym.replace('.US', ''))}" style="width:100px" list="hl"></label><datalist id="hl">${HOLD.map(h => `<option>${h.replace('.US', '')}</option>`).join('')}</datalist><button class="btn primary" id="rgo">計算</button>
      <div class="flex small">${dates.map(([d, n]) => `<a class="btn sm" href="#/reaction?date=${d}&sym=${encodeURIComponent(sym)}" title="${esc(n)}">${d.slice(5)} ${esc(n.slice(0, 8))}</a>`).join('')}</div></div>
    <div id="rout"><div class="empty">計算中…</div></div>`;
  $('#rgo').onclick = () => { location.hash = `#/reaction?date=${$('#rd').value}&sym=${encodeURIComponent($('#rs').value.trim().toUpperCase())}`; };
  const r = await api(`/api/reaction?date=${date}${sym ? `&sym=${encodeURIComponent(sym)}` : ''}`);
  $('#rout').innerHTML = `<div class="card tbl-wrap"><h2 style="margin-top:0">${date}</h2>${r.others.length ? `<div class="banner warn small">同日可能有其他事件：${esc(r.others.join('、'))}</div>` : ''}
    <table><tr><th>資產</th><th>來源</th><th class="num">前一日收盤</th><th class="num">當日收盤</th><th class="num">變化</th></tr>
    ${r.rows.map(x => `<tr><td>${esc(x.name)}${x.proxy ? ' <span class="badge">代理</span>' : ''}</td><td class="small muted">${esc(x.src)}</td><td class="num">${x.prev != null ? `${num(x.prev, x.unit === 'bp' ? 2 : 2)}<div class="small faint">${x.prevDate}</div>` : NA}</td><td class="num">${x.curr != null ? num(x.curr, 2) : NA}</td>
      <td class="num">${x.change == null ? `<span class="small muted">${esc(x.note || '—')}</span>` : x.unit === 'bp' ? `<b>${sgn(x.change, 1)} bp</b>` : pct(x.change)}</td></tr>`).join('')}</table>
    <p class="note">${esc(r.note)}。H.10 美元指數取紐約中午匯率，08:30 公布的數據只反映部分；美股指數與自選股取 XQ 日K（自選股為分割調整、未含股利）。</p></div>`;
}

// ======== 聯準會（F36-5）========
async function viewFed() {
  const f = await api('/api/fed');
  view.innerHTML = `<h1>聯準會政策路徑</h1>
    <div class="grid2"><div class="card"><div class="small muted">目前目標區間（NY Fed，${f.current.date}）</div><div style="font-size:30px;font-weight:700" class="mono">${num(f.current.lower, 2)}%–${num(f.current.upper, 2)}%</div><div class="small">有效聯邦基金利率 EFFR ${num(f.current.effr, 2)}%</div></div>
      <div class="card"><div class="small muted">接下來的 FOMC 會議（federalreserve.gov）</div>${f.upcoming.map(m => `<div class="flex"><b class="mono">${m.start.slice(5)}～${m.date.slice(5)}</b>${m.sep ? '<span class="badge">含經濟預測與點陣圖</span>' : ''}<span class="small muted">決議美東 14:00（台灣 ${esc(m.tw || '')}）</span></div>`).join('')}</div></div>
    <div class="card"><h2 style="margin-top:0">目標區間（日頻）與 EFFR，2015 起</h2><div class="chart" id="fch"></div><p class="note">虛線為 FOMC 會議日。${esc(f.note)}</p></div>
    <div class="grid2"><div class="card tbl-wrap"><h2 style="margin-top:0">利率變動與會議對齊</h2><table><tr><th>生效日</th><th>區間</th><th class="num">變動</th><th>對應會議</th></tr>${f.changes.slice(0, 16).map(c => `<tr><td class="mono">${c.effective}</td><td class="mono">${num(c.from[0], 2)}–${num(c.from[1], 2)} → <b>${num(c.to[0], 2)}–${num(c.to[1], 2)}</b></td><td class="num">${sgn(c.bp, 0)} bp</td><td>${c.meeting ? `${c.statement ? `<a href="${esc(c.statement)}" target="_blank" rel="noopener">${c.meeting}</a>` : c.meeting}${c.unscheduled ? ' <span class="badge">臨時</span>' : ''}` : '<span class="badge warn">未對到會議</span>'}</td></tr>`).join('')}</table>
      <p class="note">決議於會議第二天美東 14:00 公布，隔一營業日生效。</p></div>
      <div class="card tbl-wrap"><h2 style="margin-top:0">點陣圖中位數（SEP）</h2>${f.dots ? `<p class="small muted">${f.dots.date} 會議，聯邦基金利率中位數（各年底，區間中點）</p><table><tr>${f.dots.median.map(x => `<th class="num">${esc(x.label === 'Longer run' ? '長期' : x.label)}</th>`).join('')}</tr><tr>${f.dots.median.map(x => `<td class="num"><b>${num(x.value, 1)}%</b></td>`).join('')}</tr></table>
        <h3 class="small muted" style="margin-top:14px">歷次</h3><table>${Object.entries(f.dotsAll).sort((a, b) => b[0].localeCompare(a[0])).map(([d, x]) => `<tr><td class="mono"><a href="${esc(x.url)}" target="_blank" rel="noopener">${d}</a></td>${x.median.map(m => `<td class="num small">${esc(m.label === 'Longer run' ? '長期' : m.label)} ${num(m.value, 1)}</td>`).join('')}</tr>`).join('')}</table>` : '<p class="small muted">尚未取得。</p>'}
        <p class="note">點陣圖是與會者個人預測，不是政策承諾；市場隱含機率（CME FedWatch）需授權，不顯示。</p></div></div>
    <div class="grid2"><div class="card tbl-wrap"><h2 style="margin-top:0">近期會議與聲明</h2><table>${f.past.map(m => `<tr><td class="mono">${m.date}</td><td>${m.sep ? '<span class="badge">SEP</span>' : ''}${m.unscheduled ? '<span class="badge">臨時</span>' : ''}</td><td>${m.statement ? `<a href="${esc(m.statement)}" target="_blank" rel="noopener">聲明</a>` : ''} ${m.minutes ? `<a href="${esc(m.minutes)}" target="_blank" rel="noopener">會議紀錄</a>` : ''} ${m.projections ? `<a href="${esc(m.projections)}" target="_blank" rel="noopener">經濟預測</a>` : ''}</td><td><a class="btn sm" href="#/reaction?date=${m.date}">反應</a></td></tr>`).join('')}</table></div>
      <div class="card tbl-wrap"><h2 style="margin-top:0">XQ 月底值 vs 日頻</h2><p class="small muted">XQ EI020122 是月底值且有缺月；本站以 NY Fed 日頻上下限為準。</p><table><tr><th>月份</th><th class="num">XQ（上限）</th><th class="num">NY Fed 月底上限</th></tr>${f.xqMonthly.slice().reverse().map(x => { const me = [...f.daily].reverse().find(r => r.date.slice(0, 7) <= x.period); return `<tr><td class="mono">${x.period}</td><td class="num">${num(x.value, 2)}</td><td class="num">${me ? num(me.upper, 2) : NA}</td></tr>`; }).join('')}</table></div></div>`;
  chart($('#fch'), [{ name: '目標上限', color: 'var(--accent)', pts: f.daily.map(r => [r.date, r.upper]), fmt: (v) => v.toFixed(2) + '%' }, { name: '目標下限', color: 'var(--faint)', pts: f.daily.map(r => [r.date, r.lower]), fmt: (v) => v.toFixed(2) + '%' }, { name: 'EFFR', color: 'var(--warn)', w: 1.2, pts: f.daily.map(r => [r.date, r.effr]), fmt: (v) => v.toFixed(2) + '%' }], { step: true, yfmt: (v) => v.toFixed(2) + '%', marks: f.past.concat(f.upcoming).map(m => ({ date: m.date, label: 'FOMC ' + m.date })).concat(f.changes.map(c => ({ date: c.meeting || c.effective, label: 'FOMC' }))) });
}

// ======== 跨資產（F37）========
async function viewCross() {
  HOLD = await api('/api/holdings');
  const p = await api('/api/panel');
  const fmtV = (c, v) => v == null ? NA : c.unit === '%' ? `${(+v).toFixed(2)}%` : c.unit === 'bp' ? `${Math.round(v)} bp` : (+v).toFixed(c.id === 'NFCI' ? 3 : 2);
  const chg = (c) => c.change == null ? NA : c.chgUnit === '%' ? sgn(c.change, 2, '%') : c.chgUnit === 'bp' ? sgn(c.change, 0, ' bp') : sgn(c.change, 3);
  const pbar = (x, worse) => x?.pct == null ? `<span class="small faint">${esc(x?.reason || '樣本不足，不顯示')}</span>` : `<div class="pctbar"><span class="bad" style="${worse === 'high' ? 'left:90%;width:10%' : 'left:0;width:10%'}"></span><i style="left:calc(${x.pct.toFixed(0)}% - 1px)"></i></div><span class="small mono">${x.pct.toFixed(0)} 百分位</span>`;
  view.innerHTML = `<h1>跨資產條件</h1><p class="small muted">利率、利差、美元、信用利差、金融條件並排；每格標頻率、資料日期與更新時間。百分位＝近 N 年中小於等於最新值的比例；橘色區為該序列「轉差」方向的最差 10%。</p>
    <div class="banner ${p.alert.triggered ? 'warn' : 'info'}">${p.alert.triggered ? `<b>同步轉差提示</b>：${p.alert.worst.length} 個序列同時在近 3 年最差 10%：${p.alert.worst.map(w => `${esc(w.name)}（${w.pct.toFixed(0)} 百分位）`).join('、')}。` : `目前 ${p.alert.worst.length} 個序列在近 3 年最差 10%${p.alert.worst.length ? `（${p.alert.worst.map(w => esc(w.name)).join('、')}）` : ''}，未達 3 個。`}<div class="small muted">${esc(p.alert.rule)}。可評估 ${p.alert.evaluated}／${p.alert.total} 個序列。</div></div>
    <div class="cards">${p.cards.map(c => !c.available ? `<div class="mcard"><div class="hd"><span class="nm">${esc(c.name)}</span><span class="badge">${esc(c.freq)}</span></div><div class="badge bad">暫無法取得</div><div class="small muted">${esc(c.error)}</div><div class="small faint">來源：${esc(c.source?.name)}</div></div>` : `
      <div class="mcard ${c.worst3 ? 'worst' : ''}"><div class="hd"><span class="nm">${esc(c.name)}</span><span class="badge">${esc(c.freq)}</span></div>
        <div class="hd"><span class="v">${fmtV(c, c.last.value)}</span><span class="small">${c.changeLabel} <b class="mono">${chg(c)}</b></span></div>
        <div class="small muted">${esc(c.lagNote)}${c.stale ? ' <span class="badge warn">舊快取</span>' : ''}</div>
        ${spark(c.spark)}
        <div class="small">近 3 年 ${pbar(c.p3, c.worse)}</div><div class="small">近 10 年 ${pbar(c.p10, c.worse)}</div>
        <div class="small faint" title="${esc(c.source?.note || '')}">${esc(c.source?.name)}・更新 ${ago(c.fetchedAt)}・轉差方向：${c.worse === 'high' ? '越高越差' : '越低越差'}</div></div>`).join('')}</div>
    <div class="grid2" style="margin-top:12px"><div class="card tbl-wrap"><h2 style="margin-top:0">ETF 代理（盤中參考）</h2><table><tr><th>ETF</th><th>對照</th><th class="num">價格</th><th class="num">當日</th></tr>${p.proxies.map(x => `<tr><td><b>${x.sym.replace('.US', '')}</b> <span class="small muted">${esc(x.name)}</span></td><td class="small">${esc(x.for)} <span class="badge warn">代理，非利差</span></td><td class="num">${num(x.price, 2)}</td><td class="num">${pct(x.chg)}</td></tr>`).join('')}</table><p class="note">ETF 價格含存續期間、展期與資金流等因素，只作盤中方向參考；本站不以 ETF 價格反推利差數值。XQAPI 即時報價。</p></div>
      <div class="card"><h2 style="margin-top:0">「恐慌指數」對照</h2><div class="vixbox"><div><div class="small muted">${esc(p.vix.us.label)}</div><div style="font-size:24px;font-weight:700" class="mono">${num(p.vix.us.value, 2)}</div><div class="small faint">${esc(p.vix.us.source)}・${esc(p.vix.us.date || '')}${p.vix.us.error ? `・${esc(p.vix.us.error)}` : ''}</div></div>
        <div><div class="small muted">${esc(p.vix.tw.label)}</div><div style="font-size:24px;font-weight:700" class="mono">${num(p.vix.tw.value, 2)} <span class="small">${pct(p.vix.tw.chg)}</span></div><div class="small faint">${esc(p.vix.tw.source)}</div></div></div><p class="note">${esc(p.vix.note)}</p></div></div>
    <div class="card"><h2 style="margin-top:0">持股疊加（F37-6）</h2><div class="flex"><select id="osym">${HOLD.map(h => `<option>${h}</option>`).join('')}</select><select id="oser"><option value="DGS10">Δ10 年殖利率</option><option value="BAMLH0A0HYM2">Δ高收益債 OAS</option></select><button class="btn primary" id="ogo">計算</button><a class="small" href="#/conditions">編輯持股清單</a></div><div id="oout" style="margin-top:8px"></div></div>`;
  const run = async () => {
    $('#oout').innerHTML = '<div class="empty">計算中…</div>';
    try {
      const o = await api(`/api/overlay?sym=${encodeURIComponent($('#osym').value)}&series=${$('#oser').value}`);
      $('#oout').innerHTML = `<div class="flex"><b>相關係數 r = ${o.r == null ? '—' : o.r.toFixed(2)}</b><span class="small muted">樣本 ${o.n} 個同日配對（${o.from} 起）</span></div><div class="chart" id="och"></div><p class="note">${esc(o.note)}。</p>`;
      const isY = o.seriesId === 'DGS10';
      chart($('#och'), [{ name: `${o.sym.replace('.US', '')} 收盤`, color: 'var(--accent)', pts: o.chart.map(x => [x.date, x.close]), fmt: (v) => v.toFixed(2) }, { name: isY ? '10 年殖利率（右軸）' : '高收益債 OAS bp（右軸）', color: 'var(--warn)', axis2: true, pts: o.chart.map(x => [x.date, x.series]), fmt: (v) => isY ? v.toFixed(2) + '%' : Math.round(v) + ' bp' }], { yfmt: (v) => v.toFixed(0), right: (v) => isY ? v.toFixed(2) + '%' : Math.round(v) + '', h: 240 });
    } catch (e) { $('#oout').innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; }
  };
  $('#ogo').onclick = run; if (HOLD.length) run();
}

// ======== 觀察條件（F36-7）＋持股 ========
async function viewConditions() {
  const [cs, m01, h] = await Promise.all([api('/api/conditions'), api('/api/m01/theses'), api('/api/holdings')]);
  HOLD = h;
  const syms = m01.ok ? m01.theses.map(t => t.sym) : [];
  view.innerHTML = `<h1>觀察條件</h1><p class="small muted">在「數據詳情」設定；本站以官方／XQ 數值評估。寫入模組 01 時，會在該持股論點新增一條「總經觀察假設」（模組 01 產生新版本，原有內容保留）。</p>
    ${m01.ok ? '' : `<div class="banner warn small">${esc(m01.error)}；仍可設定與評估條件，啟動模組 01 後再寫入。</div>`}
    <div class="card tbl-wrap">${cs.length ? `<table><tr><th>條件</th><th>目前</th><th>最近數值</th><th>寫入模組 01</th><th></th></tr>${cs.map(c => `<tr><td><a href="#/data/${c.relKey}">${esc(c.label)}</a><div class="small faint">建立 ${tw(c.createdAt)}</div></td>
      <td>${c.eval.met ? '<span class="badge warn">成立</span>' : '<span class="badge">未成立</span>'} <span class="small muted">連續 ${c.eval.streak} 次</span></td>
      <td class="small mono">${c.eval.checked.map(x => `${x.period}:${x.value}`).join('　') || '—'}</td>
      <td>${syms.length ? `<select data-ps="${c.id}">${syms.map(s => `<option>${s}</option>`).join('')}</select> <button class="btn sm" data-push="${c.id}">寫入</button>` : '<span class="small faint">模組 01 無論點</span>'}${c.pushed?.length ? `<div class="small muted">已寫入：${c.pushed.join('、')}</div>` : ''}</td>
      <td><button class="btn sm ghost" data-del="${c.id}">刪除</button></td></tr>`).join('')}</table>` : '<div class="empty">尚無條件。到「數據詳情」選一個數據設定。</div>'}</div>
    <div class="card"><h2 style="margin-top:0">我的持股（用於公布後反應與持股疊加）</h2><div class="flex"><input type="text" id="hold" style="min-width:360px" value="${esc(HOLD.map(x => x.replace('.US', '')).join(', '))}"><button class="btn primary" id="hsave">儲存</button></div><p class="note">逗號分隔美股代碼。持股與條件以加密檔存在本機 data/private.enc。</p></div>`;
  $$('[data-del]').forEach(b => b.onclick = async () => { if (!confirm('刪除此條件？')) return; await api(`/api/conditions/${b.dataset.del}`, { method: 'DELETE' }); route(); });
  $$('[data-push]').forEach(b => b.onclick = async () => { const sym = $(`[data-ps="${b.dataset.push}"]`).value; if (!confirm(`在模組 01「${sym}」的論點新增這條總經觀察假設？`)) return; try { await api(`/api/conditions/${b.dataset.push}/push`, { method: 'POST', body: { sym } }); route(); } catch (e) { alert(e.message); } });
  $('#hsave').onclick = async () => { await api('/api/holdings', { method: 'POST', body: { holdings: $('#hold').value.split(/[,\s]+/).filter(Boolean) } }); route(); };
}

// ======== 資料狀態 ========
async function viewStatus() {
  const s = await api('/api/status');
  const vk = Object.entries(s.vintages);
  const grp = (p) => vk.filter(([k]) => k.startsWith(p));
  view.innerHTML = `<div class="row spread"><h1>資料狀態</h1><button class="btn" id="rf">立即更新</button></div>
    <div class="card tbl-wrap"><h2 style="margin-top:0">來源健康</h2><table><tr><th>來源</th><th>說明</th><th>上次成功</th><th>狀態</th></tr>${Object.entries(s.sources).map(([k, x]) => { const h = s.health[k] || {}; return `<tr><td><b>${esc(x.name)}</b>${x.url ? `<div class="small"><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.url.replace(/^https?:\/\//, '').slice(0, 48))}</a></div>` : ''}</td><td class="small">${esc(x.note)}</td><td class="small">${h.lastOk ? ago(h.lastOk) : k === 'XQ' ? ago(s.cursors.calendar) : '—'}</td><td>${h.message ? `<span class="badge bad" title="${esc(h.message)}">失敗 ${h.fails || ''}</span>${h.backoffUntil > Date.now() ? `<div class="small muted">暫停至 ${tw(h.backoffUntil)}</div>` : ''}` : '<span class="badge ok">OK</span>'}</td></tr>`; }).join('')}</table>
      <p class="note">FRED ${s.fredKey ? '使用 API 金鑰（FRED_API_KEY）' : '未設 FRED_API_KEY，使用公開 CSV 下載（短時間大量請求會被暫時封鎖，本站每次間隔 3 秒並快取）'}。BLS 本次啟動後已用 ${s.bls.n} 次（每日上限 25，快取 6 小時）。</p></div>
    <div class="grid2"><div class="card tbl-wrap"><h2 style="margin-top:0">XQ 序列健康</h2><table><tr><th>代碼</th><th>名稱</th><th>最新期</th><th>缺漏（近 2 年）</th><th>狀態</th></tr>${s.xqStale.map(x => `<tr><td class="mono">${x.id}</td><td class="small">${esc(x.name || '')}</td><td class="mono">${esc(x.last || '—')}</td><td class="small mono">${x.gaps?.join(' ') || '—'}</td><td>${x.stale ? `<span class="badge bad">${esc(x.text)}</span>` : '<span class="badge ok">正常</span>'}</td></tr>`).join('')}</table>
      <p class="note">USGB0103（非農）停更 → 本站非農改用 BLS CES0000000001 與 XQ 日曆指標 EI020025；聯邦基金利率改用 NY Fed 日頻。</p></div>
      <div class="card"><h2 style="margin-top:0">版本庫</h2><div class="kv"><div>XQ 序列</div><div>${grp('XQ:').length} 條，${grp('XQ:').reduce((a, [, n]) => a + n, 0)} 個版本</div><div>BLS 官方</div><div>${grp('BLS:').length} 條，${grp('BLS:').reduce((a, [, n]) => a + n, 0)} 個版本</div><div>ALFRED</div><div>${grp('FRED:').length} 條，已匯入 ${s.alfredDone} 個月底版本${s.jobs.alfred?.running ? `（回補中 ${s.jobs.alfred.done}/${s.jobs.alfred.total}）` : s.jobs.alfred?.error ? `（暫停：${esc(s.jobs.alfred.error)}）` : ''}</div>
        <div>預估快照</div><div>${s.consensus} 筆；XQ 預估＝前值 ${s.estimateStats.equalPrior}／${s.estimateStats.total}</div><div>公布紀錄</div><div>${s.releases} 筆</div></div>
        <p class="note">規則：修訂時新增版本不覆寫；時點查詢只取版本日 ≤ 查詢日；缺值不補；XQ 與官方衝突以官方為準並記入稽核日誌；公布時間以 UTC 儲存。</p></div></div>
    <div class="card tbl-wrap"><h2 style="margin-top:0">工作</h2><table><tr><th>工作</th><th>上次</th><th>結果</th></tr>${Object.entries(s.jobs).map(([k, j]) => `<tr><td class="mono">${k}</td><td class="small">${j.running ? '執行中' : tw(j.endedAt)}</td><td class="small">${j.error ? `<span class="badge bad">${esc(j.error)}</span>` : esc(j.note || '')}</td></tr>`).join('')}</table></div>
    <div class="card tbl-wrap"><h2 style="margin-top:0">稽核日誌（來源衝突）</h2>${s.audit.length ? `<table><tr><th>數據</th><th>期間</th><th class="num">XQ</th><th class="num">官方</th><th>處理</th></tr>${s.audit.slice(0, 80).map(a => `<tr><td>${esc(a.release)}</td><td class="mono">${a.period}</td><td class="num">${a.xq}</td><td class="num">${a.official}（${esc(a.officialSrc)}）</td><td class="small muted">${esc(a.rule)}</td></tr>`).join('')}</table><p class="note">多數差異集中在較早期間：官方值已含年度季調修正，XQ 保留的是較早版本。共 ${s.audit.length} 筆。</p>` : '<p class="small muted">無。</p>'}</div>
    <div class="card tbl-wrap"><h2 style="margin-top:0">最近請求</h2><table><tr><th>時間</th><th>來源</th><th>介面／網址</th><th class="num">ms</th><th>結果</th></tr>${s.log.slice(0, 80).map(l => `<tr><td class="mono small">${new Date(l.at).toLocaleTimeString('zh-TW', { hour12: false })}</td><td>${esc(l.src)}</td><td class="mono small">${esc(l.mappingId || l.url || l.job || '')}</td><td class="num">${l.ms ?? ''}</td><td>${l.code === 'OK' || l.status === 200 ? '<span class="badge ok">OK</span>' : `<span class="badge bad">${esc(l.code || '')} ${esc(l.status ?? '')}</span>`}</td></tr>`).join('')}</table></div>`;
  $('#rf').onclick = async () => { await api('/api/refresh', { method: 'POST' }); setTimeout(route, 1500); };
}

(async function init() { META = await api('/api/meta'); $('#m01').href = META.modules.m01; $('#m09').href = META.modules.m09; await route(); })();
