import './style.css'

// Configuration
const CLIENT_ID = '797019706991-apjivfitf1u4pbfccaff5f8b331im9au.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/calendar.events';
const FOLDER_NAME = 'ApplicationData';
const FILE_NAME = 'taskData';

// State
let tokenClient;
let accessToken = null;
let driveFileId = null;
let tasks = [];
let userInfo = null;
let currentView = 'kanban';
let tableSort = { key: 'deadline', direction: 'asc' };
let filterConfig = { 
  text: '', 
  status: 'all',
  hideDone: false,
  deadlineFrom: '',
  deadlineTo: '',
  client: 'all'
};
let currentCalendarDate = new Date();
let externalGoogleEvents = []; // Cache for Google Calendar events
let lastFetchedMonth = null;

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
const tableContainer = document.getElementById('table-container');
const calendarContainer = document.getElementById('calendar-container');
const tableBody = document.getElementById('table-body');
const btnViews = document.querySelectorAll('.btn-view');
const btnLogin = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');
const userInfoEl = document.getElementById('user-info');
const userNameEl = document.getElementById('user-name');
const userAvatarEl = document.getElementById('user-avatar');
const btnAddTask = document.getElementById('btn-add-task');
const toolbar = document.getElementById('toolbar');
const filterText = document.getElementById('filter-text');
const filterStatus = document.getElementById('filter-status');
const modal = document.getElementById('task-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancel = document.getElementById('btn-cancel');
const taskForm = document.getElementById('task-form');
const btnDeleteTask = document.getElementById('btn-delete-task');
const toastContainer = document.getElementById('toast-container');
const calendarMonthYear = document.getElementById('calendar-month-year');
const calendarGrid = document.getElementById('calendar-grid');
const btnPrevMonth = document.getElementById('btn-prev-month');
const btnNextMonth = document.getElementById('btn-next-month');

// Advanced Filters
const btnToggleAdvancedFilter = document.getElementById('btn-toggle-advanced-filter');
const advancedFiltersPanel = document.getElementById('advanced-filters');
const filterHideDone = document.getElementById('filter-hide-done');
const filterDeadlineFrom = document.getElementById('filter-deadline-from');
const filterDeadlineTo = document.getElementById('filter-deadline-to');
const filterClient = document.getElementById('filter-client');
const btnExportCsv = document.getElementById('btn-export-csv');

// Initialize
function init() {
  const urlParams = new URLSearchParams(window.location.search);
  const isEmbedCalendar = urlParams.get('embed') === 'calendar';
  if (isEmbedCalendar) {
    currentView = 'calendar';
    const header = document.querySelector('.app-header');
    if (header) header.style.display = 'none';
    const fab = document.getElementById('btn-add-task');
    if (fab) fab.style.display = 'none';
    const tb = document.getElementById('toolbar');
    if (tb) tb.style.display = 'none';
  }

  renderColumns();
  setupEventListeners();
  
  // Initialize flatpickr for deadline and delivered at
  if (window.flatpickr) {
    flatpickr('#task-deadline', {
      locale: 'ja',
      dateFormat: 'Y-m-d'
    });
    flatpickr('#task-delivered-at', {
      locale: 'ja',
      dateFormat: 'Y-m-d'
    });
  }
  
  // Initialize calendar legend
  const legendContainer = document.getElementById('calendar-legend');
  if (legendContainer) {
    legendContainer.innerHTML = COLUMNS.map(col => `
      <div class="legend-item">
        <span class="status-dot" style="background-color: ${col.color}"></span>
        ${col.title}
      </div>
    `).join('');
  }
  
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
    
    // Check if token exists in URL or session/local storage
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    
    if (urlToken) {
      accessToken = urlToken;
      sessionStorage.setItem('gapi_token', urlToken);
      const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
      window.history.replaceState({path: newUrl}, '', newUrl);
      onLoginSuccess();
    } else {
      const savedToken = sessionStorage.getItem('gapi_token');
      if (savedToken) {
        accessToken = savedToken;
        onLoginSuccess();
      } else {
        btnLogin.style.display = 'inline-flex';
      }
    }
  } catch (error) {
    console.error('Error initializing GSI:', error);
    showToast('認証の初期化に失敗しました。', 'error');
  }
}

