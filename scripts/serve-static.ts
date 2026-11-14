/**
 * Serves the built site on Railway (PRD 9.2): files from dist/, every other route as the single-page
 * app, and the security headers from dist/_headers, the same file Cloudflare Pages reads.
 * Zero dependencies: Node's own HTTP server.
 *
 * Usage (Railway start command): node scripts/serve-static.ts
 */
import { createServer, type Server } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};
// Vite puts a content hash in every file name under assets/, so those never change.
const immutableCache = 'public, max-age=31536000, immutable';
const defaultPort = 8080;

/** Reads the headers of the "/*" block of a Cloudflare-style _headers file. */
export function readHeaders(headersFile: string): Record<string, string> {
  const headers: Record<string, string> = {};
  let inAllPagesBlock = false;
  for (const line of headersFile.split(/\r?\n/)) {
    if (line.startsWith('#') || line.trim() === '') continue;
    if (!/^\s/.test(line)) {
      inAllPagesBlock = line.trim() === '/*';
      continue;
    }
    const separator = line.indexOf(':');
    if (inAllPagesBlock && separator > 0) headers[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return headers;
}

/** The file a request path names inside root, or null when it would leave root or isn't a file. */
function fileInside(root: string, requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const candidate = resolve(join(root, decoded));
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  try {
    return statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

/** A server for one built site folder. Only GET and HEAD; anything unknown gets the app's index.html. */
export function createStaticServer(siteFolder: string): Server {
  const root = resolve(siteFolder);
  const securityHeaders = readHeaders(readFileSync(join(root, '_headers'), 'utf8'));
  const indexPath = join(root, 'index.html');
  return createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { ...securityHeaders, Allow: 'GET, HEAD' }).end();
      return;
    }
    const requestPath = new URL(request.url ?? '/', 'http://site').pathname;
    const filePath = fileInside(root, requestPath) ?? indexPath;
    const isAsset = filePath !== indexPath && requestPath.startsWith('/assets/');
    const body = readFileSync(filePath);
    response.writeHead(200, {
      ...securityHeaders,
      'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
      'Content-Length': body.length,
      // The app shell must be re-checked, so a new deploy is picked up at once.
      'Cache-Control': isAsset ? immutableCache : 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  });
}

// Listens only when run as a program, not when the tests import it.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || defaultPort;
  createStaticServer('dist').listen(port, () => console.log(`Serving dist/ on port ${port}`));
}
