// ============================================================================
// CoSoft – Dashboard-Logik: Kunden, Kanban, Terminplanung, Realtime-Sync
// ============================================================================

const state = {
  session: null,
  customers: [],
  activeCustomerId: null,
  columns: [],
  tasks: [],
  events: [],
  calDate: new Date(),
  channel: null,
};

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) =>
  (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => d.toISOString().slice(0, 10);
const todayStr = () => fmtDate(new Date());

function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }
document.querySelectorAll('[data-close]').forEach((btn) =>
  btn.addEventListener('click', (e) => closeModal(e.target.closest('.modal-backdrop').id))
);

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
(async function init() {
  const session = await requireAuth();
  if (!session) return;
  state.session = session;
  $('user-email').textContent = session.user.email;
  $('btn-logout').addEventListener('click', logout);

  await loadCustomers();
  wireStaticHandlers();
})();

async function loadCustomers() {
  const { data, error } = await supabaseClient.from('customers').select('*').order('created_at');
  if (error) { console.error(error); return; }
  state.customers = data;
  renderSidebar();

  if (!state.customers.length) {
    $('empty-state').classList.remove('hidden');
    $('workspace').classList.add('hidden');
    return;
  }
  $('empty-state').classList.add('hidden');
  if (!state.activeCustomerId || !data.find((c) => c.id === state.activeCustomerId)) {
    await selectCustomer(state.customers[0].id);
  }
}

function renderSidebar() {
  const list = $('customer-list');
  list.innerHTML = state.customers
    .map(
      (c) => `
      <li>
        <a href="#" data-id="${c.id}" class="${c.id === state.activeCustomerId ? 'active' : ''}">
          <span class="swatch" style="background:${c.color}"></span> ${escapeHtml(c.name)}
        </a>
      </li>`
    )
    .join('');
  list.querySelectorAll('a').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      selectCustomer(a.dataset.id);
    })
  );
}

async function selectCustomer(id) {
  state.activeCustomerId = id;
  renderSidebar();
  const customer = state.customers.find((c) => c.id === id);
  $('workspace').classList.remove('hidden');
  $('empty-state').classList.add('hidden');
  $('customer-name').textContent = customer.name;
  $('customer-swatch').style.background = customer.color;

  await loadBoardData();
  subscribeRealtime(id);
}

async function loadBoardData() {
  const cid = state.activeCustomerId;
  const [{ data: columns }, { data: tasks }, { data: events }] = await Promise.all([
    supabaseClient.from('board_columns').select('*').eq('customer_id', cid).order('position'),
    supabaseClient.from('tasks').select('*').eq('customer_id', cid).order('position'),
    supabaseClient.from('events').select('*').eq('customer_id', cid),
  ]);
  state.columns = columns || [];
  state.tasks = tasks || [];
  state.events = events || [];
  renderBoard();
  renderCalendar();
}

function subscribeRealtime(customerId) {
  if (state.channel) supabaseClient.removeChannel(state.channel);
  state.channel = supabaseClient
    .channel('customer-' + customerId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `customer_id=eq.${customerId}` }, loadBoardData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `customer_id=eq.${customerId}` }, loadBoardData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'board_columns', filter: `customer_id=eq.${customerId}` }, loadBoardData)
    .subscribe();
}

// ---------------------------------------------------------------------------
// Kanban-Board
// ---------------------------------------------------------------------------
function renderBoard() {
  const board = $('board');
  board.innerHTML = state.columns
    .map((col) => {
      const tasks = state.tasks.filter((t) => t.column_id === col.id).sort((a, b) => a.position - b.position);
      return `
        <div class="column" data-column-id="${col.id}">
          <div class="column-head">
            <span>${escapeHtml(col.name)}</span>
            <span class="count">${tasks.length}</span>
          </div>
          <div class="column-body" data-column-id="${col.id}">
            ${tasks.map(taskCardHtml).join('')}
            <button class="add-card-btn" data-column-id="${col.id}">+ Aufgabe hinzufügen</button>
          </div>
        </div>`;
    })
    .join('');

  board.querySelectorAll('.add-card-btn').forEach((btn) =>
    btn.addEventListener('click', () => openTaskModal(null, btn.dataset.columnId))
  );
  board.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('click', () => openTaskModal(card.dataset.taskId));
    card.addEventListener('dragstart', (e) => {
      card.classList.add('dragging');
      e.dataTransfer.setData('text/task-id', card.dataset.taskId);
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });
  board.querySelectorAll('.column-body').forEach((body) => {
    body.addEventListener('dragover', (e) => {
      e.preventDefault();
      body.classList.add('drag-over');
    });
    body.addEventListener('dragleave', () => body.classList.remove('drag-over'));
    body.addEventListener('drop', async (e) => {
      e.preventDefault();
      body.classList.remove('drag-over');
      const taskId = e.dataTransfer.getData('text/task-id');
      if (!taskId) return;
      const columnId = body.dataset.columnId;
      const siblings = state.tasks.filter((t) => t.column_id === columnId);
      await supabaseClient
        .from('tasks')
        .update({ column_id: columnId, position: siblings.length, done: isDoneColumn(columnId) })
        .eq('id', taskId);
      await loadBoardData();
    });
  });
}

