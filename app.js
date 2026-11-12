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
const inputTaskImportance = document.getElementById('input-task-importance');
const inputTaskTime = document.getElementById('input-task-time');

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
const btnRefreshGcal = document.getElementById('btn-refresh-gcal');

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

// === 專屬高強度同步金鑰模組 ===
const modalSyncKey = document.getElementById('modal-sync-key');
const inputCustomSyncKey = document.getElementById('input-custom-sync-key');
const btnGenerateSafeKey = document.getElementById('btn-generate-safe-key');
const btnSaveSyncKey = document.getElementById('btn-save-sync-key');
const btnClearSyncKey = document.getElementById('btn-clear-sync-key');
const btnCancelSyncKey = document.getElementById('btn-cancel-sync-key');
const btnCloseSyncKeyX = document.getElementById('btn-close-sync-key-x');

const reqLenEl = document.getElementById('req-len');
const reqCharEl = document.getElementById('req-char');
const reqNoSpaceEl = document.getElementById('req-nospace');
const keyValidationMsgEl = document.getElementById('key-validation-message');

// 金鑰驗證規則
function validateSyncKey(key) {
  const isLenValid = key.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(key);
  const hasDigit = /[0-9]/.test(key);
  const isCharValid = hasLetter && hasDigit;
  // 禁止空白及非 ASCII（例如中文）
  const hasNoSpaceOrUnicode = !/\s/.test(key) && /^[\x20-\x7E]+$/.test(key);

  return {
    isLenValid,
    isCharValid,
    hasNoSpaceOrUnicode,
    isValid: isLenValid && isCharValid && hasNoSpaceOrUnicode
  };
}

// 更新即時指示燈
function updateKeyValidationUI(key) {
  if (!key) {
    reqLenEl.className = 'req-item';
    reqLenEl.querySelector('span').textContent = '⚪';
    reqCharEl.className = 'req-item';
    reqCharEl.querySelector('span').textContent = '⚪';
    reqNoSpaceEl.className = 'req-item';
    reqNoSpaceEl.querySelector('span').textContent = '⚪';
    keyValidationMsgEl.textContent = '';
    btnSaveSyncKey.disabled = true;
    return;
  }

  const res = validateSyncKey(key);

  reqLenEl.className = `req-item ${res.isLenValid ? 'valid' : 'invalid'}`;
  reqLenEl.querySelector('span').textContent = res.isLenValid ? '✅' : '❌';

  reqCharEl.className = `req-item ${res.isCharValid ? 'valid' : 'invalid'}`;
  reqCharEl.querySelector('span').textContent = res.isCharValid ? '✅' : '❌';

  reqNoSpaceEl.className = `req-item ${res.hasNoSpaceOrUnicode ? 'valid' : 'invalid'}`;
  reqNoSpaceEl.querySelector('span').textContent = res.hasNoSpaceOrUnicode ? '✅' : '❌';

  if (res.isValid) {
    keyValidationMsgEl.className = 'key-status-msg success';
    keyValidationMsgEl.textContent = '🔒 安全強度符合標準！可點擊確認綁定。';
    btnSaveSyncKey.disabled = false;
  } else {
    keyValidationMsgEl.className = 'key-status-msg error';
    keyValidationMsgEl.textContent = '⚠️ 請滿足上述所有安全標準';
    btnSaveSyncKey.disabled = true;
  }
}

// 隨機產生高強度安全金鑰 (保證至少包含英文大寫、小寫、數字與符號)
function generateSecureRandomKey() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*';
  const allChars = upper + lower + digits + symbols;

  // 確保四種字元至少各挑選 1 個
  let result = [
    upper.charAt(Math.floor(Math.random() * upper.length)),
    lower.charAt(Math.floor(Math.random() * lower.length)),
    digits.charAt(Math.floor(Math.random() * digits.length)),
    symbols.charAt(Math.floor(Math.random() * symbols.length))
  ];

  // 隨機補滿至 10 個字元
  for (let i = 4; i < 10; i++) {
    result.push(allChars.charAt(Math.floor(Math.random() * allChars.length)));
  }

  // 洗牌打亂順序
  result.sort(() => Math.random() - 0.5);

  return `Pass-${result.join('')}`;
}

