/**
 * GoLab Telegram Business Remote v1
 * ──────────────────────────────────
 * Firestore 읽기 중심 조회 + 실시간 재고 알림
 * 실행(발행/수정)은 v2
 */

require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const { initFirebase } = require('./db');
const { isAuthorized, getChatIds } = require('./auth');
const { startAlerts, stopAlerts } = require('./alerts');
const { writeLog } = require('./logger');
const {
  handlePrice, handleStock, handleLow,
  handleCustomer, handleAR, handleHelp
} = require('./handlers');

// ── 명령어 설정 로드 ──

const commands = require('./commands.json');

// alias → handler 매핑 빌드
const aliasMap = {};
for (const [, cmd] of Object.entries(commands)) {
  for (const alias of cmd.aliases) {
    aliasMap[alias.toLowerCase()] = cmd.handler;
  }
}

const HANDLER_MAP = {
  price: handlePrice,
  stock: handleStock,
  low: handleLow,
  customer: handleCustomer,
  ar: handleAR
};

// ── 환경변수 검증 ──

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN 환경변수가 설정되지 않았습니다.');
  console.error('   .env 파일을 확인하세요.');
  process.exit(1);
}

// ── Firebase 초기화 ──

try {
  initFirebase();
} catch (e) {
  console.error('❌ Firebase 초기화 실패:', e.message);
  console.error('   service-account.json 또는 FIREBASE_SERVICE_ACCOUNT_JSON 환경변수를 확인하세요.');
  process.exit(1);
}

// ── Bot 생성 ──

const bot = new TelegramBot(TOKEN, { polling: true });
const masterChatIds = getChatIds();

console.log('');
console.log('🤖 GoLab Telegram Bot v1 시작');
console.log(`   허용 Chat ID: ${masterChatIds.length > 0 ? masterChatIds.join(', ') : '(미설정 — 주의!)'}`);
console.log(`   등록 명령어: ${Object.keys(aliasMap).join(', ')}`);
console.log('');

// ── 메시지 핸들러 ──

bot.on('message', async (msg) => {
  const text = (msg.text || '').trim();
  if (!text.startsWith('/')) return;

  // 접근 제어
  if (!isAuthorized(msg.chat.id)) {
    await bot.sendMessage(msg.chat.id,
      `⛔ 접근 권한이 없습니다.\n\n내 Chat ID: ${msg.chat.id}\n이 ID를 관리자에게 전달해주세요.`
    );
    await writeLog('unauthorized_access', { chat_id: String(msg.chat.id) }, msg);
    return;
  }

  // 명령어 파싱
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase().replace(/@\w+$/, ''); // @botname 제거
  const args = parts.slice(1);

  // /help, /start
  if (cmd === '/help' || cmd === '/start') {
    handleHelp(bot, msg, commands);
    return;
  }

  // alias → handler 조회
  const handlerKey = aliasMap[cmd];
  if (!handlerKey) {
    await bot.sendMessage(msg.chat.id,
      `❓ 알 수 없는 명령어: ${cmd}\n/help 로 명령어 목록을 확인하세요.`
    );
    return;
  }

  const handler = HANDLER_MAP[handlerKey];
  if (!handler) {
    await bot.sendMessage(msg.chat.id, `⚠️ 핸들러 미구현: ${handlerKey}`);
    return;
  }

  try {
    await handler(bot, msg, args);
  } catch (e) {
    console.error(`[ERROR] ${cmd}:`, e);
    await bot.sendMessage(msg.chat.id, `❌ 처리 중 오류: ${e.message}`);
    await writeLog('command_error', { command: cmd, error: e.message }, msg);
  }
});

// ── 실시간 알림 시작 ──

if (masterChatIds.length > 0) {
  startAlerts(bot, masterChatIds);
} else {
  console.log('[ALERTS] MASTER_CHAT_ID 미설정 — 자동 알림 비활성화');
}

// ── Graceful Shutdown ──

function shutdown() {
  console.log('\n🛑 봇 종료 중...');
  stopAlerts();
  bot.stopPolling();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
