/**
 * 輕重緩急四象限事務管理系統 (含便利貼、快速記帳、Firebase 跨裝置同步)
 */

// Firebase 設定物件 (使用者的專屬專案)
const firebaseConfig = {
  apiKey: "AIzaSyA3Q1GAx5AfHI72nWF-K6vMxUVfqnYFSrA",
  authDomain: "my-matrix-sync.firebaseapp.com",
  projectId: "my-matrix-sync",
  storageBucket: "my-matrix-sync.firebasestorage.app",
  messagingSenderId: "576540664279",
  appId: "1:576540664279:web:1fb40b22d93e1734c4eb92"
};

// 初始化 Firebase
let db = null;
let unsubscribeFirestore = null;
let isRemoteUpdating = false;

try {
  if (typeof firebase !== 'undefined') {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
  }
} catch (e) {
  console.warn('Firebase init error:', e);
}

// 取得今天 YYYY-MM-DD
function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 取得當前月份 YYYY-MM
function getCurrentMonthString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

// 輔助工具：日期計算
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// 記帳類別常數定義 (使用者指定之分類)
const ACCOUNTING_CATEGORIES = {
  expense: [
    { group: '飲食', items: ['早餐', '午餐', '晚餐', '飲料', '零食'] },
    { group: '交通', items: ['通勤', '加油', '停車', '計程車'] },
    { group: '居住', items: ['房租', '水電費', '網路', '管理費'] },
    { group: '日用品', items: ['日用品'] },
    { group: '服飾美容', items: ['衣服', '鞋子', '理髮', '保養品'] },
    { group: '娛樂社交', items: ['聚餐', '電影', '遊戲', '訂閱'] },
    { group: '醫療保健', items: ['看診', '藥品', '保健食品'] },
    { group: '教育學習', items: ['書籍', '課程', '考試費用'] }
  ],
  income: [
    { group: '薪水', items: ['薪水'] },
    { group: '獎金', items: ['年終獎金', '績效獎金', '三節獎金'] },
    { group: '副業', items: ['兼職', '接案收入'] },
    { group: '其他收入', items: ['利息', '退款', '中獎'] }
  ]
};

// 狀態管理物件
const state = {
  syncKey: localStorage.getItem('matrix_sync_key') || '',
  urgentDaysThreshold: parseInt(localStorage.getItem('matrix_urgent_days') || '3', 10),
  tasks: JSON.parse(localStorage.getItem('matrix_tasks_v2')) || [
    { id: '1', title: '完成專案期末審查報告', dueDate: getTodayDateString(), importance: 'important' },
    { id: '2', title: '研讀系統架構設計書籍', dueDate: addDays(getTodayDateString(), 14), importance: 'important' },
    { id: '3', title: '廠商催促確認急件單據', dueDate: addDays(getTodayDateString(), 1), importance: 'not_important' },
    { id: '4', title: '整理電腦暫存過期文檔', dueDate: addDays(getTodayDateString(), 20), importance: 'not_important' }
  ],
  shoppingList: JSON.parse(localStorage.getItem('matrix_shopping_v2')) || [
    { id: 's1', name: '全脂鮮奶 2 瓶', done: false },
    { id: 's2', name: 'A4 列印紙一包', done: true }
  ],
  completedTasks: JSON.parse(localStorage.getItem('matrix_completed_v2')) || [
    { id: 'c1', title: '繳納本月水電帳單', completedAt: getTodayDateString(), importance: 'important', originalDueDate: getTodayDateString() }
  ],
  notes: JSON.parse(localStorage.getItem('matrix_notes_v2')) || [
    { id: 'n1', content: '記得詢問會計發票作廢流程', createdAt: getTodayDateString() }
  ],
  accountingRecords: JSON.parse(localStorage.getItem('matrix_accounting_v2')) || [
    { id: 'a1', type: 'expense', amount: 120, category: '午餐', title: '排骨便當', date: getTodayDateString() }
  ],
  accMonthFilter: getCurrentMonthString(),
  selectedTaskIds: new Set(),
  selectedRestoreIds: new Set(),
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(),
  selectedDateStr: getTodayDateString(),
  gcalClientId: localStorage.getItem('matrix_gcal_client_id') || '642486535439-f1l8au5k6t70m2d8h8bvn78b4g97vcpv.apps.googleusercontent.com',
  gcalToken: localStorage.getItem('matrix_gcal_token') || null,
  gcalTokenExpiry: parseInt(localStorage.getItem('matrix_gcal_token_expiry') || '0', 10),
  gcalEvents: [] // 快取 Google 日曆行程
};

// 判定是否為緊急：完成日期 <= 今天 + 緊急天數
function isUrgent(dueDateStr, thresholdDays) {
  if (!dueDateStr) return false;
  const today = new Date(getTodayDateString());
  const due = new Date(dueDateStr);
  const diffTime = due.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays <= thresholdDays;
}

// 根據重要度與緊急程度決定象限識別碼
function resolveQuadrant(importance, isUrgentStatus) {
  if (isUrgentStatus && importance === 'important') return 'urgent-important';       // 左上
  if (isUrgentStatus && importance === 'not_important') return 'urgent-not-important'; // 右上
  if (!isUrgentStatus && importance === 'important') return 'not-urgent-important';    // 左下
  return 'not-urgent-not-important';                                                  // 右下
}

