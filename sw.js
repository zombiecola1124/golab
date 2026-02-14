/**
 * sw.js — Service Worker (PWA 오프라인 캐시)
 * v1: 기본 캐시 전략 (앱 셸 캐시 + 네트워크 우선)
 */

const CACHE_NAME = 'golab-v1';
const APP_SHELL = [
  './',
  './index.html',
  './purchases.html',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/audit.js',
  './js/ui.js',
  './js/inventory.js',
  './js/purchases.js',
  './manifest.json'
];

// 설치: 앱 셸 캐시
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] 앱 셸 캐시 중...');
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

// 활성화: 이전 캐시 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

// 요청: 네트워크 우선, 실패 시 캐시
self.addEventListener('fetch', (event) => {
  // Firebase API 요청은 캐시하지 않음
  if (event.request.url.includes('firestore.googleapis.com') ||
      event.request.url.includes('identitytoolkit.googleapis.com') ||
      event.request.url.includes('securetoken.googleapis.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 성공 시 캐시 갱신
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
