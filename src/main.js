import './style.css'

// Configuration
const CLIENT_ID = '797019706991-apjivfitf1u4pbfccaff5f8b331im9au.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const FILE_NAME = 'video_editing_tasks.json';

// State
let tokenClient;
let accessToken = null;
let driveFileId = null;
let tasks = [];
let userInfo = null;

// Columns definition
const COLUMNS = [
  { id: 'todo', title: '未着手', color: 'var(--status-todo)' },
  { id: 'rough', title: '初稿作成中', color: 'var(--status-rough)' },
  { id: 'review', title: '確認待ち', color: 'var(--status-review)' },
  { id: 'revision', title: '修正対応中', color: 'var(--status-revision)' },
  { id: 'done', title: '納品完了', color: 'var(--status-done)' }
];

// DOM Elements
const boardContainer = document.getElementById('board-container');
const btnLogin = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');
const userInfoEl = document.getElementById('user-info');
const userNameEl = document.getElementById('user-name');
const btnAddTask = document.getElementById('btn-add-task');
const modal = document.getElementById('task-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancel = document.getElementById('btn-cancel');
const taskForm = document.getElementById('task-form');
const btnDeleteTask = document.getElementById('btn-delete-task');
const toastContainer = document.getElementById('toast-container');

// Initialize
function init() {
  renderColumns();
  setupEventListeners();
  
  // Load GIS
  if (window.google) {
    initGsi();
  } else {
    // Wait for the script to load
    window.addEventListener('load', () => {
      setTimeout(initGsi, 500);
    });
  }
}

function initGsi() {
  try {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (tokenResponse) => {
        if (tokenResponse && tokenResponse.access_token) {
          accessToken = tokenResponse.access_token;
          onLoginSuccess();
        }
      },
    });
    
    // Check if token exists in session/local storage
    const savedToken = sessionStorage.getItem('gapi_token');
    if (savedToken) {
      accessToken = savedToken;
      onLoginSuccess();
    } else {
      btnLogin.style.display = 'inline-flex';
    }
  } catch (error) {
    console.error('Error initializing GSI:', error);
    showToast('認証の初期化に失敗しました。', 'error');
  }
}

// Authentication handlers
function handleLogin() {
  if (tokenClient) {
    tokenClient.requestAccessToken({prompt: 'consent'});
  }
}

function handleLogout() {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken, () => {
      accessToken = null;
      sessionStorage.removeItem('gapi_token');
      userInfo = null;
      tasks = [];
      driveFileId = null;
      
      btnLogin.style.display = 'inline-flex';
      userInfoEl.style.display = 'none';
      
      renderBoard();
      showToast('ログアウトしました');
    });
  }
}

async function onLoginSuccess() {
  sessionStorage.setItem('gapi_token', accessToken);
  btnLogin.style.display = 'none';
  userInfoEl.style.display = 'flex';
  
  userNameEl.textContent = 'Google Drive接続済';
  
  showToast('ログインしました。データを同期中...');
  await syncWithDrive();
}

// Google Drive API Integration
async function syncWithDrive() {
  try {
    if (!driveFileId) {
      // Find the file
      const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${FILE_NAME}' and trashed=false&spaces=drive`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      
      if (searchRes.status === 401) {
        handleLogout();
        showToast('セッションが切れました。再度ログインしてください。', 'error');
        return;
      }
      
      const searchData = await searchRes.json();
      
      if (searchData.files && searchData.files.length > 0) {
        driveFileId = searchData.files[0].id;
        await loadTasksFromDrive();
      } else {
        await createDriveFile();
      }
    } else {
      await loadTasksFromDrive();
    }
  } catch (error) {
    console.error('Drive Sync Error:', error);
    showToast('データの同期に失敗しました', 'error');
  }
}

async function loadTasksFromDrive() {
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    if (res.ok) {
      const data = await res.json();
      tasks = Array.isArray(data) ? data : [];
      renderBoard();
      showToast('データを読み込みました');
    }
  } catch (error) {
    console.error('Load Error:', error);
    tasks = [];
    renderBoard();
  }
}

