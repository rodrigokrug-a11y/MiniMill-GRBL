#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { SerialManager, listPorts } from './serial.js';
import { GrblController } from './grbl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 8000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const serial = new SerialManager();
const grbl = new GrblController(serial);

// --- static file server -----------------------------------------------------

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// --- websocket bridge --------------------------------------------------------

const wss = new WebSocketServer({ server });
const clients = new Set();

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

serial.on('open', (info) => broadcast({ type: 'connection', connected: true, ...info }));
serial.on('close', () => broadcast({ type: 'connection', connected: false }));
serial.on('error', (err) => broadcast({ type: 'error', message: err.message }));
grbl.on('status', (status) => broadcast({ type: 'status', status }));
grbl.on('console', (entry) => broadcast({ type: 'console', ...entry }));
grbl.on('grbl', (event) => broadcast({ type: 'grbl', ...event }));
grbl.on('job', (job) => broadcast({ type: 'job', job }));

async function handle(ws, msg) {
  switch (msg.type) {
    case 'listPorts':
      broadcast({ type: 'ports', ports: await listPorts() });
      break;
    case 'connect':
      await serial.open(msg.port, msg.baud || 115200);
      break;
    case 'disconnect':
      await serial.close();
      break;
    case 'command':
      grbl.sendLine(msg.line);
      break;
    case 'realtime':
      grbl.realtime(msg.cmd);
      break;
    case 'jog':
      grbl.jog(msg);
      break;
    case 'run':
      grbl.runJob((msg.gcode || '').split(/\r?\n/));
      break;
    case 'pause':
      grbl.pause();
      break;
    case 'resumeJob':
      grbl.resume();
      break;
    case 'stop':
      grbl.stop();
      break;
    case 'getSettings':
      grbl.sendLine('$$');
      break;
    default:
      break;
  }
}

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    try {
      await handle(ws, msg);
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });

  // Push current state to the freshly connected client.
  listPorts().then((ports) => ws.send(JSON.stringify({ type: 'ports', ports })));
  ws.send(JSON.stringify({ type: 'connection', connected: serial.isOpen(), ...(serial.info || {}) }));
});

server.listen(PORT, () => {
  console.log(`\n  ModCNC  ·  controlador web para GRBL`);
  console.log(`  ▸ abra  http://localhost:${PORT}  no navegador\n`);
});
