/**
 * settlements.js — 정산/증빙 화면 (settlements.html)
 * KPI 카드 + 업체 필터 + 기간 필터 + 좌 리스트 + 우 상세/입력
 *
 * 비즈니스 로직:
 *  - 이익금 = 매출 - 매입
 *  - 고랩컴퍼니: 세금적립(30%) → 잔액의 60% = 친구몫, 40% = 내 순수익
 *  - 파트너사:   리베이트(30%) → 잔액의 60% = 친구몫, 40% = 내 순수익
 */

import { initApp } from './app.js';
import {
  readAll, createDoc, updateDocument, deleteDocument, COLLECTIONS
} from './db.js';
import { writeLog } from './audit.js';
import {
  formatKRW, formatCurrency, formatDate, showToast, askReason,
  showLoading, showEmpty, escapeHtml
} from './ui.js';

// ── 상수 ──
const PARTNERS = [
  '고랩컴퍼니', '제이앤컴퍼니', '제이유니버스', '우진', '어반에이치', '에이라이프'
];
const DEFAULT_DEDUCTION_RATE = 0.3;
const FRIEND_RATE = 0.6;
const MY_RATE = 0.4;

// ── 상태 ──
let allSettlements = [];
let filteredSettlements = [];
let selectedId = null;
let partnerFilter = 'ALL';
let evidenceFilter = null; // 'UNPAID' | 'NO_INVOICE' | null
let periodFilter = 'ALL';
let customDateFrom = null;
let customDateTo = null;
let searchQuery = '';

// ── 초기화 ──
document.addEventListener('DOMContentLoaded', async () => {
  await initApp();
  await loadSettlements();
  bindEvents();
  showSummaryPanel();
});

// ── 데이터 로드 ──
async function loadSettlements() {
  allSettlements = await readAll(COLLECTIONS.SETTLEMENTS, {
    orderField: 'date',
    orderDir: 'desc'
  });
  applyFilters();
  renderKPI();
}

// ── KPI 계산 ──
function renderKPI() {
  const items = getFilteredForKPI();

  const totalRevenue = items.reduce((s, i) => s + (i.revenue || 0), 0);
  const totalMyProfit = items.reduce((s, i) => s + (i.my_profit || 0), 0);
  const totalDeduction = items.reduce((s, i) => s + (i.deduction_amount || 0), 0);
  const unpaidCount = items.filter(i => !i.payment_received).length;

  document.getElementById('kpi-my-profit').textContent = formatCurrency(totalMyProfit);
  document.getElementById('kpi-revenue').textContent = formatCurrency(totalRevenue);
  document.getElementById('kpi-deduction').textContent = formatCurrency(totalDeduction);
  document.getElementById('kpi-unpaid').textContent = `${unpaidCount}건`;

  // 공제 카드 색상
  const dedCard = document.getElementById('kpi-deduction-card');
  dedCard.className = totalDeduction > 0 ? 'kpi-card stl-warning' : 'kpi-card green';

  // 미입금 카드 색상
  const unpaidCard = document.getElementById('kpi-unpaid-card');
  unpaidCard.className = unpaidCount > 0 ? 'kpi-card red' : 'kpi-card green';
}

// KPI는 기간/업체 필터만 적용 (증빙 필터 제외)
function getFilteredForKPI() {
  return allSettlements.filter(item => {
    if (partnerFilter !== 'ALL' && item.partner !== partnerFilter) return false;
    if (!passDateFilter(item)) return false;
    return true;
  });
}

// ── 필터 ──
function applyFilters() {
  filteredSettlements = allSettlements.filter(item => {
    // 업체 필터
    if (partnerFilter !== 'ALL' && item.partner !== partnerFilter) return false;

    // 증빙 필터
    if (evidenceFilter === 'UNPAID' && item.payment_received) return false;
    if (evidenceFilter === 'NO_INVOICE' && item.invoice_issued) return false;

    // 기간 필터
    if (!passDateFilter(item)) return false;

    // 검색
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const match =
        (item.customer_name || '').toLowerCase().includes(q) ||
        (item.product_name || '').toLowerCase().includes(q) ||
        (item.partner || '').toLowerCase().includes(q) ||
        (item.memo || '').toLowerCase().includes(q);
      if (!match) return false;
    }

    return true;
  });

  renderList();
}

