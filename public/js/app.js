import { parseGcode } from './gcode.js';
import { Visualizer } from './visualizer.js';
import { Visualizer3D } from './viz3d.js';
import { describeError, describeAlarm } from './grbl-data.js';

const $ = (sel) => document.querySelector(sel);

// GRBL 1.1 setting descriptions (pt-br), shown in the settings modal.
const SETTINGS = {
  0: ['Pulso do passo', 'µs'],
  1: ['Atraso p/ desabilitar passo', 'ms'],
  2: ['Inversão de porta de passo', 'máscara'],
  3: ['Inversão de direção', 'máscara'],
  4: ['Inverter enable do passo', 'bool'],
  5: ['Inverter pinos de limite', 'bool'],
  6: ['Inverter pino de probe', 'bool'],
  10: ['Máscara do status report', '-'],
  11: ['Desvio de junção', 'mm'],
  12: ['Tolerância de arco', 'mm'],
  13: ['Reportar em polegadas', 'bool'],
  20: ['Limites de software', 'bool'],
  21: ['Limites de hardware', 'bool'],
  22: ['Ciclo de homing', 'bool'],
  23: ['Inverter direção do homing', 'máscara'],
  24: ['Avanço de homing', 'mm/min'],
  25: ['Velocidade de homing', 'mm/min'],
  26: ['Debounce do homing', 'ms'],
  27: ['Recuo do homing (pull-off)', 'mm'],
  30: ['RPM máx do spindle', 'rpm'],
  31: ['RPM mín do spindle', 'rpm'],
  32: ['Modo laser', 'bool'],
  100: ['Passos/mm X', 'passos/mm'],
  101: ['Passos/mm Y', 'passos/mm'],
  102: ['Passos/mm Z', 'passos/mm'],
  110: ['Velocidade máx X', 'mm/min'],
  111: ['Velocidade máx Y', 'mm/min'],
  112: ['Velocidade máx Z', 'mm/min'],
  120: ['Aceleração X', 'mm/s²'],
  121: ['Aceleração Y', 'mm/s²'],
  122: ['Aceleração Z', 'mm/s²'],
  130: ['Curso máx X', 'mm'],
  131: ['Curso máx Y', 'mm'],
  132: ['Curso máx Z', 'mm'],
};

const state = {
  connected: false,
  jobActive: false,
  hasGcode: false,
  step: 1,
  units: 'mm', // 'mm' | 'inch'
  wcsP: 1, // active work coordinate system: G54=1 .. G59=6
  lastProbeZ: null,
};

const STEPS = { mm: [0.1, 1, 10, 50], inch: [0.001, 0.01, 0.1, 1] };

const settingsValues = {};

// --- websocket ---------------------------------------------------------------

let ws = null;
function connectWS() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  ws.onclose = () => {
    setConnected(false);
    log('Conexão com o servidor perdida — reconectando…', 'err');
    setTimeout(connectWS, 1500);
  };
}
function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function onMessage(msg) {
  switch (msg.type) {
    case 'ports':
      renderPorts(msg.ports);
      break;
    case 'connection':
      setConnected(msg.connected);
      break;
    case 'status':
      updateStatus(msg.status);
      break;
    case 'console':
      log(msg.line, msg.level === 'error' ? 'err' : msg.dir);
      break;
    case 'grbl':
      handleGrblEvent(msg);
      break;
    case 'job':
      updateJob(msg.job);
      break;
    case 'error':
      log(`Erro: ${msg.message}`, 'err');
      break;
  }
}

// --- connection UI -----------------------------------------------------------

