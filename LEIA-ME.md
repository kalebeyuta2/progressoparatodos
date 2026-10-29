# Progresso para Todos — como publicar

## Arquivos
- `index.html` — a página
- `app.js` — lógica do formulário
- `api/send.js` — envia o e-mail pelo Resend
- `vercel.json` — cabeçalhos de segurança

## 1. Captcha (Cloudflare Turnstile, grátis)
1. Crie conta em dash.cloudflare.com → **Turnstile** → **Add widget**.
2. Domínio: o endereço do site (ex.: `progresso-para-todos.vercel.app`). Modo: **Managed**.
3. Copie a **Site Key** e cole no `index.html`, no lugar de `1x00000000000000000000AA`.
4. Guarde a **Secret Key** para o passo 3.

## 2. Limite de envios que não zera (Upstash, grátis — recomendado)
1. Crie conta em upstash.com → **Create Database** (Redis), região São Paulo.
2. Copie **UPSTASH_REDIS_REST_URL** e **UPSTASH_REDIS_REST_TOKEN**.

Sem o Upstash, os limites funcionam, mas zeram quando a Vercel reinicia a função.

## 3. Variáveis na Vercel (Settings → Environment Variables)
| Nome | Valor |
|---|---|
| RESEND_API_KEY | chave `re_...` do Resend |
| FROM_EMAIL | `Progresso para Todos <contato@seudominio.com.br>` |
| TO_EMAILS | e-mail(s) da direção do PCdoB, separados por vírgula |
| SUBJECT | `Pedido de posicionamento sobre o deputado eleito Elias Jabbour` |
| TURNSTILE_SECRET | Secret Key do Turnstile |
| UPSTASH_REDIS_REST_URL | do Upstash |
| UPSTASH_REDIS_REST_TOKEN | do Upstash |
| ALLOWED_ORIGINS | (opcional) seu domínio próprio, ex.: `https://progresso.seusite.com.br` |
| DAILY_CAP | (opcional) máximo de envios por dia; padrão 2000 |

Depois de mudar qualquer variável: **Deployments → ⋯ → Redeploy**.

## Proteções incluídas
- Captcha Cloudflare Turnstile
- Só aceita envios vindos do próprio site
- Armadilha invisível para robôs + tempo mínimo de preenchimento
- Máx. 3 envios por IP por hora, 1 por e-mail por dia, teto diário total
- Bloqueia links na mensagem e limpa caracteres invisíveis
- Guarda só hashes de IP e e-mail nos contadores, nunca o dado em texto
- Cabeçalhos de segurança: CSP, anti-iframe, HSTS etc.
- A chave do Resend fica só no servidor
