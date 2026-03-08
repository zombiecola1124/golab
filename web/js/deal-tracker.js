/**
 * GoLab v2.3 — Deal Tracker (거래 흐름 체크 시스템)
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

  /* ── 상태 상수 ── */
  var STATUS = {
    NEW:      "신규",
    QUOTE:    "견적",
    ORDER:    "발주",
    DN:       "명세서",
    INVOICE:  "계산서",
    COMPLETE: "완료"
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
    /* 마진 */
    if (d.purchase_cost != null && d.purchase_cost !== "") {
      d.margin_amount = n(d.supply_amount) - n(d.purchase_cost);
    } else {
      d.margin_amount = null;
    }
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
      deal_id:              crypto.randomUUID(),
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
      /* 거래 흐름 5단계 타임스탬프 */
      quote_at:             fields.quote_at || null,
      order_at:             fields.order_at || null,
      delivery_note_at:     fields.delivery_note_at || null,
      invoice_at:           fields.invoice_at || null,
      payment_at:           fields.payment_at || null,
      /* 타임라인 로그 */
      timeline:             [],
      status:               STATUS.NEW,
      memo:                 (fields.memo || "").trim(),
      created_at:           new Date().toISOString(),
      updated_at:           new Date().toISOString()
    };
    if (!deal.partner_id) throw new Error("거래처를 선택해주세요.");
    if (!deal.item_name)  throw new Error("품목명을 입력해주세요.");

    _calcAmounts(deal);
    deal.status = _calcStatus(deal);
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

    /* 날짜 필드 (null 허용 = 삭제 가능) */
    if (fields.quote_at         !== undefined) d.quote_at         = fields.quote_at || null;
    if (fields.order_at         !== undefined) d.order_at         = fields.order_at || null;
    if (fields.delivery_note_at !== undefined) d.delivery_note_at = fields.delivery_note_at || null;
    if (fields.invoice_at       !== undefined) d.invoice_at       = fields.invoice_at || null;
    if (fields.payment_at       !== undefined) d.payment_at       = fields.payment_at || null;

    /* 금액 + 상태 재계산 */
    _calcAmounts(d);
    d.status = _calcStatus(d);
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
    var active = 0;         /* 진행 중 (완료 아닌 거래) */
    var complete = 0;       /* 완료 */
    var noInvoice = 0;      /* 계산서 미발행 (발주 이후) */
    var noPayment = 0;      /* 입금 대기 (계산서 이후) */
    var paymentDueAmt = 0;  /* 입금 대기 금액 */

    all.forEach(function(d) {
      if (d.status === STATUS.COMPLETE) {
        complete++;
      } else {
        active++;
        /* 발주 이후인데 계산서 미발행 */
        if (d.order_at && !d.invoice_at) noInvoice++;
        /* 계산서 이후인데 미입금 */
        if (d.invoice_at && !d.payment_at) {
          noPayment++;
          paymentDueAmt += n(d.total_amount);
        }
      }
    });

    return {
      total: all.length,
      active: active,
      complete: complete,
      noInvoice: noInvoice,
      noPayment: noPayment,
      paymentDueAmt: paymentDueAmt
    };
  }

  /* ══════════════════════════════════════
     마이그레이션 — 구 필드명 → 신 필드명 (멱등)
     ══════════════════════════════════════ */

  /**
   * 기존 데이터 호환: quote_date→quote_at 등
   * deposit_supply_date/deposit_vat_date → payment_at 통합
   */
  function migrate() {
    var all = loadAll();
    var count = 0;
    all.forEach(function(d) {
      var changed = false;
      /* quote_date → quote_at */
      if (d.quote_date && !d.quote_at) { d.quote_at = d.quote_date; changed = true; }
      /* po_date → order_at */
      if (d.po_date && !d.order_at) { d.order_at = d.po_date; changed = true; }
      /* invoice_date → invoice_at */
      if (d.invoice_date && !d.invoice_at) { d.invoice_at = d.invoice_date; changed = true; }
      /* deposit_supply_date/deposit_vat_date → payment_at */
      if ((d.deposit_supply_date || d.deposit_vat_date) && !d.payment_at) {
        d.payment_at = d.deposit_supply_date || d.deposit_vat_date;
        changed = true;
      }
      /* delivery_note_at 초기화 (없으면 null) */
      if (d.delivery_note_at === undefined) { d.delivery_note_at = null; changed = true; }
      /* timeline 초기화 */
      if (!d.timeline) { d.timeline = []; changed = true; }
      /* 상태 재계산 */
      if (changed) {
        d.status = _calcStatus(d);
        d.updated_at = new Date().toISOString();
        count++;
      }
    });
    if (count > 0) {
      _save(all);
      emitAudit("MIGRATE_DEAL_V2", { migrated: count });
      console.log("[DEAL MIGRATE] " + count + "건 마이그레이션 완료");
    }
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
    migrate: migrate,
    emitAudit: emitAudit,
    fmt: fmt,
    n: n,
    currentStepIndex: _currentStepIndex
  };

})();
