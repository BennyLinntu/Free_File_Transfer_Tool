const form = document.getElementById('convertForm');
const result = document.getElementById('result');
const submitBtn = document.getElementById('submitBtn');
let CSRF = null;

// Added: client-side constraints
const MAX_SIZE = 25 * 1024 * 1024; // 25MB
const ALLOWED = new Set(['pdf', 'docx', 'txt']);

function setStatus(message, isError = false) {
    result.classList.remove('hidden');
    result.innerHTML = `<span class="${isError ? 'error' : ''}">${message}</span>`;
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    result.classList.add('hidden');
    const files = Array.from(document.getElementById('file').files || []);
    const target = document.getElementById('target').value;
    if (!files.length) return setStatus('Please choose at least one file', true);
    if (files.length > 10) return setStatus('Too many files (max 10)', true);

    // Added: quick validation
    for (const file of files) {
        const lower = (file.name || '').toLowerCase();
        const ext = lower.includes('.') ? lower.split('.').pop() : '';
        if (!ALLOWED.has(ext)) {
            return setStatus(`Unsupported type: ${file.name}`, true);
        }
        if (file.size > MAX_SIZE) {
            return setStatus(`File too large (max 25MB): ${file.name}`, true);
        }
    }

    const formData = new FormData();
    for (const f of files) formData.append('file', f);
    formData.append('target', target);
    submitBtn.disabled = true;
    submitBtn.textContent = 'Converting…';
    try {
        if (!CSRF) {
            try {
                const r = await fetch('/api/csrf', { credentials: 'same-origin' });
                const j = await r.json();
                if (j?.token) CSRF = j.token;
            } catch {/* ignore */ }
        }
        const headers = CSRF ? { 'x-csrf-token': CSRF } : {};
        const res = await fetch('/api/convert', { method: 'POST', body: formData, headers, credentials: 'same-origin' });
        // More robust parsing
        const ct = res.headers.get('content-type') || '';
        let data;
        if (ct.includes('application/json')) {
            data = await res.json();
        } else {
            const t = await res.text();
            throw new Error(t || 'Server returned an unknown response');
        }
        if (!res.ok || !data.ok) {
            throw new Error(data?.error || `Request failed (${res.status})`);
        }
        const a = document.createElement('a');
        a.href = data.url;
        a.textContent = 'Click to download result';
        a.className = 'link';
        a.download = '';
        result.classList.remove('hidden');
        result.innerHTML = '';
        result.appendChild(a);
    } catch (err) {
        setStatus(err?.message || 'Conversion failed', true);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Convert';
    }
});
