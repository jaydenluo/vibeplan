import { buildApp } from './app.js';

try {
  const app = await buildApp();
  const port = Number(process.env.API_PORT ?? 4000);

  await app.listen({ host: '0.0.0.0', port });
  console.log(`🚀 Vibe Plan API server listening on http://0.0.0.0:${port}`);
} catch (error) {
  console.error('❌ Failed to start server:', error);

  if (error instanceof Error) {
    if (error.message.includes('EADDRINUSE')) {
      const port = Number(process.env.API_PORT ?? 4000);
      console.error(`Port ${port} is already in use. Please set a different API_PORT or stop the conflicting process.`);
    } else if (error.message.includes('EACCES')) {
      console.error('Permission denied. Try using a port number above 1024 or run with appropriate privileges.');
    } else if (error.message.includes('database') || error.message.includes('connection')) {
      console.error('Database connection failed. Please check DATABASE_URL and ensure PostgreSQL is running.');
    }
  }

  process.exit(1);
}
