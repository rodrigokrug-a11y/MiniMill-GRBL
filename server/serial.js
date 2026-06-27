import { SerialPort } from 'serialport';
import { EventEmitter } from 'node:events';

// USB vendor IDs commonly used by GRBL controllers / USB-serial chips.
// Used only to surface the most likely CNC port first in the UI.
const KNOWN_VENDORS = {
  '303a': 'Espressif (ESP32)',
  '2341': 'Arduino',
  '2a03': 'Arduino',
  '1a86': 'CH340 (WCH)',
  '0403': 'FTDI',
  '10c4': 'Silicon Labs CP210x',
  '067b': 'Prolific',
};

export async function listPorts() {
  let raw = [];
  try {
    raw = await SerialPort.list();
  } catch {
    raw = [];
  }
  const ports = raw
    // Hide pure Bluetooth / debug consoles that are never a CNC.
    .filter((p) => !/Bluetooth|debug-console/i.test(p.path))
    .map((p) => {
      const vid = (p.vendorId || '').toLowerCase();
      const vendor = KNOWN_VENDORS[vid];
      const bits = [p.manufacturer, vendor].filter(Boolean);
      return {
        path: p.path,
        label: bits.length ? `${p.path} — ${bits.join(' · ')}` : p.path,
        vendorId: p.vendorId,
        productId: p.productId,
        serialNumber: p.serialNumber,
        recommended: Boolean(vendor),
      };
    });
  // Recommended (likely CNC) ports first.
  ports.sort((a, b) => Number(b.recommended) - Number(a.recommended));
  return ports;
}

export class SerialManager extends EventEmitter {
  constructor() {
    super();
    this.port = null;
    this.buffer = '';
    this.info = null;
  }

  isOpen() {
    return Boolean(this.port && this.port.isOpen);
  }

  open(path, baudRate = 115200) {
    return new Promise((resolve, reject) => {
      const finish = () => {
        this.buffer = '';
        this.info = { path, baudRate };

        this.port.on('data', (chunk) => this._onData(chunk));
        this.port.on('close', () => {
          this.info = null;
          this.emit('close');
        });
        this.port.on('error', (err) => this.emit('error', err));

        this.emit('open', { path, baudRate });
        resolve();
      };

      const start = () => {
        this.port = new SerialPort({ path, baudRate, autoOpen: false });
        this.port.open((err) => (err ? reject(err) : finish()));
      };

      if (this.isOpen()) {
        this.close().then(start, start);
      } else {
        start();
      }
    });
  }

  _onData(chunk) {
    // GRBL speaks ASCII; latin1 keeps every byte 1:1.
    this.buffer += chunk.toString('latin1');
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);
      if (line.length) this.emit('line', line);
    }
  }

  // data may be a string (newline-terminated line) or a Buffer (real-time bytes).
  write(data) {
    if (!this.isOpen()) return false;
    this.port.write(data);
    return true;
  }

  close() {
    return new Promise((resolve) => {
      const p = this.port;
      this.port = null;
      this.info = null;
      if (p && p.isOpen) {
        p.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
