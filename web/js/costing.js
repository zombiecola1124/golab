/**
 * GoLab v1.6.1 — 공통 원가/재고 함수
 * Single Source of Truth: 이동평균, 품목 매칭, 음수 방지
 *
 * 사용법: <script src="js/costing.js"></script>
 *         GoLabCosting.calcMovingAverageUnitCost(...)
 *
 * 반올림 규칙: KRW 기준 Math.round() 고정
 * - 이 파일 외부에서 반올림하지 않음
 * - 이 함수가 반환하는 newAvgCost는 이미 Math.round() 적용됨
 */
window.GoLabCosting = (function () {
  "use strict";

  /**
   * 이동평균 단가 계산
   * 기존수량/기존평균 + 신규수량/신규단가 → 새 평균단가
   * - 재고가 0일 때는 신규단가를 평균으로 채택
   * - 반올림 규칙: Math.round (KRW 기준, 1원 단위)
   *
   * @param {number} prevQty     기존 재고 수량
   * @param {number} prevAvgCost 기존 이동평균 단가
   * @param {number} inQty       입고 수량
   * @param {number} inUnitCost  입고 단가
   * @returns {{ newQty: number, newAvgCost: number }}
   */
  function calcMovingAverageUnitCost(prevQty, prevAvgCost, inQty, inUnitCost) {
    var pQty  = Number(prevQty || 0);
    var pAvg  = Number(prevAvgCost || 0);
    var iQty  = Number(inQty || 0);
    var iCost = Number(inUnitCost || 0);

    // 입고 수량 없으면 변동 없음
    if (iQty <= 0) return { newQty: pQty, newAvgCost: Math.round(pAvg) };
    // 기존 재고 없으면 신규 단가 채택
    if (pQty <= 0) return { newQty: iQty, newAvgCost: Math.round(iCost) };

    var prevValue = pQty * pAvg;
    var inValue   = iQty * iCost;
    var newQty    = pQty + iQty;
    var newAvgCost = (prevValue + inValue) / newQty;

    return { newQty: newQty, newAvgCost: Math.round(newAvgCost) };
  }

  /**
   * 품목 매칭 가드
   * - 기존 코드가 있으면 UPDATE_EXISTING
   * - 없으면 REQUEST_CREATE (사용자 승인 필요)
   * - 빈 코드면 EMPTY_CODE (에러)
   *
   * @param {Set<string>} existingItemCodesSet 기존 등록된 품목코드 Set
   * @param {string}      importCode           import 대상 품목코드
   * @returns {{ ok: boolean, action?: string, code?: string, reason?: string }}
   */
  function matchOrRequestCreateItem(existingItemCodesSet, importCode) {
    var code = String(importCode || "").trim();
    if (!code) return { ok: false, reason: "EMPTY_CODE" };

    var exists = existingItemCodesSet.has(code);
    if (exists) return { ok: true, action: "UPDATE_EXISTING", code: code };

    return { ok: true, action: "REQUEST_CREATE", code: code };
  }

  /**
   * 음수 재고 방지 가드
   * - 출고 수량이 현재 재고보다 크면 차단
   *
   * @param {number} currentQty 현재 재고 수량
   * @param {number} outQty     출고(차감) 수량
   * @returns {{ ok: boolean, reason?: string, currentQty?: number, outQty?: number }}
   */
  function assertSufficientStock(currentQty, outQty) {
    var c = Number(currentQty || 0);
    var o = Number(outQty || 0);
    if (o <= 0) return { ok: true };
    if (c < o) return { ok: false, reason: "INSUFFICIENT_STOCK", currentQty: c, outQty: o };
    return { ok: true };
  }

  // 공개 API
  return {
    calcMovingAverageUnitCost: calcMovingAverageUnitCost,
    matchOrRequestCreateItem: matchOrRequestCreateItem,
    assertSufficientStock: assertSufficientStock
  };
})();