// 儲存資料（本地 localStorage + 雲端 Firestore）
function persistState() {
  localStorage.setItem('matrix_urgent_days', state.urgentDaysThreshold.toString());
  localStorage.setItem('matrix_tasks_v2', JSON.stringify(state.tasks));
  localStorage.setItem('matrix_shopping_v2', JSON.stringify(state.shoppingList));
  localStorage.setItem('matrix_completed_v2', JSON.stringify(state.completedTasks));
  localStorage.setItem('matrix_notes_v2', JSON.stringify(state.notes));
  localStorage.setItem('matrix_accounting_v2', JSON.stringify(state.accountingRecords));

  // 如果已啟用雲端金鑰，同步至雲端
  if (db && state.syncKey && !isRemoteUpdating) {
    db.collection('matrix_sync').doc(state.syncKey).set({
      urgentDaysThreshold: state.urgentDaysThreshold,
      tasks: state.tasks,
      shoppingList: state.shoppingList,
      completedTasks: state.completedTasks,
      notes: state.notes,
      accountingRecords: state.accountingRecords,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(err => {
      console.error('雲端同步失敗:', err);
    });
  }
}

// 監聽並綁定雲端即時同步
function bindCloudSync() {
  if (unsubscribeFirestore) {
    unsubscribeFirestore();
    unsubscribeFirestore = null;
  }

  const syncStatusDot = document.getElementById('sync-status-dot');
  const syncStatusText = document.getElementById('sync-status-text');

  if (!db || !state.syncKey) {
    syncStatusDot.classList.remove('connected');
    syncStatusText.textContent = '未設金鑰 (單機)';
    return;
  }

  syncStatusText.textContent = `同步中: ${state.syncKey}`;
  syncStatusDot.classList.add('connected');

  // 即時監聽 Firestore 文檔變化
  unsubscribeFirestore = db.collection('matrix_sync').doc(state.syncKey)
    .onSnapshot(doc => {
      if (doc.exists) {
        const data = doc.data();
        isRemoteUpdating = true;

        if (Array.isArray(data.tasks)) state.tasks = data.tasks;
        if (Array.isArray(data.shoppingList)) state.shoppingList = data.shoppingList;
        if (Array.isArray(data.completedTasks)) state.completedTasks = data.completedTasks;
        if (Array.isArray(data.notes)) state.notes = data.notes;
        if (Array.isArray(data.accountingRecords)) state.accountingRecords = data.accountingRecords;

        if (typeof data.urgentDaysThreshold === 'number') {
          state.urgentDaysThreshold = data.urgentDaysThreshold;
          urgentDaysInput.value = state.urgentDaysThreshold;
        }

        // 保存到本機備份
        localStorage.setItem('matrix_urgent_days', state.urgentDaysThreshold.toString());
        localStorage.setItem('matrix_tasks_v2', JSON.stringify(state.tasks));
        localStorage.setItem('matrix_shopping_v2', JSON.stringify(state.shoppingList));
        localStorage.setItem('matrix_completed_v2', JSON.stringify(state.completedTasks));
        localStorage.setItem('matrix_notes_v2', JSON.stringify(state.notes));
        localStorage.setItem('matrix_accounting_v2', JSON.stringify(state.accountingRecords));

        renderAll();
        isRemoteUpdating = false;
      } else {
        persistState();
      }
    }, err => {
      console.error('監聽雲端出錯:', err);
      syncStatusDot.classList.remove('connected');
      syncStatusText.textContent = '連線異常';
    });
}

// === DOM 元素綁定 ===
const btnSyncKey = document.getElementById('btn-sync-key');
const btnInstructions = document.getElementById('btn-instructions');
const modalInstructions = document.getElementById('modal-instructions');
const btnCloseInstructions = document.getElementById('btn-close-instructions');
const btnCloseInstructionsX = document.getElementById('btn-close-instructions-x');
const btnModalSetKey = document.getElementById('btn-modal-set-key');
const urgentDaysInput = document.getElementById('setting-urgent-days');
const newTaskForm = document.getElementById('new-task-form');
const inputTaskTitle = document.getElementById('input-task-title');
const inputTaskDate = document.getElementById('input-task-date');
const inputTaskTime = document.getElementById('input-task-time');
const inputTaskImportance = document.getElementById('input-task-importance');

const btnBatchComplete = document.getElementById('btn-batch-complete');
const selectedTasksCountEl = document.getElementById('selected-tasks-count');

const btnBatchRestore = document.getElementById('btn-batch-restore');
const btnClearCompleted = document.getElementById('btn-clear-completed');
const selectedCompletedCountEl = document.getElementById('selected-completed-count');
const completedListEl = document.getElementById('completed-list');

const shoppingForm = document.getElementById('shopping-form');
const shoppingInput = document.getElementById('shopping-input');
const shoppingListEl = document.getElementById('shopping-list');
const shoppingCountEl = document.getElementById('shopping-count');
const btnClearDoneShopping = document.getElementById('btn-clear-done-shopping');

const calendarDaysEl = document.getElementById('calendar-days');
const currentMonthYearEl = document.getElementById('current-month-year');
const selectedDateStrEl = document.getElementById('selected-date-str');
const dayEventsListEl = document.getElementById('day-events-list');

// Google Calendar 元素
const gcalStatusDot = document.getElementById('gcal-status-dot');
const gcalStatusText = document.getElementById('gcal-status-text');
const btnGcalAuth = document.getElementById('btn-gcal-auth');
const btnGcalSettings = document.getElementById('btn-gcal-settings');
const btnRefreshGcal = document.getElementById('btn-refresh-gcal');
const modalGcalSettings = document.getElementById('modal-gcal-settings');
const inputGcalClientId = document.getElementById('input-gcal-client-id');
const btnSaveGcalSettings = document.getElementById('btn-save-gcal-settings');
const btnCancelGcalSettings = document.getElementById('btn-cancel-gcal-settings');
const btnCloseGcalModal = document.getElementById('btn-close-gcal-modal');

// 便利貼元素
const noteForm = document.getElementById('note-form');
const noteInput = document.getElementById('note-input');
const notesContainer = document.getElementById('notes-container');
const notesCountEl = document.getElementById('notes-count');

// 記帳元素
const accMonthFilter = document.getElementById('acc-month-filter');
const monthExpenseTotalEl = document.getElementById('month-expense-total');
const monthIncomeTotalEl = document.getElementById('month-income-total');
const monthBalanceTotalEl = document.getElementById('month-balance-total');
const accForm = document.getElementById('acc-form');
const accAmountInput = document.getElementById('acc-amount');
const accDateInput = document.getElementById('acc-date');
const accCategorySelect = document.getElementById('acc-category');
const accTitleInput = document.getElementById('acc-title');
const accRecordsListEl = document.getElementById('acc-records-list');
const accRecordsCountEl = document.getElementById('acc-records-count');

// === 初始化 ===
document.addEventListener('DOMContentLoaded', () => {
  urgentDaysInput.value = state.urgentDaysThreshold;
  inputTaskDate.value = getTodayDateString();
  accDateInput.value = getTodayDateString();
  accMonthFilter.value = state.accMonthFilter;

  updateAccountingCategoryOptions('expense');
  renderAll();
  bindEvents();
  initMobileView();
  bindCloudSync();
  initGoogleCalendar();
  initInstructionsModal();
});

function renderAll() {
  renderMatrix();
  renderShoppingList();
  renderNotes();
  renderAccounting();
  renderCompletedList();
  renderCalendar();
}

// 雲端金鑰彈窗設定
function promptSetSyncKey() {
  const currentKey = state.syncKey || '';
  const inputKey = prompt('請輸入您的專屬同步金鑰（高強度密碼）：\n所有裝置輸入相同金鑰即可跨裝置自動同步，避免他人猜到。', currentKey);
  
  if (inputKey !== null) {
    const trimmed = inputKey.trim();
    state.syncKey = trimmed;
    localStorage.setItem('matrix_sync_key', trimmed);
    bindCloudSync();
    if (trimmed) {
      alert(`已綁定金鑰：「${trimmed}」！您的資料將與所有使用此金鑰的裝置即時連線。`);
      if (modalInstructions) modalInstructions.style.display = 'none';
    } else {
      alert('已切換為單機離線模式。');
    }
  }
}

btnSyncKey.addEventListener('click', promptSetSyncKey);

// === 系統使用須知模組 ===
function initInstructionsModal() {
  // 1. 若使用者未設定金鑰，強制跳出使用須知
  if (!state.syncKey) {
    modalInstructions.style.display = 'flex';
  }

  // 2. 點擊頂端「📖 使用須知」按鈕隨時開啟
  btnInstructions.addEventListener('click', () => {
    modalInstructions.style.display = 'flex';
  });

  // 3. 關閉彈窗
  const closeInstructions = () => {
    modalInstructions.style.display = 'none';
  };
  btnCloseInstructions.addEventListener('click', closeInstructions);
  btnCloseInstructionsX.addEventListener('click', closeInstructions);

  // 4. 點擊彈窗內「立即設定金鑰」
  btnModalSetKey.addEventListener('click', () => {
    promptSetSyncKey();
  });
}

// === 1. 渲染四象限 ===
function renderMatrix() {
  const quadrants = [
    'urgent-important',
    'urgent-not-important',
    'not-urgent-important',
    'not-urgent-not-important'
  ];

  const counts = {
    'urgent-important': 0,
    'urgent-not-important': 0,
    'not-urgent-important': 0,
    'not-urgent-not-important': 0
  };

  quadrants.forEach(q => {
    document.getElementById(`list-${q}`).innerHTML = '';
  });

  // 根據完成日期自動排序：越早到期的排在越前面 (升冪排序)
  const sortedTasks = [...state.tasks].sort((a, b) => {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  sortedTasks.forEach(task => {
    const urgent = isUrgent(task.dueDate, state.urgentDaysThreshold);
    const qKey = resolveQuadrant(task.importance, urgent);
    counts[qKey]++;

    const card = document.createElement('div');
    card.className = 'task-card';

    const isChecked = state.selectedTaskIds.has(task.id);

    card.innerHTML = `
      <div class="task-left">
        <input type="checkbox" class="task-checkbox" data-id="${task.id}" ${isChecked ? 'checked' : ''}>
        <div class="task-info">
          <span class="task-title">${escapeHtml(task.title)}</span>
          <div class="task-meta-row">
            <span class="task-due ${urgent ? 'is-urgent' : ''}">📅 截止：${task.dueDate} ${urgent ? '⚠️ 緊急' : ''}</span>
            ${task.reminderTime ? `<span class="task-reminder-badge">⏰ 提醒：${escapeHtml(task.reminderTime)}</span>` : ''}
          </div>
        </div>
      </div>
      <button class="task-del-btn" data-id="${task.id}" title="直接刪除">🗑️</button>
    `;

    // 勾選框事件
    card.querySelector('.task-checkbox').addEventListener('change', (e) => {
      if (e.target.checked) {
        state.selectedTaskIds.add(task.id);
      } else {
        state.selectedTaskIds.delete(task.id);
      }
      updateBatchCompleteButton();
    });

    // 刪除按鈕
    card.querySelector('.task-del-btn').addEventListener('click', async () => {
      if (confirm(`確定要刪除「${task.title}」嗎？`)) {
        state.tasks = state.tasks.filter(t => t.id !== task.id);
        state.selectedTaskIds.delete(task.id);
        persistState();
        renderMatrix();
        renderCalendar();

        if (state.gcalToken) {
          await deleteTaskFromGoogleCalendar(task);
          fetchGoogleCalendarEvents();
        }
      }
    });

    document.getElementById(`list-${qKey}`).appendChild(card);
  });

  // 更新計數
  quadrants.forEach(q => {
    document.getElementById(`count-${q}`).textContent = counts[q];
  });

  updateBatchCompleteButton();
}

function updateBatchCompleteButton() {
  const count = state.selectedTaskIds.size;
  selectedTasksCountEl.textContent = count;
  btnBatchComplete.disabled = count === 0;
}

// 批次確認完成
btnBatchComplete.addEventListener('click', async () => {
  if (state.selectedTaskIds.size === 0) return;

  const completedList = [];
  const remainingTasks = [];
  state.tasks.forEach(task => {
    if (state.selectedTaskIds.has(task.id)) {
      completedList.push(task);
      state.completedTasks.unshift({
        id: task.id,
        title: task.title,
        importance: task.importance,
        originalDueDate: task.dueDate,
        reminderTime: task.reminderTime || '',
        completedAt: getTodayDateString(),
        gcalTaskId: task.gcalTaskId || null,
        gcalEventId: task.gcalEventId || null
      });
    } else {
      remainingTasks.push(task);
    }
  });

  state.tasks = remainingTasks;
  state.selectedTaskIds.clear();
  persistState();

  renderMatrix();
  renderCompletedList();
  renderCalendar();

  // 若有連線 Google 日曆，自動從 Google 日曆刪除已完成的事項
  if (state.gcalToken && completedList.length > 0) {
    for (const task of completedList) {
      await deleteTaskFromGoogleCalendar(task);
    }
    fetchGoogleCalendarEvents();
  }
});

// === 2. 上方使用者輸入與緊急天數偵測 ===
const checkAutoSyncGcal = document.getElementById('check-auto-sync-gcal');

newTaskForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = inputTaskTitle.value.trim();
  const dueDate = inputTaskDate.value;
  const reminderTime = inputTaskTime ? inputTaskTime.value : '';
  const importance = inputTaskImportance.value;

  if (!title || !dueDate) return;

  const newTask = {
    id: Date.now().toString(),
    title,
    dueDate,
    reminderTime: reminderTime || '',
    importance
  };

  state.tasks.push(newTask);
  inputTaskTitle.value = '';
  if (inputTaskTime) inputTaskTime.value = '';
  persistState();
  renderMatrix();
  renderCalendar();

  // 若使用者勾選了同步 Google 日曆且目前有連線 Token，自動發布至 Google Calendar
  if (checkAutoSyncGcal && checkAutoSyncGcal.checked && state.gcalToken) {
    await syncTaskToGoogleCalendar(newTask, false); // false 代表靜默模式，不跳 alert 打擾使用者
  }
});

// 緊急天數設定改變即時重算四象限
urgentDaysInput.addEventListener('input', (e) => {
  const val = parseInt(e.target.value, 10);
  if (!isNaN(val) && val >= 0) {
    state.urgentDaysThreshold = val;
    persistState();
    renderMatrix();
  }
});

// === 3. 購物清單模組 ===
shoppingForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = shoppingInput.value.trim();
  if (!name) return;

  state.shoppingList.push({
    id: 's_' + Date.now(),
    name,
    done: false
  });

  shoppingInput.value = '';
  persistState();
  renderShoppingList();
});

