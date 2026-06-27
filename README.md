# ModCNC

Controlador **web moderno** para máquinas CNC que rodam o firmware **GRBL**
(Arduino/ATmega, ESP32, etc.). Substitui senders pesados/antiquados (Candle, UGS…)
por uma interface no navegador que funciona igual em **Windows e Mac**.

> Importante: o ModCNC **não** substitui o firmware GRBL da sua máquina — ele
> conversa com o GRBL pela porta serial. O GRBL continua fazendo o controle de
> movimento em tempo real (a parte que funciona bem); o ModCNC é só a interface.

## Recursos

- **DRO ao vivo** — posição de trabalho e de máquina, estado (Idle/Run/Hold/Alarm…),
  avanço e spindle, atualizados ~5×/s.
- **Jog pad** — passos de 0.1/1/10/50 mm, avanço configurável, controle por teclado
  (setas = X/Y, PgUp/PgDn = Z). Usa `$J=` (jog em tempo real do GRBL 1.1).
- **Visualizador de toolpath 2D e 3D** — desenha o G-code (com arcos G2/G3) em vista
  de topo (2D) ou câmera orbital 3D (arrastar = orbitar, scroll = zoom, shift = pan),
  com profundidade em Z. Mostra a posição da ferramenta em tempo real. Tudo offline,
  sem dependências.
- **Streaming de G-code** com o protocolo de contagem de caracteres do GRBL
  (buffer cheio → movimento suave, sem travadas entre linhas). Run / Pausar / Parar.
- **Console** com histórico (↑/↓) para mandar comandos `$` e G-code direto.
- **Zerar** eixos (work zero via `G10 L20`, respeitando o WCS ativo), Home (`$H`),
  Desbloquear (`$X`), Reset (soft reset), Hold/Resume.

### Cobertura das funções do GRBL 1.1

Painel de controles em abas + parsing estruturado das respostas:

- **Spindle**: M3 (horário) / M4 (anti) com RPM, M5 — estado on/off lido do campo `A`.
- **Refrigeração**: Flood (M8) / Mist (M7) / off (M9), com estado ao vivo.
- **Overrides** em tempo real: avanço, rápido e spindle (bytes `0x90–0x9D`), com
  leitura do campo `Ov` do status.
- **Sondagem**: G38.2/.3/.4/.5, exibe o resultado `[PRB:]` e zera Z no toque.
- **Coordenadas**: seletor de WCS G54–G59, G28/G30 (ir e definir), G92.1, check mode
  `$C`, e homing por eixo `$HX/$HY/$HZ` (em firmware que suporta).
- **Jog em mm ou polegada** (toggle mm/in → G21/G20).
- **Estado/Config** (modal): `$$` (configurações editáveis), `$#` (offsets), `$G`
  (estado modal), `$I` (versão/build), e ações de sistema com confirmação —
  `$SLP` (dormir), `$RST=$` / `$RST=#` / `$RST=*` (restaurar/limpar/apagar).
- **Erros e alarmes** com descrição humana em português (tabelas oficiais 1–38 / 1–10).

Qualquer comando ainda sem botão dedicado (`$N` startup blocks, G53, G43.1…) é
aceito direto pelo console.

## Como rodar

Precisa do [Node.js](https://nodejs.org) 18+ (testado no 25).

```bash
npm install
npm start
```

Abra **http://localhost:8000** no navegador. Selecione a porta serial da sua
máquina (as portas de CNC conhecidas — Espressif/Arduino/CH340/FTDI — aparecem com ★),
escolha o baud (115200 é o padrão do GRBL) e clique em **Conectar**.

Para mudar a porta HTTP: `PORT=9000 npm start`.

## Arquitetura

```
server/
  index.js    HTTP estático + ponte WebSocket
  serial.js   conexão serial (serialport) + listagem de portas
  grbl.js     protocolo GRBL: streaming, status, jog, overrides, $#/$G/$I, probe
public/
  index.html  layout
  css/        tema escuro
  js/app.js        estado + UI (WebSocket client)
  js/visualizer.js canvas 2D do toolpath (vista de topo)
  js/viz3d.js      câmera orbital 3D (sem dependências)
  js/gcode.js      parser de G-code (segmentos XYZ + arcos)
  js/grbl-data.js  tabelas de erro/alarme do GRBL 1.1
```

O navegador fala WebSocket com o servidor Node; o Node fala serial com o GRBL.
Comandos em tempo real (`?`, `!`, `~`, soft-reset, overrides) passam direto,
sem entrar na fila de linhas.

## Segurança

CNC é uma máquina que se move. Antes de rodar um job de verdade: confira o zero,
faça um "air cut" (sem ferramenta / acima da peça), e tenha o botão de
emergência à mão. O **Reset** manda um soft-reset (Ctrl-X) que para o movimento.
