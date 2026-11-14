// The Railway server: security headers on every response, the app for unknown routes, and nothing
// outside the site folder, however the path is written.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStaticServer, readHeaders } from '../../scripts/serve-static.ts';

const workFolder = mkdtempSync(join(tmpdir(), 'serve-static-'));
const site = join(workFolder, 'dist');
const server = createStaticServer(
  (() => {
    mkdirSync(join(site, 'assets'), { recursive: true });
    writeFileSync(join(site, 'index.html'), '<div id="root">app</div>');
    writeFileSync(join(site, 'assets', 'main-abc123.js'), 'console.log(1)');
    writeFileSync(join(site, '_headers'), readHeadersFixture());
    writeFileSync(join(workFolder, 'secret.txt'), 'outside the site');
    return site;
  })(),
);
let port = 0;

function readHeadersFixture(): string {
  return `# comment\n/*\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src 'self'\n/assets/*\n  X-Only-Assets: yes\n`;
}

/** Sends a raw path, so encodings and dot segments reach the server exactly as written. */
function get(path: string, method = 'GET'): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const outgoing = httpRequest({ host: '127.0.0.1', port, path, method }, (response) => {
      let body = '';
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => resolvePromise({ status: response.statusCode ?? 0, headers: response.headers, body }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

before(async () => {
  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  port = (server.address() as AddressInfo).port;
});
after(() => {
  server.close();
  rmSync(workFolder, { recursive: true, force: true });
});

test('Only the "/*" block of _headers applies to every page', () => {
  assert.deepEqual(readHeaders(readHeadersFixture()), { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'" });
});

test('Files are served with their type and the security headers; hashed assets are cached for a year', async () => {
  const asset = await get('/assets/main-abc123.js');
  assert.equal(asset.status, 200);
  assert.equal(asset.body, 'console.log(1)');
  assert.match(String(asset.headers['content-type']), /javascript/);
  assert.equal(asset.headers['x-frame-options'], 'DENY');
  assert.match(String(asset.headers['cache-control']), /immutable/);
});

test('Any app route gets index.html, never cached, with the headers', async () => {
  for (const path of ['/', '/tenders/123', '/business/tenders/new?x=1']) {
    const page = await get(path);
    assert.equal(page.body, '<div id="root">app</div>', path);
    assert.equal(page.headers['cache-control'], 'no-cache');
    assert.equal(page.headers['content-security-policy'], "default-src 'self'");
  }
});

test('Paths that try to leave the site folder get the app, never the file', async () => {
  for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt', '/%2e%2e%5csecret.txt', '/..%5c..%5csecret.txt', '/%00', '/%E0%A4%A', '//secret.txt', '/_headers/../../secret.txt']) {
    const response = await get(path);
    assert.ok(!response.body.includes('outside the site'), path);
  }
});

test('Only GET and HEAD are answered', async () => {
  assert.equal((await get('/', 'POST')).status, 405);
  const head = await get('/', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
});