// Authentication handlers
function handleLogin() {
  if (tokenClient) {
    tokenClient.requestAccessToken();
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
      if (userAvatarEl) userAvatarEl.style.display = 'none';
      
      renderCurrentView();
      showToast('ログアウトしました');
    });
  }
}

async function onLoginSuccess() {
  sessionStorage.setItem('gapi_token', accessToken);
  btnLogin.style.display = 'none';
  userInfoEl.style.display = 'flex';
  
  userNameEl.textContent = 'Google Drive接続済';
  
  // Fetch user profile
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (res.ok) {
      const profile = await res.json();
      if (profile.name) {
        userNameEl.textContent = profile.name;
      }
      if (profile.picture && userAvatarEl) {
        userAvatarEl.src = profile.picture;
        userAvatarEl.style.display = 'block';
      }
    }
  } catch (err) {
    console.error('Failed to fetch user profile:', err);
  }
  
  await syncWithDrive();
}

// Google Drive API Integration
async function syncWithDrive() {
  try {
    if (!driveFileId) {
      // 1. Find or create the folder
      let folderId = null;
      const folderSearchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false&spaces=drive`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      
      if (!folderSearchRes.ok) {
        if (folderSearchRes.status === 401 || folderSearchRes.status === 403) {
          handleLogout();
          showToast('Google Driveのアクセス権限がありません。再度ログインし、Driveへのアクセスを許可してください。', 'error');
          return;
        }
        throw new Error('Failed to search folder');
      }
      
      const folderData = await folderSearchRes.json();
      if (folderData.files && folderData.files.length > 0) {
        folderId = folderData.files[0].id;
      } else {
        // Create folder
        const folderMetadata = {
          name: FOLDER_NAME,
          mimeType: 'application/vnd.google-apps.folder'
        };
        const createFolderRes = await fetch('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(folderMetadata)
        });
        const createdFolder = await createFolderRes.json();
        folderId = createdFolder.id;
      }

      // 2. Find the file inside the folder
      const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${FILE_NAME}' and '${folderId}' in parents and trashed=false&spaces=drive`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      
      if (!searchRes.ok) {
        throw new Error('Failed to search file');
      }
      const searchData = await searchRes.json();
      
      if (searchData.files && searchData.files.length > 0) {
        driveFileId = searchData.files[0].id;
        await loadTasksFromDrive();
      } else {
        await createDriveFile(folderId);
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
      const text = await res.text();
      try {
        const data = text ? JSON.parse(text) : [];
        tasks = Array.isArray(data) ? data : [];
        
        // Auto-sync existing tasks to calendar
        let needsSave = false;
        for (const task of tasks) {
          if (task.deadline && !task.googleCalendarEventId) {
            await syncTaskToCalendar(task);
            if (task.googleCalendarEventId) {
              needsSave = true;
            }
          }
        }
        if (needsSave) {
          saveTasksToDrive();
        }
      } catch (e) {
        console.error('Invalid JSON:', e);
        tasks = [];
      }
      renderCurrentView();
    }
  } catch (error) {
    console.error('Load Error:', error);
    tasks = [];
    renderCurrentView();
  }
}

async function createDriveFile(folderId) {
  try {
    const metadata = {
      name: FILE_NAME,
      mimeType: 'application/json',
      parents: [folderId]
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
    renderCurrentView();
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

// --- Google Calendar API Integration ---

async function syncTaskToCalendar(task) {
  if (!accessToken) return;
  
  if (!task.deadline) {
    if (task.googleCalendarEventId) {
      await deleteTaskFromCalendar(task.googleCalendarEventId);
      delete task.googleCalendarEventId;
    }
    return;
  }
  
  let description = '';
  if (task.client) description += `クライアント: ${task.client}\n`;
  if (task.link) description += `リンク: ${task.link}\n`;
  if (task.notes) description += `\n備考:\n${task.notes}`;
  
  let colorId = '9'; // Default: Blueberry (Blue)
  if (task.status === 'todo') colorId = '8'; // Graphite (Gray)
  else if (task.status === 'rough') colorId = '6'; // Tangerine (Orange/Yellow)
  else if (task.status === 'review') colorId = '9'; // Blueberry (Blue)
  else if (task.status === 'revision') colorId = '4'; // Flamingo (Pink)
  else if (task.status === 'done') colorId = '2'; // Sage (Light Green)
  
  const event = {
    summary: task.title,
    description: description.trim(),
    start: { date: task.deadline },
    end: { date: getNextDay(task.deadline) },
    colorId: colorId
  };
  
  try {
    if (task.googleCalendarEventId) {
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${task.googleCalendarEventId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event)
      });
      
      if (!res.ok) {
        if (res.status === 404 || res.status === 403) {
          delete task.googleCalendarEventId;
          await syncTaskToCalendar(task);
        } else {
          console.error('Failed to update calendar event');
        }
      }
    } else {
      const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event)
      });
      
      if (res.ok) {
        const data = await res.json();
        task.googleCalendarEventId = data.id;
      } else {
        console.error('Failed to create calendar event');
      }
    }
  } catch (error) {
    console.error('Calendar Sync Error:', error);
  }
}