function passDateFilter(item) {
  if (periodFilter === 'ALL') return true;
  if (!item.date) return true;

  const d = new Date(item.date);
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (periodFilter) {
    case 'THIS_MONTH':
      return d.getFullYear() === y && d.getMonth() === m;
    case 'LAST_MONTH': {
      const lm = m === 0 ? 11 : m - 1;
      const ly = m === 0 ? y - 1 : y;
      return d.getFullYear() === ly && d.getMonth() === lm;
    }
    case 'THIS_QUARTER': {
      const qStart = new Date(y, Math.floor(m / 3) * 3, 1);
      return d >= qStart && d <= now;
    }
    case 'THIS_YEAR':
      return d.getFullYear() === y;
    case 'CUSTOM':
      if (customDateFrom && d < new Date(customDateFrom)) return false;
      if (customDateTo && d > new Date(customDateTo + 'T23:59:59')) return false;
      return true;
    default:
      return true;
  }
}

// ── 리스트 렌더링 ──
function renderList() {
  const container = document.getElementById('stl-list');

  if (filteredSettlements.length === 0) {
    if (allSettlements.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📊</div>
          <p>정산 내역이 없습니다</p>
          <button class="btn btn-primary" style="margin-top:12px" id="btn-add-first-stl">+ 첫 정산 등록</button>
        </div>
      `;
      const btn = container.querySelector('#btn-add-first-stl');
      if (btn) btn.onclick = () => showAddForm();
    } else {
      showEmpty(container, '🔍', '검색 결과가 없습니다');
    }
    return;
  }

  container.innerHTML = filteredSettlements.map(item => {
    const isSelected = item.id === selectedId;
    const partnerShort = getPartnerShort(item.partner);
    return `
      <div class="list-item ${isSelected ? 'selected' : ''}" data-id="${item.id}">
        <span class="stl-partner-tag ${getPartnerClass(item.partner)}">${escapeHtml(partnerShort)}</span>
        <div class="item-main">
          <div class="item-name">${escapeHtml(item.product_name || '(물품미입력)')}</div>
          <div class="item-sub">
            ${escapeHtml(item.customer_name || '-')}
            · ${formatDate(item.date)}
            ${!item.payment_received ? '<span class="stl-badge unpaid">미입금</span>' : ''}
            ${!item.invoice_issued ? '<span class="stl-badge no-invoice">미발행</span>' : ''}
          </div>
        </div>
        <div class="item-qty">
          ${formatKRW(item.my_profit || 0)}
          <span style="font-size:0.7rem;font-weight:400;color:var(--c-text-sub)">원</span>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.list-item').forEach(el => {
    el.onclick = () => selectItem(el.dataset.id);
  });
}

function getPartnerShort(name) {
  const map = {
    '고랩컴퍼니': '고랩',
    '제이앤컴퍼니': '제이앤',
    '제이유니버스': '제이유니',
    '어반에이치': '어반H',
    '에이라이프': 'A라이프',
    '우진': '우진'
  };
  return map[name] || name || '-';
}

function getPartnerClass(name) {
  if (name === '고랩컴퍼니') return 'partner-golab';
  if (name === '제이앤컴퍼니') return 'partner-jn';
  if (name === '제이유니버스') return 'partner-ju';
  if (name === '우진') return 'partner-wj';
  if (name === '어반에이치') return 'partner-uh';
  if (name === '에이라이프') return 'partner-al';
  return '';
}

