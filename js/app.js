/**
 * app.js — 앱 초기화, 인증 흐름, 공통 유틸
 * 각 페이지(index.html, purchases.html)에서 import하여 사용
 */

import {
  initDB, checkAuth, signInWithEmail, signOutUser,
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
 * 2. 미로그인 → 로그인 폼 대기
 */
async function handleAuth() {
  const overlay = document.getElementById('auth-overlay');
  const loginForm = document.getElementById('auth-login-form');
  const loginBtn = document.getElementById('btn-login');
  const denied = document.getElementById('auth-denied');
  const retryBtn = document.getElementById('btn-auth-retry');
  const loading = document.getElementById('auth-loading');
  const errorMsg = document.getElementById('auth-error');

  if (!overlay) return; // 오버레이 없으면 스킵 (데모)

  // 이미 로그인된 세션 확인
  const existingUser = await checkAuth();
  if (existingUser) {
    const allowed = await verifyAccess(existingUser);
    if (allowed) {
      showApp(overlay, existingUser);
      return;
    } else {
      loading.style.display = 'none';
      denied.style.display = 'block';
    }
  } else {
    // 미로그인 → 로딩 숨기고 로그인 폼 표시
    loading.style.display = 'none';
    if (loginForm) loginForm.style.display = 'block';
  }

  // 로그인 폼 제출
  return new Promise((resolve) => {
    loginBtn.addEventListener('click', async () => {
      const emailInput = document.getElementById('auth-email');
      const pwInput = document.getElementById('auth-pw');
      const email = emailInput.value.trim();
      const pw = pwInput.value;

      if (!email || !pw) {
        showAuthError(errorMsg, '이메일과 비밀번호를 입력하세요');
        return;
      }

      try {
        loginForm.style.display = 'none';
        errorMsg.style.display = 'none';
        denied.style.display = 'none';
        loading.style.display = 'flex';

        const user = await signInWithEmail(email, pw);
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
        loginForm.style.display = 'block';

        if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
          showAuthError(errorMsg, '이메일 또는 비밀번호가 잘못되었습니다');
        } else if (err.code === 'auth/too-many-requests') {
          showAuthError(errorMsg, '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요');
        } else {
          showAuthError(errorMsg, '로그인 실패: ' + (err.message || err.code));
        }
      }
    });

    // Enter 키로 로그인
    const pwInput = document.getElementById('auth-pw');
    if (pwInput) {
      pwInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          loginBtn.click();
        }
      });
    }

    // "다른 계정으로 로그인" 버튼
    if (retryBtn) {
      retryBtn.addEventListener('click', async () => {
        await signOutUser();
        denied.style.display = 'none';
        loginForm.style.display = 'block';
      });
    }

    // 이미 인증 통과한 경우
    if (existingUser && overlay.classList.contains('hidden')) {
      resolve();
    }
  });
}

function showAuthError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
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
 */
export function calcWeightedAvgCost(existingQty, existingAvgCost, newQty, newTotalCost) {
  const totalQty = existingQty + newQty;
  if (totalQty <= 0) return 0;
  return ((existingQty * existingAvgCost) + newTotalCost) / totalQty;
}

/**
 * 재고 상태 자동 평가
 */
export function evaluateStatus(qtyOnHand, qtyMin, currentStatus) {
  if (currentStatus === 'RESERVED') return 'RESERVED';
  if (qtyOnHand <= 0) return 'OUT';
  if (qtyOnHand < qtyMin) return 'RISK';
  return 'NORMAL';
}