// 開啟金鑰設定彈窗
function openSyncKeyModal() {
  inputCustomSyncKey.value = state.syncKey || '';
  updateKeyValidationUI(inputCustomSyncKey.value);
  modalSyncKey.style.display = 'flex';
}

function closeSyncKeyModal() {
  modalSyncKey.style.display = 'none';
}

// 綁定金鑰彈窗各按鈕事件
inputCustomSyncKey.addEventListener('input', (e) => {
  updateKeyValidationUI(e.target.value.trim());
});

btnGenerateSafeKey.addEventListener('click', () => {
  const safeKey = generateSecureRandomKey();
  inputCustomSyncKey.value = safeKey;
  updateKeyValidationUI(safeKey);
});

btnSaveSyncKey.addEventListener('click', () => {
  const key = inputCustomSyncKey.value.trim();
  const res = validateSyncKey(key);
  if (!res.isValid) return;

  state.syncKey = key;
  localStorage.setItem('matrix_sync_key', key);
  bindCloudSync();
  closeSyncKeyModal();
  if (modalInstructions) modalInstructions.style.display = 'none';
  alert(`✅ 成功綁定高強度金鑰：「${key}」！\n所有輸入此金鑰的裝置將即時跨端同步。`);
});

btnClearSyncKey.addEventListener('click', () => {
  if (confirm('確定要切換為單機模式嗎？將中斷跨裝置雲端同步。')) {
    state.syncKey = '';
    localStorage.removeItem('matrix_sync_key');
    bindCloudSync();
    closeSyncKeyModal();
    alert('已切換為單機離線模式。');
  }
});

btnCancelSyncKey.addEventListener('click', closeSyncKeyModal);
btnCloseSyncKeyX.addEventListener('click', closeSyncKeyModal);

btnSyncKey.addEventListener('click', openSyncKeyModal);

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
    openSyncKeyModal();
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
        syncType: task.syncType || (task.reminderTime ? 'event' : 'task'),
        completedAt: getTodayDateString(),
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
  const importance = inputTaskImportance.value;
  const reminderTime = inputTaskTime ? inputTaskTime.value : '';

  if (!title || !dueDate) return;

  const newTask = {
    id: Date.now().toString(),
    title,
    dueDate,
    importance,
    reminderTime: reminderTime || ''
  };

  state.tasks.push(newTask);
  inputTaskTitle.value = '';
  if (inputTaskTime) inputTaskTime.value = '';
  if (reminderDisplayText) reminderDisplayText.textContent = '未設定';
  if (btnClearReminderDirect) btnClearReminderDirect.style.display = 'none';
  persistState();
  renderMatrix();
  renderCalendar();

  // 若使用者勾選了同步 Google 日曆且目前有連線 Token，背景非同步發布至 Google，不阻塞前端 UI
  if (checkAutoSyncGcal && checkAutoSyncGcal.checked && state.gcalToken) {
    syncTaskToGoogleCalendar(newTask, false).catch(err => console.error('背景同步 Google 失敗:', err));
  }
});

// 提醒時間自訂選擇器元件
const btnReminderPicker = document.getElementById('btn-reminder-picker');
const reminderDisplayText = document.getElementById('reminder-display-text');
const btnClearReminderDirect = document.getElementById('btn-clear-reminder-direct');
const reminderDropdownModal = document.getElementById('reminder-dropdown-modal');
const timeAmpmSelect = document.getElementById('time-ampm');
const timeHourSelect = document.getElementById('time-hour');
const timeMinuteSelect = document.getElementById('time-minute');
const btnCancelReminder = document.getElementById('btn-cancel-reminder');
const btnConfirmReminder = document.getElementById('btn-confirm-reminder');