// ── 상세 패널 ──
function selectItem(id) {
  selectedId = id;
  renderList();

  const item = allSettlements.find(i => i.id === id);
  if (!item) return;

  const panel = document.getElementById('stl-detail');
  const deductionLabel = item.partner === '고랩컴퍼니' ? '세금적립' : '리베이트';

  panel.innerHTML = `
    <div class="detail-card">
      <div style="display:flex;justify-content:space-between;align-items:start">
        <div>
          <h2>${escapeHtml(item.product_name || '(물품미입력)')}</h2>
          <div class="sku">${escapeHtml(item.customer_name || '-')} · ${formatDate(item.date)}</div>
        </div>
        <span class="stl-partner-tag ${getPartnerClass(item.partner)}">${escapeHtml(item.partner || '-')}</span>
      </div>

      <div class="stat-grid">
        <div class="stat-box">
          <div class="stat-label">매출 (공급가)</div>
          <div class="stat-value">${formatCurrency(item.revenue || 0)}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">매입 (공급가)</div>
          <div class="stat-value">${formatCurrency(item.cost || 0)}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">이익금</div>
          <div class="stat-value ${(item.profit || 0) > 0 ? 'primary' : 'danger'}">${formatCurrency(item.profit || 0)}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">${deductionLabel} (${Math.round((item.deduction_rate || 0.3) * 100)}%)</div>
          <div class="stat-value">${formatCurrency(item.deduction_amount || 0)}</div>
        </div>
      </div>

      <div class="stl-split-bar">
        <div class="stl-split-item">
          <span class="stl-split-label">친구몫 (${Math.round((item.friend_rate || 0.6) * 100)}%)</span>
          <span class="stl-split-value">${formatCurrency(item.friend_share || 0)}</span>
        </div>
        <div class="stl-split-item highlight">
          <span class="stl-split-label">내 순수익 (${Math.round((item.my_rate || 0.4) * 100)}%)</span>
          <span class="stl-split-value">${formatCurrency(item.my_profit || 0)}</span>
        </div>
      </div>

      <div class="stl-evidence-section">
        <h3>증빙 상태</h3>
        <div class="stl-evidence-grid">
          <label class="stl-evidence-item">
            <input type="checkbox" ${item.invoice_issued ? 'checked' : ''} data-field="invoice_issued">
            <span>계산서 발행</span>
          </label>
          <label class="stl-evidence-item">
            <input type="checkbox" ${item.payment_received ? 'checked' : ''} data-field="payment_received">
            <span>입금 완료</span>
          </label>
          <label class="stl-evidence-item">
            <input type="checkbox" ${item.vat_received ? 'checked' : ''} data-field="vat_received">
            <span>부가세 입금</span>
          </label>
        </div>
        ${item.payment_date ? `<div style="font-size:0.85rem;color:var(--c-text-sub);margin-top:4px">입금일: ${item.payment_date}</div>` : ''}
      </div>

      ${item.memo ? `<div style="margin-top:12px;font-size:0.85rem;color:var(--c-text-sub);background:var(--c-bg);padding:10px 14px;border-radius:var(--radius)">메모: ${escapeHtml(item.memo)}</div>` : ''}

      <div class="action-row">
        <button class="btn btn-secondary btn-sm" id="btn-edit-stl">수정</button>
        <button class="btn btn-danger btn-sm" id="btn-delete-stl">삭제</button>
      </div>
    </div>
  `;

  // 증빙 체크박스 즉시 반영
  panel.querySelectorAll('.stl-evidence-item input').forEach(cb => {
    cb.addEventListener('change', async () => {
      const field = cb.dataset.field;
      const val = cb.checked;
      const update = { [field]: val };

      // 입금 체크 시 입금일 자동 기록
      if (field === 'payment_received' && val && !item.payment_date) {
        update.payment_date = new Date().toISOString().slice(0, 10);
      }

      const before = { [field]: item[field] };
      await updateDocument(COLLECTIONS.SETTLEMENTS, item.id, update);
      await writeLog({
        entityType: 'settlement', entityId: item.id, action: 'UPDATE',
        before, after: update, reason: `증빙 상태 변경: ${field}`
      });

      showToast('증빙 상태 업데이트', 'success');
      await loadSettlements();
      selectItem(item.id);
    });
  });

  // 수정/삭제
  document.getElementById('btn-edit-stl').onclick = () => showEditForm(item);
  document.getElementById('btn-delete-stl').onclick = () => deleteSettlement(item);
}