function renderShoppingList() {
  shoppingListEl.innerHTML = '';
  // 改為計算打勾（已完成/待清除）的項目數量
  const doneCount = state.shoppingList.filter(item => item.done).length;
  shoppingCountEl.textContent = `已選 ${doneCount}`;

  state.shoppingList.forEach(item => {
    const li = document.createElement('li');
    li.className = `check-list-item ${item.done ? 'done' : ''}`;
    li.innerHTML = `
      <div class="item-left">
        <input type="checkbox" ${item.done ? 'checked' : ''}>
        <span>${escapeHtml(item.name)}</span>
      </div>
      <button class="task-del-btn">×</button>
    `;

    li.querySelector('input').addEventListener('change', () => {
      item.done = !item.done;
      persistState();
      renderShoppingList();
    });

    li.querySelector('.task-del-btn').addEventListener('click', () => {
      state.shoppingList = state.shoppingList.filter(s => s.id !== item.id);
      persistState();
      renderShoppingList();
    });

    shoppingListEl.appendChild(li);
  });
}

// 購物清單：一鍵清除已完成勾選項目
btnClearDoneShopping.addEventListener('click', () => {
  const hasDoneItems = state.shoppingList.some(item => item.done);
  if (!hasDoneItems) return;

  state.shoppingList = state.shoppingList.filter(item => !item.done);
  persistState();
  renderShoppingList();
});

