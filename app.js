// Progresso para Todos — lógica do formulário
(function () {
  const form = document.getElementById('form');
  const btn = document.getElementById('btn');
  const statusEl = document.getElementById('status');
  const loadedAt = Date.now();
  const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

  function setStatus(text, type) {
    statusEl.textContent = text;
    statusEl.className = type || '';
  }

  function resetCaptcha() {
    if (window.turnstile) { try { window.turnstile.reset(); } catch (_) {} }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (btn.disabled) return;

    const name = form.elements.name.value.trim();
    const email = form.elements.email.value.trim();
    const message = form.elements.message.value.trim();
    const tokenField = form.querySelector('[name="cf-turnstile-response"]');
    const token = tokenField ? tokenField.value : '';

    if (name.length < 2) return setStatus('Preencha seu nome.', 'err');
    if (!EMAIL_RE.test(email) || email.length > 254) return setStatus('E-mail inválido.', 'err');
    if (message.length < 20) return setStatus('A mensagem está muito curta.', 'err');
    if (!document.getElementById('consent').checked) return setStatus('Marque a autorização para enviar.', 'err');
    if (!token) return setStatus('Confirme que você não é um robô.', 'err');

    btn.disabled = true;
    setStatus('Enviando...');

    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, email, message, token,
          website: form.elements.website.value,
          elapsed: Date.now() - loadedAt
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar. Tente de novo.');

      setStatus('E-mail enviado! Obrigado por participar.', 'ok');
      btn.textContent = 'ENVIADO ✓';
      document.getElementById('wa').href =
        'https://wa.me/?text=' + encodeURIComponent('Eu já cobrei o PCdoB. Cobre também: ' + location.origin + location.pathname);
      document.getElementById('share').style.display = 'block';
    } catch (err) {
      setStatus(err.message, 'err');
      resetCaptcha();
      btn.disabled = false;
    }
  });
})();
