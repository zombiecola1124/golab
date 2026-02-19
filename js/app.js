/**
 * app.js — 앱 초기화, 인증 흐름, 공통 유틸
 * 각 페이지(index.html, purchases.html)에서 import하여 사용
 */

import {
  initDB, checkAuth, signInWithGoogle, signOutUser,
  getCurrentUser, checkAllowedUser, ensureAdminUser,
  getAdminEmail
} from './db.js';

/**
 * 앱 초기화 — 인증 완료 후 resolve
 * @returns {Promise<void>}
 */
export async function initApp() {
  console.log('[APP] GOLAB ERP-lite 시작...');

  // Firebase 초기화
  await initDB();

  // 인증 흐름
  await handleAuth();

  // 현재 페이지에 맞는 탭 활성화
  highlightCurrentTab();

  console.log('[APP] 초기화 완료');
}

/**
 * 인증 흐름 처리
 * 1. 이미 로그인 → 허용 여부 확인
 * 2. 미로그인 → 로그인 버튼 대기
 */
async function handleAuth() {
  const overlay = document.getElementById('auth-overlay');
  const loginBtn = document.getElementById('btn-google-login');
  const denied = document.getElementById('auth-denied');
  const retryBtn = document.getElementById('btn-auth-retry');
  const loading = document.getElementById('auth-loading');

  if (!overlay) return; // 오버레이 없으면 스킵 (데모)

  // 이미 로그인된 세션 확인
  const existingUser = await checkAuth();
  if (existingUser) {
    loading.style.display = 'flex';
    loginBtn.style.display = 'none';
    const allowed = await verifyAccess(existingUser);
    if (allowed) {
      showApp(overlay, existingUser);
      return;
    } else {
      loading.style.display = 'none';
      loginBtn.style.display = 'none';
      denied.style.display = 'block';
    }
  }

  // 로그인 버튼 클릭
  return new Promise((resolve) => {
    loginBtn.addEventListener('click', async () => {
      try {
        loginBtn.style.display = 'none';
        denied.style.display = 'none';
        loading.style.display = 'flex';

        const user = await signInWithGoogle();
        const allowed = await verifyAccess(user);

        if (allowed) {
          showApp(overlay, user);
          resolve();
        } else {
          loading.style.display = 'none';
          denied.style.display = 'block';
        }
      } catch (err) {
        console.error('[AUTH] 로그인 실패:', err);
        loading.style.display = 'none';
        loginBtn.style.display = 'inline-flex';
      }
    });

    // "다른 계정으로 로그인" 버튼
    if (retryBtn) {
      retryBtn.addEventListener('click', async () => {
        await signOutUser();
        denied.style.display = 'none';
        loginBtn.style.display = 'inline-flex';
      });
    }

    // 이미 인증 통과한 경우
    if (existingUser && overlay.classList.contains('hidden')) {
      resolve();
    }
  });
}

/**
 * 접근 권한 확인 (allowed_users 체크)
 * 관리자 이메일이면 자동으로 admin 등록
 */
async function verifyAccess(user) {
  if (!user || !user.email) return false;

  // 관리자 이메일이면 자동 등록
  if (user.email === getAdminEmail()) {
    await ensureAdminUser(user);
    return true;
  }

  // 허용 목록 확인
  const allowed = await checkAllowedUser(user.email);
  return !!allowed;
}

/**
 * 인증 완료 → 앱 표시
 */
function showApp(overlay, user) {
  overlay.classList.add('hidden');

  // 네비 바 사용자 정보 표시
  const userInfo = document.getElementById('user-info');
  const userEmail = document.getElementById('user-email');
  const logoutBtn = document.getElementById('btn-logout');

  if (userInfo && userEmail) {
    userEmail.textContent = user.displayName || user.email;
    userInfo.style.display = 'flex';
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await signOutUser();
      window.location.reload();
    });
  }
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
