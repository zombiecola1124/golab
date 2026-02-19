/**
 * db.js — Firestore 추상화 레이어
 * 원칙: 모든 Firestore 직접 호출은 이 파일을 통해서만.
 *       추후 DB 교체 시 이 파일만 수정.
 *
 * v1: Firebase Firestore (Web SDK v9 modular)
 * 대체 가능: Supabase, PocketBase, 로컬 JSON 등
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore, collection, doc, addDoc, getDoc, getDocs,
  updateDoc, deleteDoc, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, Timestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// ── Firebase Config ──
// GitHub Pages 배포 시 이 값은 공개됨 (정상).
// 반드시 Firestore Security Rules로 인증 없는 접근 차단할 것.
const firebaseConfig = {
  apiKey: "AIzaSyBSZrBwukJ6wPDUHpn1m_QdDNf4wVFAIY4",
  authDomain: "golab-47587.firebaseapp.com",
  projectId: "golab-47587",
  storageBucket: "golab-47587.firebasestorage.app",
  messagingSenderId: "644983132263",
  appId: "1:644983132263:web:a25989ca0ce67ff318c4c2"
};

let app = null;
let db = null;
let auth = null;
let _initialized = false;

/**
 * Firebase 초기화 + 익명 인증
 * @returns {Promise<void>}
 */
export async function initDB() {
  if (_initialized) return;

  // config 미설정 시 데모 모드
  if (!firebaseConfig.apiKey) {
    console.warn('[DB] Firebase config 미설정 — 로컬 데모 모드로 전환');
    _initialized = true;
    return;
  }

  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);

  // v1: 익명 인증 (단일 사용자)
  await signInAnonymously(auth);

  return new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => {
      if (user) {
        console.log('[DB] 인증 완료:', user.uid);
        _initialized = true;
        resolve();
      }
    });
  });
}

/**
 * Firestore 사용 가능 여부
 */
export function isFirestoreReady() {
  return _initialized && db !== null;
}

// ── 컬렉션 이름 상수 ──
export const COLLECTIONS = {
  ITEMS: 'items',
  PURCHASES: 'purchases',
  DELIVERIES: 'deliveries',
  VENDORS: 'vendors',
  CUSTOMERS: 'customers',
  INVOICES: 'invoices',
  AUDIT_LOG: 'audit_log',
  STOCKTAKES: 'stocktakes'
};

// ── CRUD 래퍼 ──

/**
 * 문서 추가
 * @param {string} col - 컬렉션명
 * @param {object} data - 저장할 데이터
 * @returns {Promise<string>} 생성된 문서 ID
 */
export async function createDoc(col, data) {
  if (!isFirestoreReady()) return _demoCreate(col, data);
  const docRef = await addDoc(collection(db, col), {
    ...data,
    created_at: serverTimestamp()
  });
  return docRef.id;
}

/**
 * 문서 조회 (단건)
 * @param {string} col - 컬렉션명
 * @param {string} docId - 문서 ID
 * @returns {Promise<object|null>}
 */
export async function readDoc(col, docId) {
  if (!isFirestoreReady()) return _demoRead(col, docId);
  const snap = await getDoc(doc(db, col, docId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * 컬렉션 전체 조회 (옵션: 정렬, 필터, 제한)
 * @param {string} col - 컬렉션명
 * @param {object} opts - { orderField, orderDir, limitCount, filters: [{field, op, value}] }
 * @returns {Promise<array>}
 */
export async function readAll(col, opts = {}) {
  if (!isFirestoreReady()) return _demoReadAll(col);

  let q = collection(db, col);
  const constraints = [];

  if (opts.filters) {
    for (const f of opts.filters) {
      constraints.push(where(f.field, f.op, f.value));
    }
  }
  if (opts.orderField) {
    constraints.push(orderBy(opts.orderField, opts.orderDir || 'desc'));
  }
  if (opts.limitCount) {
    constraints.push(limit(opts.limitCount));
  }

  q = query(q, ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * 문서 수정
 * @param {string} col - 컬렉션명
 * @param {string} docId - 문서 ID
 * @param {object} data - 수정할 필드
 * @returns {Promise<void>}
 */
export async function updateDocument(col, docId, data) {
  if (!isFirestoreReady()) return _demoUpdate(col, docId, data);
  await updateDoc(doc(db, col, docId), {
    ...data,
    updated_at: serverTimestamp()
  });
}

/**
 * 문서 삭제
 * @param {string} col - 컬렉션명
 * @param {string} docId - 문서 ID
 * @returns {Promise<void>}
 */
export async function deleteDocument(col, docId) {
  if (!isFirestoreReady()) return _demoDelete(col, docId);
  await deleteDoc(doc(db, col, docId));
}

/**
 * 배치 쓰기 (여러 문서 동시 수정 — 트랜잭션)
 * @param {function} batchFn - (batch, db) => void
 * @returns {Promise<void>}
 */
export async function batchWrite(batchFn) {
  if (!isFirestoreReady()) return;
  const batch = writeBatch(db);
  batchFn(batch, db, doc, collection);
  await batch.commit();
}

/**
 * 서버 타임스탬프 반환
 */
export function getTimestamp() {
  if (!isFirestoreReady()) return new Date().toISOString();
  return serverTimestamp();
}

/**
 * Timestamp → Date 문자열 변환
 */
export function formatDate(ts) {
  if (!ts) return '-';
  if (ts.toDate) return ts.toDate().toLocaleDateString('ko-KR');
  if (ts instanceof Date) return ts.toLocaleDateString('ko-KR');
  return new Date(ts).toLocaleDateString('ko-KR');
}

// ── 로컬 데모 모드 (Firebase 미설정 시) ──
// LocalStorage 기반으로 기본 CRUD 동작

function _demoKey(col) { return `golab_demo_${col}`; }

function _demoGetAll(col) {
  try { return JSON.parse(localStorage.getItem(_demoKey(col)) || '[]'); }
  catch { return []; }
}

function _demoSaveAll(col, data) {
  localStorage.setItem(_demoKey(col), JSON.stringify(data));
}

function _demoCreate(col, data) {
  const all = _demoGetAll(col);
  const id = 'demo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  all.push({ id, ...data, created_at: new Date().toISOString() });
  _demoSaveAll(col, all);
  return id;
}

function _demoRead(col, docId) {
  return _demoGetAll(col).find(d => d.id === docId) || null;
}

function _demoReadAll(col) {
  return _demoGetAll(col);
}

function _demoUpdate(col, docId, data) {
  const all = _demoGetAll(col);
  const idx = all.findIndex(d => d.id === docId);
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...data, updated_at: new Date().toISOString() };
    _demoSaveAll(col, all);
  }
}

function _demoDelete(col, docId) {
  const all = _demoGetAll(col).filter(d => d.id !== docId);
  _demoSaveAll(col, all);
}
