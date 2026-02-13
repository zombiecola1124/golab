/**
 * purchases.js — 입고/원가 화면 (purchases.html)
 * 매입 이력 리스트 + 입력 폼 + "재고로 전송" 로직
 */

import { initApp, calcWeightedAvgCost, evaluateStatus } from './app.js';
import { readAll, createDoc, updateDocument, readDoc, COLLECTIONS } from './db.js';
import { writeLog } from './audit.js';
import {
  formatKRW, formatCurrency, formatQty, formatDate,
  showToast, showLoading, showEmpty, escapeHtml, attachAutocomplete
} from './ui.js';

// ── 상태 ──
let allPurchases = [];
let allItems = [];
let allVendors = [];
let searchQuery = '';
let selectedPurchaseId = null;

// ── 초기화 ──
document.addEventListener('DOMContentLoaded', async () => {
  await initApp();
  await loadData();
  bindEvents();
});

async function loadData() {
  [allPurchases, allItems, allVendors] = await Promise.all([
    readAll(COLLECTIONS.PURCHASES, { orderField: 'purchased_at', orderDir: 'desc' }),
    readAll(COLLECTIONS.ITEMS, { orderField: 'name', orderDir: 'asc' }),
    readAll(COLLECTIONS.VENDORS)
  ]);
  renderList();
}

