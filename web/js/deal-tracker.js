/**
 * GoLab v2.4 — Deal Tracker (거래 원장 SSoT)
 *
 * deals_v1 = GoLab의 유일한 거래 원장 (Single Source of Truth)
 * 모든 View(Sales, Profit, Console, Calendar)는 deals_v1을 읽어 계산한다.
 *
 * 거래 흐름: 견적 → 발주 → 거래명세서 → 계산서 → 입금
 * UX 원칙: 액션 버튼 클릭 → 자동 타임스탬프 (수동 날짜 입력 아님)
 *
 * 사용법: <script src="js/deal-tracker.js"></script>
 *         GoLabDealTracker.loadAll()
 *         GoLabDealTracker.create(fields)
 *         GoLabDealTracker.stampStep(dealId, stepKey)
 *
 * localStorage 키:
 *   golab_deals_v1    — 거래 배열
 *   golab_deals_audit — 감사 로그
 */
window.GoLabDealTracker = (function () {
  "use strict";

  var DEALS_KEY = "golab_deals_v1";
  var AUDIT_KEY = "golab_deals_audit";

  /* ══════════════════════════════════════
     거래 흐름 5단계 정의
     ══════════════════════════════════════ */

  /* 단계 순서 배열 — UI 진행 바 렌더링에 사용 */
  var STEPS = [
    { key: "quote",         field: "quote_at",         label: "견적",   icon: "📋" },
    { key: "order",         field: "order_at",         label: "발주",   icon: "📦" },
    { key: "delivery_note", field: "delivery_note_at", label: "명세서", icon: "📄" },
    { key: "invoice",       field: "invoice_at",       label: "계산서", icon: "🧾" },
    { key: "payment",       field: "payment_at",       label: "입금",   icon: "💰" }
  ];

  /* 단계 key → 정보 빠른 조회 */
  var STEP_MAP = {};
  STEPS.forEach(function(s, i) { STEP_MAP[s.key] = Object.assign({ index: i }, s); });

  /* ── 진행 상태 상수 (날짜 기반 자동 계산) ── */
  var STATUS = {
    NEW:      "신규",
    QUOTE:    "견적",
    ORDER:    "발주",
    DN:       "명세서",
    INVOICE:  "계산서",
    COMPLETE: "완료"
  };

  /* ── 거래 상태 상수 (deal_status) ── */
  var DEAL_STATUS = {
    ACTIVE:    "active",
    COMPLETED: "completed",
    CANCELLED: "cancelled"
  };

  /* ── 거래 소유자 상수 ── */
  var DEAL_OWNER = {
    MINE:   "mine",
    FRIEND: "friend"
  };

  /* ══════════════════════════════════════
     유틸리티
     ══════════════════════════════════════ */

  /** 숫자 안전 변환 */
  function n(v, fb) {
    if (fb === undefined) fb = 0;
    var x = Number(v);
    return Number.isFinite(x) ? x : fb;
  }

  /** 통화 포맷 ₩1,234,567 */
  function fmt(v) {
    return "\u20a9" + Math.round(n(v)).toLocaleString();
  }

  /** 오늘 날짜 YYYY-MM-DD */
  function _today() {
    return new Date().toISOString().substring(0, 10);
  }

  /* ══════════════════════════════════════
     상태 자동 계산 — 날짜 기반 (역순 우선)
     ══════════════════════════════════════ */

  function _calcStatus(d) {
    if (d.payment_at)       return STATUS.COMPLETE;
    if (d.invoice_at)       return STATUS.INVOICE;
    if (d.delivery_note_at) return STATUS.DN;
    if (d.order_at)         return STATUS.ORDER;
    if (d.quote_at)         return STATUS.QUOTE;
    return STATUS.NEW;
  }

  /** deal_status 자동 계산 — cancelled는 수동 설정만 가능 */
  function _calcDealStatus(d) {
    if (d.deal_status === DEAL_STATUS.CANCELLED) return DEAL_STATUS.CANCELLED;
    if (d.payment_at) return DEAL_STATUS.COMPLETED;
    return DEAL_STATUS.ACTIVE;
  }

  /** 현재 진행 단계 인덱스 (0~5, 5=전체 완료) */
  function _currentStepIndex(d) {
    for (var i = STEPS.length - 1; i >= 0; i--) {
      if (d[STEPS[i].field]) return i + 1;
    }
    return 0;
  }

  /* ══════════════════════════════════════
     금액 계산
     ══════════════════════════════════════ */

  function _calcAmounts(d) {
    /* 공급가: manual_amount 아니면 qty × unit_price */
    if (!d.manual_amount) {
      d.supply_amount = Math.round(n(d.qty) * n(d.unit_price));
    }
    /* VAT: 공급가 10% */
    d.vat_amount = Math.round(n(d.supply_amount) * 0.1);
    /* 합계 */
    d.total_amount = n(d.supply_amount) + n(d.vat_amount);
    /* fee 기본값 */
    if (d.fee == null) d.fee = 0;
    /* 마진: amount - cost - fee */
    if (d.purchase_cost != null && d.purchase_cost !== "") {
      d.margin_amount = n(d.supply_amount) - n(d.purchase_cost) - n(d.fee);
    } else {
      d.margin_amount = null;
    }
    /* 편의 별칭 (amount = supply_amount, cost = purchase_cost) */
    d.amount = n(d.supply_amount);
    d.cost = (d.purchase_cost != null && d.purchase_cost !== "") ? n(d.purchase_cost) : 0;
    return d;
  }

  /* ══════════════════════════════════════
     CRUD
     ══════════════════════════════════════ */

  function loadAll() {
    try { return JSON.parse(localStorage.getItem(DEALS_KEY) || "[]"); }
    catch(e) { return []; }
  }

  function _save(arr) {
    localStorage.setItem(DEALS_KEY, JSON.stringify(arr));
  }

  function getById(dealId) {
    if (!dealId) return null;
    return loadAll().find(function(x) { return x.deal_id === dealId; }) || null;
  }

  /** 거래 생성 — 최소: partner_id, item_name, qty, unit_price */
  function create(fields) {
    var deal = {
      deal_id:              fields.deal_id || crypto.randomUUID(),
      partner_id:           fields.partner_id || null,
      partner_name_snapshot: (fields.partner_name_snapshot || "").trim(),
      item_id:              fields.item_id || null,
      item_name:            (fields.item_name || "").trim(),
      qty:                  n(fields.qty),
      unit_price:           n(fields.unit_price),
      supply_amount:        n(fields.supply_amount),
      vat_amount:           0,
      total_amount:         0,
      manual_amount:        !!fields.manual_amount,
      purchase_cost:        (fields.purchase_cost != null && fields.purchase_cost !== "") ? n(fields.purchase_cost) : null,
      margin_amount:        null,
      /* v2.4 SSoT 필드 */
      deal_owner:           fields.deal_owner || DEAL_OWNER.MINE,
      deal_status:          fields.deal_status || DEAL_STATUS.ACTIVE,
      fee:                  n(fields.fee),
      source:               fields.source || "manual",
      migrated_from:        fields.migrated_from || null,
      /* 거래 흐름 5단계 타임스탬프 */
      quote_at:             fields.quote_at || null,
      order_at:             fields.order_at || null,
      delivery_note_at:     fields.delivery_note_at || null,
      invoice_at:           fields.invoice_at || null,
      payment_at:           fields.payment_at || null,
      /* 타임라인 로그 */
      timeline:             fields.timeline || [],
      status:               STATUS.NEW,
      memo:                 (fields.memo || "").trim(),
      created_at:           fields.created_at || new Date().toISOString(),
      updated_at:           new Date().toISOString()
    };
    if (!deal.partner_id) throw new Error("거래처를 선택해주세요.");
    if (!deal.item_name)  throw new Error("품목명을 입력해주세요.");

    _calcAmounts(deal);
    deal.status = _calcStatus(deal);
    deal.deal_status = _calcDealStatus(deal);
    /* 생성 타임라인 */
    deal.timeline.push({ step: "create", at: deal.created_at, label: "거래 생성" });

    var all = loadAll();
    all.unshift(deal);
    _save(all);
    emitAudit("CREATE", { deal_id: deal.deal_id, partner: deal.partner_name_snapshot, item: deal.item_name });
    return deal;
  }

  /** 거래 수정 */
  function update(dealId, fields) {
    var all = loadAll();
    var idx = all.findIndex(function(x) { return x.deal_id === dealId; });
    if (idx < 0) throw new Error("거래를 찾을 수 없습니다: " + dealId);
    var d = all[idx];

    /* 기본 필드 */
    if (fields.partner_id           !== undefined) d.partner_id           = fields.partner_id;
    if (fields.partner_name_snapshot !== undefined) d.partner_name_snapshot = fields.partner_name_snapshot.trim();
    if (fields.item_id              !== undefined) d.item_id              = fields.item_id;
    if (fields.item_name            !== undefined) d.item_name            = fields.item_name.trim();
    if (fields.qty                  !== undefined) d.qty                  = n(fields.qty);
    if (fields.unit_price           !== undefined) d.unit_price           = n(fields.unit_price);
    if (fields.memo                 !== undefined) d.memo                 = fields.memo.trim();

    /* 공급가 수동 여부 */
    if (fields.manual_amount !== undefined) d.manual_amount = !!fields.manual_amount;
    if (fields.supply_amount !== undefined && fields.manual_amount) {
      d.supply_amount = n(fields.supply_amount);
    }

    /* 원가 */
    if (fields.purchase_cost !== undefined) {
      d.purchase_cost = (fields.purchase_cost != null && fields.purchase_cost !== "") ? n(fields.purchase_cost) : null;
    }

    /* v2.4 SSoT 필드 */
    if (fields.deal_owner   !== undefined) d.deal_owner = fields.deal_owner;
    if (fields.deal_status  !== undefined) d.deal_status = fields.deal_status;
    if (fields.fee          !== undefined) d.fee = n(fields.fee);

    /* 날짜 필드 (null 허용 = 삭제 가능) */
    if (fields.quote_at         !== undefined) d.quote_at         = fields.quote_at || null;
    if (fields.order_at         !== undefined) d.order_at         = fields.order_at || null;
    if (fields.delivery_note_at !== undefined) d.delivery_note_at = fields.delivery_note_at || null;
    if (fields.invoice_at       !== undefined) d.invoice_at       = fields.invoice_at || null;
    if (fields.payment_at       !== undefined) d.payment_at       = fields.payment_at || null;

    /* 금액 + 상태 재계산 */
    _calcAmounts(d);
    d.status = _calcStatus(d);
    d.deal_status = _calcDealStatus(d);
    d.updated_at = new Date().toISOString();

    _save(all);
    emitAudit("UPDATE", { deal_id: dealId, changed: Object.keys(fields) });
    return d;
  }

  /** 거래 삭제 */
  function remove(dealId) {
    var all = loadAll();
    var idx = all.findIndex(function(x) { return x.deal_id === dealId; });
    if (idx < 0) return;
    var removed = all.splice(idx, 1)[0];
    _save(all);
    emitAudit("DELETE", { deal_id: dealId, partner: removed.partner_name_snapshot, item: removed.item_name });
  }

  /* ══════════════════════════════════════
     단계 스탬프 — 버튼 클릭 → 자동 타임스탬프
     ══════════════════════════════════════ */

  /**
   * 단계 버튼 핸들러 — 클릭 시 오늘 날짜 자동 입력 + 타임라인 로그
   * @param {string} dealId
   * @param {string} stepKey - "quote"|"order"|"delivery_note"|"invoice"|"payment"
   * @returns {object|null} 업데이트된 deal 또는 null (취소)
   */
  function stampStep(dealId, stepKey) {
    var step = STEP_MAP[stepKey];
    if (!step) return null;
    var label = step.icon + " " + step.label;
    if (!confirm('"' + step.label + '" 처리하시겠습니까?\n오늘 날짜(' + _today() + ')가 자동 입력됩니다.')) return null;

    var all = loadAll();
    var idx = all.findIndex(function(x) { return x.deal_id === dealId; });
    if (idx < 0) return null;
    var d = all[idx];

    /* 날짜 스탬프 */
    d[step.field] = _today();

    /* 타임라인 로그 추가 */
    if (!d.timeline) d.timeline = [];
    d.timeline.push({
      step: stepKey,
      at: new Date().toISOString(),
      label: step.label + " 완료"
    });

    /* 상태 + 금액 재계산 */
    _calcAmounts(d);
    d.status = _calcStatus(d);
    d.deal_status = _calcDealStatus(d);
    d.updated_at = new Date().toISOString();

    _save(all);
    emitAudit("STAMP_STEP", { deal_id: dealId, step: stepKey, date: d[step.field] });
    return d;
  }

  /**
   * 단계 스탬프 취소 — 날짜 제거 + 타임라인 로그
   * @param {string} dealId
   * @param {string} stepKey
   * @returns {object|null}
   */
  function unstampStep(dealId, stepKey) {
    var step = STEP_MAP[stepKey];
    if (!step) return null;
    if (!confirm('"' + step.label + '" 처리를 취소하시겠습니까?')) return null;

    var all = loadAll();
    var idx = all.findIndex(function(x) { return x.deal_id === dealId; });
    if (idx < 0) return null;
    var d = all[idx];

    d[step.field] = null;

    if (!d.timeline) d.timeline = [];
    d.timeline.push({
      step: stepKey,
      at: new Date().toISOString(),
      label: step.label + " 취소"
    });

    _calcAmounts(d);
    d.status = _calcStatus(d);
    d.deal_status = _calcDealStatus(d);
    d.updated_at = new Date().toISOString();

    _save(all);
    emitAudit("UNSTAMP_STEP", { deal_id: dealId, step: stepKey });
    return d;
  }

  /* ══════════════════════════════════════
     KPI 집계 — console 대시보드용
     ══════════════════════════════════════ */

  function getKPISummary() {
    var all = loadAll();
    var active = 0;            /* 진행 중 */
    var complete = 0;          /* 완료 */
    var cancelled = 0;         /* 취소 */
    var noInvoice = 0;         /* 계산서 미발행 */
    var noPayment = 0;         /* 입금 대기 */
    var paymentDueAmt = 0;     /* 입금 대기 금액 */
    /* 소유자별 집계 */
    var mineCount = 0, friendCount = 0;
    var totalAmount = 0, mineTotalAmount = 0, friendTotalAmount = 0;
    var receivableAmount = 0;  /* 미수금 (계산서 O + 입금 X) */

    all.forEach(function(d) {
      /* 취소 건 별도 집계 */
      if (d.deal_status === DEAL_STATUS.CANCELLED) {
        cancelled++;
        return;
      }
      /* 소유자별 */
      var amt = n(d.supply_amount);
      totalAmount += amt;
      if (d.deal_owner === DEAL_OWNER.FRIEND) {
        friendCount++;
        friendTotalAmount += amt;
      } else {
        mineCount++;
        mineTotalAmount += amt;
      }
      /* 진행/완료 */
      if (d.status === STATUS.COMPLETE) {
        complete++;
      } else {
        active++;
        if (d.order_at && !d.invoice_at) noInvoice++;
        if (d.invoice_at && !d.payment_at) {
          noPayment++;
          paymentDueAmt += n(d.total_amount);
          receivableAmount += amt;
        }
      }
    });

    return {
      total: all.length,
      active: active,
      complete: complete,
      cancelled: cancelled,
      mineCount: mineCount,
      friendCount: friendCount,
      totalAmount: totalAmount,
      mineTotalAmount: mineTotalAmount,
      friendTotalAmount: friendTotalAmount,
      receivableAmount: receivableAmount,
      noInvoice: noInvoice,
      noPayment: noPayment,
      paymentDueAmt: paymentDueAmt
    };
  }

  /* ══════════════════════════════════════
     성적표 집계 — 기간별 KPI (Profit 화면 전용)
     ══════════════════════════════════════ */

  /**
   * getScorecard(fromDate, toDate)
   * 기간 내 거래 집계 — Profit 성적표 KPI용
   * @param {string} fromDate - "YYYY-MM-DD" 시작일
   * @param {string} toDate   - "YYYY-MM-DD" 종료일
   * @returns {Object} 성적표 집계 결과
   */
  function getScorecard(fromDate, toDate) {
    var all = loadAll();
    var totalRevenue = 0;      /* 총 매출 */
    var paidRevenue = 0;       /* 실제 입금액 */
    var myNetProfit = 0;       /* 내 순수익 */
    var mineRevenue = 0;       /* 내 거래 매출 */
    var mineCost = 0;          /* 내 거래 원가 */
    var mineFee = 0;           /* 내 거래 수수료 */
    var friendRevenue = 0;     /* 기타(지인) 거래 매출 */
    var receivableAmount = 0;  /* 미입금 잔액 */
    var dealCount = 0;         /* 기간 내 건수 */
    var paidCount = 0;         /* 입금 건수 */
    var receivableCount = 0;   /* 미입금 건수 */
    var deals = [];            /* 기간 내 거래 배열 */

    all.forEach(function(d) {
      /* 취소 건 제외 */
      if (d.deal_status === DEAL_STATUS.CANCELLED) return;

      /* 날짜 필터 — quote_at 기준 */
      var dt = (d.quote_at || d.created_at || "").substring(0, 10);
      if (!dt) return;
      if (dt < fromDate || dt > toDate) return;

      var amt = n(d.supply_amount);
      var cost = n(d.purchase_cost);
      var fee = n(d.fee);

      totalRevenue += amt;
      dealCount++;
      deals.push(d);

      /* 입금 여부 */
      if (d.payment_at) {
        paidRevenue += amt;
        paidCount++;
      }

      /* 미입금 (계산서 발행 + 입금 X) */
      if (d.invoice_at && !d.payment_at) {
        receivableAmount += amt;
        receivableCount++;
      }

      /* 소유자별 분리 */
      if (d.deal_owner === DEAL_OWNER.FRIEND) {
        friendRevenue += amt;
      } else {
        mineRevenue += amt;
        mineCost += cost;
        mineFee += fee;
        myNetProfit += (amt - cost - fee);
      }
    });

    return {
      totalRevenue: totalRevenue,
      paidRevenue: paidRevenue,
      myNetProfit: myNetProfit,
      mineRevenue: mineRevenue,
      mineCost: mineCost,
      mineFee: mineFee,
      friendRevenue: friendRevenue,
      receivableAmount: receivableAmount,
      dealCount: dealCount,
      paidCount: paidCount,
      receivableCount: receivableCount,
      deals: deals
    };
  }

  /**
   * getComparison(curFrom, curTo, prevFrom, prevTo)
   * 현재 기간 vs 이전 기간 비교 — 전월 대비 ▲/▼ 계산용
   */
  function getComparison(curFrom, curTo, prevFrom, prevTo) {
    return {
      current: getScorecard(curFrom, curTo),
      previous: getScorecard(prevFrom, prevTo)
    };
  }

  /* ══════════════════════════════════════
     마이그레이션 — 구 필드명 → 신 필드명 (멱등)
     ══════════════════════════════════════ */

  /**
   * 멱등 마이그레이션 — 기존 데이터 호환
   * v2: quote_date→quote_at 등 필드명 변경
   * v3: deal_owner, deal_status, fee, source 기본값 추가 (SSoT 전환)
   */
  function migrate() {
    var all = loadAll();
    var count = 0;
    all.forEach(function(d) {
      var changed = false;

      /* ── v2 마이그레이션: 구 필드명 → 신 필드명 ── */
      if (d.quote_date && !d.quote_at) { d.quote_at = d.quote_date; changed = true; }
      if (d.po_date && !d.order_at) { d.order_at = d.po_date; changed = true; }
      if (d.invoice_date && !d.invoice_at) { d.invoice_at = d.invoice_date; changed = true; }
      if ((d.deposit_supply_date || d.deposit_vat_date) && !d.payment_at) {
        d.payment_at = d.deposit_supply_date || d.deposit_vat_date;
        changed = true;
      }
      if (d.delivery_note_at === undefined) { d.delivery_note_at = null; changed = true; }
      if (!d.timeline) { d.timeline = []; changed = true; }

      /* ── v3 마이그레이션: SSoT 신규 필드 기본값 ── */
      if (d.deal_owner === undefined) {
        d.deal_owner = DEAL_OWNER.MINE;
        changed = true;
      }
      if (d.deal_status === undefined) {
        d.deal_status = d.payment_at ? DEAL_STATUS.COMPLETED : DEAL_STATUS.ACTIVE;
        changed = true;
      }
      if (d.fee === undefined) {
        d.fee = 0;
        changed = true;
      }
      if (d.source === undefined) {
        d.source = "manual";
        changed = true;
      }
      if (d.migrated_from === undefined) {
        d.migrated_from = null;
        changed = true;
      }

      /* 상태 + 금액 재계산 */
      if (changed) {
        _calcAmounts(d);
        d.status = _calcStatus(d);
        d.deal_status = _calcDealStatus(d);
        d.updated_at = new Date().toISOString();
        count++;
      }
    });
    if (count > 0) {
      _save(all);
      emitAudit("MIGRATE_DEAL_V3", { migrated: count });
      console.log("[DEAL MIGRATE] " + count + "건 마이그레이션 완료 (v3 SSoT)");
    }
  }

  /* ══════════════════════════════════════
     Sales → Deals 마이그레이션 도구
     ══════════════════════════════════════ */

  /**
   * sales_v1 레코드를 deals_v1 형식으로 변환 (저장하지 않음)
   * @param {object} sale - sales_v1 레코드
   * @returns {object} deals_v1 형식 레코드
   */
  function convertSaleToDeal(sale) {
    var qty = n(sale.qty);
    var unitPrice = n(sale.sellUnitPrice);
    var supplyAmount = Math.round(qty * unitPrice);
    var costOverride = (sale.costOverrideUnitPriceKrw != null && sale.costOverrideUnitPriceKrw !== "")
      ? n(sale.costOverrideUnitPriceKrw) : null;
    var purchaseCost = costOverride != null ? Math.round(costOverride * qty) : null;

    var deal = {
      deal_id:              crypto.randomUUID(),
      partner_id:           sale.partner_id || null,
      partner_name_snapshot: (sale.client || sale.clientName || "").trim(),
      item_id:              sale.item_id || null,
      item_name:            (sale.itemName || "").trim(),
      qty:                  qty,
      unit_price:           unitPrice,
      supply_amount:        supplyAmount,
      vat_amount:           Math.round(supplyAmount * 0.1),
      total_amount:         supplyAmount + Math.round(supplyAmount * 0.1),
      manual_amount:        false,
      purchase_cost:        purchaseCost,
      margin_amount:        purchaseCost != null ? supplyAmount - purchaseCost : null,
      /* v2.4 SSoT 필드 */
      deal_owner:           DEAL_OWNER.MINE,   /* 마이그레이션 후 수동 분류 */
      deal_status:          DEAL_STATUS.ACTIVE,
      fee:                  0,
      source:               "migrated",
      migrated_from:        sale.id || null,
      /* 날짜 매핑: salesDate → quote_at, deposit_date → payment_at */
      quote_at:             sale.salesDate || null,
      order_at:             null,
      delivery_note_at:     null,
      invoice_at:           null,
      payment_at:           sale.deposit_date || null,
      /* 타임라인 */
      timeline:             [{ step: "migrate", at: new Date().toISOString(), label: "sales_v1에서 마이그레이션" }],
      status:               STATUS.NEW,
      memo:                 (sale.memo || "").trim(),
      created_at:           sale.createdAt || new Date().toISOString(),
      updated_at:           new Date().toISOString()
    };

    /* 상태 자동 계산 */
    deal.status = _calcStatus(deal);
    deal.deal_status = _calcDealStatus(deal);
    /* 금액 편의 별칭 */
    deal.amount = deal.supply_amount;
    deal.cost = deal.purchase_cost != null ? deal.purchase_cost : 0;

    return deal;
  }

  /**
   * sales_v1 전체를 deals_v1으로 마이그레이션 (dry-run 지원)
   * @param {boolean} dryRun - true면 저장하지 않고 결과만 반환
   * @returns {object} { converted, skipped, totalSalesAmt, totalDealsAmt, errors }
   */
  function migrateSalesToDeals(dryRun) {
    var SALES_KEY = "golab_sales_v1";
    var sales = [];
    try { sales = JSON.parse(localStorage.getItem(SALES_KEY) || "[]"); }
    catch(e) { return { error: "sales_v1 파싱 실패: " + e.message }; }

    var existingDeals = loadAll();
    /* 이미 마이그레이션된 sales id 목록 */
    var migratedIds = {};
    existingDeals.forEach(function(d) {
      if (d.migrated_from) migratedIds[d.migrated_from] = true;
    });

    var converted = [];
    var skipped = [];
    var errors = [];
    var totalSalesAmt = 0;
    var totalDealsAmt = 0;

    sales.forEach(function(sale, idx) {
      /* 이미 마이그레이션된 건 건너뜀 */
      if (sale.id && migratedIds[sale.id]) {
        skipped.push({ id: sale.id, reason: "이미 마이그레이션됨" });
        return;
      }
      try {
        var deal = convertSaleToDeal(sale);
        converted.push(deal);
        totalSalesAmt += Math.round(n(sale.qty) * n(sale.sellUnitPrice));
        totalDealsAmt += deal.supply_amount;
      } catch(e) {
        errors.push({ index: idx, id: sale.id, error: e.message });
      }
    });

    /* dry-run이 아니면 실제 저장 */
    if (!dryRun && converted.length > 0) {
      var allDeals = existingDeals.concat(converted);
      _save(allDeals);
      emitAudit("MIGRATE_SALES_TO_DEALS", {
        count: converted.length,
        skipped: skipped.length,
        totalAmount: totalDealsAmt
      });
      console.log("[MIGRATE] sales→deals " + converted.length + "건 완료");
    }

    return {
      salesCount: sales.length,
      convertedCount: converted.length,
      skippedCount: skipped.length,
      errorCount: errors.length,
      totalSalesAmt: totalSalesAmt,
      totalDealsAmt: totalDealsAmt,
      amountMatch: totalSalesAmt === totalDealsAmt,
      converted: converted,
      skipped: skipped,
      errors: errors,
      dryRun: !!dryRun
    };
  }

  /* ══════════════════════════════════════
     감사 로그
     ══════════════════════════════════════ */

  function emitAudit(event, detail) {
    try {
      var log = JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]");
      log.push({ event: event, ts: new Date().toISOString(), detail: detail || {} });
      if (log.length > 2000) log.splice(0, log.length - 2000);
      localStorage.setItem(AUDIT_KEY, JSON.stringify(log));
    } catch (e) { /* silent */ }
  }

  /* ══════════════════════════════════════
     Public API
     ══════════════════════════════════════ */

  return {
    DEALS_KEY: DEALS_KEY,
    AUDIT_KEY: AUDIT_KEY,
    STATUS: STATUS,
    DEAL_STATUS: DEAL_STATUS,
    DEAL_OWNER: DEAL_OWNER,
    STEPS: STEPS,
    STEP_MAP: STEP_MAP,
    loadAll: loadAll,
    getById: getById,
    create: create,
    update: update,
    remove: remove,
    stampStep: stampStep,
    unstampStep: unstampStep,
    getKPISummary: getKPISummary,
    getScorecard: getScorecard,
    getComparison: getComparison,
    migrate: migrate,
    convertSaleToDeal: convertSaleToDeal,
    migrateSalesToDeals: migrateSalesToDeals,
    emitAudit: emitAudit,
    fmt: fmt,
    n: n,
    currentStepIndex: _currentStepIndex
  };

})();
