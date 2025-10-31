/* Simple SW to rewrite Zama CDN requests to same-origin /relayer paths to avoid CORS */
self.addEventListener('fetch', (event) => {
  try {
    // Don't intercept anything on localhost environments
    const selfHost = self.location.hostname;
    if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(selfHost)) {
      return;
    }
    const url = new URL(event.request.url);
    if (url.hostname === 'cdn.zama.ai' && url.pathname.startsWith('/relayer-sdk-js/0.2.0/')) {
      // Map to our same-origin rewrite: /relayer/:path*
      const mapped = '/relayer' + url.pathname.replace('/relayer-sdk-js/0.2.0', '');
      const dest = new URL(mapped, self.location.origin).toString();
      event.respondWith(fetch(dest, {
        // Use GET and default mode; headers are forwarded implicitly by the browser
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin'
      }));
    }
  } catch (e) {
    // no-op
  }
});
