/**
 * handlers.js — 텔레그램 명령어 핸들러
 * /p /s /low /c /ar /help
 */

const {
  searchItems, getLowStockItems, searchCustomers,
  getUnpaidInvoices, getRecentPurchases
} = require('./db');
const { writeLog } = require('./logger');

function fmt(num) {
  if (num == null || isNaN(num)) return '0';
  return Math.round(num).toLocaleString('ko-KR');
}

function fmtDate(val) {
  if (!val) return '-';
  try {
    const d = val.toDate ? val.toDate() : new Date(val);
    if (isNaN(d)) return '-';
    return d.toLocaleDateString('ko-KR');
  } catch (_) { return '-'; }
}

// ── /p [품목] — 단가 조회 ──

async function handlePrice(bot, msg, args) {
  const keyword = args.join(' ').trim();
  if (!keyword) {
    await bot.sendMessage(msg.chat.id, '사용법: /p [품목명]\n예: /p Ag Powder');
    return;
  }

  const items = await searchItems(keyword);

  if (items.length === 0) {
    await bot.sendMessage(msg.chat.id, `🔍 "${keyword}" — 검색 결과 없음`);
    await writeLog('price_query', { keyword, results: 0 }, msg);
    return;
  }

  let text = `💰 단가 조회: "${keyword}"\n${'─'.repeat(22)}\n`;

  for (const item of items.slice(0, 8)) {
    text += `\n📦 ${item.name}`;
    if (item.sku) text += ` (${item.sku})`;
    text += `\n   평균원가: ₩${fmt(item.avg_cost || 0)}`;
    text += `\n   재고가치: ₩${fmt(item.asset_value || 0)}`;
    text += `\n   현재수량: ${fmt(item.qty_on_hand || 0)} ${item.unit || 'EA'}`;

    try {
      const purchases = await getRecentPurchases(item.id, 3);
      if (purchases.length > 0) {
        text += `\n   최근 매입:`;
        for (const p of purchases) {
          text += `\n     ${fmtDate(p.purchased_at)} · ₩${fmt(p.unit_cost)} × ${fmt(p.qty)}`;
          if (p.vendor_name) text += ` · ${p.vendor_name}`;
        }
      }
    } catch (_) { /* 인덱스 미설정 시 무시 */ }

    text += '\n';
  }

  if (items.length > 8) text += `\n... 외 ${items.length - 8}건`;

  await bot.sendMessage(msg.chat.id, text);
  await writeLog('price_query', { keyword, results: items.length }, msg);
}

// ── /s [품목] — 재고 조회 ──

async function handleStock(bot, msg, args) {
  const keyword = args.join(' ').trim();
  if (!keyword) {
    await bot.sendMessage(msg.chat.id, '사용법: /s [품목명]\n예: /s Ag Powder');
    return;
  }

  const items = await searchItems(keyword);

  if (items.length === 0) {
    await bot.sendMessage(msg.chat.id, `🔍 "${keyword}" — 검색 결과 없음`);
    await writeLog('stock_query', { keyword, results: 0 }, msg);
    return;
  }

  let text = `📊 재고 조회: "${keyword}"\n${'─'.repeat(22)}\n`;

  for (const item of items.slice(0, 10)) {
    const qty = item.qty_on_hand || 0;
    const min = item.qty_min || 0;
    const status = item.status || 'NORMAL';

    let icon = '🟢';
    if (status === 'OUT' || qty <= 0) icon = '🔴';
    else if (status === 'RISK' || qty < min) icon = '🟡';
    else if (status === 'RESERVED') icon = '🟣';

    text += `\n${icon} ${item.name}`;
    if (item.sku) text += ` (${item.sku})`;
    text += `\n   수량: ${fmt(qty)} / 최소: ${fmt(min)} ${item.unit || 'EA'}`;

    if (qty < min && qty > 0) {
      text += `\n   ⚠️ 부족분: ${fmt(min - qty)} ${item.unit || 'EA'}`;
    }

    if (item.last_delivery_to) {
      text += `\n   최종납품: ${item.last_delivery_to} · ${fmtDate(item.last_delivery_at)}`;
    }
    text += '\n';
  }

  if (items.length > 10) text += `\n... 외 ${items.length - 10}건`;

  await bot.sendMessage(msg.chat.id, text);
  await writeLog('stock_query', { keyword, results: items.length }, msg);
}

// ── /low — 부족 품목 리스트 ──

async function handleLow(bot, msg) {
  const items = await getLowStockItems();

  if (items.length === 0) {
    await bot.sendMessage(msg.chat.id, '✅ 부족 품목이 없습니다. 모든 재고 정상.');
    await writeLog('low_query', { results: 0 }, msg);
    return;
  }

  let text = `🚨 부족/위험 품목: ${items.length}건\n${'─'.repeat(22)}\n`;

  for (const item of items.slice(0, 20)) {
    const qty = item.qty_on_hand || 0;
    const min = item.qty_min || 0;

    let icon = '🔴';
    if (qty > 0 && qty < min) icon = '🟡';

    text += `\n${icon} ${item.name}`;
    text += ` — ${fmt(qty)}/${fmt(min)} ${item.unit || 'EA'}`;

    if (qty <= 0) text += ' [품절]';
    else if (qty < min) text += ` [부족 ${fmt(min - qty)}]`;
  }

  if (items.length > 20) text += `\n\n... 외 ${items.length - 20}건`;

  await bot.sendMessage(msg.chat.id, text);
  await writeLog('low_query', { results: items.length }, msg);
}

