/**
 * ui.js — 공통 UI 컴포넌트
 * 토스트, 상태태그, 포맷팅, 자동완성, reason 다이얼로그
 */

// ── 숫자 포맷 ──

/**
 * 원화 포맷: 1234567 → "1,234,567"
 */
export function formatKRW(num) {
  if (num == null || isNaN(num)) return '0';
  return Math.round(num).toLocaleString('ko-KR');
}

/**
 * 원화 + 원 표시: 1234567 → "₩1,234,567"
 */
export function formatCurrency(num) {
  return '₩' + formatKRW(num);
}

/**
 * 수량 포맷: 소수점 2자리까지, 불필요한 0 제거
 */
export function formatQty(num) {
  if (num == null || isNaN(num)) return '0';
  return parseFloat(num.toFixed(2)).toLocaleString('ko-KR');
}

// ── 날짜 포맷 ──

export function formatDate(val) {
  if (!val) return '-';
  let d;
  if (val.toDate) d = val.toDate();
  else if (val instanceof Date) d = val;
  else d = new Date(val);
  if (isNaN(d)) return '-';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function formatDateTime(val) {
  if (!val) return '-';
  let d;
  if (val.toDate) d = val.toDate();
  else if (val instanceof Date) d = val;
  else d = new Date(val);
  if (isNaN(d)) return '-';
  return d.toLocaleString('ko-KR');
}

// ── 상태 태그 ──

const STATUS_MAP = {
  NORMAL:   { label: '정상',   cls: 'normal' },
  RISK:     { label: '위험',   cls: 'risk' },
  RESERVED: { label: '고객지정', cls: 'reserved' },
  OUT:      { label: '품절',   cls: 'out' }
};

export function createStatusTag(status) {
  const info = STATUS_MAP[status] || STATUS_MAP.NORMAL;
  const el = document.createElement('span');
  el.className = `status-tag ${info.cls}`;
  el.textContent = info.label;
  return el;
}

export function statusLabel(status) {
  return (STATUS_MAP[status] || STATUS_MAP.NORMAL).label;
}

// ── 토스트 알림 ──

let toastContainer = null;

function ensureToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
}

export function showToast(msg, type = 'info') {
  ensureToastContainer();
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => { el.remove(); }, 3000);
}

// ── Reason 다이얼로그 ──

/**
 * 사유 입력 다이얼로그 표시
 * @param {string} title - 제목 (예: "상태 변경 사유")
 * @returns {Promise<string|null>} 사유 문자열 또는 취소 시 null
 */
export function askReason(title = '변경 사유') {
  return new Promise((resolve) => {
    // 기존 오버레이 제거
    document.querySelectorAll('.reason-overlay').forEach(el => el.remove());

    const overlay = document.createElement('div');
    overlay.className = 'reason-overlay show';
    overlay.innerHTML = `
      <div class="reason-dialog">
        <h3>${title}</h3>
        <textarea placeholder="사유를 입력하세요 (선택사항)" id="reason-textarea"></textarea>
        <div class="reason-actions">
          <button class="btn btn-secondary btn-sm" id="reason-cancel">취소</button>
          <button class="btn btn-primary btn-sm" id="reason-confirm">확인</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const textarea = overlay.querySelector('#reason-textarea');
    textarea.focus();

    overlay.querySelector('#reason-confirm').onclick = () => {
      overlay.remove();
      resolve(textarea.value.trim());
    };

    overlay.querySelector('#reason-cancel').onclick = () => {
      overlay.remove();
      resolve(null);
    };

    // ESC로 취소
    const onKey = (e) => {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(null); }
      if (e.key === 'Enter' && e.ctrlKey) { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(textarea.value.trim()); }
    };
    document.addEventListener('keydown', onKey);
  });
}

// ── 자동완성 컴포넌트 ──

/**
 * 입력 필드에 자동완성 기능 부착
 * @param {HTMLInputElement} input - 대상 input
 * @param {function} getItems - () => [{id, label, sub?}] 데이터 소스
 * @param {function} onSelect - (item) => void 선택 콜백
 */
export function attachAutocomplete(input, getItems, onSelect) {
  const wrapper = input.parentElement;
  wrapper.classList.add('autocomplete-wrapper');

  const listEl = document.createElement('div');
  listEl.className = 'autocomplete-list';
  wrapper.appendChild(listEl);

  let selectedId = null;

  // input을 읽기전용으로 표시하는 플래그 (선택 후 자유입력 방지)
  input.dataset.acSelected = '';

  function render(items) {
    listEl.innerHTML = '';
    if (items.length === 0) {
      listEl.classList.remove('show');
      return;
    }
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'ac-item';
      div.innerHTML = `<strong>${item.label}</strong>${item.sub ? ` <span style="color:var(--c-text-sub);font-size:0.8rem">${item.sub}</span>` : ''}`;
      div.onclick = () => {
        input.value = item.label;
        input.dataset.acSelected = item.id;
        selectedId = item.id;
        listEl.classList.remove('show');
        onSelect(item);
      };
      listEl.appendChild(div);
    });
    listEl.classList.add('show');
  }

  input.addEventListener('input', () => {
    // 선택 후 수정하면 선택 해제
    input.dataset.acSelected = '';
    selectedId = null;

    const val = input.value.trim().toLowerCase();
    if (!val) { listEl.classList.remove('show'); return; }

    const items = getItems();
    const filtered = items.filter(i =>
      i.label.toLowerCase().includes(val) ||
      (i.sub && i.sub.toLowerCase().includes(val))
    );
    render(filtered);
  });

  input.addEventListener('focus', () => {
    if (!input.value.trim()) {
      // 빈 상태에서 포커스 → 전체 목록 표시 (최대 20개)
      render(getItems().slice(0, 20));
    }
  });

  // 외부 클릭 시 닫기
  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      listEl.classList.remove('show');
    }
  });

  // 선택된 ID 반환용
  input.getSelectedId = () => input.dataset.acSelected || null;
}

// ── HTML 이스케이프 ──

export function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── 로딩 표시 ──

export function showLoading(container) {
  container.innerHTML = '<div style="text-align:center;padding:40px"><div class="loading-spinner"></div></div>';
}

export function showEmpty(container, icon = '📦', msg = '데이터가 없습니다') {
  container.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon}</div><p>${msg}</p></div>`;
}
