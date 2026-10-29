// Progresso para Todos — função serverless (Vercel) que envia o e-mail pelo Resend.
//
// Variáveis de ambiente (Vercel → Settings → Environment Variables):
//   OBRIGATÓRIAS
//     RESEND_API_KEY     chave do Resend (re_...)
//     FROM_EMAIL         ex: "Progresso para Todos <contato@seudominio.com.br>"
//     TO_EMAILS          destinatários, separados por vírgula
//     SUBJECT            assunto do e-mail
//     TURNSTILE_SECRET   chave secreta do Cloudflare Turnstile (captcha)
//   RECOMENDADAS (limite de envios que não zera; grátis em upstash.com)
//     UPSTASH_REDIS_REST_URL
//     UPSTASH_REDIS_REST_TOKEN
//   OPCIONAIS
//     ALLOWED_ORIGINS    domínios extras aceitos, ex: "https://progresso.seusite.com.br"
//     DAILY_CAP          máximo de envios por dia no total (padrão 2000)

const LIMITS = {
  perIpHour: 3,      // por IP, por hora
  perEmailDay: 1,    // por e-mail, por dia
  minFillMs: 4000,   // tempo mínimo para preencher (bots são instantâneos)
  maxBody: 12000     // tamanho máximo do pedido, em caracteres
};

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const memory = new Map(); // reserva caso o Upstash não esteja configurado (zera ao reiniciar)

function clean(str, max) {
  return String(str)
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, max);
}

async function hash(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Buffer.from(buf).toString('hex').slice(0, 32);
}

// Conta +1 numa chave com validade; devolve o total atual.
async function bump(key, ttlSeconds) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    const r = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCR', key], ['EXPIRE', key, String(ttlSeconds), 'NX']])
    });
    if (!r.ok) throw new Error('limiter');
    const out = await r.json();
    return Number(out[0].result);
  }
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.exp < now) {
    memory.set(key, { n: 1, exp: now + ttlSeconds * 1000 });
    return 1;
  }
  entry.n += 1;
  return entry.n;
}

// Desfaz uma contagem (usado quando o envio falha, para a pessoa poder tentar de novo).
async function unbump(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    if (url && token) {
      await fetch(`${url}/decr/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${token}` } });
    } else if (memory.has(key)) {
      memory.get(key).n -= 1;
    }
  } catch (_) {}
}

async function verifyCaptcha(token, ip) {
  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET, response: token });
  if (ip) body.set('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const out = await r.json().catch(() => ({}));
  return out.success === true;
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  const allowed = new Set(
    (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  );
  allowed.add(`https://${req.headers.host}`);
  return allowed.has(origin);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const fail = (code, msg) => res.status(code).json({ error: msg });

  if (req.method !== 'POST') return fail(405, 'Método não permitido.');
  if (!String(req.headers['content-type'] || '').includes('application/json'))
    return fail(415, 'Formato inválido.');
  if (!originAllowed(req)) return fail(403, 'Origem não permitida.');

  const body = req.body;
  if (!body || typeof body !== 'object' || JSON.stringify(body).length > LIMITS.maxBody)
    return fail(400, 'Pedido inválido.');

  const { name, email, message, token, website, elapsed } = body;

  // Armadilhas para bots: finge sucesso e não envia nada
  if (website) return res.status(200).json({ ok: true });
  if (typeof elapsed !== 'number' || elapsed < LIMITS.minFillMs)
    return res.status(200).json({ ok: true });

  // Validação
  if (typeof name !== 'string' || typeof email !== 'string' || typeof message !== 'string')
    return fail(400, 'Pedido inválido.');
  const cName = clean(name, 100).replace(/[<>"\n]/g, ' ');
  const cEmail = email.trim().toLowerCase();
  const cMessage = clean(message, 6000);
  if (cName.length < 2) return fail(400, 'Nome inválido.');
  if (cEmail.length > 254 || !EMAIL_RE.test(cEmail)) return fail(400, 'E-mail inválido.');
  if (cMessage.length < 20) return fail(400, 'Mensagem muito curta.');
  if (/https?:\/\/|www\./i.test(cMessage)) return fail(400, 'Remova links da mensagem.');

  const to = (process.env.TO_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!process.env.RESEND_API_KEY || !process.env.FROM_EMAIL || !to.length || !process.env.TURNSTILE_SECRET) {
    console.error('Variáveis de ambiente faltando.');
    return fail(500, 'Servidor não configurado.');
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const emailKey = `em:${await hash(cEmail)}`;

  try {
    // Captcha
    if (typeof token !== 'string' || token.length > 2048 || !(await verifyCaptcha(token, ip)))
      return fail(403, 'Verificação anti-robô falhou. Recarregue a página.');

    // Limites (guardamos só hashes, não o IP nem o e-mail em texto)
    if ((await bump(`ip:${await hash(ip)}`, 3600)) > LIMITS.perIpHour)
      return fail(429, 'Muitos envios deste local. Tente mais tarde.');
    if ((await bump(emailKey, 86400)) > LIMITS.perEmailDay)
      return fail(429, 'Este e-mail já enviou hoje. Obrigado!');
    const day = new Date().toISOString().slice(0, 10);
    if ((await bump(`day:${day}`, 90000)) > Number(process.env.DAILY_CAP || 2000))
      return fail(429, 'Limite diário atingido. Volte amanhã.');
  } catch (e) {
    console.error('Erro na verificação', e);
    return fail(503, 'Serviço indisponível. Tente em instantes.');
  }

  const text =
    `${cMessage}\n\n${cName}\n${cEmail}\n\n` +
    `---\nEnviado por um cidadão pela campanha Progresso para Todos.`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.FROM_EMAIL,
        to,
        reply_to: cEmail,
        subject: process.env.SUBJECT || 'Mensagem de cidadão',
        text
      })
    });
    if (!r.ok) {
      console.error('Resend', r.status, await r.text());
      await unbump(emailKey);
      return fail(502, 'Falha no envio. Tente de novo.');
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    await unbump(emailKey);
    return fail(500, 'Erro interno.');
  }
}
