/**
 * app.js — 앱 초기화, 공통 유틸
 * 각 페이지(index.html, purchases.html)에서 import하여 사용
 */

import { initDB } from './db.js';

/**
 * 앱 초기화
 * @returns {Promise<void>}
 */
export async function initApp() {
  console.log('[APP] GOLAB ERP-lite 시작...');

  // Firebase 초기화 (config 없으면 데모 모드)
  await initDB();

  // 현재 페이지에 맞는 탭 활성화
  highlightCurrentTab();

  console.log('[APP] 초기화 완료');
}

/**
 * 상단 탭에서 현재 페이지를 active 표시
 */
function highlightCurrentTab() {
  const path = window.location.pathname;
  document.querySelectorAll('.top-nav .tabs a').forEach(a => {
    a.classList.remove('active');
    const href = a.getAttribute('href');
    if (path.endsWith(href) || (href === 'index.html' && (path.endsWith('/') || path.endsWith('/index.html')))) {
      a.classList.add('active');
    }
  });
}

/**
 * 이동평균법으로 평균원가 계산
 * @param {number} existingQty - 기존 수량
 * @param {number} existingAvgCost - 기존 평균원가
 * @param {number} newQty - 신규 수량
 * @param {number} newTotalCost - 신규 총원가 (공급가 합계)
 * @returns {number} 새 평균원가
 */
export function calcWeightedAvgCost(existingQty, existingAvgCost, newQty, newTotalCost) {
  const totalQty = existingQty + newQty;
  if (totalQty <= 0) return 0;
  return ((existingQty * existingAvgCost) + newTotalCost) / totalQty;
}

/**
 * 재고 상태 자동 평가
 * @param {number} qtyOnHand - 현재수량
 * @param {number} qtyMin - 최소수량
 * @param {string} currentStatus - 현재 상태
 * @returns {string} 새 상태
 */
export function evaluateStatus(qtyOnHand, qtyMin, currentStatus) {
  // RESERVED는 수동 변경만 가능 (자동 평가 대상 아님)
  if (currentStatus === 'RESERVED') return 'RESERVED';

  if (qtyOnHand <= 0) return 'OUT';
  if (qtyOnHand < qtyMin) return 'RISK';
  return 'NORMAL';
}