function renderPorts(ports) {
  const sel = $('#portSelect');
  const prev = sel.value;
  sel.innerHTML = '';
  if (!ports.length) {
    const o = document.createElement('option');
    o.textContent = 'Nenhuma porta encontrada';
    o.value = '';
    sel.appendChild(o);
    return;
  }
  for (const p of ports) {
    const o = document.createElement('option');
    o.value = p.path;
    o.textContent = (p.recommended ? '★ ' : '') + p.label;
    sel.appendChild(o);
  }
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function setConnected(connected) {
  state.connected = connected;
  $('#connDot').className = 'dot ' + (connected ? 'on' : 'off');
  $('#connDot').title = connected ? 'Conectado' : 'Desconectado';
  $('#connectBtn').textContent = connected ? 'Desconectar' : 'Conectar';
  $('#connectBtn').classList.toggle('danger', connected);
  $('#connectBtn').classList.toggle('primary', !connected);
  $('#portSelect').disabled = connected;
  $('#baudSelect').disabled = connected;
  refreshJobButtons();
  if (!connected) {
    $('#stateBadge').textContent = '—';
    $('#stateBadge').className = 'badge';
  }
}

// --- DRO / status ------------------------------------------------------------

function fmt(n) {
  return (n ?? 0).toFixed(3);
}

function updateStatus(s) {
  const base = (s.stateBase || s.state || '').toLowerCase();
  const badge = $('#stateBadge');
  badge.textContent = s.state || '—';
  badge.className = 'badge ' + base;

  if (s.wpos) {
    $('#wposX').textContent = fmt(s.wpos.x);
    $('#wposY').textContent = fmt(s.wpos.y);
    $('#wposZ').textContent = fmt(s.wpos.z);
    viz2d.setTool(s.wpos.x, s.wpos.y);
    viz3d.setTool(s.wpos.x, s.wpos.y, s.wpos.z);
  }
  if (s.mpos) {
    $('#mposX').textContent = fmt(s.mpos.x);
    $('#mposY').textContent = fmt(s.mpos.y);
    $('#mposZ').textContent = fmt(s.mpos.z);
  }
  if (s.feed !== undefined) $('#feedRate').textContent = Math.round(s.feed);
  if (s.spindle !== undefined) $('#spindleRate').textContent = Math.round(s.spindle);

  if (s.ov) {
    $('#ovFeed').textContent = s.ov.feed + '%';
    $('#ovRapid').textContent = s.ov.rapid + '%';
    $('#ovSpindle').textContent = s.ov.spindle + '%';
  }
  if (s.acc) {
    $('#spindleCW').classList.toggle('acc-on', s.acc.spindle === 'cw');
    $('#spindleCCW').classList.toggle('acc-on', s.acc.spindle === 'ccw');
    $('#floodOn').classList.toggle('acc-on', s.acc.flood);
    $('#mistOn').classList.toggle('acc-on', s.acc.mist);
  }
}

// --- console -----------------------------------------------------------------

const consoleOut = $('#consoleOut');
function log(text, kind = 'rx') {
  const div = document.createElement('div');
  div.className = kind === 'tx' ? 'tx' : kind === 'err' ? 'err' : 'rx';
  div.textContent = text;
  consoleOut.appendChild(div);
  // cap scrollback
  while (consoleOut.childElementCount > 500) consoleOut.removeChild(consoleOut.firstChild);
  consoleOut.scrollTop = consoleOut.scrollHeight;
}

// --- job ---------------------------------------------------------------------

function updateJob(job) {
  state.jobActive = job.state === 'running' || job.state === 'paused';
  const pct = Math.round((job.progress || 0) * 100);
  $('#progressFill').style.width = pct + '%';
  $('#progressLabel').textContent = `${job.acked || 0} / ${job.total || 0}`;
  if (job.state === 'done') {
    log(`Job concluído — ${job.acked} linhas${job.errors ? `, ${job.errors} erro(s)` : ''}.`, 'rx');
  } else if (job.state === 'stopped') {
    log('Job interrompido.', 'err');
    $('#progressFill').style.width = '0%';
  }
  refreshJobButtons();
}

function refreshJobButtons() {
  const c = state.connected;
  $('#runBtn').disabled = !c || !state.hasGcode || state.jobActive;
  $('#pauseBtn').disabled = !c || !state.jobActive;
  $('#stopBtn').disabled = !c || !state.jobActive;
}

// --- visualizer + file -------------------------------------------------------

const viz2d = new Visualizer($('#viz'));
const viz3d = new Visualizer3D($('#viz3d'));
let activeView = '2d';
const activeViz = () => (activeView === '3d' ? viz3d : viz2d);
let loadedGcode = '';

document.querySelector('#viewToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  activeView = btn.dataset.view;
  document.querySelectorAll('#viewToggle button').forEach((b) => b.classList.toggle('active', b === btn));
  $('#viz').classList.toggle('hidden', activeView !== '2d');
  $('#viz3d').classList.toggle('hidden', activeView !== '3d');
  viz2d.setActive?.(activeView === '2d');
  viz3d.setActive(activeView === '3d');
});

$('#fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  loadedGcode = await file.text();
  const parsed = parseGcode(loadedGcode);
  viz2d.setGcode(parsed);
  viz3d.setGcode(parsed);
  state.hasGcode = true;
  $('#fileName').textContent = `${file.name} · ${parsed.lineCount} linhas`;
  $('#fileName').classList.remove('muted');
  refreshJobButtons();
  log(`Arquivo carregado: ${file.name} (${parsed.lineCount} linhas)`, 'rx');
});

