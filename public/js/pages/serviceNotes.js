import { showToast } from '../components/toast.js';

const SHIFTS = [
  { value: 'all',    label: 'All Day' },
  { value: 'am',     label: 'AM / Breakfast' },
  { value: 'lunch',  label: 'Lunch' },
  { value: 'pm',     label: 'PM / Dinner' },
  { value: 'prep',   label: 'Prep' },
];

function shiftLabel(val) {
  return SHIFTS.find(s => s.value === val)?.label || val;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatDisplayDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export async function renderServiceNotes(container) {
  let selectedDate = todayStr();
  let notes = [];
  let datesWithNotes = new Set();

  container.innerHTML = `
    <div class="page-header">
      <h1>Service Notes</h1>
      <button id="add-note-btn" class="btn btn-primary">+ Add Note</button>
    </div>

    <div class="service-notes-layout">
      <div class="service-date-picker" id="date-picker-panel">
        <div class="service-date-nav">
          <button id="prev-month-btn" class="btn btn-icon">&lsaquo;</button>
          <span id="month-label" class="service-month-label"></span>
          <button id="next-month-btn" class="btn btn-icon">&rsaquo;</button>
        </div>
        <div id="calendar-grid" class="service-calendar-grid"></div>
        <div style="margin-top:10px;font-size:0.8rem;color:var(--text-muted);text-align:center;">
          <span class="sn-dot"></span> = has notes
        </div>
      </div>

      <div class="service-notes-main" id="notes-main">
        <div class="loading">Loading...</div>
      </div>
    </div>
  `;

  let calYear = new Date().getFullYear();
  let calMonth = new Date().getMonth(); // 0-indexed

  async function loadDatesWithNotes() {
    const monthStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`;
    try {
      const res = await fetch(`/api/service-notes/dates?month=${monthStr}`);
      const dates = await res.json();
      datesWithNotes = new Set(dates);
    } catch {}
  }

  async function loadNotes() {
    document.getElementById('notes-main').innerHTML = '<div class="loading">Loading...</div>';
    try {
      const res = await fetch(`/api/service-notes?date=${selectedDate}`);
      notes = await res.json();
      renderNotes();
    } catch {
      document.getElementById('notes-main').innerHTML = '<div class="error">Failed to load notes.</div>';
    }
  }

  function renderCalendar() {
    const label = new Date(calYear, calMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    document.getElementById('month-label').textContent = label;

    const grid = document.getElementById('calendar-grid');
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

    let html = '<div class="cal-row cal-header">';
    ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d => {
      html += `<div class="cal-cell cal-day-label">${d}</div>`;
    });
    html += '</div><div class="cal-row">';

    for (let i = 0; i < firstDay; i++) html += '<div class="cal-cell"></div>';

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isToday = dateStr === todayStr();
      const isSelected = dateStr === selectedDate;
      const hasNote = datesWithNotes.has(dateStr);
      html += `
        <div class="cal-cell cal-day ${isToday ? 'cal-today' : ''} ${isSelected ? 'cal-selected' : ''}" data-date="${dateStr}">
          ${d}${hasNote ? '<span class="sn-dot"></span>' : ''}
        </div>
      `;
      if ((firstDay + d) % 7 === 0) html += '</div><div class="cal-row">';
    }
    html += '</div>';
    grid.innerHTML = html;

    grid.querySelectorAll('.cal-day').forEach(cell => {
      cell.addEventListener('click', () => {
        selectedDate = cell.dataset.date;
        renderCalendar();
        loadNotes();
      });
    });
  }

  function renderNotes() {
    const main = document.getElementById('notes-main');
    const dateLabel = formatDisplayDate(selectedDate);

    let html = `<div class="service-notes-date-header">${dateLabel}</div>`;

    if (!notes.length) {
      html += `<div class="empty-state" style="padding:40px 0;">
        <p>No notes for this date.</p>
        <button class="btn btn-primary" id="add-note-inline">+ Add Note</button>
      </div>`;
    } else {
      html += notes.map(note => `
        <div class="service-note-card" data-id="${note.id}">
          <div class="sn-card-header">
            <span class="sn-shift-badge shift-${note.shift}">${shiftLabel(note.shift)}</span>
            ${note.title ? `<strong class="sn-title">${note.title}</strong>` : ''}
            <div class="sn-actions">
              <button class="btn btn-sm edit-note-btn" data-id="${note.id}" title="Edit">✏️</button>
              <button class="btn btn-sm btn-danger delete-note-btn" data-id="${note.id}" title="Delete">🗑</button>
            </div>
          </div>
          ${note.content ? `<div class="sn-content">${note.content.replace(/\n/g, '<br>')}</div>` : ''}
        </div>
      `).join('');
    }

    main.innerHTML = html;

    main.querySelector('#add-note-inline')?.addEventListener('click', openAddModal);

    main.querySelectorAll('.edit-note-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const note = notes.find(n => n.id === parseInt(btn.dataset.id));
        if (note) openEditModal(note);
      });
    });

    main.querySelectorAll('.delete-note-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await fetch(`/api/service-notes/${btn.dataset.id}`, { method: 'DELETE' });
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

  function noteFormHTML(note = null) {
    return `
      <div class="form-group">
        <label>Date</label>
        <input type="date" id="note-date" class="input" value="${note?.date || selectedDate}">
      </div>
      <div class="form-group">
        <label>Shift</label>
        <select id="note-shift" class="input">
          ${SHIFTS.map(s => `<option value="${s.value}" ${(note?.shift || 'all') === s.value ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Title (optional)</label>
        <input type="text" id="note-title" class="input" placeholder="e.g. Allergy alert, VIP table, 86'd items" value="${note?.title || ''}">
      </div>
      <div class="form-group">
        <label>Notes</label>
        <textarea id="note-content" class="input" rows="5" placeholder="Enter service notes, reminders, 86 list...">${note?.content || ''}</textarea>
      </div>
    `;
  }

  function openAddModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2>Add Service Note</h2>
          <button class="modal-close">&times;</button>
        </div>
        ${noteFormHTML()}
        <div class="form-actions">
          <button id="save-note-btn" class="btn btn-primary">Save Note</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    overlay.querySelector('.modal-close').addEventListener('click', () => {
      overlay.remove();
    });

    overlay.querySelector('#save-note-btn').addEventListener('click', async () => {
      const date = overlay.querySelector('#note-date').value;
      const shift = overlay.querySelector('#note-shift').value;
      const title = overlay.querySelector('#note-title').value.trim();
      const content = overlay.querySelector('#note-content').value.trim();

      if (!date) return showToast('Date is required', 'error');

      try {
        await fetch('/api/service-notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, shift, title, content }),
        });
        overlay.remove();
        if (date !== selectedDate) selectedDate = date;
        showToast('Note saved');
        await loadDatesWithNotes();
        renderCalendar();
        await loadNotes();
      } catch {
        showToast('Failed to save note', 'error');
      }
    });
  }

  function openEditModal(note) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2>Edit Note</h2>
          <button class="modal-close">&times;</button>
        </div>
        ${noteFormHTML(note)}
        <div class="form-actions">
          <button id="save-note-btn" class="btn btn-primary">Save Changes</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());

    overlay.querySelector('#save-note-btn').addEventListener('click', async () => {
      const date = overlay.querySelector('#note-date').value;
      const shift = overlay.querySelector('#note-shift').value;
      const title = overlay.querySelector('#note-title').value.trim();
      const content = overlay.querySelector('#note-content').value.trim();

      try {
        await fetch(`/api/service-notes/${note.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, shift, title, content }),
        });
        overlay.remove();
        showToast('Note updated');
        await loadDatesWithNotes();
        renderCalendar();
        await loadNotes();
      } catch {
        showToast('Failed to update note', 'error');
      }
    });
  }

  // Wire up month nav
  document.getElementById('add-note-btn').addEventListener('click', openAddModal);

  document.getElementById('prev-month-btn').addEventListener('click', async () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    await loadDatesWithNotes();
    renderCalendar();
  });

  document.getElementById('next-month-btn').addEventListener('click', async () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    await loadDatesWithNotes();
    renderCalendar();
  });

  await loadDatesWithNotes();
  renderCalendar();
  await loadNotes();
}