async function deleteTaskFromCalendar(eventId) {
  if (!accessToken || !eventId) return;
  try {
    await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
  } catch (error) {
    console.error('Calendar Delete Error:', error);
  }
}

async function fetchGoogleCalendarEvents(year, month) {
  if (!accessToken) return;
  
  // Create ISO strings for start and end dates covering the visible grid
  const timeMin = new Date(year, month - 1, 20).toISOString();
  const timeMax = new Date(year, month + 1, 15).toISOString();
  
  try {
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    if (res.ok) {
      const data = await res.json();
      
      // Filter out tasks created by this app (they have googleCalendarEventId in our tasks array)
      const appTaskIds = new Set(tasks.map(t => t.googleCalendarEventId).filter(Boolean));
      
      externalGoogleEvents = data.items
        .filter(item => !appTaskIds.has(item.id))
        .map(item => {
          let dateStr = '';
          if (item.start.date) {
            dateStr = item.start.date;
          } else if (item.start.dateTime) {
            dateStr = item.start.dateTime.split('T')[0];
          }
          return {
            id: item.id,
            title: item.summary || '(タイトルなし)',
            date: dateStr,
            htmlLink: item.htmlLink
          };
        })
        .filter(item => item.date);
        
    } else {
      console.error('Failed to fetch external calendar events');
    }
  } catch (error) {
    console.error('Calendar Fetch Error:', error);
  }
}

