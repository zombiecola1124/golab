/**
 * GoLab v2.3 — Deal Tracker (거래/정산 추적 시스템)
 *
 * 사용법: <script src="js/deal-tracker.js"></script>
 *         GoLabDealTracker.loadAll()
 *         GoLabDealTracker.create(fields)
 *         GoLabDealTracker.stampEvent(dealId, eventType)
 *
 * localStorage 키:
 *   golab_deals_v1    — 거래 배열
 *   golab_deals_audit — 감사 로그
 */
window.GoLabDealTracker = (function () {
  "use strict";

  var DEALS_KEY = "golab_deals_v1";
  var AUDIT_KEY = "golab_deals_audit";

  /* ── 상태 상수 ── */
  var STATUS = {
    NEW:            "신규",
    QUOTED:         "견적 발송",
    PO:             "발주 완료",
    INVOICED:       "계산서 발행",
    SUPPLY_PAID:    "공급가 입금",
    COMPLETE:       "거래 완료"
  };

  /* ── 이벤트 → 날짜 필드 매핑 ── */
  var EVENT_FIELD = {
    quote:          "quote_date",
    po:             "po_date",
    invoice:        "invoice_date",
    deposit_supply: "deposit_supply_date",
    deposit_vat:    "deposit_vat_date"
  };

  /* ── 이벤트 → 한글 이름 ── */
  var EVENT_LABEL = {
    quote:          "견적 보냄",
    po:             "발주 받음",
    invoice:        "계산서 발행",
    deposit_supply: "공급가 입금",
    deposit_vat:    "VAT 입금"
  };

  /* ── 거래 유형 상수 (v2.3) ── */
  var DEAL_TYPE = {
    DAESUNG:   "daesung_trade",   // 대성무역 거래
    FRIEND:    "friend_manage",   // 지인 관리 거래
    BROKERAGE: "brokerage",       // 중개 거래
    DIRECT:    "direct"           // 직접 거래
  };

  var DEAL_TYPE_LABEL = {
    "daesung_trade":  "대성무역",
    "friend_manage":  "지인관리",
    "brokerage":      "중개",
    "direct":         "직접"
  };

  /* ── 거래 상태 상수 (v2.3) — 진행 상태(status)와 별도 ── */
  var DEAL_STATUS = {
    ACTIVE:    "active",
    COMPLETED: "completed",
    CANCELLED: "cancelled"
  };

  var DEAL_STATUS_LABEL = {
    "active":    "진행중",
    "completed": "완료",
    "cancelled": "취소"
  };

  /* SAVE 기본 비율 (대성무역만 적용) */
  var DEFAULT_SAVE_RATE = 0.30;

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
     상태 자동 계산 — 날짜 기반
     ══════════════════════════════════════ */

  /** 날짜 필드 우선순위에 따라 status 자동 결정 */
  function _calcStatus(d) {
    if (d.deposit_vat_date)     return STATUS.COMPLETE;
    if (d.deposit_supply_date)  return STATUS.SUPPLY_PAID;
    if (d.invoice_date)         return STATUS.INVOICED;
    if (d.po_date)              return STATUS.PO;
    if (d.quote_date)           return STATUS.QUOTED;
    return STATUS.NEW;
  }

  /* ══════════════════════════════════════
     금액 계산
     ══════════════════════════════════════ */

  /** 공급가 / VAT / 합계 / 마진 / 수익 체인 계산 */
  function _calcAmounts(d) {
    /* 공급가: manual_amount가 아니면 qty × unit_price */
    if (!d.manual_amount) {
      d.supply_amount = Math.round(n(d.qty) * n(d.unit_price));
    }
    /* VAT: 공급가의 10% (반올림) */
    d.vat_amount = Math.round(n(d.supply_amount) * 0.1);
    /* 합계 */
    d.total_amount = n(d.supply_amount) + n(d.vat_amount);
    /* 마진: purchase_cost가 있을 때만 */
    if (d.purchase_cost != null && d.purchase_cost !== "") {
      d.margin_amount = n(d.supply_amount) - n(d.purchase_cost);
    } else {
      d.margin_amount = null;
    }

    /* === v2.3 수익 체인 계산 === */
    /* gross_profit = 공급가 - 원가 */
    if (d.purchase_cost != null && d.purchase_cost !== "") {
      d.gross_profit = n(d.supply_amount) - n(d.purchase_cost);
    } else {
      d.gross_profit = null;
    }

    /* save_amount — 대성무역만 적용 */
    if (d.deal_type === DEAL_TYPE.DAESUNG && d.gross_profit != null) {
      d.save_amount = Math.round(d.gross_profit * n(d.save_rate, DEFAULT_SAVE_RATE));
    } else {
      d.save_amount = 0;
    }

    /* my_profit_amount = 총이익 - SAVE - 정산금 */
    if (d.gross_profit != null) {
      d.my_profit_amount = d.gross_profit - n(d.save_amount) - n(d.actual_settlement_amount);
    } else {
      d.my_profit_amount = null;
    }

    return d;
  }

  /* ══════════════════════════════════════
     거래 상태 자동 판정 (v2.3)
     ══════════════════════════════════════ */

  /** deal_status 자동 완료 판정 — 취소는 수동으로만 변경 */
  function _calcDealStatus(d) {
    if (d.deal_status === DEAL_STATUS.CANCELLED) return DEAL_STATUS.CANCELLED;
    if (d.deposit_vat_date) return DEAL_STATUS.COMPLETED;
    return DEAL_STATUS.ACTIVE;
  }

  /* ══════════════════════════════════════
     에이징 계산 (미수금 경과일)
     ══════════════════════════════════════ */

  /**
   * invoice_date 이후 미입금 경과일 계산
   * @returns {{ supplyAging: number|null, vatAging: number|null }}
   */
  function _calcAging(d) {
    if (!d.invoice_date) return { supplyAging: null, vatAging: null };
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var inv = new Date(d.invoice_date);
    inv.setHours(0, 0, 0, 0);
    var diff = Math.floor((today - inv) / (1000 * 60 * 60 * 24));
    if (diff < 0) diff = 0;
    return {
      supplyAging: (!d.deposit_supply_date) ? diff : null,
      vatAging:    (!d.deposit_vat_date)    ? diff : null
    };
  }

  /**
   * 에이징 일수 → CSS 색상 클래스
   * 0~7: default, 8~14: orange, 15~29: deep-orange, 30+: red
   */
  function agingColor(days) {
    if (days == null) return "";
    if (days >= 30) return "aging-red";
    if (days >= 15) return "aging-deep-orange";
    if (days >= 8)  return "aging-orange";
    return "aging-default";
  }

  /* ══════════════════════════════════════
     CRUD
     ══════════════════════════════════════ */

  function loadAll() {
    try { return JSON.parse(localStorage.getItem(DEALS_KEY) || "[]"); }
    catch { return []; }
  }

  function _save(arr) {
    localStorage.setItem(DEALS_KEY, JSON.stringify(arr));
  }

  function getById(dealId) {
    if (!dealId) return null;
    return loadAll().find(function(x) { return x.deal_id === dealId; }) || null;
  }

  /** 거래 생성 — 최소 필드: partner_id, item_name, qty, unit_price */
  function create(fields) {
    /* 거래 유형에 따른 SAVE 비율 기본값 설정 */
    var dealType = fields.deal_type || DEAL_TYPE.DIRECT;
    var saveRate = (dealType === DEAL_TYPE.DAESUNG)
      ? n(fields.save_rate, DEFAULT_SAVE_RATE)
      : n(fields.save_rate, 0);

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
      quote_date:           fields.quote_date || null,
      po_date:              fields.po_date || null,
      invoice_date:         fields.invoice_date || null,
      deposit_supply_date:  fields.deposit_supply_date || null,
      deposit_vat_date:     fields.deposit_vat_date || null,
      status:               STATUS.NEW,
      memo:                 (fields.memo || "").trim(),
      created_at:           new Date().toISOString(),
      updated_at:           new Date().toISOString(),
      /* === v2.3 신규 필드 === */
      deal_type:                 dealType,
      gross_profit:              null,   // _calcAmounts에서 자동 계산
      save_rate:                 saveRate,
      save_amount:               0,      // _calcAmounts에서 자동 계산
      actual_settlement_amount:  n(fields.actual_settlement_amount, 0),
      settlement_date:           fields.settlement_date || null,
      my_profit_amount:          null,   // _calcAmounts에서 자동 계산
      deal_status:               fields.deal_status || DEAL_STATUS.ACTIVE
    };
    if (!deal.partner_id) throw new Error("거래처를 선택해주세요.");
    if (!deal.item_name)  throw new Error("품목명을 입력해주세요.");

    _calcAmounts(deal);
    deal.status = _calcStatus(deal);
    deal.deal_status = _calcDealStatus(deal);

    var all = loadAll();
    all.unshift(deal);
    _save(all);
    emitAudit("CREATE", {
      deal_id: deal.deal_id, partner: deal.partner_name_snapshot,
      item: deal.item_name, deal_type: deal.deal_type
    });
    return deal;
  }

  /** 거래 수정 — 모든 필드 조건부 갱신 + 금액/상태 재계산 */
  function update(dealId, fields) {
    var all = loadAll();
    var idx = all.findIndex(function(x) { return x.deal_id === dealId; });
    if (idx < 0) throw new Error("거래를 찾을 수 없습니다: " + dealId);
    var d = all[idx];
    var before = Object.assign({}, d);

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
    if (fields.quote_date          !== undefined) d.quote_date          = fields.quote_date || null;
    if (fields.po_date             !== undefined) d.po_date             = fields.po_date || null;
    if (fields.invoice_date        !== undefined) d.invoice_date        = fields.invoice_date || null;
    if (fields.deposit_supply_date !== undefined) d.deposit_supply_date = fields.deposit_supply_date || null;
    if (fields.deposit_vat_date    !== undefined) d.deposit_vat_date    = fields.deposit_vat_date || null;

    /* === v2.3 신규 필드 업데이트 === */
    if (fields.deal_type !== undefined) {
      d.deal_type = fields.deal_type;
      /* 유형 변경 시 save_rate 자동 설정 */
      if (d.deal_type === DEAL_TYPE.DAESUNG && n(d.save_rate) === 0) {
        d.save_rate = DEFAULT_SAVE_RATE;
      }
      if (d.deal_type !== DEAL_TYPE.DAESUNG) {
        d.save_rate = 0;
        d.save_amount = 0;
      }
    }
    if (fields.save_rate                 !== undefined) d.save_rate                 = n(fields.save_rate, 0);
    if (fields.actual_settlement_amount  !== undefined) d.actual_settlement_amount  = n(fields.actual_settlement_amount, 0);
    if (fields.settlement_date           !== undefined) d.settlement_date           = fields.settlement_date || null;
    if (fields.deal_status               !== undefined) d.deal_status               = fields.deal_status;

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
     이벤트 스탬프 — 버튼 기반 날짜 입력
     ══════════════════════════════════════ */

  /**
   * 이벤트 버튼 핸들러
   * @param {string} dealId
   * @param {string} eventType - "quote"|"po"|"invoice"|"deposit_supply"|"deposit_vat"
   * @returns {object|null} 업데이트된 deal 또는 null (취소)
   */
  function stampEvent(dealId, eventType) {
    var field = EVENT_FIELD[eventType];
    if (!field) return null;
    var label = EVENT_LABEL[eventType] || eventType;
    if (!confirm('"' + label + '" 처리하시겠습니까?\n오늘 날짜(' + _today() + ')가 입력됩니다.')) return null;
    var updateFields = {};
    updateFields[field] = _today();
    return update(dealId, updateFields);
  }

  /* ══════════════════════════════════════
     KPI 집계 — console 대시보드용
     ══════════════════════════════════════ */

  function getKPISummary() {
    var all = loadAll();
    var noInvoice = { count: 0, amount: 0 };
    var supplyDue = { count: 0, amount: 0 };
    var vatDue    = { count: 0, amount: 0 };
    var overdue30 = { count: 0, amount: 0 };
    var counted30 = {};

    /* v2.3 확장 KPI */
    var monthPrefix = new Date().toISOString().substring(0, 7);
    var monthRevenue = 0;
    var totalMyProfit = 0;
    var monthMyProfit = 0;
    var totalSave = 0;
    var totalSettlement = 0;
    var settlementPending = { count: 0 };

    all.forEach(function(d) {
      /* 취소된 거래는 미수 KPI에서 제외 */
      if (d.deal_status === DEAL_STATUS.CANCELLED) return;

      /* v2.3: 이번달 매출 (invoice_date 기준) */
      if (d.invoice_date && d.invoice_date.substring(0, 7) === monthPrefix) {
        monthRevenue += n(d.supply_amount);
        if (d.my_profit_amount != null) monthMyProfit += n(d.my_profit_amount);
      }

      /* v2.3: 수익 집계 */
      if (d.my_profit_amount != null) totalMyProfit += n(d.my_profit_amount);
      totalSave += n(d.save_amount);
      totalSettlement += n(d.actual_settlement_amount);

      /* v2.3: 정산 대기 — 공급가 입금 완료 + 지인관리 + 정산일 미설정 */
      if (d.deal_type === DEAL_TYPE.FRIEND && d.deposit_supply_date && !d.settlement_date) {
        settlementPending.count++;
      }

      /* 계산서 미발행: 발주 이후, 계산서 미발행 */
      if (d.po_date && !d.invoice_date) {
        noInvoice.count++;
        noInvoice.amount += n(d.supply_amount);
      }
      if (!d.invoice_date) return;

      var aging = _calcAging(d);
      /* 공급가 미수 */
      if (!d.deposit_supply_date) {
        supplyDue.count++;
        supplyDue.amount += n(d.supply_amount);
        if (aging.supplyAging >= 30 && !counted30[d.deal_id]) {
          overdue30.count++;
          overdue30.amount += n(d.supply_amount);
          counted30[d.deal_id] = true;
        }
      }
      /* VAT 미수 */
      if (!d.deposit_vat_date) {
        vatDue.count++;
        vatDue.amount += n(d.vat_amount);
        if (aging.vatAging >= 30 && !counted30[d.deal_id]) {
          overdue30.count++;
          overdue30.amount += n(d.vat_amount);
          counted30[d.deal_id] = true;
        }
      }
    });

    return {
      noInvoice: noInvoice, supplyDue: supplyDue, vatDue: vatDue, overdue30: overdue30,
      /* v2.3 확장 */
      monthRevenue: monthRevenue,
      totalMyProfit: totalMyProfit,
      monthMyProfit: monthMyProfit,
      totalSave: totalSave,
      totalSettlement: totalSettlement,
      settlementPending: settlementPending
    };
  }

  /* ══════════════════════════════════════
     수익 대시보드 집계 (v2.3) — 기간 필터 지원
     ══════════════════════════════════════ */

  /**
   * profit.html 통합용 — 기간별 거래 수익 집계
   * @param {string} from - "YYYY-MM-DD" 시작일 (없으면 전체)
   * @param {string} to   - "YYYY-MM-DD" 종료일 (없으면 전체)
   */
  function getProfitSummary(from, to) {
    var all = loadAll();
    var result = {
      revenue: 0, grossProfit: 0, saveTotal: 0,
      settlementTotal: 0, myProfit: 0, count: 0,
      byType: {}
    };
    /* 유형별 초기화 */
    [DEAL_TYPE.DAESUNG, DEAL_TYPE.FRIEND, DEAL_TYPE.BROKERAGE, DEAL_TYPE.DIRECT].forEach(function(t) {
      result.byType[t] = { revenue: 0, grossProfit: 0, save: 0, settlement: 0, myProfit: 0, count: 0 };
    });

    all.forEach(function(d) {
      if (d.deal_status === DEAL_STATUS.CANCELLED) return;
      /* 날짜 기준: invoice_date 우선, 없으면 created_at */
      var dt = d.invoice_date || (d.created_at ? d.created_at.substring(0, 10) : "");
      if (from && dt < from) return;
      if (to && dt > to) return;

      var rev = n(d.supply_amount);
      var gp  = d.gross_profit != null ? n(d.gross_profit) : 0;
      var sv  = n(d.save_amount);
      var st  = n(d.actual_settlement_amount);
      var mp  = d.my_profit_amount != null ? n(d.my_profit_amount) : 0;

      result.revenue      += rev;
      result.grossProfit  += gp;
      result.saveTotal    += sv;
      result.settlementTotal += st;
      result.myProfit     += mp;
      result.count++;

      var type = d.deal_type || DEAL_TYPE.DIRECT;
      if (result.byType[type]) {
        result.byType[type].revenue    += rev;
        result.byType[type].grossProfit += gp;
        result.byType[type].save       += sv;
        result.byType[type].settlement += st;
        result.byType[type].myProfit   += mp;
        result.byType[type].count++;
      }
    });

    return result;
  }

  /* ══════════════════════════════════════
     v2.3 마이그레이션 — 기존 거래에 신규 필드 추가
     ══════════════════════════════════════ */

  function migrate() {
    var all = loadAll();
    var migrated = 0;
    all.forEach(function(d) {
      if (typeof d.deal_type !== "undefined") return; // 이미 마이그레이션됨
      migrated++;
      d.deal_type                = DEAL_TYPE.DIRECT;
      d.save_rate                = 0;
      d.save_amount              = 0;
      d.actual_settlement_amount = 0;
      d.settlement_date          = null;
      d.deal_status              = d.deposit_vat_date ? DEAL_STATUS.COMPLETED : DEAL_STATUS.ACTIVE;
      d.gross_profit             = null;
      d.my_profit_amount         = null;
      _calcAmounts(d); // gross_profit, my_profit_amount 계산
    });
    if (migrated > 0) {
      _save(all);
      emitAudit("MIGRATE_V23", { count: migrated });
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

  /* ── 모듈 초기화 시 마이그레이션 자동 실행 ── */
  migrate();

  return {
    DEALS_KEY: DEALS_KEY,
    AUDIT_KEY: AUDIT_KEY,
    STATUS: STATUS,
    EVENT_FIELD: EVENT_FIELD,
    EVENT_LABEL: EVENT_LABEL,
    /* v2.3 상수 */
    DEAL_TYPE: DEAL_TYPE,
    DEAL_TYPE_LABEL: DEAL_TYPE_LABEL,
    DEAL_STATUS: DEAL_STATUS,
    DEAL_STATUS_LABEL: DEAL_STATUS_LABEL,
    DEFAULT_SAVE_RATE: DEFAULT_SAVE_RATE,
    /* CRUD */
    loadAll: loadAll,
    getById: getById,
    create: create,
    update: update,
    remove: remove,
    stampEvent: stampEvent,
    calcAging: _calcAging,
    agingColor: agingColor,
    /* KPI */
    getKPISummary: getKPISummary,
    getProfitSummary: getProfitSummary,
    /* 유틸 */
    emitAudit: emitAudit,
    migrate: migrate,
    fmt: fmt,
    n: n
  };

})();
