/**
 * GoLab v2.0+ — 품목 마스터 + 자동완성 공유 모듈
 *
 * 사용법: <script src="js/item-master.js"></script>
 *         GoLabItemMaster.loadAll()
 *         GoLabItemMaster.createAutocomplete(container, options)
 *         GoLabItemMaster.migrateFromExisting()
 *         GoLabItemMaster.calcItemStats(itemId)
 *         GoLabItemMaster.extractUnlinkedItems()
 *         GoLabItemMaster.linkItemToTrades(itemId, namePattern)
 *
 * localStorage 키:
 *   golab_item_master_v1  — 품목 마스터 배열
 *   golab_item_master_audit — 감사 로그
 *
 * Phase 1 확장 (v3.6):
 *   - 필드 추가: aliases[], unit, updated_at
 *   - calcItemStats(): 품목별 거래 통계 (매입처/매출처 집계)
 *   - extractUnlinkedItems(): 미연결 거래 품목 추출
 *   - linkItemToTrades(): 미연결 거래에 item_id 일괄 연결
 */
window.GoLabItemMaster = (function () {
  "use strict";

  const MASTER_KEY = "golab_item_master_v1";
  const AUDIT_KEY  = "golab_item_master_audit";

  /* ── 카테고리 매핑 ── */
  const CATEGORY_MAP = {
    general_goods:  "일반상품",
    metal_material: "원료",
    equipment:      "장비"
  };
  const CATEGORY_REVERSE = {
    "일반상품": "general_goods",
    "원료":     "metal_material",
    "장비":     "equipment"
  };
  const CATEGORIES = ["원료", "장비", "일반상품"];

  /* ══════════════════════════════════════
     CRUD
     ══════════════════════════════════════ */

  /** 전체 품목 마스터 로드 */
  function loadAll() {
    try { return JSON.parse(GoLabStorage.getItem(MASTER_KEY) || "[]"); }
    catch { return []; }
  }

  /** 저장 */
  function _save(arr) {
    GoLabStorage.setItem(MASTER_KEY, JSON.stringify(arr));
  }

  /** 단건 조회 (by item_id) */
  function getById(itemId) {
    if (!itemId) return null;
    return loadAll().find(x => x.item_id === itemId) || null;
  }

  /** 이름으로 검색 (부분 매칭, 대소문자 무시, aliases/메모/매입처/판매처 포함) */
  function search(query) {
    if (!query || !query.trim()) return loadAll();
    const q = query.trim().toLowerCase();
    const all = loadAll();
    /* v3.10: 검색 범위 확장 — 품목명, 별칭, 규격, 매입처(참고), 메모 */
    const prefix = [];
    const contains = [];
    all.forEach(item => {
      const name = (item.item_name || "").toLowerCase();
      const brand = (item.brand || "").toLowerCase();
      const spec = (item.spec || "").toLowerCase();
      const supplier = (item.supplier || "").toLowerCase();
      const aliasStr = (item.aliases || []).join(" ").toLowerCase();
      const note = (item.note || "").toLowerCase();
      const combined = name + " " + brand + " " + spec + " " + supplier + " " + aliasStr + " " + note;
      if (name.startsWith(q)) prefix.push(item);
      else if (combined.includes(q)) contains.push(item);
    });
    return prefix.concat(contains);
  }

  /** 가격 파싱 헬퍼: 유효한 숫자면 number, 아니면 null */
  function _parsePrice(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }

  /* ── 기준 가격 필드 목록 (v3.12: 전략 가격 3종으로 정리) ── */
  const PRICE_FIELDS = [
    "rrp_price",          /* 소비자가 (RRP) — 구 consumer_price */
    "dealer_price",       /* 딜러가 (B2B 기준) */
    "target_buy_price"    /* 목표매입가 */
  ];

  /** 품목 생성 (v3.6a: 기준 가격 + 택배 조건 추가) */
  function create(fields) {
    const now = new Date().toISOString();
    const item = {
      item_id:    crypto.randomUUID(),
      item_name:  (fields.item_name || "").trim(),
      brand:      (fields.brand || "").trim(),
      category:   fields.category || "일반상품",
      spec:       (fields.spec || "").trim(),
      supplier:   (fields.supplier || "").trim(),
      note:       (fields.note || "").trim(),
      aliases:    Array.isArray(fields.aliases) ? fields.aliases : [],
      unit:       (fields.unit || "").trim(),
      /* v3.12: 전략 가격 3종 (선택 입력, null = 미입력) */
      rrp_price:          _parsePrice(fields.rrp_price),
      dealer_price:       _parsePrice(fields.dealer_price),
      target_buy_price:   _parsePrice(fields.target_buy_price),
      /* v3.6a: 택배 조건 */
      shipping_included_default: !!fields.shipping_included_default,
      shipping_note:      (fields.shipping_note || "").trim(),
      created_at: now,
      updated_at: now
    };
    if (!item.item_name) throw new Error("품목명은 필수입니다.");
    const all = loadAll();
    all.unshift(item);
    _save(all);
    emitAudit("CREATE", { item_id: item.item_id, item_name: item.item_name });
    return item;
  }

  /** 품목 수정 (v3.6a: 기준 가격 + 택배 조건 추가) */
  function update(itemId, fields) {
    const all = loadAll();
    const idx = all.findIndex(x => x.item_id === itemId);
    if (idx < 0) throw new Error("품목을 찾을 수 없습니다: " + itemId);
    const before = { ...all[idx] };
    if (fields.item_name !== undefined) all[idx].item_name = fields.item_name.trim();
    if (fields.brand     !== undefined) all[idx].brand     = (fields.brand || "").trim();
    if (fields.category  !== undefined) all[idx].category  = fields.category;
    if (fields.spec      !== undefined) all[idx].spec      = fields.spec.trim();
    if (fields.supplier  !== undefined) all[idx].supplier  = fields.supplier.trim();
    if (fields.note      !== undefined) all[idx].note      = fields.note.trim();
    if (fields.aliases   !== undefined) all[idx].aliases   = Array.isArray(fields.aliases) ? fields.aliases : [];
    if (fields.unit      !== undefined) all[idx].unit      = (fields.unit || "").trim();
    /* v3.6a: 기준 가격 필드 */
    PRICE_FIELDS.forEach(function(f) {
      if (fields[f] !== undefined) all[idx][f] = _parsePrice(fields[f]);
    });
    /* v3.6a: 택배 조건 */
    if (fields.shipping_included_default !== undefined) all[idx].shipping_included_default = !!fields.shipping_included_default;
    if (fields.shipping_note !== undefined) all[idx].shipping_note = (fields.shipping_note || "").trim();
    all[idx].updated_at = new Date().toISOString();
    _save(all);
    emitAudit("UPDATE", { item_id: itemId, before, after: { ...all[idx] } });
    return all[idx];
  }

  /** 품목 삭제 */
  function remove(itemId) {
    const all = loadAll();
    const idx = all.findIndex(x => x.item_id === itemId);
    if (idx < 0) return;
    const removed = all.splice(idx, 1)[0];
    _save(all);
    emitAudit("DELETE", { item_id: itemId, item_name: removed.item_name });
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
     CSS 주입 (1회)
     ══════════════════════════════════════ */

  function _injectCSS() {
    if (document.getElementById("golab-ac-style")) return;
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
      /* Last Deal 카드 */
      .golab-last-deal-card{
        margin-top:8px;padding:10px 12px;border-radius:10px;
        border:1px solid var(--line,#e5e7eb);background:var(--chip,#f8fafc);
        font-size:12px;line-height:1.6;
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
   *   - placeholder: string
   *   - onSelect: function(item)
   *   - onClear: function()
   *   - required: boolean (기본 true)
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
    input.placeholder = opts.placeholder || "품목 검색...";
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
      _items = search(query);
      _focusIdx = -1;
      dropdown.innerHTML = "";

      const limited = _items.slice(0, 10);
      if (limited.length === 0 && !(query || "").trim()) {
        // 마스터가 비어있을 때
        const empty = document.createElement("div");
        empty.className = "golab-ac-empty";
        empty.textContent = "등록된 품목이 없습니다. 아래에서 새 품목을 등록하세요.";
        dropdown.appendChild(empty);
      }

      limited.forEach((item, i) => {
        const row = document.createElement("div");
        row.className = "golab-ac-item";
        row.dataset.idx = i;
        const nameEl = document.createElement("div");
        nameEl.className = "golab-ac-item-name";
        nameEl.textContent = item.item_name;
        const detailEl = document.createElement("div");
        detailEl.className = "golab-ac-item-detail";
        const parts = [item.spec, item.supplier, item.category].filter(Boolean);
        detailEl.textContent = parts.join(" / ");
        row.append(nameEl, detailEl);
        row.addEventListener("click", () => _selectItem(item));
        dropdown.appendChild(row);
      });

      // + 새 품목 등록
      const createRow = document.createElement("div");
      createRow.className = "golab-ac-item golab-ac-create";
      const q = (query || "").trim();
      createRow.textContent = q ? `+ 새 품목 등록: "${q}"` : "+ 새 품목 등록";
      createRow.addEventListener("click", () => _openCreateModal(q));
      dropdown.appendChild(createRow);

      dropdown.style.display = "";
    }

    function _highlightFocused() {
      Array.from(dropdown.children).forEach((el, i) => {
        el.classList.toggle("focused", i === _focusIdx);
      });
      // 스크롤 조정
      const focused = dropdown.children[_focusIdx];
      if (focused) focused.scrollIntoView({ block: "nearest" });
    }

    function _closeDropdown() {
      dropdown.style.display = "none";
      _focusIdx = -1;
    }

    function _selectItem(item) {
      _selectedId = item.item_id;
      chip.textContent = item.item_name;
      const parts = [item.spec, item.supplier, item.category].filter(Boolean);
      chipDetail.textContent = parts.length ? " (" + parts.join(" / ") + ")" : "";
      selected.style.display = "flex";
      input.style.display = "none";
      input.value = "";
      _closeDropdown();
      if (opts.onSelect) opts.onSelect(item);
    }

    /* ── 새 품목 등록 모달 ── */

    function _openCreateModal(prefill) {
      _closeDropdown();

      const back = document.createElement("div");
      back.className = "golab-ac-modal-back";

      const modal = document.createElement("div");
      modal.className = "golab-ac-modal";
      modal.innerHTML = `
        <h3>새 품목 등록</h3>
        <label>품목명 *</label>
        <input id="_acm_name" value="${_escHtml(prefill)}" placeholder="예: Ag Powder" />
        <label>카테고리</label>
        <select id="_acm_cat">
          <option value="원료">원료</option>
          <option value="장비">장비</option>
          <option value="일반상품" selected>일반상품</option>
        </select>
        <label>규격</label>
        <input id="_acm_spec" placeholder="예: 20um / 1kg" />
        <label>매입처</label>
        <input id="_acm_supplier" placeholder="예: 일본/TANAKA" />
        <label>비고</label>
        <textarea id="_acm_note" placeholder="메모"></textarea>
        <div class="golab-ac-modal-btns">
          <button type="button" id="_acm_cancel" style="border:1px solid var(--line);background:var(--card);color:var(--text)">취소</button>
          <button type="button" id="_acm_save" style="background:var(--point);border:none;color:#fff">등록</button>
        </div>
      `;

      back.appendChild(modal);
      document.body.appendChild(back);

      // 포커스
      const nameInput = modal.querySelector("#_acm_name");
      setTimeout(() => nameInput.focus(), 50);

      // 취소
      const cancel = () => { document.body.removeChild(back); };
      modal.querySelector("#_acm_cancel").addEventListener("click", cancel);
      back.addEventListener("click", (e) => { if (e.target === back) cancel(); });

      // 저장
      modal.querySelector("#_acm_save").addEventListener("click", () => {
        const name = nameInput.value.trim();
        if (!name) { alert("품목명을 입력해주세요."); nameInput.focus(); return; }
        try {
          const newItem = create({
            item_name: name,
            category:  modal.querySelector("#_acm_cat").value,
            spec:      modal.querySelector("#_acm_spec").value,
            supplier:  modal.querySelector("#_acm_supplier").value,
            note:      modal.querySelector("#_acm_note").value
          });
          document.body.removeChild(back);
          _selectItem(newItem);
        } catch (err) {
          alert("등록 실패: " + err.message);
        }
      });

      // Enter → 저장
      modal.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") {
          e.preventDefault();
          modal.querySelector("#_acm_save").click();
        }
        if (e.key === "Escape") cancel();
      });
    }

    function _escHtml(s) {
      return (s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }

    /* ── 외부 API ── */

    return {
      /** 현재 선택된 item_id 반환 (없으면 null) */
      getValue() { return _selectedId; },

      /** item_id로 선택 상태 설정 */
      setValue(itemId) {
        const item = getById(itemId);
        if (item) _selectItem(item);
      },

      /** 선택된 품목 객체 반환 */
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
     Last Deal — 최근 거래 조회 + 카드 렌더링
     ══════════════════════════════════════ */

  /**
   * 품목 item_id로 최신 매출/매입 조회
   * @param {string} itemId - 품목 마스터 item_id
   * @returns {{ lastSale: object|null, lastPurchase: object|null }}
   */
  function lookupLastDeals(itemId) {
    if (!itemId) return { lastSale: null, lastPurchase: null };

    let lastSale = null;
    let lastPurchase = null;

    // 매출: golab_sales_v1 — item_id 매칭 → salesDate 내림차순 최신 1건
    try {
      const sales = JSON.parse(GoLabStorage.getItem("golab_sales_v1") || "[]");
      const matched = sales.filter(s => s.item_id === itemId);
      matched.sort((a, b) => (b.salesDate || "").localeCompare(a.salesDate || ""));
      if (matched.length > 0) {
        const s = matched[0];
        lastSale = {
          date: s.salesDate || "",
          qty: s.qty,
          unitPrice: s.sellUnitPrice || s.sellPrice || 0,
          client: s.client || s.clientName || ""
        };
      }
    } catch { /* silent */ }

    // 매입: golab_price_history_v1 — item_id 매칭 → date 내림차순 최신 1건
    try {
      const ph = JSON.parse(GoLabStorage.getItem("golab_price_history_v1") || "[]");
      const matched = ph.filter(p => p.item_id === itemId);
      matched.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      if (matched.length > 0) {
        const p = matched[0];
        lastPurchase = {
          date: p.date || "",
          unitPrice: p.price || 0,
          currency: p.currency || "",
          vendor: p.vendor || ""
        };
      }
    } catch { /* silent */ }

    return { lastSale, lastPurchase };
  }

  /**
   * Last Deal 카드 렌더링
   * @param {HTMLElement} container - 카드가 삽입될 부모
   * @param {{ lastSale, lastPurchase }} deals
   */
  function renderLastDealCard(container, deals) {
    // 기존 카드 제거
    const existing = container.querySelector(".golab-last-deal-card");
    if (existing) existing.remove();

    if (!deals || (!deals.lastSale && !deals.lastPurchase)) return;

    const card = document.createElement("div");
    card.className = "golab-last-deal-card";

    const _fmt = v => Number(v || 0).toLocaleString();
    const _esc = s => (s || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    let html = '<div style="font-size:11px;font-weight:700;color:var(--muted,#64748b);margin-bottom:4px">📋 최근 거래</div>';

    if (deals.lastSale) {
      const s = deals.lastSale;
      html += `<div style="font-size:12px;line-height:1.8">
        <span style="color:var(--sales,#d97706);font-weight:700">매출</span>
        ${_esc(s.date)} · ${_esc(s.client)} · ${_fmt(s.qty)} × ₩${_fmt(s.unitPrice)}
      </div>`;
    }
    if (deals.lastPurchase) {
      const p = deals.lastPurchase;
      html += `<div style="font-size:12px;line-height:1.8">
        <span style="color:var(--point,#2563eb);font-weight:700">매입</span>
        ${_esc(p.date)} · ${_esc(p.vendor)} · ${_fmt(p.unitPrice)} ${_esc(p.currency)}
      </div>`;
    }

    card.innerHTML = html;
    container.appendChild(card);
  }

  /* ══════════════════════════════════════
     마이그레이션 (기존 데이터 → 품목 마스터)
     ══════════════════════════════════════ */

  function migrateFromExisting() {
    const master = loadAll();
    const masterById   = new Map(master.map(m => [m.item_id, m]));
    const masterByName = new Map(master.map(m => [(m.item_name || "").trim().toLowerCase(), m]));

    let created = 0;
    const existing = master.length;

    /* Phase 1: 재고(inventory) → 마스터
       v1 스키마에는 name/spec/vendor 없음 (item_id만 보유).
       이미 item_id로 item-master에 연결되어 있으므로
       v1에서 신규 마스터 레코드를 생성할 수 없다 (정상 동작).
       item-master가 품목명의 SSoT이므로 이 Phase는 v1에서 사실상 no-op. */
    const INV_KEY = "golab_inventory_v1";
    let inv = [];
    try { inv = JSON.parse(GoLabStorage.getItem(INV_KEY) || "[]"); } catch {}

    inv.forEach(it => {
      /* v1은 item_id가 PK — 이미 마스터에 존재하면 스킵 */
      if (!it.item_id) return;
      if (masterById.has(it.item_id)) return;
      /* v1은 name 미보유 → 신규 마스터 생성 불가, 스킵 */
    });

    /* Phase 2: 매입(purchases) → 마스터에 없는 품목 */
    const PUR_KEY = "golab_purchases_v2";
    let batches = [];
    try { batches = JSON.parse(GoLabStorage.getItem(PUR_KEY) || "[]"); } catch {}

    batches.forEach(batch => {
      (batch.items || []).forEach(item => {
        const name = (item.pName || "").trim();
        const nameKey = name.toLowerCase();
        if (!nameKey) return;
        if (item.inventoryItemId && masterById.has(item.inventoryItemId)) return;
        if (masterByName.has(nameKey)) return;
        const m = {
          item_id:    crypto.randomUUID(),
          item_name:  name,
          category:   "일반상품",
          spec:       (item.unit || "").trim(),
          supplier:   "",
          note:       "매입원장에서 마이그레이션",
          created_at: new Date().toISOString()
        };
        master.push(m);
        masterById.set(m.item_id, m);
        masterByName.set(nameKey, m);
        created++;
      });
    });

    /* Phase 3: 매출(sales) → 마스터에 없는 품목 */
    const SALES_KEY = "golab_sales_v1";
    let sales = [];
    try { sales = JSON.parse(GoLabStorage.getItem(SALES_KEY) || "[]"); } catch {}

    sales.forEach(rec => {
      const name = (rec.itemName || "").trim();
      const nameKey = name.toLowerCase();
      if (!nameKey) return;
      if (masterByName.has(nameKey)) return;
      const m = {
        item_id:    crypto.randomUUID(),
        item_name:  name,
        category:   "일반상품",
        spec:       "",
        supplier:   (rec.client || "").trim(),
        note:       "매출에서 마이그레이션",
        created_at: new Date().toISOString()
      };
      master.push(m);
      masterById.set(m.item_id, m);
      masterByName.set(nameKey, m);
      created++;
    });

    /* Phase 4: 기존 레코드에 item_id backfill */
    let bfPurchases = 0, bfSales = 0, bfPH = 0;
    let purChanged = false, salesChanged = false, phChanged = false;

    // 매입 backfill
    batches.forEach(batch => {
      (batch.items || []).forEach(item => {
        if (item.item_id) return;
        const nameKey = (item.pName || "").trim().toLowerCase();
        const m = masterByName.get(nameKey);
        if (m) { item.item_id = m.item_id; bfPurchases++; purChanged = true; }
      });
    });
    if (purChanged) GoLabStorage.setItem(PUR_KEY, JSON.stringify(batches));

    // 매출 backfill
    sales.forEach(rec => {
      if (rec.item_id) return;
      const nameKey = (rec.itemName || "").trim().toLowerCase();
      const m = masterByName.get(nameKey);
      if (m) { rec.item_id = m.item_id; bfSales++; salesChanged = true; }
    });
    if (salesChanged) GoLabStorage.setItem(SALES_KEY, JSON.stringify(sales));

    /* 가격 기록 backfill */
    const PH_KEY = "golab_price_history_v1";
    let ph = [];
    try { ph = JSON.parse(GoLabStorage.getItem(PH_KEY) || "[]"); } catch {}
    ph.forEach(rec => {
      if (rec.item_id) return;
      const nameKey = (rec.productName || "").trim().toLowerCase();
      const m = masterByName.get(nameKey);
      if (m) { rec.item_id = m.item_id; bfPH++; phChanged = true; }
    });
    if (phChanged) GoLabStorage.setItem(PH_KEY, JSON.stringify(ph));

    /* 재고 backfill — v1은 item_id가 PK이므로 추가 backfill 불필요.
       혹시 item_id 없는 레코드가 있으면 제거 대상 플래그만 남긴다. */
    let invChanged = false;
    inv.forEach(it => {
      if (!it.item_id) { invChanged = true; } /* item_id 없는 v1 레코드는 비정상 */
    });
    if (invChanged) GoLabStorage.setItem(INV_KEY, JSON.stringify(inv));

    /* 마스터 저장 */
    _save(master);

    const result = {
      created,
      existing,
      total: master.length,
      backfilled: { purchases: bfPurchases, sales: bfSales, priceHistory: bfPH }
    };
    emitAudit("MIGRATION", result);
    return result;
  }

  /* ══════════════════════════════════════
     v3.6: 필드 자동 보강 (_upgradeRecords)
     ══════════════════════════════════════ */

  /** 기존 레코드에 v3.6/v3.6a 필드 자동 추가 */
  function _upgradeRecords() {
    const all = loadAll();
    let changed = false;
    all.forEach(function(item) {
      if (!Array.isArray(item.aliases)) { item.aliases = []; changed = true; }
      if (item.unit === undefined)      { item.unit = ""; changed = true; }
      /* v6.10: 브랜드 필드 기본값 보강 */
      if (item.brand === undefined)     { item.brand = ""; changed = true; }
      if (!item.updated_at)             { item.updated_at = item.created_at || ""; changed = true; }
      /* v3.6a: 기준 가격 필드 (null = 미입력) */
      PRICE_FIELDS.forEach(function(f) {
        if (item[f] === undefined) { item[f] = null; changed = true; }
      });
      /* v3.6a: 택배 조건 */
      if (item.shipping_included_default === undefined) { item.shipping_included_default = false; changed = true; }
      if (item.shipping_note === undefined) { item.shipping_note = ""; changed = true; }
    });
    if (changed) _save(all);
  }

  /* ══════════════════════════════════════
     v3.6: 품목별 거래 통계 (calcItemStats)
     ══════════════════════════════════════ */

  /** 거래처 타입 조회 헬퍼 */
  function _lookupPartnerType(partnerId) {
    if (!partnerId) return "매출처";
    try {
      if (window.GoLabPartnerMaster) {
        const all = GoLabPartnerMaster.loadAll();
        const p = all.find(function(x) { return x.partner_id === partnerId; });
        if (p) return p.type || "매출처";
      }
    } catch(e) { /* silent */ }
    return "매출처";
  }

  /**
   * 품목별 거래 통계 집계
   * golab_trade_v2를 스캔하여 해당 item_id 관련 거래를 분석
   * @param {string} itemId
   * @returns {Object} { buyers:[], sellers:[], recentTrades:[], totalTxCount,
   *                     firstDate, lastDate, totalRevenue, totalCost, totalProfit,
   *                     totalMyShare, totalSPaid }
   */
  function calcItemStats(itemId) {
    const empty = {
      buyers: [], sellers: [], recentTrades: [], totalTxCount: 0,
      firstDate: "", lastDate: "", totalRevenue: 0, totalCost: 0,
      totalProfit: 0, totalMyShare: 0, totalSPaid: 0
    };
    if (!itemId) return empty;

    let trades = [];
    try { trades = JSON.parse(GoLabStorage.getItem("golab_trade_v2") || "[]"); } catch(e) {}

    /* 거래처별 집계 맵 */
    const buyerMap = {};   // partner_id → { name, lastDate, lastPrice, totalQty, txCount }
    const sellerMap = {};  // partner_id → { name, lastDate, lastPrice, totalQty, txCount }
    const allMatched = []; // 매칭된 거래 (최근 이력용)

    let totalRevenue = 0, totalCost = 0, totalMyShare = 0, totalSPaid = 0;
    let firstDate = "", lastDate = "";
    /* v3.12: 최근 판매가/매입가 추적 */
    let lastSellPrice = null, lastSellDate = "";
    let lastBuyPrice  = null, lastBuyDate  = "";
    /* v4: 평균 매입가 / 최저 매입가 추적 */
    let totalBuyAmount = 0, totalBuyQty = 0;
    let minBuyPrice = null;

    trades.forEach(function(deal) {
      /* v3.12: 취소 거래 필터 (is_canceled !== true) */
      if (deal.deal_status === "cancelled" || deal.is_canceled === true) return;
      const items = deal.items || [];
      /* 해당 품목이 포함된 거래만 */
      const matched = items.filter(function(it) { return it.item_id === itemId; });
      if (matched.length === 0) return;

      const dt = deal.deal_date || (deal.quote_at || deal.created_at || "").substring(0, 10);
      const partnerName = deal.partner_name_snapshot || deal.partner_id || "";
      const pType = _lookupPartnerType(deal.partner_id);

      /* 날짜 범위 추적 */
      if (!firstDate || dt < firstDate) firstDate = dt;
      if (!lastDate || dt > lastDate) lastDate = dt;

      /* 거래별 계산 (trade-engine 사용 가능하면 활용) */
      let calc = deal._calc;
      if (!calc && window.TE && TE.calcTrade) {
        try { calc = TE.calcTrade(deal); } catch(e) {}
      }

      /* 매칭 품목의 수량/금액 집계 */
      matched.forEach(function(it) {
        const qty = Number(it.qty) || 0;
        const unitPrice = Number(it.unit_price) || 0;
        const cost = Number(it.cost) || 0;
        const supplyAmt = Number(it.supply_amount) || (qty * unitPrice);

        /* 거래처 분류: 매입처 → 원재료를 사는 곳, 매출처 → 제품을 파는 곳 */
        if (pType === "매입처") {
          if (!buyerMap[deal.partner_id]) {
            buyerMap[deal.partner_id] = { partner_id: deal.partner_id, name: partnerName, lastDate: "", lastPrice: 0, totalQty: 0, txCount: 0 };
          }
          const b = buyerMap[deal.partner_id];
          b.txCount++;
          b.totalQty += qty;
          if (dt > b.lastDate) { b.lastDate = dt; b.lastPrice = unitPrice || cost; }
          /* v3.12: 최근 매입가 추적 */
          var _bp = unitPrice || cost;
          if (_bp > 0 && dt > lastBuyDate) { lastBuyPrice = _bp; lastBuyDate = dt; }
          /* v4: 평균 매입가 / 최저 매입가 집계 */
          if (_bp > 0) {
            totalBuyAmount += _bp * qty;
            totalBuyQty += qty;
            if (minBuyPrice === null || _bp < minBuyPrice) { minBuyPrice = _bp; }
          }
        } else {
          /* 매출처 또는 겸용 → sellers */
          if (!sellerMap[deal.partner_id]) {
            sellerMap[deal.partner_id] = { partner_id: deal.partner_id, name: partnerName, lastDate: "", lastPrice: 0, totalQty: 0, txCount: 0 };
          }
          const s = sellerMap[deal.partner_id];
          s.txCount++;
          s.totalQty += qty;
          if (dt > s.lastDate) { s.lastDate = dt; s.lastPrice = unitPrice; }
          /* v3.12: 최근 판매가 추적 */
          if (unitPrice > 0 && dt > lastSellDate) { lastSellPrice = unitPrice; lastSellDate = dt; }
        }

        totalRevenue += supplyAmt;
        totalCost += cost * qty;
      });

      /* 거래 단위 집계 (내 몫, S 지급액) — 품목 비율이 아닌 거래 전체 기준 */
      if (calc) {
        totalMyShare += Number(calc.final_my_amount) || 0;
        const sAmt = Number((deal.settlement || {}).actual_S_amount);
        totalSPaid += (sAmt > 0) ? sAmt : (Number(calc.expected_S_amount) || 0);
      }

      /* 최근 거래 이력용 */
      allMatched.push({
        deal_id: deal.id,
        date: dt,
        partner_name: partnerName,
        partner_type: pType,
        items: matched,
        deal_status: deal.deal_status,
        payment_at: deal.payment_at,
        supply_amount: Number(deal.total_supply) || 0
      });
    });

    /* 정렬: 최신순 */
    allMatched.sort(function(a, b) { return (b.date || "").localeCompare(a.date || ""); });

    /* 맵 → 배열 (txCount 내림차순) */
    const buyers = Object.values(buyerMap).sort(function(a, b) { return b.txCount - a.txCount; });
    const sellers = Object.values(sellerMap).sort(function(a, b) { return b.txCount - a.txCount; });

    return {
      buyers: buyers,
      sellers: sellers,
      recentTrades: allMatched.slice(0, 10),
      totalTxCount: allMatched.length,
      firstDate: firstDate,
      lastDate: lastDate,
      totalRevenue: totalRevenue,
      totalCost: totalCost,
      totalProfit: totalRevenue - totalCost,
      totalMyShare: totalMyShare,
      totalSPaid: totalSPaid,
      /* v3.12: 파생 가격 (거래 데이터 기반) */
      lastSellPrice: lastSellPrice,
      lastBuyPrice:  lastBuyPrice,
      /* v4: 평균 매입가 / 최저 매입가 */
      avgBuyPrice: totalBuyQty > 0 ? Math.round(totalBuyAmount / totalBuyQty) : null,
      minBuyPrice: minBuyPrice
    };
  }

  /* ══════════════════════════════════════
     v3.6: 품목ID + 텍스트 기반 이중 조회
     ══════════════════════════════════════ */

  /**
   * item_id 기반 거래 조회
   * @param {string} itemId
   * @returns {Array} 매칭된 deal 배열
   */
  function getDealsByItem(itemId) {
    if (!itemId) return [];
    let trades = [];
    try { trades = JSON.parse(GoLabStorage.getItem("golab_trade_v2") || "[]"); } catch(e) {}
    return trades.filter(function(deal) {
      if (deal.deal_status === "cancelled") return false;
      return (deal.items || []).some(function(it) { return it.item_id === itemId; });
    });
  }

  /**
   * 텍스트 기반 거래 조회 (item_id 미연결 거래 포함)
   * aliases 포함 매칭
   * @param {string} itemName - 품목명 (또는 별칭)
   * @returns {Array} 매칭된 deal 배열
   */
  function getDealsByText(itemName) {
    if (!itemName) return [];
    const q = itemName.trim().toLowerCase();
    let trades = [];
    try { trades = JSON.parse(GoLabStorage.getItem("golab_trade_v2") || "[]"); } catch(e) {}
    return trades.filter(function(deal) {
      if (deal.deal_status === "cancelled") return false;
      return (deal.items || []).some(function(it) {
        return (it.name || "").trim().toLowerCase() === q;
      });
    });
  }

  /* ══════════════════════════════════════
     v3.6: 미연결 거래 품목 추출/연결
     ══════════════════════════════════════ */

  /**
   * golab_trade_v2에서 item_id가 null인 거래 품목 추출
   * name 기준 그룹화 + 마스터에서 유사 후보 검색
   * @returns {Array} [{ name, count, dealIds:[], candidates:[] }]
   */
  function extractUnlinkedItems() {
    let trades = [];
    try { trades = JSON.parse(GoLabStorage.getItem("golab_trade_v2") || "[]"); } catch(e) {}

    const groups = {}; // nameKey → { name, count, dealIds:Set }
    trades.forEach(function(deal) {
      if (deal.deal_status === "cancelled") return;
      (deal.items || []).forEach(function(it) {
        if (it.item_id) return; // 이미 연결됨
        const name = (it.name || "").trim();
        if (!name) return;
        const key = name.toLowerCase();
        if (!groups[key]) {
          groups[key] = { name: name, count: 0, dealIds: [] };
        }
        groups[key].count++;
        if (groups[key].dealIds.indexOf(deal.id) < 0) {
          groups[key].dealIds.push(deal.id);
        }
      });
    });

    /* 각 그룹에 마스터 후보 추가 + count 내림차순 정렬 */
    const result = Object.values(groups).map(function(g) {
      g.candidates = search(g.name);
      return g;
    });
    result.sort(function(a, b) { return b.count - a.count; });
    return result;
  }

  /**
   * 미연결 거래에 item_id 일괄 연결 (사용자 확인 후 호출)
   * @param {string} itemId - 연결할 품목 마스터 ID
   * @param {string} namePattern - 매칭할 품목명 (대소문자 무시, 정확 매칭)
   * @returns {{ linked: number }} 연결된 건수
   */
  function linkItemToTrades(itemId, namePattern) {
    if (!itemId || !namePattern) return { linked: 0 };
    const pattern = namePattern.trim().toLowerCase();

    let trades = [];
    try { trades = JSON.parse(GoLabStorage.getItem("golab_trade_v2") || "[]"); } catch(e) {}

    let linked = 0;
    trades.forEach(function(deal) {
      if (deal.deal_status === "cancelled") return;
      let dealChanged = false;
      (deal.items || []).forEach(function(it) {
        if (it.item_id) return; // 이미 연결됨
        if ((it.name || "").trim().toLowerCase() === pattern) {
          it.item_id = itemId;
          linked++;
          dealChanged = true;
        }
      });
      if (dealChanged) {
        deal.updated_at = new Date().toISOString();
      }
    });

    if (linked > 0) {
      GoLabStorage.setItem("golab_trade_v2", JSON.stringify(trades));
      emitAudit("LINK_TRADES", { item_id: itemId, namePattern: namePattern, linked: linked });
    }

    return { linked: linked };
  }

  /* ══════════════════════════════════════
     v3.8: 최근 구매 단가(KRW) 조회
     golab_purchases_v2 배치 + golab_price_history_v1 에서
     해당 item_id의 최신 기록 → 품목단가×환율 반환
     ══════════════════════════════════════ */

  /**
   * 품목의 최근 구매 단가(KRW) 조회
   * @param {string} itemId — 품목 마스터 item_id
   * @returns {{ cost:number, date:string, batchName:string, currency:string, rawPrice:number, exchangeRate:number }|null}
   */
  function getLatestPurchaseCost(itemId) {
    if (!itemId) return null;

    var latest = null; /* { cost, date, batchName, currency, rawPrice, exchangeRate } */

    /* 1) golab_purchases_v2 배치 스캔 → item_id 매칭 → price×exchangeRate */
    try {
      var batches = JSON.parse(GoLabStorage.getItem("golab_purchases_v2") || "[]");
      batches.forEach(function(batch) {
        var batchDate = batch.date || "";
        var ex = Number(batch.exchangeRate) || 1;
        (batch.items || []).forEach(function(item) {
          if (item.item_id !== itemId) return;
          var rawPrice = Number(item.price) || 0;
          var krwUnitCost = Math.round(rawPrice * ex);
          if (!latest || batchDate > latest.date) {
            latest = {
              cost: krwUnitCost,
              date: batchDate,
              batchName: batch.batchName || "",
              currency: batch.currency || "KRW",
              rawPrice: rawPrice,
              exchangeRate: ex
            };
          }
        });
      });
    } catch(e) { /* silent */ }

    /* 2) golab_price_history_v1 스캔 → item_id 매칭 → price×fxRef */
    try {
      var ph = JSON.parse(GoLabStorage.getItem("golab_price_history_v1") || "[]");
      ph.forEach(function(rec) {
        if (rec.item_id !== itemId) return;
        var dt = rec.date || "";
        if (!latest || dt > latest.date) {
          var fxRef = Number(rec.fxRef) || 1;
          latest = {
            cost: Math.round((Number(rec.price) || 0) * fxRef),
            date: dt,
            batchName: "(가격기록)",
            currency: rec.currency || "KRW",
            rawPrice: Number(rec.price) || 0,
            exchangeRate: fxRef
          };
        }
      });
    } catch(e) { /* silent */ }

    return latest;
  }

  /* ══════════════════════════════════════
     v3.6: 필드 자동 보강 실행
     ══════════════════════════════════════ */
  _upgradeRecords();

  /* ══════════════════════════════════════
     Public API
     ══════════════════════════════════════ */

  return {
    MASTER_KEY, AUDIT_KEY,
    CATEGORY_MAP, CATEGORY_REVERSE, CATEGORIES, PRICE_FIELDS,
    loadAll, getById, search,
    create, update, remove,
    emitAudit,
    createAutocomplete,
    lookupLastDeals,
    renderLastDealCard,
    migrateFromExisting,
    /* v3.6 신규 */
    calcItemStats,
    getDealsByItem,
    getDealsByText,
    extractUnlinkedItems,
    linkItemToTrades,
    /* v3.8 신규 */
    getLatestPurchaseCost
  };

})();

/* ══════════════════════════════════════
   v3.12: 가격 필드 마이그레이션 (Soft-delete)
   consumer_price → rrp_price
   distributor_price → distributor_price_legacy
   internet_low_price → internet_low_price_legacy
   ══════════════════════════════════════ */
(function _migratePriceFields() {
  var KEY = GoLabItemMaster.MASTER_KEY;
  var all;
  try { all = JSON.parse(GoLabStorage.getItem(KEY) || "[]"); }
  catch(e) { return; }
  if (all.length === 0) return;
  var changed = false;
  all.forEach(function(item) {
    /* consumer_price → rrp_price (값 이관) */
    if (item.rrp_price === undefined || item.rrp_price === null) {
      if (item.consumer_price != null) {
        item.rrp_price = item.consumer_price;
        changed = true;
      }
    }
    /* consumer_price 제거 (rrp_price로 이관 완료) */
    if (item.consumer_price !== undefined) {
      delete item.consumer_price;
      changed = true;
    }
    /* distributor_price → distributor_price_legacy */
    if (item.distributor_price !== undefined) {
      if (item.distributor_price != null && item.distributor_price !== 0) {
        item.distributor_price_legacy = item.distributor_price;
      }
      delete item.distributor_price;
      changed = true;
    }
    /* internet_low_price → internet_low_price_legacy */
    if (item.internet_low_price !== undefined) {
      if (item.internet_low_price != null && item.internet_low_price !== 0) {
        item.internet_low_price_legacy = item.internet_low_price;
      }
      delete item.internet_low_price;
      changed = true;
    }
  });
  if (changed) {
    GoLabStorage.setItem(KEY, JSON.stringify(all));
    GoLabItemMaster.emitAudit("MIGRATE_PRICE_V312", { count: all.length });
    console.log("[ITEM-MASTER] v3.12 가격 필드 마이그레이션 완료 (" + all.length + "건)");
  }
})();
