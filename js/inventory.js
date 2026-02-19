/**
 * inventory.js — 재고 현황 화면 (index.html)
 * KPI 카드 + 검색/필터 + 좌 리스트 + 우 상세 카드
 */

import { initApp, evaluateStatus } from './app.js';
import {
  readAll, createDoc, updateDocument, readDoc, COLLECTIONS,
  getCurrentUser, getAdminEmail, checkAllowedUser,
  getAllowedUsers, addAllowedUser, removeAllowedUser
} from './db.js';
import { writeLog } from './audit.js';
import {
  formatKRW, formatCurrency, formatQty, formatDate,
  createStatusTag, showToast, askReason, showLoading, showEmpty, escapeHtml
} from './ui.js';

// ── 상태 ──
let allItems = [];
let filteredItems = [];
let selectedItemId = null;
let currentFilter = 'ALL';
let shortageOnly = false;
let searchQuery = '';

// ── 초기화 ──
document.addEventListener('DOMContentLoaded', async () => {
  await initApp();
  await loadItems();
  bindEvents();
  setupUserMgmt();
});

// ── 데이터 로드 ──
async function loadItems() {
  allItems = await readAll(COLLECTIONS.ITEMS, {
    orderField: 'updated_at',
    orderDir: 'desc'
  });

  // 상태 자동 평가 (로드 시)
  allItems.forEach(item => {
    const newStatus = evaluateStatus(item.qty_on_hand || 0, item.qty_min || 0, item.status);
    if (newStatus !== item.status) {
      item.status = newStatus;
    }
  });

  applyFilters();
  renderKPI();
}

// ── KPI 계산 ──
function renderKPI() {
  // 총 재고가치
  const totalAsset = allItems.reduce((sum, i) => sum + (i.asset_value || (i.qty_on_hand || 0) * (i.avg_cost || 0)), 0);
  document.getElementById('kpi-asset').textContent = formatCurrency(totalAsset);

  // 미수금 (v1: invoices 아직 없으므로 0, 구조만 준비)
  const totalReceivable = 0; // TODO: invoices 연동 시 계산
  document.getElementById('kpi-receivable').textContent = formatCurrency(totalReceivable);

  const recCard = document.getElementById('kpi-receivable-card');
  recCard.className = totalReceivable > 0 ? 'kpi-card red' : 'kpi-card green';

  // 위험 품목 수
  const riskCount = allItems.filter(i =>
    i.status === 'RISK' || i.status === 'OUT' || (i.qty_on_hand || 0) < (i.qty_min || 0)
  ).length;
  document.getElementById('kpi-risk').textContent = `${riskCount}건`;

  const riskCard = document.getElementById('kpi-risk-card');
  riskCard.className = riskCount > 0 ? 'kpi-card red' : 'kpi-card green';
}

// ── 필터 / 검색 ──
function applyFilters() {
  filteredItems = allItems.filter(item => {
    // 상태 필터
    if (currentFilter !== 'ALL' && currentFilter !== 'SHORTAGE') {
      if (item.status !== currentFilter) return false;
    }

    // 부족만 토글
    if (shortageOnly || currentFilter === 'SHORTAGE') {
      if ((item.qty_on_hand || 0) >= (item.qty_min || 1)) return false;
    }

    // 검색
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const nameMatch = (item.name || '').toLowerCase().includes(q);
      const skuMatch = (item.sku || '').toLowerCase().includes(q);
      if (!nameMatch && !skuMatch) return false;
    }

    return true;
  });

  renderList();
}

