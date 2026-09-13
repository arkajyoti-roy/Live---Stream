const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const port = Number(process.env.PORT || 3000);
const root = __dirname;
let mediaProcess = null;
const certificate = path.join(root, 'auto.crt');
const privateKey = path.join(root, 'auto.key');
const useHttps = fs.existsSync(certificate) && fs.existsSync(privateKey);

function startMediaServer() {
  if (mediaProcess && !mediaProcess.killed) return;

  mediaProcess = spawn(path.join(root, 'mediamtx.exe'), ['mediamtx.yml'], {
    cwd: root,
    windowsHide: true,
    stdio: 'ignore'
  });
  mediaProcess.once('exit', () => { mediaProcess = null; });
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  response.end(JSON.stringify(body));
}

function serveFile(request, response) {
  const requestedPath = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const relativePath = requestedPath === '/' ? '/index.html' : requestedPath;
  const filePath = path.resolve(root, `.${relativePath}`);
  if (!filePath.startsWith(root + path.sep)) return sendJson(response, 403, { error: 'Forbidden' });

  fs.readFile(filePath, (error, content) => {
    if (error) return sendJson(response, 404, { error: 'Not found' });
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.yml': 'text/plain' };
    response.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' });
    response.end(content);
  });
}

const requestHandler = (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' });
    return response.end();
  }
  if (request.method === 'POST' && request.url === '/api/start-mediamtx') {
    try {
      startMediaServer();
      return sendJson(response, 200, { running: true });
    } catch (error) {
      return sendJson(response, 500, { error: error.message });
    }
  }
  if (request.method === 'GET') return serveFile(request, response);
  sendJson(response, 405, { error: 'Method not allowed' });
};

const server = useHttps
  ? https.createServer({ cert: fs.readFileSync(certificate), key: fs.readFileSync(privateKey) }, requestHandler)
  : http.createServer(requestHandler);

server.listen(port, '0.0.0.0', () => {
  const protocol = useHttps ? 'https' : 'http';
  console.log(`Signal Room running at ${protocol}://localhost:${port}`);
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((address) => address && address.family === 'IPv4' && !address.internal)
    .map((address) => `${protocol}://${address.address}:${port}`);
  addresses.forEach((address) => console.log(`Open it from another device at ${address}`));
});

function stopMediaServer() {
  if (mediaProcess && !mediaProcess.killed) mediaProcess.kill();
}

process.on('exit', stopMediaServer);
process.on('SIGINT', () => { stopMediaServer(); process.exit(); });
process.on('SIGTERM', () => { stopMediaServer(); process.exit(); });