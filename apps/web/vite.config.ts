import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { rewriteProxiedSessionCookies } from './src/devProxyCookies.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const proxyTarget = env.VITE_API_PROXY_TARGET;

  return {
    plugins: [react()],
    server: proxyTarget ? {
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          configure: (proxy) => {
            proxy.on('proxyRes', (proxyResponse) => {
              const cookies = proxyResponse.headers['set-cookie'];
              if (Array.isArray(cookies)) {
                // The browser receives this proxied response from HTTP localhost.
                // Retaining Secure would discard otherwise valid session cookies.
                proxyResponse.headers['set-cookie'] = rewriteProxiedSessionCookies(cookies);
              }
            });
          },
        },
      },
    } : undefined,
  };
});