// ── 리스트 렌더링 ──
function renderList() {
  const container = document.getElementById('item-list');

  if (filteredItems.length === 0) {
    if (allItems.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📦</div>
          <p>등록된 품목이 없습니다</p>
          <button class="btn btn-primary" style="margin-top:12px" id="btn-add-first">+ 첫 품목 등록</button>
        </div>
      `;
      const btn = container.querySelector('#btn-add-first');
      if (btn) btn.onclick = () => showAddForm();
    } else {
      showEmpty(container, '🔍', '검색 결과가 없습니다');
    }
    return;
  }

  container.innerHTML = filteredItems.map(item => {
    const isSelected = item.id === selectedItemId;
    const shortage = (item.qty_on_hand || 0) < (item.qty_min || 0);
    return `
      <div class="list-item ${isSelected ? 'selected' : ''}" data-id="${item.id}">
        ${createStatusTag(item.status || 'NORMAL').outerHTML}
        <div class="item-main">
          <div class="item-name">${escapeHtml(item.name)}</div>
          <div class="item-sub">
            ${item.last_delivery_to ? escapeHtml(item.last_delivery_to) : '-'}
            · ${formatDate(item.last_delivery_at)}
            · 원가 ${formatKRW(item.avg_cost || 0)}
          </div>
        </div>
        <div class="item-qty" style="${shortage ? 'color:var(--c-danger)' : ''}">
          ${formatQty(item.qty_on_hand || 0)}
          <span style="font-size:0.7rem;font-weight:400;color:var(--c-text-sub)">${item.unit || 'EA'}</span>
        </div>
      </div>
    `;
  }).join('');

  // 클릭 이벤트
  container.querySelectorAll('.list-item').forEach(el => {
    el.onclick = () => selectItem(el.dataset.id);
  });
}

// ── 상세 패널 ──
function selectItem(itemId) {
  selectedItemId = itemId;
  renderList(); // 선택 표시 갱신

  const item = allItems.find(i => i.id === itemId);
  if (!item) return;

  const panel = document.getElementById('detail-panel');
  const shortage = Math.max(0, (item.qty_min || 0) - (item.qty_on_hand || 0));
  const assetValue = (item.qty_on_hand || 0) * (item.avg_cost || 0);

  panel.innerHTML = `
    <div class="detail-card">
      <div style="display:flex;justify-content:space-between;align-items:start">
        <div>
          <h2>${escapeHtml(item.name)}</h2>
          <div class="sku">${item.sku ? 'SKU: ' + escapeHtml(item.sku) : ''}${item.unit ? ' · 단위: ' + item.unit : ''}</div>
        </div>
        <div id="detail-status-tag"></div>
      </div>

      <div class="stat-grid">
        <div class="stat-box">
          <div class="stat-label">현재 수량</div>
          <div class="stat-value ${(item.qty_on_hand || 0) < (item.qty_min || 0) ? 'danger' : ''}">${formatQty(item.qty_on_hand || 0)} <small>${item.unit || 'EA'}</small></div>
        </div>
        <div class="stat-box">
          <div class="stat-label">최소 수량</div>
          <div class="stat-value">${formatQty(item.qty_min || 0)} <small>${item.unit || 'EA'}</small></div>
        </div>
        <div class="stat-box">
          <div class="stat-label">평균 원가</div>
          <div class="stat-value primary">${formatCurrency(item.avg_cost || 0)}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">재고 가치</div>
          <div class="stat-value primary">${formatCurrency(assetValue)}</div>
        </div>
      </div>

      ${shortage > 0 ? `<div style="background:var(--c-danger-light);color:var(--c-danger);padding:10px 14px;border-radius:var(--radius);font-weight:700;margin:12px 0">⚠ 부족분: ${formatQty(shortage)} ${item.unit || 'EA'}</div>` : ''}

      <div style="margin-top:8px;font-size:0.85rem;color:var(--c-text-sub)">
        최종 납품: ${item.last_delivery_to ? escapeHtml(item.last_delivery_to) : '-'} · ${formatDate(item.last_delivery_at)}
      </div>

      <div class="action-row">
        <button class="btn btn-secondary btn-sm" id="btn-change-status">상태 변경</button>
        <button class="btn btn-secondary btn-sm" id="btn-edit-min">최소수량 수정</button>
        <button class="btn btn-secondary btn-sm" id="btn-quick-out">빠른 출고</button>
        <button class="btn btn-secondary btn-sm" id="btn-edit-item">품목 수정</button>
        <button class="btn btn-danger btn-sm" id="btn-delete-item">삭제</button>
      </div>
    </div>

    <div class="detail-card history-section">
      <h3>최근 입고 이력</h3>
      <div id="recent-purchases"><div class="loading-spinner"></div></div>
    </div>

    <div class="detail-card history-section">
      <h3>최근 출고 이력</h3>
      <div id="recent-deliveries"><div class="loading-spinner"></div></div>
    </div>
  `;

  // 상태 태그 렌더
  document.getElementById('detail-status-tag').appendChild(createStatusTag(item.status || 'NORMAL'));

  // 버튼 이벤트
  document.getElementById('btn-change-status').onclick = () => changeStatus(item);
  document.getElementById('btn-edit-min').onclick = () => editMinQty(item);
  document.getElementById('btn-quick-out').onclick = () => quickDelivery(item);
  document.getElementById('btn-edit-item').onclick = () => showEditForm(item);
  document.getElementById('btn-delete-item').onclick = () => deleteItem(item);

  // 최근 이력 로드
  loadRecentPurchases(item.id);
  loadRecentDeliveries(item.id);
}

// ── 최근 이력 ──
async function loadRecentPurchases(itemId) {
  const container = document.getElementById('recent-purchases');
  try {
    const purchases = await readAll(COLLECTIONS.PURCHASES, {
      filters: [{ field: 'item_id', op: '==', value: itemId }],
      orderField: 'purchased_at',
      orderDir: 'desc',
      limitCount: 5
    });

    if (purchases.length === 0) {
      container.innerHTML = '<p style="font-size:0.85rem;color:var(--c-text-sub)">입고 이력 없음</p>';
      return;
    }

    container.innerHTML = `<ul class="history-list">
      ${purchases.map(p => `
        <li>
          <span>${formatDate(p.purchased_at)} · ${formatQty(p.qty)} · ${p.vendor_name || '-'}</span>
          <span style="font-weight:700">${formatCurrency(p.total_cost || 0)}</span>
        </li>
      `).join('')}
    </ul>`;
  } catch {
    container.innerHTML = '<p style="font-size:0.85rem;color:var(--c-text-sub)">로드 실패</p>';
  }
}

async function loadRecentDeliveries(itemId) {
  const container = document.getElementById('recent-deliveries');
  try {
    const deliveries = await readAll(COLLECTIONS.DELIVERIES, {
      filters: [{ field: 'item_id', op: '==', value: itemId }],
      orderField: 'delivered_at',
      orderDir: 'desc',
      limitCount: 5
    });

    if (deliveries.length === 0) {
      container.innerHTML = '<p style="font-size:0.85rem;color:var(--c-text-sub)">출고 이력 없음</p>';
      return;
    }

    container.innerHTML = `<ul class="history-list">
      ${deliveries.map(d => `
        <li>
          <span>${formatDate(d.delivered_at)} · ${formatQty(d.qty)} · ${d.customer_name || '-'}</span>
          <span style="font-weight:700">${d.unit_price ? formatCurrency(d.unit_price * d.qty) : '-'}</span>
        </li>
      `).join('')}
    </ul>`;
  } catch {
    container.innerHTML = '<p style="font-size:0.85rem;color:var(--c-text-sub)">로드 실패</p>';
  }
}

// ── 액션: 상태 변경 ──
async function changeStatus(item) {
  const statuses = ['NORMAL', 'RISK', 'RESERVED', 'OUT'];
  const current = item.status || 'NORMAL';
  const next = statuses[(statuses.indexOf(current) + 1) % statuses.length];

  const reason = await askReason(`상태 변경: ${current} → ${next}`);
  if (reason === null) return;

  const before = { status: current };
  await updateDocument(COLLECTIONS.ITEMS, item.id, { status: next });
  await writeLog({
    entityType: 'item', entityId: item.id, action: 'UPDATE',
    before, after: { status: next }, reason
  });

  showToast(`상태 변경: ${next}`, 'success');
  await loadItems();
  selectItem(item.id);
}

// ── 액션: 최소수량 수정 ──
async function editMinQty(item) {
  const newMin = prompt(`최소수량 수정 (현재: ${item.qty_min || 0})`, item.qty_min || 0);
  if (newMin === null) return;

  const val = parseFloat(newMin);
  if (isNaN(val) || val < 0) { showToast('유효한 숫자를 입력하세요', 'error'); return; }

  const reason = await askReason('최소수량 수정 사유');
  if (reason === null) return;

  const before = { qty_min: item.qty_min };
  const newStatus = evaluateStatus(item.qty_on_hand || 0, val, item.status);

  await updateDocument(COLLECTIONS.ITEMS, item.id, { qty_min: val, status: newStatus });
  await writeLog({
    entityType: 'item', entityId: item.id, action: 'UPDATE',
    before, after: { qty_min: val, status: newStatus }, reason
  });

  showToast('최소수량 수정 완료', 'success');
  await loadItems();
  selectItem(item.id);
}

// ── 액션: 빠른 출고 ──
async function quickDelivery(item) {
  const qtyStr = prompt(`출고 수량 (현재 재고: ${item.qty_on_hand || 0})`, '1');
  if (qtyStr === null) return;

  const qty = parseFloat(qtyStr);
  if (isNaN(qty) || qty <= 0) { showToast('유효한 수량을 입력하세요', 'error'); return; }
  if (qty > (item.qty_on_hand || 0)) { showToast('재고보다 많은 출고 불가', 'error'); return; }

  const customer = prompt('납품처 (선택사항)', item.last_delivery_to || '');

  const reason = await askReason('출고 사유');
  if (reason === null) return;

  // 출고 기록
  await createDoc(COLLECTIONS.DELIVERIES, {
    item_id: item.id,
    item_name: item.name,
    customer_id: '',
    customer_name: customer || '',
    qty: qty,
    delivered_at: new Date().toISOString(),
    note: reason
  });

  // 재고 갱신
  const newQty = (item.qty_on_hand || 0) - qty;
  const newStatus = evaluateStatus(newQty, item.qty_min || 0, item.status);
  const newAssetValue = newQty * (item.avg_cost || 0);

  const before = { qty_on_hand: item.qty_on_hand, status: item.status };
  await updateDocument(COLLECTIONS.ITEMS, item.id, {
    qty_on_hand: newQty,
    status: newStatus,
    asset_value: newAssetValue,
    last_delivery_to: customer || item.last_delivery_to,
    last_delivery_at: new Date().toISOString()
  });

  await writeLog({
    entityType: 'item', entityId: item.id, action: 'STOCK_ADJUST',
    before, after: { qty_on_hand: newQty, status: newStatus },
    reason: `출고 ${qty} → ${customer || '미지정'}`
  });

  showToast(`${qty} ${item.unit || 'EA'} 출고 완료`, 'success');
  await loadItems();
  selectItem(item.id);
}

// ── 품목 추가 폼 ──
function showAddForm() {
  selectedItemId = null;
  const panel = document.getElementById('detail-panel');
  panel.innerHTML = `
    <div class="detail-card">
      <h2>새 품목 등록</h2>
      <form id="item-form">
        <div class="form-group">
          <label>품목명 *</label>
          <input type="text" class="form-input" id="f-name" required placeholder="품목명 입력">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>SKU (선택)</label>
            <input type="text" class="form-input" id="f-sku" placeholder="내부코드">
          </div>
          <div class="form-group">
            <label>단위</label>
            <select class="form-select" id="f-unit">
              <option value="EA">EA (개)</option>
              <option value="BOX">BOX (박스)</option>
              <option value="kg">kg</option>
              <option value="L">L (리터)</option>
              <option value="mL">mL</option>
              <option value="SET">SET</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>초기 수량</label>
            <input type="number" class="form-input" id="f-qty" value="0" min="0" step="0.01">
          </div>
          <div class="form-group">
            <label>최소 수량</label>
            <input type="number" class="form-input" id="f-qtymin" value="0" min="0" step="0.01">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>초기 평균원가</label>
            <input type="number" class="form-input" id="f-avgcost" value="0" min="0">
          </div>
          <div class="form-group">
            <label>상태</label>
            <select class="form-select" id="f-status">
              <option value="NORMAL">정상</option>
              <option value="RISK">위험</option>
              <option value="RESERVED">고객지정</option>
              <option value="OUT">품절</option>
            </select>
          </div>
        </div>
        <div class="action-row">
          <button type="submit" class="btn btn-primary">저장</button>
          <button type="button" class="btn btn-secondary" id="btn-cancel-add">취소</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById('item-form').onsubmit = async (e) => {
    e.preventDefault();
    await saveNewItem();
  };

  document.getElementById('btn-cancel-add').onclick = () => {
    document.getElementById('detail-panel').innerHTML = '<div class="detail-empty">← 좌측 리스트에서 품목을 선택하세요</div>';
  };
}

async function saveNewItem() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { showToast('품목명을 입력하세요', 'error'); return; }

  const qty = parseFloat(document.getElementById('f-qty').value) || 0;
  const avgCost = parseFloat(document.getElementById('f-avgcost').value) || 0;

  const data = {
    name,
    sku: document.getElementById('f-sku').value.trim(),
    unit: document.getElementById('f-unit').value,
    qty_on_hand: qty,
    qty_min: parseFloat(document.getElementById('f-qtymin').value) || 0,
    status: document.getElementById('f-status').value,
    avg_cost: avgCost,
    asset_value: qty * avgCost,
    last_delivery_to: '',
    last_delivery_at: null
  };

  const id = await createDoc(COLLECTIONS.ITEMS, data);
  await writeLog({
    entityType: 'item', entityId: id, action: 'CREATE',
    after: data, reason: '신규 품목 등록'
  });

  showToast(`"${name}" 등록 완료`, 'success');
  await loadItems();
  selectItem(id);
}

// ── 품목 수정 폼 ──
function showEditForm(item) {
  const panel = document.getElementById('detail-panel');
  panel.innerHTML = `
    <div class="detail-card">
      <h2>품목 수정</h2>
      <form id="edit-form">
        <div class="form-group">
          <label>품목명 *</label>
          <input type="text" class="form-input" id="ef-name" value="${escapeHtml(item.name)}" required>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>SKU</label>
            <input type="text" class="form-input" id="ef-sku" value="${escapeHtml(item.sku || '')}">
          </div>
          <div class="form-group">
            <label>단위</label>
            <select class="form-select" id="ef-unit">
              ${['EA','BOX','kg','L','mL','SET'].map(u => `<option value="${u}" ${item.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="action-row">
          <button type="submit" class="btn btn-primary">수정 저장</button>
          <button type="button" class="btn btn-secondary" id="btn-cancel-edit">취소</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById('edit-form').onsubmit = async (e) => {
    e.preventDefault();
    const reason = await askReason('품목 수정 사유');
    if (reason === null) return;

    const before = { name: item.name, sku: item.sku, unit: item.unit };
    const after = {
      name: document.getElementById('ef-name').value.trim(),
      sku: document.getElementById('ef-sku').value.trim(),
      unit: document.getElementById('ef-unit').value
    };

    await updateDocument(COLLECTIONS.ITEMS, item.id, after);
    await writeLog({ entityType: 'item', entityId: item.id, action: 'UPDATE', before, after, reason });

    showToast('품목 수정 완료', 'success');
    await loadItems();
    selectItem(item.id);
  };

  document.getElementById('btn-cancel-edit').onclick = () => selectItem(item.id);
}

// ── 품목 삭제 ──
async function deleteItem(item) {
  if (!confirm(`"${item.name}" 을(를) 정말 삭제하시겠습니까?`)) return;

  const reason = await askReason('삭제 사유');
  if (reason === null) return;

  await writeLog({
    entityType: 'item', entityId: item.id, action: 'DELETE',
    before: item, reason
  });
  await updateDocument(COLLECTIONS.ITEMS, item.id, { status: 'DELETED' });
  // 실제 삭제 대신 소프트 삭제 (audit 추적 가능)

  showToast(`"${item.name}" 삭제 완료`, 'success');
  selectedItemId = null;
  document.getElementById('detail-panel').innerHTML = '<div class="detail-empty">← 좌측 리스트에서 품목을 선택하세요</div>';
  await loadItems();
}

// ── 사용자 관리 (관리자 전용) ──
async function setupUserMgmt() {
  const user = getCurrentUser();
  if (!user || user.email !== getAdminEmail()) return;

  // 네비에 사용자 관리 버튼 추가
  const userInfo = document.getElementById('user-info');
  if (!userInfo) return;

  const mgmtBtn = document.createElement('button');
  mgmtBtn.className = 'btn-logout';
  mgmtBtn.textContent = '사용자 관리';
  mgmtBtn.style.marginRight = '4px';
  userInfo.insertBefore(mgmtBtn, userInfo.firstChild);

  mgmtBtn.addEventListener('click', () => showUserMgmtPanel());
}

async function showUserMgmtPanel() {
  const panel = document.getElementById('detail-panel');
  selectedItemId = null;
  renderList();

  const users = await getAllowedUsers();

  panel.innerHTML = `
    <div class="detail-card">
      <h2>접근 허용 사용자</h2>
      <div class="sku">여기에 등록된 Gmail만 로그인 가능합니다</div>

      <ul class="user-mgmt-list" id="user-list">
        ${users.map(u => `
          <li>
            <div>
              <strong>${escapeHtml(u.name || u.email)}</strong>
              <div style="font-size:0.8rem;color:var(--c-text-sub)">${escapeHtml(u.email)} · ${u.role === 'admin' ? '관리자' : '사용자'}</div>
            </div>
            ${u.email !== getAdminEmail() ? `<button class="btn btn-danger btn-sm" data-email="${escapeHtml(u.email)}">삭제</button>` : '<span style="font-size:0.75rem;color:var(--c-primary);font-weight:700">관리자</span>'}
          </li>
        `).join('')}
      </ul>

      <div class="user-mgmt-add" style="margin-top:16px">
        <input type="email" class="form-input" id="new-user-email" placeholder="추가할 Gmail 주소">
        <button class="btn btn-primary btn-sm" id="btn-add-user">추가</button>
      </div>
    </div>
  `;

  // 추가 버튼
  document.getElementById('btn-add-user').addEventListener('click', async () => {
    const emailInput = document.getElementById('new-user-email');
    const email = emailInput.value.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      showToast('유효한 이메일을 입력하세요', 'error');
      return;
    }

    await addAllowedUser(email, 'user', '');
    showToast(`${email} 추가 완료`, 'success');
    showUserMgmtPanel(); // 새로고침
  });

  // 삭제 버튼
  panel.querySelectorAll('[data-email]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const email = btn.dataset.email;
      if (!confirm(`${email} 을(를) 삭제하시겠습니까?`)) return;

      await removeAllowedUser(email);
      showToast(`${email} 삭제 완료`, 'success');
      showUserMgmtPanel();
    });
  });
}

// ── 이벤트 바인딩 ──
function bindEvents() {
  // 검색
  document.getElementById('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    applyFilters();
  });

  // 상태 필터
  document.querySelectorAll('.filter-btn:not(.toggle-shortage)').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn:not(.toggle-shortage)').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      applyFilters();
    });
  });

  // 부족만 토글
  const shortageBtn = document.querySelector('.toggle-shortage');
  if (shortageBtn) {
    shortageBtn.addEventListener('click', () => {
      shortageOnly = !shortageOnly;
      shortageBtn.classList.toggle('active', shortageOnly);
      applyFilters();
    });
  }

  // 품목 추가 버튼 (상단 툴바 상시 표시)
  const addBtn = document.getElementById('btn-add-item');
  if (addBtn) addBtn.addEventListener('click', () => showAddForm());

  // 빈 상태 버튼 (이벤트 위임)
  document.getElementById('item-list').addEventListener('click', (e) => {
    if (e.target.id === 'btn-add-first' || e.target.closest('#btn-add-first')) {
      showAddForm();
    }
  });

  // 키보드 단축키: Ctrl+N = 새 품목
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      showAddForm();
    }
  });
}
