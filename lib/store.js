// store.js — 單機 JSON 資料庫。公開資料表存 data/db.json；
// 持股與觀察條件屬使用者私人資料，以 AES-256-GCM 加密存 data/private.enc（金鑰 data/.key，只存在本機）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const EMPTY = () => ({
  meta: { createdAt: Date.now(), schema: 1 },
  vintages: {},        // macro_observation：series_id → { vintage(YYYY-MM-DD) → { src, at, rows: { period → value } } }，只新增不覆寫
  consensus: [],       // macro_consensus：{ xq, period, est, lastYear, src, capturedAt, publishDate }（值變動才新增）
  releases: {},        // macro_release：`${xq}|${period}` → { publishDate, firstSeenAt, dateHistory: [] }
  calendarItems: {},   // xq → { name, unit, dec, freq }（日曆中出現過的所有指標）
  audit: [],           // 來源衝突與異常稽核日誌
  fomc: [],            // fomc_meeting
  dots: {},            // SEP 會議日 → 點陣圖中位數
  alfredDone: {},      // `${fredId}|${vintage}` → true（已匯入的 ALFRED 版本）
  cursors: {},         // 各工作上次執行時間
});
// 持股清單與總經觀察條件屬使用者私人資料
const EMPTY_PRIVATE = () => ({ holdings: ['NVDA.US', 'AAPL.US', 'JPM.US'], conditions: {} });

export function openStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const dbFile = path.join(dir, 'db.json');
  const encFile = path.join(dir, 'private.enc');
  const keyFile = path.join(dir, '.key');
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  const key = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64');

  let db = EMPTY();
  if (fs.existsSync(dbFile)) db = { ...EMPTY(), ...JSON.parse(fs.readFileSync(dbFile, 'utf8')) };
  let priv = EMPTY_PRIVATE();
  if (fs.existsSync(encFile)) {
    const raw = fs.readFileSync(encFile);
    const iv = raw.subarray(0, 12), tagB = raw.subarray(12, 28), ct = raw.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tagB);
    priv = { ...EMPTY_PRIVATE(), ...JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString('utf8')) };
  }

  function writeAtomic(file, buf) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, buf); fs.renameSync(tmp, file); }
  let timer = null, privDirty = false, dbDirty = false;
  function flush() {
    timer = null;
    if (dbDirty) { writeAtomic(dbFile, JSON.stringify(db)); dbDirty = false; }
    if (privDirty) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([c.update(JSON.stringify(priv), 'utf8'), c.final()]);
      writeAtomic(encFile, Buffer.concat([iv, c.getAuthTag(), ct]));
      privDirty = false;
    }
  }
  const schedule = () => { if (!timer) timer = setTimeout(flush, 400); };

  return {
    get db() { return db; },
    get priv() { return priv; },
    save() { dbDirty = true; schedule(); },
    savePrivate() { privDirty = true; schedule(); },
    flushNow() { if (timer) clearTimeout(timer); flush(); },
    /** 交易：失敗時整庫回滾（以快照還原） */
    tx(fn) {
      const snapA = JSON.stringify(db), snapB = JSON.stringify(priv);
      try { const r = fn(db, priv); dbDirty = true; privDirty = true; schedule(); return r; }
      catch (e) { db = JSON.parse(snapA); priv = JSON.parse(snapB); throw e; }
    },
  };
}

export const uid = (p = '') => p + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
export const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
