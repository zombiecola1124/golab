/**
 * GoLab v7.7 — 통합 사건 로그 (Audit Log)
 *
 * 저장 키: golab_audit_log_v1
 *
 * 역할 분리:
 *   golab_actions_v15 = 할 일(To-Do) 저장소
 *   golab_audit_log_v1 = 사건(Event Log) 저장소  ← 본 모듈
 *
 * 원칙:
 *   1. 엔진(trade-engine.js 등) 절대 미터치
 *   2. 각 화면에서 저장 "성공 직후" GoLabAuditLog.add() 호출 (병렬 기록)
 *   3. payload는 ID만이 아니라 partner_name / item_summary 등 표시용 스냅샷도 함께
 *   4. 최신 500건 유지 (초과 시 오래된 것부터 삭제)
 *   5. GoLabStorage 경유 → Firebase 자동 sync (storage-adapter 화이트리스트 등록 필수)
 *
 * 타입 분류 (콘솔 타임라인 아이콘):
 *   💰 거래       — TRADE_CREATE / TRADE_EDIT / TRADE_PAYMENT
 *   📄 단계       — TRADE_STEP
 *   👥 거래처     — PARTNER_CREATE / PARTNER_EDIT
 *   📝 Action     — ACTION_CREATE / ACTION_COMPLETE / ACTION_REOPEN / ACTION_DELETE
 *
 * payload 권장 키:
 *   { deal_id, partner_id, partner_name, item_summary, step, amount, ... }
 */
window.GoLabAuditLog = (function () {
  "use strict";

  /** 저장 키 (storage-adapter FIREBASE_KEYS 화이트리스트와 일치 필수) */
  var KEY = "golab_audit_log_v1";

  /** 최대 보관 건수 — 초과 시 오래된 것부터 삭제 (최신 N건 유지) */
  var MAX_SIZE = 500;

  /* ══════════════════════════════════════
     내부 IO — GoLabStorage 우선, 없으면 localStorage 직행
     ══════════════════════════════════════ */

  function _read() {
    try {
      var raw = (window.GoLabStorage ? GoLabStorage.getItem(KEY) : localStorage.getItem(KEY)) || "[]";
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      console.warn("[AuditLog] 파싱 실패 — 빈 배열로 초기화:", e.message);
      return [];
    }
  }

  function _write(list) {
    var json = JSON.stringify(list);
    if (window.GoLabStorage) {
      /* setItem → localStorage 저장 + (sync 모드 시) Firebase 즉시 push */
      GoLabStorage.setItem(KEY, json);
    } else {
      localStorage.setItem(KEY, json);
    }
  }

  /* ══════════════════════════════════════
     Public API
     ══════════════════════════════════════ */

  /**
   * 사건 1건 기록 (성공 콜백 직후 호출)
   * @param {string} type — TRADE_CREATE / TRADE_EDIT / TRADE_STEP / TRADE_PAYMENT
   *                       PARTNER_CREATE / PARTNER_EDIT
   *                       ACTION_CREATE / ACTION_COMPLETE / ACTION_REOPEN / ACTION_DELETE
   * @param {object} payload — { deal_id, partner_name, item_summary, ... } 표시용 스냅샷 동봉
   * @returns {object|null} 기록된 entry (실패 시 null)
   */
  function add(type, payload) {
    if (!type) {
      console.warn("[AuditLog] type 누락 — 기록 건너뜀");
      return null;
    }
    try {
      var entry = {
        id: "AUD-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        type: String(type),
        ts: new Date().toISOString(),
        payload: payload || {}
      };
      var list = _read();
      list.push(entry);
      /* 최신 MAX_SIZE 건 유지 — 오래된 것부터 잘라냄 (앞쪽이 오래된 것) */
      if (list.length > MAX_SIZE) {
        list = list.slice(list.length - MAX_SIZE);
      }
      _write(list);
      return entry;
    } catch (e) {
      /* 로그 실패가 본 작업을 망가뜨려선 안 됨 — silently fail */
      console.warn("[AuditLog] 기록 실패:", e.message);
      return null;
    }
  }

  /** 전체 조회 (시간 오름차순 — 렌더 측에서 역정렬) */
  function getAll() {
    return _read();
  }

  /** 최신순 조회 (limit 옵션) */
  function getRecent(limit) {
    var list = _read();
    list.sort(function (a, b) { return (b.ts || "").localeCompare(a.ts || ""); });
    return (typeof limit === "number" && limit > 0) ? list.slice(0, limit) : list;
  }

  /** 전체 삭제 (개발/디버그용) */
  function clear() {
    _write([]);
  }

  /* ══════════════════════════════════════
     표시용 헬퍼 — 각 후크 화면에서 payload 만들 때 활용
     ══════════════════════════════════════ */

  /**
   * 품목 배열 → 표시용 요약 문자열
   *   []                     → ""
   *   [{name:"A"}]           → "A"
   *   [{name:"A"},{name:"B"}] → "A 외 1건"
   *   [{name:"A"},{},{}]     → "A 외 2건"
   * @param {Array} items — { name } 또는 { item_name } 필드 보유
   */
  function summarizeItems(items) {
    if (!Array.isArray(items) || items.length === 0) return "";
    var first = "";
    for (var i = 0; i < items.length; i++) {
      var nm = items[i] && (items[i].name || items[i].item_name);
      if (nm) { first = String(nm); break; }
    }
    if (!first) return "";
    if (items.length === 1) return first;
    return first + " 외 " + (items.length - 1) + "건";
  }

  /* ══════════════════════════════════════
     렌더용 메타 (콘솔 타임라인에서 참조)
     ══════════════════════════════════════ */

  /** 타입 → { icon, group, label } */
  var TYPE_META = {
    TRADE_CREATE:    { icon: "💰", group: "trade",   label: "거래 등록" },
    TRADE_EDIT:      { icon: "💰", group: "trade",   label: "거래 수정" },
    TRADE_PAYMENT:   { icon: "💰", group: "trade",   label: "입금 변경" },
    TRADE_STEP:      { icon: "📄", group: "step",    label: "단계 변경" },
    PARTNER_CREATE:  { icon: "👥", group: "partner", label: "거래처 등록" },
    PARTNER_EDIT:    { icon: "👥", group: "partner", label: "거래처 수정" },
    ACTION_CREATE:   { icon: "📝", group: "action",  label: "Action 등록" },
    ACTION_COMPLETE: { icon: "📝", group: "action",  label: "Action 완료" },
    ACTION_REOPEN:   { icon: "📝", group: "action",  label: "Action 재개" },
    ACTION_DELETE:   { icon: "📝", group: "action",  label: "Action 삭제" }
  };

  function getMeta(type) {
    return TYPE_META[type] || { icon: "•", group: "etc", label: type || "사건" };
  }

  /* ══════════════════════════════════════ */

  console.log("[AuditLog] 초기화 완료 — key: " + KEY + ", max: " + MAX_SIZE);

  return {
    add:            add,
    getAll:         getAll,
    getRecent:      getRecent,
    clear:          clear,
    summarizeItems: summarizeItems,
    getMeta:        getMeta,
    KEY:            KEY,
    MAX_SIZE:       MAX_SIZE,
    TYPE_META:      TYPE_META
  };
})();
