# CLAUDE.md — GoLab ERP 운영 원칙 + 아키텍처 문서

> 최종 갱신: 2026-02-26
> 상태: v1.6 운영 중
> 관리: 비서실(최실장) + 개발팀(강본부장)

---

## 0. 운영 원칙 (Claude Code 필수 준수)

1. **항상 먼저 작업 계획을 제시하고, 사용자 승인 후 실행한다.**
2. 작은 작업은 저비용 모델, 큰 설계 변경만 고성능 모델을 사용한다.
3. 실패 원인은 기록하고 재발 방지 규칙을 생성한다.
4. 기능 완성 후 UI를 개선한다.
5. **자율 실행은 반드시 사용자 승인 후 진행한다.**
6. 세션이 끊겨도 이전 작업 맥락을 기억한다.
7. 코드에는 한글 주석을 단다.
8. 기존 구조를 임의로 대규모 변경하지 않는다.

### 작업 흐름 (필수)
```
Plan → (승인) → Execute → Verify → Log(실패/학습) → Polish(UI)
```

### 금지 사항
- localStorage 키를 임의 변경/삭제 금지
- 기존 데이터 모델 필드를 무단 제거 금지
- 사용자 승인 없는 대규모 리팩토링 금지
- 외부 CDN/라이브러리 추가 금지 (순수 JS 유지)

---

## 1. 프로젝트 정의

**1인 사업자(무역/도소매/온라인판매)** 전용 영업관리+재고+정산 웹 콘솔.

- 재고(실물), 매입(돈/원가), 판매/납품(매출), 정산/증빙(세금계산서·입금·VAT)을 한 화면 흐름으로 관리
- "엑셀 탈출" — 입력은 엑셀처럼, 판단/조회는 대시보드형 UI
- 데이터 많아져도 느려지지 않는 요약 리스트 + 상세 패널 구조

---

## 2. 기술 스택

| 레이어 | 선택 | 비고 |
|--------|------|------|
| 프론트엔드 | HTML + CSS + Vanilla JS | 순수 JS, 프레임워크 없음 |
| 데이터 | localStorage (JSON) | 단일 파일 SPA, 키별 분리 |
| 호스팅 | 로컬 파일 시스템 | D:\GOLAB\golab\web\ |
| VCS | Git + GitHub | zombiecola1124/golab |
| 봇 | Python (Telegram) | bot/ 디렉토리 |
| 스크립트 | Python (Excel→JSON) | scripts/ 디렉토리 |
| (미래) DB | Firebase Firestore | db.js 추상화로 교체 예정 |

### 현재 페이지 구조 (v1.6)
| 페이지 | 파일 | 설명 |
|--------|------|------|
| 콘솔 | console.html | 오늘 실행 센터 (Action CRUD, 주간/월간, 타임라인, KPI) |
| 캘린더 | calendar.html | 월간 캘린더 + Initiative 칸반보드 |
| 입고/원가 | purchases.html | 배치 원가 계산 (환율/물류비) |
| 재고 | index.html | 재고 현황 |
| 구매 이력 | trade.html | 구매 원장 (CRUD, 감사로그, KPI) |
| 매출 | sales.html | 매출 관리 (CRUD, 감사로그, KPI) |

### localStorage 키 맵 (v1.6)
| 키 | 용도 | 사용처 |
|----|------|--------|
| golab_actions_v15 | Action (Single Source of Truth) | console, calendar |
| golab_initiatives_v15 | Initiative 칸반 | calendar |
| golab_trade_v1 | 구매 원장 | trade, console, calendar |
| golab_sales_v1 | 매출 데이터 | sales, console, calendar |
| golab_trade_audit | 구매 감사로그 | trade, console, calendar |
| golab_sales_audit | 매출 감사로그 | sales, console, calendar |
| golab_work_audit | 업무 감사로그 | console, calendar |
| golab_calendar_v1 | 캘린더 일정 (레거시) | calendar |
| golab_worklog_v1 | 업무일지 (레거시→마이그레이션) | console |
| inventoryItems | 재고 | index |

### 디자인 시스템 (v1.6 — 화이트 테마)
- 배경: #f5f7fa / 카드: #ffffff / 보더: #e5e7eb
- Primary: #2563eb / Warn: #dc2626 / Accent: #16a34a / Orange: #d97706
- 텍스트: #0f172a (본문), #64748b (muted)
- 카드: border-radius 10px, box-shadow 0 1px 3px rgba(0,0,0,.04)