$('#fitBtn').addEventListener('click', () => activeViz().fit());

// --- controls wiring ---------------------------------------------------------

$('#connectBtn').addEventListener('click', () => {
  if (state.connected) {
    send({ type: 'disconnect' });
  } else {
    const port = $('#portSelect').value;
    if (!port) return log('Selecione uma porta serial.', 'err');
    send({ type: 'connect', port, baud: Number($('#baudSelect').value) });
  }
});
$('#refreshPorts').addEventListener('click', () => send({ type: 'listPorts' }));

$('#homeBtn').addEventListener('click', () => send({ type: 'command', line: '$H' }));
$('#unlockBtn').addEventListener('click', () => send({ type: 'command', line: '$X' }));
$('#holdBtn').addEventListener('click', () => send({ type: 'realtime', cmd: 'hold' }));
$('#resumeBtn').addEventListener('click', () => send({ type: 'realtime', cmd: 'resume' }));
$('#resetBtn').addEventListener('click', () => send({ type: 'realtime', cmd: 'reset' }));
$('#gotoZeroBtn').addEventListener('click', () => send({ type: 'command', line: 'G90 G0 X0 Y0' }));

document.querySelectorAll('[data-zero]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const axis = btn.dataset.zero;
    const p = state.wcsP;
    const cmd = axis === 'ALL' ? `G10 L20 P${p} X0 Y0 Z0` : `G10 L20 P${p} ${axis}0`;
    send({ type: 'command', line: cmd });
  });
});

// console form
$('#consoleForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#consoleInput');
  const line = input.value.trim();
  if (!line) return;
  send({ type: 'command', line });
  history.unshift(line);
  historyIdx = -1;
  input.value = '';
});
$('#clearConsole').addEventListener('click', () => (consoleOut.innerHTML = ''));

// console history (up/down)
const history = [];
let historyIdx = -1;
$('#consoleInput').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') {
    if (historyIdx < history.length - 1) historyIdx++;
    if (history[historyIdx]) e.target.value = history[historyIdx];
    e.preventDefault();
  } else if (e.key === 'ArrowDown') {
    historyIdx = Math.max(-1, historyIdx - 1);
    e.target.value = historyIdx >= 0 ? history[historyIdx] : '';
    e.preventDefault();
  }
});

// --- jog ---------------------------------------------------------------------

$('#jogSteps').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-step]');
  if (!btn) return;
  state.step = Number(btn.dataset.step);
  $('#jogSteps').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
});

function applyUnits(units) {
  state.units = units;
  const steps = STEPS[units];
  const btns = [...$('#jogSteps').querySelectorAll('button[data-step]')];
  let activeIdx = btns.findIndex((b) => b.classList.contains('active'));
  if (activeIdx < 0) activeIdx = 1;
  btns.forEach((b, i) => {
    b.dataset.step = steps[i];
    b.textContent = steps[i];
  });
  state.step = steps[activeIdx];
  $('#jogFeedUnit').textContent = units === 'inch' ? 'in/min' : 'mm/min';
  $('#unitToggle').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.unit === units));
}

$('#unitToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-unit]');
  if (btn) applyUnits(btn.dataset.unit);
});

function jog(axis, dir) {
  if (!state.connected) return;
  const feed = Number($('#jogFeed').value) || 1000;
  const delta = state.step * dir;
  send({ type: 'jog', [axis.toLowerCase()]: delta, feed, units: state.units });
}

document.querySelectorAll('[data-jog]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const code = btn.dataset.jog;
    if (code === 'XY0') return send({ type: 'command', line: 'G90 G0 X0 Y0' });
    const axis = code[0];
    const dir = code[1] === '+' ? 1 : -1;
    jog(axis, dir);
  });
});

// keyboard jog (ignore while typing in inputs)
window.addEventListener('keydown', (e) => {
  if (/input|textarea|select/i.test(e.target.tagName)) return;
  const map = {
    ArrowRight: ['X', 1],
    ArrowLeft: ['X', -1],
    ArrowUp: ['Y', 1],
    ArrowDown: ['Y', -1],
    PageUp: ['Z', 1],
    PageDown: ['Z', -1],
  };
  if (map[e.key]) {
    e.preventDefault();
    jog(...map[e.key]);
  }
});

// --- job buttons -------------------------------------------------------------

