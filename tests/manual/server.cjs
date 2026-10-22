'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {cases, fixture} = require('./fixtures.cjs');
const assets = {'/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/mock-debug': ['mock-debug.html', 'text/html'], '/mock-debug.js': ['mock-debug.js', 'text/javascript']};
function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    function send(status, body, type = 'application/json') {
      res.writeHead(status, {'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
      res.end(body);
    }
    if (url.pathname === '/api/echo' && req.method === 'POST') {
      let bytes = 0; const chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) {send(413, '{"error":"body too large"}'); return;}
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      try {JSON.parse(raw);} catch {send(400, '{"error":"invalid JSON"}'); return;}
      send(200, raw); return;
    }
    if (req.method !== 'GET') {send(405, '{"error":"method not allowed"}'); return;}
    if (assets[url.pathname]) {
      const [file, type] = assets[url.pathname];
      send(200, fs.readFileSync(path.join(__dirname, file)), type); return;
    }
    if (url.pathname === '/api/cases') {send(200, JSON.stringify(cases)); return;}
    if (url.pathname === '/api/mock-orders') {send(200, JSON.stringify({code:200,data:{total:2,records:[{orderId:'ORD202610220001',customerName:'林小满',status:'paid',amount:128.5},{orderId:'ORD202610220002',customerName:'陈一诺',status:'pending',amount:299}]}})); return;}
    if (url.pathname === '/api/plain') {send(200, 'not JSON', 'text/plain'); return;}
    if (url.pathname === '/api/status') {send(422, '{"error":"fixture validation","code":422}'); return;}
    const match = /^\/api\/(ordinary|nested|nodes|records|integers|long-text|missing)$/.exec(url.pathname);
    if (match) {send(200, fixture(match[1])); return;}
    send(404, '{"error":"not found"}');
  });
}
if (require.main === module) {
  const port = Number(process.env.PORT || 8765);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT must be 1–65535');
  const server = createServer();
  server.on('error', error => {console.error(error.message); process.exitCode = 1;});
  server.listen(port, '127.0.0.1', () => console.log(`Chrome fixture page: http://127.0.0.1:${port}\nOpen DevTools → API Table BEFORE sending requests. Ctrl+C stops server.`));
}
module.exports = {createServer};