---

## 3. 절대 원칙 (흔들리면 안 되는 기준)

1. **품목명 오타 = 최악** → item_id 선택 강제, 자유 텍스트 입력 금지
2. **재고(실물) vs 매입(돈) 섞임 = 최악** → 컬렉션 분리 유지
3. **글씨 작아지는 UI = 최악** → 카드/태그/굵은 숫자, 모달 남발 금지
4. **변경 추적 없음 = 최악** → 모든 CUD는 audit_log 기록 필수

---

## 4. 화면 레이아웃 (공통)

```
┌─────────────────────────────────────────────┐
│  [재고 현황]  [입고/원가]  (정산) (거래처)    │ ← 상단 탭
├──────────────────┬──────────────────────────┤
│                  │                          │
│   좌: 리스트     │   우: 상세 카드/입력      │
│   (스캔 최적화)  │   (굵은 숫자, 상태태그)   │
│                  │                          │
└──────────────────┴──────────────────────────┘
```

- 모바일(1024px↓): 좌/우 → 상/하 스택
- 모달/팝업 남발 금지 — 우측 패널에서 해결

---

## 5. 데이터 모델 (Firestore 컬렉션)

### 5-1. items (품목 마스터 + 재고 요약)

```
{
  item_id: string (문서ID),
  name: string,           // 품목명
  sku: string,            // 내부코드/파트넘버 (옵션)
  unit: string,           // 기본단위 (EA/BOX/L/kg 등)
  qty_on_hand: number,    // 현재수량
  qty_min: number,        // 최소수량
  status: string,         // NORMAL | RISK | RESERVED | OUT
  last_delivery_to: string,
  last_delivery_at: timestamp,
  avg_cost: number,       // 평균원가 (이동평균법, 공급가 기준)
  asset_value: number,    // = qty_on_hand * avg_cost
  created_at: timestamp,
  updated_at: timestamp
}
```

### 5-2. purchases (매입/입고 이력)

```
{
  purchase_id: string (문서ID),
  item_id: string,        // items 참조 (강제)
  item_name: string,      // 비정규화 (리스트 표시용)
  vendor_id: string,      // 공급사
  vendor_name: string,    // 비정규화
  qty: number,
  unit_cost: number,      // 단가 (원화 환산)
  currency: string,       // KRW/USD/JPY (참고용)
  fx_rate: number,        // 환율 (참고용, v1은 수동입력)
  processing_fee: number, // 가공비
  shipping_fee: number,   // 운임
  other_fee: number,      // 기타
  total_cost: number,     // 공급가 합계 = (unit_cost * qty) + 가공비 + 운임 + 기타
  purchased_at: timestamp,
  note: string,
  push_to_inventory: boolean, // 저장 시 재고 반영 여부
  created_at: timestamp
}
```

### 5-3. deliveries (납품/출고)

```
{
  delivery_id: string (문서ID),
  item_id: string,
  item_name: string,      // 비정규화
  customer_id: string,
  customer_name: string,  // 비정규화
  qty: number,
  unit_price: number,     // 판매단가 (옵션)
  delivered_at: timestamp,
  note: string,
  created_at: timestamp
}
```

### 5-4. vendors (공급사 마스터)

```
{
  vendor_id: string (문서ID),
  name: string,
  contact: string,
  memo: string,
  created_at: timestamp
}
```

### 5-5. customers (거래처 마스터)

```
{
  customer_id: string (문서ID),
  name: string,
  contact: string,
  memo: string,
  created_at: timestamp
}
```

### 5-6. invoices (세금계산서/정산) — v2 본격화, v1은 구조만

```
{
  invoice_id: string (문서ID),
  customer_id: string,
  customer_name: string,
  issued_at: timestamp,
  supply_amount: number,      // 공급가 (VAT 제외가 기본)
  vat_amount: number,         // VAT
  total_amount: number,       // 합계
  paid_supply_amount: number, // 입금된 공급가
  paid_vat_amount: number,    // 입금된 VAT
  status: string,             // PAID | PARTIAL | VAT_UNPAID | UNPAID
  memo: string,
  linked_deliveries: array,   // delivery_id 배열
  created_at: timestamp
}
```