function initReminderTimePicker() {
  if (!timeHourSelect || !timeMinuteSelect) return;

  // 填入 01 到 12 小時
  timeHourSelect.innerHTML = '';
  for (let i = 1; i <= 12; i++) {
    const opt = document.createElement('option');
    const val = String(i).padStart(2, '0');
    opt.value = val;
    opt.textContent = val;
    if (i === 9) opt.selected = true; // 預設 09
    timeHourSelect.appendChild(opt);
  }

  // 填入 00 到 55 分鐘 (每 5 分鐘一格)
  timeMinuteSelect.innerHTML = '';
  for (let i = 0; i < 60; i += 5) {
    const opt = document.createElement('option');
    const val = String(i).padStart(2, '0');
    opt.value = val;
    opt.textContent = val;
    if (i === 0) opt.selected = true; // 預設 00
    timeMinuteSelect.appendChild(opt);
  }

  // 點擊觸發按鈕開關選單
  btnReminderPicker.addEventListener('click', (e) => {
    if (e.target.id === 'btn-clear-reminder-direct') return;
    const isShowing = reminderDropdownModal.style.display === 'block';
    reminderDropdownModal.style.display = isShowing ? 'none' : 'block';
  });

  // 點擊「確定」
  btnConfirmReminder.addEventListener('click', () => {
    const ampm = timeAmpmSelect.value;
    let hour = parseInt(timeHourSelect.value, 10);
    const minute = timeMinuteSelect.value;

    let hour24 = hour;
    if (ampm === 'PM' && hour < 12) hour24 += 12;
    if (ampm === 'AM' && hour === 12) hour24 = 0;

    const time24 = `${String(hour24).padStart(2, '0')}:${minute}`;
    inputTaskTime.value = time24;
    reminderDisplayText.textContent = `${ampm === 'AM' ? '上午' : '下午'} ${timeHourSelect.value}:${minute}`;
    btnClearReminderDirect.style.display = 'inline-block';
    reminderDropdownModal.style.display = 'none';
  });

  // 點擊「取消」
  btnCancelReminder.addEventListener('click', () => {
    reminderDropdownModal.style.display = 'none';
  });

  // 點擊右上角「✕」清除已選時間
  btnClearReminderDirect.addEventListener('click', (e) => {
    e.stopPropagation();
    inputTaskTime.value = '';
    reminderDisplayText.textContent = '未設定';
    btnClearReminderDirect.style.display = 'none';
    reminderDropdownModal.style.display = 'none';
  });

  // 點擊外面自動關閉選單
  document.addEventListener('click', (e) => {
    if (!btnReminderPicker.contains(e.target) && !reminderDropdownModal.contains(e.target)) {
      reminderDropdownModal.style.display = 'none';
    }
  });
}
initReminderTimePicker();

// 提醒時間說明按鈕 (點擊跳出說明彈窗)
const tooltipReminderTime = document.getElementById('tooltip-reminder-time');
if (tooltipReminderTime) {
  tooltipReminderTime.addEventListener('click', (e) => {
    e.preventDefault();
    alert('【提醒時間說明】\n\n若是設定提醒時間，Google 日曆會在您所設定的時間發送提醒給您。');
  });
}

