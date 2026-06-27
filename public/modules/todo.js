let todos = [];

function renderList() {
  const ul = document.getElementById('todo-list');
  ul.innerHTML = '';

  if (!todos.length) {
    ul.innerHTML = '<li class="todo-empty">Sin tareas pendientes 🎉</li>';
    return;
  }

  todos.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = `todo-item${item.done ? ' done' : ''}`;
    li.dataset.id = item.id;

    li.innerHTML = `
      <button class="todo-checkbox" aria-label="${item.done ? 'Marcar como pendiente' : 'Marcar como hecha'}"
              aria-pressed="${item.done}">
        ${item.done ? '✓' : ''}
      </button>
      <span class="todo-text">${escHtml(item.text)}</span>
      <button class="todo-delete" aria-label="Eliminar tarea">×</button>
    `;

    li.querySelector('.todo-checkbox').addEventListener('click', () =>
      toggleTodo(item.id, !item.done)
    );
    li.querySelector('.todo-delete').addEventListener('click', () => deleteTodo(item.id, li));

    ul.appendChild(li);

    gsap.fromTo(
      li,
      { opacity: 0, x: -12 },
      { opacity: 1, x: 0, duration: 0.3, delay: i * 0.04, ease: 'power2.out' }
    );
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function toggleTodo(id, done) {
  try {
    const r = await fetch(`/api/todo/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done }),
    });
    if (r.ok) {
      const updated = await r.json();
      todos = todos.map((t) => (t.id === id ? updated : t));
      renderList();
    }
  } catch (err) {
    console.error('Todo toggle:', err);
  }
}

async function deleteTodo(id, li) {
  gsap.to(li, {
    opacity: 0,
    x: 20,
    height: 0,
    duration: 0.25,
    ease: 'power2.in',
    onComplete: async () => {
      try {
        await fetch(`/api/todo/${id}`, { method: 'DELETE' });
        todos = todos.filter((t) => t.id !== id);
        renderList();
      } catch (err) {
        console.error('Todo delete:', err);
      }
    },
  });
}

async function addTodo(text) {
  try {
    const r = await fetch('/api/todo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (r.ok) {
      const item = await r.json();
      todos.push(item);
      renderList();
    }
  } catch (err) {
    console.error('Todo add:', err);
  }
}

export async function initTodo() {
  try {
    const r = await fetch('/api/todo');
    todos = await r.json();
    renderList();
  } catch (err) {
    console.error('Todo init:', err);
    document.getElementById('todo-list').innerHTML =
      '<li class="todo-empty">No se pudo cargar la lista</li>';
    return;
  }

  const form = document.getElementById('todo-form');
  const input = document.getElementById('todo-input');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await addTodo(text);
  });
}