### 5-7. audit_log (변경 이력) — v1 필수

```
{
  log_id: string (문서ID),
  entity_type: string,    // "item" | "purchase" | "delivery" | "invoice"
  entity_id: string,
  action: string,         // CREATE | UPDATE | DELETE | STOCK_ADJUST | STOCKTAKE
  before: object,         // 변경 전 스냅샷
  after: object,          // 변경 후 스냅샷
  reason: string,         // 사유 (빈값 허용, 추후 필수화 가능)
  actor: string,          // v1은 "owner" 고정
  created_at: timestamp
}
```

### 5-8. stocktakes (재고 실사) — v1.5 기능, v1에 구조만 준비

```
{
  stocktake_id: string (문서ID),
  status: string,         // DRAFT | POSTED
  note: string,
  created_at: timestamp,
  posted_at: timestamp,
  lines: [
    {
      item_id: string,
      item_name: string,
      system_qty: number,
      counted_qty: number,
      delta: number,      // = counted - system
      reason: string
    }
  ]
}
```

---

## 6. 화면 스펙

### 6-1. index.html — 재고 현황 (메인)

**상단 KPI 카드 3개:**
| 카드 | 값 | 색상 기준 |
|------|-----|-----------|
| 총 재고가치 | Σ(qty_on_hand × avg_cost) | 파랑 |
| 미수금 합계 | Σ(미입금 공급가 + 미입금 VAT) | 빨강(미수>0) / 초록(0) |
| 위험 품목 수 | status=RISK 또는 qty < qty_min | 빨강(>0) / 초록(0) |

**리스트 상단:**
- 검색바: 품목명/SKU 부분 검색
- 상태 필터: ALL / NORMAL / RISK / RESERVED / OUT
- 부족만 보기 토글: qty_on_hand < qty_min

**좌측 리스트 컬럼 (스캔 우선순위):**
1. 상태 태그 (색상배지)
2. 품목명
3. 현재수량
4. 최종납품처
5. 최종납품일
6. 평균원가

**우측 상세 카드:**
- 품목명 / SKU
- 상태태그 (변경 가능)
- 현재수량 (굵게) + 최소수량 + 부족분
- 재고가치 (굵게)
- 최근 입고 이력 (최근 5건)
- 최근 납품 이력 (최근 5건)
- 액션: 상태변경 / 최소수량 수정 / 빠른출고 등록

### 6-2. purchases.html — 입고/원가

**좌측 리스트:**
- 날짜, 품목명, 수량, 총원가(공급가), 공급사

**우측 입력/상세:**
- 품목 선택: 자동완성/드롭다운 (item_id 기반, 자유입력 불가)
- 공급사 선택: 자동완성/드롭다운
- 수량 / 단가(원화) / 통화(참고) / 환율(참고)
- 가공비 / 운임 / 기타
- 총원가(공급가) 자동 계산
- 체크박스: "저장 시 재고로 전송"
- 메모
- 저장 버튼

**저장 로직 (핵심):**
1. purchases 컬렉션에 문서 생성
2. audit_log에 action="CREATE" 기록
3. push_to_inventory=true 이면:
   - items.qty_on_hand += qty
   - items.avg_cost = (기존수량×기존단가 + 신규수량×신규단가) ÷ 총수량 (이동평균법)
   - items.asset_value = qty_on_hand × avg_cost
   - items.status 재평가 (qty_min 대비)
   - audit_log에 action="STOCK_ADJUST" 기록

---

## 7. 파일 구조

```
golab/
├── index.html              # 재고 현황 (메인)
├── purchases.html          # 입고/원가
├── css/
│   └── app.css             # 공통 스타일 + 반응형
├── js/
│   ├── app.js              # 앱 초기화, 라우팅, 공통 유틸
│   ├── db.js               # Firestore 추상화 레이어 (CRUD 래퍼)
│   ├── audit.js            # audit_log 기록 모듈
│   ├── inventory.js        # 재고 화면 로직
│   ├── purchases.js        # 입고/원가 화면 로직
│   └── ui.js               # 공통 UI 컴포넌트 (태그, 카드, 모달 등)
├── scripts/                # 기존 Python 백엔드 (유지)
├── docs/                   # 기존 운영 문서 (유지)
├── HQ/                     # 기존 WAR_ROOM (유지)
├── MEMO/                   # 기존 메모 (유지)
└── ... (기존 폴더 유지)
```