$('#runBtn').addEventListener('click', () => {
  if (!loadedGcode) return;
  send({ type: 'run', gcode: loadedGcode });
});
$('#pauseBtn').addEventListener('click', () => {
  // toggle pause/resume based on current label
  const btn = $('#pauseBtn');
  if (btn.dataset.paused === '1') {
    send({ type: 'resumeJob' });
    btn.textContent = '⏸ Pausar';
    btn.dataset.paused = '0';
  } else {
    send({ type: 'pause' });
    btn.textContent = '▶ Continuar';
    btn.dataset.paused = '1';
  }
});
$('#stopBtn').addEventListener('click', () => {
  send({ type: 'stop' });
  $('#pauseBtn').textContent = '⏸ Pausar';
  $('#pauseBtn').dataset.paused = '0';
});

// --- settings modal ----------------------------------------------------------

function updateSetting(code, value) {
  settingsValues[code] = value;
  renderSettings();
}

function renderSettings() {
  const list = $('#settingsList');
  const codes = Object.keys(settingsValues).map(Number).sort((a, b) => a - b);
  if (!codes.length) return;
  list.innerHTML = '';
  for (const code of codes) {
    const [name, unit] = SETTINGS[code] || ['Parâmetro $' + code, ''];
    const row = document.createElement('div');
    row.className = 'setting-row';
    row.innerHTML = `
      <span class="code">$${code}</span>
      <span class="desc">${name}<small>${unit}</small></span>`;
    const input = document.createElement('input');
    input.value = settingsValues[code];
    input.addEventListener('change', () => {
      send({ type: 'command', line: `$${code}=${input.value.trim()}` });
    });
    row.appendChild(input);
    list.appendChild(row);
  }
}

// --- GRBL feedback ($#, $G, $I), errors & alarms -----------------------------

const offsets = {}; // G54..G59, G28, G30, G92, TLO
let parserStateStr = '';
const buildInfo = {};

function handleGrblEvent(msg) {
  switch (msg.event) {
    case 'setting':
      updateSetting(msg.code, msg.value);
      break;
    case 'error':
      log(describeError(msg.code), 'err');
      break;
    case 'alarm':
      log(describeAlarm(msg.code), 'err');
      break;
    case 'param':
      offsets[msg.name] = msg.value;
      renderOffsets();
      break;
    case 'parserState': {
      parserStateStr = msg.value;
      renderParser();
      const m = msg.value.match(/G5[4-9]/);
      if (m) setWcs(m[0], false);
      break;
    }
    case 'build':
      buildInfo[msg.key] = msg.value;
      renderBuild();
      break;
    case 'probe':
      state.lastProbeZ = msg.z;
      $('#probeResult').textContent = msg.success ? `Z ${msg.z.toFixed(3)} ✓` : 'falhou ✗';
      log(`Probe: X${msg.x} Y${msg.y} Z${msg.z} ${msg.success ? '(toque)' : '(falhou)'}`, 'rx');
      break;
  }
}

function renderOffsets() {
  const list = $('#offsetsList');
  const order = ['G54', 'G55', 'G56', 'G57', 'G58', 'G59', 'G28', 'G30', 'G92', 'TLO'];
  const rows = order
    .filter((k) => offsets[k] !== undefined)
    .map((k) => `<div class="kv-row"><span class="k">${k}</span><span class="v">${offsets[k]}</span></div>`)
    .join('');
  list.innerHTML = rows || '<p class="muted">Sem dados — clique na aba para reler.</p>';
}

function renderParser() {
  $('#parserState').innerHTML = parserStateStr
    ? `<div class="kv-row"><span class="k">$G</span><span class="v">${parserStateStr}</span></div>`
    : '<p class="muted">—</p>';
}

function renderBuild() {
  const rows = Object.entries(buildInfo)
    .map(([k, v]) => `<div class="kv-row"><span class="k">${k}</span><span class="v">${v || '—'}</span></div>`)
    .join('');
  $('#buildInfo').innerHTML = rows || '<p class="muted">—</p>';
}

function setWcs(code, sendCmd = true) {
  const p = { G54: 1, G55: 2, G56: 3, G57: 4, G58: 5, G59: 6 }[code];
  if (!p) return;
  state.wcsP = p;
  if ($('#wcsSelect').value !== code) $('#wcsSelect').value = code;
  if (sendCmd) send({ type: 'command', line: code });
}

// --- controls panel (tabs) ---------------------------------------------------

$('#ctrlTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (!btn) return;
  $('#ctrlTabs').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === btn.dataset.tab));
});

