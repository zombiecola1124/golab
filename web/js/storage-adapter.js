/**
 * GoLab v5 — Storage Adapter
 *
 * UI → GoLabStorage → localStorage (SSoT) / Firebase (동기화 계층)
 *
 * 규칙:
 *   - UI에서 localStorage 직접 접근 금지 (핵심 5키 한정)
 *   - UI에서 Firebase 직접 접근 금지
 *   - 모든 핵심 데이터 접근은 GoLabStorage를 통해서만 수행
 *   - AUDIT_KEY는 이 어댑터를 타지 않는다 (localStorage 직행)
 *
 * 모드:
 *   "local" — localStorage만 (기본값, Firebase 설정 전)
 *   "sync"  — localStorage + Firebase push (Phase B에서 활성화)
 *
 * localStorage 키:
 *   golab_storage_mode — 현재 모드 ("local" | "sync")
 *   golab_storage_last_push — 마지막 push 시각 (ISO)
 *   golab_storage_pending — push 실패 대기열 (JSON 배열)
 */
window.GoLabStorage = (function () {
  "use strict";

  /* ══════════════════════════════════════
     상수
     ══════════════════════════════════════ */

  /** Firebase 동기화 대상 키 — 화이트리스트 */
  var FIREBASE_KEYS = [
    "golab_trade_v2",
    "golab_item_master_v1",
    "golab_partner_master_v1",
    "golab_actions_v15",
    "golab_channel_master_v1"
  ];

  /** 내부 메타 키 (StorageAdapter 자체 상태 저장용) */
  var META_MODE_KEY    = "golab_storage_mode";
  var META_PUSH_KEY    = "golab_storage_last_push";
  var META_PENDING_KEY = "golab_storage_pending";

  /** push 차단 크기 한도 (900KB — Firestore 1MB의 ~86%) */
  var PUSH_SIZE_LIMIT = 900 * 1024;

  /* ══════════════════════════════════════
     모드 관리
     ══════════════════════════════════════ */

  /** 현재 모드 반환 ("local" | "sync") */
  function getMode() {
    return localStorage.getItem(META_MODE_KEY) || "local";
  }

  /** 모드 전환 */
  function setMode(mode) {
    if (mode !== "local" && mode !== "sync") {
      console.warn("[StorageAdapter] 유효하지 않은 모드: " + mode);
      return;
    }
    localStorage.setItem(META_MODE_KEY, mode);
    console.log("[StorageAdapter] 모드 전환: " + mode);
  }

  /** Firebase 활성 여부 (SDK 로드 + 설정 완료 + 인증 완료) */
  function isFirebaseEnabled() {
    return getMode() === "sync"
      && typeof window._GoLabFirebase !== "undefined"
      && window._GoLabFirebase.isReady();
  }

  /* ══════════════════════════════════════
     핵심 CRUD — localStorage 호환 인터페이스
     ══════════════════════════════════════ */

  /**
   * getItem — localStorage에서 읽기
   * Firebase에서 읽지 않음 (on-demand pull은 별도 함수)
   * @param {string} key
   * @returns {string|null}
   */
  function getItem(key) {
    return localStorage.getItem(key);
  }

  /**
   * setItem — localStorage 저장 + (sync 모드 시) Firebase push
   * @param {string} key
   * @param {string} value — JSON 문자열
   */
  function setItem(key, value) {
    /* 1단계: localStorage 저장 (항상 — SSoT) */
    localStorage.setItem(key, value);

    /* 2단계: Firebase push (sync 모드 + 화이트리스트 키만) */
    if (isFirebaseEnabled() && _isFirebaseKey(key)) {
      _pushToFirebaseAsync(key, value);
    }
  }

  /**
   * removeItem — localStorage 삭제 (Firebase는 보존)
   * @param {string} key
   */
  function removeItem(key) {
    localStorage.removeItem(key);
  }

  /* ══════════════════════════════════════
     Firebase 동기화 — firebase-config.js 연동
     ══════════════════════════════════════ */

  /**
   * pushToFirebase — 수동 업로드 (localStorage → Firebase)
   * @param {string} key
   * @returns {Promise<object>} { status, size?, error? }
   */
  function pushToFirebase(key) {
    if (!_isFirebaseKey(key)) {
      return Promise.resolve({ status: "skip", reason: "not_firebase_key" });
    }

    var raw = localStorage.getItem(key);
    if (!raw) {
      return Promise.resolve({ status: "skip", reason: "empty" });
    }

    /* 크기 체크 — 900KB 초과 시 차단 */
    var sizeBytes = _estimateBytes(raw);
    if (sizeBytes > PUSH_SIZE_LIMIT) {
      console.warn("[StorageAdapter] " + key + " 크기 초과: " + Math.round(sizeBytes / 1024) + "KB (한도: " + Math.round(PUSH_SIZE_LIMIT / 1024) + "KB)");
      return Promise.resolve({ status: "blocked", reason: "size_limit", size: sizeBytes });
    }

    /* Phase B: Firebase 구현 자리 */
    if (typeof window._GoLabFirebase !== "undefined" && window._GoLabFirebase.push) {
      return window._GoLabFirebase.push(key, raw);
    }

    return Promise.resolve({ status: "skip", reason: "firebase_not_configured" });
  }

  /**
   * pullFromFirebase — 수동 다운로드 (Firebase → localStorage)
   * Firebase 데이터와 localStorage 비교 후 다를 때만 덮어쓰기
   * @param {string} key
   * @returns {Promise<{data: string|null, changed: boolean}>}
   */
  function pullFromFirebase(key) {
    if (!_isFirebaseKey(key)) {
      return Promise.resolve({ data: null, changed: false });
    }

    if (typeof window._GoLabFirebase !== "undefined" && window._GoLabFirebase.pull) {
      var currentLocal = localStorage.getItem(key);

      return window._GoLabFirebase.pull(key).then(function (data) {
        if (data !== null && data !== undefined) {
          var incoming = typeof data === "string" ? data : JSON.stringify(data);
          /* 기존 localStorage와 다를 때만 덮어쓰기 */
          if (currentLocal !== incoming) {
            localStorage.setItem(key, incoming);
            console.log("[StorageAdapter] pull 반영 — " + key + " (변경됨)");
            return { data: incoming, changed: true };
          }
          return { data: incoming, changed: false };
        }
        return { data: null, changed: false };
      }).catch(function (err) {
        console.warn("[StorageAdapter] pull 실패 — " + key + ": " + err.message);
        return { data: null, changed: false };
      });
    }

    return Promise.resolve({ data: null, changed: false });
  }

  /**
   * pushAll — 핵심 5키 전체 push
   * @returns {Promise<object[]>}
   */
  function pushAll() {
    var promises = FIREBASE_KEYS.map(function (key) {
      return pushToFirebase(key).then(function (result) {
        return { key: key, result: result };
      });
    });
    return Promise.all(promises);
  }

  /**
   * pullAll — 핵심 5키 전체 pull
   * @returns {Promise<{key: string, data: string|null, changed: boolean}[]>}
   */
  function pullAll() {
    var promises = FIREBASE_KEYS.map(function (key) {
      return pullFromFirebase(key).then(function (result) {
        return { key: key, data: result.data, changed: result.changed };
      });
    });
    return Promise.all(promises);
  }

  /**
   * syncStatus — 동기화 상태 조회
   * @returns {object}
   */
  function syncStatus() {
    var pending;
    try { pending = JSON.parse(localStorage.getItem(META_PENDING_KEY) || "[]"); }
    catch (e) { pending = []; }

    return {
      mode: getMode(),
      firebaseReady: typeof window._GoLabFirebase !== "undefined",
      lastPush: localStorage.getItem(META_PUSH_KEY) || null,
      pendingCount: pending.length,
      pendingKeys: pending
    };
  }

  /* ══════════════════════════════════════
     내부 헬퍼
     ══════════════════════════════════════ */

  /** 화이트리스트 확인 */
  function _isFirebaseKey(key) {
    return FIREBASE_KEYS.indexOf(key) !== -1;
  }

  /** UTF-8 바이트 크기 추정 */
  function _estimateBytes(str) {
    /* Blob 사용 가능하면 정확한 크기, 아니면 추정 */
    if (typeof Blob !== "undefined") {
      return new Blob([str]).size;
    }
    /* fallback: 한글 3바이트, ASCII 1바이트 추정 */
    var bytes = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      bytes += (c <= 0x7F) ? 1 : (c <= 0x7FF) ? 2 : 3;
    }
    return bytes;
  }

  /** 비동기 Firebase push (setItem에서 호출, fire-and-forget) */
  function _pushToFirebaseAsync(key, value) {
    /* 크기 체크 */
    var sizeBytes = _estimateBytes(value);
    if (sizeBytes > PUSH_SIZE_LIMIT) {
      console.warn("[StorageAdapter] push 차단 — " + key + ": " + Math.round(sizeBytes / 1024) + "KB 초과");
      _addToPending(key);
      return;
    }

    /* Phase B: Firebase 구현 자리 */
    if (typeof window._GoLabFirebase !== "undefined" && window._GoLabFirebase.push) {
      window._GoLabFirebase.push(key, value)
        .then(function () {
          localStorage.setItem(META_PUSH_KEY, new Date().toISOString());
          _removeFromPending(key);
        })
        .catch(function (err) {
          console.warn("[StorageAdapter] push 실패 — " + key + ": " + err.message);
          _addToPending(key);
        });
    }
  }

  /** pending 큐에 키 추가 */
  function _addToPending(key) {
    var pending;
    try { pending = JSON.parse(localStorage.getItem(META_PENDING_KEY) || "[]"); }
    catch (e) { pending = []; }
    if (pending.indexOf(key) === -1) {
      pending.push(key);
      localStorage.setItem(META_PENDING_KEY, JSON.stringify(pending));
    }
  }

  /** pending 큐에서 키 제거 */
  function _removeFromPending(key) {
    var pending;
    try { pending = JSON.parse(localStorage.getItem(META_PENDING_KEY) || "[]"); }
    catch (e) { pending = []; }
    var idx = pending.indexOf(key);
    if (idx !== -1) {
      pending.splice(idx, 1);
      localStorage.setItem(META_PENDING_KEY, JSON.stringify(pending));
    }
  }

  /* ══════════════════════════════════════
     Public API
     ══════════════════════════════════════ */

  console.log("[StorageAdapter] 초기화 완료 — 모드: " + getMode());

  return {
    /* 핵심 CRUD (localStorage 호환) */
    getItem:     getItem,
    setItem:     setItem,
    removeItem:  removeItem,

    /* Firebase 동기화 */
    pushToFirebase:  pushToFirebase,
    pullFromFirebase: pullFromFirebase,
    pushAll:     pushAll,
    pullAll:     pullAll,
    syncStatus:  syncStatus,

    /* 모드 제어 */
    getMode:           getMode,
    setMode:           setMode,
    isFirebaseEnabled: isFirebaseEnabled,

    /* 상수 (외부 참조용) */
    FIREBASE_KEYS:   FIREBASE_KEYS,
    PUSH_SIZE_LIMIT: PUSH_SIZE_LIMIT
  };

})();
