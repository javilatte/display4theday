let history = []; // { role, content }[]
let streaming = false;

function getWeatherContext() {
  const desc = document.getElementById('w-desc')?.textContent?.trim();
  const temp = document.getElementById('w-temp')?.textContent?.trim();
  const high = document.getElementById('w-high')?.textContent?.trim();
  const low = document.getElementById('w-low')?.textContent?.trim();
  const hum = document.getElementById('w-humidity')?.textContent?.trim();
  const wind = document.getElementById('w-wind')?.textContent?.trim();
  const loc = document.getElementById('w-location')?.textContent?.replace('📍', '').trim();

  const hourly = [...document.querySelectorAll('.w-hour-cell')]
    .map((cell) => {
      const h = cell.querySelector('.w-hour-time')?.textContent?.trim();
      const i = cell.querySelector('.w-hour-icon')?.textContent?.trim();
      const t = cell.querySelector('.w-hour-temp')?.textContent?.trim();
      return h && t ? `${h} ${i ?? ''} ${t}` : null;
    })
    .filter(Boolean)
    .join(', ');

  const lines = [
    `Ubicación: ${loc || 'desconocida'}`,
    `Ahora: ${desc}, ${temp}, máx ${high}, mín ${low}`,
    `Humedad: ${hum}, Viento: ${wind}`,
    hourly ? `Previsión horaria: ${hourly}` : null,
  ].filter(Boolean);

  return lines.join('. ');
}

async function loadModels() {
  try {
    const res = await fetch('/api/ai/models');
    const list = await res.json();
    const sel = document.getElementById('ai-model-select');
    sel.innerHTML = '';
    const preferred = 'gemma3:12b';
    list.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      if (m === preferred) opt.selected = true;
      sel.appendChild(opt);
    });
    // Si gemma no está, seleccionar el primero
    if (!list.includes(preferred) && list.length) sel.value = list[0];
  } catch (err) {
    console.error('AI models:', err);
  }
}

function appendAssistant() {
  const el = document.createElement('p');
  el.className = 'ai-assistant-msg';
  document.getElementById('ai-messages').appendChild(el);
  return el;
}

function appendUser(text) {
  const el = document.createElement('p');
  el.className = 'ai-user-msg';
  el.textContent = text;
  document.getElementById('ai-messages').appendChild(el);
}

async function send(userText) {
  if (streaming) return;
  streaming = true;

  const btn = document.getElementById('ai-send-btn');
  const input = document.getElementById('ai-input');
  const model = document.getElementById('ai-model-select')?.value || 'gemma3:12b';
  const messages = document.getElementById('ai-messages');
  btn.disabled = true;

  if (userText) {
    appendUser(userText);
    history.push({ role: 'user', content: userText });
  }

  const el = appendAssistant();
  messages.scrollTop = messages.scrollHeight;

  let full = '';

  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: history,
        model,
        weather: getWeatherContext(),
      }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6);
        if (raw === '[DONE]') break;
        try {
          const { content, error } = JSON.parse(raw);
          if (error) {
            el.textContent = `Error: ${error}`;
            break;
          }
          if (content) {
            full += content;
            el.textContent = full;
            messages.scrollTop = messages.scrollHeight;
          }
        } catch {}
      }
    }

    if (full) history.push({ role: 'assistant', content: full });
  } catch (err) {
    el.textContent = 'No se pudo conectar con el asistente.';
    console.error('AI:', err);
  }

  btn.disabled = false;
  input.focus();
  streaming = false;
}

export async function initAI() {
  await loadModels();

  const input = document.getElementById('ai-input');
  const btn = document.getElementById('ai-send-btn');

  btn.addEventListener('click', () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    send(text);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      send(text);
    }
  });

  // Saludo automático — espera 3s a que cargue el tiempo
  const msgEl = document.getElementById('ai-messages');
  msgEl.innerHTML = '';
  setTimeout(() => send(null), 3000);

  // Botón de refresh
  document.getElementById('ai-refresh-btn').addEventListener('click', () => {
    if (streaming) return;
    history = [];
    msgEl.innerHTML = '';
    send(null);
  });
}
