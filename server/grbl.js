import { EventEmitter } from 'node:events';

// GRBL serial RX buffer size. We keep the buffer as full as possible without
// overflowing it (character-counting protocol) so motion never starves between
// lines. 1 byte is reserved as a safety margin.
const RX_BUFFER = 128;

// Single-byte real-time commands (sent immediately, bypassing the line buffer).
const REALTIME = {
  status: '?',
  hold: '!',
  resume: '~',
  reset: '\x18', // Ctrl-X soft reset
  jogCancel: '\x85',
  // Feed rate overrides
  feedReset: '\x90',
  feedPlus10: '\x91',
  feedMinus10: '\x92',
  feedPlus1: '\x93',
  feedMinus1: '\x94',
  // Rapid overrides
  rapidReset: '\x95',
  rapid50: '\x96',
  rapid25: '\x97',
  // Spindle overrides
  spindleReset: '\x99',
  spindlePlus10: '\x9a',
  spindleMinus10: '\x9b',
  spindlePlus1: '\x9c',
  spindleMinus1: '\x9d',
  spindleStop: '\x9e',
  floodToggle: '\xa0',
  mistToggle: '\xa1',
  safetyDoor: '\x84',
  jogCancelByte: '\x85',
};

function stripGcodeComment(line) {
  return line
    .replace(/\(.*?\)/g, '') // ( inline comments )
    .replace(/;.*$/, '') // ; line comments
    .trim();
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

export class GrblController extends EventEmitter {
  constructor(serial) {
    super();
    this.serial = serial;
    this.queue = []; // [{ line, job }] waiting to be written
    this.sent = []; // [{ line, length, job }] written, awaiting ok/error
    this.paused = false;
    this.statusTimer = null;
    this.wco = { x: 0, y: 0, z: 0 };
    this.lastStatus = null;
    this.job = null;

    serial.on('line', (line) => this._onLine(line));
    serial.on('open', () => this._onOpen());
    serial.on('close', () => this._onClose());
  }

  _onOpen() {
    this.queue = [];
    this.sent = [];
    this.paused = false;
    this.job = null;
    this.startStatusPolling();
  }

  _onClose() {
    this.stopStatusPolling();
    this.queue = [];
    this.sent = [];
    this.job = null;
  }

  startStatusPolling(interval = 200) {
    this.stopStatusPolling();
    this.statusTimer = setInterval(() => this.serial.write('?'), interval);
  }

  stopStatusPolling() {
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
  }

  // --- incoming -----------------------------------------------------------

  _onLine(line) {
    if (line.startsWith('<') && line.endsWith('>')) {
      this._parseStatus(line);
      return;
    }
    if (line === 'ok') {
      this._onAck(false);
      return;
    }
    if (line.startsWith('error:')) {
      this.emit('console', { dir: 'rx', line, level: 'error' });
      this.emit('grbl', { event: 'error', code: line.slice(6), raw: line });
      this._onAck(true);
      return;
    }
    if (line.startsWith('ALARM:')) {
      this.emit('console', { dir: 'rx', line, level: 'error' });
      this.emit('grbl', { event: 'alarm', code: line.slice(6), raw: line });
      return;
    }
    if (/^Grbl/i.test(line)) {
      this.emit('console', { dir: 'rx', line });
      this.emit('grbl', { event: 'welcome', raw: line });
      return;
    }
    if (line.startsWith('$') && line.includes('=')) {
      this._parseSetting(line);
      this.emit('console', { dir: 'rx', line });
      return;
    }
    if (line.startsWith('[')) {
      this.emit('console', { dir: 'rx', line });
      this._parseFeedback(line);
      return;
    }
    this.emit('console', { dir: 'rx', line });
  }

  _parseFeedback(line) {
    const m = line.match(/^\[([^:]+):(.*)\]$/);
    if (!m) {
      this.emit('grbl', { event: 'message', raw: line });
      return;
    }
    const key = m[1];
    const val = m[2];
    if (key === 'GC') {
      this.emit('grbl', { event: 'parserState', value: val });
    } else if (key === 'VER' || key === 'OPT') {
      this.emit('grbl', { event: 'build', key, value: val });
    } else if (key === 'PRB') {
      // [PRB:x,y,z:success]
      const [coords, success] = val.split(':');
      const [x, y, z] = coords.split(',').map(Number);
      this.emit('grbl', { event: 'probe', x, y, z, success: success === '1' });
    } else if (key === 'MSG') {
      this.emit('grbl', { event: 'message', text: val, raw: line });
    } else if (/^(G5[4-9]|G28|G30|G92|TLO)$/.test(key)) {
      // work coordinate offsets and predefined positions from $#
      this.emit('grbl', { event: 'param', name: key, value: val });
    } else {
      this.emit('grbl', { event: 'message', raw: line });
    }
  }

  _onAck(isError) {
    const item = this.sent.shift();
    if (item) {
      if (item.job && this.job) {
        this.job.acked += 1;
        if (isError) this.job.errors += 1;
        if (this.job.acked >= this.job.total && !this.queue.some((q) => q.job)) {
          this._finishJob();
        } else {
          this.emit('job', this._jobStatus());
        }
      } else if (!isError) {
        this.emit('console', { dir: 'rx', line: 'ok' });
      }
    }
    this._pump();
  }

  _parseStatus(line) {
    const fields = line.slice(1, -1).split('|');
    const status = { state: fields[0], stateBase: fields[0].split(':')[0] };
    for (let i = 1; i < fields.length; i++) {
      const sep = fields[i].indexOf(':');
      if (sep < 0) continue;
      const key = fields[i].slice(0, sep);
      const val = fields[i].slice(sep + 1);
      const nums = val.split(',').map(Number);
      if (key === 'MPos') status.mpos = { x: nums[0], y: nums[1], z: nums[2] };
      else if (key === 'WPos') status.wpos = { x: nums[0], y: nums[1], z: nums[2] };
      else if (key === 'WCO') this.wco = { x: nums[0], y: nums[1], z: nums[2] };
      else if (key === 'FS') {
        status.feed = nums[0];
        status.spindle = nums[1];
      } else if (key === 'F') status.feed = nums[0];
      else if (key === 'Ov') status.ov = { feed: nums[0], rapid: nums[1], spindle: nums[2] };
      else if (key === 'Pn') status.pn = val;
      else if (key === 'Bf') status.bf = { planner: nums[0], rx: nums[1] };
      else if (key === 'Ln') status.ln = nums[0];
      else if (key === 'A') {
        // accessory state: S=spindle CW, C=spindle CCW, F=flood, M=mist
        status.acc = {
          spindle: val.includes('S') ? 'cw' : val.includes('C') ? 'ccw' : null,
          flood: val.includes('F'),
          mist: val.includes('M'),
        };
      }
    }
    // GRBL reports either MPos or WPos plus a periodic WCO; derive the other.
    if (status.mpos && !status.wpos) {
      status.wpos = {
        x: round3(status.mpos.x - this.wco.x),
        y: round3(status.mpos.y - this.wco.y),
        z: round3(status.mpos.z - this.wco.z),
      };
    } else if (status.wpos && !status.mpos) {
      status.mpos = {
        x: round3(status.wpos.x + this.wco.x),
        y: round3(status.wpos.y + this.wco.y),
        z: round3(status.wpos.z + this.wco.z),
      };
    }
    status.wco = { ...this.wco };
    // GRBL omits the A field when nothing is active — treat absence as all-off.
    if (!status.acc) status.acc = { spindle: null, flood: false, mist: false };
    this.lastStatus = status;
    this.emit('status', status);
  }

  _parseSetting(line) {
    const m = line.match(/^\$(\d+)=(.+)$/);
    if (m) this.emit('grbl', { event: 'setting', code: Number(m[1]), value: m[2].trim() });
  }

  // --- outgoing -----------------------------------------------------------

  sendLine(line, job = false) {
    const clean = String(line).trim();
    if (!clean) return;
    this.queue.push({ line: clean, job });
    if (!job) this.emit('console', { dir: 'tx', line: clean });
    this._pump();
  }

  _pump() {
    if (this.paused) return;
    while (this.queue.length) {
      const next = this.queue[0];
      const length = next.line.length + 1; // include trailing \n
      const inFlight = this.sent.reduce((sum, s) => sum + s.length, 0);
      // Always allow at least one line through when the buffer is empty.
      if (this.sent.length > 0 && inFlight + length > RX_BUFFER - 1) break;
      this.queue.shift();
      this.sent.push({ line: next.line, length, job: next.job });
      this.serial.write(next.line + '\n');
      if (next.job && this.job) {
        this.job.sent += 1;
        this.emit('job', { ...this._jobStatus(), currentLine: next.line });
      }
    }
  }

  realtime(cmd) {
    const byte = REALTIME[cmd];
    if (byte === undefined) return;
    this.serial.write(Buffer.from(byte, 'latin1'));
    if (cmd === 'reset') this._clearAfterReset();
  }

  _clearAfterReset() {
    this.queue = [];
    this.sent = [];
    this.paused = false;
    if (this.job) {
      this.job.state = 'stopped';
      this.emit('job', this._jobStatus());
      this.job = null;
    }
  }

  jog({ x, y, z, feed = 1000, relative = true, units = 'mm' }) {
    const axes = [];
    if (x !== undefined && x !== null) axes.push('X' + x);
    if (y !== undefined && y !== null) axes.push('Y' + y);
    if (z !== undefined && z !== null) axes.push('Z' + z);
    if (!axes.length) return;
    const mode = `${relative ? 'G91' : 'G90'} ${units === 'inch' ? 'G20' : 'G21'}`;
    this.sendLine(`$J=${mode} ${axes.join(' ')} F${feed}`);
  }

  // --- job streaming ------------------------------------------------------

  runJob(rawLines) {
    if (this.job) return; // already running
    const lines = rawLines.map(stripGcodeComment).filter((l) => l.length);
    if (!lines.length) return;
    this.job = { total: lines.length, sent: 0, acked: 0, errors: 0, state: 'running' };
    for (const line of lines) this.queue.push({ line, job: true });
    this.emit('job', this._jobStatus());
    this._pump();
  }

  pause() {
    this.paused = true;
    this.realtime('hold');
    if (this.job) {
      this.job.state = 'paused';
      this.emit('job', this._jobStatus());
    }
  }

  resume() {
    this.paused = false;
    this.realtime('resume');
    if (this.job) {
      this.job.state = 'running';
      this.emit('job', this._jobStatus());
    }
    this._pump();
  }

  stop() {
    // Soft reset halts motion and flushes GRBL's planner; _clearAfterReset
    // drops everything we had queued.
    this.realtime('reset');
  }

  _finishJob() {
    this.job.state = 'done';
    this.emit('job', this._jobStatus());
    this.job = null;
  }

  _jobStatus() {
    if (!this.job) return { state: 'idle', total: 0, sent: 0, acked: 0, errors: 0 };
    const { state, total, sent, acked, errors } = this.job;
    return {
      state,
      total,
      sent,
      acked,
      errors,
      progress: total ? acked / total : 0,
    };
  }
}
