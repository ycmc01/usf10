// catalog.js — 美國重要數據目錄、公布時間（美東→UTC→台灣）、FOMC 與點陣圖解析。
// XQ 經濟日曆只有日期、沒有時間：公布時間依各機構慣例（美東），標示「慣例時間」。

// official: 官方第二來源（BLS API）用來核對 XQ 實績；fred: ALFRED 版本（首次公布值）用的 FRED 代碼
// tf: 由水準值換算成發布口徑 — mom 月增率％、yoy 年增率％、diff 差額、level 原值
export const RELEASES = [
  { key: 'cpi_mom', xq: 'EI020087', name: 'CPI 月增率', agency: 'BLS', et: '08:30', imp: 3, unit: '%', dec: 1, official: { src: 'BLS', id: 'CUSR0000SA0', tf: 'mom' }, fred: { id: 'CPIAUCSL', tf: 'mom' }, theme: '通膨' },
  { key: 'cpi_yoy', xq: 'EI020008', name: 'CPI 年增率', agency: 'BLS', et: '08:30', imp: 3, unit: '%', dec: 1, official: { src: 'BLS', id: 'CUUR0000SA0', tf: 'yoy' }, fred: { id: 'CPIAUCNS', tf: 'yoy' }, alt: 'USCA0019', theme: '通膨' },
  { key: 'core_cpi_yoy', xq: 'EI020088', name: '核心 CPI 年增率', agency: 'BLS', et: '08:30', imp: 3, unit: '%', dec: 1, official: { src: 'BLS', id: 'CUUR0000SA0L1E', tf: 'yoy' }, fred: { id: 'CPILFENS', tf: 'yoy' }, theme: '通膨' },
  { key: 'ppi_mom', xq: 'EI020089', name: 'PPI 月增率（最終需求）', agency: 'BLS', et: '08:30', imp: 2, unit: '%', dec: 1, official: { src: 'BLS', id: 'WPSFD4', tf: 'mom' }, fred: { id: 'PPIFIS', tf: 'mom' }, theme: '通膨' },
  { key: 'ppi_yoy', xq: 'EI020003', name: 'PPI 年增率（最終需求）', agency: 'BLS', et: '08:30', imp: 2, unit: '%', dec: 1, official: { src: 'BLS', id: 'WPUFD4', tf: 'yoy' }, theme: '通膨' },
  { key: 'nfp', xq: 'EI020025', name: '非農就業人數變化', agency: 'BLS', et: '08:30', imp: 3, unit: '千人', dec: 0, official: { src: 'BLS', id: 'CES0000000001', tf: 'diff' }, fred: { id: 'PAYEMS', tf: 'diff' }, theme: '就業' },
  { key: 'unrate', xq: 'EI020023', name: '失業率', agency: 'BLS', et: '08:30', imp: 3, unit: '%', dec: 1, official: { src: 'BLS', id: 'LNS14000000', tf: 'level' }, fred: { id: 'UNRATE', tf: 'level' }, theme: '就業' },
  { key: 'ahe_mom', xq: 'EI020053', name: '平均時薪月增率', agency: 'BLS', et: '08:30', imp: 2, unit: '%', dec: 1, official: { src: 'BLS', id: 'CES0500000003', tf: 'mom' }, fred: { id: 'CES0500000003', tf: 'mom' }, theme: '就業' },
  { key: 'claims', xq: 'EI020001', name: '初領失業救濟金人數', agency: 'DOL', et: '08:30', imp: 2, unit: '千人', dec: 0, fred: { id: 'ICSA', tf: 'k' }, theme: '就業' },
  { key: 'cont_claims', xq: 'EI020050', name: '續領失業救濟金人數', agency: 'DOL', et: '08:30', imp: 1, unit: '千人', dec: 0, theme: '就業' },
  { key: 'core_pce_mom', xq: 'EI020143', name: '核心 PCE 物價月增率', agency: 'BEA', et: '08:30', imp: 3, unit: '%', dec: 1, fred: { id: 'PCEPILFE', tf: 'mom' }, theme: '通膨' },
  { key: 'spend_mom', xq: 'EI020019', name: '個人支出月增率', agency: 'BEA', et: '08:30', imp: 2, unit: '%', dec: 1, fred: { id: 'PCE', tf: 'mom' }, theme: '成長' },
  { key: 'income_mom', xq: 'EI020016', name: '個人所得月增率', agency: 'BEA', et: '08:30', imp: 1, unit: '%', dec: 1, fred: { id: 'PI', tf: 'mom' }, theme: '成長' },
  { key: 'gdp', xq: 'EI020013', name: 'GDP 成長年率（季）', agency: 'BEA', et: '08:30', imp: 3, unit: '%', dec: 1, fred: { id: 'A191RL1Q225SBEA', tf: 'level' }, theme: '成長' },
  { key: 'ism_mfg', xq: 'EI020021', name: 'ISM 製造業指數', agency: 'ISM', et: '10:00', imp: 3, unit: '指數', dec: 1, theme: '成長' },
  { key: 'ism_svc', xq: 'EI020102', name: 'ISM 非製造業指數', agency: 'ISM', et: '10:00', imp: 2, unit: '指數', dec: 1, theme: '成長' },
  { key: 'retail_mom', xq: 'EI020065', name: '零售銷售月增率', agency: 'Census', et: '08:30', imp: 3, unit: '%', dec: 1, fred: { id: 'RSAFS', tf: 'mom' }, theme: '成長' },
  { key: 'umich', xq: 'EI020007', name: '密大消費者信心', agency: 'UMich', et: '10:00', imp: 2, unit: '指數', dec: 1, fred: { id: 'UMCSENT', tf: 'level' }, theme: '信心' },
  { key: 'cb_conf', xq: 'EI020015', name: '經濟諮商會消費者信心', agency: 'Conference Board', et: '10:00', imp: 2, unit: '指數', dec: 1, theme: '信心' },
  { key: 'durable_mom', xq: 'EI020020', name: '耐久財訂單月增率', agency: 'Census', et: '08:30', imp: 2, unit: '%', dec: 1, fred: { id: 'DGORDER', tf: 'mom' }, theme: '成長' },
  { key: 'housing_starts', xq: 'EI020010', name: '新屋開工', agency: 'Census', et: '08:30', imp: 1, unit: '千戶', dec: 0, fred: { id: 'HOUST', tf: 'level' }, theme: '房市' },
  { key: 'permits', xq: 'EI020011', name: '建築許可', agency: 'Census', et: '08:30', imp: 1, unit: '千戶', dec: 0, fred: { id: 'PERMIT', tf: 'level' }, theme: '房市' },
  { key: 'new_home', xq: 'EI020014', name: '新屋銷售', agency: 'Census', et: '10:00', imp: 1, unit: '千戶', dec: 0, fred: { id: 'HSN1F', tf: 'level' }, theme: '房市' },
  { key: 'fomc', xq: 'EI020122', name: 'FOMC 利率決議（目標區間上限）', agency: 'Fed', et: '14:00', imp: 3, unit: '%', dec: 2, theme: '政策' },
];
export const BY_XQ = Object.fromEntries(RELEASES.map(r => [r.xq, r]));
export const BY_KEY = Object.fromEntries(RELEASES.map(r => [r.key, r]));