---

## 8. 구현 규칙

1. **audit 필수**: 모든 UPDATE/DELETE는 audit.writeLog() 호출. try/finally 구조로 누락 방지.
2. **reason 훅**: UI/함수 레벨에 사유 입력 가능하게 (빈값 허용, 추후 필수화 가능).
3. **KPI 클라이언트 계산**: v1은 로드 시 클라이언트에서 계산. 데이터 커지면 stats 문서로 확장.
4. **검색/필터 클라이언트**: v1은 전체 로드 후 클라이언트 필터. 품목 500개 넘으면 Firestore 쿼리로 전환.
5. **이동평균법**: avg_cost = (기존수량×기존단가 + 신규수량×신규단가) ÷ 총수량.
6. **금액 기본 = VAT 제외(공급가)**: VAT는 별도 표기.
7. **통화**: v1은 원화 수동 환산, currency/fx_rate는 참고용 저장만.
8. **db.js 추상화**: Firestore 직접 호출 금지. 반드시 db.js 래퍼 통해 접근 → 추후 DB 교체 용이.

---

## 9. 작업 티켓 (체크리스트)

### Phase 1 (v1) — 바로 쓰는 단계

- [ ] **T0. 웹 프론트 부트스트랩**
  - index.html, purchases.html 생성
  - css/app.css (공통 + 반응형)
  - js/app.js, db.js, audit.js, ui.js, inventory.js, purchases.js
  - 상단 탭 네비게이션 통일

- [ ] **T1. DB 레이어 + audit 기반**
  - db.js: Firestore init + 컬렉션 CRUD 래퍼
  - audit.js: writeLog() 함수
  - 모든 CUD 함수에 audit 호출 내장

- [ ] **T2. 재고 화면(index.html)**
  - 상단 KPI 카드 3개 (재고가치/미수금/위험품목)
  - 검색바 + 상태필터 + 부족토글
  - 좌 리스트 렌더링 (요약 6필드)
  - 우 상세 카드 (수량/원가/이력/액션)
  - 상태변경/최소수량 수정 시 audit 기록

- [ ] **T3. 입고/원가(purchases.html)**
  - 품목 자동완성 (item_id 강제)
  - 공급사 자동완성
  - 원가 자동계산
  - 저장 + push_to_inventory 로직 (이동평균법)
  - audit_log 기록

- [ ] **T4. 모바일 반응형**
  - 1024px 이하: 2컬럼 → 상하 스택
  - 카드 숫자/태그 크기 유지
  - 입력폼 1열, 버튼 하단 고정

### Phase 1.5

- [ ] **T5. 거래처 마스터** (vendors/customers CRUD)
- [ ] **T6. 출고/납품** (deliveries 간단 입력)
- [ ] **T7. 재고 실사** (stocktake 화면, DRAFT→POST, audit 기록)
- [ ] **T8. 백업/내보내기** (CSV/JSON export)

### Phase 2

- [ ] **T9. 정산/증빙** (invoices 본격화, 세금계산서/입금/VAT미수)
- [ ] **T10. 거래명세서/견적서 출력** (템플릿)
- [ ] **T11. 리포트/분석** (월별 매입/매출, 마진 분석)

---

## 10. v1 수용 기준 (합격 조건)

1. ✅ 재고 수량/상태/최소수량을 바꾸면 audit_log에 무조건 남는다
2. ✅ index 첫 화면에서 총 재고가치/미수금/위험 품목 수가 즉시 보인다
3. ✅ 품목 100개 이상이어도 검색/필터로 3초 안에 찾는다
4. ✅ 폰에서 열면 리스트→상세가 위아래로 자연스럽게 보인다
5. ✅ 매입 저장 시 "재고로 전송" 체크하면 수량+평균원가가 자동 갱신된다
6. ✅ 품목 선택은 자동완성만 허용, 자유 텍스트 직접입력 불가

---

## 11. 일본 전시회·리서치 DB 관계

- **별도 프로젝트**로 유지
- 사업 콘솔에는 vendor_id 또는 external_link만 저장
- "공급사 상세" 클릭 시 외부 링크로 넘어가는 수준