// === 4. 便利貼模組 (方案 B + 一鍵轉四象限) ===
noteForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const content = noteInput.value.trim();
  if (!content) return;

  state.notes.unshift({
    id: 'n_' + Date.now(),
    content,
    createdAt: getTodayDateString()
  });

  noteInput.value = '';
  persistState();
  renderNotes();
});

function renderNotes() {
  notesContainer.innerHTML = '';
  notesCountEl.textContent = state.notes.length;

  if (state.notes.length === 0) {
    notesContainer.innerHTML = '<div style="color:#94a3b8; font-size:0.8rem; text-align:center; padding:12px;">尚無便利貼筆記</div>';
    return;
  }

  state.notes.forEach(note => {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.innerHTML = `
      <div class="note-content">${escapeHtml(note.content)}</div>
      <div class="note-footer">
        <span>${note.createdAt}</span>
        <div class="note-actions">
          <button class="btn-convert-task" title="帶入上方事物說明轉換為四象限待辦">➡️ 轉待辦</button>
          <button class="task-del-btn delete-note" title="刪除便貼">🗑️</button>
        </div>
      </div>
    `;

    // 核心互動：轉為四象限待辦
    card.querySelector('.btn-convert-task').addEventListener('click', () => {
      inputTaskTitle.value = note.content;
      inputTaskTitle.focus();
      // 平滑滾動到輸入區
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    card.querySelector('.delete-note').addEventListener('click', () => {
      state.notes = state.notes.filter(n => n.id !== note.id);
      persistState();
      renderNotes();
    });

    notesContainer.appendChild(card);
  });
}

// === 5. 快速記帳模組 ===
// 動態產生類別選單
function updateAccountingCategoryOptions(type) {
  accCategorySelect.innerHTML = '<option value="其他">其他</option>';
  const categories = ACCOUNTING_CATEGORIES[type] || [];

  categories.forEach(groupObj => {
    const optgroup = document.createElement('optgroup');
    optgroup.label = groupObj.group;
    groupObj.items.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item;
      opt.textContent = item;
      optgroup.appendChild(opt);
    });
    accCategorySelect.appendChild(optgroup);
  });
}

// 切換支出/收入單選鈕時動態更新類別下拉選單
document.querySelectorAll('input[name="acc-type"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    updateAccountingCategoryOptions(e.target.value);
  });
});

// 月份篩選變動
accMonthFilter.addEventListener('change', (e) => {
  state.accMonthFilter = e.target.value;
  renderAccounting();
});

// 新增記帳紀錄
accForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const type = document.querySelector('input[name="acc-type"]:checked').value;
  const amount = parseFloat(accAmountInput.value);
  const date = accDateInput.value;
  const category = accCategorySelect.value || '其他';
  const title = accTitleInput.value.trim();

  if (isNaN(amount) || amount <= 0 || !date) return;

  state.accountingRecords.unshift({
    id: 'a_' + Date.now(),
    type,
    amount,
    date,
    category,
    title
  });

  accAmountInput.value = '';
  accTitleInput.value = '';
  accCategorySelect.value = '';

  // 若新增的月份跟目前過濾器不同，自動切換至該月份方便查看
  const recordMonth = date.substring(0, 7);
  if (state.accMonthFilter !== recordMonth) {
    state.accMonthFilter = recordMonth;
    accMonthFilter.value = recordMonth;
  }

  persistState();
  renderAccounting();
});

function renderAccounting() {
  accRecordsListEl.innerHTML = '';
  const currentMonth = state.accMonthFilter;

  // 過濾當月紀錄，並自動依「支出/收入日期」由新到舊排序 (降冪排序：最新的排最上面)
  const monthRecords = state.accountingRecords
    .filter(r => r.date && r.date.startsWith(currentMonth))
    .sort((a, b) => {
      // 1. 先比對日期 (最新日期在前)
      const dateComparison = b.date.localeCompare(a.date);
      if (dateComparison !== 0) return dateComparison;
      // 2. 若同一天，則比較建立時間戳 ID (最新建立在前)
      return b.id.localeCompare(a.id);
    });

  let totalExpense = 0;
  let totalIncome = 0;

  monthRecords.forEach(r => {
    if (r.type === 'expense') {
      totalExpense += r.amount;
    } else {
      totalIncome += r.amount;
    }

    const li = document.createElement('li');
    li.className = 'acc-record-item';
    const displayTitle = r.title || r.category || (r.type === 'expense' ? '一般支出' : '一般收入');
    const displaySub = `${r.date} ${r.category ? `• ${r.category}` : ''}`;

    li.innerHTML = `
      <div class="acc-record-left">
        <span class="acc-record-title">${escapeHtml(displayTitle)}</span>
        <span class="acc-record-sub">${escapeHtml(displaySub)}</span>
      </div>
      <div class="acc-record-right">
        <span class="acc-record-amount ${r.type}">
          ${r.type === 'expense' ? '-' : '+'}$${r.amount.toLocaleString()}
        </span>
        <button class="task-del-btn delete-acc">×</button>
      </div>
    `;

    li.querySelector('.delete-acc').addEventListener('click', () => {
      state.accountingRecords = state.accountingRecords.filter(item => item.id !== r.id);
      persistState();
      renderAccounting();
    });

    accRecordsListEl.appendChild(li);
  });

  // 更新統計數字
  monthExpenseTotalEl.textContent = `$${totalExpense.toLocaleString()}`;
  monthIncomeTotalEl.textContent = `$${totalIncome.toLocaleString()}`;
  const balance = totalIncome - totalExpense;
  monthBalanceTotalEl.textContent = `${balance >= 0 ? '+' : ''}$${balance.toLocaleString()}`;
  monthBalanceTotalEl.style.color = balance >= 0 ? 'var(--primary)' : '#dc2626';

  accRecordsCountEl.textContent = `${monthRecords.length} 筆`;

  if (monthRecords.length === 0) {
    accRecordsListEl.innerHTML = '<li style="color:#94a3b8; font-size:0.8rem; text-align:center; padding:12px;">本月份無記帳紀錄</li>';
  }
}

