// sw.js – Service Worker ProCro
// ⚠️ À chaque mise en ligne d'une nouvelle version, change CACHE_NAME
//    (ex : 'procro-v2.0.1') pour que les téléphones récupèrent les nouveaux fichiers.
const CACHE_NAME = 'procro-v2.0.0';

// Fichiers indispensables (chemins relatifs : marche aussi dans un sous-dossier)
const CORE_FILES = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json'
];

// Fichiers facultatifs : s'ils manquent, l'installation ne plante pas
const OPTIONAL_FILES = [
    './192.png',
    './512.png'
];

// Installation : mise en cache des fichiers
self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(CORE_FILES.map(url => new Request(url, { cache: 'reload' })));
        await Promise.all(
            OPTIONAL_FILES.map(url => cache.add(new Request(url, { cache: 'reload' })).catch(() => {}))
        );
        await self.skipWaiting();
    })());
});

// Activation : suppression des anciens caches
self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name)));
        await self.clients.claim();
    })());
});

// Requêtes : cache d'abord (l'app marche hors ligne), réseau sinon
self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // Ouverture de l'app (page HTML) : toujours la version en cache
    if (request.mode === 'navigate') {
        event.respondWith(
            caches.match('./index.html')
                .then(cached => cached || fetch(request))
                .catch(() => caches.match('./index.html'))
        );
        return;
    }

    event.respondWith(
        caches.match(request, { ignoreSearch: true }).then(cached => {
            if (cached) return cached;
            return fetch(request).then(response => {
                if (response && response.ok && response.type === 'basic') {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
                }
                return response;
            });
        })
    );
});
