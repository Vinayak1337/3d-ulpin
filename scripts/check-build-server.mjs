import { createConnection } from 'node:net';
import { pathToFileURL } from 'node:url';

// `next start` caches its build manifest. Replacing that build while it is
// serving requests leaves the browser requesting chunks that no longer exist.
export function assertBuildServerStopped(port = 3000, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ port, host });
    socket.setTimeout(2000);
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error(`Port ${port} is in use. Stop the local web server before building, then restart it with pnpm start. Building over a running server breaks Workspace and other pages.`));
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`Could not check port ${port}. Build cancelled to protect the running app.`));
    });
    socket.once('error', (error) => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve();
      else reject(error);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await assertBuildServerStopped();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
