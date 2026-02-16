self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open('tour-cache').then(function(cache) {
      return cache.addAll([
        './',
        './index.html',
        './manifest.json'
      ]);
    })
  );
});