// === 6. 已完成清單 (勾選還原 + 上方確認更新 + 一鍵清理) ===
function renderCompletedList() {
  completedListEl.innerHTML = '';
  if (state.completedTasks.length === 0) {
    completedListEl.innerHTML = '<li style="color:#94a3b8; font-size:0.8rem; text-align:center;">暫無已完成紀錄</li>';
    updateBatchRestoreButton();
    return;
  }

  state.completedTasks.forEach(item => {
    const li = document.createElement('li');
    li.className = 'check-list-item done';
    const isChecked = state.selectedRestoreIds.has(item.id);

    li.innerHTML = `
      <div class="item-left">
        <input type="checkbox" class="restore-checkbox" data-id="${item.id}" ${isChecked ? 'checked' : ''}>
        <span>${escapeHtml(item.title)}</span>
      </div>
      <span style="font-size:0.75rem; color:#94a3b8;">${item.completedAt}</span>
    `;

    li.querySelector('.restore-checkbox').addEventListener('change', (e) => {
      if (e.target.checked) {
        state.selectedRestoreIds.add(item.id);
      } else {
        state.selectedRestoreIds.delete(item.id);
      }
      updateBatchRestoreButton();
    });

    completedListEl.appendChild(li);
  });

  updateBatchRestoreButton();
}

function updateBatchRestoreButton() {
  const count = state.selectedRestoreIds.size;
  selectedCompletedCountEl.textContent = count;
  btnBatchRestore.disabled = count === 0;
}

// 批次確認還原至四象限
btnBatchRestore.addEventListener('click', async () => {
  if (state.selectedRestoreIds.size === 0) return;

  const restoredTasks = [];
  const remainingCompleted = [];
  state.completedTasks.forEach(task => {
    if (state.selectedRestoreIds.has(task.id)) {
      const restored = {
        id: task.id,
        title: task.title,
        dueDate: task.originalDueDate || getTodayDateString(),
        reminderTime: task.reminderTime || '',
        importance: task.importance || 'important',
        gcalTaskId: task.gcalTaskId || null,
        gcalEventId: task.gcalEventId || null
      };
      state.tasks.push(restored);
      restoredTasks.push(restored);
    } else {
      remainingCompleted.push(task);
    }
  });

  state.completedTasks = remainingCompleted;
  state.selectedRestoreIds.clear();
  persistState();

  renderMatrix();
  renderCompletedList();
  renderCalendar();

  // 若已連線 Google，自動將還原的事項在 Google Tasks 恢復為未完成，或重新建立行程
  if (state.gcalToken && restoredTasks.length > 0) {
    for (const task of restoredTasks) {
      if (task.gcalTaskId) {
        // 將 Google Tasks 恢復成未完成
        try {
          await fetch(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${encodeURIComponent(task.gcalTaskId)}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${state.gcalToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: 'needsAction', completed: null })
          });
        } catch (e) {
          console.warn('恢復 Google Task 狀態失敗，重新建立:', e);
          await syncTaskToGoogleCalendar(task, false);
        }
      } else {
        await syncTaskToGoogleCalendar(task, false);
      }
    }
    fetchGoogleCalendarEvents();
  }
});

// 一鍵清空已完成清單
btnClearCompleted.addEventListener('click', () => {
  if (state.completedTasks.length === 0) return;
  if (confirm('確定要徹底清空所有已完成歷史紀錄嗎？')) {
    state.completedTasks = [];
    state.selectedRestoreIds.clear();
    persistState();
    renderCompletedList();
  }
});

// === 7. 月曆排程模組 ===
document.getElementById('prev-month').addEventListener('click', () => {
  state.calMonth--;
  if (state.calMonth < 0) {
    state.calMonth = 11;
    state.calYear--;
  }
  renderCalendar();
  if (state.gcalToken) {
    fetchGoogleCalendarEvents();
  }
});

document.getElementById('next-month').addEventListener('click', () => {
  state.calMonth++;
  if (state.calMonth > 11) {
    state.calMonth = 0;
    state.calYear++;
  }
  renderCalendar();
  if (state.gcalToken) {
    fetchGoogleCalendarEvents();
  }
});

function renderCalendar() {
  const year = state.calYear;
  const month = state.calMonth;
  currentMonthYearEl.textContent = `${year}年 ${month + 1}月`;

  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = getTodayDateString();

  calendarDaysEl.innerHTML = '';

  // 月初空格
  for (let i = 0; i < firstDayOfWeek; i++) {
    const blank = document.createElement('div');
    blank.style.aspectRatio = '1';
    calendarDaysEl.appendChild(blank);
  }

  // 繪製每日
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayEl = document.createElement('div');
    dayEl.className = 'cal-day';

    const numSpan = document.createElement('span');
    numSpan.className = 'cal-day-num';
    numSpan.textContent = d;
    dayEl.appendChild(numSpan);

    if (dateStr === todayStr) dayEl.classList.add('today');
    if (dateStr === state.selectedDateStr) dayEl.classList.add('selected');

    // 檢查此日期的四象限任務與統計各象限件數
    const dayTasks = state.tasks.filter(t => t.dueDate === dateStr);
    if (dayTasks.length > 0) {
      const blocksContainer = document.createElement('div');
      blocksContainer.className = 'cal-blocks-container';

      const qCounts = {
        'urgent-important': 0,
        'urgent-not-important': 0,
        'not-urgent-important': 0,
        'not-urgent-not-important': 0
      };

      dayTasks.forEach(t => {
        const urgent = isUrgent(t.dueDate, state.urgentDaysThreshold);
        const qKey = resolveQuadrant(t.importance, urgent);
        qCounts[qKey]++;
      });

      const qOrder = [
        'urgent-important',       // 紅
        'urgent-not-important',   // 黃
        'not-urgent-important',   // 藍
        'not-urgent-not-important'// 綠
      ];

      qOrder.forEach(qKey => {
        if (qCounts[qKey] > 0) {
          const badge = document.createElement('span');
          badge.className = 'cal-block-badge';
          badge.style.backgroundColor = getQuadrantColor(qKey);
          badge.textContent = qCounts[qKey];
          badge.title = `${qKey}: ${qCounts[qKey]} 件`;
          blocksContainer.appendChild(badge);
        }
      });

      dayEl.appendChild(blocksContainer);
    }

    // 檢查是否有 Google 日曆行程
    const hasGcal = state.gcalEvents.some(evt => {
      const evtDate = evt.start?.date || (evt.start?.dateTime ? evt.start.dateTime.split('T')[0] : '');
      return evtDate === dateStr;
    });

    if (hasGcal) {
      const gcalDot = document.createElement('span');
      gcalDot.className = 'gcal-day-dot';
      gcalDot.title = '有 Google 日曆行程';
      dayEl.appendChild(gcalDot);
    }

    dayEl.addEventListener('click', () => {
      state.selectedDateStr = dateStr;
      selectedDateStrEl.textContent = dateStr;
      renderCalendar();
      renderDayEvents(dateStr);
    });

    calendarDaysEl.appendChild(dayEl);
  }

  selectedDateStrEl.textContent = state.selectedDateStr;
  renderDayEvents(state.selectedDateStr);
}

