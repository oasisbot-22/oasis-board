const STORAGE_KEY = 'oasis-board-v1';

const lists = {
  todo: document.getElementById('todoList'),
  doing: document.getElementById('doingList'),
  done: document.getElementById('doneList'),
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

let state = loadState();
let editingId = null;
let draftChecklist = [];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { cards: [] };
  try {
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.cards) ? parsed : { cards: [] };
  } catch {
    return { cards: [] };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function moveToDoneIfChecklistComplete(card) {
  if (!card.checklist.length) return;
  const allChecked = card.checklist.every(i => i.checked);
  if (allChecked) card.column = 'done';
}

function render() {
  Object.values(lists).forEach(list => (list.innerHTML = ''));

  for (const card of state.cards) {
    const node = cardTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = card.id;

    node.querySelector('.card-title').textContent = card.title;
    node.querySelector('.card-desc').textContent = card.description || '';

    const checklistEl = node.querySelector('.checklist');
    card.checklist.forEach(item => {
      const li = document.createElement('li');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = item.checked;
      cb.addEventListener('change', () => {
        item.checked = cb.checked;
        moveToDoneIfChecklistComplete(card);
        saveState();
        render();
      });

      const span = document.createElement('span');
      span.textContent = item.text;
      if (item.checked) span.classList.add('done');

      li.append(cb, span);
      checklistEl.append(li);
    });

    node.querySelector('.edit-btn').addEventListener('click', () => openEditor(card.id));

    const moveToggleBtn = node.querySelector('.move-toggle-btn');
    const moveMenu = node.querySelector('.move-menu');
    moveToggleBtn.addEventListener('click', () => {
      const isOpen = !moveMenu.hidden;
      moveMenu.hidden = isOpen;
      moveToggleBtn.setAttribute('aria-expanded', String(!isOpen));
    });

    moveMenu.querySelectorAll('button[data-move]').forEach(btn => {
      btn.addEventListener('click', () => {
        card.column = btn.dataset.move;
        moveToDoneIfChecklistComplete(card);
        saveState();
        render();
      });
    });

    node.addEventListener('dragstart', () => node.classList.add('dragging'));
    node.addEventListener('dragend', () => node.classList.remove('dragging'));

    lists[card.column].append(node);
  }
}

function openEditor(cardId = null) {
  editingId = cardId;
  const card = state.cards.find(c => c.id === cardId);

  dialogTitle.textContent = card ? 'Edit Card' : 'New Card';
  titleInput.value = card?.title || '';
  descInput.value = card?.description || '';
  draftChecklist = card ? card.checklist.map(i => ({ ...i })) : [];
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

newCardBtn.addEventListener('click', () => openEditor());

addItemBtn.addEventListener('click', () => {
  draftChecklist.push({ id: uid(), text: '', checked: false });
  renderChecklistEditor();
});

cancelBtn.addEventListener('click', closeEditor);

dialog.addEventListener('cancel', (e) => {
  e.preventDefault();
  closeEditor();
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const title = titleInput.value.trim();
  if (!title) return;

  const description = descInput.value.trim();
  const checklist = draftChecklist
    .map(i => ({ ...i, text: (i.text || '').trim() }))
    .filter(i => i.text.length > 0);

  if (editingId) {
    const card = state.cards.find(c => c.id === editingId);
    card.title = title;
    card.description = description;
    card.checklist = checklist;
    moveToDoneIfChecklistComplete(card);
  } else {
    const card = {
      id: uid(),
      title,
      description,
      checklist,
      column: 'todo',
    };
    moveToDoneIfChecklistComplete(card);
    state.cards.push(card);
  }

  saveState();
  render();
  closeEditor();
});

for (const column of document.querySelectorAll('.column')) {
  const targetColumn = column.dataset.column;
  column.addEventListener('dragover', (e) => {
    e.preventDefault();
    column.classList.add('drop-target');
  });
  column.addEventListener('dragleave', () => column.classList.remove('drop-target'));
  column.addEventListener('drop', (e) => {
    e.preventDefault();
    column.classList.remove('drop-target');
    const draggingNode = document.querySelector('.card.dragging');
    if (!draggingNode) return;
    const card = state.cards.find(c => c.id === draggingNode.dataset.id);
    if (!card) return;
    card.column = targetColumn;
    moveToDoneIfChecklistComplete(card);
    saveState();
    render();
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}

render();
