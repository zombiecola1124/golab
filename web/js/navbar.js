/* ================================================================
   [GoLab v4.1] navbar.js — 공통 네비게이션
   - 탭 배열 한 곳에서 관리 → 전체 페이지 자동 반영
   - <header data-title="..."></header> 직후 동기 로딩
   ================================================================ */
(function() {
  /* ── 탭 정의 — 여기만 수정하면 전체 페이지 반영 ── */
  var TABS = [
    { href: './console.html',        file: 'console.html',        label: '🏠 메인' },
    { href: './deals.html',          file: 'deals.html',          label: '🔥 거래' },
    { href: './item-master.html',    file: 'item-master.html',    label: '🏷 품목' },
    { href: './index.html',          file: 'index.html',          label: '📦 재고' },
    { href: './profit.html',         file: 'profit.html',         label: '💰 수익' },
    { href: './partner-master.html', file: 'partner-master.html', label: '👥 거래처' }
  ];

  /* ── 현재 파일명 추출 ── */
  var path = location.pathname;
  var currentFile = path.substring(path.lastIndexOf('/') + 1) || 'console.html';

  /* ── 헤더 요소 탐색 ── */
  var header = document.querySelector('header');
  if (!header) return;

  /* ── 페이지 제목: data-title 속성, 없으면 기본값 ── */
  var title = header.getAttribute('data-title') || 'GoLab';

  /* ── 탭 HTML 생성 — active 자동 판정 ── */
  var navHtml = '';
  TABS.forEach(function(t) {
    var active = (currentFile === t.file) ? ' active' : '';
    navHtml += '<a class="tab' + active + '" href="' + t.href + '">' + t.label + '</a>';
  });

  /* ── 헤더 내부 교체 ── */
  header.innerHTML =
    '<h1>' + title + '</h1>' +
    '<nav class="tabs">' + navHtml + '</nav>';
})();
