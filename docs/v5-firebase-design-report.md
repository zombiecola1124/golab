# GoLab v5 Firebase 사전 설계 보고서

> 작성일: 2026-03-23
> 기준: v5 MASTER SPEC (고대표 지시문)
> 상태: **승인 대기**

---

## 목차

1. [Firebase 컬렉션 설계](#1-firebase-컬렉션-설계)
2. [StorageAdapter 인터페이스 설계](#2-storageadapter-인터페이스-설계)
3. [localStorage ↔ Firebase 매핑표](#3-localstorage--firebase-매핑표)
4. [마이그레이션 방식](#4-마이그레이션-방식)
5. [롤백 방식](#5-롤백-방식)
6. [영향 파일 목록](#6-영향-파일-목록)
7. [trade-engine.js 수정 여부](#7-trade-enginejs-수정-여부)

부록:
- [A. 전체 localStorage 키 목록](#부록-a-전체-localstorage-키-목록-31개)
- [B. 핵심 5키 데이터 구조](#부록-b-핵심-5키-데이터-구조)

---

## 1. Firebase 컬렉션 설계

### 1-1. 구조 원칙

```
Firestore
└── users/{userId}          ← 단일 사용자 (고대표)
    ├── trades/all           ← 문서 1개 (golab_trade_v2 전체 배열)
    ├── items/all            ← 문서 1개 (golab_item_master_v1 전체 배열)
    ├── partners/all         ← 문서 1개 (golab_partner_master_v1 전체 배열)
    ├── actions/all          ← 문서 1개 (golab_actions_v15 전체 배열)
    └── channels/all         ← 문서 1개 (golab_channel_master_v1 전체 배열)
```

### 1-2. 문서 크기 1MB 제한 정밀 검증

Firestore 문서 최대 크기는 **1,048,576 bytes (1MB)**.
거래 1건의 실제 JSON 크기를 측정하여 초과 가능성을 산정했다.

**측정 기준 (실제 trade-engine.js 데이터 구조 기반):**

| 시나리오 | items | extra_costs | 1건 크기 |
|----------|:-----:|:-----------:|----------|
| 최소 (1품목, 부대비용 없음) | 1 | 0 | **758 bytes (0.7 KB)** |
| 최대 (3품목, 3부대비용, 타임라인, 모든 필드) | 3 | 3 | **2,480 bytes (2.4 KB)** |
| **평균 추정** | 1~2 | 0~1 | **1,619 bytes (1.6 KB)** |

**건수별 용량 추정 (평균 1.6 KB/건 기준):**

| 건수 | 용량 | 1MB 대비 | 판정 |
|-----:|-----:|:--------:|------|
| 50건 | 79 KB | 7.7% | ✅ 안전 |
| 100건 | 158 KB | 15.4% | ✅ 안전 |
| 200건 | 316 KB | 30.9% | ✅ 안전 |
| 300건 | 474 KB | 46.3% | ✅ 안전 |
| **500건** | **791 KB** | **77.2%** | **✅ 안전** |
| 600건 | 949 KB | 92.6% | ⚠️ 주의 |
| **650건** | **1,028 KB** | **100.4%** | **❌ 초과** |
| 700건 | 1,107 KB | 108.1% | ❌ 초과 |

**결론:**
- 현재 데이터: ~100건 미만 → **15% 사용, 충분히 안전**
- 안전 한도: **500건 이하** (77%, 여유 23%)
- 위험 시작: **600건** (93%)
- 초과 시점: **650건**

### 1-3. 500건 초과 시 자동 분할 전략 (안전장치)

StorageAdapter에 **push 전 크기 체크 로직**을 내장한다:

```javascript
async pushToFirebase(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return;
  const sizeBytes = new Blob([raw]).size;
  const LIMIT = 900 * 1024;  // 900KB 안전 마진 (1MB의 ~86%)

  if (sizeBytes > LIMIT) {
    console.warn('[StorageAdapter] ' + key + ' 크기 초과: ' + (sizeBytes/1024).toFixed(0) + 'KB');
    // push 차단 + UI 경고 토스트
    // → v6에서 문서 분할 전략(trades/chunk_0, chunk_1...) 도입
    return { status: 'blocked', reason: 'size_limit', size: sizeBytes };
  }

  // 정상 push 진행...
}
```

**왜 "거래 1건 = 문서 1개" 방식을 v5에서 채택하지 않는가:**

| 대안 | 장점 | 단점 | 판정 |
|------|------|------|------|
| **A. 거래 1건 = 문서 1개** | Firestore 정석, 무제한 확장 | 현재 loadAll()→배열→_save(배열) 패턴을 전면 리팩토링 필요. create/update/remove 모두 Firestore 개별 문서 CRUD로 재작성. _recalcSegyeongBalances()는 전체 배열 필요 → 매번 전건 조회 | ❌ v5 범위 초과 |
| **B. 키 1개 = 문서 1개 (배열 통째)** | localStorage ↔ Firestore 1:1 매핑. 코드 변경 8줄. 기존 loadAll/save 패턴 유지 | 문서 1MB 제한 (500건 안전) | ✅ 채택 |
| **C. 키 1개 = 문서 N개 (자동 분할)** | 대용량 대비 가능 | 현재 ~100건에 불필요한 복잡도. 분할/병합 로직 버그 위험 | ❌ 시기상조 |

**채택 근거 요약:**
1. 현재 ~100건 → 500건 안전 한도까지 **5배 여유**
2. 1인 사업자 월 10~20건 거래 기준 → 500건 도달까지 **약 2~4년**
3. push 전 크기 체크로 초과 사전 차단
4. v6+에서 필요 시 문서 분할 또는 A방식 전환 검토

### 1-4. 컬렉션 상세

| Firestore 경로 | localStorage 키 | 문서 구조 |
|----------------|-----------------|-----------|
| `users/{uid}/trades/all` | `golab_trade_v2` | `{ data: [...], updated_at: timestamp, version: "v2" }` |
| `users/{uid}/items/all` | `golab_item_master_v1` | `{ data: [...], updated_at: timestamp, version: "v1" }` |
| `users/{uid}/partners/all` | `golab_partner_master_v1` | `{ data: [...], updated_at: timestamp, version: "v1" }` |
| `users/{uid}/actions/all` | `golab_actions_v15` | `{ data: [...], updated_at: timestamp, version: "v15" }` |
| `users/{uid}/channels/all` | `golab_channel_master_v1` | `{ data: [...], updated_at: timestamp, version: "v1" }` |

**문서 메타 필드:**
- `data`: 원본 배열 (localStorage와 동일)
- `updated_at`: Firestore serverTimestamp (동기화 충돌 감지용)
- `version`: 스키마 버전 태그

### 1-5. 감사 로그 — Firebase 제외

감사 로그 키 5개 (`*_audit`)는 v5에서 Firebase에 올리지 않는다.
- 로컬 전용 디버깅/추적 목적
- 2000건 자동 trim → 영구 보존 목적 아님
- 필요 시 콘솔 백업으로 JSON 내보내기 가능

---

## 2. StorageAdapter 인터페이스 설계

### 2-1. 파일 구조

```
web/js/
├── storage-adapter.js      ← 공용 인터페이스 (신규)
├── firebase-config.js      ← Firebase 초기화 + Auth (신규)
├── trade-engine.js         ← 수정: localStorage → StorageAdapter
├── item-master.js          ← 수정: localStorage → StorageAdapter
├── partner-master.js       ← 수정: localStorage → StorageAdapter
├── channel-master.js       ← 수정: localStorage → StorageAdapter
└── (나머지 JS 파일 변경 없음)
```

### 2-2. StorageAdapter API

```javascript
/**
 * GoLab StorageAdapter
 * - UI는 이 객체를 통해서만 데이터에 접근한다
 * - localStorage 직접 호출 금지
 * - Firebase 직접 호출 금지
 */
window.GoLabStorage = {

  // ─── 핵심 CRUD ───
  getItem(key)              → string|null     // JSON 문자열 반환 (localStorage 호환)
  setItem(key, value)       → void            // JSON 문자열 저장 + Firebase push
  removeItem(key)           → void            // 삭제 (localStorage만, Firebase는 보존)

  // ─── Firebase 동기화 ───
  pushToFirebase(key)       → Promise<void>   // localStorage → Firebase 수동 업로드
  pullFromFirebase(key)     → Promise<string> // Firebase → localStorage 수동 다운로드
  syncStatus()              → object          // { lastPush, lastPull, pending, error }

  // ─── 모드 제어 ───
  getMode()                 → "local"|"sync"  // 현재 모드
  setMode(mode)             → void            // 모드 전환
  isFirebaseEnabled()       → boolean         // Firebase 활성 여부

  // ─── 메타 ───
  FIREBASE_KEYS: [                            // Firebase 대상 키 목록 (화이트리스트)
    'golab_trade_v2',
    'golab_item_master_v1',
    'golab_partner_master_v1',
    'golab_actions_v15',
    'golab_channel_master_v1'
  ]
};
```

### 2-3. 동작 흐름

```
[UI 호출]
    │
    ▼
GoLabStorage.setItem(key, value)
    │
    ├── 1. localStorage.setItem(key, value)     ← 항상 실행 (SSoT)
    │
    ├── 2. if (mode === "sync" && FIREBASE_KEYS.includes(key))
    │       └── firebase.push(key, value)       ← 비동기, 실패해도 로컬 저장 완료
    │
    └── 3. 실패 시 pendingQueue에 추가           ← 다음 push 시 재시도
```

```
[Firebase pull (on-demand)]
    │
    ▼
GoLabStorage.pullFromFirebase(key)
    │
    ├── 1. firebase.get(key)                    ← Firestore 단건 조회
    │
    ├── 2. if (remote.updated_at > local.updated_at)
    │       └── localStorage.setItem(key, remote.data)
    │
    └── 3. return data
```

### 2-4. 모드 설명

| 모드 | getItem | setItem | Firebase |
|------|---------|---------|----------|
| **local** | localStorage만 | localStorage만 | 비활성 |
| **sync** | localStorage만 | localStorage + Firebase push | 활성 |

- 기본값: `"local"` (Firebase 설정 전까지)
- 전환: 콘솔 설정 패널에서 토글 (UI 변경 최소화)
- `pullFromFirebase()`는 두 모드 모두에서 수동 호출 가능

### 2-5. FIREBASE_KEYS 화이트리스트

Firebase 대상이 아닌 키 (`golab_inventory_v01`, `golab_deals_v1` 등)는
`setItem()` 호출 시에도 Firebase push를 하지 않는다.
화이트리스트에 없는 키 = localStorage 전용.

### 2-6. 에러 처리

```
setItem 실패 케이스:
├── localStorage 실패 (quota 초과)
│   └── throw Error → UI에서 처리
│
├── Firebase 실패 (네트워크/인증)
│   ├── localStorage는 이미 성공 (데이터 안전)
│   ├── pendingQueue에 key 추가
│   └── console.warn() 로깅 (UI 토스트 선택적)
│
└── 모드가 "local"
    └── Firebase 호출 안 함 (정상)
```

---

## 3. localStorage ↔ Firebase 매핑표

### 3-1. Firebase 대상 (5개)

| # | localStorage 키 | Firestore 경로 | 읽기 모듈 | 쓰기 모듈 | 비고 |
|---|-----------------|----------------|-----------|-----------|------|
| 1 | `golab_trade_v2` | `users/{uid}/trades/all` | trade-engine, item-master, console, profit, deals, index | trade-engine | SSoT, 최대 규모 |
| 2 | `golab_item_master_v1` | `users/{uid}/items/all` | item-master, trade-engine | item-master | 품목 마스터 |
| 3 | `golab_partner_master_v1` | `users/{uid}/partners/all` | partner-master, console, profit | partner-master | 거래처 마스터 |
| 4 | `golab_actions_v15` | `users/{uid}/actions/all` | console, calendar, trade | console, calendar | 액션/할일 |
| 5 | `golab_channel_master_v1` | `users/{uid}/channels/all` | channel-master, trade-engine | channel-master | 채널 마스터 |

### 3-2. Firebase 제외 — 감사 로그 (5개)

| # | localStorage 키 | 사유 |
|---|-----------------|------|
| 6 | `golab_trade_v2_audit` | 로컬 디버깅 전용, 2000건 trim |
| 7 | `golab_item_master_audit` | 동일 |
| 8 | `golab_partner_master_audit` | 동일 |
| 9 | `golab_channel_master_audit` | 동일 |
| 10 | `golab_deals_audit` | 레거시 감사 로그 |

### 3-3. Firebase 제외 — 재고/매출/매입 (7개)

| # | localStorage 키 | 사유 |
|---|-----------------|------|
| 11 | `golab_inventory_v01` | v5 범위 외 (재고 시스템) |
| 12 | `golab_stock_log_v1` | v5 범위 외 |
| 13 | `golab_inventory_inbound_history_v01` | v5 범위 외 |
| 14 | `golab_purchases_v2` | v5 범위 외 (매입) |
| 15 | `golab_sales_v1` | v5 범위 외 (매출, 여전히 활성) |
| 16 | `golab_price_history_v1` | v5 범위 외 |
| 17 | `golab_items_meta_v1` | 파생 메타데이터 |

### 3-4. Firebase 제외 — 레거시/읽기전용 (7개)

| # | localStorage 키 | 사유 |
|---|-----------------|------|
| 18 | `golab_deals_v1` | 읽기전용 백업 (**절대 수정 금지**) |
| 19 | `golab_trade_v1` | 레거시 읽기전용 |
| 20 | `golab_calendar_v1` | 레거시 읽기전용 |
| 21 | `golab_worklog_v1` | 레거시 읽기전용 |
| 22 | `golab_vendors_v1` | 레거시 읽기전용 |
| 23 | `golab_deal_todos_v1` | 거래별 TODO (소규모) |
| 24 | `golab_initiatives_v15` | 캘린더 칸반 (소규모) |

### 3-5. Firebase 제외 — 임포트/백업/기타 (7개)

| # | localStorage 키 | 사유 |
|---|-----------------|------|
| 25 | `golab_trade_import_raw_log` | 임포트 원본 (immutable) |
| 26 | `golab_trade_imported_ids` | 멱등성 추적 |
| 27 | `golab_sales_import_raw_log` | 임포트 원본 (immutable) |
| 28 | `golab_sales_imported_ids` | 멱등성 추적 |
| 29 | `golab_partner_master_pre_batch_backup` | 임시 백업 |
| 30 | `golab_work_audit` | 레거시 감사 |
| 31 | `golab_trade_audit` / `golab_sales_audit` | 레거시 감사 |

---

## 4. 마이그레이션 방식

### 4-1. 핵심 원칙

```
┌──────────────────────────────────────────────┐
│  기존 localStorage 데이터 절대 삭제 금지      │
│  golab_trade_v2 = SSoT (항상 유지)            │
│  Firebase = one-way push (localStorage → FB)  │
│  마이그레이션 = "복사" (이동 아님)             │
└──────────────────────────────────────────────┘
```

### 4-2. 단계별 실행 계획

```
Phase A: StorageAdapter 도입 (코드 변경)
─────────────────────────────────────────
1. storage-adapter.js 생성 (mode: "local" 기본)
2. trade-engine.js: localStorage → GoLabStorage 교체
3. item-master.js: 동일
4. partner-master.js: 동일
5. channel-master.js: 동일
6. HTML 인라인: golab_actions_v15 접근부 교체
7. 테스트: 기존 기능 100% 정상 동작 확인
   → 이 시점에서 Firebase 없이도 완벽 동작

Phase B: Firebase 연결 (firebase-config.js)
─────────────────────────────────────────
1. firebase-config.js 생성 (API키, Auth)
2. storage-adapter.js에 Firebase push/pull 구현
3. 콘솔에 "동기화 모드" 토글 추가
4. mode: "sync" 전환 시 → 최초 full push 실행

Phase C: 초기 데이터 업로드
─────────────────────────────────────────
1. 콘솔 "동기화" 버튼 클릭
2. 5개 키 순차 push: localStorage → Firestore
3. 각 키별 성공/실패 리포트
4. Firebase Console에서 데이터 확인
```

### 4-3. 초기 push 흐름

```javascript
async function initialPush() {
  const results = [];
  for (const key of FIREBASE_KEYS) {
    try {
      const data = localStorage.getItem(key);
      if (!data) { results.push({ key, status: 'skip', reason: 'empty' }); continue; }
      await firestore.doc(`users/${uid}/${collection}/all`).set({
        data: JSON.parse(data),
        updated_at: serverTimestamp(),
        version: extractVersion(key)
      });
      results.push({ key, status: 'ok', size: data.length });
    } catch (e) {
      results.push({ key, status: 'fail', error: e.message });
    }
  }
  return results; // UI에 리포트 표시
}
```

### 4-4. 안전장치

| 위험 | 대응 |
|------|------|
| push 중 네트워크 끊김 | localStorage 이미 저장됨, pendingQueue에 추가 |
| push 데이터 손상 | JSON.parse 검증 후 push, 실패 시 중단 |
| Firestore 문서 1MB 초과 | push 전 크기 체크, 초과 시 경고 + 중단 |
| Auth 만료 | push 전 auth.currentUser 체크, 없으면 재로그인 유도 |

---

## 5. 롤백 방식

### 5-1. 즉시 롤백 (Firebase 비활성화)

```javascript
// 콘솔에서 토글 1번으로 복귀
GoLabStorage.setMode("local");

// 결과:
// - getItem() → localStorage만 읽음 (변화 없음)
// - setItem() → localStorage만 씀 (Firebase 호출 안 함)
// - 데이터 손실: 0%
// - UI 변경: 없음
// - Firebase 데이터: 그대로 보존 (삭제 안 함)
```

### 5-2. 완전 롤백 (StorageAdapter 제거)

```
최악의 경우: StorageAdapter 자체에 버그가 있을 때
─────────────────────────────────────────
1. storage-adapter.js의 getItem/setItem을
   순수 localStorage 패스스루로 교체

   getItem(key) { return localStorage.getItem(key); }
   setItem(key, value) { localStorage.setItem(key, value); }

2. 또는 각 모듈의 import를 원복
   (git revert 1커밋)

결과:
- v5.3 상태로 완전 복귀
- 데이터 손실: 0% (localStorage가 SSoT이므로)
```

### 5-3. Firebase → localStorage 복구

```
시나리오: 로컬 데이터 유실 (브라우저 초기화 등)
─────────────────────────────────────────
1. 콘솔 "Firebase에서 복원" 버튼
2. pullFromFirebase() → 5개 키 순차 다운로드
3. localStorage에 덮어쓰기
4. 페이지 새로고침

이것은 기존 console.html 백업/복원과 동일한 개념.
Firebase가 "클라우드 백업" 역할.
```

### 5-4. 데이터 무결성 보장 매트릭스

| 시나리오 | localStorage | Firebase | 복구 방법 |
|----------|:---:|:---:|------|
| 정상 운영 (sync 모드) | ✅ | ✅ | — |
| Firebase 다운 | ✅ | ❌ | pendingQueue → 복구 시 재push |
| 브라우저 초기화 | ❌ | ✅ | pullFromFirebase() |
| 둘 다 유실 | ❌ | ❌ | console.html JSON 백업 파일 |
| StorageAdapter 버그 | ✅ | ? | setMode("local") 즉시 복귀 |

---

## 6. 영향 파일 목록

### 6-1. 신규 파일 (2개)

| 파일 | 역할 | 크기 예상 |
|------|------|-----------|
| `web/js/storage-adapter.js` | StorageAdapter 인터페이스 + localStorage 구현 + Firebase push/pull | ~200줄 |
| `web/js/firebase-config.js` | Firebase SDK 초기화 + Auth (Anonymous or Email) | ~50줄 |

### 6-2. 수정 파일 — JS 엔진 (4개)

| 파일 | 변경 내용 | 변경 규모 |
|------|-----------|-----------|
| `web/js/trade-engine.js` | `localStorage.getItem/setItem` → `GoLabStorage.getItem/setItem` (8개소) | 소 |
| `web/js/item-master.js` | 동일 패턴 교체 (6개소, 핵심 키만) | 소 |
| `web/js/partner-master.js` | 동일 패턴 교체 (4개소) | 소 |
| `web/js/channel-master.js` | 동일 패턴 교체 (4개소) | 소 |

**변경 예시 (trade-engine.js):**
```javascript
// Before
const TRADE_KEY = 'golab_trade_v2';
function loadAll() { return JSON.parse(localStorage.getItem(TRADE_KEY) || '[]'); }
function _save(arr) { localStorage.setItem(TRADE_KEY, JSON.stringify(arr)); }

// After
const TRADE_KEY = 'golab_trade_v2';
function loadAll() { return JSON.parse(GoLabStorage.getItem(TRADE_KEY) || '[]'); }
function _save(arr) { GoLabStorage.setItem(TRADE_KEY, JSON.stringify(arr)); }
```

### 6-3. 수정 파일 — HTML (3개)

| 파일 | 변경 내용 | 변경 규모 |
|------|-----------|-----------|
| `web/console.html` | `<script src="js/storage-adapter.js">` 추가 + 인라인 actions 접근부 교체 + 동기화 토글 UI | 소~중 |
| `web/deals.html` | `<script src="js/storage-adapter.js">` 추가 | 극소 |
| `web/profit.html` | `<script src="js/storage-adapter.js">` 추가 | 극소 |

### 6-4. 수정 불필요 파일

| 파일 | 사유 |
|------|------|
| `web/index.html` | inventory_v01 → Firebase 대상 아님 |
| `web/calendar.html` | actions_v15는 대상이지만, console.html과 동일 키 공유. Phase A에서 adapter 적용 |
| `web/trade.html` | trade_v1 (레거시) → 대상 아님 |
| `web/sales.html` | sales_v1 → 대상 아님 |
| `web/item-master.html` | item-master.js를 통해 간접 접근 → JS 수정으로 해결 |
| `web/partner-master.html` | partner-master.js를 통해 간접 접근 → JS 수정으로 해결 |

### 6-5. 레이아웃 변경: 없음

> console.html 레이아웃 수정 금지 (MASTER SPEC 준수)
> UI 변경 금지 (MASTER SPEC 준수)
> 동기화 토글은 기존 백업/복원 영역 내부에 추가 (레이아웃 변경 아님)

---

## 7. trade-engine.js 수정 여부

### 7-1. 보호 함수 — 수정 없음 ✅

| 함수 | 수정 | 사유 |
|------|:---:|------|
| `calcTrade()` | ❌ 없음 | 순수 계산 함수, localStorage 접근 없음 |
| `classifyTrade()` | ❌ 없음 | 순수 분류 함수, localStorage 접근 없음 |
| `calcPaymentStatus()` | ❌ 없음 | 순수 계산 함수, localStorage 접근 없음 |

**근거:** 세 함수 모두 입력 객체를 받아 결과를 반환하는 **순수 함수**다.
`localStorage`를 직접 호출하지 않으므로 StorageAdapter 도입의 영향을 받지 않는다.

### 7-2. 수정 대상 — 9개 호출 전수 목록

#### (1) `loadAll()` — line 273

```javascript
// Before
function loadAll() {
  try { return JSON.parse(localStorage.getItem(TRADE_KEY) || "[]"); }
  catch (e) { return []; }
}

// After
function loadAll() {
  try { return JSON.parse(GoLabStorage.getItem(TRADE_KEY) || "[]"); }
  catch (e) { return []; }
}
```

#### (2) `_save()` — line 278

```javascript
// Before
function _save(arr) {
  localStorage.setItem(TRADE_KEY, JSON.stringify(arr));
}

// After
function _save(arr) {
  GoLabStorage.setItem(TRADE_KEY, JSON.stringify(arr));
}
```

#### (3) `migrateFromV1()` — line 860 ⚠️ 읽기전용, 변경 선택적

```javascript
// Before
try { v1Data = JSON.parse(localStorage.getItem(V1_KEY) || "[]"); }

// After (V1_KEY는 Firebase 대상 아님 → localStorage 직접 유지도 가능)
// 선택지 A: GoLabStorage 통일 (V1은 화이트리스트 밖이므로 어차피 localStorage만 사용)
try { v1Data = JSON.parse(GoLabStorage.getItem(V1_KEY) || "[]"); }
// 선택지 B: localStorage 직접 유지 (레거시 읽기전용이므로)
try { v1Data = JSON.parse(localStorage.getItem(V1_KEY) || "[]"); }
```

> **권장: 선택지 A** — 일관성을 위해 모든 호출을 GoLabStorage로 통일.
> GoLabStorage.getItem()은 화이트리스트 여부와 관계없이 localStorage를 읽으므로 동작 동일.

#### ~~(4)~~ `emitAudit()` — line 1030 (getItem) — **수정 안 함**

```javascript
// 변경 없음 — localStorage 직접 사용 유지
var log = JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]");
```

#### ~~(5)~~ `emitAudit()` — line 1033 (setItem) — **수정 안 함**

```javascript
// 변경 없음 — localStorage 직접 사용 유지
localStorage.setItem(AUDIT_KEY, JSON.stringify(log));
```

> **⚠️ 핵심 원칙: audit은 "기록"이다 — 클라우드로 보내지 않는다.**
>
> AUDIT_KEY는 StorageAdapter를 **아예 타지 않는다** (A안 채택).
> - emitAudit() 내부는 localStorage 직접 호출을 그대로 유지한다.
> - GoLabStorage를 경유하지 않으므로 sync 모드에서도 Firebase 전송 가능성 = 0%.
> - 화이트리스트 분기에 의존하지 않는 **구조적 차단**이다.

#### (6) auto-upgrade IIFE v2→v2.8a — line 1093

```javascript
// Before
localStorage.setItem(GoLabTradeEngine.TRADE_KEY, JSON.stringify(all));

// After
GoLabStorage.setItem(GoLabTradeEngine.TRADE_KEY, JSON.stringify(all));
```

#### (7) auto-upgrade IIFE v3.9 paid_fields — line 1124

```javascript
// Before
localStorage.setItem(TE.TRADE_KEY, JSON.stringify(all));

// After
GoLabStorage.setItem(TE.TRADE_KEY, JSON.stringify(all));
```

#### (8) auto-upgrade IIFE v4.2 segyeong_fields — line 1146

```javascript
// Before
localStorage.setItem(TE.TRADE_KEY, JSON.stringify(all));

// After
GoLabStorage.setItem(TE.TRADE_KEY, JSON.stringify(all));
```

#### (9) auto-upgrade IIFE v5.1 segyeong_tx_type — line 1166

```javascript
// Before
localStorage.setItem(TE.TRADE_KEY, JSON.stringify(all));

// After
GoLabStorage.setItem(TE.TRADE_KEY, JSON.stringify(all));
```

### 7-3. 수정 범위 요약

```
trade-engine.js 전체: 1,171줄
수정 대상: 7줄 (localStorage → GoLabStorage 치환)
수정 제외: 2줄 (emitAudit — localStorage 직접 유지)
수정 비율: 0.6%

변경 유형: "기계적 치환" (localStorage → GoLabStorage)
로직 변경: 0건
계산 변경: 0건
데이터 구조 변경: 0건
```

| 구분 | 함수 | 줄 번호 | 호출 유형 | 키 | 처리 |
|:---:|------|:-------:|-----------|-----|------|
| 1 | `loadAll()` | 273 | getItem | TRADE_KEY | ✅ GoLabStorage로 변경 |
| 2 | `_save()` | 278 | setItem | TRADE_KEY | ✅ GoLabStorage로 변경 |
| 3 | `migrateFromV1()` | 860 | getItem | V1_KEY | ✅ GoLabStorage로 변경 |
| 4 | `emitAudit()` | 1030 | getItem | AUDIT_KEY | ⛔ localStorage 유지 |
| 5 | `emitAudit()` | 1033 | setItem | AUDIT_KEY | ⛔ localStorage 유지 |
| 6 | IIFE v2→v2.8a | 1093 | setItem | TRADE_KEY | ✅ GoLabStorage로 변경 |
| 7 | IIFE v3.9 | 1124 | setItem | TRADE_KEY | ✅ GoLabStorage로 변경 |
| 8 | IIFE v4.2 | 1146 | setItem | TRADE_KEY | ✅ GoLabStorage로 변경 |
| 9 | IIFE v5.1 | 1166 | setItem | TRADE_KEY | ✅ GoLabStorage로 변경 |

**audit 분리 원칙:**
- audit = "기록" → 클라우드 전송 금지
- emitAudit()는 localStorage 직접 호출 유지 (StorageAdapter 미경유)
- 이 방식은 화이트리스트 분기에 의존하지 않는 **구조적 차단**

---

## 부록 A. 전체 localStorage 키 목록 (31개)

### Firebase 대상 (5개) — 핵심 운영 데이터

| # | 키 | 모듈 | 용도 |
|---|-----|------|------|
| 1 | `golab_trade_v2` | trade-engine.js | 거래 SSoT |
| 2 | `golab_item_master_v1` | item-master.js | 품목 마스터 |
| 3 | `golab_partner_master_v1` | partner-master.js | 거래처 마스터 |
| 4 | `golab_actions_v15` | console/calendar (inline) | 액션/할일 |
| 5 | `golab_channel_master_v1` | channel-master.js | 채널 마스터 |

### Firebase 제외 — 감사 로그 (5개)

| # | 키 | 용도 |
|---|-----|------|
| 6 | `golab_trade_v2_audit` | 거래 감사 |
| 7 | `golab_item_master_audit` | 품목 감사 |
| 8 | `golab_partner_master_audit` | 거래처 감사 |
| 9 | `golab_channel_master_audit` | 채널 감사 |
| 10 | `golab_deals_audit` | 레거시 감사 |

### Firebase 제외 — 재고/매출/매입 (7개)

| # | 키 | 용도 |
|---|-----|------|
| 11 | `golab_inventory_v01` | 재고 현황 |
| 12 | `golab_stock_log_v1` | 입출고 로그 |
| 13 | `golab_inventory_inbound_history_v01` | 입고 이력 |
| 14 | `golab_purchases_v2` | 매입 배치 |
| 15 | `golab_sales_v1` | 매출 데이터 |
| 16 | `golab_price_history_v1` | 가격 이력 |
| 17 | `golab_items_meta_v1` | 기회 점수 메타 |

### Firebase 제외 — 레거시/읽기전용 (7개)

| # | 키 | 용도 |
|---|-----|------|
| 18 | `golab_deals_v1` | v1 백업 (**읽기전용**) |
| 19 | `golab_trade_v1` | 레거시 구매 |
| 20 | `golab_calendar_v1` | 레거시 캘린더 |
| 21 | `golab_worklog_v1` | 레거시 업무일지 |
| 22 | `golab_vendors_v1` | 레거시 공급사 |
| 23 | `golab_deal_todos_v1` | 거래별 TODO |
| 24 | `golab_initiatives_v15` | 칸반 이니셔티브 |

### Firebase 제외 — 임포트/백업/기타 (7개)

| # | 키 | 용도 |
|---|-----|------|
| 25 | `golab_trade_import_raw_log` | 구매 임포트 원본 |
| 26 | `golab_trade_imported_ids` | 구매 멱등성 |
| 27 | `golab_sales_import_raw_log` | 매출 임포트 원본 |
| 28 | `golab_sales_imported_ids` | 매출 멱등성 |
| 29 | `golab_partner_master_pre_batch_backup` | 배치 전 백업 |
| 30 | `golab_work_audit` | 업무 감사 (레거시) |
| 31 | `golab_trade_audit` / `golab_sales_audit` | 거래/매출 감사 (레거시) |

---

## 부록 B. 핵심 5키 데이터 구조

### B-1. golab_trade_v2 (거래)

```javascript
[{
  id: "T20260319-001",
  trade_type: "direct"|"channel",
  deal_date: "2026-03-19",
  partner_id: "uuid",
  partner_name_snapshot: "대성금속",
  channel_id: "uuid"|null,
  channel_name_snapshot: "제이유니버스"|null,
  deal_status: "active"|"completed"|"cancelled",
  items: [{ seq, item_id, name, qty, unit_price, supply_amount, cost, memo }],
  extra_costs: [{ type, label, amount, affects_profit, memo }],
  rates: { save_rate, rebate_rate, S_rate, my_rate },
  settlement: { actual_S_amount, memo },
  paid_supply: 0,
  paid_vat: 0,
  is_segyeong_save_deal: false,
  segyeong_save_tx_type: "accrual"|"deduction",
  segyeong_quote_amount: 0,
  segyeong_deduction_amount: 0,
  segyeong_save_amount: 0,
  segyeong_running_balance: 0,
  linked_deal_id: null,
  quote_at: null, order_at: null, delivery_note_at: null, invoice_at: null, payment_at: null,
  memo: "",
  created_at: "2026-03-19T09:00:00.000Z",
  updated_at: "2026-03-19T09:00:00.000Z"
}]
```

### B-2. golab_item_master_v1 (품목)

```javascript
[{
  item_id: "uuid",
  item_name: "STS304 코일",
  category: "원료"|"장비"|"일반상품",
  spec: "1.0t × 1219mm",
  supplier: "supplier_ref",
  aliases: ["STS코일", "304코일"],
  unit: "EA"|"BOX"|"L"|"kg",
  rrp_price: null,
  dealer_price: null,
  target_buy_price: null,
  note: "",
  created_at: "...", updated_at: "..."
}]
```

### B-3. golab_partner_master_v1 (거래처)

```javascript
[{
  partner_id: "uuid",
  name: "대성금속",
  type: "매입처"|"매출처"|"겸용",
  region: "", dept: "", contact_name: "", phone: "", email: "",
  alias: "대성",
  bank_name: "", account_holder: "", account_number: "", billing_email: "",
  active: true,
  created_at: "...", updated_at: "..."
}]
```

### B-4. golab_actions_v15 (액션)

```javascript
[{
  action_id: "uuid",
  deal_id: null,
  title: "대성금속 견적서 발송",
  description: "",
  status: "pending"|"completed"|"cancelled",
  priority: "high"|"normal"|"low",
  due_date: "2026-03-20",
  category: "",
  created_at: "...", completed_at: null
}]
```

### B-5. golab_channel_master_v1 (채널)

```javascript
[{
  channel_id: "uuid",
  code: "A",
  name: "제이유니버스",
  default_rebate_rate: 30,
  active: true,
  created_at: "..."
}]
```

---

## 결론

이 보고서는 **v5 MASTER SPEC**에 정의된 규칙을 기반으로 설계되었다.

핵심 결정 사항:
1. **Firebase = 동기화 계층** (저장소 아님)
2. **localStorage = SSoT** (항상 유지)
3. **on-demand fetch만 사용** (onSnapshot 금지)
4. **핵심 5키만 대상** (나머지 26키 보존)
5. **trade-engine.js 보호 함수 수정 0건**
6. **롤백: 토글 1번으로 즉시 복귀**

> **승인 후 Phase A (StorageAdapter 도입)부터 구현을 시작한다.**
