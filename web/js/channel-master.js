/**
 * GoLab v2.6 — Channel Master (관리업체 마스터)
 *
 * 관리업체(채널) 마스터 데이터 관리
 * - 코드(A, B, C...) + 이름 + 기본 리베이트율
 * - 삭제는 active=false (소프트 삭제)
 *
 * 사용법: <script src="js/channel-master.js"></script>
 *         GoLabChannelMaster.getAll()
 *         GoLabChannelMaster.getActive()
 *
 * localStorage 키:
 *   golab_channel_master_v1  — 채널 배열
 *   golab_channel_master_audit — 감사 로그
 */
window.GoLabChannelMaster = (function () {
  "use strict";

  var MASTER_KEY = "golab_channel_master_v1";
  var AUDIT_KEY  = "golab_channel_master_audit";

  /* ══════════════════════════════════════
     초기 데이터 — 최초 실행 시 자동 세팅
     ══════════════════════════════════════ */

  var INITIAL_CHANNELS = [
    { code: "A", name: "제이유니버스",  default_rebate_rate: 30 },
    { code: "B", name: "제이앤컴퍼니",  default_rebate_rate: 30 },
    { code: "C", name: "어반에이치",    default_rebate_rate: 30 },
    { code: "D", name: "우진",          default_rebate_rate: 30 },
    { code: "E", name: "에이라이프",    default_rebate_rate: 30 }
  ];

  /* ══════════════════════════════════════
     유틸리티
     ══════════════════════════════════════ */

  function n(v, fb) {
    if (fb === undefined) fb = 0;
    var x = Number(v);
    return Number.isFinite(x) ? x : fb;
  }

  /* ══════════════════════════════════════
     CRUD
     ══════════════════════════════════════ */

  /** 전체 로드 */
  function loadAll() {
    try { return JSON.parse(localStorage.getItem(MASTER_KEY) || "[]"); }
    catch (e) { return []; }
  }

  /** 저장 */
  function _save(arr) {
    localStorage.setItem(MASTER_KEY, JSON.stringify(arr));
  }

  /** 초기 데이터 세팅 — 데이터 없을 때만 실행 (멱등) */
  function init() {
    var existing = loadAll();
    if (existing.length > 0) return;

    var channels = INITIAL_CHANNELS.map(function (ch) {
      return {
        channel_id:          crypto.randomUUID(),
        code:                ch.code,
        name:                ch.name,
        default_rebate_rate: ch.default_rebate_rate,
        active:              true,
        created_at:          new Date().toISOString()
      };
    });

    _save(channels);
    emitAudit("INIT", { count: channels.length });
  }

  /** 전체 조회 (비활성 포함) */
  function getAll() {
    return loadAll();
  }

  /** 활성 채널만 조회 (신규 등록 dropdown용) */
  function getActive() {
    return loadAll().filter(function (ch) { return ch.active !== false; });
  }

  /** ID로 조회 */
  function getById(channelId) {
    if (!channelId) return null;
    return loadAll().find(function (ch) { return ch.channel_id === channelId; }) || null;
  }

  /** 코드로 조회 */
  function getByCode(code) {
    if (!code) return null;
    return loadAll().find(function (ch) { return ch.code === code; }) || null;
  }

  /** 채널 생성 */
  function create(fields) {
    if (!fields.code || !fields.code.trim()) throw new Error("채널 코드를 입력해주세요.");
    if (!fields.name || !fields.name.trim()) throw new Error("채널 이름을 입력해주세요.");

    var all = loadAll();

    /* 코드 중복 검사 */
    var dupCode = all.find(function (ch) {
      return ch.code === fields.code.trim().toUpperCase();
    });
    if (dupCode) throw new Error("이미 존재하는 코드: " + fields.code);

    var channel = {
      channel_id:          crypto.randomUUID(),
      code:                fields.code.trim().toUpperCase(),
      name:                fields.name.trim(),
      default_rebate_rate: n(fields.default_rebate_rate, 30),
      active:              true,
      created_at:          new Date().toISOString()
    };

    all.push(channel);
    _save(all);
    emitAudit("CREATE", { channel_id: channel.channel_id, code: channel.code, name: channel.name });
    return channel;
  }

  /** 채널 수정 */
  function update(channelId, fields) {
    var all = loadAll();
    var idx = all.findIndex(function (ch) { return ch.channel_id === channelId; });
    if (idx < 0) throw new Error("채널을 찾을 수 없습니다: " + channelId);

    var ch = all[idx];
    if (fields.code !== undefined) ch.code = fields.code.trim().toUpperCase();
    if (fields.name !== undefined) ch.name = fields.name.trim();
    if (fields.default_rebate_rate !== undefined) ch.default_rebate_rate = n(fields.default_rebate_rate, 30);
    if (fields.active !== undefined) ch.active = !!fields.active;

    _save(all);
    emitAudit("UPDATE", { channel_id: channelId, changed: Object.keys(fields) });
    return ch;
  }

  /** 소프트 삭제 (active=false) — 실제 delete 금지 */
  function deactivate(channelId) {
    return update(channelId, { active: false });
  }

  /** 복구 (active=true) */
  function reactivate(channelId) {
    return update(channelId, { active: true });
  }

  /* ══════════════════════════════════════
     감사 로그
     ══════════════════════════════════════ */

  function emitAudit(event, detail) {
    try {
      var log = JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]");
      log.push({ event: event, ts: new Date().toISOString(), detail: detail || {} });
      if (log.length > 500) log.splice(0, log.length - 500);
      localStorage.setItem(AUDIT_KEY, JSON.stringify(log));
    } catch (e) { /* silent */ }
  }

  /* ══════════════════════════════════════
     Public API
     ══════════════════════════════════════ */

  return {
    MASTER_KEY: MASTER_KEY,
    AUDIT_KEY:  AUDIT_KEY,
    init:       init,
    getAll:     getAll,
    getActive:  getActive,
    getById:    getById,
    getByCode:  getByCode,
    create:     create,
    update:     update,
    deactivate: deactivate,
    reactivate: reactivate,
    emitAudit:  emitAudit
  };

})();

/* 최초 실행 시 초기 데이터 자동 세팅 */
GoLabChannelMaster.init();