async function createDriveFile() {
  try {
    const metadata = {
      name: FILE_NAME,
      mimeType: 'application/json'
    };
    
    const formData = new FormData();
    formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    formData.append('file', new Blob([JSON.stringify([])], { type: 'application/json' }));
    
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      body: formData
    });
    
    const data = await res.json();
    driveFileId = data.id;
    tasks = [];
    renderBoard();
    showToast('新しいデータファイルを作成しました');
  } catch (error) {
    console.error('Create File Error:', error);
  }
}

async function saveTasksToDrive() {
  if (!accessToken || !driveFileId) return;
  
  try {
    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(tasks)
    });
    
    if (!res.ok) throw new Error('Save failed');
  } catch (error) {
    console.error('Save Error:', error);
    showToast('保存に失敗しました', 'error');
  }
}

// UI Rendering
function renderColumns() {
  boardContainer.innerHTML = '';
  
  COLUMNS.forEach(col => {
    const columnEl = document.createElement('div');
    columnEl.className = 'column';
    columnEl.innerHTML = `
      <div class="column-header">
        <div class="column-title">
          <div class="status-dot" style="background-color: ${col.color}"></div>
          ${col.title}
        </div>
        <div class="column-count" id="count-${col.id}">0</div>
      </div>
      <div class="task-list" id="list-${col.id}" data-status="${col.id}"></div>
    `;
    boardContainer.appendChild(columnEl);
  });
  
  setupDragAndDrop();
}

function renderBoard() {
  COLUMNS.forEach(col => {
    const list = document.getElementById(`list-${col.id}`);
    if (list) list.innerHTML = '';
    const count = document.getElementById(`count-${col.id}`);
    if (count) count.textContent = '0';
  });
  
  const counts = {};
  COLUMNS.forEach(c => counts[c.id] = 0);
  
  const sortedTasks = [...tasks].sort((a, b) => {
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return new Date(a.deadline) - new Date(b.deadline);
  });
  
  sortedTasks.forEach(task => {
    const list = document.getElementById(`list-${task.status}`);
    if (list) {
      list.appendChild(createTaskElement(task));
      counts[task.status]++;
    }
  });
  
  Object.keys(counts).forEach(status => {
    const countEl = document.getElementById(`count-${status}`);
    if (countEl) countEl.textContent = counts[status];
  });
}

function createTaskElement(task) {
  const el = document.createElement('div');
  el.className = 'task-card';
  el.draggable = true;
  el.dataset.id = task.id;
  
  let dateHtml = '';
  if (task.deadline) {
    const deadline = new Date(task.deadline);
    const today = new Date();
    today.setHours(0,0,0,0);
    const deadlineDate = new Date(deadline);
    deadlineDate.setHours(0,0,0,0);
    
    const diffTime = deadlineDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    let deadlineStatus = '';
    let statusClass = '';
    
    if (task.status === 'done') {
      deadlineStatus = '完了';
    } else if (diffDays < 0) {
      deadlineStatus = `期限超過 (${Math.abs(diffDays)}日)`;
      statusClass = 'overdue';
    } else if (diffDays === 0) {
      deadlineStatus = '今日が期限';
      statusClass = 'today';
    } else if (diffDays <= 3) {
      deadlineStatus = `あと ${diffDays}日`;
      statusClass = 'warning';
    } else {
      deadlineStatus = `あと ${diffDays}日`;
    }
    
    const formattedDate = `${deadline.getMonth()+1}/${deadline.getDate()}`;
    dateHtml = `
      <div class="task-deadline ${statusClass}">
        <i class="ph ph-clock"></i> ${formattedDate} <span class="deadline-badge">${deadlineStatus}</span>
      </div>
    `;
  }
  
  let linkHtml = '';
  if (task.link) {
    linkHtml = `
      <a href="${task.link}" target="_blank" class="task-link" title="素材・参照リンク" onclick="event.stopPropagation()">
        <i class="ph ph-link"></i>
      </a>
    `;
  }
  
  el.innerHTML = `
    <div class="task-title">${escapeHtml(task.title)}</div>
    ${task.client ? `<div class="task-client"><i class="ph ph-user"></i> ${escapeHtml(task.client)}</div>` : ''}
    <div class="task-meta">
      ${dateHtml}
      <div class="task-links">
        ${task.notes ? '<i class="ph ph-text-align-left" title="備考あり"></i>' : ''}
        ${linkHtml}
      </div>
    </div>
  `;
  
  el.addEventListener('click', () => openModal(task));
  
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', task.id);
    el.classList.add('dragging');
  });
  
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
  });
  
  return el;
}

