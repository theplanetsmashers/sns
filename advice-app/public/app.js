(function () {
  const form = document.getElementById('concernForm');
  const input = document.getElementById('concernInput');
  const submitBtn = document.getElementById('submitBtn');
  const loading = document.getElementById('loading');
  const result = document.getElementById('result');
  const messageBox = document.getElementById('messageBox');
  const adviceBox = document.getElementById('adviceBox');
  const referencesBox = document.getElementById('referencesBox');
  const referencesList = document.getElementById('referencesList');
  const statusLine = document.getElementById('statusLine');

  function setLoading(isLoading) {
    loading.hidden = !isLoading;
    submitBtn.disabled = isLoading;
  }

  function resetResult() {
    result.hidden = true;
    messageBox.hidden = true;
    messageBox.classList.remove('error');
    adviceBox.hidden = true;
    referencesBox.hidden = true;
    referencesList.innerHTML = '';
  }

  function showMessage(text, isError) {
    messageBox.textContent = text;
    messageBox.hidden = false;
    messageBox.classList.toggle('error', Boolean(isError));
  }

  function renderReferences(references) {
    if (!references || references.length === 0) return;
    referencesList.innerHTML = '';
    references.forEach((ref) => {
      const li = document.createElement('li');
      const label = ref.articleNumber ? `#${ref.articleNumber} ` : '';
      const a = document.createElement('a');
      a.href = ref.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = `${label}${ref.title}`;
      li.appendChild(a);
      referencesList.appendChild(li);
    });
    referencesBox.hidden = false;
  }

  async function loadStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      const llmNote = data.llmEnabled
        ? 'AIアドバイス生成: 有効'
        : 'AIアドバイス生成: 未設定（関連記事の提示のみ）';
      statusLine.textContent = `参照記事 ${data.articleCount}件 / ${llmNote}`;
    } catch {
      statusLine.textContent = '';
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const concern = input.value.trim();
    if (!concern) return;

    resetResult();
    result.hidden = false;
    setLoading(true);

    try {
      const res = await fetch('/api/advice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ concern }),
      });
      const data = await res.json();

      if (!res.ok) {
        showMessage(data.error || 'エラーが発生しました。', true);
        if (data.references) renderReferences(data.references);
        return;
      }

      if (data.mode === 'no_match') {
        showMessage(data.message, false);
        return;
      }

      if (data.mode === 'fallback') {
        showMessage(data.message, false);
        renderReferences(data.references);
        return;
      }

      adviceBox.textContent = data.advice;
      adviceBox.hidden = false;
      renderReferences(data.references);
    } catch (err) {
      showMessage('通信エラーが発生しました。時間をおいて再度お試しください。', true);
    } finally {
      setLoading(false);
    }
  });

  loadStatus();
})();
