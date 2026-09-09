import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';

const { createLocalServer } = createRequire(import.meta.url)('../desktop/server.cjs');
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let portText = process.env.PORT || '4173';
let valid = true;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--help' || args[i] === '-h') {
    console.log('Usage: node scripts/serve.mjs [--port 4173 | --port=0]\nPORT is also supported. Binds only to 127.0.0.1; a busy port falls back to an available port.\nServe a built dist folder locally (including /assets/catalog.json); no OSC or LAN listener.');
    process.exit(0);
  }
  if (args[i] === '--port') portText = args[++i];
  else if (args[i].startsWith('--port=')) portText = args[i].slice(7);
  else if (/^\d+$/.test(args[i]) && args.length === 1) portText = args[i];
  else valid = false;
}
if (!valid || typeof portText !== 'string' || !/^\d{1,5}$/.test(portText) || Number(portText) > 65535) {
  console.error('Invalid arguments. Use --port 0..65535. The host is always 127.0.0.1.');
  process.exitCode = 1;
} else {
  let local;
  try {
    await access(path.join(rootDir, 'dist', 'index.html'));
    local = await createLocalServer({ rootDir, port: Number(portText), retryPort: true });
    console.log(`Lumina Live: ${local.origin}/`);
    console.log(`Output: ${local.origin}/?output=1`);
    console.log('Keep this terminal open. Press Ctrl+C to stop.');
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      try { await local.close(); } catch { process.exitCode = 1; }
    };
    process.on('SIGINT', close);
    process.on('SIGTERM', close);
  } catch (error) {
    console.error(error.code === 'ENOENT' ? 'Build the app first: npm run build' : `Could not start Lumina Live: ${error.message}`);
    if (local) await local.close();
    process.exitCode = 1;
  }
}
