import { getServiceNotes, getServiceNoteDates, createServiceNote, updateServiceNote, deleteServiceNote } from '../api.js';
import { showToast } from '../components/toast.js';
import { escapeHtml } from '../utils/escapeHtml.js';

const SHIFTS = [
  { value: 'all',   label: 'All Day',   color: '#546e7a' },
  { value: 'am',    label: 'AM',        color: '#2e7d32' },
  { value: 'lunch', label: 'Lunch',     color: '#e65100' },
  { value: 'pm',    label: 'PM/Dinner', color: '#1565c0' },
  { value: 'prep',  label: 'Prep',      color: '#6a1b9a' },
];

function shiftLabel(val) {
  return SHIFTS.find(s => s.value === val)?.label || val;
}
function shiftColor(val) {
  return SHIFTS.find(s => s.value === val)?.color || '#546e7a';
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function formatDisplayDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

export async function renderServiceNotes(container) {
  let selectedDate = todayStr();
  let notes = [];
  let datesWithNotes = new Set();
  let calYear = new Date().getFullYear();
  let calMonth = new Date().getMonth();

  container.innerHTML = `
    <div class="page-header">
      <h1>Service Notes</h1>
      <button id="add-note-btn" class="btn btn-primary">+ Add Note</button>
    </div>
    <div class="service-notes-layout">
      <div class="sn-calendar-panel">
        <div class="sn-calendar-header">
          <button id="sn-prev-month" class="sn-cal-nav" title="Previous month">&lsaquo;</button>
          <h3 id="sn-month-label"></h3>
          <button id="sn-next-month" class="sn-cal-nav" title="Next month">&rsaquo;</button>
        </div>
        <div id="sn-calendar-grid" class="sn-calendar-grid"></div>
        <div class="sn-cal-legend">
          <span class="sn-dot-legend"></span>has notes
          <button id="sn-today-btn" class="btn btn-sm">Today</button>
        </div>
      </div>
      <div class="sn-notes-panel" id="sn-notes-panel">
        <div class="loading">Loading...</div>
      </div>
    </div>
  `;

  async function loadDatesWithNotes() {
    const monthStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`;
    try {
      const dates = await getServiceNoteDates({ month: monthStr });
      datesWithNotes = new Set(dates);
    } catch {}
  }

  async function loadNotes() {
    const panel = document.getElementById('sn-notes-panel');
    panel.innerHTML = '<div class="loading">Loading...</div>';
    try {
      notes = await getServiceNotes({ date: selectedDate });
      renderNotes();
    } catch {
      panel.innerHTML = '<div class="error">Failed to load notes.</div>';
    }
  }

  function renderCalendar() {
    const label = new Date(calYear, calMonth, 1)
      .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    document.getElementById('sn-month-label').textContent = label;

    const grid = document.getElementById('sn-calendar-grid');
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const today = todayStr();

    let html = ['Su','Mo','Tu','We','Th','Fr','Sa']
      .map(d => `<div class="sn-day-header">${d}</div>`).join('');

    for (let i = 0; i < firstDay; i++) {
      html += `<div class="sn-day empty">&nbsp;</div>`;
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const cls = [
        'sn-day',
        dateStr === today ? 'today' : '',
        dateStr === selectedDate ? 'selected' : '',
        datesWithNotes.has(dateStr) ? 'has-notes' : '',
      ].filter(Boolean).join(' ');
      html += `<div class="${cls}" data-date="${dateStr}">${d}</div>`;
    }

    grid.innerHTML = html;
    grid.querySelectorAll('.sn-day:not(.empty)').forEach(cell => {
      cell.addEventListener('click', () => {
        selectedDate = cell.dataset.date;
        renderCalendar();
        loadNotes();
      });
    });
  }

  function renderNotes() {
    const panel = document.getElementById('sn-notes-panel');

    let html = `
      <div class="sn-notes-header">
        <h2>${formatDisplayDate(selectedDate)}</h2>
        <button class="btn btn-primary btn-sm" id="sn-add-inline">+ Add Note</button>
      </div>
    `;

    if (!notes.length) {
      html += `
        <div class="sn-empty">
          <div style="font-size:2.5rem;margin-bottom:12px;">📋</div>
          <p style="font-weight:600;margin-bottom:4px;">No notes for this date</p>
          <p style="font-size:0.85rem;">Click "+ Add Note" to log something for this shift.</p>
        </div>
      `;
    } else {
      html += notes.map(note => {
        const color = shiftColor(note.shift);
        return `
          <div class="sn-note-card" data-id="${note.id}">
            <div class="sn-note-top">
              <div class="sn-note-meta">
                <span class="sn-shift-badge" style="background:${color}18;color:${color};border:1px solid ${color}40;">
                  ${shiftLabel(note.shift)}
                </span>
                ${note.title ? `<span class="sn-note-title">${escapeHtml(note.title)}</span>` : ''}
              </div>
              <div class="sn-note-actions">
                <button class="btn btn-sm edit-note-btn" data-id="${note.id}">Edit</button>
                <button class="btn btn-sm btn-danger delete-note-btn" data-id="${note.id}">Delete</button>
              </div>
            </div>
            ${note.content ? `<div class="sn-note-content">${escapeHtml(note.content).replace(/\n/g, '<br>')}</div>` : ''}
          </div>
        `;
      }).join('');
    }

    panel.innerHTML = html;

    panel.querySelector('#sn-add-inline')?.addEventListener('click', () => openNoteModal());

    panel.querySelectorAll('.edit-note-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const note = notes.find(n => n.id === parseInt(btn.dataset.id));
        if (note) openNoteModal(note);
      });
    });

    panel.querySelectorAll('.delete-note-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this note?')) return;
        try {
          await deleteServiceNote(btn.dataset.id);
          showToast('Note deleted', 'info');
          await loadNotes();
          await loadDatesWithNotes();
          renderCalendar();
        } catch {
          showToast('Failed to delete', 'error');
        }
      });
    });
  }

  function openNoteModal(existingNote = null) {
    const isEdit = !!existingNote;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2>${isEdit ? 'Edit Note' : 'Add Service Note'}</h2>
          <button class="modal-close">&times;</button>
        </div>

        <div class="form-row" style="align-items:end;">
          <div class="form-group" style="flex:0 0 160px;">
            <label>Date</label>
            <input type="date" id="sn-date" class="input" value="${existingNote?.date || selectedDate}">
          </div>
          <div class="form-group" style="flex:1;">
            <label>Shift</label>
            <div class="sn-shift-picker">
              ${SHIFTS.map(s => `
                <button type="button" class="sn-shift-opt ${(existingNote?.shift || 'all') === s.value ? 'active' : ''}"
                        data-value="${s.value}"
                        style="--sc:${s.color};">
                  ${s.label}
                </button>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="form-group">
          <label>Title <span class="text-muted" style="font-weight:400;">(optional)</span></label>
          <input type="text" id="sn-title" class="input"
                 placeholder="e.g. 86 list, VIP table, Allergy alert, Staff reminder"
                 value="${escapeHtml(existingNote?.title || '')}">
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea id="sn-content" class="input" rows="6"
                    placeholder="Service notes, prep reminders, 86'd items, staff comms...">${escapeHtml(existingNote?.content || '')}</textarea>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" id="sn-save-btn">${isEdit ? 'Save Changes' : 'Add Note'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    setTimeout(() => overlay.querySelector('#sn-content')?.focus(), 150);

    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelectorAll('.sn-shift-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.sn-shift-opt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    overlay.querySelector('#sn-save-btn').addEventListener('click', async () => {
      const date = overlay.querySelector('#sn-date').value;
      const shift = overlay.querySelector('.sn-shift-opt.active')?.dataset.value || 'all';
      const title = overlay.querySelector('#sn-title').value.trim();
      const content = overlay.querySelector('#sn-content').value.trim();
      if (!date) return showToast('Date is required', 'error');

      const saveBtn = overlay.querySelector('#sn-save-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        if (isEdit) {
          await updateServiceNote(existingNote.id, { date, shift, title, content });
        } else {
          await createServiceNote({ date, shift, title, content });
        }
        overlay.remove();
        if (date !== selectedDate) {
          selectedDate = date;
          calYear = parseInt(date.slice(0, 4));
          calMonth = parseInt(date.slice(5, 7)) - 1;
        }
        showToast(isEdit ? 'Note updated' : 'Note added');
        await loadDatesWithNotes();
        renderCalendar();
        await loadNotes();
      } catch {
        showToast('Failed to save', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = isEdit ? 'Save Changes' : 'Add Note';
      }
    });
  }

  document.getElementById('add-note-btn').addEventListener('click', () => openNoteModal());

  document.getElementById('sn-today-btn').addEventListener('click', () => {
    calYear = new Date().getFullYear();
    calMonth = new Date().getMonth();
    selectedDate = todayStr();
    loadDatesWithNotes().then(() => renderCalendar());
    loadNotes();
  });

  document.getElementById('sn-prev-month').addEventListener('click', async () => {
    if (--calMonth < 0) { calMonth = 11; calYear--; }
    await loadDatesWithNotes();
    renderCalendar();
  });

  document.getElementById('sn-next-month').addEventListener('click', async () => {
    if (++calMonth > 11) { calMonth = 0; calYear++; }
    await loadDatesWithNotes();
    renderCalendar();
  });

  await loadDatesWithNotes();
  renderCalendar();
  await loadNotes();
}
