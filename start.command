#!/bin/bash
# Lançador clicável do ModCNC para macOS.
# Dê dois cliques neste arquivo no Finder (na 1ª vez: clique direito → Abrir).

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js não encontrado."
  echo "   Instale em https://nodejs.org  (ou no Terminal: brew install node)"
  echo
  read -n 1 -s -r -p "Pressione qualquer tecla para sair..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "📦 Instalando dependências (só na primeira vez)..."
  npm install || { echo "❌ Falha no npm install"; read -n 1 -s -r; exit 1; }
fi

PORT="${PORT:-8000}"
echo "🚀 Iniciando ModCNC em http://localhost:$PORT"
( sleep 1.5; open "http://localhost:$PORT" ) &
PORT="$PORT" npm start
