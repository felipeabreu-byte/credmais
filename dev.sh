#!/bin/sh
# Localizar binário do Node.js automaticamente
if [ -x "/Users/felipeabreu/.gemini/antigravity-ide/bin/node" ]; then
  NODE_BIN="/Users/felipeabreu/.gemini/antigravity-ide/bin/node"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="node"
elif [ -x "/usr/local/bin/node" ]; then
  NODE_BIN="/usr/local/bin/node"
elif [ -x "/opt/homebrew/bin/node" ]; then
  NODE_BIN="/opt/homebrew/bin/node"
else
  echo "Erro: Node.js não foi encontrado no sistema."
  exit 1
fi

echo "Iniciando servidor CRED+ com Pushin Pay..."
"$NODE_BIN" server.js
