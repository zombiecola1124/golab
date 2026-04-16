/**
 * GoLab — 레거시 재고 키 백업 유틸
 *
 * 대상 키:
 *   golab_inventory_v01           — 구버전 재고
 *   golab_inventory_inbound_history_v01 — 구버전 입고이력
 *
 * 사용법:
 *   브라우저 콘솔에서 GoLabLegacyBackup.run() 실행
 *   → JSON 파일 자동 다운로드
 *
 * 목적:
 *   v01 → v1 키 통일 전환 전 1회성 안전 백업
 */
window.GoLabLegacyBackup = (function () {
  "use strict";

  var LEGACY_KEYS = [
    "golab_inventory_v01",
    "golab_inventory_inbound_history_v01"
  ];

  /**
   * 백업 실행 — 대상 키의 현재 localStorage 값을 JSON 파일로 다운로드
   * @returns {{ key: string, count: number }[]} 백업 결과 요약
   */
  function run() {
    var payload = {};
    var summary = [];

    LEGACY_KEYS.forEach(function (key) {
      var raw = localStorage.getItem(key);
      var parsed = null;
      var count = 0;

      if (raw) {
        try {
          parsed = JSON.parse(raw);
          count = Array.isArray(parsed) ? parsed.length : 1;
        } catch (e) {
          parsed = raw; /* JSON 파싱 실패 시 원본 문자열 저장 */
          count = -1;
        }
      }

      payload[key] = {
        data: parsed,
        count: count,
        backed_up_at: new Date().toISOString()
      };

      summary.push({ key: key, count: count });
    });

    /* 메타 정보 추가 */
    payload._meta = {
      created_at: new Date().toISOString(),
      purpose: "v01→v1 키 통일 전환 전 레거시 백업",
      keys: LEGACY_KEYS
    };

    /* JSON 파일 다운로드 */
    var json = JSON.stringify(payload, null, 2);
    var blob = new Blob([json], { type: "application/json" });
    var url = URL.createObjectURL(blob);

    var ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
    var filename = "golab_legacy_inventory_backup_" + ts + ".json";

    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    /* 콘솔 리포트 */
    console.log("══════════════════════════════════════");
    console.log("[LegacyBackup] 백업 완료 — " + filename);
    console.log("══════════════════════════════════════");
    summary.forEach(function (s) {
      var status = s.count === 0 ? "비어있음" : s.count === -1 ? "파싱실패(원본저장)" : s.count + "건";
      console.log("  " + s.key + " → " + status);
    });
    console.log("══════════════════════════════════════");

    return summary;
  }

  return { run: run };
})();