// 已知未公布期間（官方停擺）：不插值，顯示原因
export const NOT_PUBLISHED = [
  { periods: ['2025-10'], keys: ['cpi_mom', 'cpi_yoy', 'core_cpi_yoy'], reason: '2025 年 10 月聯邦政府停擺，BLS 未編製 10 月 CPI' },
  { periods: ['2025-11'], keys: ['cpi_mom'], reason: '缺 10 月指數，BLS 未發布 11 月經季調月增率' },
];
export function notPublished(key, period) {
  return NOT_PUBLISHED.find(n => n.keys.includes(key) && n.periods.includes(period.slice(0, 7))) || null;
}

// ---- 時區：美東 → UTC → 台灣（用 Intl 的 America/New_York 規則處理夏令時間） ----
const offsetMin = (utcMs, tz) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - utcMs) / 60e3;
};
/** 美東當地 'YYYY-MM-DD' + 'HH:MM' → UTC 毫秒 */
export function etToUtc(date, hhmm) {
  const [y, m, d] = date.split('-').map(Number); const [hh, mm] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetMin(guess, 'America/New_York') * 60e3;
  t = guess - offsetMin(t, 'America/New_York') * 60e3; // 第二次迭代處理切換日
  return t;
}
export const isUsDst = (utcMs) => offsetMin(utcMs, 'America/New_York') === -240;
const fmt = (utcMs, tz) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, wd: p.weekday };
};
export const twTime = (utcMs) => fmt(utcMs, 'Asia/Taipei');
export const etTime = (utcMs) => fmt(utcMs, 'America/New_York');
const WD = { Mon: '一', Tue: '二', Wed: '三', Thu: '四', Fri: '五', Sat: '六', Sun: '日' };
export function releaseTime(date, et) {
  if (!et) return { utc: null, tw: null, et: null, dst: null };
  const utc = etToUtc(date, et); const t = twTime(utc);
  return { utc, utcIso: new Date(utc).toISOString(), tw: `${t.date.slice(5)}（${WD[t.wd]}）${t.time}`, twDate: t.date, et: `${date} ${et} ET`, dst: isUsDst(utc) };
}

