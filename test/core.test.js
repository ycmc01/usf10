import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseTime, transform, parseFomc, parseDotMedian, notPublished } from '../lib/catalog.js';
import { periodKey, addVintage, history, valueAsOf, firstVsCurrent, surprise, standardized, estimateAnomaly, gaps, staleness, percentile, inWorst, changeN, reaction, pairedChanges, evalCondition } from '../lib/macro.js';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} ≈ ${b}`);

test('公布時間：美東 08:30 → 台灣，夏令 20:30、冬令 21:30（2026-11-01 切換）', () => {
  const s = releaseTime('2026-10-15', '08:30');
  assert.equal(s.utcIso, '2026-10-15T12:30:00.000Z'); assert.match(s.tw, /20:30/); assert.equal(s.dst, true);
  const w = releaseTime('2026-11-02', '08:30');
  assert.equal(w.utcIso, '2026-11-02T13:30:00.000Z'); assert.match(w.tw, /21:30/); assert.equal(w.dst, false);
  assert.match(releaseTime('2026-10-28', '14:00').tw, /10-29.*02:00/); // FOMC 決議跨到台灣隔日
});

test('口徑換算：月增、年增、差額；缺月不插值', () => {
  const obs = [{ period: '2025-08', value: 100 }, { period: '2025-09', value: 101 }, { period: '2025-11', value: 102 }, { period: '2026-09', value: 104.04 }];
  const mom = transform(obs, 'mom', 1);
  assert.equal(mom[1].value, 1); assert.equal(mom[2].value, null); // 2025-10 缺 → 11 月月增率不可算
  assert.equal(transform(obs, 'yoy', 1)[3].value, 3);
  assert.equal(transform(obs, 'diff', 0)[1].value, 1);
  assert.ok(notPublished('cpi_yoy', '2025-10')); assert.equal(notPublished('cpi_yoy', '2025-09'), null);
});

test('版本：只新增不覆寫、相同內容不重複、時點查詢、首次公布 vs 目前', () => {
  const db = { vintages: {} };
  assert.equal(addVintage(db, 'S', '2026-08-31', [{ period: '2026-07', value: 73 }], { src: 'ALFRED' }), true);
  assert.equal(addVintage(db, 'S', '2026-08-31', [{ period: '2026-07', value: 999 }], { src: 'ALFRED' }), false); // 同版本不覆寫
  addVintage(db, 'S', '2026-09-30', [{ period: '2026-07', value: 79 }, { period: '2026-08', value: 22 }], { src: 'ALFRED' });
  addVintage(db, 'S', '2026-10-31', [{ period: '2026-07', value: 79 }, { period: '2026-08', value: 29 }, { period: '2026-09', value: null }], { src: 'ALFRED' });
  assert.equal(db.vintages.S['2026-10-31'].rows['2026-09'], undefined); // 缺值不寫
  assert.equal(valueAsOf(db, 'S', '2026-07', '2026-09-15').value, 73); // 9/15 當時只有 8 月底版本
  const f = firstVsCurrent(history(db, 'S')['2026-07']);
  assert.equal(f.first.value, 73); assert.equal(f.current.value, 79); assert.equal(f.revisions, 1);
  // 自行擷取：與前一版相同不新增
  addVintage(db, 'X', '2026-10-17T09:00', [{ period: '2026-09', value: 1 }], { src: 'XQ' });
  assert.equal(addVintage(db, 'X', '2026-10-17T10:00', [{ period: '2026-09', value: 1 }], { src: 'XQ' }), false);
  assert.equal(valueAsOf(db, 'X', '2026-09', '2026-10-17').value, 1); // 當天時間戳版本算當日可得
});

test('預期差：文字＋數值，依小數位判斷符合；標準化需累積樣本', () => {
  assert.deepEqual(surprise(0.4, 0.3, 1), { diff: 0.1, text: '高於' });
  assert.equal(surprise(0.3, 0.3, 1).text, '符合');
  assert.equal(surprise(150, 180, 0).text, '低於');
  assert.equal(standardized(0.1, [0.1, -0.1]).z, null); // 樣本 < 6
  const s = standardized(0.2, [0.1, -0.1, 0.1, -0.1, 0.1, -0.1]);
  near(s.z, 0.2 / Math.sqrt(0.06 / 5 * 1)); assert.equal(s.n, 6);
  assert.equal(standardized(1, Array(30).fill(0).map((_, i) => i % 2 ? 1 : -1)).n, 24); // 只用最近 24 次
});

test('異常預估：量級錯誤與超過 5 個標準差', () => {
  assert.match(estimateAnomaly(26.5, 2.1, []), /量級/);
  const hist = Array.from({ length: 24 }, (_, i) => 3 + (i % 2) * 0.1);
  assert.match(estimateAnomaly(5, 3.1, hist), /5 個標準差/);
  assert.equal(estimateAnomaly(3.2, 3.1, hist), null);
});

test('缺漏與停更：2025-10 缺月；USGB0103 停在 2026-02 → 停更', () => {
  assert.deepEqual(gaps(['2025-08', '2025-09', '2025-11', '2025-12'], 'M'), ['2025-10']);
  assert.deepEqual(gaps(['2025-03', '2025-09'], 'Q'), ['2025-06']);
  assert.equal(staleness('2026-02', 'M', '2026-10-18').stale, true);
  assert.equal(staleness('2026-09', 'M', '2026-10-18').stale, false);
  assert.equal(periodKey('2026-07-01', 'Q', { quarterStart: true }), '2026-09'); // FRED 季初日期 → 季末月
  assert.equal(periodKey('2026-09-30', 'Q'), '2026-09');
});

test('跨資產：百分位需涵蓋 80% 窗口；最差 10% 依方向；近 20 筆變化', () => {
  const s = Array.from({ length: 800 }, (_, i) => ({ date: new Date(Date.UTC(2023, 9, 20) + i * 864e5 * 1.4).toISOString().slice(0, 10), value: i }));
  const p = percentile(s, 3, { expectedPerYear: 250 });
  assert.equal(p.pct, 100); assert.equal(inWorst(p.pct, 'high'), true); assert.equal(inWorst(p.pct, 'low'), false);
  assert.equal(percentile(s, 10, { expectedPerYear: 250 }).pct, null);
  assert.equal(changeN(s, 20).diff, 20);
});

test('公布後反應：前一交易日收盤 → 當日收盤；休市日回 null', () => {
  const s = [{ date: '2026-09-15', value: 4.67 }, { date: '2026-09-16', value: 4.74 }, { date: '2026-09-17', value: null }];
  near(reaction(s, '2026-09-16', { mode: 'bp' }).change, 7, 1e-6);
  near(reaction([{ date: 'a', value: 100 }, { date: 'b', value: 99 }], 'b').change, -1);
  assert.equal(reaction(s, '2026-09-17'), null);
});

test('持股疊加：只配對兩邊相鄰觀測；相關係數', () => {
  const stock = [{ date: 'd1', close: 100 }, { date: 'd2', close: 101 }, { date: 'd3', close: 100 }, { date: 'd4', close: 102 }, { date: 'd5', close: 101 }];
  const ser = [{ date: 'd1', value: 4.0 }, { date: 'd2', value: 4.1 }, { date: 'd3', value: null }, { date: 'd4', value: 4.2 }, { date: 'd5', value: 4.1 }];
  const p = pairedChanges(stock, ser, { scale: 100 });
  assert.deepEqual(p.dates, ['d2', 'd5']); // d3 缺值、d4 的前一筆 d3 缺 → 不配對
  assert.equal(p.r, null); // 樣本 < 3
});

test('觀察條件：連續 n 次', () => {
  const v = [{ period: 'a', value: 0.2 }, { period: 'b', value: 0.4 }, { period: 'c', value: 0.35 }];
  assert.equal(evalCondition(v, { op: '>', value: 0.3, n: 2 }).met, true);
  assert.equal(evalCondition(v, { op: '>', value: 0.3, n: 3 }).met, false);
});

test('FOMC 日曆與點陣圖解析（含灰底列、* 表示有經濟預測、2025 起 xt1 前綴）', () => {
  const html = `<h4><a id="1">2026 FOMC Meetings</a></h4>
  <div class="row fomc-meeting" "><div class="fomc-meeting__month col"><strong>January</strong></div><div class="fomc-meeting__date col">27-28</div><a href="/newsevents/pressreleases/monetary20260128a.htm">HTML</a></div>
  <div class="fomc-meeting--shaded row fomc-meeting" "><div class="fomc-meeting--shaded fomc-meeting__month col"><strong>March</strong></div><div class="fomc-meeting__date col">17-18*</div><a href="/monetarypolicy/fomcprojtabl20260318.htm">Projections</a></div>`;
  const m = parseFomc(html);
  assert.equal(m.length, 2); assert.equal(m[0].date, '2026-01-28'); assert.equal(m[1].sep, true);
  assert.match(m[1].projections, /fomcprojtabl20260318/);
  const sep = `<th id="xt1b1">2026</th><th id="xt1b2">Longer run</th><th class="stub" headers="xt1a1 xt1r9" id="xt1r10">Federal funds rate</th><td class="data" headers="xt1a2 xt1b1 xt1r9 xt1r10">4.1</td><td class="data" headers="xt1a2 xt1b2 xt1r9 xt1r10">3.2</td><td class="data" headers="xt1a3 xt1b6 xt1r9">4.1–4.4</td></tr>`;
  assert.deepEqual(parseDotMedian(sep), [{ label: '2026', value: 4.1 }, { label: 'Longer run', value: 3.2 }]);
});
