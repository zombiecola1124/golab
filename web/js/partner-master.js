/**
 * GoLab v2.1 — 거래처 마스터 + 자동완성 공유 모듈
 *
 * 사용법: <script src="js/partner-master.js"></script>
 *         GoLabPartnerMaster.loadAll()
 *         GoLabPartnerMaster.createAutocomplete(container, options)
 *         GoLabPartnerMaster.migrateFromSales()
 *
 * localStorage 키:
 *   golab_partner_master_v1  — 거래처 마스터 배열
 *   golab_partner_master_audit — 감사 로그
 */
window.GoLabPartnerMaster = (function () {
  "use strict";

  const MASTER_KEY = "golab_partner_master_v1";
  const AUDIT_KEY  = "golab_partner_master_audit";

  /* ── 거래처 유형 ── */
  const TYPES = ["매입처", "매출처", "겸용"];

  /* ══════════════════════════════════════
     CRUD
     ══════════════════════════════════════ */

  /** 전체 거래처 마스터 로드 */
  function loadAll() {
    try { return JSON.parse(localStorage.getItem(MASTER_KEY) || "[]"); }
    catch { return []; }
  }

  /** 저장 */
  function _save(arr) {
    localStorage.setItem(MASTER_KEY, JSON.stringify(arr));
  }

  /** 단건 조회 (by partner_id) */
  function getById(partnerId) {
    if (!partnerId) return null;
    return loadAll().find(x => x.partner_id === partnerId) || null;
  }

  /** 이름/연락처/비고 검색 (부분 매칭, 대소문자 무시) */
  function search(query) {
    if (!query || !query.trim()) return loadAll();
    const q = query.trim().toLowerCase();
    const all = loadAll();
    // 정확한 prefix 매칭 우선 → contains 매칭 후순위
    const prefix = [];
    const contains = [];
    all.forEach(p => {
      const name    = (p.name || "").toLowerCase();
      const contact = (p.contact || "").toLowerCase();
      const note    = (p.note || "").toLowerCase();
      const combined = name + " " + contact + " " + note;
      if (name.startsWith(q)) prefix.push(p);
      else if (combined.includes(q)) contains.push(p);
    });
    return prefix.concat(contains);
  }

  /** 거래처 생성 */
  function create(fields) {
    const partner = {
      partner_id: crypto.randomUUID(),
      name:       (fields.name || "").trim(),
      type:       fields.type || "매출처",
      contact:    (fields.contact || "").trim(),
      note:       (fields.note || "").trim(),
      created_at: new Date().toISOString()
    };
    if (!partner.name) throw new Error("거래처명은 필수입니다.");
    const all = loadAll();
    all.unshift(partner);
    _save(all);
    emitAudit("CREATE", { partner_id: partner.partner_id, name: partner.name });
    return partner;
  }

  /** 거래처 수정 */
  function update(partnerId, fields) {
    const all = loadAll();
    const idx = all.findIndex(x => x.partner_id === partnerId);
    if (idx < 0) throw new Error("거래처를 찾을 수 없습니다: " + partnerId);
    const before = { ...all[idx] };
    if (fields.name    !== undefined) all[idx].name    = fields.name.trim();
    if (fields.type    !== undefined) all[idx].type    = fields.type;
    if (fields.contact !== undefined) all[idx].contact = fields.contact.trim();
    if (fields.note    !== undefined) all[idx].note    = fields.note.trim();
    _save(all);
    emitAudit("UPDATE", { partner_id: partnerId, before, after: { ...all[idx] } });
    return all[idx];
  }

  /** 거래처 삭제 */
  function remove(partnerId) {
    const all = loadAll();
    const idx = all.findIndex(x => x.partner_id === partnerId);
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
      log.push({ event, ts: new Date().toISOString(), detail: detail || {} });
      if (log.length > 2000) log.splice(0, log.length - 2000);
      localStorage.setItem(AUDIT_KEY, JSON.stringify(log));
    } catch { /* silent */ }
  }

  /* ══════════════════════════════════════
     CSS 주입 (공유 — item-master.js와 동일 ID 가드)
     ══════════════════════════════════════ */

  function _injectCSS() {
    if (document.getElementById("golab-ac-style")) return;
    // item-master.js가 먼저 로드되면 이미 주입되어 있음
    // 만약 이 모듈이 먼저 로드되면 동일 CSS를 주입
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
        width:min(440px,92vw);background:var(--card,#fff);
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
      .golab-ac-modal-btns{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
      .golab-ac-modal-btns button{
        border-radius:10px;padding:10px 16px;font-size:12px;font-weight:700;cursor:pointer;
      }
    `;
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════
     자동완성 위젯
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

    // 입력 필드
    const input = document.createElement("input");
    input.className = "golab-ac-input";
    input.placeholder = opts.placeholder || "거래처 검색...";
    input.autocomplete = "off";

    // 선택된 상태 칩
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

    // 드롭다운
    const dropdown = document.createElement("div");
    dropdown.className = "golab-ac-dropdown";
    dropdown.style.display = "none";

    wrap.append(input, selected, dropdown);
    container.appendChild(wrap);

    /* ── 이벤트 ── */

    input.addEventListener("input", () => {
      clearTimeout(_debounce);
      _debounce = setTimeout(() => _renderDropdown(input.value), 150);
    });

    input.addEventListener("focus", () => {
      if (!_selectedId) _renderDropdown(input.value);
    });

    input.addEventListener("keydown", (e) => {
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

    clearBtn.addEventListener("click", () => {
      _selectedId = null;
      selected.style.display = "none";
      input.style.display = "";
      input.value = "";
      input.focus();
      if (opts.onClear) opts.onClear();
    });

    // 외부 클릭 시 드롭다운 닫기
    document.addEventListener("mousedown", (e) => {
      if (!wrap.contains(e.target)) _closeDropdown();
    });

    /* ── 드롭다운 렌더링 ── */

    function _renderDropdown(query) {
      let results = search(query);
      // filterType 옵션이 있으면 해당 유형 + 겸용만 표시
      if (opts.filterType) {
        results = results.filter(p => p.type === opts.filterType || p.type === "겸용");
      }
      _items = results;
      _focusIdx = -1;
      dropdown.innerHTML = "";

      const limited = _items.slice(0, 10);
      if (limited.length === 0 && !(query || "").trim()) {
        const empty = document.createElement("div");
        empty.className = "golab-ac-empty";
        empty.textContent = "등록된 거래처가 없습니다. 아래에서 새 거래처를 등록하세요.";
        dropdown.appendChild(empty);
      }

      limited.forEach((partner, i) => {
        const row = document.createElement("div");
        row.className = "golab-ac-item";
        row.dataset.idx = i;
        const nameEl = document.createElement("div");
        nameEl.className = "golab-ac-item-name";
        nameEl.textContent = partner.name;
        const detailEl = document.createElement("div");
        detailEl.className = "golab-ac-item-detail";
        const parts = [partner.type, partner.contact].filter(Boolean);
        detailEl.textContent = parts.join(" · ");
        row.append(nameEl, detailEl);
        row.addEventListener("click", () => _selectPartner(partner));
        dropdown.appendChild(row);
      });

      // + 새 거래처 등록
      const createRow = document.createElement("div");
      createRow.className = "golab-ac-item golab-ac-create";
      const q = (query || "").trim();
      createRow.textContent = q ? `+ 새 거래처 등록: "${q}"` : "+ 새 거래처 등록";
      createRow.addEventListener("click", () => _openCreateModal(q));
      dropdown.appendChild(createRow);

      dropdown.style.display = "";
    }

    function _highlightFocused() {
      Array.from(dropdown.children).forEach((el, i) => {
        el.classList.toggle("focused", i === _focusIdx);
      });
      const focused = dropdown.children[_focusIdx];
      if (focused) focused.scrollIntoView({ block: "nearest" });
    }

    function _closeDropdown() {
      dropdown.style.display = "none";
      _focusIdx = -1;
    }

    function _selectPartner(partner) {
      _selectedId = partner.partner_id;
      chip.textContent = partner.name;
      chipDetail.textContent = partner.type ? " (" + partner.type + ")" : "";
      selected.style.display = "flex";
      input.style.display = "none";
      input.value = "";
      _closeDropdown();
      if (opts.onSelect) opts.onSelect(partner);
    }

    /* ── 새 거래처 등록 모달 ── */

    function _openCreateModal(prefill) {
      _closeDropdown();

      const back = document.createElement("div");
      back.className = "golab-ac-modal-back";

      const modal = document.createElement("div");
      modal.className = "golab-ac-modal";
      modal.innerHTML = `
        <h3>새 거래처 등록</h3>
        <label>거래처명 *</label>
        <input id="_acp_name" value="${_escHtml(prefill)}" placeholder="예: 대성금속" />
        <label>유형</label>
        <select id="_acp_type">
          <option value="매출처" selected>매출처</option>
          <option value="매입처">매입처</option>
          <option value="겸용">겸용</option>
        </select>
        <label>연락처</label>
        <input id="_acp_contact" placeholder="예: 010-1234-5678" />
        <label>비고</label>
        <textarea id="_acp_note" placeholder="메모"></textarea>
        <div class="golab-ac-modal-btns">
          <button type="button" id="_acp_cancel" style="border:1px solid var(--line);background:var(--card);color:var(--text)">취소</button>
          <button type="button" id="_acp_save" style="background:var(--point);border:none;color:#fff">등록</button>
        </div>
      `;

      back.appendChild(modal);
      document.body.appendChild(back);

      // 포커스
      const nameInput = modal.querySelector("#_acp_name");
      setTimeout(() => nameInput.focus(), 50);

      // 취소
      const cancel = () => { document.body.removeChild(back); };
      modal.querySelector("#_acp_cancel").addEventListener("click", cancel);
      back.addEventListener("click", (e) => { if (e.target === back) cancel(); });

      // 저장
      modal.querySelector("#_acp_save").addEventListener("click", () => {
        const name = nameInput.value.trim();
        if (!name) { alert("거래처명을 입력해주세요."); nameInput.focus(); return; }
        try {
          const newPartner = create({
            name:    name,
            type:    modal.querySelector("#_acp_type").value,
            contact: modal.querySelector("#_acp_contact").value,
            note:    modal.querySelector("#_acp_note").value
          });
          document.body.removeChild(back);
          _selectPartner(newPartner);
        } catch (err) {
          alert("등록 실패: " + err.message);
        }
      });

      // Enter → 저장
      modal.addEventListener("keydown", (e) => {
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
      getValue() { return _selectedId; },

      /** partner_id로 선택 상태 설정 */
      setValue(partnerId) {
        const partner = getById(partnerId);
        if (partner) _selectPartner(partner);
      },

      /** 선택된 거래처 객체 반환 */
      getItem() { return _selectedId ? getById(_selectedId) : null; },

      /** 선택 해제 */
      clear() {
        _selectedId = null;
        selected.style.display = "none";
        input.style.display = "";
        input.value = "";
        _closeDropdown();
      },

      /** 위젯 제거 */
      destroy() {
        wrap.remove();
      }
    };
  }

  /* ══════════════════════════════════════
     마이그레이션 (매출 데이터 → 거래처 마스터)
     ══════════════════════════════════════ */

  function migrateFromSales() {
    const master = loadAll();
    const masterByName = new Map(master.map(m => [(m.name || "").trim().toLowerCase(), m]));

    let created = 0;
    const existing = master.length;

    /* Phase 1: 매출(sales) → unique client 추출 → 마스터 생성 */
    const SALES_KEY = "golab_sales_v1";
    let sales = [];
    try { sales = JSON.parse(localStorage.getItem(SALES_KEY) || "[]"); } catch {}

    const uniqueClients = new Set();
    sales.forEach(rec => {
      const client = (rec.client || rec.clientName || "").trim();
      if (client) uniqueClients.add(client);
    });

    uniqueClients.forEach(client => {
      const nameKey = client.toLowerCase();
      if (masterByName.has(nameKey)) return;
      const p = {
        partner_id: crypto.randomUUID(),
        name:       client,
        type:       "매출처",
        contact:    "",
        note:       "매출에서 마이그레이션",
        created_at: new Date().toISOString()
      };
      master.push(p);
      masterByName.set(nameKey, p);
      created++;
    });

    /* Phase 2: 매출 레코드에 partner_id backfill */
    let backfilled = 0;
    let salesChanged = false;

    sales.forEach(rec => {
      if (rec.partner_id) return; // 이미 있음 — skip
      const client = (rec.client || rec.clientName || "").trim().toLowerCase();
      const m = masterByName.get(client);
      if (m) {
        rec.partner_id = m.partner_id;
        backfilled++;
        salesChanged = true;
      }
    });

    if (salesChanged) localStorage.setItem(SALES_KEY, JSON.stringify(sales));

    /* 마스터 저장 */
    _save(master);

    const result = {
      created,
      existing,
      total: master.length,
      backfilled
    };
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
    const all = loadAll();
    // 1순위: 정확 매칭
    const exact = all.find(p => p.name === name);
    if(exact) return exact;
    // 2순위: 정규화 매칭
    const norm = _normalize(name);
    if(!norm) return null;
    return all.find(p => _normalize(p.name) === norm) || null;
  }

  /* ══════════════════════════════════════
     Public API
     ══════════════════════════════════════ */

  /** 일괄 생성 (pre-backup 포함) — console 미등록 거래처 일괄 등록용 */
  function batchCreate(nameList, defaultType) {
    if (!nameList || !nameList.length) return { created: 0, skipped: 0 };
    const master = loadAll();
    const normMap = new Map(master.map(p => [_normalize(p.name), p]));
    let created = 0, skipped = 0;
    nameList.forEach(name => {
      const n = (name || "").trim();
      if (!n) { skipped++; return; }
      const norm = _normalize(n);
      if (normMap.has(norm)) { skipped++; return; }
      const p = {
        partner_id: crypto.randomUUID(),
        name: n,
        type: defaultType || "미분류",
        contact: "",
        note: "미등록 일괄 등록",
        created_at: new Date().toISOString()
      };
      master.unshift(p);
      normMap.set(norm, p);
      created++;
    });
    _save(master);
    if (created > 0) emitAudit("BATCH_CREATE", { created, skipped, total: master.length });
    return { created, skipped };
  }

  return {
    MASTER_KEY, AUDIT_KEY, TYPES,
    loadAll, getById, search, findByName, normalize: _normalize,
    create, update, remove, batchCreate,
    emitAudit,
    createAutocomplete,
    migrateFromSales
  };

})();