// ---- 期間換算：水準序列 → 發布口徑 ----
/** obs: [{period:'YYYY-MM' 或 'YYYY-MM-DD', value}] 依期間排序；回傳同口徑 [{period, value}] */
export function transform(obs, tf, dec = 1) {
  const r = (x) => Math.round(x * 10 ** dec) / 10 ** dec;
  const byP = new Map(obs.map(o => [o.period, o.value]));
  const prevMonth = (p) => { const [y, m] = p.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
  const prevYear = (p) => `${+p.slice(0, 4) - 1}${p.slice(4)}`;
  const out = [];
  for (const o of obs) {
    if (o.value == null) { out.push({ period: o.period, value: null }); continue; }
    if (tf === 'level') out.push({ period: o.period, value: o.value });
    else if (tf === 'k') out.push({ period: o.period, value: Math.round(o.value / 1000) });
    else {
      const base = tf === 'yoy' ? byP.get(prevYear(o.period)) : byP.get(prevMonth(o.period.slice(0, 7)));
      if (base == null) { out.push({ period: o.period, value: null }); continue; }
      out.push({ period: o.period, value: tf === 'diff' ? r(o.value - base) : r((o.value / base - 1) * 100) });
    }
  }
  return out;
}

// ---- FOMC 會議日曆（federalreserve.gov/monetarypolicy/fomccalendars.htm） ----
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function parseFomc(html) {
  const out = [];
  const panels = html.split(/<h4><a[^>]*>(\d{4}) FOMC Meetings<\/a><\/h4>/);
  for (let i = 1; i < panels.length; i += 2) {
    const year = +panels[i]; const body = panels[i + 1];
    const rows = body.split(/<div class="[^"]*\brow fomc-meeting\b[^"]*"/).slice(1);
    for (const row of rows) {
      const mon = (row.match(/fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>/) || [])[1];
      const dt = (row.match(/fomc-meeting__date[^>]*>([^<]+)</) || [])[1];
      if (!mon || !dt) continue;
      const months = mon.split('/').map(s => MONTHS.findIndex(m => m.startsWith(s.trim().slice(0, 3))));
      const sep = /\*/.test(dt);
      const days = dt.replace(/[*()]/g, '').trim().match(/\d+/g)?.map(Number) || [];
      if (!days.length || months[0] < 0) continue;
      const lastMonth = months[months.length - 1];
      const endDay = days[days.length - 1];
      const startDay = days[0];
      const iso = (m, d) => `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const unscheduled = /unscheduled|notation vote/i.test(row);
      const statement = (row.match(/href="([^"]*monetary\d{8}a\.htm)"/) || [])[1] || null;
      const proj = (row.match(/href="([^"]*fomcprojtabl\d{8}\.htm)"/) || [])[1] || null;
      const minutes = (row.match(/href="([^"]*fomcminutes\d{8}\.htm)"/) || [])[1] || null;
      out.push({ date: iso(lastMonth, endDay), start: iso(months[0], startDay), year, sep, unscheduled, statement: abs(statement), projections: abs(proj), minutes: abs(minutes) });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
const abs = (u) => !u ? null : u.startsWith('http') ? u : 'https://www.federalreserve.gov' + u;

/** 點陣圖（SEP 表 1「Projected appropriate policy path」聯邦基金利率）的中位數 */
export function parseDotMedian(html) {
  const heads = {};
  // 2025-09 起表格 id 加了 xt1 前綴（xt1b1、xt1a2），舊版為 xb1、xa2
  for (const m of html.matchAll(/<th[^>]*id="((?:xt1)?x?b\d+)"[^>]*>([\s\S]*?)<\/th>/g)) heads[m[1]] ??= m[2].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  const i = html.search(/<th class="stub"[^>]*>Federal funds rate<\/th>/);
  if (i < 0) return null;
  const row = html.slice(i, html.indexOf('</tr>', i));
  const cells = [...row.matchAll(/<td class="data" headers="(?:xt1)?x?a2 ((?:xt1)?x?b\d+)[^"]*">([^<]+)<\/td>/g)].map(m => ({ label: heads[m[1]] || m[1], value: +m[2] }));
  return cells.length ? cells : null;
}
