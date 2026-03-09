/**
 * GoLab v2.9 — Trade Engine (거래정산 엔진)
 *
 * 3유형 거래 계산:
 *   ① 내 거래 (mine):    순이익 = 매출 - 비용 - 부대비용 (배분 없음)
 *   ② 대성 거래 (daesung): SAVE → 배분대상 → S/나 배분
 *   ③ 관리업체 거래 (channel): 수수료 → 정산대상 → S/나 배분
 *
 * 핵심:
 *   - 거래순이익(gross_profit) = 매출 - 비용 - 부대비용 (3유형 공통)
 *   - 모든 비율은 거래별 입력값 (상수 아님)
 *   - channel: rebate(매출% 기반) → commission(순이익% 기반) 모델 변경
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

  /* 거래 유형 3분류 (v2.9) */
  var TRADE_TYPE = {
    MINE:    "mine",      /* 내 거래: 배분 없음 */
    DAESUNG: "daesung",   /* 대성 거래: SAVE + S/나 배분 */
    CHANNEL: "channel"    /* 관리업체 거래: 수수료 + S/나 배분 */
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
   * 거래 수익 계산 — v2.9 3유형 엔진 (순수 함수, 저장 안 함)
   *
   * 공통:  거래순이익 = 매출 - 비용 - 부대비용
   * mine:     내 순익 = 거래순이익 (배분 없음)
   * daesung:  SAVE → 배분대상 → S/나 배분
   * channel:  수수료 → 정산대상 → S/나 배분
   *
   * @param {Object} trade — 거래 객체 (또는 폼에서 조립한 임시 객체)
   * @returns {Object} 계산 결과 (저장하지 않음)
   */
  function calcTrade(trade) {
    var items  = trade.items || [];
    var rates  = trade.rates || {};
    var tt     = trade.trade_type || TRADE_TYPE.MINE;

    /* ── 품목 합계 ── */
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

    /* total_supply 오버라이드 (폼에서 직접 매출액 입력한 경우) */
    if (trade.total_supply != null && n(trade.total_supply) > 0 && items.length === 0) {
      total_supply = n(trade.total_supply);
    }

    /* ── 부대비용 합산 (affects_profit 필터링) ── */
    var extra_cost_total = 0;
    var extra_costs = trade.extra_costs || [];
    extra_costs.forEach(function (ec) {
      if (ec.affects_profit !== false) {
        extra_cost_total += n(ec.amount);
      }
    });
    if (extra_costs.length > 0 && extra_cost_total > 0) hasCost = true;

    /* ── 거래순이익 = 매출 - 비용 - 부대비용 (3유형 공통) ── */
    var gross_profit = total_supply - item_cost_total - extra_cost_total;

    var result = {
      total_supply:     total_supply,
      item_cost_total:  item_cost_total,
      extra_cost_total: extra_cost_total,
      total_cost:       item_cost_total + extra_cost_total,
      has_cost:         hasCost,
      gross_profit:     gross_profit,       /* 3유형 공통 */
      vat_amount:       Math.round(total_supply * 0.1),
      total_amount:     total_supply + Math.round(total_supply * 0.1)
    };

    if (tt === TRADE_TYPE.CHANNEL) {
      /* ── ③ 관리업체 거래: 수수료(순이익% 기반) → 정산대상 → S/나 배분 ── */
      result.commission_amount = Math.round(gross_profit * n(rates.commission_rate) / 100);
      result.distributable     = gross_profit - result.commission_amount;
      result.s_share           = Math.round(result.distributable * n(rates.S_rate) / 100);
      result.final_my_amount   = Math.round(result.distributable * n(rates.my_rate) / 100);
    } else if (tt === TRADE_TYPE.DAESUNG) {
      /* ── ② 대성 거래: SAVE → 배분대상 → S/나 배분 ── */
      result.save_amount       = Math.round(gross_profit * n(rates.save_rate) / 100);
      result.distributable     = gross_profit - result.save_amount;
      result.s_share           = Math.round(result.distributable * n(rates.S_rate) / 100);
      result.final_my_amount   = Math.round(result.distributable * n(rates.my_rate) / 100);
    } else {
      /* ── ① 내 거래 (mine): 배분 없음, 순이익 = 내 몫 ── */
      result.save_amount       = 0;
      result.commission_amount = 0;
      result.distributable     = 0;
      result.s_share           = 0;
      result.final_my_amount   = gross_profit;
    }

    return result;
  }

  /* ══════════════════════════════════════
     비율 기본값 빌더 (v2.9)
     ══════════════════════════════════════ */

  /** 유형별 rates 기본값 생성 */
  function _buildRates(tradeType, inputRates) {
    var r = inputRates || {};
    if (tradeType === TRADE_TYPE.DAESUNG) {
      return {
        save_rate: n(r.save_rate, 30),
        S_rate:    n(r.S_rate, 60),
        my_rate:   n(r.my_rate, 40)
      };
    }
    if (tradeType === TRADE_TYPE.CHANNEL) {
      return {
        commission_rate: n(r.commission_rate, 30),
        S_rate:          n(r.S_rate, 60),
        my_rate:         n(r.my_rate, 40)
      };
    }
    /* mine: 비율 없음 */
    return {};
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

  /** 거래 생성 */
  function create(fields) {
    if (!fields.partner_id) throw new Error("거래처를 선택해주세요.");
    if (!fields.items || fields.items.length === 0) throw new Error("품목을 1개 이상 추가해주세요.");

    var all = loadAll();

    var trade = {
      id:                    generateId(all),
      partner_id:            fields.partner_id,
      partner_name_snapshot: (fields.partner_name_snapshot || "").trim(),
      channel_id:            fields.channel_id || null,
      channel_name:          (fields.channel_name || "").trim(),
      trade_type:            fields.trade_type || TRADE_TYPE.MINE,
      deal_owner:            fields.deal_owner || DEAL_OWNER.MINE,
      deal_status:           DEAL_STATUS.ACTIVE,

      /* 품목 배열 */
      items: (fields.items || []).map(function (item, i) {
        return {
          seq:           i + 1,
          item_id:       item.item_id || null,
          name:          (item.name || "").trim(),
          qty:           n(item.qty),
          unit_price:    n(item.unit_price),
          supply_amount: Math.round(n(item.qty) * n(item.unit_price)),
          cost:          (item.cost != null && item.cost !== "") ? n(item.cost) : null,
          memo:          (item.memo || "").trim()
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

      /* 운송장 번호 (v2.8) */
      tracking_number: (fields.tracking_number || "").trim(),

      /* 비율 — 거래별 입력값 (v2.9: 유형별 분리) */
      rates: _buildRates(fields.trade_type || TRADE_TYPE.MINE, fields.rates),

      /* 정산 — 실제 확정값 (v2.9: payout_fee 제거) */
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
    if (fields.channel_id            !== undefined) d.channel_id = fields.channel_id || null;
    if (fields.channel_name          !== undefined) d.channel_name = (fields.channel_name || "").trim();
    if (fields.trade_type            !== undefined) d.trade_type = fields.trade_type;
    if (fields.deal_owner  !== undefined) d.deal_owner  = fields.deal_owner;
    if (fields.deal_status !== undefined) d.deal_status = fields.deal_status;
    if (fields.memo        !== undefined) d.memo        = fields.memo.trim();

    /* 품목 배열 교체 */
    if (fields.items !== undefined) {
      d.items = (fields.items || []).map(function (item, i) {
        return {
          seq:           i + 1,
          item_id:       item.item_id || null,
          name:          (item.name || "").trim(),
          qty:           n(item.qty),
          unit_price:    n(item.unit_price),
          supply_amount: Math.round(n(item.qty) * n(item.unit_price)),
          cost:          (item.cost != null && item.cost !== "") ? n(item.cost) : null,
          memo:          (item.memo || "").trim()
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

    /* 운송장 번호 (v2.8) */
    if (fields.tracking_number !== undefined) {
      d.tracking_number = (fields.tracking_number || "").trim();
    }

    /* 비율 (v2.9: 유형별 분리) */
    if (fields.rates !== undefined) {
      d.rates = _buildRates(d.trade_type || TRADE_TYPE.MINE, fields.rates);
    }

    /* 정산 (v2.9: payout_fee 제거) */
    if (fields.settlement !== undefined) {
      d.settlement = {
        actual_S_amount: n(fields.settlement.actual_S_amount, d.settlement ? d.settlement.actual_S_amount : 0),
        memo:            fields.settlement.memo !== undefined
          ? fields.settlement.memo.trim()
          : (d.settlement ? d.settlement.memo : "")
      };
    }

    /* 날짜 필드 */
    if (fields.quote_at         !== undefined) d.quote_at         = fields.quote_at || null;
    if (fields.order_at         !== undefined) d.order_at         = fields.order_at || null;
    if (fields.delivery_note_at !== undefined) d.delivery_note_at = fields.delivery_note_at || null;
    if (fields.invoice_at       !== undefined) d.invoice_at       = fields.invoice_at || null;
    if (fields.payment_at       !== undefined) d.payment_at       = fields.payment_at || null;

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
    var mineCount = 0, friendCount = 0;
    var totalAmount = 0, mineTotalAmount = 0, friendTotalAmount = 0;
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
      if (t.deal_owner === DEAL_OWNER.FRIEND) {
        friendCount++;
        friendTotalAmount += amt;
      } else {
        mineCount++;
        mineTotalAmount += amt;
      }

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
        var startDate = t.quote_at || t.created_at || "";
        if (startDate && startDate.substring(0, 10) <= thirtyDaysAgo) {
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
      mineCount: mineCount,
      friendCount: friendCount,
      totalAmount: totalAmount,
      mineTotalAmount: mineTotalAmount,
      friendTotalAmount: friendTotalAmount,
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
    var mineRevenue = 0, mineCost = 0;
    var receivableAmount = 0;
    var dealCount = 0, paidCount = 0, receivableCount = 0;
    var deals = [];

    /* v2.9: 유형별 집계 */
    var byType = {
      mine:    { count: 0, revenue: 0, profit: 0 },
      daesung: { count: 0, revenue: 0, profit: 0 },
      channel: { count: 0, revenue: 0, profit: 0 }
    };

    all.forEach(function (t) {
      if (t.deal_status === DEAL_STATUS.CANCELLED) return;

      var dt = (t.quote_at || t.created_at || "").substring(0, 10);
      if (!dt || dt < fromDate || dt > toDate) return;

      var calc = calcTrade(t);
      var amt = calc.total_supply;
      var tt = t.trade_type || TRADE_TYPE.MINE;

      totalRevenue += amt;
      dealCount++;

      /* 편의 속성 붙이기 (profit.html 렌더링용) */
      t._calc = calc;
      t._display_name = _itemDisplayName(t);
      deals.push(t);

      if (t.payment_at) { paidRevenue += amt; paidCount++; }
      if (t.invoice_at && !t.payment_at) { receivableAmount += amt; receivableCount++; }

      /* 유형별 집계 */
      if (byType[tt]) {
        byType[tt].count++;
        byType[tt].revenue += amt;
        byType[tt].profit += calc.final_my_amount;
      }

      mineRevenue += amt;
      mineCost += calc.total_cost;
      myNetProfit += calc.final_my_amount;
    });

    return {
      totalRevenue: totalRevenue,
      paidRevenue: paidRevenue,
      myNetProfit: myNetProfit,
      mineRevenue: mineRevenue,
      mineCost: mineCost,
      receivableAmount: receivableAmount,
      dealCount: dealCount,
      paidCount: paidCount,
      receivableCount: receivableCount,
      byType: byType,
      deals: deals
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
      var tradeType = isChannel ? "channel" : "daesung"; /* v2.9: direct→daesung */

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
        trade_type:            tradeType,
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

        /* 마이그레이션 비율 — v2.9: 유형별 분리 */
        rates: isChannel ? {
          commission_rate: n(d.rebate_rate, 30),
          S_rate:          0,    /* 기존에 S 배분 없었으므로 0 */
          my_rate:         100   /* 전액 내 몫으로 설정 */
        } : {
          save_rate:   0,    /* 기존에 SAVE 개념 없었으므로 0 */
          S_rate:      0,    /* 기존에 S 배분 없었으므로 0 */
          my_rate:     100   /* 전액 내 몫으로 설정 */
        },

        settlement: {
          actual_S_amount: isChannel ? 0 : n(d.fee),
          memo:            ""
        },
        channel_name: "",

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
    });
    if (changed) {
      _save(all);
      emitAudit("UPGRADE_V2_TO_V28A", { count: all.length });
      console.log("[TRADE ENGINE] v2→v2.8a 필드 보강 완료 (" + all.length + "건)");
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
    TRADE_KEY:        TRADE_KEY,
    AUDIT_KEY:        AUDIT_KEY,
    V1_KEY:           V1_KEY,
    STATUS:           STATUS,
    DEAL_STATUS:      DEAL_STATUS,
    DEAL_OWNER:       DEAL_OWNER,
    TRADE_TYPE:       TRADE_TYPE,          /* v2.9 */
    EXTRA_COST_TYPES: EXTRA_COST_TYPES,
    STEPS:            STEPS,
    STEP_MAP:         STEP_MAP,
    n:               n,
    fmt:             fmt,
    calcTrade:       calcTrade,
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
    emitAudit:       emitAudit,
    currentStepIndex: _currentStepIndex,
    itemDisplayName: _itemDisplayName
  };

})();

/* 최초 로드 시 자동 마이그레이션 (v1 → v2, 멱등) */
GoLabTradeEngine.migrateFromV1();

/* v2.8a→v2.9 마이그레이션 (direct→daesung, rebate_rate→commission_rate, payout_fee 제거) */
(function () {
  var all = GoLabTradeEngine.loadAll();
  if (all.length === 0) return;
  var changed = false;
  all.forEach(function (t) {
    /* 필드 보강 (v2.8 호환) */
    if (!t.extra_costs) { t.extra_costs = []; changed = true; }
    if (t.tracking_number === undefined) { t.tracking_number = ""; changed = true; }
    (t.extra_costs || []).forEach(function (ec) {
      if (ec.affects_profit === undefined) { ec.affects_profit = true; changed = true; }
    });

    /* v2.9: direct → daesung */
    if (t.trade_type === "direct") {
      t.trade_type = "daesung";
      changed = true;
    }

    /* v2.9: channel — rebate_rate → commission_rate */
    if (t.trade_type === "channel" && t.rates) {
      if (t.rates.rebate_rate !== undefined && t.rates.commission_rate === undefined) {
        t.rates.commission_rate = t.rates.rebate_rate;
        delete t.rates.rebate_rate;
        changed = true;
      }
    }

    /* v2.9: settlement.payout_fee 제거 */
    if (t.settlement && t.settlement.payout_fee !== undefined) {
      delete t.settlement.payout_fee;
      changed = true;
    }

    /* v2.9: channel_name 기본값 */
    if (t.channel_name === undefined) { t.channel_name = ""; changed = true; }

    /* v2.9: mine 유형에 불필요한 rates 정리 */
    if (t.trade_type === "mine" && t.rates) {
      /* mine은 rates 없어도 됨, 기존값은 보존 */
    }
  });
  if (changed) {
    localStorage.setItem(GoLabTradeEngine.TRADE_KEY, JSON.stringify(all));
    GoLabTradeEngine.emitAudit("UPGRADE_V28A_TO_V29", { count: all.length });
    console.log("[TRADE ENGINE] v2.8a→v2.9 마이그레이션 완료 (" + all.length + "건)");
  }
})();
