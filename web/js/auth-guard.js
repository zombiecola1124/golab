/**
 * GoLab v5 — Auth Guard (로그인 게이트)
 *
 * 비로그인 상태에서 헤더/본문 노출 차단.
 * 기존 세션 복원 → 자동 로그인, 없으면 로그인 폼 표시.
 *
 * ── 초기화 순서 ──
 *   1. Firebase SDK CDN 로드
 *   2. firebase-config.js → _GoLabFirebase 전역 생성 + Firebase init + waitForAuth 호출
 *   3. storage-adapter.js → GoLabStorage 전역 생성 (모드 "local"|"sync")
 *   4. auth-guard.js (이 파일) → 인증 확인 → 오버레이 제어
 *   5. 페이지 고유 JS → 인증 완료 후 정상 실행
 *
 * ── auth-wall 렌더 제어 (D-2 flash 제거) ──
 *   - HTML 초기 상태: opacity:0 + visibility:hidden + pointer-events:none
 *   - 세션 있음 → wall 즉시 DOM 제거 (1프레임도 안 보임)
 *   - 세션 없음 → wall visible 전환 + 로그인 폼 표시
 *
 * ── 헤더 레이아웃 (D-2 탭 복구) ──
 *   - navbar.js 수정 없이, auth-guard.js에서 header-actions 래퍼 생성
 *   - 기존 nav.tabs를 래퍼 안으로 이동 → 2자식 구조 유지 (h1 + wrapper)
 *   - ui.css 전역 수정 없음 — 스타일은 이 파일에서 국소 주입
 *
 * 의존성: window._GoLabFirebase (firebase-config.js)
 * 수정 금지: firebase-config.js, trade-engine.js, 데이터 구조
 */
