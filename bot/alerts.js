/**
 * alerts.js — Firestore 실시간 리스너 → 텔레그램 자동 알림
 * - 재고 변경 시 최소재고 하회 품목 즉시 알림
 * - 견적서 PDF 생성 시 텔레그램 전송 (v2 확장)
 */

const { getDB } = require('./db');
const { writeLog } = require('./logger');

let unsubscribeItems = null;
const knownLowStock = new Set();
let isInitialLoad = true;

function fmt(num) {
  if (num == null || isNaN(num)) return '0';
  return Math.round(num).toLocaleString('ko-KR');
}

function startAlerts(bot, chatIds) {
  if (chatIds.length === 0) {
    console.log('[ALERTS] Chat ID 미설정 — 알림 비활성화');
    return;
  }

  console.log('[ALERTS] 실시간 알림 리스너 시작...');

  unsubscribeItems = getDB().collection('items').onSnapshot(
    (snapshot) => {
      // 최초 로드: 기존 부족 품목 기록만 (알림 X)
      if (isInitialLoad) {
        snapshot.docs.forEach(doc => {
          const item = doc.data();
          if ((item.status || '') === 'DELETED') return;
          const qty = item.qty_on_hand || 0;
          const min = item.qty_min || 0;
          if (qty < min || qty <= 0) {
            knownLowStock.add(doc.id);
          }
        });
        isInitialLoad = false;
        console.log(`[ALERTS] 초기 부족 품목 ${knownLowStock.size}건 인식 완료`);
        return;
      }

      // 변경분만 처리
      snapshot.docChanges().forEach(async (change) => {
        if (change.type !== 'modified') return;

        const item = { id: change.doc.id, ...change.doc.data() };
        if ((item.status || '') === 'DELETED') return;

        const qty = item.qty_on_hand || 0;
        const min = item.qty_min || 0;

        // 새로 부족 상태 진입
        if (qty < min && qty > 0 && !knownLowStock.has(item.id)) {
          knownLowStock.add(item.id);

          const text = [
            `⚠️ 재고 부족 알림`,
            ``,
            `📦 ${item.name}${item.sku ? ` (${item.sku})` : ''}`,
            `   수량: ${fmt(qty)} / 최소: ${fmt(min)} ${item.unit || 'EA'}`,
            `   부족분: ${fmt(min - qty)} ${item.unit || 'EA'}`,
            ``,
            `매입 검토가 필요합니다.`
          ].join('\n');

          for (const chatId of chatIds) {
            try { await bot.sendMessage(chatId, text); }
            catch (e) { console.error('[ALERT] 발송 실패:', e.message); }
          }

          await writeLog('auto_alert_low_stock', {
            item_id: item.id, item_name: item.name, qty, min
          }, { chat: { id: 'system' }, from: {} });
        }

        // 품절 상태 진입
        if (qty <= 0 && !knownLowStock.has(item.id)) {
          knownLowStock.add(item.id);

          const text = [
            `🔴 품절 알림`,
            ``,
            `📦 ${item.name}${item.sku ? ` (${item.sku})` : ''}`,
            `   재고가 0이 되었습니다!`,
            ``,
            `긴급 매입이 필요합니다.`
          ].join('\n');

          for (const chatId of chatIds) {
            try { await bot.sendMessage(chatId, text); }
            catch (e) { console.error('[ALERT] 발송 실패:', e.message); }
          }

          await writeLog('auto_alert_out_of_stock', {
            item_id: item.id, item_name: item.name
          }, { chat: { id: 'system' }, from: {} });
        }

        // 재고 회복
        if (qty >= min && knownLowStock.has(item.id)) {
          knownLowStock.delete(item.id);
        }
      });
    },
    (error) => {
      console.error('[ALERTS] 리스너 오류:', error.message);
    }
  );

  console.log('[ALERTS] items 컬렉션 감시 활성화');
}

function stopAlerts() {
  if (unsubscribeItems) {
    unsubscribeItems();
    unsubscribeItems = null;
    console.log('[ALERTS] 리스너 해제');
  }
}

module.exports = { startAlerts, stopAlerts };
