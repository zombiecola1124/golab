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

  /** 공급가 / VAT / 합계 / 마진 계산 */
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
    return d;
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
      updated_at:           new Date().toISOString()
    };
    if (!deal.partner_id) throw new Error("거래처를 선택해주세요.");
    if (!deal.item_name)  throw new Error("품목명을 입력해주세요.");

    _calcAmounts(deal);
    deal.status = _calcStatus(deal);

    var all = loadAll();
    all.unshift(deal);
    _save(all);
    emitAudit("CREATE", { deal_id: deal.deal_id, partner: deal.partner_name_snapshot, item: deal.item_name });
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

    all.forEach(function(d) {
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

    return { noInvoice: noInvoice, supplyDue: supplyDue, vatDue: vatDue, overdue30: overdue30 };
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
    EVENT_FIELD: EVENT_FIELD,
    EVENT_LABEL: EVENT_LABEL,
    loadAll: loadAll,
    getById: getById,
    create: create,
    update: update,
    remove: remove,
    stampEvent: stampEvent,
    calcAging: _calcAging,
    agingColor: agingColor,
    getKPISummary: getKPISummary,
    emitAudit: emitAudit,
    fmt: fmt,
    n: n
  };

})();
