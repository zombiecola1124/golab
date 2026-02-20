/**
 * db.js — Firebase Admin SDK + Firestore 쿼리 헬퍼
 * 웹 프론트(js/db.js)와 동일 Firestore에 서버사이드로 접근
 */

const admin = require('firebase-admin');
const path = require('path');

let db = null;

function initFirebase() {
  if (admin.apps.length) {
    db = admin.firestore();
    return db;
  }

  let credential;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    // 환경변수에 JSON 문자열 직접 설정 (클라우드 배포용)
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    credential = admin.credential.cert(sa);
  } else {
    // 파일 경로 (로컬 개발용)
    const saPath = process.env.FIREBASE_SERVICE_ACCOUNT || './service-account.json';
    const resolved = path.isAbsolute(saPath) ? saPath : path.resolve(__dirname, saPath);
    credential = admin.credential.cert(require(resolved));
  }

  admin.initializeApp({ credential });
  db = admin.firestore();
  console.log('[DB] Firebase Admin 초기화 완료');
  return db;
}

function getDB() {
  if (!db) initFirebase();
  return db;
}

// ── 품목 검색 (name/sku 부분 일치) ──

async function searchItems(keyword) {
  const snap = await getDB().collection('items').get();
  const items = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(i => (i.status || '') !== 'DELETED');

  if (!keyword) return items;

  const q = keyword.toLowerCase();
  return items.filter(item =>
    (item.name || '').toLowerCase().includes(q) ||
    (item.sku || '').toLowerCase().includes(q)
  );
}

// ── 부족/위험 품목 ──

async function getLowStockItems() {
  const snap = await getDB().collection('items').get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(item => {
      if ((item.status || '') === 'DELETED') return false;
      const qty = item.qty_on_hand || 0;
      const min = item.qty_min || 0;
      return qty <= 0 || qty < min || item.status === 'RISK' || item.status === 'OUT';
    });
}

// ── 거래처 통합 검색 (customers + vendors) ──

async function searchCustomers(keyword) {
  const [custSnap, vendSnap] = await Promise.all([
    getDB().collection('customers').get(),
    getDB().collection('vendors').get()
  ]);

  const customers = custSnap.docs.map(d => ({ id: d.id, type: 'customer', ...d.data() }));
  const vendors = vendSnap.docs.map(d => ({ id: d.id, type: 'vendor', ...d.data() }));
  const all = [...customers, ...vendors];

  if (!keyword) return all;

  const q = keyword.toLowerCase();
  return all.filter(c => (c.name || '').toLowerCase().includes(q));
}

// ── 미수금 (미결 인보이스) ──

async function getUnpaidInvoices() {
  const snap = await getDB().collection('invoices').get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(inv => inv.status !== 'PAID');
}

// ── 최근 매입 이력 ──

async function getRecentPurchases(itemId, maxResults = 5) {
  try {
    const snap = await getDB().collection('purchases')
      .where('item_id', '==', itemId)
      .orderBy('purchased_at', 'desc')
      .limit(maxResults)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (_) {
    // 복합 인덱스 미설정 시 폴백: 클라이언트 정렬
    try {
      const snap = await getDB().collection('purchases')
        .where('item_id', '==', itemId)
        .get();
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      docs.sort((a, b) => {
        const ta = a.purchased_at ? new Date(a.purchased_at).getTime() : 0;
        const tb = b.purchased_at ? new Date(b.purchased_at).getTime() : 0;
        return tb - ta;
      });
      return docs.slice(0, maxResults);
    } catch (_) {
      return [];
    }
  }
}

// ── 전체 품목 (알림 초기화용) ──

async function getAllItems() {
  const snap = await getDB().collection('items').get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(i => (i.status || '') !== 'DELETED');
}

module.exports = {
  initFirebase,
  getDB,
  searchItems,
  getLowStockItems,
  searchCustomers,
  getUnpaidInvoices,
  getRecentPurchases,
  getAllItems
};
