/**
 * GoLab v2.3 — 사이드바 네비게이션 (공용 모듈)
 *
 * 사용법: <script src="js/sidebar-nav.js"></script>
 *         (body 내 어디든 포함하면 자동 적용)
 *
 * 기능:
 *   - 좌측 고정 사이드바 (5대 카테고리 + 서브메뉴)
 *   - 기존 상단 탭 자동 숨김
 *   - 현재 페이지 active 표시
 *   - 모바일: 햄버거 메뉴 (900px 이하)
 *   - 하단 "빠른 거래 등록" 버튼
 */
(function () {
  "use strict";

  var W = 180; /* 사이드바 너비 (px) */
  var path = (location.pathname.split("/").pop() || "console.html").toLowerCase();

  /* ── 네비게이션 구조 ── */
  var NAV = [
    { icon: "📊", label: "대시보드", page: "console.html", children: [
      { icon: "📅", label: "캘린더", page: "calendar.html" }
    ]},
    { icon: "📑", label: "거래", page: "deals.html", children: [
      { icon: "💰", label: "매출", page: "sales.html" },
      { icon: "🔥", label: "기회", page: "deal.html" }
    ]},
    { icon: "💵", label: "수익", page: "profit.html" },
    { icon: "📦", label: "재고", page: "index.html", children: [
      { icon: "📥", label: "입고/원가", page: "purchases.html" }
    ]},
    { icon: "🤝", label: "거래처", page: "partner-master.html" }
  ];

  /* ── 현재 페이지가 해당 항목에 속하는지 판단 ── */
  function isActive(item) {
    if (item.page === path) return true;
    if (item.children) {
      for (var i = 0; i < item.children.length; i++) {
        if (item.children[i].page === path) return true;
      }
    }
    return false;
  }

  /* ── HTML 생성 ── */
  var html = '<div class="gl-brand"><a href="./console.html">GoLab</a></div>';
  html += '<ul class="gl-list">';
  NAV.forEach(function (item) {
    var active = isActive(item);
    html += '<li class="gl-item' + (active ? " active" : "") + '">';
    html += '<a href="./' + item.page + '" class="gl-link">';
    html += '<span class="gl-icon">' + item.icon + '</span>';
    html += '<span class="gl-text">' + item.label + '</span>';
    html += '</a>';
    if (item.children && item.children.length) {
      html += '<ul class="gl-sub">';
      item.children.forEach(function (sub) {
        var subActive = sub.page === path;
        html += '<li class="gl-sub-item' + (subActive ? " active" : "") + '">';
        html += '<a href="./' + sub.page + '">' + sub.icon + ' ' + sub.label + '</a>';
        html += '</li>';
      });
      html += '</ul>';
    }
    html += '</li>';
  });
  html += '</ul>';
  html += '<div class="gl-footer">';
  html += '<a href="./deals.html" class="gl-quick">+ 빠른 거래 등록</a>';
  html += '</div>';

  /* ── CSS 주입 ── */
  var css = document.createElement("style");
  css.id = "gl-sidebar-css";
  css.textContent = [
    /* 사이드바 컨테이너 */
    ".gl-sidebar{position:fixed;top:0;left:0;width:" + W + "px;height:100vh;background:#fff;",
    "  border-right:1px solid #e5e7eb;z-index:100;display:flex;flex-direction:column;",
    "  box-shadow:2px 0 8px rgba(0,0,0,.03);overflow-y:auto;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Apple SD Gothic Neo','Noto Sans KR',sans-serif}",
    /* 브랜드 */
    ".gl-brand{padding:14px 18px;border-bottom:1px solid #e5e7eb}",
    ".gl-brand a{font-size:16px;font-weight:800;color:#2563eb;text-decoration:none;letter-spacing:-.3px}",
    /* 메뉴 리스트 */
    ".gl-list{list-style:none;margin:0;padding:12px 8px;flex:1}",
    ".gl-item{margin-bottom:2px}",
    ".gl-link{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;",
    "  text-decoration:none;color:#64748b;font-size:13px;font-weight:600;transition:all .15s}",
    ".gl-link:hover{background:rgba(37,99,235,.06);color:#0f172a}",
    ".gl-item.active>.gl-link{background:rgba(37,99,235,.1);color:#2563eb}",
    ".gl-icon{font-size:16px;width:22px;text-align:center;flex-shrink:0}",
    ".gl-text{white-space:nowrap}",
    /* 서브메뉴 */
    ".gl-sub{list-style:none;margin:0;padding:2px 0 4px 34px}",
    ".gl-sub-item a{display:block;padding:6px 12px;border-radius:6px;text-decoration:none;",
    "  color:#94a3b8;font-size:11px;font-weight:600;transition:all .15s}",
    ".gl-sub-item a:hover{color:#0f172a;background:rgba(37,99,235,.04)}",
    ".gl-sub-item.active a{color:#2563eb;background:rgba(37,99,235,.08)}",
    /* 하단 빠른 거래 등록 */
    ".gl-footer{padding:12px;border-top:1px solid #e5e7eb}",
    ".gl-quick{display:block;text-align:center;padding:10px;border-radius:8px;",
    "  background:rgba(37,99,235,.08);color:#2563eb;font-size:12px;font-weight:700;",
    "  text-decoration:none;transition:all .15s}",
    ".gl-quick:hover{background:rgba(37,99,235,.15)}",
    /* 햄버거 토글 (모바일) */
    ".gl-toggle{display:none;position:fixed;top:10px;left:10px;z-index:101;",
    "  background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;",
    "  font-size:18px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.08);line-height:1}",
    ".gl-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:99}",
    /* 기존 콘텐츠 밀기 */
    "body{margin-left:" + W + "px !important}",
    /* 기존 탭 네비게이션 숨기기 */
    "header .tabs{display:none !important}",
    /* console.html 기존 사이드바 숨기기 (nav sidebar가 대체) */
    ".bento{grid-template-columns:1fr 280px !important}",
    ".bento>.sidebar{display:none !important}",
    /* 모바일 (900px 이하) */
    "@media(max-width:900px){",
    "  .gl-sidebar{transform:translateX(-100%);transition:transform .25s ease}",
    "  .gl-sidebar.open{transform:translateX(0)}",
    "  .gl-toggle{display:block}",
    "  .gl-sidebar.open~.gl-overlay{display:block}",
    "  body{margin-left:0 !important}",
    "}"
  ].join("\n");
  document.head.appendChild(css);

  /* ── DOM 주입 ── */
  var sidebar = document.createElement("nav");
  sidebar.className = "gl-sidebar";
  sidebar.innerHTML = html;

  var toggle = document.createElement("button");
  toggle.className = "gl-toggle";
  toggle.textContent = "☰";
  toggle.onclick = function () { sidebar.classList.toggle("open"); };

  var overlay = document.createElement("div");
  overlay.className = "gl-overlay";
  overlay.onclick = function () { sidebar.classList.remove("open"); };

  /* body 맨 앞에 삽입 */
  document.body.insertBefore(overlay, document.body.firstChild);
  document.body.insertBefore(sidebar, document.body.firstChild);
  document.body.insertBefore(toggle, document.body.firstChild);
})();