// 緊急天數說明按鈕 (點擊跳出說明彈窗)
const tooltipUrgentDays = document.getElementById('tooltip-urgent-days');
if (tooltipUrgentDays) {
  tooltipUrgentDays.addEventListener('click', (e) => {
    e.preventDefault();
    alert('【緊急天數判定說明】\n\n系統會自動偵測您所設定的完成日期，並調整其為是否為緊急項目。\n\n以 1 月 1 日為例，若是設定 3 天是緊急天數，則 1/4 (含) 在內的項目都會移至緊急項目。');
  });
}

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
  const checkedCount = state.shoppingList.filter(item => item.done).length;
  shoppingCountEl.textContent = checkedCount;

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
  accCategorySelect.innerHTML = '<option value="">其他</option>';
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
  const category = accCategorySelect.value;
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
        syncType: task.syncType || (task.reminderTime ? 'event' : 'task'),
        gcalEventId: null // 還原時清空舊 ID，由重新同步重新賦予新 ID，避免 ID 衝突
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

  // 若已連線 Google 日曆，自動將還原的事項再次新增回 Google 日曆
  if (state.gcalToken && restoredTasks.length > 0) {
    for (const task of restoredTasks) {
      await syncTaskToGoogleCalendar(task, false); // 靜默新增，不跳彈窗打擾
    }
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

    // 比對此待辦是否已在 Google 日曆存在（以 gcalEventId 或名稱比對）
    let matchedGcal = dayGcalEvents.find(evt => {
      if (t.gcalEventId && evt.id === t.gcalEventId) return true;
      const summary = (evt.summary || '').trim();
      return summary === t.title.trim();
    });

    if (matchedGcal) {
      matchedGcalEventIds.add(matchedGcal.id);
    } else if (t.gcalEventId) {
      matchedGcalEventIds.add(t.gcalEventId);
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
          ? `<span class="badge-synced" title="已同步至 Google">✓ 已同步</span>
             ${(matchedGcal.htmlLink) ? `<a href="${matchedGcal.htmlLink}" target="_blank" rel="noopener" class="btn-icon-subtle" title="在 Google 日曆開啟">🔗</a>` : ''}`
          : `<button class="btn-sync-gcal" title="同步新增至 Google 工作" data-task-id="${t.id}">+Google</button>`
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
  // 檢查既有的 Token 是否過期
  if (state.gcalToken && state.gcalTokenExpiry) {
    if (Date.now() > state.gcalTokenExpiry) {
      // 已過期，清除
      state.gcalToken = null;
      localStorage.removeItem('matrix_gcal_token');
      localStorage.removeItem('matrix_gcal_token_expiry');
    }
  }

  // 自動重連：若使用者曾成功連線過（matrix_gcal_auto_connect）但目前未持有有效 Token，嘗試背景靜默重連
  const shouldAutoConnect = localStorage.getItem('matrix_gcal_auto_connect') === 'true';
  if (!state.gcalToken && state.gcalClientId && shouldAutoConnect) {
    // 延遲一點點等待 Google Identity scripts 載入完成
    setTimeout(() => {
      loginGoogleCalendar(true);
    }, 800);
  }

  // 監聽網路恢復連線事件 (Online)：斷線後重連時自動續期並更新日曆
  window.addEventListener('online', () => {
    console.log('網路已恢復連線，嘗試重新連線 Google 日曆...');
    if (state.gcalClientId && localStorage.getItem('matrix_gcal_auto_connect') === 'true') {
      loginGoogleCalendar(true);
    } else if (state.gcalToken) {
      fetchGoogleCalendarEvents();
    }
  });

  updateGcalUI();

  // 若 Token 依然有效，頁面載入時自動拉取當月行程
  if (state.gcalToken) {
    fetchGoogleCalendarEvents();
  }

  // 綁定事件
  btnGcalAuth.addEventListener('click', () => {
    if (state.gcalToken) {
      // 登出/中斷連線
      if (confirm('確定要中斷與 Google 日曆的連線嗎？')) {
        disconnectGoogleCalendar();
      }
    } else {
      // 登入
      loginGoogleCalendar();
    }
  });

  btnRefreshGcal.addEventListener('click', async () => {
    if (state.gcalToken) {
      await refreshAndSyncMonthTasks();
    }
  });
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
    btnRefreshGcal.style.display = 'none';
  }
}