// Drag and Drop
function setupDragAndDrop() {
  const lists = document.querySelectorAll('.task-list');
  
  lists.forEach(list => {
    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      list.classList.add('drag-over');
    });
    
    list.addEventListener('dragleave', () => {
      list.classList.remove('drag-over');
    });
    
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      list.classList.remove('drag-over');
      
      const taskId = e.dataTransfer.getData('text/plain');
      const newStatus = list.dataset.status;
      
      if (taskId && newStatus) {
        moveTask(taskId, newStatus);
      }
    });
  });
}

function moveTask(taskId, newStatus) {
  const taskIndex = tasks.findIndex(t => t.id === taskId);
  if (taskIndex !== -1 && tasks[taskIndex].status !== newStatus) {
    tasks[taskIndex].status = newStatus;
    renderBoard();
    saveTasksToDrive();
  }
}

// Modal handling
function openModal(task = null) {
  document.getElementById('task-id').value = task ? task.id : '';
  document.getElementById('task-title').value = task ? task.title : '';
  document.getElementById('task-client').value = task ? (task.client || '') : '';
  document.getElementById('task-deadline').value = task ? (task.deadline || '') : '';
  document.getElementById('task-status').value = task ? task.status : 'todo';
  document.getElementById('task-link').value = task ? (task.link || '') : '';
  document.getElementById('task-notes').value = task ? (task.notes || '') : '';
  
  document.getElementById('modal-title').textContent = task ? 'タスクを編集' : 'タスクを追加';
  btnDeleteTask.style.display = task ? 'block' : 'none';
  
  modal.style.display = 'flex';
}

function closeModal() {
  modal.style.display = 'none';
  taskForm.reset();
}

// Form Submission
function handleTaskSubmit(e) {
  e.preventDefault();
  
  const id = document.getElementById('task-id').value;
  const task = {
    id: id || Date.now().toString(),
    title: document.getElementById('task-title').value,
    client: document.getElementById('task-client').value,
    deadline: document.getElementById('task-deadline').value,
    status: document.getElementById('task-status').value,
    link: document.getElementById('task-link').value,
    notes: document.getElementById('task-notes').value,
    updatedAt: new Date().toISOString()
  };
  
  if (id) {
    const index = tasks.findIndex(t => t.id === id);
    if (index !== -1) tasks[index] = task;
  } else {
    task.createdAt = new Date().toISOString();
    tasks.push(task);
  }
  
  closeModal();
  renderBoard();
  saveTasksToDrive();
}

function handleDeleteTask() {
  const id = document.getElementById('task-id').value;
  if (id && confirm('このタスクを削除してもよろしいですか？')) {
    tasks = tasks.filter(t => t.id !== id);
    closeModal();
    renderBoard();
    saveTasksToDrive();
  }
}

// Utils
function escapeHtml(unsafe) {
  return (unsafe || '').replace(/[&<"'>]/g, function (m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m];
  });
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  
  setTimeout(() => {
    if (toastContainer.contains(toast)) {
      toastContainer.removeChild(toast);
    }
  }, 3300);
}

// Event Listeners
function setupEventListeners() {
  btnLogin.addEventListener('click', handleLogin);
  btnLogout.addEventListener('click', handleLogout);
  btnAddTask.addEventListener('click', () => openModal());
  btnCloseModal.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);
  taskForm.addEventListener('submit', handleTaskSubmit);
  btnDeleteTask.addEventListener('click', handleDeleteTask);
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
}

// Start app
init();
