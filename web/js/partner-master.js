/**
 * GoLab v2.2 — 거래처 마스터 + 자동완성 공유 모듈 (실무 주소록 확장)
 *
 * 사용법: <script src="js/partner-master.js"></script>
 *         GoLabPartnerMaster.loadAll()
 *         GoLabPartnerMaster.createAutocomplete(container, options)
 *         GoLabPartnerMaster.migrateFromSales()
 *
 * v2.2 신규 필드: region, dept, contact_name, phone, email, alias, memo
 * 파생 필드: display_name, search_text
 *
 * localStorage 키:
 *   golab_partner_master_v1  — 거래처 마스터 배열
 *   golab_partner_master_audit — 감사 로그
 */
window.GoLabPartnerMaster = (function () {
  "use strict";

  const MASTER_KEY = "golab_partner_master_v1";
  const AUDIT_KEY  = "golab_partner_master_audit";
  /* v6.1 세션당 1회 dedup 가드 */
  var _primaryDedupedThisSession = false;

  /* ── 거래처 유형 ── */
  const TYPES = ["매입처", "매출처", "겸용"];

  /* ══════════════════════════════════════
     v2.2 유틸리티 — 전화번호 포맷 / 파생 필드 / 하위 호환
     ══════════════════════════════════════ */

  /**
   * 전화번호 포맷 — digits → 하이픈 변환
   * 01012345678 → 010-1234-5678
   * 021234567   → 02-123-4567
   * 0312345678  → 031-234-5678
   */
  function _formatPhone(s) {
    const d = (s || "").replace(/\D/g, "");
    if (!d) return "";
    /* 02 지역번호 (2자리) */
    if (d.startsWith("02")) {
      if (d.length === 10) return d.slice(0,2) + "-" + d.slice(2,6) + "-" + d.slice(6);
      if (d.length === 9)  return d.slice(0,2) + "-" + d.slice(2,5) + "-" + d.slice(5);
    }
    /* 010/011/031 등 (3자리 prefix) */
    if (d.length === 11) return d.slice(0,3) + "-" + d.slice(3,7) + "-" + d.slice(7);
    if (d.length === 10) return d.slice(0,3) + "-" + d.slice(3,6) + "-" + d.slice(6);
    /* 포맷 불가 → 원본 digits 반환 */
    return d;
  }

  /**
   * 파생 필드 생성 — display_name + search_text
   * create / update / loadAll 마이그레이션 시 호출
   */
  function _buildDerived(p) {
    /* display_name: alias 있으면 alias, 없으면 name */
    const alias = (p.alias || "").trim();
    p.display_name = alias ? alias : (p.name || "");

    /* phone_digits: 숫자만 추출 (검색용) */
    const phoneDigits = (p.phone || "").replace(/\D/g, "");

    /* search_text: 모든 텍스트 필드 정규화 결합 */
    const parts = [
      p.name, p.alias, p.region, p.dept,
      p.contact_name, p.email, p.memo, phoneDigits,
      p.bank_name, p.account_holder, p.billing_email
    ];
    p.search_text = _normalize(parts.filter(Boolean).join(" "));
    return p;
  }

  /**
   * v2.2 필드 보장 — 기존 v2.1 데이터에 undefined/null 방어 + 자동 마이그레이션
   * contact → phone, note → memo 한 번만 이관
   */
  function _ensureV22Fields(p) {
    /* v2.1 contact → phone (contact이 있고 phone이 없을 때 digits 추출) */
    if (!p.phone && p.contact) {
      p.phone = (p.contact || "").replace(/\D/g, "");
    }
    /* v2.1 note → memo (note가 있고 memo가 없을 때 복사) */
    if (!p.memo && p.note) {
      p.memo = p.note;
    }
    /* 모든 신규 필드 빈 문자열 기본값 */
    p.region       = p.region       || "";
    p.dept         = p.dept         || "";
    p.contact_name = p.contact_name || "";
    p.phone        = p.phone        || "";
    p.email        = p.email        || "";
    p.alias        = p.alias        || "";
    p.memo         = p.memo         || "";
    /* v4.1 정산 정보 */
    p.bank_name      = p.bank_name      || "";
    p.account_holder = p.account_holder || "";
    p.account_number = p.account_number || "";
    p.billing_email  = p.billing_email  || "";
    /* v5.4 태그 필드 */
    p.partner_tag    = p.partner_tag    || "";
    /* v6.1 기본 거래유형 — 거래처별 자동 세팅용 */
    p.default_trade_type = p.default_trade_type || "";
    /* v6.1 주거래 플래그 — 누락 시 false로 정규화 */
    if (typeof p.is_primary !== "boolean") p.is_primary = false;
    /* 파생 필드 갱신 */
    return _buildDerived(p);
  }

  /**
   * v6.1 is_primary 정합성 정리
   * - is_primary === true 가 2개 이상이면 1개만 유지
   * - 우선순위: updated_at 최신 → 없으면 배열 마지막 항목
   * - 변경이 발생한 경우 true 반환 (호출측에서 _save 결정)
   */
  function _dedupePrimary(arr) {
    var primaries = [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].is_primary === true) primaries.push({ p: arr[i], i: i });
    }
    if (primaries.length <= 1) return false;
    /* updated_at 있는 것 우선, 그중 최신, 없으면 배열에서 마지막 등장 */
    var keepIdx = -1;
    var keepTs = "";
    for (var j = 0; j < primaries.length; j++) {
      var ts = primaries[j].p.updated_at || "";
      if (ts && ts > keepTs) { keepTs = ts; keepIdx = primaries[j].i; }
    }
    if (keepIdx < 0) keepIdx = primaries[primaries.length - 1].i;
    var changed = false;
    for (var k = 0; k < arr.length; k++) {
      if (arr[k].is_primary === true && k !== keepIdx) {
        arr[k].is_primary = false;
        changed = true;
      }
    }
    return changed;
  }

  /**
   * 자동완성 표시 포맷: "[지역] display_name (담당자)" — 빈 파트 자연스럽게 생략
   * 예: "[시흥] 대성(시흥공장) (김철수)" / "[도쿄] Mitsui (Tanaka)" / "대성금속"
   */
  function _formatDisplayLine(p) {
    const parts = [];
    if (p.region) parts.push("[" + p.region + "]");
    parts.push(p.display_name || p.name || "");
    if (p.contact_name) parts.push("(" + p.contact_name + ")");
    return parts.join(" ");
  }

  /* ══════════════════════════════════════
     CRUD
     ══════════════════════════════════════ */

  /** 전체 거래처 마스터 로드 — v2.2 자동 마이그레이션 포함 */
  function loadAll() {
    try {
      const arr = JSON.parse(GoLabStorage.getItem(MASTER_KEY) || "[]");
      /* v2.2 런타임 보정 — search_text 없는 레코드만 마이그레이션 */
      let needSave = false;
      arr.forEach(function(p) {
        if (typeof p.search_text === "undefined" || p.search_text === null) {
          _ensureV22Fields(p);
          needSave = true;
        }
      });
      if (needSave) {
        _save(arr);
        emitAudit("MIGRATE_V22", { migrated: arr.length });
      }
      /* v6.1 is_primary 중복 정리 — 세션당 1회만 (성능) */
      if (!_primaryDedupedThisSession) {
        var dedupChanged = _dedupePrimary(arr);
        if (dedupChanged) {
          _save(arr);
          emitAudit("MIGRATE_PRIMARY_DEDUP", { total: arr.length });
        }
        _primaryDedupedThisSession = true;
      }
      return arr;
    } catch { return []; }
  }

  /** 저장 */
  function _save(arr) {
    GoLabStorage.setItem(MASTER_KEY, JSON.stringify(arr));
  }

  /** 단건 조회 (by partner_id) */
  function getById(partnerId) {
    if (!partnerId) return null;
    return loadAll().find(function(x) { return x.partner_id === partnerId; }) || null;
  }

  /** 검색 — search_text 기반 (v2.2), fallback 포함 */
  function search(query) {
    if (!query || !query.trim()) return loadAll();
    const q = _normalize(query.trim());
    const all = loadAll();
    /* 정확한 name prefix 매칭 우선 → search_text contains 후순위 */
    const prefix = [];
    const contains = [];
    all.forEach(function(p) {
      const nameNorm = _normalize(p.name || "");
      /* search_text가 없으면 런타임 fallback (v2.1 데이터 안전장치) */
      const st = p.search_text || _normalize((p.name||"") + " " + (p.contact||"") + " " + (p.note||""));
      if (nameNorm.startsWith(q)) prefix.push(p);
      else if (st.includes(q)) contains.push(p);
    });
    return prefix.concat(contains);
  }

  /** 거래처 생성 — v2.2 확장 필드 포함 */
  function create(fields) {
    const partner = {
      partner_id: crypto.randomUUID(),
      name:         (fields.name || "").trim(),
      type:         fields.type || "매출처",
      /* v2.1 레거시 필드 유지 */
      contact:      (fields.contact || "").trim(),
      note:         (fields.note || "").trim(),
      /* v2.2 신규 필드 */
      region:       (fields.region || "").trim(),
      dept:         (fields.dept || "").trim(),
      contact_name: (fields.contact_name || "").trim(),
      phone:        (fields.phone || "").replace(/\D/g, ""),  /* digits only 저장 */
      email:        (fields.email || "").trim(),
      alias:        (fields.alias || "").trim(),
      memo:         (fields.memo || "").trim(),
      /* v4.1 정산 정보 */
      bank_name:      (fields.bank_name || "").trim(),
      account_holder: (fields.account_holder || "").trim(),
      account_number: (fields.account_number || "").replace(/\s/g, ""),
      billing_email:  (fields.billing_email || "").trim(),
      /* v5.4 태그 (주요거래처 분류용) */
      partner_tag:    (fields.partner_tag || "").trim(),
      /* v6.1 기본 거래유형 */
      default_trade_type: (fields.default_trade_type || "").trim(),
      /* v6.1 주거래 플래그 */
      is_primary:   fields.is_primary === true,
      created_at:   new Date().toISOString(),
      updated_at:   new Date().toISOString()
    };
    if (!partner.name) throw new Error("거래처명은 필수입니다.");
    /* 파생 필드 생성 */
    _buildDerived(partner);
    const all = loadAll();
    /* v6.1 신규 항목이 is_primary=true 면 기존 모두 false 처리 */
    if (partner.is_primary) {
      all.forEach(function(x) { if (x.is_primary) x.is_primary = false; });
    }
    all.unshift(partner);
    _save(all);
    emitAudit("CREATE", { partner_id: partner.partner_id, name: partner.name });
    /* v7.7: 통합 사건 로그 병렬 기록 — 표시용 스냅샷 동봉 */
    if (window.GoLabAuditLog) {
      GoLabAuditLog.add("PARTNER_CREATE", {
        partner_id:   partner.partner_id,
        partner_name: partner.name,
        type:         partner.type || "",
        is_primary:   !!partner.is_primary
      });
    }
    return partner;
  }

  /** 거래처 수정 — v2.2 신규 필드 + 파생 필드 재생성 */
  function update(partnerId, fields) {
    const all = loadAll();
    const idx = all.findIndex(function(x) { return x.partner_id === partnerId; });
    if (idx < 0) throw new Error("거래처를 찾을 수 없습니다: " + partnerId);
    const before = Object.assign({}, all[idx]);
    /* 기존 필드 */
    if (fields.name    !== undefined) all[idx].name    = fields.name.trim();
    if (fields.type    !== undefined) all[idx].type    = fields.type;
    if (fields.contact !== undefined) all[idx].contact = fields.contact.trim();
    if (fields.note    !== undefined) all[idx].note    = fields.note.trim();
    /* v2.2 신규 필드 */
    if (fields.region       !== undefined) all[idx].region       = fields.region.trim();
    if (fields.dept         !== undefined) all[idx].dept         = fields.dept.trim();
    if (fields.contact_name !== undefined) all[idx].contact_name = fields.contact_name.trim();
    if (fields.phone        !== undefined) all[idx].phone        = fields.phone.replace(/\D/g, "");
    if (fields.email        !== undefined) all[idx].email        = fields.email.trim();
    if (fields.alias        !== undefined) all[idx].alias        = fields.alias.trim();
    if (fields.memo         !== undefined) all[idx].memo         = fields.memo.trim();
    /* v4.1 정산 정보 */
    if (fields.bank_name      !== undefined) all[idx].bank_name      = fields.bank_name.trim();
    if (fields.account_holder !== undefined) all[idx].account_holder = fields.account_holder.trim();
    if (fields.account_number !== undefined) all[idx].account_number = fields.account_number.replace(/\s/g, "");
    if (fields.billing_email  !== undefined) all[idx].billing_email  = fields.billing_email.trim();
    /* v5.4 태그 */
    if (fields.partner_tag   !== undefined) all[idx].partner_tag   = fields.partner_tag.trim();
    /* v6.1 기본 거래유형 */
    if (fields.default_trade_type !== undefined) all[idx].default_trade_type = (fields.default_trade_type || "").trim();
    /* v6.1 주거래 플래그 — true 로 설정 시 나머지 항목 모두 false 강제 */
    if (fields.is_primary !== undefined) {
      var nextPrimary = fields.is_primary === true;
      all[idx].is_primary = nextPrimary;
      if (nextPrimary) {
        for (var pi = 0; pi < all.length; pi++) {
          if (pi !== idx && all[pi].is_primary) all[pi].is_primary = false;
        }
      }
    }
    /* updated_at 갱신 (정합성 정리 우선순위 기준) */
    all[idx].updated_at = new Date().toISOString();
    /* 파생 필드 재생성 (search_text, display_name 갱신) */
    _buildDerived(all[idx]);
    _save(all);
    emitAudit("UPDATE", { partner_id: partnerId, before: before, after: Object.assign({}, all[idx]) });
    /* v7.7: 통합 사건 로그 병렬 기록 */
    if (window.GoLabAuditLog) {
      GoLabAuditLog.add("PARTNER_EDIT", {
        partner_id:   partnerId,
        partner_name: all[idx].name,
        type:         all[idx].type || ""
      });
    }
    return all[idx];
  }

  /** 거래처 삭제 */
  function remove(partnerId) {
    const all = loadAll();
    const idx = all.findIndex(function(x) { return x.partner_id === partnerId; });
    if (idx < 0) return;
    const removed = all.splice(idx, 1)[0];
    _save(all);
    emitAudit("DELETE", { partner_id: partnerId, name: removed.name });
  }

  /* ══════════════════════════════════════
     감사 로그 (Audit)
     ══════════════════════════════════════ */

  function emitAudit(event, detail) {
    try {
      const log = JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]");
      log.push({ event: event, ts: new Date().toISOString(), detail: detail || {} });
      if (log.length > 2000) log.splice(0, log.length - 2000);
      localStorage.setItem(AUDIT_KEY, JSON.stringify(log));
    } catch { /* silent */ }
  }

  /* ══════════════════════════════════════
     CSS 주입 (공유 — item-master.js와 동일 ID 가드)
     ══════════════════════════════════════ */

  function _injectCSS() {
    if (document.getElementById("golab-ac-style")) return;
    /* item-master.js가 먼저 로드되면 이미 주입되어 있음 */
    const s = document.createElement("style");
    s.id = "golab-ac-style";
    s.textContent = `
      .golab-ac-wrap{position:relative;width:100%}
      .golab-ac-input{
        width:100%;border-radius:10px;border:1px solid var(--line,#e5e7eb);
        background:rgba(37,99,235,0.06);color:var(--text,#0f172a);
        padding:10px;font-size:12px;outline:none;transition:border .2s;
        box-sizing:border-box;
      }
      .golab-ac-input:focus{border-color:var(--point,#2563eb)}
      .golab-ac-input::placeholder{color:#94a3b8}
      .golab-ac-selected{
        display:flex;align-items:center;gap:8px;
        padding:7px 10px;border-radius:10px;border:1px solid var(--point,#2563eb);
        background:rgba(37,99,235,0.06);font-size:12px;min-height:38px;
      }
      .golab-ac-chip{font-weight:700;color:var(--point,#2563eb);flex:1}
      .golab-ac-chip-detail{color:var(--muted,#64748b);font-size:11px}
      .golab-ac-clear{
        border:none;background:transparent;color:var(--muted,#64748b);
        cursor:pointer;font-size:14px;padding:2px 6px;border-radius:6px;
      }
      .golab-ac-clear:hover{background:rgba(0,0,0,.06)}
      .golab-ac-dropdown{
        position:absolute;top:100%;left:0;right:0;
        background:var(--card,#fff);border:1px solid var(--line,#e5e7eb);
        border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);
        max-height:280px;overflow:auto;z-index:200;margin-top:4px;
      }
      .golab-ac-item{
        padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--line,#e5e7eb);
        font-size:12px;
      }
      .golab-ac-item:last-child{border-bottom:none}
      .golab-ac-item:hover,.golab-ac-item.focused{background:rgba(37,99,235,.06)}
      .golab-ac-item-name{font-weight:700;color:var(--text,#0f172a)}
      .golab-ac-item-detail{color:var(--muted,#64748b);font-size:11px;margin-top:2px}
      .golab-ac-create{color:var(--point,#2563eb);font-weight:700}
      .golab-ac-empty{padding:12px;text-align:center;color:var(--muted,#64748b);font-size:12px}
      /* 등록 모달 */
      .golab-ac-modal-back{
        position:fixed;inset:0;background:rgba(0,0,0,.35);
        display:flex;align-items:center;justify-content:center;z-index:1000;
      }
      .golab-ac-modal{
        width:min(560px,94vw);background:var(--card,#fff);
        border:1px solid var(--line,#e5e7eb);border-radius:12px;
        padding:20px;box-shadow:0 8px 30px rgba(0,0,0,.15);
      }
      .golab-ac-modal h3{margin:0 0 14px;font-size:14px;color:var(--text,#0f172a)}
      .golab-ac-modal label{display:block;font-size:11px;color:var(--muted,#64748b);margin:10px 0 4px}
      .golab-ac-modal label:first-of-type{margin-top:0}
      .golab-ac-modal input,.golab-ac-modal select,.golab-ac-modal textarea{
        width:100%;border-radius:10px;border:1px solid var(--line,#e5e7eb);
        background:var(--chip,#f8fafc);color:var(--text,#0f172a);
        padding:10px;font-size:12px;outline:none;box-sizing:border-box;
      }
      .golab-ac-modal input:focus,.golab-ac-modal select:focus{border-color:var(--point,#2563eb)}
      .golab-ac-modal textarea{min-height:36px;resize:vertical}
      .golab-ac-modal-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .golab-ac-modal-row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
      .golab-ac-modal-btns{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
      .golab-ac-modal-btns button{
        border-radius:10px;padding:10px 16px;font-size:12px;font-weight:700;cursor:pointer;
      }
    `;
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════
     자동완성 위젯 — v2.2 표기 규칙 반영
     ══════════════════════════════════════ */

  /**
   * @param {HTMLElement} container - 위젯이 삽입될 부모
   * @param {Object} opts
   *   - placeholder: string (기본: "거래처 검색...")
   *   - onSelect: function(partner)
   *   - onClear: function()
   *   - filterType: string ("매입처"|"매출처"|"겸용") — 필터링 (선택)
   * @returns {{ getValue, setValue, clear, getItem, destroy }}
   */
  function createAutocomplete(container, opts) {
    _injectCSS();
    opts = opts || {};

    let _selectedId = null;
    let _focusIdx = -1;
    let _debounce = null;
    let _items = [];

    /* ── DOM 구성 ── */
    const wrap = document.createElement("div");
    wrap.className = "golab-ac-wrap";

    /* 입력 필드 */
    const input = document.createElement("input");
    input.className = "golab-ac-input";
    input.placeholder = opts.placeholder || "거래처 검색...";
    input.autocomplete = "off";

    /* 선택된 상태 칩 */
    const selected = document.createElement("div");
    selected.className = "golab-ac-selected";
    selected.style.display = "none";

    const chip = document.createElement("span");
    chip.className = "golab-ac-chip";
    const chipDetail = document.createElement("span");
    chipDetail.className = "golab-ac-chip-detail";
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "golab-ac-clear";
    clearBtn.textContent = "\u2715";
    selected.append(chip, chipDetail, clearBtn);

    /* 드롭다운 */
    const dropdown = document.createElement("div");
    dropdown.className = "golab-ac-dropdown";
    dropdown.style.display = "none";

    wrap.append(input, selected, dropdown);
    container.appendChild(wrap);

    /* ── 이벤트 ── */

    input.addEventListener("input", function() {
      clearTimeout(_debounce);
      _debounce = setTimeout(function() { _renderDropdown(input.value); }, 150);
    });

    input.addEventListener("focus", function() {
      if (!_selectedId) _renderDropdown(input.value);
    });

    input.addEventListener("keydown", function(e) {
      if (dropdown.style.display === "none") return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        _focusIdx = Math.min(_focusIdx + 1, dropdown.children.length - 1);
        _highlightFocused();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        _focusIdx = Math.max(_focusIdx - 1, 0);
        _highlightFocused();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (_focusIdx >= 0 && _focusIdx < dropdown.children.length) {
          dropdown.children[_focusIdx].click();
        }
      } else if (e.key === "Escape") {
        _closeDropdown();
      }
    });

    clearBtn.addEventListener("click", function() {
      _selectedId = null;
      selected.style.display = "none";
      input.style.display = "";
      input.value = "";
      input.focus();
      if (opts.onClear) opts.onClear();
    });

    /* 외부 클릭 시 드롭다운 닫기 */
    document.addEventListener("mousedown", function(e) {
      if (!wrap.contains(e.target)) _closeDropdown();
    });

    /* ── 드롭다운 렌더링 — v2.2 표기 규칙 ── */

    function _renderDropdown(query) {
      var results = search(query);
      /* filterType 옵션이 있으면 해당 유형 + 겸용만 표시 */
      if (opts.filterType) {
        results = results.filter(function(p) { return p.type === opts.filterType || p.type === "겸용"; });
      }
      _items = results;
      _focusIdx = -1;
      dropdown.innerHTML = "";

      var limited = _items.slice(0, 10);
      if (limited.length === 0 && !(query || "").trim()) {
        var empty = document.createElement("div");
        empty.className = "golab-ac-empty";
        empty.textContent = "등록된 거래처가 없습니다. 아래에서 새 거래처를 등록하세요.";
        dropdown.appendChild(empty);
      }

      limited.forEach(function(partner, i) {
        var row = document.createElement("div");
        row.className = "golab-ac-item";
        row.dataset.idx = i;
        var nameEl = document.createElement("div");
        nameEl.className = "golab-ac-item-name";
        /* v2.2: "[지역] display_name (담당자)" 표기 */
        nameEl.textContent = _formatDisplayLine(partner);
        var detailEl = document.createElement("div");
        detailEl.className = "golab-ac-item-detail";
        /* v2.2: 유형 · 전화 · 이메일 */
        var detParts = [partner.type];
        if (partner.phone) detParts.push(_formatPhone(partner.phone));
        if (partner.email) detParts.push(partner.email);
        detailEl.textContent = detParts.filter(Boolean).join(" · ");
        row.append(nameEl, detailEl);
        row.addEventListener("click", function() { _selectPartner(partner); });
        dropdown.appendChild(row);
      });

      /* + 새 거래처 등록 */
      var createRow = document.createElement("div");
      createRow.className = "golab-ac-item golab-ac-create";
      var q = (query || "").trim();
      createRow.textContent = q ? "+ \uc0c8 \uac70\ub798\ucc98 \ub4f1\ub85d: \"" + q + "\"" : "+ \uc0c8 \uac70\ub798\ucc98 \ub4f1\ub85d";
      createRow.addEventListener("click", function() { _openCreateModal(q); });
      dropdown.appendChild(createRow);

      dropdown.style.display = "";
    }

    function _highlightFocused() {
      Array.from(dropdown.children).forEach(function(el, i) {
        el.classList.toggle("focused", i === _focusIdx);
      });
      var focused = dropdown.children[_focusIdx];
      if (focused) focused.scrollIntoView({ block: "nearest" });
    }

    function _closeDropdown() {
      dropdown.style.display = "none";
      _focusIdx = -1;
    }

    /** 파트너 선택 — v2.2 표기 규칙 적용 */
    function _selectPartner(partner) {
      _selectedId = partner.partner_id;
      /* v2.2: 칩에 "[지역] display_name (담당자)" 표시 */
      chip.textContent = _formatDisplayLine(partner);
      chipDetail.textContent = partner.type ? " (" + partner.type + ")" : "";
      selected.style.display = "flex";
      input.style.display = "none";
      input.value = "";
      _closeDropdown();
      if (opts.onSelect) opts.onSelect(partner);
    }

    /* ── 새 거래처 등록 모달 — v2.2 확장 필드 ── */

    function _openCreateModal(prefill) {
      _closeDropdown();

      var back = document.createElement("div");
      back.className = "golab-ac-modal-back";

      var modal = document.createElement("div");
      modal.className = "golab-ac-modal";
      modal.innerHTML =
        '<h3>\uc0c8 \uac70\ub798\ucc98 \ub4f1\ub85d</h3>' +
        /* 상단: 거래처명, 유형, 별칭 */
        '<div class="golab-ac-modal-row3">' +
          '<div><label>\uac70\ub798\ucc98\uba85 *</label>' +
            '<input id="_acp_name" value="' + _escHtml(prefill) + '" placeholder="\uc608: \ub300\uc131\uae08\uc18d" /></div>' +
          '<div><label>\uc720\ud615</label>' +
            '<select id="_acp_type"><option value="\ub9e4\ucd9c\ucc98" selected>\ub9e4\ucd9c\ucc98</option>' +
            '<option value="\ub9e4\uc785\ucc98">\ub9e4\uc785\ucc98</option>' +
            '<option value="\uacb8\uc6a9">\uacb8\uc6a9</option></select></div>' +
          '<div><label>\ubcc4\uce6d</label>' +
            '<input id="_acp_alias" placeholder="\uc608: \uc2dc\ud765\uacf5\uc7a5" /></div>' +
        '</div>' +
        /* 중단: 지역, 담당자, 전화 */
        '<div class="golab-ac-modal-row3">' +
          '<div><label>\uc9c0\uc5ed</label>' +
            '<input id="_acp_region" placeholder="\uc608: \uc2dc\ud765, \ub3c4\ucfc4" /></div>' +
          '<div><label>\ub2f4\ub2f9\uc790\uba85</label>' +
            '<input id="_acp_contact_name" placeholder="\uc608: \uae40\ucca0\uc218" /></div>' +
          '<div><label>\uc804\ud654\ubc88\ud638</label>' +
            '<input id="_acp_phone" placeholder="\uc608: 01012345678" /></div>' +
        '</div>' +
        /* 하단: 부서, 이메일 */
        '<div class="golab-ac-modal-row">' +
          '<div><label>\ubd80\uc11c</label>' +
            '<input id="_acp_dept" placeholder="\uc608: \uc601\uc5c51\ud300" /></div>' +
          '<div><label>\uc774\uba54\uc77c</label>' +
            '<input id="_acp_email" placeholder="\uc608: kim@company.com" type="email" /></div>' +
        '</div>' +
        /* 메모 */
        '<label>\uba54\ubaa8</label>' +
        '<textarea id="_acp_memo" placeholder="\uba54\ubaa8"></textarea>' +
        '<div class="golab-ac-modal-btns">' +
          '<button type="button" id="_acp_cancel" style="border:1px solid var(--line);background:var(--card);color:var(--text)">\ucde8\uc18c</button>' +
          '<button type="button" id="_acp_save" style="background:var(--point);border:none;color:#fff">\ub4f1\ub85d</button>' +
        '</div>';

      back.appendChild(modal);
      document.body.appendChild(back);

      /* 포커스 */
      var nameInput = modal.querySelector("#_acp_name");
      setTimeout(function() { nameInput.focus(); }, 50);

      /* 취소 */
      var cancel = function() { document.body.removeChild(back); };
      modal.querySelector("#_acp_cancel").addEventListener("click", cancel);
      back.addEventListener("click", function(e) { if (e.target === back) cancel(); });

      /* 저장 — v2.2 전체 필드 수집 */
      modal.querySelector("#_acp_save").addEventListener("click", function() {
        var name = nameInput.value.trim();
        if (!name) { alert("\uac70\ub798\ucc98\uba85\uc744 \uc785\ub825\ud574\uc8fc\uc138\uc694."); nameInput.focus(); return; }
        try {
          var newPartner = create({
            name:         name,
            type:         modal.querySelector("#_acp_type").value,
            alias:        modal.querySelector("#_acp_alias").value,
            region:       modal.querySelector("#_acp_region").value,
            contact_name: modal.querySelector("#_acp_contact_name").value,
            phone:        modal.querySelector("#_acp_phone").value,
            dept:         modal.querySelector("#_acp_dept").value,
            email:        modal.querySelector("#_acp_email").value,
            memo:         modal.querySelector("#_acp_memo").value
          });
          document.body.removeChild(back);
          _selectPartner(newPartner);
        } catch (err) {
          alert("\ub4f1\ub85d \uc2e4\ud328: " + err.message);
        }
      });

      /* Enter → 저장 (textarea 제외) */
      modal.addEventListener("keydown", function(e) {
        if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") {
          e.preventDefault();
          modal.querySelector("#_acp_save").click();
        }
        if (e.key === "Escape") cancel();
      });
    }

    function _escHtml(s) {
      return (s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }

    /* ── 외부 API ── */

    return {
      /** 현재 선택된 partner_id 반환 (없으면 null) */
      getValue: function() { return _selectedId; },

      /** partner_id로 선택 상태 설정 */
      setValue: function(partnerId) {
        var partner = getById(partnerId);
        if (partner) _selectPartner(partner);
      },

      /** 선택된 거래처 객체 반환 */
      getItem: function() { return _selectedId ? getById(_selectedId) : null; },

      /** 선택 해제 */
      clear: function() {
        _selectedId = null;
        selected.style.display = "none";
        input.style.display = "";
        input.value = "";
        _closeDropdown();
      },

      /** 위젯 제거 */
      destroy: function() {
        wrap.remove();
      }
    };
  }

  /* ══════════════════════════════════════
     마이그레이션 (매출 데이터 → 거래처 마스터)
     ══════════════════════════════════════ */

  function migrateFromSales() {
    var master = loadAll();
    var masterByName = new Map(master.map(function(m) { return [(m.name || "").trim().toLowerCase(), m]; }));

    var created = 0;
    var existing = master.length;

    /* Phase 1: 매출(sales) → unique client 추출 → 마스터 생성 */
    var SALES_KEY = "golab_sales_v1";
    var sales = [];
    try { sales = JSON.parse(localStorage.getItem(SALES_KEY) || "[]"); } catch {}

    var uniqueClients = new Set();
    sales.forEach(function(rec) {
      var client = (rec.client || rec.clientName || "").trim();
      if (client) uniqueClients.add(client);
    });

    uniqueClients.forEach(function(client) {
      var nameKey = client.toLowerCase();
      if (masterByName.has(nameKey)) return;
      var p = {
        partner_id: crypto.randomUUID(),
        name:       client,
        type:       "매출처",
        contact:    "",
        note:       "매출에서 마이그레이션",
        /* v2.2 기본값 */
        region: "", dept: "", contact_name: "", phone: "", email: "", alias: "", memo: "",
        created_at: new Date().toISOString()
      };
      _buildDerived(p);
      master.push(p);
      masterByName.set(nameKey, p);
      created++;
    });

    /* Phase 2: 매출 레코드에 partner_id backfill */
    var backfilled = 0;
    var salesChanged = false;

    sales.forEach(function(rec) {
      if (rec.partner_id) return;
      var client = (rec.client || rec.clientName || "").trim().toLowerCase();
      var m = masterByName.get(client);
      if (m) {
        rec.partner_id = m.partner_id;
        backfilled++;
        salesChanged = true;
      }
    });

    if (salesChanged) localStorage.setItem(SALES_KEY, JSON.stringify(sales));

    /* 마스터 저장 */
    _save(master);

    var result = { created: created, existing: existing, total: master.length, backfilled: backfilled };
    emitAudit("MIGRATION", result);
    return result;
  }

  /* ══════════════════════════════════════
     이름 정규화 + 이름 기반 조회
     ══════════════════════════════════════ */

  /** 거래처명 정규화 — 공백/(주)/대소문자/특수문자 제거 */
  function _normalize(s){
    return (s||"").toLowerCase().replace(/\s+/g,"")
      .replace(/[()（）\[\]]/g,"")
      .replace(/주식회사|주/g,"")
      .replace(/co\.?|ltd\.?|inc\.?|corp\.?/gi,"")
      .replace(/[.,·\-_]/g,"").trim();
  }

  /** 이름으로 파트너 조회 — 정확 매칭 → 정규화 매칭 순서 */
  function findByName(name){
    if(!name) return null;
    var all = loadAll();
    /* 1순위: 정확 매칭 */
    var exact = all.find(function(p) { return p.name === name; });
    if(exact) return exact;
    /* 2순위: 정규화 매칭 */
    var norm = _normalize(name);
    if(!norm) return null;
    return all.find(function(p) { return _normalize(p.name) === norm; }) || null;
  }

  /* ══════════════════════════════════════
     일괄 생성 — console 미등록 거래처 일괄 등록용
     ══════════════════════════════════════ */

  function batchCreate(nameList, defaultType) {
    if (!nameList || !nameList.length) return { created: 0, skipped: 0 };
    var master = loadAll();
    var normMap = new Map(master.map(function(p) { return [_normalize(p.name), p]; }));
    var created = 0, skipped = 0;
    nameList.forEach(function(name) {
      var n = (name || "").trim();
      if (!n) { skipped++; return; }
      var norm = _normalize(n);
      if (normMap.has(norm)) { skipped++; return; }
      var p = {
        partner_id: crypto.randomUUID(),
        name: n,
        type: defaultType || "미분류",
        contact: "",
        note: "미등록 일괄 등록",
        /* v2.2 기본값 */
        region: "", dept: "", contact_name: "", phone: "", email: "", alias: "", memo: "",
        created_at: new Date().toISOString()
      };
      _buildDerived(p);
      master.unshift(p);
      normMap.set(norm, p);
      created++;
    });
    _save(master);
    if (created > 0) emitAudit("BATCH_CREATE", { created: created, skipped: skipped, total: master.length });
    return { created: created, skipped: skipped };
  }

  /* ══════════════════════════════════════
     거래처별 통계 집계 — v5.4: golab_trade_v2 단일 SSoT
     ══════════════════════════════════════ */

  /**
   * 거래처별 실무 통계 — 상태창에서 호출
   * golab_trade_v2 (GoLabTradeEngine) 단일 기준
   * @param {string} partnerId
   * @returns {Object} 통합 통계 (totalAmount, receivable, txCount, recentDeals 등)
   */
  function calcPartnerStats(partnerId) {
    if (!partnerId) return _emptyStats();

    var TE = window.GoLabTradeEngine;
    if (!TE) return _emptyStats();

    /* golab_trade_v2 기반 집계 */
    var allTrades = TE.loadAll();
    var partnerDeals = allTrades.filter(function(t) {
      return t.partner_id === partnerId && t.deal_status !== "cancelled";
    });

    /* 정렬: deal_date 내림차순 (없으면 quote_at → created_at) */
    partnerDeals.sort(function(a, b) {
      var dateA = a.deal_date || a.quote_at || a.created_at || "";
      var dateB = b.deal_date || b.quote_at || b.created_at || "";
      return dateB.localeCompare(dateA);
    });

    /* 집계 — calcTrade 엔진 활용 */
    var totalAmount = 0;
    var receivableAmount = 0;
    var receivableCount = 0;
    var completeCount = 0;
    var activeCount = 0;

    partnerDeals.forEach(function(t) {
      var calc = TE.calcTrade(t);
      var amt = calc.total_supply;
      totalAmount += amt;
      /* 미입금: invoice_at 있고 payment_at 없는 건 */
      if (t.invoice_at && !t.payment_at) {
        receivableAmount += amt;
        receivableCount++;
      }
      if (t.deal_status === "completed") completeCount++;
      else activeCount++;
    });

    var latestDeal = partnerDeals[0] || null;
    var recentDeals = partnerDeals.slice(0, 5);

    return {
      totalAmount:      totalAmount,
      receivableAmount: receivableAmount,
      receivableCount:  receivableCount,
      txCount:          partnerDeals.length,
      completeCount:    completeCount,
      activeCount:      activeCount,
      latestDeal:       latestDeal,
      recentDeals:      recentDeals,
      useSalesFallback: false
    };
  }

  /** 빈 통계 객체 (partner_id 없을 때 방어) */
  function _emptyStats() {
    return {
      totalAmount: 0, receivableAmount: 0, receivableCount: 0,
      txCount: 0, completeCount: 0, activeCount: 0,
      latestDeal: null, recentDeals: [], useSalesFallback: false
    };
  }

  /* ══════════════════════════════════════
     Public API
     ══════════════════════════════════════ */

  return {
    MASTER_KEY: MASTER_KEY,
    AUDIT_KEY: AUDIT_KEY,
    TYPES: TYPES,
    loadAll: loadAll,
    getById: getById,
    search: search,
    findByName: findByName,
    normalize: _normalize,
    create: create,
    update: update,
    remove: remove,
    batchCreate: batchCreate,
    emitAudit: emitAudit,
    createAutocomplete: createAutocomplete,
    migrateFromSales: migrateFromSales,
    /* v2.2 신규 공개 API */
    formatPhone: _formatPhone,
    formatDisplayLine: _formatDisplayLine,
    calcPartnerStats: calcPartnerStats
  };

})();