(function () {
  "use strict";

  /* ══════════════════════════════════════
     상수
     ══════════════════════════════════════ */
  var WALL_ID = "golab-auth-wall";
  var LOGOUT_ID = "golab-logout-btn";

  /* ══════════════════════════════════════
     오버레이 요소 확인
     ══════════════════════════════════════ */
  var wall = document.getElementById(WALL_ID);
  if (!wall) {
    /* 오버레이 div가 HTML에 없으면 auth-guard 비활성 (안전 fallback) */
    console.warn("[AuthGuard] #" + WALL_ID + " 없음 — 인증 게이트 비활성");
    return;
  }

  /* ══════════════════════════════════════
     스타일 주입 (로그인 폼 + 헤더 래퍼 + 로그아웃 버튼)
     ══════════════════════════════════════ */
  var styleEl = document.createElement("style");
  styleEl.textContent = [
    /* ── 로그인 카드 ── */
    ".auth-card{background:#fff;border-radius:16px;padding:40px 36px;width:360px;max-width:90vw;box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center}",
    ".auth-logo{font-size:28px;font-weight:900;color:#0f172a;letter-spacing:-.5px;margin-bottom:4px}",
    ".auth-sub{font-size:13px;color:#64748b;margin:0 0 24px}",
    ".auth-field{text-align:left;margin-bottom:14px}",
    ".auth-field label{display:block;font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px}",
    ".auth-field input{width:100%;border:1px solid #e5e7eb;border-radius:10px;padding:10px 14px;font-size:13px;outline:none;background:#f8fafc;color:#0f172a;transition:border-color .2s;box-sizing:border-box;font-family:inherit}",
    ".auth-field input:focus{border-color:#2563eb}",
    ".auth-btn{width:100%;padding:12px;border:none;border-radius:10px;background:#2563eb;color:#fff;font-size:14px;font-weight:700;cursor:pointer;transition:background .15s;margin-top:6px;font-family:inherit}",
    ".auth-btn:hover{background:#1d4ed8}",
    ".auth-btn:disabled{opacity:.6;cursor:not-allowed}",
    ".auth-msg{font-size:12px;min-height:20px;margin-bottom:12px;padding:0 4px}",
    ".auth-msg.error{color:#dc2626}",
    ".auth-msg.success{color:#16a34a}",
    ".auth-msg.info{color:#64748b}",
    ".auth-footer{font-size:11px;color:#94a3b8;margin:16px 0 0}",
    /* ── D-2: 헤더 래퍼 (nav.tabs + 로그아웃 버튼) ── */
    ".header-actions{display:flex;align-items:center;height:100%}",
    /* ── 헤더 로그아웃 버튼 ── */
    ".golab-logout-btn{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);color:rgba(255,255,255,.7);border-radius:6px;padding:5px 12px;font-size:11px;font-weight:600;cursor:pointer;transition:all .15s;flex-shrink:0;font-family:inherit;margin-left:12px}",
    ".golab-logout-btn:hover{background:rgba(255,255,255,.2);color:#fff}"
  ].join("\n");
  document.head.appendChild(styleEl);

  /* ══════════════════════════════════════
     로그인 폼 HTML 주입
     ══════════════════════════════════════ */
  wall.innerHTML = [
    '<div class="auth-card">',
    '  <div class="auth-logo">GoLab</div>',
    '  <p class="auth-sub">업무 관리 시스템</p>',
    '  <div id="auth-msg" class="auth-msg info">세션 확인 중…</div>',
    '  <div id="auth-fields" style="display:none">',
    '    <div class="auth-field">',
    '      <label for="auth-email">이메일</label>',
    '      <input id="auth-email" type="email" placeholder="email@example.com" autocomplete="email">',
    '    </div>',
    '    <div class="auth-field">',
    '      <label for="auth-pw">비밀번호</label>',
    '      <input id="auth-pw" type="password" placeholder="비밀번호" autocomplete="current-password">',
    '    </div>',
    '    <button id="auth-submit" class="auth-btn">로그인</button>',
    '    <p class="auth-footer">세션이 유지됩니다</p>',
    '  </div>',
    '</div>'
  ].join("\n");

  /* DOM 참조 */
  var msgEl     = document.getElementById("auth-msg");
  var fieldsEl  = document.getElementById("auth-fields");
  var emailEl   = document.getElementById("auth-email");
  var pwEl      = document.getElementById("auth-pw");
  var submitEl  = document.getElementById("auth-submit");

  /* ══════════════════════════════════════
     인증 확인 — _GoLabFirebase.waitForAuth()
     ══════════════════════════════════════ */
  if (typeof window._GoLabFirebase !== "undefined" && window._GoLabFirebase.waitForAuth) {
    window._GoLabFirebase.waitForAuth().then(function (uid) {
      if (uid) {
        /* ✅ 기존 세션 복원 성공 → 즉시 잠금 해제 + 백그라운드 동기화 */
        console.log("[AuthGuard] 세션 복원 — uid: " + uid);
        _unlock(false);

        /* sync 모드 활성화 (push가 동작하도록) */
        if (typeof window.GoLabStorage !== "undefined") {
          window.GoLabStorage.setMode("sync");

          /* 이번 탭 세션에서 이미 pull 했으면 건너뜀 (무한 reload 방지) */
          if (!sessionStorage.getItem("golab_pull_done")) {
            window.GoLabStorage.pullAll().then(function (results) {
              var changed = results.filter(function (r) { return r.changed; });
              console.log("[AuthGuard] 세션복원 pull 완료 — 변경 " + changed.length + "건");
              sessionStorage.setItem("golab_pull_done", Date.now().toString());
              /* Firebase에 더 최신 데이터가 있었으면 페이지 새로고침 */
              if (changed.length > 0) {
                console.log("[AuthGuard] 변경 감지 → 페이지 새로고침");
                location.reload();
              }
            }).catch(function (err) {
              console.warn("[AuthGuard] 세션복원 pull 실패: " + (err.message || err));
              sessionStorage.setItem("golab_pull_done", Date.now().toString());
            });
          }
        }
      } else {
        /* ❌ 세션 없음 → wall 가시화 + 로그인 폼 표시 */
        console.log("[AuthGuard] 세션 없음 — 로그인 필요");
        _showWall();
        _showForm();
      }
    });
  } else {
    /* Firebase SDK 미로드 → local 모드, 인증 없이 통과 */
    console.warn("[AuthGuard] _GoLabFirebase 미감지 — 인증 건너뜀 (local 모드)");
    _unlock(false);
  }

  /* ══════════════════════════════════════
     D-2: auth-wall 가시화 (세션 없을 때만 호출)
     ══════════════════════════════════════ */
  function _showWall() {
    wall.style.opacity = "1";
    wall.style.visibility = "visible";
    wall.style.pointerEvents = "auto";
  }

  /* ══════════════════════════════════════
     로그인 폼 표시
     ══════════════════════════════════════ */
  function _showForm() {
    msgEl.textContent = "";
    msgEl.className = "auth-msg";
    fieldsEl.style.display = "";
    emailEl.focus();
  }

  /* ══════════════════════════════════════
     로그인 실행
     ══════════════════════════════════════ */
  function _doLogin() {
    var email = emailEl.value.trim();
    var pw    = pwEl.value;

    if (!email || !pw) {
      msgEl.textContent = "이메일과 비밀번호를 입력하세요.";
      msgEl.className = "auth-msg error";
      return;
    }

    /* 버튼 비활성화 */
    submitEl.disabled = true;
    submitEl.textContent = "로그인 중…";
    msgEl.textContent = "";
    msgEl.className = "auth-msg";

    window._GoLabFirebase.signInWithEmail(email, pw).then(function (result) {
      if (result.uid) {
        /* ✅ 로그인 성공 → sync 모드 전환 + Firebase 데이터 다운로드 */
        msgEl.textContent = "데이터 동기화 중…";
        msgEl.className = "auth-msg info";

        if (typeof window.GoLabStorage !== "undefined") {
          window.GoLabStorage.setMode("sync");
          window.GoLabStorage.pullAll().then(function (results) {
            var pulled = results.filter(function (r) { return r.changed; });
            console.log("[AuthGuard] 로그인 pull 완료 — 변경 " + pulled.length + "건");
            /* pull 완료 플래그 → reload 후 세션복원 시 재pull 방지 */
            sessionStorage.setItem("golab_pull_done", Date.now().toString());
            msgEl.textContent = "로그인 성공";
            msgEl.className = "auth-msg success";
            /* 데이터 반영을 위해 페이지 새로고침 */
            setTimeout(function () { location.reload(); }, 300);
          }).catch(function () {
            /* pull 실패해도 로그인은 진행 */
            console.warn("[AuthGuard] pull 실패 — 로컬 데이터로 진행");
            sessionStorage.setItem("golab_pull_done", Date.now().toString());
            setTimeout(function () { _unlock(true); }, 300);
          });
        } else {
          /* GoLabStorage 미로드 시 기존 동작 */
          setTimeout(function () { _unlock(true); }, 300);
        }
      } else {
        /* ❌ 로그인 실패 */
        var errMsg = _translateError(result.error);
        msgEl.textContent = errMsg;
        msgEl.className = "auth-msg error";
        submitEl.disabled = false;
        submitEl.textContent = "로그인";
        pwEl.value = "";
        pwEl.focus();
      }
    });
  }

  /* ── 키보드 이벤트 ── */
  emailEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); pwEl.focus(); }
  });
  pwEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); _doLogin(); }
  });
  submitEl.addEventListener("click", _doLogin);

  /* ══════════════════════════════════════
     잠금 해제 (인증 성공 / local 모드)
     @param {boolean} animate — true: 페이드아웃 후 제거, false: 즉시 제거
     ══════════════════════════════════════ */
  function _unlock(animate) {
    if (wall && wall.parentNode) {
      if (animate) {
        /* 로그인 폼에서 성공 후 → 페이드아웃 */
        wall.style.opacity = "0";
        wall.style.pointerEvents = "none";
        setTimeout(function () {
          if (wall.parentNode) wall.parentNode.removeChild(wall);
        }, 300);
      } else {
        /* 세션 복원 / local 모드 → 즉시 제거 (1프레임도 안 보임) */
        wall.parentNode.removeChild(wall);
      }
    }
    /* 헤더에 로그아웃 버튼 추가 */
    _addLogoutButton();
  }

  /* ══════════════════════════════════════
     D-2: 헤더 로그아웃 버튼 (래퍼 구조)
     ──────────────────────────────────────
     navbar.js 수정 없이 header 내부를 재구조화:
       기존: <header> <h1/> <nav.tabs/> </header>
       변경: <header> <h1/> <div.header-actions> <nav.tabs/> <button/> </div> </header>
     → space-between 2자식 유지 → 탭 위치 원복
     ══════════════════════════════════════ */
  function _addLogoutButton() {
    var header = document.querySelector("header");
    if (!header || document.getElementById(LOGOUT_ID)) return;

    /* Firebase 인증 상태일 때만 버튼 표시 */
    if (typeof window._GoLabFirebase === "undefined" || !window._GoLabFirebase.getUid()) return;

    var nav = header.querySelector(".tabs");

    /* 래퍼 생성: nav.tabs + 로그아웃 버튼을 감싸는 우측 영역 */
    var wrapper = document.createElement("div");
    wrapper.className = "header-actions";

    if (nav) {
      /* nav.tabs를 래퍼 안으로 이동 (header의 2자식 구조 유지) */
      header.insertBefore(wrapper, nav);
      wrapper.appendChild(nav);
    } else {
      header.appendChild(wrapper);
    }

    /* 로그아웃 버튼 생성 */
    var btn = document.createElement("button");
    btn.id = LOGOUT_ID;
    btn.className = "golab-logout-btn";
    btn.textContent = "로그아웃";
    btn.addEventListener("click", function () {
      if (typeof window._GoLabFirebase !== "undefined") {
        window._GoLabFirebase.signOut().then(function (ok) {
          if (ok) {
            /* 로그아웃 성공 → 페이지 새로고침 (오버레이 재표시) */
            location.reload();
          }
        });
      }
    });
    wrapper.appendChild(btn);
  }

  /* ══════════════════════════════════════
     에러 메시지 한글화
     ══════════════════════════════════════ */
  function _translateError(err) {
    if (!err) return "로그인에 실패했습니다.";
    if (err.indexOf("user-not-found") !== -1)        return "등록되지 않은 계정입니다.";
    if (err.indexOf("wrong-password") !== -1)         return "비밀번호가 올바르지 않습니다.";
    if (err.indexOf("invalid-email") !== -1)          return "이메일 형식이 올바르지 않습니다.";
    if (err.indexOf("invalid-credential") !== -1)     return "이메일 또는 비밀번호가 올바르지 않습니다.";
    if (err.indexOf("too-many-requests") !== -1)      return "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.";
    if (err.indexOf("network-request-failed") !== -1) return "네트워크 오류. 인터넷 연결을 확인하세요.";
    return "로그인 실패: " + err;
  }

})();
