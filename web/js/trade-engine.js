/**
 * GoLab v3.0 — Trade Engine (경영 원장 중심)
 *
 * v3.0 핵심 변경:
 *   - classifyTrade() 엔진 이관 (전 화면 공유)
 *   - deal_owner(지인) 개념 폐기 — 모든 거래 동등 집계
 *   - tracking_number 폐기 (create/update에서 제거)
 *   - 거래 유형 3분류: 직접-단독 / 직접-정산 / 관리업체
 *
 * 이전 변경:
 *   v2.9c: deal_date + date_inferred
 *   v2.8a: extra_costs.affects_profit
 *   v2.8: 다품목, rates/settlement, 부대비용, 운송장
 *
 * 저장 키:
 *   golab_trade_v2       — 거래 배열
 *   golab_trade_v2_audit — 감사 로그
 *
 * 마이그레이션 소스 (읽기 전용, 수정 금지):
 *   golab_deals_v1       — v1 거래 원본 백업
 *
 * 사용법:
 *   <script src="js/trade-engine.js"></script>
 *   GoLabTradeEngine.loadAll()
 *   GoLabTradeEngine.create(fields)
 *   GoLabTradeEngine.calcTrade(trade)
 *   GoLabTradeEngine.classifyTrade(trade)
 */
window.GoLabTradeEngine = (function () {
  "use strict";

  /* ══════════════════════════════════════
     상수
     ══════════════════════════════════════ */

  var TRADE_KEY = "golab_trade_v2";
  var AUDIT_KEY = "golab_trade_v2_audit";
  var V1_KEY    = "golab_deals_v1";   /* 읽기 전용 마이그레이션 소스 */

  /* 거래 흐름 5단계 정의 */
  var STEPS = [
    { key: "quote",         field: "quote_at",         label: "견적",   icon: "\ud83d\udccb" },
    { key: "order",         field: "order_at",         label: "발주",   icon: "\ud83d\udce6" },
    { key: "delivery_note", field: "delivery_note_at", label: "명세서", icon: "\ud83d\udcc4" },
    { key: "invoice",       field: "invoice_at",       label: "계산서", icon: "\ud83e\uddfe" },
    { key: "payment",       field: "payment_at",       label: "입금",   icon: "\ud83d\udcb0" }
  ];

  var STEP_MAP = {};
  STEPS.forEach(function (s, i) { STEP_MAP[s.key] = Object.assign({ index: i }, s); });

  var STATUS = {
    NEW:      "신규",
    QUOTE:    "견적",
    ORDER:    "발주",
    DN:       "명세서",
    INVOICE:  "계산서",
    COMPLETE: "완료"
  };

  var DEAL_STATUS = {
    ACTIVE:    "active",
    COMPLETED: "completed",
    CANCELLED: "cancelled"
  };

  var DEAL_OWNER = {
    MINE:   "mine",
    FRIEND: "friend"
  };

  /* 부대비용 유형 enum (v2.8) */
  var EXTRA_COST_TYPES = {
    shipping:   "운송비",
    quick:      "퀵비",
    processing: "가공비",
    misc:       "기타"
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
     상태 자동 계산
     ══════════════════════════════════════ */

  function _calcStatus(d) {
    if (d.payment_at)       return STATUS.COMPLETE;
    if (d.invoice_at)       return STATUS.INVOICE;
    if (d.delivery_note_at) return STATUS.DN;
    if (d.order_at)         return STATUS.ORDER;
    if (d.quote_at)         return STATUS.QUOTE;
    return STATUS.NEW;
  }

  function _calcDealStatus(d) {
    if (d.deal_status === DEAL_STATUS.CANCELLED) return DEAL_STATUS.CANCELLED;
    if (d.payment_at) return DEAL_STATUS.COMPLETED;
    return DEAL_STATUS.ACTIVE;
  }

  function _currentStepIndex(d) {
    for (var i = STEPS.length - 1; i >= 0; i--) {
      if (d[STEPS[i].field]) return i + 1;
    }
    return 0;
  }

  /* ══════════════════════════════════════
     ID 생성 — T20260309-001 형식
     ══════════════════════════════════════ */

  function generateId(existingArr) {
    var now = new Date();
    var dateStr = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0");
    var prefix = "T" + dateStr + "-";
    var all = existingArr || loadAll();
    var maxNum = 0;
    all.forEach(function (t) {
      if (t.id && t.id.indexOf(prefix) === 0) {
        var num = parseInt(t.id.substring(prefix.length), 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    });
    return prefix + String(maxNum + 1).padStart(3, "0");
  }

  /* ══════════════════════════════════════
     핵심 계산 엔진 — 순수 함수 (저장 안 함)
     ══════════════════════════════════════ */

  /**
   * 거래 수익 계산 (파생값 반환)
   * @param {Object} trade — 거래 객체 (또는 폼에서 조립한 임시 객체)
   * @returns {Object} 계산 결과 (저장하지 않음)
   */
  function calcTrade(trade) {
    var items      = trade.items || [];
    var rates      = trade.rates || {};
    var settlement = trade.settlement || {};

    /* 품목 합계 */
    var total_supply    = 0;
    var item_cost_total = 0;
    var hasCost         = false;

    items.forEach(function (item) {
      var sa = Math.round(n(item.qty) * n(item.unit_price));
      total_supply += sa;
      if (item.cost != null && item.cost !== "") {
        item_cost_total += n(item.cost);
        hasCost = true;
      }
    });

    /* 부대비용 합산 (v2.8a: affects_profit 필터링) */
    var extra_cost_total = 0;
    var extra_costs = trade.extra_costs || [];
    extra_costs.forEach(function (ec) {
      /* affects_profit 가 명시적 false 가 아닌 경우만 합산 (기본 true) */
      if (ec.affects_profit !== false) {
        extra_cost_total += n(ec.amount);
      }
    });
    if (extra_costs.length > 0 && extra_cost_total > 0) hasCost = true;

    /* 총 원가 = 품목 원가 + 부대비용 */
    var total_cost = item_cost_total + extra_cost_total;

    var result = {
      total_supply:     total_supply,
      item_cost_total:  item_cost_total,    /* v2.8 분리 */
      extra_cost_total: extra_cost_total,   /* v2.8 신규 */
      total_cost:       total_cost,         /* v2.8: 품목원가 + 부대비용 */
      has_cost:         hasCost,
      vat_amount:       Math.round(total_supply * 0.1),
      total_amount:     total_supply + Math.round(total_supply * 0.1)
    };

    if (trade.trade_type === "channel") {
      /* ── 관리업체 거래 (v3.14: gross_profit 기반 계산) ── */
      result.gross_profit      = total_supply - (item_cost_total + extra_cost_total);
      result.rebate_amount     = Math.round(result.gross_profit * n(rates.rebate_rate) / 100);
      result.distributable     = result.gross_profit - result.rebate_amount;
      result.expected_S_amount = Math.round(result.distributable * n(rates.S_rate) / 100);
      result.expected_my_amount= Math.round(result.distributable * n(rates.my_rate) / 100);
      result.final_my_amount   = result.distributable - n(settlement.actual_S_amount);
    } else {
      /* ── 내 거래 (direct) ── */
      result.gross_profit      = total_supply - total_cost;
      result.save_amount       = Math.round(result.gross_profit * n(rates.save_rate) / 100);
      result.distributable     = result.gross_profit - result.save_amount;
      result.expected_S_amount = Math.round(result.distributable * n(rates.S_rate) / 100);
      result.expected_my_amount= Math.round(result.distributable * n(rates.my_rate) / 100);
      result.final_my_amount   = result.distributable - n(settlement.actual_S_amount);
    }

    return result;
  }

  /* ══════════════════════════════════════
     v3.9: 입금 상태 엔진 (공급가/VAT 분리)
     ══════════════════════════════════════ */

  /**
   * 입금 상태 판정 (공용 함수 — deals.html / profit.html 공통 사용)
   * @param {Object} deal — 거래 객체 (paid_supply / paid_vat 필드 참조)
   * @returns {{ code: string, label: string, progress: number }}
   */
  function calcPaymentStatus(deal) {
    var c = calcTrade(deal);
    var ps = n(deal.paid_supply);
    var pv = n(deal.paid_vat);

    /* 품목 미입력 (공급가 0) → 판정 불가, 미입금 처리 */
    if (c.total_amount <= 0) {
      return { code: "unpaid", label: "미입금", progress: 0 };
    }

    /* 진행률 (0~100) */
    var progress = Math.min(100, Math.round((ps + pv) / c.total_amount * 100));

    /* 3단계 판정 */
    if (ps >= c.total_supply && pv >= c.vat_amount) {
      return { code: "paid", label: "완납", progress: 100 };
    }
    if (ps >= c.total_supply && pv < c.vat_amount) {
      return { code: "vat_pending", label: "VAT 미입금", progress: progress };
    }
    return { code: "unpaid", label: "미입금", progress: progress };
  }

  /* ══════════════════════════════════════
     거래 유형 분류 (v3.0)
     ══════════════════════════════════════ */

  /**
   * 거래 유형 3분류
   * @returns {"solo"|"settle"|"channel"}
   */
  function classifyTrade(t) {
    if (t.trade_type === "channel") return "channel";
    var rates = t.rates || {};
    if (n(rates.S_rate) > 0 || n(rates.save_rate) > 0) return "settle";
    return "solo";
  }

  /* ══════════════════════════════════════
     CRUD
     ══════════════════════════════════════ */

  function loadAll() {
    try { return JSON.parse(localStorage.getItem(TRADE_KEY) || "[]"); }
    catch (e) { return []; }
  }

  function _save(arr) {
    localStorage.setItem(TRADE_KEY, JSON.stringify(arr));
  }

  function getById(tradeId) {
    if (!tradeId) return null;
    return loadAll().find(function (t) { return t.id === tradeId; }) || null;
  }

  /* v3.8: 품목 마스터 snapshot 추출 헬퍼 */
  function _snapshotFromMaster(itemId) {
    if (!itemId || typeof GoLabItemMaster === "undefined") return { unit: null, basePrice: null };
    var m = GoLabItemMaster.getById(itemId);
    if (!m) return { unit: null, basePrice: null };
    /* v3.12: 전략 가격 폴백 (rrp_price, legacy consumer_price 호환) */
    var bp = m.dealer_price || m.rrp_price || m.consumer_price || m.target_buy_price || null;
    return { unit: m.unit || null, basePrice: bp };
  }

  /** 거래 생성 */
  function create(fields) {
    if (!fields.partner_id) throw new Error("거래처를 선택해주세요.");
    if (!fields.items || fields.items.length === 0) throw new Error("품목을 1개 이상 추가해주세요.");

    var all = loadAll();

    var trade = {
      id:                    generateId(all),
      partner_id:            fields.partner_id,
      partner_name_snapshot: (fields.partner_name_snapshot || "").trim(),
      /* v2.9c: 장부 기준일 (YYYY-MM-DD) */
      deal_date:             fields.deal_date || new Date().toISOString().substring(0, 10),
      date_inferred:         false,   /* 사용자가 직접 지정 */

      channel_id:            fields.channel_id || null,
      /* v5: 관리업체명 스냅샷 (검색용) */
      channel_name_snapshot: (fields.channel_name_snapshot || "").trim(),
      trade_type:            fields.channel_id ? "channel" : "direct",
      /* v3.0: deal_owner 폐기 — 기존 데이터 호환용 기본값 */
      deal_owner:            DEAL_OWNER.MINE,
      deal_status:           DEAL_STATUS.ACTIVE,

      /* 품목 배열 (v3.8: snapshot 필드 추가) */
      items: (fields.items || []).map(function (item, i) {
        var snap = _snapshotFromMaster(item.item_id);
        return {
          seq:           i + 1,
          item_id:       item.item_id || null,
          name:          (item.name || "").trim(),
          qty:           n(item.qty),
          unit_price:    n(item.unit_price),
          supply_amount: Math.round(n(item.qty) * n(item.unit_price)),
          cost:          (item.cost != null && item.cost !== "") ? n(item.cost) : null,
          memo:          (item.memo || "").trim(),
          /* v3.8: 품목 마스터 snapshot */
          item_unit_snapshot:       snap.unit,
          item_base_price_snapshot: snap.basePrice
        };
      }),

      /* 부대비용 배열 (v2.8a: affects_profit 추가) */
      extra_costs: (fields.extra_costs || []).map(function (ec) {
        return {
          type:           ec.type || "misc",
          label:          EXTRA_COST_TYPES[ec.type] || EXTRA_COST_TYPES.misc,
          amount:         n(ec.amount),
          affects_profit: ec.affects_profit !== false,   /* 기본 true */
          memo:           (ec.memo || "").trim()
        };
      }),

      /* v3.0: tracking_number 폐기 — 기존 데이터 호환용 빈값 */
      tracking_number: "",

      /* 비율 — 예상 계산용 */
      rates: {
        save_rate:   n(fields.rates ? fields.rates.save_rate : 30),
        rebate_rate: n(fields.rates ? fields.rates.rebate_rate : 30),
        S_rate:      n(fields.rates ? fields.rates.S_rate : 60),
        my_rate:     n(fields.rates ? fields.rates.my_rate : 40)
      },

      /* 정산 — 실제 확정값 (v3.14: payout_fee 폐기) */
      settlement: {
        actual_S_amount: n(fields.settlement ? fields.settlement.actual_S_amount : 0),
        memo:            (fields.settlement && fields.settlement.memo) ? fields.settlement.memo.trim() : ""
      },

      /* 거래 흐름 5단계 */
      quote_at:         fields.quote_at || null,
      order_at:         fields.order_at || null,
      delivery_note_at: fields.delivery_note_at || null,
      invoice_at:       fields.invoice_at || null,
      payment_at:       fields.payment_at || null,

      /* v3.9: 입금 추적 (공급가/VAT 분리) */
      paid_supply:   n(fields.paid_supply),
      paid_vat:      n(fields.paid_vat),

      timeline: [{ step: "create", at: new Date().toISOString(), label: "거래 생성" }],
      source:        fields.source || "manual",
      migrated_from: fields.migrated_from || null,
      memo:          (fields.memo || "").trim(),
      created_at:    fields.created_at || new Date().toISOString(),
      updated_at:    new Date().toISOString()
    };

    trade.status      = _calcStatus(trade);
    trade.deal_status = _calcDealStatus(trade);

    all.unshift(trade);
    _save(all);
    emitAudit("CREATE", {
      id: trade.id,
      partner: trade.partner_name_snapshot,
      items_count: trade.items.length
    });
    return trade;
  }

  /** 거래 수정 */
  function update(tradeId, fields) {
    var all = loadAll();
    var idx = all.findIndex(function (t) { return t.id === tradeId; });
    if (idx < 0) throw new Error("거래를 찾을 수 없습니다: " + tradeId);
    var d = all[idx];

    /* 기본 필드 */
    if (fields.partner_id            !== undefined) d.partner_id            = fields.partner_id;
    if (fields.partner_name_snapshot !== undefined) d.partner_name_snapshot = fields.partner_name_snapshot.trim();
    if (fields.channel_id            !== undefined) {
      d.channel_id = fields.channel_id || null;
      d.trade_type = d.channel_id ? "channel" : "direct";
    }
    /* v5: 관리업체명 스냅샷 */
    if (fields.channel_name_snapshot !== undefined) d.channel_name_snapshot = (fields.channel_name_snapshot || "").trim();
    /* v3.0: deal_owner 폐기 — 업데이트 중단 */
    if (fields.deal_status !== undefined) d.deal_status = fields.deal_status;
    if (fields.memo        !== undefined) d.memo        = fields.memo.trim();

    /* 품목 배열 교체 (v3.8: snapshot 필드 추가) */
    if (fields.items !== undefined) {
      d.items = (fields.items || []).map(function (item, i) {
        var snap = _snapshotFromMaster(item.item_id);
        return {
          seq:           i + 1,
          item_id:       item.item_id || null,
          name:          (item.name || "").trim(),
          qty:           n(item.qty),
          unit_price:    n(item.unit_price),
          supply_amount: Math.round(n(item.qty) * n(item.unit_price)),
          cost:          (item.cost != null && item.cost !== "") ? n(item.cost) : null,
          memo:          (item.memo || "").trim(),
          /* v3.8: 품목 마스터 snapshot */
          item_unit_snapshot:       snap.unit,
          item_base_price_snapshot: snap.basePrice
        };
      });
    }

    /* 부대비용 배열 교체 (v2.8a: affects_profit 추가) */
    if (fields.extra_costs !== undefined) {
      d.extra_costs = (fields.extra_costs || []).map(function (ec) {
        return {
          type:           ec.type || "misc",
          label:          EXTRA_COST_TYPES[ec.type] || EXTRA_COST_TYPES.misc,
          amount:         n(ec.amount),
          affects_profit: ec.affects_profit !== false,   /* 기본 true */
          memo:           (ec.memo || "").trim()
        };
      });
    }

    /* v3.0: tracking_number 폐기 — 업데이트 중단 */

    /* 비율 */
    if (fields.rates !== undefined) {
      d.rates = {
        save_rate:   n(fields.rates.save_rate,   d.rates ? d.rates.save_rate   : 30),
        rebate_rate: n(fields.rates.rebate_rate,  d.rates ? d.rates.rebate_rate : 30),
        S_rate:      n(fields.rates.S_rate,       d.rates ? d.rates.S_rate      : 60),
        my_rate:     n(fields.rates.my_rate,      d.rates ? d.rates.my_rate     : 40)
      };
    }

    /* 정산 (v3.14: payout_fee 폐기) */
    if (fields.settlement !== undefined) {
      d.settlement = {
        actual_S_amount: n(fields.settlement.actual_S_amount, d.settlement ? d.settlement.actual_S_amount : 0),
        memo:            fields.settlement.memo !== undefined
          ? fields.settlement.memo.trim()
          : (d.settlement ? d.settlement.memo : "")
      };
    }

    /* v3.9: 입금 추적 필드 */
    if (fields.paid_supply !== undefined) d.paid_supply = n(fields.paid_supply);
    if (fields.paid_vat    !== undefined) d.paid_vat    = n(fields.paid_vat);

    /* 날짜 필드 */
    /* v2.9c: 장부 기준일 — 사용자 수정 시 date_inferred 해제 */
    if (fields.deal_date        !== undefined) {
      d.deal_date        = fields.deal_date;
      d.date_inferred    = false;
    }
    if (fields.quote_at         !== undefined) d.quote_at         = fields.quote_at || null;
    if (fields.order_at         !== undefined) d.order_at         = fields.order_at || null;
    if (fields.delivery_note_at !== undefined) d.delivery_note_at = fields.delivery_note_at || null;
    if (fields.invoice_at       !== undefined) d.invoice_at       = fields.invoice_at || null;
    if (fields.payment_at       !== undefined) d.payment_at       = fields.payment_at || null;

    /* v3.9: 완납 시 payment_at 자동 기록 (기존 값 있으면 보존) */
    if (!d.payment_at) {
      var _ps = calcPaymentStatus(d);
      if (_ps.code === "paid") {
        d.payment_at = _today();
        if (!d.timeline) d.timeline = [];
        d.timeline.push({ step: "payment", at: new Date().toISOString(), label: "완납 자동 기록" });
      }
    }

    /* 상태 재계산 */
    d.status      = _calcStatus(d);
    d.deal_status = _calcDealStatus(d);
    d.updated_at  = new Date().toISOString();

    _save(all);
    emitAudit("UPDATE", { id: tradeId, changed: Object.keys(fields) });
    return d;
  }

  /** 거래 삭제 */
  function remove(tradeId) {
    var all = loadAll();
    var idx = all.findIndex(function (t) { return t.id === tradeId; });
    if (idx < 0) return;
    var removed = all.splice(idx, 1)[0];
    _save(all);
    emitAudit("DELETE", { id: tradeId, partner: removed.partner_name_snapshot });
  }

  /* ══════════════════════════════════════
     단계 스탬프
     ══════════════════════════════════════ */

  function stampStep(tradeId, stepKey) {
    var step = STEP_MAP[stepKey];
    if (!step) return null;
    if (!confirm('"' + step.label + '" 처리하시겠습니까?\n오늘 날짜(' + _today() + ')가 자동 입력됩니다.')) return null;

    var all = loadAll();
    var idx = all.findIndex(function (t) { return t.id === tradeId; });
    if (idx < 0) return null;
    var d = all[idx];

    d[step.field] = _today();
    if (!d.timeline) d.timeline = [];
    d.timeline.push({ step: stepKey, at: new Date().toISOString(), label: step.label + " 완료" });

    d.status      = _calcStatus(d);
    d.deal_status = _calcDealStatus(d);
    d.updated_at  = new Date().toISOString();

    _save(all);
    emitAudit("STAMP_STEP", { id: tradeId, step: stepKey, date: d[step.field] });
    return d;
  }

  function unstampStep(tradeId, stepKey) {
    var step = STEP_MAP[stepKey];
    if (!step) return null;
    if (!confirm('"' + step.label + '" 처리를 취소하시겠습니까?')) return null;

    var all = loadAll();
    var idx = all.findIndex(function (t) { return t.id === tradeId; });
    if (idx < 0) return null;
    var d = all[idx];

    d[step.field] = null;
    if (!d.timeline) d.timeline = [];
    d.timeline.push({ step: stepKey, at: new Date().toISOString(), label: step.label + " 취소" });

    d.status      = _calcStatus(d);
    d.deal_status = _calcDealStatus(d);
    d.updated_at  = new Date().toISOString();

    _save(all);
    emitAudit("UNSTAMP_STEP", { id: tradeId, step: stepKey });
    return d;
  }

  /* ══════════════════════════════════════
     KPI 집계 — console 대시보드용
     ══════════════════════════════════════ */

  function getKPISummary() {
    var all = loadAll();
    var active = 0, complete = 0, cancelled = 0;
    var noInvoiceCount = 0, noInvoiceAmt = 0;
    var noPayment = 0, paymentDueAmt = 0;
    /* v3.0: friend 분리 폐기 — 모든 거래 동등 집계 */
    var totalAmount = 0;
    var receivableAmount = 0;
    var supplyDueCount = 0, supplyDueAmt = 0;
    var vatDueCount = 0, vatDueAmt = 0;
    var overdue30Count = 0, overdue30Amt = 0;
    var d30 = new Date(); d30.setDate(d30.getDate() - 30);
    var thirtyDaysAgo = d30.toISOString().substring(0, 10);

    all.forEach(function (t) {
      if (t.deal_status === DEAL_STATUS.CANCELLED) { cancelled++; return; }

      /* 총 공급가 계산 */
      var calc = calcTrade(t);
      var amt = calc.total_supply;

      totalAmount += amt;

      if (t.status === STATUS.COMPLETE) {
        complete++;
      } else {
        active++;
        if (t.order_at && !t.invoice_at) { noInvoiceCount++; noInvoiceAmt += amt; }
        if (t.delivery_note_at && !t.invoice_at) { supplyDueCount++; supplyDueAmt += amt; }
        if (t.invoice_at && !t.payment_at) {
          noPayment++;
          paymentDueAmt += calc.total_amount;
          receivableAmount += amt;
          vatDueCount++;
          vatDueAmt += amt;
        }
        /* v2.9c: deal_date 우선 사용 */
        var startDate = t.deal_date || (t.quote_at || t.created_at || "").substring(0, 10);
        if (startDate && startDate <= thirtyDaysAgo) {
          overdue30Count++;
          overdue30Amt += amt;
        }
      }
    });

    return {
      total: all.length,
      active: active,
      complete: complete,
      cancelled: cancelled,
      totalAmount: totalAmount,
      receivableAmount: receivableAmount,
      noInvoice: { count: noInvoiceCount, amount: noInvoiceAmt },
      noPayment: noPayment,
      paymentDueAmt: paymentDueAmt,
      supplyDue: { count: supplyDueCount, amount: supplyDueAmt },
      vatDue:    { count: vatDueCount, amount: vatDueAmt },
      overdue30: { count: overdue30Count, amount: overdue30Amt }
    };
  }

  /* ══════════════════════════════════════
     성적표 집계 — Profit 화면 전용
     ══════════════════════════════════════ */

  function getScorecard(fromDate, toDate) {
    var all = loadAll();
    var totalRevenue = 0, paidRevenue = 0, myNetProfit = 0;
    /* v3.0: friend 분리 폐기 — 모든 거래 동등 집계 */
    var totalCost = 0;
    var receivableAmount = 0;
    var dealCount = 0, paidCount = 0, receivableCount = 0;
    var deals = [];

    all.forEach(function (t) {
      if (t.deal_status === DEAL_STATUS.CANCELLED) return;

      /* v2.9c: deal_date 우선, fallback quote_at → created_at */
      var dt = t.deal_date || (t.quote_at || t.created_at || "").substring(0, 10);
      if (!dt || dt < fromDate || dt > toDate) return;

      var calc = calcTrade(t);
      var amt = calc.total_supply;

      totalRevenue += amt;
      dealCount++;

      /* 편의 속성 붙이기 (profit.html 렌더링용) */
      t._calc = calc;
      t._display_name = _itemDisplayName(t);
      deals.push(t);

      if (t.payment_at) { paidRevenue += amt; paidCount++; }
      if (t.invoice_at && !t.payment_at) { receivableAmount += amt; receivableCount++; }

      /* v3.0: 모든 거래 동등 집계 (friend 분리 폐기) */
      totalCost += calc.total_cost;
      myNetProfit += calc.final_my_amount;
    });

    return {
      totalRevenue:    totalRevenue,
      paidRevenue:     paidRevenue,
      myNetProfit:     myNetProfit,
      totalCost:       totalCost,     /* v3.0 신규 */
      receivableAmount: receivableAmount,
      dealCount:       dealCount,
      paidCount:       paidCount,
      receivableCount: receivableCount,
      deals:           deals
    };
  }

  /** 품목명 표시용 헬퍼 */
  function _itemDisplayName(trade) {
    var items = trade.items || [];
    if (items.length === 0) return "(품목 없음)";
    var first = items[0].name || "(미지정)";
    if (items.length === 1) return first;
    return first + " 외 " + (items.length - 1) + "건";
  }

  function getComparison(curFrom, curTo, prevFrom, prevTo) {
    return {
      current:  getScorecard(curFrom, curTo),
      previous: getScorecard(prevFrom, prevTo)
    };
  }

  /* ══════════════════════════════════════
     마이그레이션 — golab_deals_v1 → golab_trade_v2
     v1 원본은 절대 수정하지 않는다 (read-only)
     ══════════════════════════════════════ */

  function migrateFromV1() {
    /* 이미 마이그레이션된 데이터가 있으면 건너뜀 */
    var existing = loadAll();
    if (existing.length > 0) {
      return { migrated: 0, message: "v2 데이터 존재 — 마이그레이션 불필요" };
    }

    /* v1 읽기 (수정 금지) */
    var v1Data;
    try { v1Data = JSON.parse(localStorage.getItem(V1_KEY) || "[]"); }
    catch (e) { return { error: "v1 파싱 실패: " + e.message }; }

    if (v1Data.length === 0) {
      return { migrated: 0, message: "v1 데이터 없음" };
    }

    /* 마이그레이션 실행 */
    var migrated = [];
    var now = new Date();
    var dateStr = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0");

    v1Data.forEach(function (d, idx) {
      var isChannel = !!d.channel_id;

      /* 단가 보정: manual_amount 인 경우 역산 */
      var qty       = n(d.qty);
      var unitPrice = n(d.unit_price);
      var supplyAmt = n(d.supply_amount);
      if (d.manual_amount && qty > 0 && supplyAmt > 0) {
        unitPrice = Math.round(supplyAmt / qty);
      }

      var trade = {
        id:                    "T" + dateStr + "-M" + String(idx + 1).padStart(3, "0"),
        partner_id:            d.partner_id || null,
        partner_name_snapshot: d.partner_name_snapshot || "",
        channel_id:            d.channel_id || null,
        trade_type:            isChannel ? "channel" : "direct",
        deal_owner:            d.deal_owner || "mine",
        deal_status:           d.deal_status || "active",

        items: [{
          seq:           1,
          item_id:       d.item_id || null,
          name:          d.item_name || "",
          qty:           qty,
          unit_price:    unitPrice,
          supply_amount: supplyAmt,
          cost:          (d.purchase_cost != null && d.purchase_cost !== "") ? n(d.purchase_cost) : null,
          memo:          ""
        }],

        extra_costs:     [],   /* v2.8: 마이그레이션 시 부대비용 없음 */
        tracking_number: "",   /* v2.8: 마이그레이션 시 운송장 없음 */

        /* 마이그레이션 비율 — 기존 계산 결과 보존을 위해 조정 */
        rates: {
          save_rate:   0,    /* 기존에 SAVE 개념 없었으므로 0 */
          rebate_rate: isChannel ? n(d.rebate_rate, 30) : 30,
          S_rate:      0,    /* 기존에 S 배분 없었으므로 0 */
          my_rate:     100   /* 전액 내 몫으로 설정 */
        },

        /* v3.14: payout_fee 폐기 */
        settlement: {
          actual_S_amount: isChannel ? 0 : n(d.fee),
          memo:            ""
        },

        /* v2.9c: 장부 기준일 — v1의 quote_at 또는 created_at에서 파생 */
        deal_date:        (d.quote_at || d.created_at || "").substring(0, 10) || null,
        date_inferred:    true,   /* 마이그레이션 자동 추정 */

        quote_at:         d.quote_at || null,
        order_at:         d.order_at || null,
        delivery_note_at: d.delivery_note_at || null,
        invoice_at:       d.invoice_at || null,
        payment_at:       d.payment_at || null,
        timeline:         d.timeline || [],
        source:           "migrated",
        migrated_from:    d.deal_id || null,
        memo:             d.memo || "",
        created_at:       d.created_at || now.toISOString(),
        updated_at:       now.toISOString()
      };

      trade.status      = _calcStatus(trade);
      trade.deal_status = _calcDealStatus(trade);
      migrated.push(trade);
    });

    /* v2에 저장 (v1은 절대 수정하지 않음) */
    _save(migrated);
    emitAudit("MIGRATE_V1_TO_V2", { count: migrated.length });
    console.log("[TRADE ENGINE] v1→v2 마이그레이션 " + migrated.length + "건 완료");

    return { migrated: migrated.length };
  }

  /* ══════════════════════════════════════
     v2.7 → v2.8a 필드 보강 (기존 v2 레코드 업그레이드)
     ══════════════════════════════════════ */

  function _upgradeV2Records() {
    var all = loadAll();
    if (all.length === 0) return;
    var changed = false;
    all.forEach(function (t) {
      /* v2.7 → v2.8 필드 보강 */
      if (!t.extra_costs) { t.extra_costs = []; changed = true; }
      if (t.tracking_number === undefined) { t.tracking_number = ""; changed = true; }
      /* v2.8 → v2.8a: extra_costs 에 affects_profit 기본값 추가 */
      (t.extra_costs || []).forEach(function (ec) {
        if (ec.affects_profit === undefined) { ec.affects_profit = true; changed = true; }
      });
      /* v2.9c: deal_date (장부 기준일) 보강 — 기존 데이터는 quote_at → created_at fallback */
      if (!t.deal_date) {
        t.deal_date = t.quote_at
          ? t.quote_at.substring(0, 10)
          : (t.created_at ? t.created_at.substring(0, 10) : null);
        t.date_inferred = true;   /* 자동 추정됨 — 사용자 확인 필요 */
        changed = true;
      }
      /* v2.9c: date_inferred 필드 보강 (deal_date는 있지만 date_inferred 누락 시) */
      if (t.deal_date && t.date_inferred === undefined) {
        t.date_inferred = true;   /* 수동 확인 전까지 추정 상태 */
        changed = true;
      }
    });
    if (changed) {
      _save(all);
      emitAudit("UPGRADE_V2_FIELDS", { count: all.length });
      console.log("[TRADE ENGINE] v2 필드 보강 완료 (" + all.length + "건)");
    }
  }

  /* ══════════════════════════════════════
     v5: channel_name_snapshot 일회성 보정
     — channel_id 있고 channel_name_snapshot 비어있는 건만 대상
     — GoLabChannelMaster에서 이름 조회해서 채움
     ══════════════════════════════════════ */

  function backfillChannelSnapshot() {
    if (typeof GoLabChannelMaster === "undefined") return { total: 0, filled: 0 };
    var all = loadAll();
    var total = 0;   // 보정 대상 건수
    var filled = 0;  // 실제 채운 건수
    var changed = false;

    all.forEach(function (t) {
      if (!t.channel_id) return;                           // 관리업체 없는 거래 — 스킵
      if (t.channel_name_snapshot && t.channel_name_snapshot.trim()) return;  // 이미 값 있음 — 스킵

      total++;
      var ch = GoLabChannelMaster.getById(t.channel_id);
      if (ch && ch.name) {
        t.channel_name_snapshot = ch.name.trim();
        filled++;
        changed = true;
      }
    });

    if (changed) {
      _save(all);
      emitAudit("BACKFILL_CHANNEL_SNAPSHOT", { total: total, filled: filled });
      console.log("[TRADE ENGINE] v5 channel_name_snapshot 보정: 대상 " + total + "건, 채움 " + filled + "건");
    }

    return { total: total, filled: filled };
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
    TRADE_KEY:        TRADE_KEY,
    AUDIT_KEY:        AUDIT_KEY,
    V1_KEY:           V1_KEY,
    STATUS:           STATUS,
    DEAL_STATUS:      DEAL_STATUS,
    DEAL_OWNER:       DEAL_OWNER,
    EXTRA_COST_TYPES: EXTRA_COST_TYPES,   /* v2.8 */
    STEPS:            STEPS,
    STEP_MAP:         STEP_MAP,
    n:               n,
    fmt:             fmt,
    calcTrade:       calcTrade,
    calcPaymentStatus: calcPaymentStatus,   /* v3.9 신규 */
    classifyTrade:   classifyTrade,   /* v3.0 신규 */
    loadAll:         loadAll,
    getById:         getById,
    create:          create,
    update:          update,
    remove:          remove,
    stampStep:       stampStep,
    unstampStep:     unstampStep,
    getKPISummary:   getKPISummary,
    getScorecard:    getScorecard,
    getComparison:   getComparison,
    migrateFromV1:   migrateFromV1,
    backfillChannelSnapshot: backfillChannelSnapshot,   /* v5 신규 */
    emitAudit:       emitAudit,
    currentStepIndex: _currentStepIndex,
    itemDisplayName: _itemDisplayName
  };

})();

/* 최초 로드 시 자동 마이그레이션 (v1 → v2, 멱등) */
GoLabTradeEngine.migrateFromV1();

/* v2→v2.8a 필드 보강 (extra_costs, tracking_number, affects_profit) */
(function () {
  var all = GoLabTradeEngine.loadAll();
  if (all.length === 0) return;
  var changed = false;
  all.forEach(function (t) {
    if (!t.extra_costs) { t.extra_costs = []; changed = true; }
    if (t.tracking_number === undefined) { t.tracking_number = ""; changed = true; }
    /* v2.8a: extra_costs 에 affects_profit 기본값 보강 */
    (t.extra_costs || []).forEach(function (ec) {
      if (ec.affects_profit === undefined) { ec.affects_profit = true; changed = true; }
    });
  });
  if (changed) {
    localStorage.setItem(GoLabTradeEngine.TRADE_KEY, JSON.stringify(all));
    GoLabTradeEngine.emitAudit("UPGRADE_V2_TO_V28A", { count: all.length });
    console.log("[TRADE ENGINE] v2→v2.8a 필드 보강 완료 (" + all.length + "건)");
  }
})();

/* v3.9: paid_supply / paid_vat 필드 보정 (기존 데이터 호환) */
(function () {
  var TE = GoLabTradeEngine;
  var all = TE.loadAll();
  if (all.length === 0) return;
  var changed = false;
  all.forEach(function (t) {
    /* 이미 두 필드 모두 존재하면 절대 덮어쓰지 않는다 (멱등) */
    var hasSupply = (t.paid_supply !== undefined && t.paid_supply !== null);
    var hasVat    = (t.paid_vat !== undefined && t.paid_vat !== null);
    if (hasSupply && hasVat) return;

    if (t.payment_at) {
      /* 기존 완납 거래: calcTrade 기준 전액 입금 처리 */
      var c = TE.calcTrade(t);
      t.paid_supply = c.total_supply;
      t.paid_vat = c.vat_amount;
    } else {
      /* 미완료 거래: 0으로 초기화 */
      t.paid_supply = 0;
      t.paid_vat = 0;
    }
    changed = true;
  });
  if (changed) {
    localStorage.setItem(TE.TRADE_KEY, JSON.stringify(all));
    TE.emitAudit("UPGRADE_PAID_FIELDS", { count: all.length });
    console.log("[TRADE ENGINE] v3.9 paid_supply/paid_vat 보정 완료 (" + all.length + "건)");
  }
})();