function getNextDay(dateString) {
  const parts = dateString.split('-');
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  date.setDate(date.getDate() + 1);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

function renderCurrentView() {
  populateClientDropdown();
  
  boardContainer.style.display = 'none';
  tableContainer.style.display = 'none';
  calendarContainer.style.display = 'none';
  
  if (currentView === 'kanban') {
    boardContainer.style.display = 'flex';
    renderBoard();
  } else if (currentView === 'table') {
    tableContainer.style.display = 'block';
    renderTable();
  } else if (currentView === 'calendar') {
    calendarContainer.style.display = 'flex';
    renderCalendar();
  }
}

function getFilteredTasks() {
  return tasks.filter(task => {
    const text = filterConfig.text.toLowerCase();
    const matchText = !text || 
      (task.title && task.title.toLowerCase().includes(text)) || 
      (task.client && task.client.toLowerCase().includes(text));
      
    const matchStatus = filterConfig.status === 'all' || task.status === filterConfig.status;
    
    const matchHideDone = !filterConfig.hideDone || task.status !== 'done';
    
    let matchDeadlineFrom = true;
    let matchDeadlineTo = true;
    if (filterConfig.deadlineFrom && task.deadline) {
      matchDeadlineFrom = task.deadline >= filterConfig.deadlineFrom;
    }
    if (filterConfig.deadlineTo && task.deadline) {
      matchDeadlineTo = task.deadline <= filterConfig.deadlineTo;
    }
    const matchDeadline = matchDeadlineFrom && matchDeadlineTo;
    
    const matchClient = filterConfig.client === 'all' || task.client === filterConfig.client;

    return matchText && matchStatus && matchHideDone && matchDeadline && matchClient;
  });
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
  
  const now = new Date();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  const visibleTasks = tasks.filter(task => {
    // Hide 'done' tasks older than 7 days in Kanban view
    if (task.status === 'done') {
      const referenceTime = task.deliveredAt ? new Date(task.deliveredAt).getTime() : (task.updatedAt ? new Date(task.updatedAt).getTime() : 0);
      if (now.getTime() - referenceTime > SEVEN_DAYS_MS) {
        return false;
      }
    }
    return true;
  });

  const sortedTasks = [...visibleTasks].sort((a, b) => {
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

function renderTable() {
  if (!tableBody) return;
  tableBody.innerHTML = '';
  
  // Update header UI
  document.querySelectorAll('th.sortable').forEach(th => {
    th.classList.remove('active', 'desc');
    if (th.dataset.sort === tableSort.key) {
      th.classList.add('active');
      if (tableSort.direction === 'desc') {
        th.classList.add('desc');
      }
    }
  });
  
  const filteredTasks = getFilteredTasks();
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    let valA = a[tableSort.key];
    let valB = b[tableSort.key];

    if (tableSort.key === 'status') {
      const order = COLUMNS.map(c => c.id);
      valA = order.indexOf(a.status);
      valB = order.indexOf(b.status);
    } else if (tableSort.key === 'deadline') {
      valA = a.deadline ? new Date(a.deadline).getTime() : null;
      valB = b.deadline ? new Date(b.deadline).getTime() : null;
    } else if (tableSort.key === 'deliveredAt') {
      valA = a.deliveredAt ? new Date(a.deliveredAt).getTime() : null;
      valB = b.deliveredAt ? new Date(b.deliveredAt).getTime() : null;
    } else {
      valA = valA ? String(valA).toLowerCase() : '';
      valB = valB ? String(valB).toLowerCase() : '';
    }

    if ((valA === null || valA === '') && (valB !== null && valB !== '')) return 1;
    if ((valA !== null && valA !== '') && (valB === null || valB === '')) return -1;
    if (valA === valB) return 0;

    const result = valA < valB ? -1 : 1;
    return tableSort.direction === 'asc' ? result : -result;
  });
  
  sortedTasks.forEach(task => {
    const col = COLUMNS.find(c => c.id === task.status);
    const statusColor = col ? col.color : 'transparent';
    const statusTitle = col ? col.title : '不明';
    
    let deadlineHtml = '-';
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
      deadlineHtml = `
        <div class="task-deadline ${statusClass}">
          <i class="ph ph-clock"></i> ${formattedDate}
          <br><span class="deadline-badge" style="margin-top: 4px; display: inline-block;">${deadlineStatus}</span>
        </div>
      `;
    }
    
    let deliveredHtml = '-';
    if (task.deliveredAt) {
      const delDate = new Date(task.deliveredAt);
      deliveredHtml = `<div class="task-deadline"><i class="ph ph-check-circle" style="color: var(--status-done);"></i> ${delDate.getMonth()+1}/${delDate.getDate()}</div>`;
    }
    
    let actionsHtml = '';
    if (task.link) {
      actionsHtml += `<a href="${task.link}" target="_blank" class="task-link" title="素材・参照リンク" onclick="event.stopPropagation()"><i class="ph ph-link"></i></a>`;
    }
    if (task.notes) {
      actionsHtml += `<i class="ph ph-text-align-left" title="備考あり"></i>`;
    }
    
    const tr = document.createElement('tr');
    tr.dataset.id = task.id;
    tr.innerHTML = `
      <td>
        <div style="display: flex; align-items: center;">
          <span class="table-status-dot" style="background-color: ${statusColor}"></span>
          ${statusTitle}
        </div>
      </td>
      <td>
        <div class="table-title">${escapeHtml(task.title)}</div>
      </td>
      <td>${task.client ? `<div class="table-client">${escapeHtml(task.client)}</div>` : '-'}</td>
      <td>${deadlineHtml}</td>
      <td>${deliveredHtml}</td>
      <td>
        <div class="table-actions">
          ${actionsHtml || '-'}
        </div>
      </td>
    `;
    
    tr.addEventListener('click', () => openModal(task));
    tableBody.appendChild(tr);
  });
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
    
    list.addEventListener('drop', async (e) => {
      e.preventDefault();
      list.classList.remove('drag-over');
      
      const taskId = e.dataTransfer.getData('text/plain');
      const newStatus = list.dataset.status;
      
      if (taskId && newStatus) {
        await moveTask(taskId, newStatus);
      }
    });
  });
}

