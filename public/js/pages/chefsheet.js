import { uploadChefSheet, getChefSheetHistory, deleteChefSheet } from '../api.js';
import { showToast } from '../components/toast.js';
import { createActionMenu } from '../components/actionMenu.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { printSheet } from '../utils/printSheet.js';
import { loadingHTML } from '../utils/loadingState.js';

function statusBadge(status) {
  const colors = { pending: '#546e7a', parsed: '#2e7d32', confirmed: '#1565c0', failed: '#c62828' };
  const color = colors[status] || '#546e7a';
  return `<span class="cs-status-badge" style="background: ${color}">${escapeHtml(status)}</span>`;
}

function buildPrintTemplate() {
  const today = new Date().toISOString().slice(0, 10);
  return `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; color: #1a1a1a; }
  .cs-print-header { text-align: center; margin-bottom: 12px; border-bottom: 3px solid #1a1a1a; padding-bottom: 10px; }
  .cs-print-header h1 { font-size: 28px; letter-spacing: 2px; margin-bottom: 4px; }
  .cs-print-header .cs-print-sub { font-size: 12px; color: #666; }
  .cs-print-meta { display: flex; gap: 24px; margin-bottom: 14px; padding: 8px 0; border-bottom: 1px solid #ccc; }
  .cs-print-meta-field { flex: 1; }
  .cs-print-meta-field label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #666; display: block; margin-bottom: 2px; }
  .cs-print-meta-field .cs-print-line { border-bottom: 1px solid #999; min-height: 24px; font-size: 14px; }
  .cs-print-ruled-line { border-bottom: 1px solid #ddd; min-height: 28px; }
  .cs-print-footer { text-align: center; font-size: 11px; color: #999; margin-top: 12px; border-top: 1px solid #ccc; padding-top: 8px; }
  @media print { body { padding: 12px; } }
</style></head><body>
  <div class="cs-print-header">
    <h1>CHEFSHEET</h1>
    <div class="cs-print-sub">WRITE CLEARLY &bull; ONE ITEM PER LINE &bull; WE'LL SORT IT OUT</div>
  </div>
  <div class="cs-print-meta">
    <div class="cs-print-meta-field">
      <label>Date</label>
      <div class="cs-print-line">${today}</div>
    </div>
    <div class="cs-print-meta-field">
      <label>Shift</label>
      <div class="cs-print-line"></div>
    </div>
    <div class="cs-print-meta-field">
      <label>Chef</label>
      <div class="cs-print-line"></div>
    </div>
  </div>

  ${'<div class="cs-print-ruled-line"></div>'.repeat(30)}

  <div class="cs-print-footer">PlateStack ChefSheet &bull; Scan with app to digitize</div>
</body></html>`;
}

export async function renderChefSheet(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>ChefSheet</h1>
    </div>

    <div class="cs-actions-grid">
      <div class="cs-action-card" id="cs-print-card">
        <div class="cs-action-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="40" height="40">
            <polyline points="6 9 6 2 18 2 18 9"/>
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
            <rect x="6" y="14" width="12" height="8"/>
          </svg>
        </div>
        <h3>Print Template</h3>
        <p>Print a blank ChefSheet to write on during service</p>
      </div>

      <div class="cs-action-card" id="cs-upload-card">
        <div class="cs-action-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="40" height="40">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
        </div>
        <h3>Upload &amp; Scan</h3>
        <p>Take a photo of a completed ChefSheet to digitize it</p>
        <input type="file" id="cs-file-input" accept="image/*" capture="environment" style="display:none">
      </div>
    </div>

    <div id="cs-upload-progress" class="cs-upload-progress" style="display:none">
      <div class="cs-upload-spinner"></div>
      <p>Scanning your ChefSheet...</p>
      <p class="cs-upload-hint">Claude is reading your handwriting. This may take 15–30 seconds.</p>
    </div>

    <div class="cs-history-section">
      <h2>Recent Sheets</h2>
      <div id="cs-history-list">${loadingHTML()}</div>
    </div>
  `;

  // Print template
  container.querySelector('#cs-print-card').addEventListener('click', () => {
    printSheet(buildPrintTemplate());
  });

  // Upload flow
  const uploadCard = container.querySelector('#cs-upload-card');
  const fileInput = container.querySelector('#cs-file-input');
  const progressEl = container.querySelector('#cs-upload-progress');

  uploadCard.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    progressEl.style.display = '';
    uploadCard.style.display = 'none';

    try {
      const formData = new FormData();
      formData.append('photo', file);
      const result = await uploadChefSheet(formData);
      window.location.hash = `#/chefsheet/${result.id}`;
    } catch (err) {
      showToast(err.message || 'Upload failed', 'error');
      progressEl.style.display = 'none';
      uploadCard.style.display = '';
    }

    fileInput.value = '';
  });

  // Load history
  await loadHistory(container);

  // Sync cleanup
  const syncHandler = () => loadHistory(container);
  window.addEventListener('sync:chefsheet_parsed', syncHandler);
  window.addEventListener('sync:chefsheet_confirmed', syncHandler);
  const cleanup = () => {
    window.removeEventListener('sync:chefsheet_parsed', syncHandler);
    window.removeEventListener('sync:chefsheet_confirmed', syncHandler);
    window.removeEventListener('hashchange', cleanup);
  };
  window.addEventListener('hashchange', cleanup);
}

async function loadHistory(container) {
  const listEl = container.querySelector('#cs-history-list');
  if (!listEl) return;

  try {
    const sheets = await getChefSheetHistory();
    if (!sheets.length) {
      listEl.innerHTML = '<p class="empty-message">No ChefSheets yet. Print a template and get started!</p>';
      return;
    }

    listEl.innerHTML = sheets.map(s => {
      const date = new Date(s.sheet_date).toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
      });
      return `
        <div class="cs-history-item" data-id="${s.id}">
          <div class="cs-history-info">
            <span class="cs-history-date">${escapeHtml(date)}</span>
            ${statusBadge(s.status)}
          </div>
          <div class="cs-history-actions">
            ${s.status === 'parsed' ? `<a href="#/chefsheet/${s.id}" class="btn btn-sm btn-primary">Review</a>` : ''}
            ${s.status === 'confirmed' ? `<a href="#/chefsheet/${s.id}" class="btn btn-sm">View</a>` : ''}
          </div>
        </div>
      `;
    }).join('');

    // Add delete via action menu on each item
    listEl.querySelectorAll('.cs-history-item').forEach(item => {
      const id = item.dataset.id;
      const actionsDiv = item.querySelector('.cs-history-actions');
      const menuBtn = createActionMenu([{
        label: 'Delete',
        danger: true,
        onClick: async () => {
          try {
            await deleteChefSheet(id);
            showToast('ChefSheet deleted', 'success');
            loadHistory(container);
          } catch (err) {
            showToast(err.message, 'error');
          }
        },
      }]);
      actionsDiv.appendChild(menuBtn);
    });
  } catch (err) {
    listEl.innerHTML = `<p class="empty-message">Failed to load history</p>`;
  }
}
