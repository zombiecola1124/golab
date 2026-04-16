/**
 * GoLab v5 — Firebase Configuration & Firestore Bridge
 *
 * Phase B+: Firebase SDK 초기화 + Email/Password Auth + Firestore push/pull
 *
 * 의존성:
 *   firebase-app-compat.js   (CDN, 페이지에서 로드)
 *   firebase-auth-compat.js  (CDN, 페이지에서 로드)
 *   firebase-firestore-compat.js (CDN, 페이지에서 로드)
 *
 * 규칙:
 *   - onSnapshot (실시간 리스너) 사용 금지
 *   - 이벤트 기반 on-demand fetch만 사용
 *   - Firebase 미설정/오류 시 앱이 깨지지 않아야 함
 *   - localStorage가 항상 SSoT
 *
 * 사용법:
 *   storage-adapter.js가 window._GoLabFirebase를 자동 감지한다.
 *   수동 테스트: _GoLabFirebase.push(key, value) / _GoLabFirebase.pull(key)
 */
window._GoLabFirebase = (function () {
  "use strict";

  /* ══════════════════════════════════════
     Firebase 프로젝트 설정
     ──────────────────────────────────────
     아래 값을 Firebase Console에서 복사하여 채운다.
     Firebase Console → 프로젝트 설정 → 일반 → 웹 앱 → SDK 설정
     모든 값이 비어 있으면 Firebase가 초기화되지 않는다.
     ══════════════════════════════════════ */
  var FIREBASE_CONFIG = {
    apiKey:            "AIzaSyAowCAQtitOt0x7VXDmhyjOXJgtrn7TTss",
    authDomain:        "ggolab-12780.firebaseapp.com",
    projectId:         "ggolab-12780",
    storageBucket:     "ggolab-12780.firebasestorage.app",
    messagingSenderId: "738096652896",
    appId:             "1:738096652896:web:c77cb2af4d8f880bc29905"
  };

  /* ══════════════════════════════════════
     localStorage 키 → Firestore 컬렉션 매핑
     ══════════════════════════════════════ */
  var KEY_TO_COLLECTION = {
    "golab_trade_v2":            "trades",
    "golab_item_master_v1":      "items",
    "golab_partner_master_v1":   "partners",
    "golab_actions_v15":         "actions",
    "golab_channel_master_v1":   "channels",
    "golab_inventory_v1":        "inventory",       /* v01→v1 통일 후 추가 */
    "golab_inbound_logs_v1":     "inbound_logs"     /* v01→v1 통일 후 추가 */
  };

  /* 버전 태그 추출 (키 이름에서) */
  var KEY_TO_VERSION = {
    "golab_trade_v2":            "v2",
    "golab_item_master_v1":      "v1",
    "golab_partner_master_v1":   "v1",
    "golab_actions_v15":         "v15",
    "golab_channel_master_v1":   "v1",
    "golab_inventory_v1":        "v1",              /* 추가 */
    "golab_inbound_logs_v1":     "v1"               /* 추가 */
  };

  /* ══════════════════════════════════════
     내부 상태
     ══════════════════════════════════════ */
  var _db   = null;
  var _auth = null;
  var _ready = false;

  /* ══════════════════════════════════════
     초기화
     ══════════════════════════════════════ */

  /**
   * Firebase SDK 존재 여부 + 설정 유효성 확인 후 초기화
   * @returns {boolean} 초기화 성공 여부
   */
  function init() {
    /* SDK 미로드 */
    if (typeof firebase === "undefined") {
      console.log("[Firebase] SDK 미로드 — Firebase 비활성");
      return false;
    }

    /* 설정 비어 있음 */
    if (!FIREBASE_CONFIG.projectId || !FIREBASE_CONFIG.apiKey) {
      console.log("[Firebase] 프로젝트 설정 비어 있음 — Firebase 비활성");
      return false;
    }

    try {
      /* 이미 초기화된 앱이 있으면 재사용 */
      if (firebase.apps.length === 0) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      _db   = firebase.firestore();
      _auth = firebase.auth();
      _ready = true;
      console.log("[Firebase] 초기화 완료 — projectId: " + FIREBASE_CONFIG.projectId);
      return true;
    } catch (e) {
      console.warn("[Firebase] 초기화 실패: " + e.message);
      _ready = false;
      return false;
    }
  }

  /* ══════════════════════════════════════
     인증 — Email/Password (v5 Auth 전환)
     ──────────────────────────────────────
     단일 사용자(고대표) 전용.
     Email/Password → 모든 기기에서 동일 UID 보장.
     Anonymous는 개발/테스트 전용 fallback.
     ══════════════════════════════════════ */

  /**
   * Email/Password 로그인 (실사용)
   * 실패 시 Anonymous fallback 없이 명확히 실패 반환.
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{uid: string|null, error: string|null}>}
   */
  function signInWithEmail(email, password) {
    if (!_ready || !_auth) {
      return Promise.resolve({ uid: null, error: "Firebase 미초기화" });
    }

    return _auth.signInWithEmailAndPassword(email, password)
      .then(function (cred) {
        console.log("[Firebase] Email 로그인 완료 — uid: " + cred.user.uid);
        return { uid: cred.user.uid, error: null };
      })
      .catch(function (e) {
        console.warn("[Firebase] Email 로그인 실패: " + e.code + " — " + e.message);
        return { uid: null, error: e.code + ": " + e.message };
      });
  }

  /**
   * 익명 로그인 (개발/테스트 전용 fallback)
   * 실사용에서는 signInWithEmail()을 사용한다.
   * @returns {Promise<string|null>} uid 또는 null
   */
  function signIn() {
    if (!_ready || !_auth) {
      return Promise.resolve(null);
    }

    /* 이미 로그인 상태 */
    if (_auth.currentUser) {
      return Promise.resolve(_auth.currentUser.uid);
    }

    return _auth.signInAnonymously()
      .then(function (cred) {
        console.log("[Firebase] 익명 로그인 완료 (개발용) — uid: " + cred.user.uid);
        return cred.user.uid;
      })
      .catch(function (e) {
        console.warn("[Firebase] 익명 로그인 실패: " + e.message);
        return null;
      });
  }

  /**
   * 로그아웃
   * @returns {Promise<boolean>} 성공 여부
   */
  function signOut() {
    if (!_ready || !_auth) {
      return Promise.resolve(false);
    }

    return _auth.signOut()
      .then(function () {
        console.log("[Firebase] 로그아웃 완료");
        return true;
      })
      .catch(function (e) {
        console.warn("[Firebase] 로그아웃 실패: " + e.message);
        return false;
      });
  }

  /**
   * 현재 인증 상태 대기 (Auth state 안정화)
   * 기존 세션이 있으면 그대로 유지.
   * 세션 없으면 null 반환 (자동 로그인 하지 않음).
   * @returns {Promise<string|null>} uid 또는 null
   */
  function waitForAuth() {
    if (!_ready || !_auth) {
      return Promise.resolve(null);
    }

    return new Promise(function (resolve) {
      var unsubscribe = _auth.onAuthStateChanged(function (user) {
        unsubscribe();
        if (user) {
          console.log("[Firebase] 기존 세션 복원 — uid: " + user.uid + " (" + (user.isAnonymous ? "anonymous" : "email") + ")");
          resolve(user.uid);
        } else {
          console.log("[Firebase] 인증 세션 없음 — 로그인 필요");
          resolve(null);
        }
      });
    });
  }

  /* ══════════════════════════════════════
     Firestore 경로 헬퍼
     ══════════════════════════════════════ */

  /**
   * Firestore 문서 경로: users/{uid}/{collection}/all
   * @param {string} key — localStorage 키
   * @returns {firebase.firestore.DocumentReference|null}
   */
  function _docRef(key) {
    if (!_db || !_auth || !_auth.currentUser) return null;
    var collection = KEY_TO_COLLECTION[key];
    if (!collection) return null;
    var uid = _auth.currentUser.uid;
    return _db.collection("users").doc(uid).collection(collection).doc("all");
  }

  /* ══════════════════════════════════════
     Push — localStorage → Firestore
     ══════════════════════════════════════ */

  /**
   * 단건 push
   * @param {string} key — localStorage 키
   * @param {string} value — JSON 문자열
   * @returns {Promise<object>} { status, size?, error? }
   */
  function push(key, value) {
    var ref = _docRef(key);
    if (!ref) {
      return Promise.resolve({ status: "skip", reason: "not_ready" });
    }

    var parsed;
    try {
      parsed = JSON.parse(value);
    } catch (e) {
      return Promise.resolve({ status: "fail", error: "JSON 파싱 실패: " + e.message });
    }

    return ref.set({
      data:       parsed,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      version:    KEY_TO_VERSION[key] || "unknown",
      key:        key
    })
    .then(function () {
      console.log("[Firebase] push 완료 — " + key + " (" + value.length + " chars)");
      return { status: "ok", size: value.length };
    })
    .catch(function (e) {
      console.warn("[Firebase] push 실패 — " + key + ": " + e.message);
      return { status: "fail", error: e.message };
    });
  }

  /* ══════════════════════════════════════
     Pull — Firestore → localStorage
     ══════════════════════════════════════ */

  /**
   * 단건 pull
   * @param {string} key — localStorage 키
   * @returns {Promise<string|null>} JSON 문자열 또는 null
   */
  function pull(key) {
    var ref = _docRef(key);
    if (!ref) {
      return Promise.resolve(null);
    }

    return ref.get()
      .then(function (snap) {
        if (!snap.exists) {
          console.log("[Firebase] pull — " + key + ": 문서 없음");
          return null;
        }
        var doc = snap.data();
        if (!doc.data) {
          console.warn("[Firebase] pull — " + key + ": data 필드 없음");
          return null;
        }
        var json = JSON.stringify(doc.data);
        console.log("[Firebase] pull 완료 — " + key + " (" + json.length + " chars)");
        return json;
      })
      .catch(function (e) {
        console.warn("[Firebase] pull 실패 — " + key + ": " + e.message);
        return null;
      });
  }

  /* ══════════════════════════════════════
     상태 조회
     ══════════════════════════════════════ */

  /** Firebase 준비 완료 + 인증 완료 여부 */
  function isReady() {
    return _ready && _auth && !!_auth.currentUser;
  }

  /** 현재 인증된 UID */
  function getUid() {
    return (_auth && _auth.currentUser) ? _auth.currentUser.uid : null;
  }

  /** 상세 상태 */
  function status() {
    return {
      sdkLoaded:   typeof firebase !== "undefined",
      configured:  !!(FIREBASE_CONFIG.projectId && FIREBASE_CONFIG.apiKey),
      initialized: _ready,
      authenticated: !!(_auth && _auth.currentUser),
      uid:         getUid(),
      projectId:   FIREBASE_CONFIG.projectId || "(미설정)"
    };
  }

  /* ══════════════════════════════════════
     자동 초기화 (SDK 로드 시 즉시 실행)
     ══════════════════════════════════════ */
  var _initResult = init();

  /* 초기화 성공 시 기존 세션 자동 복원 (재로그인 불필요) */
  if (_initResult) {
    waitForAuth();
  }

  /* ══════════════════════════════════════
     Public API
     ══════════════════════════════════════ */
  return {
    /* 핵심 */
    push:   push,
    pull:   pull,

    /* 인증 */
    signInWithEmail: signInWithEmail,
    signIn:          signIn,         /* 개발/테스트 전용 (Anonymous) */
    signOut:         signOut,
    waitForAuth:     waitForAuth,

    /* 상태 */
    isReady: isReady,
    getUid:  getUid,
    status:  status,

    /* 재초기화 (설정 변경 후) */
    init: init,

    /* 상수 (외부 참조용) */
    KEY_TO_COLLECTION: KEY_TO_COLLECTION,
    FIREBASE_CONFIG:   FIREBASE_CONFIG
  };

})();