function getQuadrantColor(qKey) {
  switch (qKey) {
    case 'urgent-important': return '#B70E00';
    case 'urgent-not-important': return '#B89B00';
    case 'not-urgent-important': return '#0C00B8';
    case 'not-urgent-not-important': return '#00B852';
    default: return '#64748b';
  }
}

function renderDayEvents(dateStr) {
  dayEventsListEl.innerHTML = '';
  const dayTasks = state.tasks.filter(t => t.dueDate === dateStr);
  const dayGcalEvents = state.gcalEvents.filter(evt => {
    const evtDate = evt.start?.date || (evt.start?.dateTime ? evt.start.dateTime.split('T')[0] : '');
    return evtDate === dateStr;
  });

  if (dayTasks.length === 0 && dayGcalEvents.length === 0) {
    dayEventsListEl.innerHTML = '<li style="color:#94a3b8; font-size:0.78rem;">此日無排程與日曆事項</li>';
    return;
  }

  // 用來追蹤已被比對合併的 Google 事件 ID
  const matchedGcalEventIds = new Set();

  // 1. 先顯示 Matrix 四象限任務（並比對 Google 日曆事件進行合併）
  dayTasks.forEach(t => {
    const urgent = isUrgent(t.dueDate, state.urgentDaysThreshold);
    const qKey = resolveQuadrant(t.importance, urgent);

    // 比對此待辦是否已在 Google 日曆存在（以名稱比對）
    const matchedGcal = dayGcalEvents.find(evt => {
      const summary = (evt.summary || '').trim();
      return summary === t.title.trim();
    });

    if (matchedGcal) {
      matchedGcalEventIds.add(matchedGcal.id);
    }

    const li = document.createElement('li');
    li.className = 'mini-list-item';
    li.innerHTML = `
      <div class="event-content">
        <span class="q-color-dot" style="background-color: ${getQuadrantColor(qKey)}" title="${qKey}"></span>
        <span title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</span>
      </div>
      <div class="event-actions">
        ${matchedGcal 
          ? `<span class="badge-synced" title="已同步至 Google 日曆">✓ 已同步</span>
             ${matchedGcal.htmlLink ? `<a href="${matchedGcal.htmlLink}" target="_blank" rel="noopener" class="btn-icon-subtle" title="在 Google 日曆開啟">🔗</a>` : ''}`
          : `<button class="btn-sync-gcal" title="同步新增至 Google 日曆" data-task-id="${t.id}">+Google</button>`
        }
      </div>
    `;

    // 點擊未同步的 +Google 按鈕
    const btnSync = li.querySelector('.btn-sync-gcal');
    if (btnSync) {
      btnSync.addEventListener('click', (e) => {
        e.stopPropagation();
        syncTaskToGoogleCalendar(t);
      });
    }

    dayEventsListEl.appendChild(li);
  });

  // 2. 顯示其餘非由 Matrix 產生的獨立 Google 日曆行程（避免重複）
  dayGcalEvents.forEach(evt => {
    if (matchedGcalEventIds.has(evt.id)) return; // 已合併，跳過

    const li = document.createElement('li');
    li.className = 'mini-list-item gcal-event';

    let timeLabel = '全天';
    if (evt.start?.dateTime) {
      const startTime = new Date(evt.start.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      timeLabel = startTime;
    }

    li.innerHTML = `
      <div class="event-content">
        <span class="event-time-badge">${timeLabel}</span>
        <span title="${escapeHtml(evt.summary || '未命名行程')}">🗓️ ${escapeHtml(evt.summary || '未命名行程')}</span>
      </div>
      ${evt.htmlLink ? `<a href="${evt.htmlLink}" target="_blank" rel="noopener" class="btn-icon-subtle" title="在 Google 日曆開啟">🔗</a>` : ''}
    `;
    dayEventsListEl.appendChild(li);
  });
}

// === 側邊欄切換 ===
function bindEvents() {
  document.querySelectorAll('.side-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.side-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.side-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

// === 手機端 RWD 切換 (Samsung M33) ===
function initMobileView() {
  const tabs = document.querySelectorAll('.q-tab');
  const quadrants = document.querySelectorAll('.quadrant');
  const viewToggleBtn = document.getElementById('view-toggle-btn');
  const appSidebar = document.getElementById('app-sidebar');

  if (window.innerWidth <= 768) {
    quadrants.forEach(q => q.classList.remove('mobile-active'));
    document.getElementById('quadrant-urgent-important').classList.add('mobile-active');
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const targetQ = tab.dataset.q;
      quadrants.forEach(q => {
        if (q.id === `quadrant-${targetQ}`) {
          q.classList.add('mobile-active');
        } else {
          q.classList.remove('mobile-active');
        }
      });
    });
  });

  viewToggleBtn.addEventListener('click', () => {
    appSidebar.classList.toggle('mobile-hidden');
    viewToggleBtn.textContent = appSidebar.classList.contains('mobile-hidden') ? '顯示側邊欄' : '隱藏側邊欄';
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

// ==========================================
// === 8. Google Calendar API 整合模組 ===
// ==========================================
let gcalTokenClient = null;

function initGoogleCalendar() {
  inputGcalClientId.value = state.gcalClientId || '';

  // 檢查既有的 Token 是否過期
  if (state.gcalToken && state.gcalTokenExpiry) {
    if (Date.now() > state.gcalTokenExpiry) {
      state.gcalToken = null;
      localStorage.removeItem('matrix_gcal_token');
      localStorage.removeItem('matrix_gcal_token_expiry');
    }
  }

  updateGcalUI();

  // 若 Token 依然有效，頁面載入時自動拉取當月行程
  if (state.gcalToken) {
    fetchGoogleCalendarEvents();
  } else if (localStorage.getItem('matrix_gcal_authorized') === 'true' && state.gcalClientId) {
    // 曾授權過但 Token 已過期/遺失，嘗試自動靜默重連
    autoReconnectGoogleCalendar();
  }

  // 監聽斷線後恢復連線 (Online)，自動重連
  window.addEventListener('online', () => {
    console.log('網路已恢復連線，嘗試自動重連 Google 日曆...');
    if (localStorage.getItem('matrix_gcal_authorized') === 'true' && state.gcalClientId) {
      autoReconnectGoogleCalendar();
    }
  });

  // 綁定事件
  btnGcalSettings.addEventListener('click', () => {
    inputGcalClientId.value = state.gcalClientId || '';
    modalGcalSettings.style.display = 'flex';
  });

  const closeModal = () => {
    modalGcalSettings.style.display = 'none';
  };
  btnCloseGcalModal.addEventListener('click', closeModal);
  btnCancelGcalSettings.addEventListener('click', closeModal);

  btnSaveGcalSettings.addEventListener('click', () => {
    const newId = inputGcalClientId.value.trim();
    state.gcalClientId = newId;
    localStorage.setItem('matrix_gcal_client_id', newId);
    closeModal();
    updateGcalUI();
    alert(newId ? 'Google Client ID 已儲存！請點擊「連線」開始授權。' : '已清除 Google Client ID。');
  });

  btnGcalAuth.addEventListener('click', () => {
    if (state.gcalToken) {
      if (confirm('確定要中斷與 Google 日曆的連線嗎？')) {
        disconnectGoogleCalendar();
      }
    } else {
      loginGoogleCalendar(true); // 使用者主動點擊，可提示視窗
    }
  });

  // 點擊月曆頂部 🔄 按鈕：重新整理並執行智慧增量補登未同步項目
  btnRefreshGcal.addEventListener('click', () => {
    if (state.gcalToken) {
      smartSyncMonthToGoogleCalendar();
    } else {
      alert('請先點擊「連線」登入 Google 日曆。');
    }
  });
}

// 自動靜默重連 Google 日曆 (免使用者重複點擊)
function autoReconnectGoogleCalendar() {
  if (!state.gcalClientId) return;
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
    setTimeout(autoReconnectGoogleCalendar, 1000);
    return;
  }
  loginGoogleCalendar(false); // 靜默模式
}

function updateGcalUI() {
  if (state.gcalToken) {
    gcalStatusDot.classList.add('connected');
    gcalStatusText.textContent = 'Google 日曆已連線';
    btnGcalAuth.textContent = '登出';
    btnGcalAuth.classList.remove('btn-primary');
    btnGcalAuth.classList.add('btn-secondary');
    btnRefreshGcal.style.display = 'inline-block';
  } else {
    gcalStatusDot.classList.remove('connected');
    gcalStatusText.textContent = state.gcalClientId ? '已設金鑰 (未連線)' : '日曆未連線';
    btnGcalAuth.textContent = '連線';
    btnGcalAuth.classList.remove('btn-secondary');
    btnGcalAuth.classList.add('btn-primary');
  }
}

function loginGoogleCalendar(isUserInitiated = true) {
  if (!state.gcalClientId) {
    if (isUserInitiated) {
      alert('請先點擊「⚙️ 設定」輸入您的 Google OAuth Client ID！');
      modalGcalSettings.style.display = 'flex';
    }
    return;
  }

  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
    if (isUserInitiated) {
      alert('Google Identity 服務載入中，請稍候重試。');
    }
    return;
  }

  try {
    gcalTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: state.gcalClientId,
      scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks',
      callback: (tokenResponse) => {
        if (tokenResponse.error) {
          console.error('Google 授權失敗:', tokenResponse);
          if (isUserInitiated) {
            alert(`授權失敗：${tokenResponse.error_description || tokenResponse.error}`);
          }
          return;
        }
        state.gcalToken = tokenResponse.access_token;
        const expiresInSec = tokenResponse.expires_in || 3599;
        state.gcalTokenExpiry = Date.now() + expiresInSec * 1000;
        localStorage.setItem('matrix_gcal_token', state.gcalToken);
        localStorage.setItem('matrix_gcal_token_expiry', state.gcalTokenExpiry.toString());
        localStorage.setItem('matrix_gcal_authorized', 'true');
        updateGcalUI();
        fetchGoogleCalendarEvents();
      }
    });

    // 授權請求
    gcalTokenClient.requestAccessToken({ prompt: isUserInitiated ? '' : 'none' });
  } catch (err) {
    console.error('初始化 Google 授權失敗:', err);
    if (isUserInitiated) {
      alert(`初始化失敗：${err.message || err}`);
    }
  }
}