// ── /c [업체] — 거래처 브리핑 ──

async function handleCustomer(bot, msg, args) {
  const keyword = args.join(' ').trim();
  if (!keyword) {
    await bot.sendMessage(msg.chat.id, '사용법: /c [업체명]\n예: /c AGC');
    return;
  }

  const results = await searchCustomers(keyword);

  if (results.length === 0) {
    await bot.sendMessage(msg.chat.id, `🔍 "${keyword}" — 거래처 검색 결과 없음`);
    await writeLog('customer_query', { keyword, results: 0 }, msg);
    return;
  }

  let text = `🏢 거래처 브리핑: "${keyword}"\n${'─'.repeat(22)}\n`;

  for (const c of results.slice(0, 10)) {
    const typeLabel = c.type === 'vendor' ? '공급사' : '고객사';
    const typeIcon = c.type === 'vendor' ? '🔧' : '🤝';

    text += `\n${typeIcon} [${typeLabel}] ${c.name}`;
    if (c.contact) text += `\n   연락처: ${c.contact}`;
    if (c.memo) text += `\n   메모: ${c.memo}`;
    text += '\n';
  }

  if (results.length > 10) text += `\n... 외 ${results.length - 10}건`;

  await bot.sendMessage(msg.chat.id, text);
  await writeLog('customer_query', { keyword, results: results.length }, msg);
}

// ── /ar — 미수금 요약 ──

async function handleAR(bot, msg) {
  let invoices;
  try {
    invoices = await getUnpaidInvoices();
  } catch (_) {
    await bot.sendMessage(msg.chat.id,
      '📋 미수금 데이터가 아직 없습니다.\n(정산/증빙 기능은 v2에서 본격화)'
    );
    await writeLog('ar_query', { error: 'no_data' }, msg);
    return;
  }

  if (invoices.length === 0) {
    await bot.sendMessage(msg.chat.id, '✅ 미수금 없음. 모든 정산 완료.');
    await writeLog('ar_query', { results: 0, total: 0 }, msg);
    return;
  }

  let totalSupply = 0, totalVat = 0, paidSupply = 0, paidVat = 0;

  for (const inv of invoices) {
    totalSupply += inv.supply_amount || 0;
    totalVat += inv.vat_amount || 0;
    paidSupply += inv.paid_supply_amount || 0;
    paidVat += inv.paid_vat_amount || 0;
  }

  const unpaidSupply = totalSupply - paidSupply;
  const unpaidVat = totalVat - paidVat;
  const unpaidTotal = unpaidSupply + unpaidVat;

  let text = `💳 미수금 요약\n${'─'.repeat(22)}\n`;
  text += `\n미수 건수: ${invoices.length}건`;
  text += `\n미수 공급가: ₩${fmt(unpaidSupply)}`;
  text += `\n미수 VAT: ₩${fmt(unpaidVat)}`;
  text += `\n${'─'.repeat(22)}`;
  text += `\n총 미수금: ₩${fmt(unpaidTotal)}`;

  // 거래처별 그룹핑
  const byCustomer = {};
  for (const inv of invoices) {
    const name = inv.customer_name || '미지정';
    if (!byCustomer[name]) byCustomer[name] = 0;
    byCustomer[name] += (inv.total_amount || 0)
      - (inv.paid_supply_amount || 0)
      - (inv.paid_vat_amount || 0);
  }

  const sorted = Object.entries(byCustomer).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0) {
    text += `\n\n거래처별:`;
    for (const [name, amount] of sorted.slice(0, 10)) {
      text += `\n  ${name}: ₩${fmt(amount)}`;
    }
  }

  await bot.sendMessage(msg.chat.id, text);
  await writeLog('ar_query', { results: invoices.length, total: unpaidTotal }, msg);
}

// ── /help — 도움말 ──

function handleHelp(bot, msg, commandConfig) {
  let text = `📖 GoLab Bot 명령어\n${'─'.repeat(22)}\n`;

  for (const [, cmd] of Object.entries(commandConfig)) {
    text += `\n${cmd.aliases[0]}  ${cmd.description}`;
    text += `\n   ${cmd.usage}`;
    if (cmd.aliases.length > 1) {
      text += `\n   별칭: ${cmd.aliases.join(', ')}`;
    }
    text += '\n';
  }

  text += `\n/help — 이 도움말 표시`;
  text += `\n\n💡 한글 명령어도 지원됩니다 (예: /단가, /재고, /부족)`;

  bot.sendMessage(msg.chat.id, text);
}

module.exports = {
  handlePrice,
  handleStock,
  handleLow,
  handleCustomer,
  handleAR,
  handleHelp
};
