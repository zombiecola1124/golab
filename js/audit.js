/**
 * audit.js — 변경 이력 기록 모듈
 * 원칙: 모든 CREATE/UPDATE/DELETE/STOCK_ADJUST/STOCKTAKE는
 *        반드시 이 모듈의 writeLog()를 호출해야 함.
 *        try/finally 구조로 누락 방지.
 */

import { createDoc, COLLECTIONS } from './db.js';

/**
 * audit_log에 변경 이력 기록
 *
 * @param {object} params
 * @param {string} params.entityType - "item" | "purchase" | "delivery" | "invoice"
 * @param {string} params.entityId   - 대상 문서 ID
 * @param {string} params.action     - "CREATE" | "UPDATE" | "DELETE" | "STOCK_ADJUST" | "STOCKTAKE"
 * @param {object} [params.before]   - 변경 전 스냅샷 (CREATE 시 null)
 * @param {object} [params.after]    - 변경 후 스냅샷 (DELETE 시 null)
 * @param {string} [params.reason]   - 사유 (빈값 허용)
 * @returns {Promise<string>} 생성된 audit log ID
 */
export async function writeLog({ entityType, entityId, action, before = null, after = null, reason = '' }) {
  const logData = {
    entity_type: entityType,
    entity_id: entityId,
    action: action,
    before: before ? _sanitize(before) : null,
    after: after ? _sanitize(after) : null,
    reason: reason || '',
    actor: 'owner' // v1: 단일 사용자
  };

  try {
    const logId = await createDoc(COLLECTIONS.AUDIT_LOG, logData);
    console.log(`[AUDIT] ${action} ${entityType}/${entityId}`, logData);
    return logId;
  } catch (err) {
    console.error('[AUDIT] 기록 실패:', err);
    // audit 실패가 본 작업을 막으면 안 됨 — 경고만 표시
    return null;
  }
}

/**
 * 특정 엔티티의 audit 로그 조회
 * @param {string} entityType
 * @param {string} entityId
 * @returns {Promise<array>}
 */
export async function getLogsForEntity(entityType, entityId) {
  const { readAll } = await import('./db.js');
  return readAll(COLLECTIONS.AUDIT_LOG, {
    filters: [
      { field: 'entity_type', op: '==', value: entityType },
      { field: 'entity_id', op: '==', value: entityId }
    ],
    orderField: 'created_at',
    orderDir: 'desc'
  });
}

/**
 * 스냅샷 정리 — Firestore에 저장 불가능한 값(undefined 등) 제거
 */
function _sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && typeof v !== 'function') {
      clean[k] = v;
    }
  }
  return clean;
}