async function moveTask(taskId, newStatus) {
  const taskIndex = tasks.findIndex(t => t.id === taskId);
  if (taskIndex !== -1 && tasks[taskIndex].status !== newStatus) {
    tasks[taskIndex].status = newStatus;
    
    // Auto-fill deliveredAt when moved to 'done'
    if (newStatus === 'done' && !tasks[taskIndex].deliveredAt) {
      tasks[taskIndex].deliveredAt = new Date().toLocaleDateString('en-CA');
    }
    
    tasks[taskIndex].updatedAt = new Date().toISOString();
    
    await syncTaskToCalendar(tasks[taskIndex]);
    
    renderCurrentView();
    saveTasksToDrive();
  }
}

// Modal handling
function openModal(task = null) {
  document.getElementById('task-id').value = task ? task.id : '';
  document.getElementById('task-title').value = task ? task.title : '';
  document.getElementById('task-client').value = task ? (task.client || '') : '';
  
  const deadlineInput = document.getElementById('task-deadline');
  const deadlineValue = task ? (task.deadline || '') : '';
  deadlineInput.value = deadlineValue;
  if (deadlineInput._flatpickr) {
    deadlineInput._flatpickr.setDate(deadlineValue);
  }
  
  const deliveredInput = document.getElementById('task-delivered-at');
  const deliveredValue = task ? (task.deliveredAt || '') : '';
  deliveredInput.value = deliveredValue;
  if (deliveredInput._flatpickr) {
    deliveredInput._flatpickr.setDate(deliveredValue);
  }
  
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

async function handleTaskSubmit(e) {
  e.preventDefault();
  
  const id = document.getElementById('task-id').value;
  const task = {
    id: id || Date.now().toString(),
    title: document.getElementById('task-title').value,
    client: document.getElementById('task-client').value,
    deadline: document.getElementById('task-deadline').value,
    deliveredAt: document.getElementById('task-delivered-at').value,
    status: document.getElementById('task-status').value,
    link: document.getElementById('task-link').value,
    notes: document.getElementById('task-notes').value,
    updatedAt: new Date().toISOString()
  };
  
  if (id) {
    const index = tasks.findIndex(t => t.id === id);
    if (index !== -1) {
      task.googleCalendarEventId = tasks[index].googleCalendarEventId;
      tasks[index] = task;
    }
  } else {
    task.createdAt = new Date().toISOString();
    tasks.push(task);
  }
  
  await syncTaskToCalendar(task);
  
  closeModal();
  renderCurrentView();
  saveTasksToDrive();
}

async function handleDeleteTask() {
  const id = document.getElementById('task-id').value;
  if (id && confirm('このタスクを削除してもよろしいですか？')) {
    const taskToDelete = tasks.find(t => t.id === id);
    if (taskToDelete && taskToDelete.googleCalendarEventId) {
      await deleteTaskFromCalendar(taskToDelete.googleCalendarEventId);
    }
    tasks = tasks.filter(t => t.id !== id);
    closeModal();
    renderCurrentView();
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
  
  btnViews.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      currentView = view;
      
      btnViews.forEach(b => b.classList.toggle('active', b.dataset.view === view));
      
      if (view === 'kanban') {
        boardContainer.style.display = 'flex';
        tableContainer.style.display = 'none';
        calendarContainer.style.display = 'none';
        toolbar.style.display = 'none';
      } else if (view === 'table') {
        boardContainer.style.display = 'none';
        tableContainer.style.display = 'block';
        calendarContainer.style.display = 'none';
        toolbar.style.display = 'flex';
      } else if (view === 'calendar') {
        boardContainer.style.display = 'none';
        tableContainer.style.display = 'none';
        calendarContainer.style.display = 'flex';
        toolbar.style.display = 'flex'; // Allow filtering in calendar? No, toolbar is text filter. Let's hide it for now.
      }
      
      renderCurrentView();
    });
  });
  
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (tableSort.key === key) {
        tableSort.direction = tableSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        tableSort.key = key;
        tableSort.direction = 'asc';
      }
      renderTable();
    });
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  
  if (filterText) {
    filterText.addEventListener('input', (e) => {
      filterConfig.text = e.target.value;
      renderCurrentView();
    });
  }
  
  if (filterStatus) {
    filterStatus.addEventListener('change', (e) => {
      filterConfig.status = e.target.value;
      renderCurrentView();
    });
  }
  
  if (btnPrevMonth) {
    btnPrevMonth.addEventListener('click', () => {
      currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
      renderCalendar();
    });
  }
  
  if (btnNextMonth) {
    btnNextMonth.addEventListener('click', () => {
      currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
      renderCalendar();
    });
  }
  
  if (btnToggleAdvancedFilter) {
    btnToggleAdvancedFilter.addEventListener('click', () => {
      if (advancedFiltersPanel.style.display === 'none') {
        advancedFiltersPanel.style.display = 'flex';
        btnToggleAdvancedFilter.classList.add('active');
      } else {
        advancedFiltersPanel.style.display = 'none';
        btnToggleAdvancedFilter.classList.remove('active');
      }
    });
  }
  
  if (filterHideDone) {
    filterHideDone.addEventListener('change', (e) => {
      filterConfig.hideDone = e.target.checked;
      renderCurrentView();
    });
  }
  
  if (filterClient) {
    filterClient.addEventListener('change', (e) => {
      filterConfig.client = e.target.value;
      renderCurrentView();
    });
  }
  
  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', exportToCSV);
  }
  
  if (filterDeadlineFrom) {
    flatpickr(filterDeadlineFrom, {
      dateFormat: 'Y-m-d',
      onChange: function(selectedDates, dateStr) {
        filterConfig.deadlineFrom = dateStr;
        renderCurrentView();
      }
    });
  }
  
  if (filterDeadlineTo) {
    flatpickr(filterDeadlineTo, {
      dateFormat: 'Y-m-d',
      onChange: function(selectedDates, dateStr) {
        filterConfig.deadlineTo = dateStr;
        renderCurrentView();
      }
    });
  }
}

