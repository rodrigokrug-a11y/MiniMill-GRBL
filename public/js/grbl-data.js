// GRBL 1.1 error and alarm code tables (official messages + pt-br descriptions).

export const ERRORS = {
  1: ['Expected command letter', 'Palavra de G-code sem a letra esperada.'],
  2: ['Bad number format', 'Valor numérico ausente ou em formato inválido.'],
  3: ['Invalid statement', "Comando '$' não reconhecido ou não suportado."],
  4: ['Value < 0', 'Valor negativo onde se espera um positivo.'],
  5: ['Setting disabled', 'Homing não está habilitado nas configurações.'],
  6: ['Value < 3 usec', 'Pulso de passo mínimo deve ser maior que 3µs.'],
  7: ['EEPROM read fail', 'Falha na leitura da EEPROM. Restaurando padrões.'],
  8: ['Not idle', "Comando '$' só pode ser usado com a máquina em IDLE."],
  9: ['G-code lock', 'G-code bloqueado durante estado de alarme ou jog.'],
  10: ['Homing not enabled', 'Limites de software exigem homing habilitado.'],
  11: ['Line overflow', 'Máximo de caracteres por linha excedido.'],
  12: ['Step rate > 30kHz', 'Configuração faz a taxa de passo exceder o máximo.'],
  13: ['Check Door', 'Porta de segurança detectada aberta.'],
  14: ['Line length exceeded', 'Linha de build/startup excedeu o limite da EEPROM.'],
  15: ['Travel exceeded', 'Alvo do jog excede o curso da máquina. Jog ignorado.'],
  16: ['Invalid jog command', "Comando de jog sem '=' ou com g-code proibido."],
  17: ['Setting disabled', 'Modo laser exige saída PWM.'],
  20: ['Unsupported command', 'Comando G-code não suportado ou inválido.'],
  21: ['Modal group violation', 'Mais de um comando do mesmo grupo modal no bloco.'],
  22: ['Undefined feed rate', 'Avanço (feed rate) ainda não foi definido.'],
  23: ['Invalid gcode', 'Comando exige um valor inteiro.'],
  24: ['Invalid gcode', 'Mais de um comando exigindo palavras de eixo.'],
  25: ['Invalid gcode', 'Palavra de G-code repetida no bloco.'],
  26: ['Invalid gcode', 'Faltam palavras de eixo para o comando.'],
  27: ['Invalid gcode', 'Número de linha inválido.'],
  28: ['Invalid gcode', 'Falta uma palavra de valor obrigatória.'],
  29: ['Invalid gcode', 'Sistemas G59.x não são suportados.'],
  30: ['Invalid gcode', 'G53 só é permitido com G0 e G1.'],
  31: ['Invalid gcode', 'Palavras de eixo sem comando que as utilize.'],
  32: ['Invalid gcode', 'Arco G2/G3 exige ao menos um eixo no plano.'],
  33: ['Invalid gcode', 'Alvo do comando de movimento é inválido.'],
  34: ['Invalid gcode', 'Valor de raio do arco é inválido.'],
  35: ['Invalid gcode', 'Arco G2/G3 exige ao menos um offset (I/J/K) no plano.'],
  36: ['Invalid gcode', 'Palavras de valor não utilizadas no bloco.'],
  37: ['Invalid gcode', 'G43.1 não atribuído ao eixo de comprimento configurado.'],
  38: ['Invalid gcode', 'Número de ferramenta acima do máximo suportado.'],
};

export const ALARMS = {
  1: ['Hard limit', 'Limite físico acionado. Posição perdida — refaça o homing.'],
  2: ['Soft limit', 'Alvo excede o curso. Posição mantida — pode desbloquear.'],
  3: ['Abort during cycle', 'Reset durante movimento. Posição perdida — refaça homing.'],
  4: ['Probe fail', 'Sonda em estado inicial inesperado antes do ciclo.'],
  5: ['Probe fail', 'Sonda não tocou a peça dentro do curso programado.'],
  6: ['Homing fail', 'Ciclo de homing foi resetado.'],
  7: ['Homing fail', 'Porta de segurança aberta durante o homing.'],
  8: ['Homing fail', 'Pull-off não conseguiu liberar o fim de curso.'],
  9: ['Homing fail', 'Fim de curso não encontrado na distância de busca.'],
  10: ['Homing fail', 'Segundo fim de curso (eixo duplo) não acionou.'],
};

export function describeError(code) {
  const e = ERRORS[Number(code)];
  return e ? `error:${code} — ${e[0]} · ${e[1]}` : `error:${code}`;
}

export function describeAlarm(code) {
  const a = ALARMS[Number(code)];
  return a ? `ALARME ${code} — ${a[0]} · ${a[1]}` : `ALARME ${code}`;
}
