/* ══════════════════════════════════════════
   GoLab 데이터 시드 스크립트
   브라우저 콘솔에서 실행: 거래처 등록 → 거래 49건 입력
   ══════════════════════════════════════════ */
(function(){
  const PM = GoLabPartnerMaster;
  const TE = GoLabTradeEngine;

  /* ── 1. 거래처 등록 ── */
  const partners = [
    {name:"대성금속", type:"고객", partner_tag:"주요"},
    {name:"고랩컴퍼니", type:"채널"},
    {name:"제이유니버스", type:"채널"},
    {name:"우진", type:"채널"},
    {name:"제이앤컴퍼니", type:"채널"},
    {name:"에이라이프", type:"채널"},
    {name:"아반에이치", type:"채널"},
    {name:"뷰전", type:"고객"},
    {name:"곽진호", type:"채널"},
    {name:"케이티리스", type:"고객"},
    {name:"정종태", type:"채널"},
    {name:"이지엘", type:"채널"},
    {name:"에이앤티시스템", type:"고객"},
    {name:"티에스아이", type:"고객"},
    {name:"선진뷰티사이언스", type:"고객"},
    {name:"미래사이언스", type:"채널"},
    {name:"세경하이테크", type:"고객"},
    {name:"열린종합상사", type:"고객"},
    {name:"윤필", type:"채널"},
  ];

  const pMap = {}; // name → partner_id
  partners.forEach(p => {
    const existing = PM.findByName(p.name);
    if(existing){ pMap[p.name] = existing.partner_id; return; }
    try{
      const created = PM.create(p);
      pMap[p.name] = created.partner_id;
    }catch(e){ console.warn("거래처 등록 실패:", p.name, e.message); }
  });
  console.log("거래처 등록 완료:", Object.keys(pMap).length + "개");

  /* ── 헬퍼: 거래 생성 ── */
  let created = 0, failed = 0;
  function addTrade(o){
    try{
      const pid = pMap[o.partner];
      if(!pid){ console.warn("거래처 없음:", o.partner); failed++; return; }

      const fields = {
        partner_id: pid,
        partner_name_snapshot: o.partner,
        deal_date: o.date,
        items: [{
          name: o.item,
          qty: o.qty || 1,
          unit_price: o.unitPrice,
          cost: o.cost != null ? o.cost : null,
          memo: ""
        }],
        extra_costs: [],
        rates: {
          save_rate: o.saveRate != null ? o.saveRate : 0,
          rebate_rate: 0,
          S_rate: o.sRate != null ? o.sRate : 0,
          my_rate: o.myRate != null ? o.myRate : 0
        },
        settlement: {
          actual_S_amount: o.actualS || 0,
          memo: ""
        },
        memo: o.memo || "",
        /* 입금 완료 */
        paid_supply: o.paid ? o.supply : 0,
        paid_vat: o.paid ? Math.round(o.supply * 0.1) : 0,
      };

      /* 거래 흐름 단계 */
      if(o.paid){
        fields.quote_at = o.date;
        fields.order_at = o.date;
        fields.delivery_note_at = o.date;
        fields.invoice_at = o.date;
        fields.payment_at = o.date;
      }

      TE.create(fields);
      created++;
    }catch(e){
      console.warn("거래 생성 실패:", o.date, o.item, e.message);
      failed++;
    }
  }

  /* ══════════════════════════════════════════
     2. 1월 대성금속 거래 (6건) — 입금 완료
     ══════════════════════════════════════════ */
  // Row 1
  addTrade({date:"2025-01-05", partner:"대성금속", item:"Sodium", qty:1,
    unitPrice:850000, supply:850000, cost:700000,
    saveRate:30, sRate:60, myRate:40, actualS:63000, paid:true,
    memo:"진행:고랩컴퍼니"});

  // Row 2
  addTrade({date:"2026-01-19", partner:"대성금속", item:"SNSPB925AG25", qty:1,
    unitPrice:1300000, supply:1300000, cost:1091721,
    saveRate:30, sRate:60, myRate:40, actualS:87477, paid:true,
    memo:"진행:고랩컴퍼니"});

  // Row 3
  addTrade({date:"2026-01-19", partner:"대성금속", item:"스텐봉 Ag", qty:5,
    unitPrice:3802670, supply:19013350, cost:19013350,
    saveRate:0, sRate:0, myRate:0, actualS:0, paid:true,
    memo:"진행:고랩컴퍼니"});

  // Row 4
  addTrade({date:"2026-01-19", partner:"대성금속", item:"Sodium Citrate", qty:1,
    unitPrice:1200000, supply:1200000, cost:1145000,
    saveRate:30, sRate:60, myRate:40, actualS:23100, paid:true,
    memo:"진행:고랩컴퍼니"});

  // Row 5
  addTrade({date:"2026-01-22", partner:"대성금속", item:"SOMASER SILVER", qty:1,
    unitPrice:13500000, supply:13500000, cost:12190000,
    saveRate:30, sRate:60, myRate:40, actualS:550200, paid:true,
    memo:"진행:고랩컴퍼니"});

  // Row 6
  addTrade({date:"2026-01-28", partner:"대성금속", item:"Moly", qty:1,
    unitPrice:500000, supply:500000, cost:450000,
    saveRate:30, sRate:60, myRate:40, actualS:21000, paid:true,
    memo:"진행:고랩컴퍼니"});

  /* ══════════════════════════════════════════
     3. 1월 직거래 (4건) — 입금 완료
     ══════════════════════════════════════════ */
  addTrade({date:"2026-01-06", partner:"뷰전", item:"일반 100x100x2t 유리판 500개", qty:1,
    unitPrice:114000, supply:114000, cost:94000,
    saveRate:0, sRate:0, myRate:0, paid:true,
    memo:"진행:곽진호 / 25년이월"});

  addTrade({date:"2026-01-07", partner:"대성금속", item:"10mm Square", qty:1,
    unitPrice:250000, supply:250000, cost:0,
    saveRate:0, sRate:0, myRate:0, paid:true,
    memo:"진행:정종태 / 대가든호텔(제주)"});

  addTrade({date:"2026-01-09", partner:"케이티리스", item:"TH-110 점검기", qty:1,
    unitPrice:100000, supply:100000, cost:0,
    saveRate:0, sRate:0, myRate:0, paid:true});

  addTrade({date:"2026-01-12", partner:"뷰전", item:"KEN-3-S11/S8 적외선 측정기", qty:2,
    unitPrice:1400000, supply:2800000, cost:2312000,
    saveRate:0, sRate:0, myRate:0, paid:true,
    memo:"진행:이지엘"});

  /* ══════════════════════════════════════════
     4. 1월 장갑 (4건) — 입금 완료
     ══════════════════════════════════════════ */
  addTrade({date:"2026-01-06", partner:"대성금속", item:"LATEX Glove (S)", qty:10,
    unitPrice:0, supply:0, cost:0,
    saveRate:0, sRate:0, myRate:0, paid:true,
    memo:"장갑 샘플"});

  addTrade({date:"2026-01-14", partner:"대성금속", item:"LATEX Glove (XS)", qty:10,
    unitPrice:6000, supply:60000, cost:0,
    saveRate:0, sRate:0, myRate:0, paid:true,
    memo:"장갑"});

  addTrade({date:"2026-01-26", partner:"대성금속", item:"LATEX Glove (S)", qty:5,
    unitPrice:18000, supply:90000, cost:9000,
    saveRate:0, sRate:0, myRate:0, paid:true,
    memo:"장갑"});

  addTrade({date:"2026-01-26", partner:"에이앤티시스템", item:"LATEX Glove (S)", qty:5,
    unitPrice:18000, supply:90000, cost:9000,
    saveRate:0, sRate:0, myRate:0, paid:true,
    memo:"장갑"});

  /* ══════════════════════════════════════════
     5. 2월 대성금속 거래 (9건) — 입금 완료
     ══════════════════════════════════════════ */
  addTrade({date:"2026-02-10", partner:"대성금속", item:"KTOTO", qty:1,
    unitPrice:9800000, supply:9800000, cost:9800000,
    saveRate:0, sRate:0, myRate:0, paid:true,
    memo:"진행:고랩컴퍼니"});

  addTrade({date:"2026-02-10", partner:"대성금속", item:"OT-100 분산제", qty:10,
    unitPrice:930000, supply:9300000, cost:9213350,
    saveRate:30, sRate:60, myRate:40, actualS:36393, paid:true,
    memo:"진행:고랩컴퍼니"});

  addTrade({date:"2026-02-12", partner:"대성금속", item:"소모품", qty:1,
    unitPrice:900000, supply:900000, cost:900000,
    saveRate:0, sRate:0, myRate:0, paid:true,
    memo:"진행:고랩컴퍼니"});

  addTrade({date:"2026-02-12", partner:"대성금속", item:"소모품B", qty:1,
    unitPrice:950000, supply:950000, cost:800000,
    saveRate:30, sRate:60, myRate:40, actualS:63000, paid:true,
    memo:"진행:고랩컴퍼니"});

  addTrade({date:"2026-02-19", partner:"대성금속", item:"제이유니버스 납품건", qty:1,
    unitPrice:5000000, supply:5000000, cost:0,
    saveRate:0, sRate:30, myRate:70, actualS:1500000, paid:true,
    memo:"진행:제이유니버스"});

  addTrade({date:"2026-02-19", partner:"대성금속", item:"밀링볼", qty:1,
    unitPrice:350000, supply:350000, cost:248200,
    saveRate:30, sRate:60, myRate:40, actualS:42756, paid:true,
    memo:"진행:고랩컴퍼니"});

  addTrade({date:"2026-02-20", partner:"대성금속", item:"제이앤컴퍼니 납품건 외 1건", qty:1,
    unitPrice:5850000, supply:5850000, cost:350000,
    saveRate:0, sRate:30, myRate:70, actualS:1650000, paid:true,
    memo:"진행:제이앤컴퍼니"});

  addTrade({date:"2026-02-20", partner:"대성금속", item:"일회용 스프레이 외 2건", qty:1,
    unitPrice:5350000, supply:5350000, cost:300000,
    saveRate:0, sRate:30, myRate:70, actualS:1515000, paid:true,
    memo:"진행:아반에이치"});

  addTrade({date:"2026-02-20", partner:"대성금속", item:"스텐실 SUS테이블 외 1건", qty:1,
    unitPrice:6300000, supply:6300000, cost:1073800,
    saveRate:0, sRate:30, myRate:70, actualS:1567860, paid:true,
    memo:"진행:에이라이프"});

  /* ══════════════════════════════════════════
     6. 2월 장갑 (6건) — 입금 완료
     ══════════════════════════════════════════ */
  addTrade({date:"2026-02-25", partner:"티에스아이", item:"니트릴 장갑 (M)", qty:5,
    unitPrice:18000, supply:90000, cost:7400,
    saveRate:0, sRate:0, myRate:0, paid:true});

  addTrade({date:"2026-02-25", partner:"티에스아이", item:"니트릴 장갑 (S)", qty:3,
    unitPrice:18000, supply:54000, cost:2500,
    saveRate:0, sRate:0, myRate:0, paid:true});

  addTrade({date:"2026-02-26", partner:"대성금속", item:"LATEX Glove (XL)", qty:10,
    unitPrice:5000, supply:50000, cost:0,
    saveRate:0, sRate:0, myRate:0, paid:true,
    memo:"진행:제이앤컴퍼니"});

  addTrade({date:"2026-02-26", partner:"대성금속", item:"LATEX Glove (M)", qty:10,
    unitPrice:6000, supply:60000, cost:0,
    saveRate:0, sRate:0, myRate:0, paid:true,
    memo:"진행:제이앤컴퍼니"});

  addTrade({date:"2026-02-26", partner:"대성금속", item:"LATEX Glove (M)", qty:5,
    unitPrice:0, supply:0, cost:0,
    saveRate:0, sRate:0, myRate:0, paid:true,
    memo:"진행:제이앤컴퍼니 / 샘플"});

  addTrade({date:"2026-02-26", partner:"대성금속", item:"LATEX Glove (M)", qty:5,
    unitPrice:0, supply:0, cost:0,
    saveRate:0, sRate:0, myRate:0, paid:true,
    memo:"진행:제이앤컴퍼니 / 샘플"});

  /* ══════════════════════════════════════════
     7. 3월 대성금속 거래 (16건) — 미입금
     ══════════════════════════════════════════ */
  addTrade({date:"2025-03-04", partner:"대성금속", item:"SNSPB925AG25 Teflon", qty:1,
    unitPrice:1050000, supply:1050000, cost:1050000,
    saveRate:0, sRate:0, myRate:0, paid:false,
    memo:"진행:고랩컴퍼니"});

  addTrade({date:"2026-03-12", partner:"대성금속", item:"Teflon8r", qty:1,
    unitPrice:6500000, supply:6500000, cost:3222300,
    saveRate:30, sRate:60, myRate:40, actualS:1376634, paid:false,
    memo:"진행:고랩컴퍼니"});

  addTrade({date:"2026-03-12", partner:"대성금속", item:"Glove M 100매", qty:1,
    unitPrice:5925000, supply:5925000, cost:1074200,
    saveRate:0, sRate:30, myRate:70, actualS:1455240, paid:false,
    memo:"진행:제이유니버스"});

  addTrade({date:"2026-03-12", partner:"대성금속", item:"AGL-B (Silver)", qty:1,
    unitPrice:24650000, supply:24650000, cost:24520000,
    saveRate:30, sRate:60, myRate:40, actualS:54600, paid:false,
    memo:"진행:고랩컴퍼니"});

  addTrade({date:"2026-03-12", partner:"대성금속", item:"SPUDSR (SILVER)", qty:1,
    unitPrice:21800000, supply:21800000, cost:21690000,
    saveRate:30, sRate:60, myRate:40, actualS:46200, paid:false,
    memo:"진행:고랩컴퍼니"});

  addTrade({date:"2026-03-12", partner:"대성금속", item:"bydrep 외", qty:1,
    unitPrice:5000000, supply:5000000, cost:467700,
    saveRate:0, sRate:30, myRate:70, actualS:0, paid:false,
    memo:"진행:우진"});

  addTrade({date:"2026-03-17", partner:"대성금속", item:"구리분말 10kg 외", qty:1,
    unitPrice:6400000, supply:6400000, cost:2498400,
    saveRate:0, sRate:30, myRate:70, actualS:1170480, paid:false,
    memo:"진행:제이앤컴퍼니"});

  addTrade({date:"2026-03-17", partner:"대성금속", item:"스텐실 SUS테이블 외 1건", qty:1,
    unitPrice:6300000, supply:6300000, cost:1270000,
    saveRate:0, sRate:30, myRate:70, actualS:1509000, paid:false,
    memo:"진행:에이라이프"});

  addTrade({date:"2026-03-19", partner:"대성금속", item:"2um 구리분말 10kg 외 2건", qty:1,
    unitPrice:4100000, supply:4100000, cost:780000,
    saveRate:0, sRate:30, myRate:70, actualS:996000, paid:false,
    memo:"진행:제이유니버스"});

  addTrade({date:"2026-03-19", partner:"대성금속", item:"에이라이프 납품건", qty:1,
    unitPrice:6250000, supply:6250000, cost:427200,
    saveRate:0, sRate:30, myRate:70, actualS:1746840, paid:false,
    memo:"진행:에이라이프"});

  addTrade({date:"2026-03-23", partner:"대성금속", item:"ABC Silver", qty:1,
    unitPrice:23500000, supply:23500000, cost:23380000,
    saveRate:30, sRate:60, myRate:40, actualS:50400, paid:false,
    memo:"진행:고랩컴퍼니"});

  addTrade({date:"2026-03-25", partner:"대성금속", item:"Prox2-powder12", qty:1,
    unitPrice:4300000, supply:4300000, cost:1107500,
    saveRate:30, sRate:60, myRate:40, actualS:1340850, paid:false,
    memo:"진행:고랩컴퍼니"});

  addTrade({date:"2026-03-30", partner:"대성금속", item:"Ansell Nitrile", qty:1,
    unitPrice:8000000, supply:8000000, cost:8000000,
    saveRate:0, sRate:0, myRate:0, paid:false,
    memo:"진행:고랩컴퍼니"});

  addTrade({date:"2026-03-30", partner:"대성금속", item:"분말 1Kg", qty:1,
    unitPrice:7500000, supply:7500000, cost:5640000,
    saveRate:0, sRate:30, myRate:70, actualS:558000, paid:false,
    memo:"진행:우진"});

  addTrade({date:"2026-03-30", partner:"대성금속", item:"Bo 외", qty:1,
    unitPrice:7500000, supply:7500000, cost:3300000,
    saveRate:0, sRate:30, myRate:70, actualS:1260000, paid:false,
    memo:"진행:제이유니버스"});

  addTrade({date:"2026-03-30", partner:"대성금속", item:"아반에이치 납품건 외 2건", qty:1,
    unitPrice:5500000, supply:5500000, cost:900000,
    saveRate:0, sRate:30, myRate:70, actualS:1380000, paid:false,
    memo:"진행:아반에이치"});

  /* ══════════════════════════════════════════
     8. 3월 직거래 (2건) — 미입금
     ══════════════════════════════════════════ */
  addTrade({date:"2026-03-19", partner:"선진뷰티사이언스", item:"Round Cell", qty:10,
    unitPrice:100000, supply:1000000, cost:2800,
    saveRate:0, sRate:0, myRate:0, paid:false,
    memo:"진행:미래사이언스"});

  addTrade({date:"2026-03-27", partner:"세경하이테크", item:"PA Connector Header 100EA", qty:1,
    unitPrice:46000, supply:46000, cost:29700,
    saveRate:0, sRate:0, myRate:0, paid:false,
    memo:"세경견적:34,000"});

  /* ══════════════════════════════════════════
     9. 3월 장갑 (2건) — 미입금
     ══════════════════════════════════════════ */
  addTrade({date:"2026-03-09", partner:"열린종합상사", item:"LATEX Glove (S)", qty:10,
    unitPrice:6000, supply:60000, cost:2800,
    saveRate:0, sRate:0, myRate:0, paid:false});

  addTrade({date:"2026-03-27", partner:"대성금속", item:"니트릴 장갑 (S)", qty:5,
    unitPrice:18000, supply:90000, cost:0,
    saveRate:0, sRate:0, myRate:0, paid:false,
    memo:"장갑"});

  /* ── 결과 ── */
  console.log("=============================");
  console.log("데이터 시드 완료!");
  console.log("성공:", created, "건");
  console.log("실패:", failed, "건");
  console.log("=============================");
  alert("데이터 입력 완료!\n성공: " + created + "건\n실패: " + failed + "건\n\n페이지를 새로고침합니다.");
  location.reload();
})();