// Calendar Rendering & Logic
function renderCalendar() {
  calendarGrid.innerHTML = '';
  
  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();
  
  calendarMonthYear.textContent = `${year}年 ${month + 1}月`;
  
  const firstDay = new Date(year, month, 1).getDay(); // 0 (Sun) to 6 (Sat)
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();
  
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  
  const filteredTasks = getFilteredTasks();
  
  const currentMonthKey = `${year}-${month}`;
  if (lastFetchedMonth !== currentMonthKey) {
    lastFetchedMonth = currentMonthKey;
    fetchGoogleCalendarEvents(year, month).then(() => {
      if (currentView === 'calendar') {
        renderCalendar();
      }
    });
  }
  
  // Total cells in a grid (usually 42 for a 6-week view)
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  
  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day';
    
    let cellDate;
    let isCurrentMonthCell = false;
    
    if (i < firstDay) {
      // Previous month dates
      cellDate = new Date(year, month - 1, prevMonthDays - firstDay + i + 1);
      cell.classList.add('different-month');
    } else if (i >= firstDay && i < firstDay + daysInMonth) {
      // Current month dates
      cellDate = new Date(year, month, i - firstDay + 1);
      isCurrentMonthCell = true;
      if (isCurrentMonth && cellDate.getDate() === today.getDate()) {
        cell.classList.add('today');
      }
    } else {
      // Next month dates
      cellDate = new Date(year, month + 1, i - firstDay - daysInMonth + 1);
      cell.classList.add('different-month');
    }
    
    // YYYY-MM-DD for matching tasks
    const dateStr = cellDate.toLocaleDateString('en-CA'); // e.g. "2026-06-11"
    cell.dataset.date = dateStr;
    
    // Add date number
    const dateDiv = document.createElement('div');
    dateDiv.className = 'calendar-date';
    dateDiv.textContent = cellDate.getDate() + (isCurrentMonthCell ? '' : '');
    cell.appendChild(dateDiv);
    
    // Find tasks for this date
    const tasksForDay = filteredTasks.filter(task => task.deadline === dateStr);
    
    // Sort tasks by status or title if needed
    tasksForDay.forEach(task => {
      const taskEl = document.createElement('div');
      taskEl.className = 'calendar-task';
      taskEl.dataset.status = task.status;
      taskEl.draggable = true;
      taskEl.innerHTML = task.title + (task.deliveredAt ? ' <i class="ph ph-check-circle" style="color: var(--status-done);"></i>' : '');
      taskEl.title = task.title + (task.deliveredAt ? ' (納品済)' : '');
      
      taskEl.addEventListener('click', (e) => {
        e.stopPropagation();
        openModal(task);
      });
      
      taskEl.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', task.id);
        taskEl.classList.add('dragging');
      });
      
      taskEl.addEventListener('dragend', () => {
        taskEl.classList.remove('dragging');
      });
      
      cell.appendChild(taskEl);
    });
    
    // Render external Google Calendar events
    const externalForDay = externalGoogleEvents.filter(e => e.date === dateStr);
    externalForDay.forEach(e => {
      const el = document.createElement('div');
      el.className = 'calendar-event-external';
      el.title = e.title;
      el.innerHTML = `<i class="ph ph-calendar-blank"></i> ${escapeHtml(e.title)}`;
      if (e.htmlLink) {
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          window.open(e.htmlLink, '_blank');
        });
      }
      cell.appendChild(el);
    });
    
    // Drag over calendar day
    cell.addEventListener('dragover', (e) => {
      e.preventDefault();
      cell.classList.add('drag-over');
    });
    
    cell.addEventListener('dragleave', () => {
      cell.classList.remove('drag-over');
    });
    
    cell.addEventListener('drop', async (e) => {
      e.preventDefault();
      cell.classList.remove('drag-over');
      const taskId = e.dataTransfer.getData('text/plain');
      const newDate = cell.dataset.date;
      
      if (taskId && newDate) {
        const taskIndex = tasks.findIndex(t => t.id === taskId);
        if (taskIndex !== -1 && tasks[taskIndex].deadline !== newDate) {
          tasks[taskIndex].deadline = newDate;
          tasks[taskIndex].updatedAt = new Date().toISOString();
          await syncTaskToCalendar(tasks[taskIndex]);
          renderCurrentView();
          saveTasksToDrive();
        }
      }
    });
    
    // Click on empty day to add task
    cell.addEventListener('click', () => {
      openModal();
      document.getElementById('task-deadline').value = dateStr;
      if (document.getElementById('task-deadline')._flatpickr) {
        document.getElementById('task-deadline')._flatpickr.setDate(dateStr);
      }
    });
    
    calendarGrid.appendChild(cell);
  }
}

