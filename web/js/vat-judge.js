/**
 * GoLab v7.8 — VAT 연체 정밀 판정 표준 모듈
 *
 * 룰:
 *   거래의 invoice_at 으로부터 14일 초과
 *   AND  paid_vat < calcTrade(trade).vat_amount
 *
 * 절대 원칙:
 *   1. trade-engine.js 절대 미터치 — 결과값(calcTrade)만 참조
 *   2. trade.vat_amount 직접 참조 금지 — 반드시 calc.vat_amount
 *   3. 깔때기 구조로 calcTrade 호출 최소화
 *
 * 깔때기 (필터링 → 통과한 건만 엔진 호출):
 *   1) trade.deal_status === "cancelled"    → false (즉시)
 *   2) trade.payment_at 존재                  → false (즉시 — 완납)
 *   3) trade.invoice_at 없음                  → false (판정 대상 아님)
 *   4) (오늘 - invoice_at) > 14일             → 통과한 것만 calcTrade 호출
 *      paid_vat < calc.vat_amount             → true
 */
window.GoLabVatJudge = (function () {
  "use strict";

  /** 연체 기준일수 — 한 곳에서만 정의 */
  var OVERDUE_DAYS = 14;

  var DAY_MS = 24 * 60 * 60 * 1000;

  /* ══════════════════════════════════════
     내부 헬퍼
     ══════════════════════════════════════ */

  /** ISO 날짜(YYYY-MM-DD 또는 ISO datetime) → 자정 기준 Date */
  function _toDay(iso) {
    if (!iso) return null;
    var s = String(iso).substring(0, 10);
    var d = new Date(s + "T00:00:00");
    return isNaN(d.getTime()) ? null : d;
  }

  /** 두 날짜 사이 일수 차 (ref - base) — 양수면 base가 더 과거 */
  function _daysBetween(baseISO, ref) {
    var base = _toDay(baseISO);
    if (!base) return null;
    var refDay = ref ? new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()) : (function(){
      var n = new Date();
      return new Date(n.getFullYear(), n.getMonth(), n.getDate());
    })();
    return Math.floor((refDay.getTime() - base.getTime()) / DAY_MS);
  }

  /* ══════════════════════════════════════
     Public API
     ══════════════════════════════════════ */

  /**
   * VAT 연체 판정
   * @param {object} trade
   * @param {object} [opts]
   *   - today: Date — 기준일 (테스트/배치용 주입)
   *   - calc:  object — calcTrade 결과 미리 계산했으면 재사용 (중복 호출 방지)
   * @returns {boolean}
   */
  function isVatOverdue(trade, opts) {
    if (!trade) return false;

    /* 1) cancelled → 즉시 제외 */
    if (trade.deal_status === "cancelled") return false;

    /* 2) payment_at 존재 → 즉시 제외 (완납) */
    if (trade.payment_at) return false;

    /* 3) invoice_at 없음 → VAT 판정 대상 제외 */
    if (!trade.invoice_at) return false;

    /* 4) 14일 초과 검사 (엔진 호출 전 깔때기 마지막 단계) */
    var today = (opts && opts.today) || null;
    var days = _daysBetween(trade.invoice_at, today);
    if (days === null || days <= OVERDUE_DAYS) return false;

    /* ── 여기까지 통과한 건만 calcTrade 호출 ── */
    var calc = (opts && opts.calc) || (window.GoLabTradeEngine && GoLabTradeEngine.calcTrade(trade));
    if (!calc) return false;

    var paidVat = Number(trade.paid_vat) || 0;
    var vatAmount = Number(calc.vat_amount) || 0;
    return paidVat < vatAmount;
  }

  /**
   * VAT 연체 미수액
   * @returns {number} max(0, calc.vat_amount - paid_vat). 연체 아니면 0.
   */
  function overdueAmount(trade, opts) {
    if (!isVatOverdue(trade, opts)) return 0;
    var calc = (opts && opts.calc) || GoLabTradeEngine.calcTrade(trade);
    var paidVat = Number(trade.paid_vat) || 0;
    var vatAmount = Number(calc.vat_amount) || 0;
    return Math.max(0, vatAmount - paidVat);
  }

  /**
   * invoice_at 기준 경과 일수 (배지/툴팁용)
   * @returns {number|null}
   */
  function daysSinceInvoice(trade, today) {
    if (!trade || !trade.invoice_at) return null;
    return _daysBetween(trade.invoice_at, today || null);
  }

  /* ══════════════════════════════════════ */

  console.log("[VatJudge] 초기화 완료 — 기준: invoice_at + " + OVERDUE_DAYS + "일 초과");

  return {
    isVatOverdue:     isVatOverdue,
    overdueAmount:    overdueAmount,
    daysSinceInvoice: daysSinceInvoice,
    OVERDUE_DAYS:     OVERDUE_DAYS
  };
})();