// ── 업체별 집계 요약 (기본 우측 패널) ──
function showSummaryPanel() {
  const panel = document.getElementById('stl-detail');
  const items = getFilteredForKPI();

  if (items.length === 0) {
    panel.innerHTML = `
      <div class="detail-empty">
        정산 내역을 등록하면 여기에 업체별 집계가 표시됩니다
      </div>
    `;
    return;
  }

  // 업체별 집계
  const summary = {};
  PARTNERS.forEach(p => { summary[p] = { count: 0, revenue: 0, cost: 0, profit: 0, deduction: 0, friend: 0, my: 0, unpaid: 0 }; });

  items.forEach(item => {
    const p = item.partner || '고랩컴퍼니';
    if (!summary[p]) summary[p] = { count: 0, revenue: 0, cost: 0, profit: 0, deduction: 0, friend: 0, my: 0, unpaid: 0 };
    summary[p].count++;
    summary[p].revenue += item.revenue || 0;
    summary[p].cost += item.cost || 0;
    summary[p].profit += item.profit || 0;
    summary[p].deduction += item.deduction_amount || 0;
    summary[p].friend += item.friend_share || 0;
    summary[p].my += item.my_profit || 0;
    if (!item.payment_received) summary[p].unpaid++;
  });

  const totalMy = items.reduce((s, i) => s + (i.my_profit || 0), 0);
  const totalFriend = items.reduce((s, i) => s + (i.friend_share || 0), 0);

  panel.innerHTML = `
    <div class="detail-card">
      <h2>업체별 정산 집계</h2>
      <div class="sku">총 ${items.length}건 · 필터 적용 결과</div>

      <div class="stl-summary-total">
        <div class="stl-summary-total-item">
          <span>내 순수익 합계</span>
          <strong style="color:var(--c-primary)">${formatCurrency(totalMy)}</strong>
        </div>
        <div class="stl-summary-total-item">
          <span>친구몫 합계</span>
          <strong>${formatCurrency(totalFriend)}</strong>
        </div>
      </div>

      <table class="stl-summary-table">
        <thead>
          <tr>
            <th>업체</th>
            <th>건수</th>
            <th>매출</th>
            <th>이익</th>
            <th>공제</th>
            <th>내수익</th>
            <th>미입금</th>
          </tr>
        </thead>
        <tbody>
          ${PARTNERS.map(p => {
            const s = summary[p];
            if (!s || s.count === 0) return '';
            return `
              <tr>
                <td><span class="stl-partner-tag sm ${getPartnerClass(p)}">${getPartnerShort(p)}</span></td>
                <td>${s.count}</td>
                <td>${formatKRW(s.revenue)}</td>
                <td>${formatKRW(s.profit)}</td>
                <td>${formatKRW(s.deduction)}</td>
                <td class="stl-col-my">${formatKRW(s.my)}</td>
                <td>${s.unpaid > 0 ? `<span style="color:var(--c-danger);font-weight:700">${s.unpaid}</span>` : '-'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ── 정산 등록 폼 ──
function showAddForm() {
  selectedId = null;
  const panel = document.getElementById('stl-detail');
  const today = new Date().toISOString().slice(0, 10);

  panel.innerHTML = `
    <div class="detail-card">
      <h2>새 정산 등록</h2>
      <form id="stl-form">
        <div class="form-row">
          <div class="form-group">
            <label>날짜 *</label>
            <input type="date" class="form-input" id="sf-date" value="${today}" required>
          </div>
          <div class="form-group">
            <label>진행업체 *</label>
            <select class="form-select" id="sf-partner" required>
              ${PARTNERS.map(p => `<option value="${p}">${p}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>판매처 (고객사)</label>
            <input type="text" class="form-input" id="sf-customer" placeholder="판매처명">
          </div>
          <div class="form-group">
            <label>물품명</label>
            <input type="text" class="form-input" id="sf-product" placeholder="물품명">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>매출 (공급가) *</label>
            <input type="number" class="form-input" id="sf-revenue" value="0" min="0" required>
          </div>
          <div class="form-group">
            <label>매입 (공급가) *</label>
            <input type="number" class="form-input" id="sf-cost" value="0" min="0" required>
          </div>
        </div>

        <div class="stl-calc-preview" id="stl-calc-preview">
          <div class="stl-calc-row">
            <span>이익금</span>
            <strong id="preview-profit">₩0</strong>
          </div>
          <div class="stl-calc-row">
            <span id="preview-deduction-label">세금적립 (30%)</span>
            <strong id="preview-deduction">₩0</strong>
          </div>
          <div class="stl-calc-row">
            <span>친구몫 (60%)</span>
            <strong id="preview-friend">₩0</strong>
          </div>
          <div class="stl-calc-row highlight">
            <span>내 순수익 (40%)</span>
            <strong id="preview-my">₩0</strong>
          </div>
        </div>

        <div class="form-row" style="margin-top:16px">
          <div class="form-group">
            <label>공제율 (%)</label>
            <input type="number" class="form-input" id="sf-deduction-rate" value="30" min="0" max="100" step="1">
          </div>
          <div class="form-group">
            <label>메모</label>
            <input type="text" class="form-input" id="sf-memo" placeholder="메모 (선택)">
          </div>
        </div>

        <div class="stl-evidence-section" style="margin-top:12px">
          <h3>증빙</h3>
          <div class="stl-evidence-grid">
            <label class="stl-evidence-item">
              <input type="checkbox" id="sf-invoice">
              <span>계산서 발행</span>
            </label>
            <label class="stl-evidence-item">
              <input type="checkbox" id="sf-paid">
              <span>입금 완료</span>
            </label>
            <label class="stl-evidence-item">
              <input type="checkbox" id="sf-vat">
              <span>부가세 입금</span>
            </label>
          </div>
        </div>

        <div class="action-row">
          <button type="submit" class="btn btn-primary">저장</button>
          <button type="button" class="btn btn-secondary" id="btn-cancel-stl">취소</button>
        </div>
      </form>
    </div>
  `;

  // 자동 계산 프리뷰
  const revenueInput = document.getElementById('sf-revenue');
  const costInput = document.getElementById('sf-cost');
  const rateInput = document.getElementById('sf-deduction-rate');
  const partnerSelect = document.getElementById('sf-partner');

  function updatePreview() {
    const revenue = parseFloat(revenueInput.value) || 0;
    const cost = parseFloat(costInput.value) || 0;
    const rate = (parseFloat(rateInput.value) || 30) / 100;
    const partner = partnerSelect.value;

    const calc = calculateSettlement(revenue, cost, rate);
    const label = partner === '고랩컴퍼니' ? '세금적립' : '리베이트';

    document.getElementById('preview-profit').textContent = formatCurrency(calc.profit);
    document.getElementById('preview-deduction').textContent = formatCurrency(calc.deduction_amount);
    document.getElementById('preview-deduction-label').textContent = `${label} (${Math.round(rate * 100)}%)`;
    document.getElementById('preview-friend').textContent = formatCurrency(calc.friend_share);
    document.getElementById('preview-my').textContent = formatCurrency(calc.my_profit);
  }

  revenueInput.addEventListener('input', updatePreview);
  costInput.addEventListener('input', updatePreview);
  rateInput.addEventListener('input', updatePreview);
  partnerSelect.addEventListener('change', updatePreview);
  updatePreview();

  // 저장
  document.getElementById('stl-form').onsubmit = async (e) => {
    e.preventDefault();
    await saveSettlement();
  };

  document.getElementById('btn-cancel-stl').onclick = () => {
    showSummaryPanel();
  };
}

// ── 정산 수정 폼 ──
function showEditForm(item) {
  const panel = document.getElementById('stl-detail');

  panel.innerHTML = `
    <div class="detail-card">
      <h2>정산 수정</h2>
      <form id="stl-edit-form">
        <div class="form-row">
          <div class="form-group">
            <label>날짜 *</label>
            <input type="date" class="form-input" id="ef-date" value="${item.date || ''}" required>
          </div>
          <div class="form-group">
            <label>진행업체 *</label>
            <select class="form-select" id="ef-partner" required>
              ${PARTNERS.map(p => `<option value="${p}" ${item.partner === p ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>판매처 (고객사)</label>
            <input type="text" class="form-input" id="ef-customer" value="${escapeHtml(item.customer_name || '')}">
          </div>
          <div class="form-group">
            <label>물품명</label>
            <input type="text" class="form-input" id="ef-product" value="${escapeHtml(item.product_name || '')}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>매출 (공급가) *</label>
            <input type="number" class="form-input" id="ef-revenue" value="${item.revenue || 0}" min="0" required>
          </div>
          <div class="form-group">
            <label>매입 (공급가) *</label>
            <input type="number" class="form-input" id="ef-cost" value="${item.cost || 0}" min="0" required>
          </div>
        </div>

        <div class="stl-calc-preview" id="stl-calc-preview-edit">
          <div class="stl-calc-row">
            <span>이익금</span>
            <strong id="epreview-profit">₩0</strong>
          </div>
          <div class="stl-calc-row">
            <span id="epreview-deduction-label">세금적립 (30%)</span>
            <strong id="epreview-deduction">₩0</strong>
          </div>
          <div class="stl-calc-row">
            <span>친구몫 (60%)</span>
            <strong id="epreview-friend">₩0</strong>
          </div>
          <div class="stl-calc-row highlight">
            <span>내 순수익 (40%)</span>
            <strong id="epreview-my">₩0</strong>
          </div>
        </div>

        <div class="form-row" style="margin-top:16px">
          <div class="form-group">
            <label>공제율 (%)</label>
            <input type="number" class="form-input" id="ef-deduction-rate" value="${Math.round((item.deduction_rate || 0.3) * 100)}" min="0" max="100" step="1">
          </div>
          <div class="form-group">
            <label>메모</label>
            <input type="text" class="form-input" id="ef-memo" value="${escapeHtml(item.memo || '')}">
          </div>
        </div>

        <div class="stl-evidence-section" style="margin-top:12px">
          <h3>증빙</h3>
          <div class="stl-evidence-grid">
            <label class="stl-evidence-item">
              <input type="checkbox" id="ef-invoice" ${item.invoice_issued ? 'checked' : ''}>
              <span>계산서 발행</span>
            </label>
            <label class="stl-evidence-item">
              <input type="checkbox" id="ef-paid" ${item.payment_received ? 'checked' : ''}>
              <span>입금 완료</span>
            </label>
            <label class="stl-evidence-item">
              <input type="checkbox" id="ef-vat" ${item.vat_received ? 'checked' : ''}>
              <span>부가세 입금</span>
            </label>
          </div>
          <div class="form-group" style="margin-top:8px">
            <label>입금일</label>
            <input type="date" class="form-input" id="ef-payment-date" value="${item.payment_date || ''}">
          </div>
        </div>

        <div class="action-row">
          <button type="submit" class="btn btn-primary">수정 저장</button>
          <button type="button" class="btn btn-secondary" id="btn-cancel-edit-stl">취소</button>
        </div>
      </form>
    </div>
  `;

  // 자동 계산 프리뷰
  const revenueInput = document.getElementById('ef-revenue');
  const costInput = document.getElementById('ef-cost');
  const rateInput = document.getElementById('ef-deduction-rate');
  const partnerSelect = document.getElementById('ef-partner');

  function updatePreview() {
    const revenue = parseFloat(revenueInput.value) || 0;
    const cost = parseFloat(costInput.value) || 0;
    const rate = (parseFloat(rateInput.value) || 30) / 100;
    const partner = partnerSelect.value;

    const calc = calculateSettlement(revenue, cost, rate);
    const label = partner === '고랩컴퍼니' ? '세금적립' : '리베이트';

    document.getElementById('epreview-profit').textContent = formatCurrency(calc.profit);
    document.getElementById('epreview-deduction').textContent = formatCurrency(calc.deduction_amount);
    document.getElementById('epreview-deduction-label').textContent = `${label} (${Math.round(rate * 100)}%)`;
    document.getElementById('epreview-friend').textContent = formatCurrency(calc.friend_share);
    document.getElementById('epreview-my').textContent = formatCurrency(calc.my_profit);
  }

  revenueInput.addEventListener('input', updatePreview);
  costInput.addEventListener('input', updatePreview);
  rateInput.addEventListener('input', updatePreview);
  partnerSelect.addEventListener('change', updatePreview);
  updatePreview();

  // 저장
  document.getElementById('stl-edit-form').onsubmit = async (e) => {
    e.preventDefault();
    await updateSettlement(item);
  };

  document.getElementById('btn-cancel-edit-stl').onclick = () => selectItem(item.id);
}

// ── 계산 로직 ──
function calculateSettlement(revenue, cost, deductionRate) {
  const profit = revenue - cost;
  const deduction_amount = Math.round(profit * deductionRate);
  const netAfterDeduction = profit - deduction_amount;
  const friend_share = Math.round(netAfterDeduction * FRIEND_RATE);
  const my_profit = netAfterDeduction - friend_share; // 나머지는 내 몫 (반올림 차이 보정)

  return {
    profit,
    deduction_amount,
    net_after_deduction: netAfterDeduction,
    friend_share,
    my_profit
  };
}

// ── 저장 ──
async function saveSettlement() {
  const date = document.getElementById('sf-date').value;
  const partner = document.getElementById('sf-partner').value;
  const customer = document.getElementById('sf-customer').value.trim();
  const product = document.getElementById('sf-product').value.trim();
  const revenue = parseFloat(document.getElementById('sf-revenue').value) || 0;
  const cost = parseFloat(document.getElementById('sf-cost').value) || 0;
  const deductionRate = (parseFloat(document.getElementById('sf-deduction-rate').value) || 30) / 100;
  const memo = document.getElementById('sf-memo').value.trim();

  if (!date) { showToast('날짜를 입력하세요', 'error'); return; }

  const calc = calculateSettlement(revenue, cost, deductionRate);
  const deductionType = partner === '고랩컴퍼니' ? 'TAX' : 'REBATE';

  const data = {
    date,
    partner,
    customer_name: customer,
    product_name: product,
    revenue,
    cost,
    profit: calc.profit,
    deduction_rate: deductionRate,
    deduction_amount: calc.deduction_amount,
    deduction_type: deductionType,
    net_after_deduction: calc.net_after_deduction,
    friend_rate: FRIEND_RATE,
    friend_share: calc.friend_share,
    my_rate: MY_RATE,
    my_profit: calc.my_profit,
    invoice_issued: document.getElementById('sf-invoice').checked,
    payment_received: document.getElementById('sf-paid').checked,
    payment_date: document.getElementById('sf-paid').checked ? new Date().toISOString().slice(0, 10) : '',
    vat_received: document.getElementById('sf-vat').checked,
    memo
  };

  const id = await createDoc(COLLECTIONS.SETTLEMENTS, data);
  await writeLog({
    entityType: 'settlement', entityId: id, action: 'CREATE',
    after: data, reason: '정산 등록'
  });

  showToast('정산 등록 완료', 'success');
  await loadSettlements();
  selectItem(id);
}

// ── 수정 저장 ──
async function updateSettlement(original) {
  const date = document.getElementById('ef-date').value;
  const partner = document.getElementById('ef-partner').value;
  const customer = document.getElementById('ef-customer').value.trim();
  const product = document.getElementById('ef-product').value.trim();
  const revenue = parseFloat(document.getElementById('ef-revenue').value) || 0;
  const cost = parseFloat(document.getElementById('ef-cost').value) || 0;
  const deductionRate = (parseFloat(document.getElementById('ef-deduction-rate').value) || 30) / 100;
  const memo = document.getElementById('ef-memo').value.trim();

  const reason = await askReason('정산 수정 사유');
  if (reason === null) return;

  const calc = calculateSettlement(revenue, cost, deductionRate);
  const deductionType = partner === '고랩컴퍼니' ? 'TAX' : 'REBATE';

  const data = {
    date,
    partner,
    customer_name: customer,
    product_name: product,
    revenue,
    cost,
    profit: calc.profit,
    deduction_rate: deductionRate,
    deduction_amount: calc.deduction_amount,
    deduction_type: deductionType,
    net_after_deduction: calc.net_after_deduction,
    friend_rate: FRIEND_RATE,
    friend_share: calc.friend_share,
    my_rate: MY_RATE,
    my_profit: calc.my_profit,
    invoice_issued: document.getElementById('ef-invoice').checked,
    payment_received: document.getElementById('ef-paid').checked,
    payment_date: document.getElementById('ef-payment-date').value || '',
    vat_received: document.getElementById('ef-vat').checked,
    memo
  };

  const before = {
    revenue: original.revenue, cost: original.cost, profit: original.profit,
    partner: original.partner, my_profit: original.my_profit
  };

  await updateDocument(COLLECTIONS.SETTLEMENTS, original.id, data);
  await writeLog({
    entityType: 'settlement', entityId: original.id, action: 'UPDATE',
    before, after: data, reason
  });

  showToast('정산 수정 완료', 'success');
  await loadSettlements();
  selectItem(original.id);
}

// ── 삭제 ──
async function deleteSettlement(item) {
  if (!confirm(`"${item.product_name || '정산건'}" 을(를) 삭제하시겠습니까?`)) return;

  const reason = await askReason('삭제 사유');
  if (reason === null) return;

  await writeLog({
    entityType: 'settlement', entityId: item.id, action: 'DELETE',
    before: item, reason
  });
  await deleteDocument(COLLECTIONS.SETTLEMENTS, item.id);

  showToast('정산 삭제 완료', 'success');
  selectedId = null;
  await loadSettlements();
  showSummaryPanel();
}

// ── 이벤트 바인딩 ──
function bindEvents() {
  // 검색
  document.getElementById('stl-search').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    applyFilters();
  });

  // 업체 필터
  document.querySelectorAll('.filter-btn:not(.stl-evidence-filter)').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn:not(.stl-evidence-filter)').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      partnerFilter = btn.dataset.filter;
      applyFilters();
      renderKPI();
      if (!selectedId) showSummaryPanel();
    });
  });

  // 증빙 필터
  document.querySelectorAll('.stl-evidence-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      const ev = btn.dataset.ev;
      if (evidenceFilter === ev) {
        evidenceFilter = null;
        btn.classList.remove('active');
      } else {
        document.querySelectorAll('.stl-evidence-filter').forEach(b => b.classList.remove('active'));
        evidenceFilter = ev;
        btn.classList.add('active');
      }
      applyFilters();
    });
  });

  // 기간 필터
  const periodSelect = document.getElementById('stl-period');
  const dateFrom = document.getElementById('stl-date-from');
  const dateTo = document.getElementById('stl-date-to');

  periodSelect.addEventListener('change', () => {
    periodFilter = periodSelect.value;
    if (periodFilter === 'CUSTOM') {
      dateFrom.style.display = 'inline-block';
      dateTo.style.display = 'inline-block';
    } else {
      dateFrom.style.display = 'none';
      dateTo.style.display = 'none';
    }
    applyFilters();
    renderKPI();
    if (!selectedId) showSummaryPanel();
  });

  dateFrom.addEventListener('change', () => {
    customDateFrom = dateFrom.value;
    applyFilters();
    renderKPI();
    if (!selectedId) showSummaryPanel();
  });

  dateTo.addEventListener('change', () => {
    customDateTo = dateTo.value;
    applyFilters();
    renderKPI();
    if (!selectedId) showSummaryPanel();
  });

  // 새 정산 버튼
  document.getElementById('btn-new-stl').addEventListener('click', () => showAddForm());

  // 빈 상태 첫 등록 버튼 (이벤트 위임)
  document.getElementById('stl-list').addEventListener('click', (e) => {
    if (e.target.id === 'btn-add-first-stl' || e.target.closest('#btn-add-first-stl')) {
      showAddForm();
    }
  });

  // 키보드 단축키: Ctrl+N
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      showAddForm();
    }
  });
}