function populateClientDropdown() {
  if (!filterClient) return;
  const currentVal = filterClient.value;
  
  const clients = [...new Set(tasks.map(t => t.client).filter(c => c && c.trim() !== ''))].sort();
  
  filterClient.innerHTML = '<option value="all">すべて</option>';
  clients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    filterClient.appendChild(opt);
  });
  
  if (clients.includes(currentVal) || currentVal === 'all') {
    filterClient.value = currentVal;
  } else {
    filterConfig.client = 'all';
    filterClient.value = 'all';
  }
}

function exportToCSV() {
  const filtered = getFilteredTasks();
  if (filtered.length === 0) {
    showToast('エクスポートするデータがありません', 'error');
    return;
  }
  
  const headers = ['ステータス', '案件名/タイトル', 'クライアント', '納期', '納品完了日', '作成日'];
  const statusMap = {
    todo: '未着手',
    rough: '初稿作成中',
    review: '確認待ち',
    revision: '修正対応中',
    done: '納品完了'
  };
  
  const rows = filtered.map(t => {
    return [
      statusMap[t.status] || t.status,
      `"${(t.title || '').replace(/"/g, '""')}"`,
      `"${(t.client || '').replace(/"/g, '""')}"`,
      t.deadline || '',
      t.deliveredAt || '',
      new Date(t.createdAt).toLocaleDateString()
    ].join(',');
  });
  
  const csvContent = [headers.join(','), ...rows].join('\n');
  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `tasks_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showToast('CSVをエクスポートしました');
}

// Start app
init();