// ── 리스트 렌더링 ──
function renderList() {
  const container = document.getElementById('purchase-list');

  let filtered = allPurchases;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(p =>
      (p.item_name || '').toLowerCase().includes(q) ||
      (p.vendor_name || '').toLowerCase().includes(q)
    );
  }

  if (filtered.length === 0) {
    showEmpty(container, '📋', allPurchases.length === 0 ? '매입 이력이 없습니다' : '검색 결과 없음');
    return;
  }

  container.innerHTML = filtered.map(p => {
    const isSelected = p.id === selectedPurchaseId;
    return `
      <div class="list-item ${isSelected ? 'selected' : ''}" data-id="${p.id}">
        <div style="min-width:0">
          <div style="font-size:0.75rem;color:var(--c-text-sub)">${formatDate(p.purchased_at)}</div>
        </div>
        <div class="item-main">
          <div class="item-name">${escapeHtml(p.item_name || '-')}</div>
          <div class="item-sub">${escapeHtml(p.vendor_name || '-')} · ${formatQty(p.qty)} ${p.push_to_inventory ? '✅재고반영' : ''}</div>
        </div>
        <div class="item-qty">
          ${formatCurrency(p.total_cost || 0)}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.list-item').forEach(el => {
    el.onclick = () => showPurchaseDetail(el.dataset.id);
  });
}

// ── 매입 상세 보기 ──
function showPurchaseDetail(purchaseId) {
  selectedPurchaseId = purchaseId;
  renderList();

  const p = allPurchases.find(x => x.id === purchaseId);
  if (!p) return;

  const panel = document.getElementById('purchase-detail');
  panel.innerHTML = `
    <div class="detail-card">
      <h2>${escapeHtml(p.item_name || '-')}</h2>
      <div class="sku">매입일: ${formatDate(p.purchased_at)} · 공급사: ${escapeHtml(p.vendor_name || '-')}</div>

      <div class="stat-grid">
        <div class="stat-box">
          <div class="stat-label">수량</div>
          <div class="stat-value">${formatQty(p.qty)}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">단가</div>
          <div class="stat-value primary">${formatCurrency(p.unit_cost || 0)}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">가공비</div>
          <div class="stat-value">${formatCurrency(p.processing_fee || 0)}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">운임</div>
          <div class="stat-value">${formatCurrency(p.shipping_fee || 0)}</div>
        </div>
      </div>

      <div class="total-display">
        <div class="total-label">총원가 (공급가)</div>
        <div class="total-value">${formatCurrency(p.total_cost || 0)}</div>
      </div>

      ${p.currency && p.currency !== 'KRW' ? `
        <div style="font-size:0.85rem;color:var(--c-text-sub);margin:8px 0">
          원통화: ${p.currency} · 환율: ${p.fx_rate || '-'}
        </div>
      ` : ''}

      ${p.note ? `<div style="font-size:0.9rem;margin:12px 0;padding:10px;background:var(--c-bg);border-radius:var(--radius)">📝 ${escapeHtml(p.note)}</div>` : ''}

      <div style="margin-top:8px">
        ${p.push_to_inventory ? '<span style="color:var(--c-success);font-weight:700">✅ 재고 반영 완료</span>' : '<span style="color:var(--c-text-sub)">❌ 재고 미반영</span>'}
      </div>
    </div>
  `;
}

// ── 새 매입 등록 폼 ──
function showNewForm() {
  selectedPurchaseId = null;
  renderList();

  const panel = document.getElementById('purchase-detail');
  panel.innerHTML = `
    <div class="detail-card">
      <h2>새 매입 등록</h2>
      <form id="purchase-form">

        <div class="form-group">
          <label>품목 선택 * (자동완성)</label>
          <div>
            <input type="text" class="form-input" id="pf-item" placeholder="품목명을 입력하면 검색됩니다" autocomplete="off">
          </div>
        </div>

        <div class="form-group">
          <label>공급사 (자동완성)</label>
          <div>
            <input type="text" class="form-input" id="pf-vendor" placeholder="공급사명" autocomplete="off">
          </div>
        </div>

        <div class="form-group">
          <label>매입일 *</label>
          <input type="date" class="form-input" id="pf-date" value="${new Date().toISOString().split('T')[0]}">
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>수량 *</label>
            <input type="number" class="form-input" id="pf-qty" min="0.01" step="0.01" required placeholder="0">
          </div>
          <div class="form-group">
            <label>단가 (원화) *</label>
            <input type="number" class="form-input" id="pf-unitcost" min="0" step="1" required placeholder="0">
          </div>
        </div>

        <div class="form-row three">
          <div class="form-group">
            <label>통화 (참고)</label>
            <select class="form-select" id="pf-currency">
              <option value="KRW" selected>KRW</option>
              <option value="USD">USD</option>
              <option value="JPY">JPY</option>
              <option value="CNY">CNY</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
          <div class="form-group">
            <label>환율 (참고)</label>
            <input type="number" class="form-input" id="pf-fxrate" step="0.01" placeholder="참고용">
          </div>
          <div class="form-group">
            <label>&nbsp;</label>
            <div style="font-size:0.8rem;color:var(--c-text-sub);padding-top:10px">v1: 원화 수동환산</div>
          </div>
        </div>

        <div class="form-row three">
          <div class="form-group">
            <label>가공비</label>
            <input type="number" class="form-input" id="pf-processing" min="0" step="1" value="0">
          </div>
          <div class="form-group">
            <label>운임</label>
            <input type="number" class="form-input" id="pf-shipping" min="0" step="1" value="0">
          </div>
          <div class="form-group">
            <label>기타비용</label>
            <input type="number" class="form-input" id="pf-other" min="0" step="1" value="0">
          </div>
        </div>

        <div class="total-display">
          <div class="total-label">총원가 (공급가) 자동 계산</div>
          <div class="total-value" id="pf-total">₩0</div>
        </div>

        <div class="form-check">
          <input type="checkbox" id="pf-push" checked>
          <label for="pf-push">저장 시 재고로 전송 (수량 + 평균원가 자동 갱신)</label>
        </div>

        <div class="form-group">
          <label>메모</label>
          <textarea class="form-input" id="pf-note" rows="2" placeholder="참고사항"></textarea>
        </div>

        <div class="action-row">
          <button type="submit" class="btn btn-primary">매입 저장</button>
          <button type="button" class="btn btn-secondary" id="btn-cancel-purchase">취소</button>
        </div>
      </form>
    </div>
  `;

  // 자동완성 설정: 품목
  const itemInput = document.getElementById('pf-item');
  attachAutocomplete(
    itemInput,
    () => allItems.map(i => ({ id: i.id, label: i.name, sub: i.sku || '' })),
    (selected) => { /* 선택 시 별도 처리 없음, ID는 input.getSelectedId()로 접근 */ }
  );

  // 자동완성 설정: 공급사
  const vendorInput = document.getElementById('pf-vendor');
  attachAutocomplete(
    vendorInput,
    () => allVendors.map(v => ({ id: v.id, label: v.name, sub: '' })),
    (selected) => { }
  );

  // 원가 자동 계산
  ['pf-qty', 'pf-unitcost', 'pf-processing', 'pf-shipping', 'pf-other'].forEach(id => {
    document.getElementById(id).addEventListener('input', calcTotal);
  });

  // 폼 이벤트
  document.getElementById('purchase-form').onsubmit = async (e) => {
    e.preventDefault();
    await savePurchase();
  };

  document.getElementById('btn-cancel-purchase').onclick = () => {
    panel.innerHTML = '<div class="detail-empty">← 매입 내역을 선택하거나 "새 매입 등록"을 클릭하세요</div>';
  };
}

// ── 총원가 자동 계산 ──
function calcTotal() {
  const qty = parseFloat(document.getElementById('pf-qty').value) || 0;
  const unitCost = parseFloat(document.getElementById('pf-unitcost').value) || 0;
  const processing = parseFloat(document.getElementById('pf-processing').value) || 0;
  const shipping = parseFloat(document.getElementById('pf-shipping').value) || 0;
  const other = parseFloat(document.getElementById('pf-other').value) || 0;

  const total = (qty * unitCost) + processing + shipping + other;
  document.getElementById('pf-total').textContent = formatCurrency(total);
}

// ── 매입 저장 ──
async function savePurchase() {
  const itemInput = document.getElementById('pf-item');
  const itemId = itemInput.getSelectedId();

  if (!itemId) {
    showToast('품목을 목록에서 선택해주세요 (자유입력 불가)', 'error');
    itemInput.focus();
    return;
  }

  const qty = parseFloat(document.getElementById('pf-qty').value);
  const unitCost = parseFloat(document.getElementById('pf-unitcost').value);

  if (!qty || qty <= 0) { showToast('수량을 입력하세요', 'error'); return; }
  if (isNaN(unitCost)) { showToast('단가를 입력하세요', 'error'); return; }

  const processing = parseFloat(document.getElementById('pf-processing').value) || 0;
  const shipping = parseFloat(document.getElementById('pf-shipping').value) || 0;
  const other = parseFloat(document.getElementById('pf-other').value) || 0;
  const totalCost = (qty * unitCost) + processing + shipping + other;

  const vendorInput = document.getElementById('pf-vendor');
  const vendorId = vendorInput.getSelectedId ? vendorInput.getSelectedId() : '';
  const vendorName = vendorInput.value.trim();

  // 공급사가 새로운 이름이면 자동 등록
  let finalVendorId = vendorId;
  if (!vendorId && vendorName) {
    finalVendorId = await createDoc(COLLECTIONS.VENDORS, { name: vendorName, contact: '', memo: '' });
    await writeLog({ entityType: 'vendor', entityId: finalVendorId, action: 'CREATE', after: { name: vendorName }, reason: '매입 등록 시 자동 생성' });
    // 다음을 위해 목록 갱신
    allVendors = await readAll(COLLECTIONS.VENDORS);
  }

  const item = allItems.find(i => i.id === itemId);
  const pushToInventory = document.getElementById('pf-push').checked;

  const purchaseData = {
    item_id: itemId,
    item_name: item ? item.name : '',
    vendor_id: finalVendorId || '',
    vendor_name: vendorName,
    qty,
    unit_cost: unitCost,
    currency: document.getElementById('pf-currency').value,
    fx_rate: parseFloat(document.getElementById('pf-fxrate').value) || null,
    processing_fee: processing,
    shipping_fee: shipping,
    other_fee: other,
    total_cost: totalCost,
    purchased_at: document.getElementById('pf-date').value,
    note: document.getElementById('pf-note').value.trim(),
    push_to_inventory: pushToInventory
  };

  // 매입 저장
  const purchaseId = await createDoc(COLLECTIONS.PURCHASES, purchaseData);
  await writeLog({
    entityType: 'purchase', entityId: purchaseId, action: 'CREATE',
    after: purchaseData, reason: '매입 등록'
  });

  // 재고 반영
  if (pushToInventory && item) {
    const oldQty = item.qty_on_hand || 0;
    const oldAvgCost = item.avg_cost || 0;

    const newQty = oldQty + qty;
    const newAvgCost = calcWeightedAvgCost(oldQty, oldAvgCost, qty, totalCost);
    const newAssetValue = newQty * newAvgCost;
    const newStatus = evaluateStatus(newQty, item.qty_min || 0, item.status);

    const before = {
      qty_on_hand: oldQty,
      avg_cost: oldAvgCost,
      asset_value: item.asset_value,
      status: item.status
    };

    await updateDocument(COLLECTIONS.ITEMS, itemId, {
      qty_on_hand: newQty,
      avg_cost: Math.round(newAvgCost),
      asset_value: Math.round(newAssetValue),
      status: newStatus
    });

    await writeLog({
      entityType: 'item', entityId: itemId, action: 'STOCK_ADJUST',
      before,
      after: { qty_on_hand: newQty, avg_cost: Math.round(newAvgCost), asset_value: Math.round(newAssetValue), status: newStatus },
      reason: `매입 입고 (purchase_id: ${purchaseId})`
    });
  }

  showToast('매입 저장 완료' + (pushToInventory ? ' + 재고 반영' : ''), 'success');
  await loadData();

  // 방금 저장한 매입 상세 표시
  showPurchaseDetail(purchaseId);
}

// ── 이벤트 바인딩 ──
function bindEvents() {
  // 검색
  document.getElementById('purchase-search').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderList();
  });

  // 새 매입 등록 버튼
  document.getElementById('btn-new-purchase').addEventListener('click', showNewForm);

  // 키보드 단축키: Ctrl+N = 새 매입
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      showNewForm();
    }
  });
}