function isDoneColumn(columnId) {
  const col = state.columns.find((c) => c.id === columnId);
  return !!col && /erledigt|done|fertig/i.test(col.name);
}

function taskCardHtml(t) {
  const due = t.due_date
    ? `<span class="badge due ${t.due_date < todayStr() ? 'overdue' : ''}">📅 ${t.due_date}</span>`
    : '';
  const prio = `<span class="badge prio-${t.priority}">${t.priority}</span>`;
  const assignee = t.assignee_email ? `<span>👤 ${escapeHtml(t.assignee_email)}</span>` : '';
  return `
    <div class="card" draggable="true" data-task-id="${t.id}">
      <div class="title">${escapeHtml(t.title)}</div>
      <div class="meta">${prio}${due}${assignee}</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Aufgaben-Modal
// ---------------------------------------------------------------------------
function openTaskModal(taskId, presetColumnId, presetDueDate) {
  const columnSelect = $('task-column');
  columnSelect.innerHTML = state.columns.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

  const task = taskId ? state.tasks.find((t) => t.id === taskId) : null;
  $('task-id').value = task ? task.id : '';
  $('task-modal-title').textContent = task ? 'Aufgabe bearbeiten' : 'Neue Aufgabe';
  $('task-title').value = task ? task.title : '';
  $('task-desc').value = task ? task.description || '' : '';
  columnSelect.value = task ? task.column_id : presetColumnId || state.columns[0]?.id;
  $('task-due').value = task ? task.due_date || '' : presetDueDate || '';
  $('task-priority').value = task ? task.priority : 'normal';
  $('task-assignee').value = task ? task.assignee_email || '' : '';
  $('btn-delete-task').classList.toggle('hidden', !task);
  $('task-link-hint').classList.toggle('hidden', !(task && $('task-due').value));
  openModal('modal-task');
}

$('task-due').addEventListener('input', () => {
  $('task-link-hint').classList.toggle('hidden', !$('task-due').value);
});

$('form-task').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('task-id').value;
  const payload = {
    title: $('task-title').value.trim(),
    description: $('task-desc').value.trim() || null,
    column_id: $('task-column').value,
    due_date: $('task-due').value || null,
    priority: $('task-priority').value,
    assignee_email: $('task-assignee').value.trim() || null,
  };

  if (id) {
    await supabaseClient.from('tasks').update(payload).eq('id', id);
  } else {
    const columnTasks = state.tasks.filter((t) => t.column_id === payload.column_id);
    await supabaseClient.from('tasks').insert({
      ...payload,
      customer_id: state.activeCustomerId,
      position: columnTasks.length,
      created_by: state.session.user.id,
    });
  }
  closeModal('modal-task');
  await loadBoardData();
});

$('btn-delete-task').addEventListener('click', async () => {
  const id = $('task-id').value;
  if (!id || !confirm('Aufgabe wirklich löschen? Ein verknüpfter Termin wird ebenfalls entfernt.')) return;
  await supabaseClient.from('tasks').delete().eq('id', id);
  closeModal('modal-task');
  await loadBoardData();
});

// ---------------------------------------------------------------------------
// Terminplanung / Kalender
// ---------------------------------------------------------------------------
const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
const DOWS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function renderCalendar() {
  const year = state.calDate.getFullYear();
  const month = state.calDate.getMonth();
  $('calendar-title').textContent = `Terminplanung – ${MONTHS[month]} ${year}`;

  const firstOfMonth = new Date(year, month, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7; // Montag = 0
  const gridStart = new Date(year, month, 1 - startOffset);

  const eventsByDate = {};
  state.events.forEach((ev) => {
    (eventsByDate[ev.event_date] ||= []).push(ev);
  });

  let html = DOWS.map((d) => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + i);
    const dateStr = fmtDate(day);
    const isOtherMonth = day.getMonth() !== month;
    const isToday = dateStr === todayStr();
    const dayEvents = eventsByDate[dateStr] || [];

    html += `
      <div class="day-cell ${isOtherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}" data-date="${dateStr}">
        <div class="num">${day.getDate()}</div>
        ${dayEvents
          .slice(0, 3)
          .map(
            (ev) =>
              `<div class="event-pill ${ev.task_id ? 'linked' : 'standalone'}" data-event-id="${ev.id}">${escapeHtml(ev.title)}</div>`
          )
          .join('')}
        ${dayEvents.length > 3 ? `<div class="event-pill standalone">+${dayEvents.length - 3} weitere</div>` : ''}
      </div>`;
  }
  $('calendar-grid').innerHTML = html;

  $('calendar-grid').querySelectorAll('.day-cell').forEach((cell) => {
    cell.addEventListener('click', (e) => {
      if (e.target.closest('.event-pill')) return;
      openDayModal(cell.dataset.date);
    });
    cell.addEventListener('dragover', (e) => e.preventDefault());
    cell.addEventListener('drop', async (e) => {
      e.preventDefault();
      const eventId = e.dataTransfer.getData('text/event-id');
      if (!eventId) return;
      await supabaseClient.from('events').update({ event_date: cell.dataset.date }).eq('id', eventId);
      await loadBoardData();
    });
  });
  $('calendar-grid').querySelectorAll('.event-pill').forEach((pill) => {
    pill.setAttribute('draggable', 'true');
    pill.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/event-id', pill.dataset.eventId));
    pill.addEventListener('click', () => {
      const ev = state.events.find((x) => x.id === pill.dataset.eventId);
      if (!ev) return;
      if (ev.task_id) openTaskModal(ev.task_id);
      else openEventModal(ev);
    });
  });
}

$('cal-prev').addEventListener('click', () => {
  state.calDate.setMonth(state.calDate.getMonth() - 1);
  renderCalendar();
});
$('cal-next').addEventListener('click', () => {
  state.calDate.setMonth(state.calDate.getMonth() + 1);
  renderCalendar();
});
$('cal-today').addEventListener('click', () => {
  state.calDate = new Date();
  renderCalendar();
});

let dayModalDate = null;
function openDayModal(dateStr) {
  dayModalDate = dateStr;
  $('day-modal-title').textContent = 'Termine am ' + dateStr;
  const dayEvents = state.events.filter((ev) => ev.event_date === dateStr);
  $('day-events-list').innerHTML = dayEvents.length
    ? dayEvents
        .map(
          (ev) => `
      <div class="card" data-event-id="${ev.id}" style="cursor:pointer;">
        <div class="title">${ev.task_id ? '🔗 ' : ''}${escapeHtml(ev.title)}</div>
      </div>`
        )
        .join('')
    : '<p style="font-size:13px;color:var(--ink-soft);">Noch keine Termine an diesem Tag.</p>';

  $('day-events-list').querySelectorAll('[data-event-id]').forEach((el) =>
    el.addEventListener('click', () => {
      const ev = state.events.find((x) => x.id === el.dataset.eventId);
      closeModal('modal-day');
      if (ev.task_id) openTaskModal(ev.task_id);
      else openEventModal(ev);
    })
  );
  openModal('modal-day');
}

$('day-add-task').addEventListener('click', () => {
  closeModal('modal-day');
  openTaskModal(null, state.columns[0]?.id, dayModalDate);
});
$('day-add-event').addEventListener('click', () => {
  closeModal('modal-day');
  openEventModal(null);
});

function openEventModal(event) {
  $('event-title').value = event ? event.title : '';
  $('event-notes').value = event ? event.notes || '' : '';
  $('form-event').dataset.eventId = event ? event.id : '';
  $('btn-delete-event').classList.toggle('hidden', !event);
  openModal('modal-event');
}

$('form-event').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = e.target.dataset.eventId;
  const payload = { title: $('event-title').value.trim(), notes: $('event-notes').value.trim() || null };
  if (id) {
    await supabaseClient.from('events').update(payload).eq('id', id);
  } else {
    await supabaseClient.from('events').insert({
      ...payload,
      customer_id: state.activeCustomerId,
      event_date: dayModalDate,
      created_by: state.session.user.id,
    });
  }
  closeModal('modal-event');
  await loadBoardData();
});

$('btn-delete-event').addEventListener('click', async () => {
  const id = $('form-event').dataset.eventId;
  if (!id || !confirm('Termin wirklich löschen?')) return;
  await supabaseClient.from('events').delete().eq('id', id);
  closeModal('modal-event');
  await loadBoardData();
});

// ---------------------------------------------------------------------------
// Kunde anlegen / Mitglied einladen
// ---------------------------------------------------------------------------
function wireStaticHandlers() {
  $('btn-new-customer').addEventListener('click', () => openModal('modal-customer'));
  $('btn-empty-new-customer').addEventListener('click', () => openModal('modal-customer'));
  $('btn-invite').addEventListener('click', () => openModal('modal-invite'));

  $('form-customer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('customer-name-input').value.trim();
    const color = $('customer-color-input').value;
    const { data, error } = await supabaseClient
      .from('customers')
      .insert({ name, color, owner_id: state.session.user.id })
      .select()
      .single();
    if (error) { alert(error.message); return; }
    closeModal('modal-customer');
    $('form-customer').reset();
    $('customer-color-input').value = '#6d5efc';
    await loadCustomers();
    await selectCustomer(data.id);
  });

  $('form-invite').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('invite-email').value.trim();
    const { error } = await supabaseClient.rpc('invite_member_by_email', {
      target_customer_id: state.activeCustomerId,
      member_email: email,
    });
    if (error) { alert(error.message); return; }
    closeModal('modal-invite');
    $('form-invite').reset();
    alert('Mitglied wurde hinzugefügt.');
  });
}
