const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

const lists = {
  todo: document.getElementById('todoList'),
  doing: document.getElementById('doingList'),
  done: document.getElementById('doneList'),
  backlog: document.getElementById('backlogList'),
  history: document.getElementById('historyList'),
};

const tabButtons = {
  board: document.getElementById('boardTab'),
  backlog: document.getElementById('backlogTab'),
  history: document.getElementById('historyTab'),
};

const views = {
  board: document.getElementById('boardView'),
  backlog: document.getElementById('backlogView'),
  history: document.getElementById('historyView'),
};

const newCardBtn = document.getElementById('newCardBtn');
const dialog = document.getElementById('cardDialog');
const form = document.getElementById('cardForm');
const dialogTitle = document.getElementById('dialogTitle');
const titleInput = document.getElementById('titleInput');
const descInput = document.getElementById('descInput');
const addItemBtn = document.getElementById('addItemBtn');
const editChecklist = document.getElementById('editChecklist');
const cancelBtn = document.getElementById('cancelBtn');
const cardTemplate = document.getElementById('cardTemplate');

let state = { cards: [] };
let editingId = null;
let draftChecklist = [];
let activeView = 'board';
let touchDrag = null;

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function isHistoryCard(card) {
  return card.column === 'done' && Number(card.doneAt) && Date.now() - Number(card.doneAt) > TWO_DAYS_MS;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data.error) msg = data.error;
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function loadCards() {
  const data = await api('/api/cards');
  state.cards = Array.isArray(data.cards) ? data.cards : [];
  render();
}

function renderEmpty(listEl, text) {
  const note = document.createElement('p');
  note.className = 'empty-note';
  note.textContent = text;
  listEl.append(note);
}

function createCardNode(card, { draggable = false } = {}) {
  const node = cardTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.id = card.id;

  if (!draggable) node.draggable = false;

  node.querySelector('.card-title').textContent = card.title;
  node.querySelector('.card-desc').textContent = card.description || '';

  const checklistEl = node.querySelector('.checklist');
  card.checklist.forEach((item) => {
    const li = document.createElement('li');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = item.checked;
    cb.addEventListener('change', async () => {
      try {
        const nextChecklist = card.checklist.map((i) =>
          i.id === item.id ? { ...i, checked: cb.checked } : i,
        );
        await api(`/api/cards/${card.id}/checklist`, {
          method: 'PATCH',
          body: JSON.stringify({ checklist: nextChecklist }),
        });
        await loadCards();
      } catch (err) {
        alert(`Could not update checklist: ${err.message}`);
        await loadCards();
      }
    });

    const span = document.createElement('span');
    span.textContent = item.text;
    if (item.checked) span.classList.add('done');

    li.append(cb, span);
    checklistEl.append(li);
  });

  node.querySelector('.edit-btn').addEventListener('click', () => openEditor(card.id));

  if (draggable) {
    node.addEventListener('dragstart', () => node.classList.add('dragging'));
    node.addEventListener('dragend', () => node.classList.remove('dragging'));
    node.addEventListener('pointerdown', onTouchPointerDown);
  }

  return node;
}

function render() {
  Object.values(lists).forEach((list) => (list.innerHTML = ''));

  const boardCards = state.cards.filter((card) => !isHistoryCard(card));
  const backlogCards = state.cards.filter((card) => card.column === 'todo');
  const historyCards = state.cards
    .filter(isHistoryCard)
    .sort((a, b) => Number(b.doneAt) - Number(a.doneAt));

  for (const card of boardCards) {
    lists[card.column].append(createCardNode(card, { draggable: true }));
  }

  for (const card of backlogCards) {
    lists.backlog.append(createCardNode(card));
  }

  for (const card of historyCards) {
    lists.history.append(createCardNode(card));
  }

  if (!backlogCards.length) renderEmpty(lists.backlog, 'Backlog is empty.');
  if (!historyCards.length) renderEmpty(lists.history, 'No completed cards older than 2 days yet.');
}

function setView(viewName) {
  activeView = viewName;

  Object.entries(tabButtons).forEach(([name, btn]) => {
    btn.classList.toggle('active', name === viewName);
    btn.setAttribute('aria-selected', String(name === viewName));
  });

  Object.entries(views).forEach(([name, panel]) => {
    panel.classList.toggle('active', name === viewName);
  });
}

function openEditor(cardId = null) {
  editingId = cardId;
  const card = state.cards.find((c) => c.id === cardId);

  dialogTitle.textContent = card ? 'Edit Card' : 'New Card';
  titleInput.value = card?.title || '';
  descInput.value = card?.description || '';
  draftChecklist = card ? card.checklist.map((i) => ({ ...i })) : [];
  renderChecklistEditor();

  if (typeof dialog.showModal === 'function') dialog.showModal();
}

function closeEditor() {
  form.reset();
  editChecklist.innerHTML = '';
  editingId = null;
  draftChecklist = [];
  dialog.close();
}

function renderChecklistEditor() {
  editChecklist.innerHTML = '';
  draftChecklist.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'edit-item';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = item.text;
    input.placeholder = 'Checklist item';
    input.addEventListener('input', () => {
      draftChecklist[idx].text = input.value;
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      draftChecklist.splice(idx, 1);
      renderChecklistEditor();
    });

    row.append(input, remove);
    editChecklist.append(row);
  });
}

