// Zero-dependency static server for the MoveHome A2A protocol tester.
//
//   node a2a-tester/serve.mjs            → http://localhost:4400
//   node a2a-tester/serve.mjs 5000       → http://localhost:5000
//   PORT=5000 node a2a-tester/serve.mjs
//
// It only serves the three static files in this folder. The tester itself talks
// to the A2A endpoint cross-origin (the endpoint sends Access-Control-Allow-Origin: *),
// so there is no proxy here — keep it dumb and dependency-free.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 4400);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const server = createServer(async (req, res) => {
  try {
    // Strip query string, default to index.html, and prevent path traversal.
    const rawPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '');
    const filePath = normalize(join(HERE, rel));
    if (!filePath.startsWith(HERE)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`\n  MoveHome A2A tester → http://localhost:${PORT}\n`);
  console.log('  Default target is http://localhost:3000 (run `npm run dev` in the repo root).');
  console.log('  Point it at https://movehome.org from the top bar to test production.\n');
});
