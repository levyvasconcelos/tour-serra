// ================================================================
// EURO TOURS — Service Worker
// Cache-first para assets, network-first para o HTML principal
// ================================================================

const CACHE_VERSION = 'euro-tours-v2';
const CACHE_STATIC  = `${CACHE_VERSION}-static`;
const CACHE_ASSETS  = `${CACHE_VERSION}-assets`;

// Ficheiros essenciais — cacheados na instalação
const STATIC_FILES = [
  './',
  './index.html',
  './manifest.json',
  'https://unpkg.com/leaflet/dist/leaflet.css',
  'https://unpkg.com/leaflet/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&family=Source+Sans+3:wght@400;600&display=swap',
];

// Tiles do mapa OpenStreetMap (para cache dinâmico)
const OSM_TILE_ORIGIN = 'https://tile.openstreetmap.org';

// ================================================================
// INSTALL — pré-cache dos ficheiros estáticos
// ================================================================
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => {
      return Promise.allSettled(
        STATIC_FILES.map(url =>
          cache.add(url).catch(err =>
            console.warn(`[SW] Não foi possível cachear: ${url}`, err)
          )
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ================================================================
// ACTIVATE — limpar caches antigas
// ================================================================
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('euro-tours-') && k !== CACHE_STATIC && k !== CACHE_ASSETS)
          .map(k => {
            console.log(`[SW] A remover cache antiga: ${k}`);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ================================================================
// FETCH — estratégias por tipo de recurso
// ================================================================
self.addEventListener('fetch', event => {
  const req  = event.request;
  const url  = new URL(req.url);

  // Ignorar pedidos não GET e extensões de browser
  if (req.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // 1. Tiles do mapa → Cache-first com fallback de rede
  if (url.hostname.includes('tile.openstreetmap.org') ||
      url.hostname.includes('tile.openstreetmap.de')) {
    event.respondWith(cacheFirst(req, CACHE_ASSETS, 30 * 24 * 60 * 60)); // 30 dias
    return;
  }

  // 2. Imagens locais → Cache-first
  if (url.pathname.startsWith('/images/') ||
      req.destination === 'image') {
    event.respondWith(cacheFirst(req, CACHE_ASSETS, 7 * 24 * 60 * 60));
    return;
  }

  // 3. Áudios locais → Cache-first
  if (url.pathname.startsWith('/audio/') ||
      req.destination === 'audio') {
    event.respondWith(cacheFirst(req, CACHE_ASSETS, 7 * 24 * 60 * 60));
    return;
  }

  // 4. Fontes do Google → Cache-first longa duração
  if (url.hostname.includes('fonts.gstatic.com') ||
      url.hostname.includes('fonts.googleapis.com')) {
    event.respondWith(cacheFirst(req, CACHE_STATIC, 365 * 24 * 60 * 60));
    return;
  }

  // 5. Leaflet CDN → Cache-first
  if (url.hostname.includes('unpkg.com')) {
    event.respondWith(cacheFirst(req, CACHE_STATIC, 30 * 24 * 60 * 60));
    return;
  }

  // 6. HTML principal → Network-first (conteúdo sempre atualizado)
  if (req.destination === 'document' || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(networkFirst(req, CACHE_STATIC));
    return;
  }

  // 7. Tudo o resto → Network com fallback de cache
  event.respondWith(networkFirst(req, CACHE_ASSETS));
});

// ================================================================
// ESTRATÉGIA: Cache-first
// Tenta a cache; se falhar, vai à rede e guarda o resultado
// ================================================================
async function cacheFirst(request, cacheName, maxAgeSeconds) {
  const cache    = await caches.open(cacheName);
  const cached   = await cache.match(request);

  if (cached) {
    const dateHeader = cached.headers.get('date');
    if (dateHeader && maxAgeSeconds) {
      const age = (Date.now() - new Date(dateHeader).getTime()) / 1000;
      if (age > maxAgeSeconds) {
        // Cache expirada — atualizar em background
        updateCacheInBackground(request, cache);
      }
    }
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Recurso não disponível offline.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

// ================================================================
// ESTRATÉGIA: Network-first
// Tenta a rede; se falhar, usa a cache
// ================================================================
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Fallback para a página principal se for documento
    if (request.destination === 'document') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response('Sem ligação e sem cache disponível.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

// ================================================================
// Atualizar cache em background (stale-while-revalidate simplificado)
// ================================================================
function updateCacheInBackground(request, cache) {
  fetch(request).then(response => {
    if (response.ok) cache.put(request, response);
  }).catch(() => {});
}

// ================================================================
// Mensagem do cliente → pré-cache de assets do tour
// Chamado após login bem-sucedido para garantir todos os assets offline
// ================================================================
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'PRECACHE_TOUR_ASSETS') {
    const urls = event.data.urls || [];
    caches.open(CACHE_ASSETS).then(cache => {
      urls.forEach(url => {
        fetch(url).then(res => {
          if (res.ok) cache.put(url, res);
        }).catch(() => {});
      });
    });
    console.log(`[SW] A pré-cachear ${urls.length} assets do tour`);
  }
});