function findColumnFromPoint(x, y) {
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  return hit.closest('.column');
}

function updateTouchDropTarget(column) {
  document.querySelectorAll('.column.drop-target').forEach((el) => el.classList.remove('drop-target'));
  if (column) column.classList.add('drop-target');
}

function cleanupTouchDrag() {
  if (!touchDrag) return;
  if (touchDrag.ghost?.parentNode) touchDrag.ghost.remove();
  touchDrag.node.classList.remove('touch-drag-source');
  updateTouchDropTarget(null);
  touchDrag = null;
}

function onTouchPointerDown(e) {
  if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
  if (e.button !== 0) return;
  if (e.target.closest('button, input, textarea, select, label, a')) return;

  const node = e.currentTarget;
  touchDrag = {
    pointerId: e.pointerId,
    cardId: node.dataset.id,
    node,
    startX: e.clientX,
    startY: e.clientY,
    active: false,
    ghost: null,
    targetColumn: null,
  };

  node.setPointerCapture(e.pointerId);
  node.addEventListener('pointermove', onTouchPointerMove);
  node.addEventListener('pointerup', onTouchPointerUp);
  node.addEventListener('pointercancel', onTouchPointerCancel);
}

function onTouchPointerMove(e) {
  if (!touchDrag || touchDrag.pointerId !== e.pointerId) return;

  const dx = e.clientX - touchDrag.startX;
  const dy = e.clientY - touchDrag.startY;
  const movedEnough = Math.hypot(dx, dy) > 8;

  if (!touchDrag.active && movedEnough) {
    touchDrag.active = true;
    touchDrag.node.classList.add('touch-drag-source');

    const ghost = touchDrag.node.cloneNode(true);
    ghost.classList.add('touch-drag-ghost');
    ghost.removeAttribute('draggable');
    document.body.append(ghost);
    touchDrag.ghost = ghost;
  }

  if (!touchDrag.active) return;
  e.preventDefault();

  touchDrag.ghost.style.left = `${e.clientX}px`;
  touchDrag.ghost.style.top = `${e.clientY}px`;

  const column = findColumnFromPoint(e.clientX, e.clientY);
  touchDrag.targetColumn = column?.dataset.column || null;
  updateTouchDropTarget(column);
}

function finishTouchPointer(node) {
  node.removeEventListener('pointermove', onTouchPointerMove);
  node.removeEventListener('pointerup', onTouchPointerUp);
  node.removeEventListener('pointercancel', onTouchPointerCancel);
}

async function moveCardToColumn(cardId, targetColumn) {
  await api(`/api/cards/${cardId}/column`, {
    method: 'PATCH',
    body: JSON.stringify({ column: targetColumn }),
  });
  await loadCards();
}

async function onTouchPointerUp(e) {
  if (!touchDrag || touchDrag.pointerId !== e.pointerId) return;

  const { cardId, targetColumn, active, node } = touchDrag;
  finishTouchPointer(node);

  try {
    if (active && targetColumn) {
      await moveCardToColumn(cardId, targetColumn);
    }
  } catch (err) {
    alert(`Could not move card: ${err.message}`);
    await loadCards();
  }

  cleanupTouchDrag();
}

function onTouchPointerCancel(e) {
  if (!touchDrag || touchDrag.pointerId !== e.pointerId) return;
  finishTouchPointer(touchDrag.node);
  cleanupTouchDrag();
}

newCardBtn.addEventListener('click', () => openEditor());

tabButtons.board.addEventListener('click', () => setView('board'));
tabButtons.backlog.addEventListener('click', () => setView('backlog'));
tabButtons.history.addEventListener('click', () => setView('history'));

addItemBtn.addEventListener('click', () => {
  draftChecklist.push({ id: uid(), text: '', checked: false });
  renderChecklistEditor();
});

cancelBtn.addEventListener('click', closeEditor);

dialog.addEventListener('cancel', (e) => {
  e.preventDefault();
  closeEditor();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = titleInput.value.trim();
  if (!title) return;

  const description = descInput.value.trim();
  const checklist = draftChecklist
    .map((i) => ({ ...i, text: (i.text || '').trim() }))
    .filter((i) => i.text.length > 0);

  try {
    if (editingId) {
      await api(`/api/cards/${editingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title, description, checklist }),
      });
    } else {
      await api('/api/cards', {
        method: 'POST',
        body: JSON.stringify({ title, description, checklist, column: 'todo' }),
      });
    }

    await loadCards();
    closeEditor();
  } catch (err) {
    alert(`Could not save card: ${err.message}`);
  }
});

for (const column of document.querySelectorAll('.column')) {
  const targetColumn = column.dataset.column;
  column.addEventListener('dragover', (e) => {
    e.preventDefault();
    column.classList.add('drop-target');
  });
  column.addEventListener('dragleave', () => column.classList.remove('drop-target'));
  column.addEventListener('drop', async (e) => {
    e.preventDefault();
    column.classList.remove('drop-target');
    const draggingNode = document.querySelector('.card.dragging');
    if (!draggingNode) return;

    try {
      await moveCardToColumn(draggingNode.dataset.id, targetColumn);
    } catch (err) {
      alert(`Could not move card: ${err.message}`);
      await loadCards();
    }
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}

setView(activeView);
loadCards().catch((err) => {
  console.error(err);
  alert('Could not load board data from API.');
});
