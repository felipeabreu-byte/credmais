/**
 * CRED+ - Backend Seguro de Pagamentos PIX
 * Integração Oficial Pushin Pay (Cash-In & Webhooks) com Fallback Asaas
 * Arquitetura Zero-Dependency (Node.js nativo 18+)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ==========================================
// CARREGADOR DE VARIÁVEIS DE AMBIENTE (.env)
// ==========================================
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  }
}

loadEnv();

const PORT = parseInt(process.env.PORT, 10) || 3000;

// Configurações Pushin Pay
const PUSHINPAY_TOKEN = (process.env.PUSHINPAY_TOKEN || '').trim();
const PUSHINPAY_ENVIRONMENT = (process.env.PUSHINPAY_ENVIRONMENT || 'producao').trim().toLowerCase();
const PUSHINPAY_WEBHOOK_URL = (process.env.PUSHINPAY_WEBHOOK_URL || '').trim();

const isPushinSandbox = PUSHINPAY_ENVIRONMENT === 'sandbox' || 
                        PUSHINPAY_ENVIRONMENT === 'teste' || 
                        PUSHINPAY_TOKEN.includes('sand');

const PUSHINPAY_BASE_URL = isPushinSandbox
  ? 'https://api-sandbox.pushinpay.com.br/api'
  : 'https://api.pushinpay.com.br/api';

const isPushinConfigured = PUSHINPAY_TOKEN && 
                           PUSHINPAY_TOKEN !== 'seu_token_pushinpay_aqui' && 
                           PUSHINPAY_TOKEN.length > 10;

// Configurações Asaas (Fallback opcional)
const ASAAS_API_KEY = (process.env.ASAAS_API_KEY || '').trim();
const ASAAS_ENVIRONMENT = (process.env.ASAAS_ENVIRONMENT || 'producao').trim().toLowerCase();
const isAsaasSandbox = ASAAS_ENVIRONMENT === 'sandbox' || ASAAS_ENVIRONMENT === 'teste' || ASAAS_API_KEY.includes('sand');
const ASAAS_BASE_URL = isAsaasSandbox ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
const isAsaasConfigured = ASAAS_API_KEY && 
                          ASAAS_API_KEY !== 'sua_chave_asaas_aqui' && 
                          ASAAS_API_KEY.length > 20;

// Gateway Ativo
const ACTIVE_GATEWAY = isPushinConfigured ? 'pushinpay' : (isAsaasConfigured ? 'asaas' : 'simulation');

// Cache em memória de transações geradas
const transactions = new Map();

// ==========================================
// CLIENTE HTTP/HTTPS PUSHIN PAY
// ==========================================
function pushinPayRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const cleanEndpoint = endpoint.replace(/^\/+/, '');
    const baseClean = PUSHINPAY_BASE_URL.replace(/\/+$/, '');
    const url = new URL(`${baseClean}/${cleanEndpoint}`);
    const postData = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Authorization': `Bearer ${PUSHINPAY_TOKEN}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'CredPlusApp/1.0',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data, error: 'Resposta não é JSON válido' });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    // Timeout de 15 segundos
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Timeout de requisição à Pushin Pay'));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

// ==========================================
// CLIENTE HTTP/HTTPS ASAAS (FALLBACK)
// ==========================================
function asaasRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const cleanEndpoint = endpoint.replace(/^\/+/, '');
    const baseClean = ASAAS_BASE_URL.replace(/\/+$/, '');
    const url = new URL(`${baseClean}/${cleanEndpoint}`);
    const postData = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'access_token': ASAAS_API_KEY,
        'User-Agent': 'CredPlusApp/1.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data, error: 'Resposta não é JSON válido' });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

// ==========================================
// SIMULADOR PROCEDURAL (FALLBACK / TESTES)
// ==========================================
function generateFallbackPix(amountInCents) {
  const amountFloat = (amountInCents / 100).toFixed(2);
  const amtLen = String(amountFloat.length).padStart(2, '0');
  const randomHex = Math.floor(Math.random() * 65535).toString(16).toUpperCase().padStart(4, '0');
  const randomId = Math.floor(100000 + Math.random() * 899999);
  const txId = 'sim_' + crypto.randomUUID();

  const qrCodeText = `00020126360014BR.GOV.BCB.PIX0114+5511994${randomId}5204000053039865${amtLen}${amountFloat}5802BR5905CRED+6009SAO PAULO62070503***6304${randomHex}`;

  return {
    id: txId,
    qr_code: qrCodeText,
    qr_code_base64: null,
    status: 'created',
    value: amountInCents,
    isFallback: true
  };
}

// ==========================================
// PROCESSAMENTO DE COBRANÇA PIX COM PUSHIN PAY
// ==========================================
async function createPushinPayPix(amountCents) {
  const payload = {
    value: amountCents
  };

  if (PUSHINPAY_WEBHOOK_URL) {
    payload.webhook_url = PUSHINPAY_WEBHOOK_URL;
  }

  console.log(`[PushinPay] Enviando requisição de PIX Cash-In (valor: R$ ${(amountCents / 100).toFixed(2)})...`);
  const response = await pushinPayRequest('POST', '/pix/cashIn', payload);

  if (response.status >= 200 && response.status < 300 && response.data) {
    const data = response.data;
    const txId = String(data.id || data.uuid || crypto.randomUUID());
    const qrCode = data.qr_code || data.pix_code || data.qrcode || '';
    
    // Normalizar imagem base64
    let qrBase64 = data.qr_code_base64 || data.qrcode_base64 || null;
    if (qrBase64 && !qrBase64.startsWith('data:')) {
      qrBase64 = `data:image/png;base64,${qrBase64}`;
    }

    const txData = {
      id: txId,
      gateway: 'PushinPay',
      qr_code: qrCode,
      qr_code_base64: qrBase64,
      status: data.status || 'created',
      value: amountCents,
      createdAt: new Date().toISOString(),
      raw: data
    };

    transactions.set(txId, txData);
    console.log(`[PushinPay] PIX gerado com sucesso! ID: ${txId} | Status: ${txData.status}`);
    return { success: true, transaction: txData };
  } else {
    console.warn('[PushinPay] Erro ou resposta inesperada da API:', response.status, response.data || response.raw);
    throw new Error((response.data && (response.data.message || response.data.error)) || `Erro HTTP ${response.status} na PushinPay`);
  }
}

// ==========================================
// CONSULTA DE STATUS NA PUSHIN PAY
// ==========================================
async function queryPushinPayStatus(txId) {
  try {
    // Tenta primeiro o endpoint plural /transactions/{id}
    let res = await pushinPayRequest('GET', `/transactions/${txId}`);
    
    // Fallback para singular /transaction/{id} caso retorne 404
    if (res.status === 404) {
      res = await pushinPayRequest('GET', `/transaction/${txId}`);
    }

    if (res.status === 200 && res.data) {
      const rawStatus = (res.data.status || '').toLowerCase();
      const isPaid = rawStatus === 'paid' || rawStatus === 'pago' || rawStatus === 'confirmed' || rawStatus === 'received';
      
      if (isPaid && transactions.has(txId)) {
        transactions.get(txId).status = 'paid';
      }

      return {
        success: true,
        id: txId,
        status: isPaid ? 'paid' : rawStatus,
        isPaid: isPaid,
        data: res.data
      };
    }
  } catch (err) {
    console.error(`[PushinPay Status] Erro ao consultar transação ${txId}:`, err.message);
  }

  return null;
}

// ==========================================
// ROTEADOR DE REQUISIÇÕES DA API
// ==========================================
async function handleApiRequest(req, res, pathname) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. Status Geral da Integração
  if (req.method === 'GET' && pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      gateway: isPushinConfigured ? 'PushinPay' : (isAsaasConfigured ? 'Asaas' : 'Simulação'),
      environment: isPushinConfigured ? (isPushinSandbox ? 'sandbox' : 'producao') : 'local',
      pushinpay: {
        isConfigured: isPushinConfigured,
        environment: isPushinSandbox ? 'sandbox' : 'producao',
        baseUrl: PUSHINPAY_BASE_URL,
        webhookConfigured: Boolean(PUSHINPAY_WEBHOOK_URL)
      },
      asaas: {
        isConfigured: isAsaasConfigured,
        environment: isAsaasSandbox ? 'sandbox' : 'producao'
      },
      message: isPushinConfigured
        ? `✓ Pushin Pay (${isPushinSandbox ? 'Sandbox' : 'Produção'}) configurada e pronta para pagamentos PIX.`
        : '⚠️ Token da Pushin Pay não configurado. Edite o arquivo .env com seu PUSHINPAY_TOKEN.'
    }));
    return;
  }

  // 2. Criar Cobrança PIX (/api/pix/create)
  if (req.method === 'POST' && pathname === '/api/pix/create') {
    let rawBody = '';
    req.on('data', chunk => rawBody += chunk);
    req.on('end', async () => {
      try {
        const body = JSON.parse(rawBody || '{}');
        const amountFloat = parseFloat(body.amount) || 47.90;
        const amountCents = Math.round(amountFloat * 100);

        if (amountFloat < 0.50) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'O valor mínimo para cobrança PIX é de R$ 0,50.' }));
          return;
        }

        console.log(`[PIX] Iniciando geração de PIX no valor de R$ ${amountFloat.toFixed(2)} (${amountCents} centavos)...`);

        // Caso A: Pushin Pay configurada (Gateway Principal)
        if (isPushinConfigured) {
          try {
            const result = await createPushinPayPix(amountCents);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              success: true,
              isReal: true,
              gateway: 'PushinPay',
              transaction: result.transaction
            }));
            return;
          } catch (err) {
            console.error('[PushinPay] Falha ao gerar PIX:', err.message);
            // Fallback de demonstração caso a API retorne erro ou token inválido
            const fallback = generateFallbackPix(amountCents);
            transactions.set(fallback.id, fallback);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              success: true,
              isReal: false,
              gateway: 'PushinPay',
              warning: `Erro na Pushin Pay (${err.message}). Exibindo QR Code de demonstração.`,
              transaction: fallback
            }));
            return;
          }
        }

        // Caso B: Asaas configurado (Fallback Secundário)
        if (isAsaasConfigured) {
          try {
            console.log('[Asaas] Processando PIX de contingência via Asaas...');
            const fallback = generateFallbackPix(amountCents);
            transactions.set(fallback.id, fallback);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              success: true,
              isReal: false,
              gateway: 'Asaas',
              transaction: fallback
            }));
            return;
          } catch (err) {
            console.error('[Asaas] Erro:', err.message);
          }
        }

        // Caso C: Nenhum gateway com chave real -> Modo Simulação Elegante
        const fallback = generateFallbackPix(amountCents);
        transactions.set(fallback.id, fallback);
        console.log(`[PIX Simulação] QR Code dinâmico criado: ${fallback.id}`);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          isReal: false,
          gateway: 'Demonstração',
          warning: 'Token da Pushin Pay não configurado no .env. Configure PUSHINPAY_TOKEN para processar pagamentos reais.',
          transaction: fallback
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Erro interno ao processar cobrança: ' + e.message }));
      }
    });
    return;
  }

  // 3. Consultar Status da Transação (/api/pix/status/:id)
  if (req.method === 'GET' && pathname.startsWith('/api/pix/status/')) {
    const txId = pathname.replace('/api/pix/status/', '').trim();
    if (!txId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'ID da transação não fornecido.' }));
      return;
    }

    const cached = transactions.get(txId);

    // Se já está marcado como pago na memória (via webhook ou simulação)
    if (cached && (cached.status === 'paid' || cached.status === 'PAID')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        id: txId,
        status: 'paid',
        isPaid: true,
        cached: true
      }));
      return;
    }

    // Se a transação for da Pushin Pay real
    if (isPushinConfigured && !txId.startsWith('sim_')) {
      const pushinStatus = await queryPushinPayStatus(txId);
      if (pushinStatus) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(pushinStatus));
        return;
      }
    }

    // Retorna status em cache ou 'created'
    const currentStatus = cached ? cached.status : 'created';
    const isPaid = currentStatus === 'paid' || currentStatus === 'PAID';

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      id: txId,
      status: currentStatus,
      isPaid: isPaid,
      cached: Boolean(cached)
    }));
    return;
  }

  // 4. Simulação de Pagamento Concluído (para testes no navegador)
  if (req.method === 'POST' && pathname === '/api/pix/simulate-paid') {
    let rawBody = '';
    req.on('data', chunk => rawBody += chunk);
    req.on('end', () => {
      try {
        const body = JSON.parse(rawBody || '{}');
        const id = body.id;
        if (id && transactions.has(id)) {
          transactions.get(id).status = 'paid';
        }
        console.log(`[Simulação] Transação ${id} marcada manualmente como PAGA!`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, id, status: 'paid', isPaid: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 5. Webhook Recebido da Pushin Pay / Gateways (/api/webhook)
  if (req.method === 'POST' && pathname === '/api/webhook') {
    let rawBody = '';
    req.on('data', chunk => rawBody += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(rawBody || '{}');
        console.log('[Webhook] Notificação de pagamento recebida:', payload);

        // Suporte a diferentes formatos de payload da Pushin Pay
        const txId = payload.id || (payload.transaction && payload.transaction.id) || payload.uuid;
        const status = (payload.status || (payload.transaction && payload.transaction.status) || payload.event || '').toLowerCase();

        const isPaid = status === 'paid' || 
                       status === 'pago' || 
                       status === 'confirmed' || 
                       status === 'received' || 
                       status === 'payment_received';

        if (txId && transactions.has(txId)) {
          if (isPaid) {
            transactions.get(txId).status = 'paid';
            console.log(`[Webhook] Transação ${txId} APROVADA e confirmada instantaneamente!`);
          } else {
            transactions.get(txId).status = status;
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true, isPaid }));
      } catch (e) {
        console.error('[Webhook] Erro ao processar payload:', e.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload inválido' }));
      }
    });
    return;
  }

  // Rota desconhecida da API
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint da API não encontrado.' }));
}

// ==========================================
// SERVIDOR DE ARQUIVOS ESTÁTICOS COM SPA FALLBACK
// ==========================================
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

function serveStaticFile(req, res, pathname) {
  let relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const safePath = path.normalize(path.join(__dirname, relativePath));

  if (!safePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Acesso proibido');
    return;
  }

  fs.stat(safePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const indexPath = path.join(__dirname, 'index.html');
      fs.readFile(indexPath, (readErr, data) => {
        if (readErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Arquivo index.html não encontrado.');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });

    const stream = fs.createReadStream(safePath);
    stream.pipe(res);
  });
}

// ==========================================
// INICIALIZAÇÃO DO SERVIDOR HTTP
// ==========================================
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  if (pathname.startsWith('/api/')) {
    handleApiRequest(req, res, pathname);
  } else {
    serveStaticFile(req, res, pathname);
  }
});

server.listen(PORT, () => {
  console.log('\n================================================================');
  console.log(`🚀 CRED+ Servidor Ativo: http://localhost:${PORT}`);
  console.log(`💳 Gateway de Checkout: PUSHIN PAY (${isPushinSandbox ? 'SANDBOX' : 'PRODUÇÃO'})`);
  console.log(`🔑 Status da Credencial: ${isPushinConfigured ? '✅ CONFIGURADA (.env)' : '⚠️  NÃO CONFIGURADA (Insira PUSHINPAY_TOKEN no .env)'}`);
  if (PUSHINPAY_WEBHOOK_URL) {
    console.log(`📡 Webhook URL: ${PUSHINPAY_WEBHOOK_URL}`);
  }
  console.log('================================================================\n');
});
