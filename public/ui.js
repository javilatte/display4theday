// Boots tiny UI bits that live outside the module panels.
document.getElementById('page-refresh-btn')?.addEventListener('click', () => location.reload());

document.getElementById('google-search')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('google-search-input');
  const q = input.value.trim();
  if (q)
    window.open('https://www.google.com/search?q=' + encodeURIComponent(q), '_blank', 'noopener');
  input.value = '';
});
