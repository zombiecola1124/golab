/**
 * GoLab v1.7 — 매입 기회 감지 로직
 * 원화(KRW) 품목만 대상, 외화 품목 제외
 * SSoT 키는 읽기 전용, 보조 데이터 → golab_items_meta_v1
 *
 * 사용법: <script src="js/opportunity_logic.js"></script>
 *         GoLabOpportunity.scoreItems()
 */
window.GoLabOpportunity = (function () {
  "use strict";

  /* ══════════════════════════════════════════
     CONFIG — 점수 기준 (상단 분리)
     ══════════════════════════════════════════ */
  const CONFIG = {
    PRICE_THRESHOLD_1: -5,   // 가격 5% 하락 → 2점 (저점)
    PRICE_THRESHOLD_2: -8,   // 가격 8% 하락 → 3점 (저점)
    DEPLETION_1: 3,          // 소진 3개월 이하 → 2점 (재고부족)
    DEPLETION_2: 2,          // 소진 2개월 이하 → 3점 (재고부족)
    OPPORTUNITY_SCORE: 6,    // 기회 판단 최소 점수
    MARGIN_HIGH: 30,         // 마진율 30% 이상 → 2점 (고마진)
    MARGIN_MID: 20,          // 마진율 20% 이상 → 1점 (고마진)
    SALES_SURGE: 1.3,        // 최근/평균 130% → 2점 (판매증가)
    SALES_UP: 1.1,           // 최근/평균 110% → 1점 (판매증가)
    LOOKBACK_DAYS: 90,       // 가격 비교 기간
    RECENT_DAYS: 30,         // 최근 판매 기간
    PRICE_GUARDRAIL: -3,     // 가드레일: 이 이하 하락 아니면 6점 cap
    GUARDRAIL_CAP: 5,        // 가격 메리트 없을 때 최대 점수
    RECOMMEND_MONTHS: 3      // 권장재고 기준 개월수
  };

  /* ── 유틸 ── */
  function n(v, fb) { var x = Number(v); return Number.isFinite(x) ? x : (fb || 0); }

  function safeJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || "[]"); }
    catch (e) { return []; }
  }

  function safeJSONObj(key) {
    try { return JSON.parse(localStorage.getItem(key) || "{}"); }
    catch (e) { return {}; }
  }

  function todayStr() { return new Date().toISOString().substring(0, 10); }

  function daysAgoStr(days) {
    var d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().substring(0, 10);
  }

  /* ══════════════════════════════════════════
     1️⃣ 외화 품목 식별 — golab_purchases_v2에서 외화 배치 품목
     ══════════════════════════════════════════ */
  function buildForeignItemSet() {
    var set = new Set();
    try {
      var batches = safeJSON("golab_purchases_v2");
      batches.forEach(function (b) {
        if (b.currency && b.currency !== "KRW") {
          (b.items || []).forEach(function (item) {
            // pName → 품목명 매핑 키
            if (item.pName) set.add(item.pName);
            if (item.name) set.add(item.name);
          });
        }
      });
    } catch (e) {
      console.warn("[Opportunity] 외화 품목 식별 실패:", e);
    }
    return set;
  }

  /* ══════════════════════════════════════════
     2️⃣ 품목별 매입 가격 히스토리 (KRW only)
     소스: golab_trade_v1, golab_purchases_v2(KRW 배치)
     ══════════════════════════════════════════ */
  function buildPriceHistory(foreignSet) {
    var map = new Map(); // itemName → [{ date, price, qty }]

    // (A) golab_trade_v1 — 구매 이력 (전부 KRW)
    try {
      var trades = safeJSON("golab_trade_v1");
      trades.forEach(function (t) {
        // 외화 거래 제외
        if (t.currency && t.currency !== "KRW") return;
        var key = t.itemName || t.partNo;
        if (!key || foreignSet.has(key)) return;
        var price = n(t.buyUnitPrice);
        var qty = n(t.qty);
        if (price <= 0 || qty <= 0) return;
        var raw = t.tradeDate || t.date || t.createdAt || "";
        var date = typeof raw === "string" && raw.length >= 10 ? raw.substring(0, 10) : "";
        if (!map.has(key)) map.set(key, []);
        map.get(key).push({ date: date, price: price, qty: qty });
      });
    } catch (e) {
      console.warn("[Opportunity] trade 가격 히스토리 실패:", e);
    }

    // (B) golab_purchases_v2 — KRW 배치만
    try {
      var batches = safeJSON("golab_purchases_v2");
      batches.forEach(function (b) {
        if (b.currency && b.currency !== "KRW") return; // 외화 배치 제외
        var bDate = (b.date || b.createdAt || "");
        bDate = typeof bDate === "string" && bDate.length >= 10 ? bDate.substring(0, 10) : "";
        (b.items || []).forEach(function (item) {
          var key = item.pName || item.name;
          if (!key || foreignSet.has(key)) return;
          var price = n(item.price);
          var qty = n(item.qty);
          if (price <= 0 || qty <= 0) return;
          if (!map.has(key)) map.set(key, []);
          map.get(key).push({ date: bDate, price: price, qty: qty });
        });
      });
    } catch (e) {
      console.warn("[Opportunity] purchases 가격 히스토리 실패:", e);
    }

    return map;
  }

  /* ══════════════════════════════════════════
     3️⃣ 품목별 판매 프로필 (golab_sales_v1)
     ══════════════════════════════════════════ */
  function buildSalesProfile() {
    var profile = new Map(); // itemName → { totalQty, totalRevenue, recent30Qty, days90Qty, firstDate, count }
    var d30 = daysAgoStr(CONFIG.RECENT_DAYS);
    var d90 = daysAgoStr(CONFIG.LOOKBACK_DAYS);
    var today = todayStr();

    try {
      var sales = safeJSON("golab_sales_v1");
      sales.forEach(function (rec) {
        var key = rec.itemName || rec.partNo;
        if (!key) return;
        var qty = n(rec.qty);
        var sell = n(rec.sellUnitPrice);
        if (qty <= 0) return;

        // 날짜 추출
        var dateStr = null;
        var fields = ["salesDate", "saleDate", "date", "createdAt"];
        for (var i = 0; i < fields.length; i++) {
          var v = rec[fields[i]];
          if (v && typeof v === "string" && v.length >= 10) {
            dateStr = v.substring(0, 10);
            break;
          }
        }

        if (!profile.has(key)) {
          profile.set(key, {
            totalQty: 0, totalRevenue: 0,
            recent30Qty: 0, days90Qty: 0,
            firstDate: "9999", count: 0
          });
        }
        var p = profile.get(key);
        p.totalQty += qty;
        p.totalRevenue += sell * qty;
        p.count++;

        if (dateStr) {
          if (dateStr >= d30 && dateStr <= today) p.recent30Qty += qty;
          if (dateStr >= d90 && dateStr <= today) p.days90Qty += qty;
          if (dateStr < p.firstDate) p.firstDate = dateStr;
        }
      });
    } catch (e) {
      console.warn("[Opportunity] 판매 프로필 실패:", e);
    }

    return profile;
  }

  /* ══════════════════════════════════════════
     4️⃣ 현재 재고 수준 (golab_inventory_v01)
     ══════════════════════════════════════════ */
  function buildStockMap() {
    var stockMap = new Map(); // name → { qty, buyPrice }
    try {
      var inv = safeJSON("golab_inventory_v01");
      inv.forEach(function (item) {
        if (item.name) {
          stockMap.set(item.name, {
            qty: n(item.qty),
            buyPrice: n(item.buyPrice)
          });
        }
      });
    } catch (e) {
      console.warn("[Opportunity] 재고 로드 실패:", e);
    }
    return stockMap;
  }

  /* ══════════════════════════════════════════
     5️⃣ 월평균 판매량 계산 → golab_items_meta_v1 저장
     ══════════════════════════════════════════ */
  function calcAndSaveMeta(salesProfile) {
    var meta = safeJSONObj("golab_items_meta_v1");
    var now = new Date();

    salesProfile.forEach(function (p, key) {
      if (p.count === 0) return;
      // 첫 판매 ~ 현재 기간 (월)
      var firstDate = new Date(p.firstDate);
      var months = Math.max(1,
        (now.getFullYear() - firstDate.getFullYear()) * 12 +
        (now.getMonth() - firstDate.getMonth()) + 1
      );
      var avgMonthly = p.totalQty / months;

      if (!meta[key]) meta[key] = {};
      meta[key].avgMonthlySales = Math.round(avgMonthly * 100) / 100;
      meta[key].totalSalesQty = p.totalQty;
      meta[key].salesMonths = months;
      meta[key].updatedAt = now.toISOString();
    });

    // 보조 데이터 저장 (golab_items_meta_v1에만)
    try {
      localStorage.setItem("golab_items_meta_v1", JSON.stringify(meta));
    } catch (e) {
      console.warn("[Opportunity] meta 저장 실패:", e);
    }
    return meta;
  }

  /* ══════════════════════════════════════════
     6️⃣ 메인 — 점수 계산 + 정렬
     ══════════════════════════════════════════ */
  function scoreItems() {
    try {
      var foreignSet = buildForeignItemSet();
      var priceHistory = buildPriceHistory(foreignSet);
      var salesProfile = buildSalesProfile();
      var stockMap = buildStockMap();
      var meta = calcAndSaveMeta(salesProfile);

      var results = [];   // 점수 있는 품목
      var needsData = []; // 판매 데이터 없는 품목

      // 재고 품목 순회
      stockMap.forEach(function (stock, itemName) {
        // 외화 품목 제외
        if (foreignSet.has(itemName)) return;

        var sp = salesProfile.get(itemName);
        var ph = priceHistory.get(itemName);
        var itemMeta = meta[itemName] || {};

        // 판매 데이터 없음 → 별도 섹션
        if (!sp || sp.count === 0) {
          needsData.push({
            name: itemName,
            currentQty: stock.qty,
            buyPrice: stock.buyPrice,
            reasons: ["데이터 필요"]
          });
          return;
        }

        var score = 0;
        var reasons = [];

        // ── (A) 가격 시그널: 최근 매입가 vs 전체 평균 ──
        var deltaPct = null;
        if (ph && ph.length >= 2) {
          // 전체 가중평균
          var totalCost = 0, totalQty = 0;
          ph.forEach(function (e) { totalCost += e.price * e.qty; totalQty += e.qty; });
          var avgPrice = totalQty > 0 ? totalCost / totalQty : 0;

          // 최근 매입가 (날짜순 정렬 → 마지막)
          var sorted = ph.slice().sort(function (a, b) {
            return (a.date || "").localeCompare(b.date || "");
          });
          var latestPrice = sorted[sorted.length - 1].price;

          if (avgPrice > 0) {
            deltaPct = ((latestPrice - avgPrice) / avgPrice) * 100;
            if (deltaPct <= CONFIG.PRICE_THRESHOLD_2) {
              score += 3;
              reasons.push("저점");
            } else if (deltaPct <= CONFIG.PRICE_THRESHOLD_1) {
              score += 2;
              reasons.push("저점");
            }
          }
        }

        // ── (B) 소진 시그널: 현재 재고 ÷ 월평균 판매량 ──
        var avgMonthly = n(itemMeta.avgMonthlySales);
        var monthsToDeplete = null;
        if (avgMonthly > 0) {
          monthsToDeplete = stock.qty / avgMonthly;
          if (monthsToDeplete <= CONFIG.DEPLETION_2) {
            score += 3;
            reasons.push("재고부족");
          } else if (monthsToDeplete <= CONFIG.DEPLETION_1) {
            score += 2;
            reasons.push("재고부족");
          }
        }

        // ── (C) 마진 시그널: (판매단가 - 매입단가) / 판매단가 ──
        var avgSellPrice = sp.totalQty > 0 ? sp.totalRevenue / sp.totalQty : 0;
        var costPrice = stock.buyPrice || 0;
        // buyPrice 없으면 가격 히스토리에서 최근 가격 사용
        if (costPrice <= 0 && ph && ph.length > 0) {
          var sortedPh = ph.slice().sort(function (a, b) {
            return (a.date || "").localeCompare(b.date || "");
          });
          costPrice = sortedPh[sortedPh.length - 1].price;
        }
        var marginRate = null;
        if (avgSellPrice > 0 && costPrice > 0) {
          marginRate = ((avgSellPrice - costPrice) / avgSellPrice) * 100;
          if (marginRate >= CONFIG.MARGIN_HIGH) {
            score += 2;
            reasons.push("고마진");
          } else if (marginRate >= CONFIG.MARGIN_MID) {
            score += 1;
            reasons.push("고마진");
          }
        }

        // ── (D) 판매 증가 시그널: 최근30일 일평균 vs 90일 일평균 ──
        var salesTrend = null;
        if (sp.days90Qty > 0 && sp.recent30Qty > 0) {
          var dailyRecent = sp.recent30Qty / CONFIG.RECENT_DAYS;
          var daily90 = sp.days90Qty / CONFIG.LOOKBACK_DAYS;
          if (daily90 > 0) {
            salesTrend = dailyRecent / daily90;
            if (salesTrend >= CONFIG.SALES_SURGE) {
              score += 2;
              reasons.push("판매증가");
            } else if (salesTrend >= CONFIG.SALES_UP) {
              score += 1;
              reasons.push("판매증가");
            }
          }
        }

        // ── 가드레일: 가격 메리트 없으면 6점 Cap ──
        // deltaPct > PRICE_GUARDRAIL(-3%) → '꿀딜'이 아님 → 최대 GUARDRAIL_CAP(5)점
        if (deltaPct === null || deltaPct > CONFIG.PRICE_GUARDRAIL) {
          if (score > CONFIG.GUARDRAIL_CAP) {
            score = CONFIG.GUARDRAIL_CAP;
          }
        }

        results.push({
          name: itemName,
          score: score,
          reasons: reasons,
          deltaPct: deltaPct !== null ? Math.round(deltaPct * 10) / 10 : null,
          monthsToDeplete: monthsToDeplete !== null ? Math.round(monthsToDeplete * 10) / 10 : null,
          marginRate: marginRate !== null ? Math.round(marginRate * 10) / 10 : null,
          salesTrend: salesTrend !== null ? Math.round(salesTrend * 100) / 100 : null,
          currentQty: stock.qty,
          buyPrice: Math.round(costPrice),
          avgSellPrice: Math.round(avgSellPrice),
          avgMonthlySales: avgMonthly
        });
      });

      // 정렬: Score desc → deltaPct asc → monthsToDeplete asc
      results.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        var dA = a.deltaPct !== null ? a.deltaPct : 999;
        var dB = b.deltaPct !== null ? b.deltaPct : 999;
        if (dA !== dB) return dA - dB;
        var mA = a.monthsToDeplete !== null ? a.monthsToDeplete : 999;
        var mB = b.monthsToDeplete !== null ? b.monthsToDeplete : 999;
        return mA - mB;
      });

      return {
        opportunities: results.filter(function (r) { return r.score >= CONFIG.OPPORTUNITY_SCORE; }),
        belowThreshold: results.filter(function (r) { return r.score > 0 && r.score < CONFIG.OPPORTUNITY_SCORE; }),
        needsData: needsData,
        allScored: results,
        CONFIG: CONFIG
      };
    } catch (e) {
      // fail-safe: 오류 시 빈 결과 반환, 메인 시스템 중단 방지
      console.error("[Opportunity] 전체 점수 계산 실패:", e);
      return {
        opportunities: [],
        belowThreshold: [],
        needsData: [],
        allScored: [],
        CONFIG: CONFIG
      };
    }
  }

  // 공개 API
  return {
    CONFIG: CONFIG,
    scoreItems: scoreItems
  };
})();
