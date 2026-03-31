/* ══════════════════════════════════════════
   관리업체(진행업체) 일괄 연결 스크립트
   memo "진행:XXX" → channel_name_snapshot + channel_id 세팅
   trade_type은 "direct" 유지 (계산 구조 보존)
   ══════════════════════════════════════════ */
(function(){
  const PM = GoLabPartnerMaster;
  const KEY = "golab_trade_v2";

  /* 전체 거래 로드 */
  var all = JSON.parse(GoLabStorage.getItem(KEY) || "[]");
  var updated = 0;

  all.forEach(function(t){
    /* memo에서 "진행:XXX" 추출 */
    var memo = t.memo || "";
    var m = memo.match(/진행[:\s]*([^\s/]+)/);
    if(!m) return;
    var channelName = m[1].trim();
    if(!channelName) return;

    /* 이미 channel_name_snapshot이 세팅되어 있으면 스킵 */
    if(t.channel_name_snapshot && t.channel_name_snapshot === channelName) return;

    /* 거래처 마스터에서 partner_id 찾기 */
    var partner = PM.findByName(channelName);
    var channelId = partner ? partner.partner_id : null;

    /* channel_name_snapshot 세팅 (channel_id도 세팅하되, trade_type은 direct 유지) */
    t.channel_name_snapshot = channelName;
    if(channelId) t.channel_id = channelId;
    /* ★ trade_type은 "direct" 유지 — "channel"로 바꾸면 계산 구조가 깨짐 */
    t.trade_type = "direct";
    t.updated_at = new Date().toISOString();

    updated++;
  });

  /* 저장 */
  GoLabStorage.setItem(KEY, JSON.stringify(all));

  console.log("관리업체 연결 완료:", updated, "건");
  alert("관리업체 연결 완료!\n수정: " + updated + "건\n\n페이지를 새로고침합니다.");
  location.reload();
})();