function disconnectGoogleCalendar() {
  if (state.gcalToken && typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
    google.accounts.oauth2.revoke(state.gcalToken, () => {
      console.log('Google Token 已撤銷');
    });
  }
  state.gcalToken = null;
  state.gcalTokenExpiry = 0;
  localStorage.removeItem('matrix_gcal_token');
  localStorage.removeItem('matrix_gcal_token_expiry');
  localStorage.removeItem('matrix_gcal_authorized');
  state.gcalEvents = [];
  updateGcalUI();
  renderCalendar();
  renderDayEvents(state.selectedDateStr);
}

// 取得當前月曆檢視月份的所有行程
async function fetchGoogleCalendarEvents() {
  if (!state.gcalToken) return;

  const year = state.calYear;
  const month = state.calMonth;
  const timeMin = new Date(year, month, 1, 0, 0, 0).toISOString();
  const timeMax = new Date(year, month + 1, 0, 23, 59, 59).toISOString();

  btnRefreshGcal.textContent = '⏳';

  try {
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${state.gcalToken}`
      }
    });

    if (res.status === 401) {
      console.warn('Google Token 已過期，嘗試自動靜默重連...');
      autoReconnectGoogleCalendar();
      return;
    }

    if (!res.ok) {
      throw new Error(`Google Calendar API 回傳錯誤: ${res.status}`);
    }

    const data = await res.json();
    state.gcalEvents = data.items || [];
    renderCalendar();
    renderDayEvents(state.selectedDateStr);
  } catch (err) {
    console.error('載入 Google 行程失敗:', err);
  } finally {
    btnRefreshGcal.textContent = '🔄';
  }
}

// 點擊月曆 🔄 按鈕時觸發的「智慧增量補登」功能
async function smartSyncMonthToGoogleCalendar() {
  if (!state.gcalToken) return;

  btnRefreshGcal.textContent = '⏳';

  try {
    // 1. 先抓取最新行程
    await fetchGoogleCalendarEvents();

    // 2. 篩選當月且尚未登記到 Google 日曆的 PASS 待辦事項
    const currentMonthPrefix = `${state.calYear}-${String(state.calMonth + 1).padStart(2, '0')}`;
    const unpostedTasks = state.tasks.filter(t => {
      return t.dueDate && t.dueDate.startsWith(currentMonthPrefix) && !t.gcalEventId;
    });

    let newlySyncedCount = 0;
    for (const task of unpostedTasks) {
      const success = await syncTaskToGoogleCalendar(task, false);
      if (success) newlySyncedCount++;
    }

    if (newlySyncedCount > 0) {
      alert(`🔄 日曆已重新整理！本次已為您智慧補登 ${newlySyncedCount} 項尚未在 Google 日曆的事項。`);
      await fetchGoogleCalendarEvents();
    } else {
      alert('🔄 日曆已同步至最新狀態！當月所有待辦皆已在 Google 日曆中。');
    }
  } catch (err) {
    console.error('智慧增量同步失敗:', err);
    alert(`同步失敗：${err.message}`);
  } finally {
    btnRefreshGcal.textContent = '🔄';
  }
}

// 將 Matrix 四象限單項任務同步推送到 Google
// 1. 若未設定提醒時間 -> 建立為 Google 日曆中的「工作」(Google Tasks)，在日曆上顯示為可打勾的任務，不占據行事曆時間塊
// 2. 若有設定提醒時間 -> 建立為 Google 日曆中的「活動」(Calendar Event)，並設定到點彈窗提醒
async function syncTaskToGoogleCalendar(task, showNotice = true) {
  if (!state.gcalToken) {
    if (showNotice) {
      const wantLogin = confirm('尚未連線至 Google。是否現在連線？');
      if (wantLogin) {
        loginGoogleCalendar(true);
      }
    }
    return false;
  }

  const btn = document.querySelector(`.btn-sync-gcal[data-task-id="${task.id}"]`);
  if (btn) btn.textContent = '同步中...';

  const isReminderEvent = Boolean(task.reminderTime);

  try {
    if (!isReminderEvent) {
      // === 模式 A：無提醒時間 -> Google Tasks (工作) ===
      const taskDueISO = new Date(`${task.dueDate}T00:00:00Z`).toISOString();
      const taskPayload = {
        title: task.title,
        notes: `由個人行政秘書系統(PASS)建立。\n重要度：${task.importance === 'important' ? '⭐ 重要' : '☕ 不重要'}`,
        due: taskDueISO
      };

      const res = await fetch('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${state.gcalToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(taskPayload)
      });

      if (res.status === 401) {
        if (showNotice) alert('Google 授權已過期，正在嘗試自動重新連線...');
        autoReconnectGoogleCalendar();
        return false;
      }

      if (!res.ok) {
        console.warn('Google Tasks API 未回應或需權限，退回日曆全天事件建立');
        return await syncTaskAsAllDayEvent(task, showNotice);
      }

      const createdTask = await res.json();
      if (createdTask && createdTask.id) {
        task.gcalTaskId = createdTask.id;
        persistState();
      }
      if (showNotice) {
        alert(`成功同步至 Google 日曆「工作」：「${task.title}」！`);
      }
      fetchGoogleCalendarEvents();
      return true;

    } else {
      // === 模式 B：有提醒時間 -> Google Calendar Event (活動) ===
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei';
      const startDateTime = `${task.dueDate}T${task.reminderTime}:00`;
      
      const [h, m] = task.reminderTime.split(':').map(Number);
      let endH = h;
      let endM = m + 30;
      if (endM >= 60) {
        endH = (endH + 1) % 24;
        endM = endM - 60;
      }
      const endDateTime = `${task.dueDate}T${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00`;

      const eventPayload = {
        summary: task.title,
        description: `由個人行政秘書系統(PASS)建立。\n重要度：${task.importance === 'important' ? '⭐ 重要' : '☕ 不重要'}\n截止日：${task.dueDate}\n提醒時間：${task.reminderTime}`,
        start: { dateTime: startDateTime, timeZone: userTimezone },
        end: { dateTime: endDateTime, timeZone: userTimezone },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 0 } // 到點彈跳提醒
          ]
        }
      };

      const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${state.gcalToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(eventPayload)
      });

      if (res.status === 401) {
        if (showNotice) alert('Google 授權已過期，正在嘗試自動重新連線...');
        autoReconnectGoogleCalendar();
        return false;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error?.message || `HTTP ${res.status}`);
      }

      const createdEvent = await res.json();
      if (createdEvent && createdEvent.id) {
        task.gcalEventId = createdEvent.id;
        persistState();
      }
      if (showNotice) {
        alert(`成功同步至 Google 日曆「活動（含到期提醒）」：「${task.title}」！`);
      }
      fetchGoogleCalendarEvents();
      return true;
    }
  } catch (err) {
    console.error('同步至 Google 失敗:', err);
    if (showNotice) {
      alert(`同步至 Google 失敗：${err.message}`);
    }
    if (btn) btn.textContent = '+Google';
    return false;
  }
}

// 備援：全天日曆事件
async function syncTaskAsAllDayEvent(task, showNotice) {
  const eventPayload = {
    summary: `[PASS待辦] ${task.title}`,
    description: `由個人行政秘書系統(PASS)建立。\n重要度：${task.importance === 'important' ? '⭐ 重要' : '☕ 不重要'}\n截止日：${task.dueDate}`,
    transparency: 'transparent',
    start: { date: task.dueDate },
    end: { date: task.dueDate }
  };
  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${state.gcalToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(eventPayload)
  });
  if (res.ok) {
    const createdEvent = await res.json();
    task.gcalEventId = createdEvent.id;
    persistState();
    if (showNotice) alert(`成功同步至 Google 日曆待辦：「${task.title}」！`);
    fetchGoogleCalendarEvents();
    return true;
  }
  return false;
}

// 從 Google 日曆處理已完成或刪除的事項：
// 1. 若為 Google Task (工作) -> 標記為 completed 自動劃掉 (若刪除則 DELETE)
// 2. 若為 Google Event (活動) -> 刪除該活動
async function deleteTaskFromGoogleCalendar(task, markTaskCompleted = true) {
  if (!state.gcalToken) return;

  // 1. 處理 Google Task (工作)
  if (task.gcalTaskId) {
    try {
      if (markTaskCompleted) {
        // 在 Google Tasks 劃掉為已完成
        await fetch(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${encodeURIComponent(task.gcalTaskId)}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${state.gcalToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ status: 'completed' })
        });
        console.log(`Google Tasks 工作已自動標記劃掉：「${task.title}」`);
      } else {
        // 直接刪除
        await fetch(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${encodeURIComponent(task.gcalTaskId)}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${state.gcalToken}` }
        });
      }
    } catch (e) {
      console.warn('更新 Google Task 狀態失敗:', e);
    }
  }

  // 2. 處理 Google Calendar Event (活動)
  let eventIdToDelete = task.gcalEventId;

  // 若事項未直接儲存 gcalEventId，則從當前快取的 gcalEvents 尋找相符標題與日期的事件
  if (!eventIdToDelete && state.gcalEvents && state.gcalEvents.length > 0) {
    const matched = state.gcalEvents.find(evt => {
      const summary = (evt.summary || '').trim();
      const evtDate = evt.start?.date || (evt.start?.dateTime ? evt.start.dateTime.split('T')[0] : '');
      return summary === task.title.trim() && evtDate === task.dueDate;
    });
    if (matched) {
      eventIdToDelete = matched.id;
    }
  }

  if (eventIdToDelete) {
    try {
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventIdToDelete)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${state.gcalToken}`
        }
      });

      if (res.status === 204 || res.status === 200) {
        console.log(`已成功從 Google 日曆刪除/消掉：「${task.title}」`);
      }
    } catch (err) {
      console.warn(`自 Google 日曆刪除事件失敗:`, err);
    }
  }
}