// spindle + coolant
const rpm = () => Number($('#spindleRpm').value) || 0;
$('#spindleCW').addEventListener('click', () => send({ type: 'command', line: `M3 S${rpm()}` }));
$('#spindleCCW').addEventListener('click', () => send({ type: 'command', line: `M4 S${rpm()}` }));
$('#spindleOff').addEventListener('click', () => send({ type: 'command', line: 'M5' }));
$('#floodOn').addEventListener('click', () => send({ type: 'command', line: 'M8' }));
$('#mistOn').addEventListener('click', () => send({ type: 'command', line: 'M7' }));
$('#coolantOff').addEventListener('click', () => send({ type: 'command', line: 'M9' }));

// overrides (real-time bytes)
document.querySelectorAll('[data-rt]').forEach((btn) => {
  btn.addEventListener('click', () => send({ type: 'realtime', cmd: btn.dataset.rt }));
});

// probe
$('#probeBtn').addEventListener('click', () => {
  const type = $('#probeType').value;
  const dist = Number($('#probeDist').value);
  const feed = Number($('#probeFeed').value) || 50;
  send({ type: 'command', line: `${type} Z${dist} F${feed}` });
});
$('#zeroAfterProbe').addEventListener('click', () => {
  send({ type: 'command', line: `G10 L20 P${state.wcsP} Z0` });
});

// coordinate system + predefined positions
$('#wcsSelect').addEventListener('change', (e) => setWcs(e.target.value, true));
document.querySelectorAll('.controls [data-cmd]').forEach((btn) => {
  btn.addEventListener('click', () => send({ type: 'command', line: btn.dataset.cmd }));
});
$('#checkModeBtn').addEventListener('click', () => send({ type: 'command', line: '$C' }));

// per-axis homing ($HX/$HY/$HZ — requires firmware support)
document.querySelectorAll('[data-home]').forEach((btn) => {
  btn.addEventListener('click', () => send({ type: 'command', line: `$H${btn.dataset.home}` }));
});

// --- settings / state modal (tabs) -------------------------------------------

function queryActiveStab() {
  if (!state.connected) return;
  const active = $('#settingsTabs button.active')?.dataset.stab;
  if (active === 'settings') send({ type: 'getSettings' });
  else if (active === 'offsets') send({ type: 'command', line: '$#' });
  else if (active === 'parser') send({ type: 'command', line: '$G' });
  else if (active === 'info') send({ type: 'command', line: '$I' });
}

$('#settingsBtn').addEventListener('click', () => {
  $('#settingsModal').classList.remove('hidden');
  queryActiveStab();
});
$('#closeSettings').addEventListener('click', () => $('#settingsModal').classList.add('hidden'));
$('#settingsModal').addEventListener('click', (e) => {
  if (e.target.id === 'settingsModal') $('#settingsModal').classList.add('hidden');
});
$('#settingsTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-stab]');
  if (!btn) return;
  $('#settingsTabs').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.stab-pane').forEach((p) => p.classList.toggle('active', p.dataset.spane === btn.dataset.stab));
  queryActiveStab();
});

// system actions (sleep / restore) — guarded
$('#sleepBtn').addEventListener('click', () => send({ type: 'command', line: '$SLP' }));
$('#rstSettings').addEventListener('click', () => {
  if (confirm('Restaurar TODAS as configurações ($$) para o padrão de fábrica?')) send({ type: 'command', line: '$RST=$' });
});
$('#rstOffsets').addEventListener('click', () => {
  if (confirm('Limpar todos os offsets de coordenadas (G54–G59, G28, G30, G92)?')) send({ type: 'command', line: '$RST=#' });
});
$('#rstAll').addEventListener('click', () => {
  if (confirm('APAGAR TUDO da EEPROM (configs + offsets + startup blocks)? Irreversível.')) send({ type: 'command', line: '$RST=*' });
});

// --- boot --------------------------------------------------------------------

connectWS();
refreshJobButtons();

// Demo: abrir com ?demo carrega um exemplo embutido (primeira execução / prints).
if (location.search.includes('demo')) {
  fetch('/examples/exemplo.nc')
    .then((r) => (r.ok ? r.text() : null))
    .then((gcode) => {
      if (!gcode) return;
      loadedGcode = gcode;
      const parsed = parseGcode(gcode);
      viz2d.setGcode(parsed);
      viz3d.setGcode(parsed);
      state.hasGcode = true;
      $('#fileName').textContent = `exemplo.nc · ${parsed.lineCount} linhas`;
      $('#fileName').classList.remove('muted');
      refreshJobButtons();
      $('#viewToggle button[data-view="3d"]').click();
    });
}
