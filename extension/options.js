const apiKeyInput = document.getElementById('api-key');
const modelInput = document.getElementById('model');
const statusEl = document.getElementById('status');
const saveBtn = document.getElementById('save');
const clearKeyBtn = document.getElementById('clear-key');

function setStatus(message) {
  statusEl.textContent = message;
  if (message) {
    setTimeout(() => {
      statusEl.textContent = '';
    }, 3000);
  }
}

async function loadOptions() {
  const { apiKey = '', model = 'gpt-5.6-luna' } = await chrome.storage.local.get(['apiKey', 'model']);
  apiKeyInput.value = '';
  apiKeyInput.placeholder = apiKey ? 'Chave já guardada. Cole nova chave para substituir.' : 'Cole a chave aqui';
  modelInput.value = model;
}

async function saveOptions() {
  const apiKey = apiKeyInput.value.trim();
  const model = modelInput.value.trim() || 'gpt-5.6-luna';
  if (!apiKey) {
    const existing = await chrome.storage.local.get('apiKey');
    if (!existing.apiKey) {
      setStatus('Introduza uma chave API antes de guardar.');
      apiKeyInput.focus();
      return;
    }
  }
  saveBtn.disabled = true;
  try {
    const values = { model };
    if (apiKey) values.apiKey = apiKey;
    await chrome.storage.local.set(values);
    apiKeyInput.value = '';
    apiKeyInput.placeholder = 'Chave guardada. Cole nova chave para substituir.';
    setStatus('Configuração guardada.');
  } catch (error) {
    setStatus('Não foi possível guardar. Verifique as permissões da extensão.');
  } finally {
    saveBtn.disabled = false;
  }
}

saveBtn.addEventListener('click', () => {
  saveOptions().catch(() => setStatus('Não foi possível guardar a configuração.'));
});

clearKeyBtn.addEventListener('click', async () => {
  clearKeyBtn.disabled = true;
  try {
    await chrome.storage.local.remove('apiKey');
    apiKeyInput.value = '';
    apiKeyInput.placeholder = 'Cole a chave aqui';
    setStatus('Chave apagada.');
  } catch (error) {
    setStatus('Não foi possível apagar a chave.');
  } finally {
    clearKeyBtn.disabled = false;
  }
});

loadOptions().catch(() => setStatus('Não foi possível carregar a configuração.'));
