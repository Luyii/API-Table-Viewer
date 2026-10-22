'use strict';
// Browser preview of the real panel. Only the DevTools host is simulated.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const runtime = new Set(['appearance.js', 'json-codec.js', 'panel.js', 'table-ui.js', 'viewer.js', 'viewer-expanded.js', 'developer.js', 'layout.js', 'shortcuts.js', 'response-editor.js', 'mock-page.js', 'response-mock.js', 'worker.js', 'style.css', 'field-patch-core.js', 'field-mock.js']);
function createPreviewServer() {
  return http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    let content, type;
    if (req.method !== 'GET') {res.writeHead(405); res.end(); return;}
    if (pathname === '/' || pathname === '/panel.html') {
      content = fs.readFileSync(path.join(root, 'panel.html'), 'utf8')
        .replace('<title>API Table Viewer</title>', '<title>响应编辑 · API Table Viewer 交互预览</title>')
        .replace('<body>', '<body><script src="/preview/env.js"></script>')
        .replace('<span>API Table Viewer</span>', '<span>API Table Viewer</span><span style="margin-left:10px;font-size:10px;color:#91d6c7;border:1px solid #416559;padding:2px 7px;border-radius:4px">交互预览 · 示例数据</span>')
        .replace('</body>', '<script src="/preview/boot.js"></script></body>');
      type = 'text/html';
    } else if (pathname === '/preview/env.js' || pathname === '/preview/boot.js') {
      content = fs.readFileSync(path.join(__dirname, path.basename(pathname))); type = 'text/javascript';
    } else if (runtime.has(pathname.slice(1))) {
      content = fs.readFileSync(path.join(root, pathname.slice(1))); type = pathname.endsWith('.css') ? 'text/css' : 'text/javascript';
    } else {res.writeHead(404); res.end('Not found'); return;}
    res.writeHead(200, {'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    res.end(content);
  });
}
if (require.main === module) {
  const port = Number(process.env.PORT || 8766);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid PORT');
  const server = createPreviewServer();
  server.on('error', error => {console.error(error.message); process.exitCode = 1;});
  server.listen(port, '0.0.0.0', () => console.log(`Response editor preview: http://localhost:${port}`));
}
module.exports = {createPreviewServer};
