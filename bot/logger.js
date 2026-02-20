/**
 * logger.js — system_logs 컬렉션에 요약 로그 저장
 * 원칙: 응답 전문 저장 금지, 요약 + 참조 ID만
 */

const { getDB } = require('./db');

async function writeLog(action, summary, msg) {
  try {
    await getDB().collection('system_logs').add({
      source: 'telegram_bot',
      action,
      summary,
      chat_id: msg ? String(msg.chat.id) : null,
      username: msg ? (msg.from?.username || msg.from?.first_name || null) : null,
      created_at: new Date()
    });
  } catch (e) {
    console.error('[LOG] 로그 기록 실패:', e.message);
  }
}

module.exports = { writeLog };
