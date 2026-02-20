/**
 * auth.js — MASTER_CHAT_ID 화이트리스트 기반 접근 제어
 * 환경변수에 쉼표로 복수 ID 등록 가능
 */

const MASTER_CHAT_IDS = (process.env.MASTER_CHAT_ID || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

function isAuthorized(chatId) {
  return MASTER_CHAT_IDS.includes(String(chatId));
}

function getChatIds() {
  return MASTER_CHAT_IDS;
}

module.exports = { isAuthorized, getChatIds };