function loginGoogleCalendar(silent = false) {
  if (!state.gcalClientId) {
    if (!silent) {
      alert('系統尚未設定 Google OAuth Client ID！');
    }
    return;
  }

  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
    if (!silent) {
      alert('Google Identity 服務尚未載入完成，請確認網路連線或重新整理頁面。');
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
          if (!silent) {
            alert(`授權失敗：${tokenResponse.error_description || tokenResponse.error}`);
          }
          return;
        }
        state.gcalToken = tokenResponse.access_token;
        const expiresInSec = tokenResponse.expires_in || 3599;
        state.gcalTokenExpiry = Date.now() + expiresInSec * 1000;
        localStorage.setItem('matrix_gcal_token', state.gcalToken);
        localStorage.setItem('matrix_gcal_token_expiry', state.gcalTokenExpiry.toString());
        localStorage.setItem('matrix_gcal_auto_connect', 'true');
        updateGcalUI();
        fetchGoogleCalendarEvents();
      }
    });

    gcalTokenClient.requestAccessToken({ prompt: '' }); // 使用者已同意過則免重複點擊確認
  } catch (err) {
    console.error('初始化 Google 授權失敗:', err);
    if (!silent) {
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
  localStorage.removeItem('matrix_gcal_auto_connect');
  state.gcalEvents = [];
  updateGcalUI();
  renderCalendar();
  renderDayEvents(state.selectedDateStr);
}

// 取得當前月曆檢視月份的所有行程與工作 (Events & Tasks)
async function fetchGoogleCalendarEvents() {
  if (!state.gcalToken) return;

  const year = state.calYear;
  const month = state.calMonth;
  // 計算當月起始與結束 ISO 字串
  const timeMin = new Date(year, month, 1, 0, 0, 0).toISOString();
  const timeMax = new Date(year, month + 1, 0, 23, 59, 59).toISOString();

  btnRefreshGcal.textContent = '⏳';

  try {
    // 1. 同步拉取 Google Calendar 活動
    const urlEvents = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`;
    const pEvents = fetch(urlEvents, {
      headers: { 'Authorization': `Bearer ${state.gcalToken}` }
    }).then(async res => {
      if (res.status === 401) throw new Error('AUTH_EXPIRED');
      if (!res.ok) return [];
      const data = await res.json();
      return (data.items || []).map(item => ({
        id: item.id,
        summary: item.summary,
        start: item.start,
        htmlLink: item.htmlLink,
        type: 'event'
      }));
    });

    // 2. 同步拉取 Google Tasks 工作
    const urlTasks = `https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showCompleted=false&dueMin=${encodeURIComponent(timeMin)}&dueMax=${encodeURIComponent(timeMax)}`;
    const pTasks = fetch(urlTasks, {
      headers: { 'Authorization': `Bearer ${state.gcalToken}` }
    }).then(async res => {
      if (res.status === 401) throw new Error('AUTH_EXPIRED');
      if (!res.ok) return [];
      const data = await res.json();
      return (data.items || []).map(item => ({
        id: item.id,
        summary: item.title,
        start: { date: item.due ? item.due.split('T')[0] : '' },
        htmlLink: '',
        type: 'task'
      }));
    });

    const [events, tasks] = await Promise.all([pEvents, pTasks]);
    state.gcalEvents = [...events, ...tasks];

    renderCalendar();
    renderDayEvents(state.selectedDateStr);
  } catch (err) {
    if (err.message === 'AUTH_EXPIRED') {
      alert('Google 授權已過期，請重新點擊「連線」登入。');
      disconnectGoogleCalendar();
      return;
    }
    console.error('載入 Google 行程與工作失敗:', err);
  } finally {
    btnRefreshGcal.textContent = '🔄';
  }
}

// 點擊重新整理按鈕時：拉取最新日曆 + 補登當月尚未登記到 Google Calendar 的 PASS 事項 (不重複登記、不更動非 PASS 項目)
async function refreshAndSyncMonthTasks() {
  if (!state.gcalToken) return;

  btnRefreshGcal.textContent = '⏳';

  try {
    // 1. 先完整抓取 Google 最新狀態 (Events & Tasks)
    await fetchGoogleCalendarEvents();

    const year = state.calYear;
    const month = state.calMonth;
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;

    // 2. 篩選當月份的所有 PASS 待辦事項
    const currentMonthTasks = state.tasks.filter(t => t.dueDate && t.dueDate.startsWith(monthPrefix));

    let newlySyncedCount = 0;

    for (const task of currentMonthTasks) {
      // 檢查是否已在 Google 日曆存在 (依 ID 或依同日同名比對)
      const cleanDueDate = task.dueDate.includes('T') ? task.dueDate.split('T')[0] : task.dueDate;
      const alreadyInGoogle = state.gcalEvents.some(evt => {
        if (task.gcalEventId && evt.id === task.gcalEventId) return true;
        const summary = (evt.summary || '').trim();
        const evtDate = evt.start?.date || (evt.start?.dateTime ? evt.start.dateTime.split('T')[0] : '');
        return summary === task.title.trim() && evtDate === cleanDueDate;
      });

      // 若尚未在 Google 登記，則同步新增上去
      if (!alreadyInGoogle) {
        await syncTaskToGoogleCalendar(task, false);
        newlySyncedCount++;
      }
    }

    // 若有補登項目，再次刷新日曆與當日事項
    if (newlySyncedCount > 0) {
      await fetchGoogleCalendarEvents();
      alert(`重新整理完成！已自動補登 ${newlySyncedCount} 件尚未同步的當月事項至 Google 日曆。`);
    } else {
      renderCalendar();
      renderDayEvents(state.selectedDateStr);
    }
  } catch (err) {
    console.error('重新整理與補登失敗:', err);
  } finally {
    btnRefreshGcal.textContent = '🔄';
  }
}

// 將 Matrix 四象限單項任務同步推送到 Google：
// 1. 若有填寫「提醒時間」：新增為 Google Calendar「活動 (Event)」，並在設定時間準時發出活動提醒通知
// 2. 若無填寫「提醒時間」：新增為 Google Calendar「工作 (Task)」
async function syncTaskToGoogleCalendar(task, showNotice = true) {
  if (!state.gcalToken) {
    if (showNotice) {
      const wantLogin = confirm('尚未連線至 Google。是否現在連線？');
      if (wantLogin) {
        loginGoogleCalendar();
      }
    }
    return;
  }

  const btn = document.querySelector(`.btn-sync-gcal[data-task-id="${task.id}"]`);
  if (btn) btn.textContent = '同步中...';

  const cleanDueDate = task.dueDate.includes('T') ? task.dueDate.split('T')[0] : task.dueDate;
  const isReminderEvent = Boolean(task.reminderTime);

  try {
    if (isReminderEvent) {
      // === 模式 A：有設定提醒時間 -> 建立 Google Calendar 活動 (Event) 並附帶彈窗提醒 ===
      const [h, m] = task.reminderTime.split(':').map(Number);
      let endH = h;
      let endM = m + 30;
      if (endM >= 60) {
        endH = (endH + 1) % 24;
        endM = endM - 60;
      }

      const tzOffset = -new Date().getTimezoneOffset();
      const diffSign = tzOffset >= 0 ? '+' : '-';
      const padZero = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
      const offsetString = `${diffSign}${padZero(tzOffset / 60)}:${padZero(tzOffset % 60)}`;

      const startISO = `${cleanDueDate}T${padZero(h)}:${padZero(m)}:00${offsetString}`;
      const endISO = `${cleanDueDate}T${padZero(endH)}:${padZero(endM)}:00${offsetString}`;

      const eventPayload = {
        summary: task.title,
        description: `由個人行政秘書系統(PASS)建立。\n重要度：${task.importance === 'important' ? '⭐ 重要' : '☕ 不重要'}\n截止日：${cleanDueDate}\n提醒時間：${task.reminderTime}`,
        start: { dateTime: startISO },
        end: { dateTime: endISO },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 0 } // 在使用者設定的提醒時間準時跳出提醒
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
        if (showNotice) alert('Google 授權已過期，請重新連線。');
        disconnectGoogleCalendar();
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error?.message || `HTTP ${res.status}`);
      }

      const createdEvent = await res.json();
      if (createdEvent && createdEvent.id) {
        task.gcalEventId = createdEvent.id;
        task.syncType = 'event';
        persistState();
        renderDayEvents(state.selectedDateStr);
      }
      if (showNotice) {
        alert(`成功同步至 Google 活動 (Event)：「${task.title}」（已設 ${task.reminderTime} 提醒）！`);
      }
    } else {
      // === 模式 B：無提醒時間 -> 建立 Google 工作 (Task) ===
      const taskPayload = {
        title: task.title,
        notes: `由個人行政秘書系統(PASS)建立。\n重要度：${task.importance === 'important' ? '⭐ 重要' : '☕ 不重要'}\n截止日：${cleanDueDate}`,
        due: `${cleanDueDate}T00:00:00Z`
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
        if (showNotice) alert('Google 授權已過期，請重新連線。');
        disconnectGoogleCalendar();
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error?.message || `HTTP ${res.status}`);
      }

      const createdTask = await res.json();
      if (createdTask && createdTask.id) {
        task.gcalEventId = createdTask.id;
        task.syncType = 'task';
        persistState();
        renderDayEvents(state.selectedDateStr);
      }
      if (showNotice) {
        alert(`成功同步至 Google 工作 (Tasks)：「${task.title}」！`);
      }
    }

    // 重新抓取並更新月曆畫面
    fetchGoogleCalendarEvents();
  } catch (err) {
    console.error('建立 Google 行程/工作失敗:', err);
    if (showNotice) {
      alert(`同步至 Google 失敗：${err.message}`);
    }
    if (btn) btn.textContent = '+Google';
  }
}

// 從 Google 日曆或工作清單刪除指定事項 (依 gcalEventId，若無則依標題與日期比對備援)
async function deleteTaskFromGoogleCalendar(task) {
  if (!state.gcalToken) return;

  let eventIdToDelete = task.gcalEventId;

  // 若該物件尚未登記 gcalEventId，則從快取的 gcalEvents 尋找相符標題與日期的事件
  if (!eventIdToDelete && state.gcalEvents && state.gcalEvents.length > 0) {
    const cleanDueDate = task.dueDate ? (task.dueDate.includes('T') ? task.dueDate.split('T')[0] : task.dueDate) : (task.originalDueDate || '');
    const matched = state.gcalEvents.find(evt => {
      const summary = (evt.summary || '').trim();
      const evtDate = evt.start?.date || (evt.start?.dateTime ? evt.start.dateTime.split('T')[0] : '');
      return summary === task.title.trim() && evtDate === cleanDueDate;
    });
    if (matched) {
      eventIdToDelete = matched.id;
    }
  }

  if (!eventIdToDelete) return;

  try {
    const isTask = task.syncType === 'task';
    const isEvent = task.syncType === 'event';

    if (isEvent) {
      // 確定為活動，直接刪除 Calendar Event
      await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventIdToDelete)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${state.gcalToken}` }
      });
      console.log(`已成功從 Google 日曆刪除活動：「${task.title}」`);
    } else if (isTask) {
      // 確定為工作，直接刪除 Google Task
      await fetch(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${encodeURIComponent(eventIdToDelete)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${state.gcalToken}` }
      });
      console.log(`已成功從 Google Tasks 刪除工作：「${task.title}」`);
    } else {
      // 未知類型，先試 Tasks 若 404 則試 Events
      const resTask = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${encodeURIComponent(eventIdToDelete)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${state.gcalToken}` }
      });

      if (resTask.status !== 204 && resTask.status !== 200) {
        await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventIdToDelete)}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${state.gcalToken}` }
        });
      }
    }
  } catch (err) {
    console.warn(`自 Google 刪除事項失敗:`, err);
  }
}
