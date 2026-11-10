/**
 * 輕重緩急四象限事務管理系統
 */

// 取得今天 YYYY-MM-DD
function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 狀態管理物件
const state = {
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
  selectedTaskIds: new Set(),
  selectedRestoreIds: new Set(),
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(),
  selectedDateStr: getTodayDateString()
};

// 輔助工具：日期計算
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

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

// 儲存至 LocalStorage
function persistState() {
  localStorage.setItem('matrix_urgent_days', state.urgentDaysThreshold.toString());
  localStorage.setItem('matrix_tasks_v2', JSON.stringify(state.tasks));
  localStorage.setItem('matrix_shopping_v2', JSON.stringify(state.shoppingList));
  localStorage.setItem('matrix_completed_v2', JSON.stringify(state.completedTasks));
}

// === DOM 元素綁定 ===
const urgentDaysInput = document.getElementById('setting-urgent-days');
const newTaskForm = document.getElementById('new-task-form');
const inputTaskTitle = document.getElementById('input-task-title');
const inputTaskDate = document.getElementById('input-task-date');
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

// === 初始化 ===
document.addEventListener('DOMContentLoaded', () => {
  urgentDaysInput.value = state.urgentDaysThreshold;
  inputTaskDate.value = getTodayDateString();

  renderAll();
  bindEvents();
  initMobileView();
});

function renderAll() {
  renderMatrix();
  renderShoppingList();
  renderCompletedList();
  renderCalendar();
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
          <span class="task-due ${urgent ? 'is-urgent' : ''}">📅 截止：${task.dueDate} ${urgent ? '⚠️ 緊急' : ''}</span>
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
    card.querySelector('.task-del-btn').addEventListener('click', () => {
      if (confirm(`確定要刪除「${task.title}」嗎？`)) {
        state.tasks = state.tasks.filter(t => t.id !== task.id);
        state.selectedTaskIds.delete(task.id);
        persistState();
        renderMatrix();
        renderCalendar();
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
btnBatchComplete.addEventListener('click', () => {
  if (state.selectedTaskIds.size === 0) return;

  const remainingTasks = [];
  state.tasks.forEach(task => {
    if (state.selectedTaskIds.has(task.id)) {
      state.completedTasks.unshift({
        id: task.id,
        title: task.title,
        importance: task.importance,
        originalDueDate: task.dueDate,
        completedAt: getTodayDateString()
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
});

// === 2. 上方使用者輸入與緊急天數偵測 ===
newTaskForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const title = inputTaskTitle.value.trim();
  const dueDate = inputTaskDate.value;
  const importance = inputTaskImportance.value;

  if (!title || !dueDate) return;

  state.tasks.push({
    id: Date.now().toString(),
    title,
    dueDate,
    importance
  });

  inputTaskTitle.value = '';
  persistState();
  renderMatrix();
  renderCalendar();
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
  const remainingCount = state.shoppingList.filter(item => !item.done).length;
  shoppingCountEl.textContent = remainingCount;

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

// === 4. 已完成清單 (勾選還原 + 上方確認更新 + 一鍵清理) ===
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
btnBatchRestore.addEventListener('click', () => {
  if (state.selectedRestoreIds.size === 0) return;

  const remainingCompleted = [];
  state.completedTasks.forEach(task => {
    if (state.selectedRestoreIds.has(task.id)) {
      state.tasks.push({
        id: task.id,
        title: task.title,
        dueDate: task.originalDueDate || getTodayDateString(),
        importance: task.importance || 'important'
      });
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

// === 5. 月曆排程模組 ===
document.getElementById('prev-month').addEventListener('click', () => {
  state.calMonth--;
  if (state.calMonth < 0) {
    state.calMonth = 11;
    state.calYear--;
  }
  renderCalendar();
});

document.getElementById('next-month').addEventListener('click', () => {
  state.calMonth++;
  if (state.calMonth > 11) {
    state.calMonth = 0;
    state.calYear++;
  }
  renderCalendar();
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
    dayEl.textContent = d;

    if (dateStr === todayStr) dayEl.classList.add('today');
    if (dateStr === state.selectedDateStr) dayEl.classList.add('selected');

    // 檢查此日期的四象限任務與色點
    const dayTasks = state.tasks.filter(t => t.dueDate === dateStr);
    if (dayTasks.length > 0) {
      const dotsContainer = document.createElement('div');
      dotsContainer.className = 'cal-dots';
      
      const distinctQuadrants = new Set(dayTasks.map(t => {
        const urgent = isUrgent(t.dueDate, state.urgentDaysThreshold);
        return resolveQuadrant(t.importance, urgent);
      }));

      distinctQuadrants.forEach(qKey => {
        const dot = document.createElement('span');
        dot.className = 'cal-dot';
        dot.style.backgroundColor = getQuadrantColor(qKey);
        dotsContainer.appendChild(dot);
      });

      dayEl.appendChild(dotsContainer);
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

  if (dayTasks.length === 0) {
    dayEventsListEl.innerHTML = '<li style="color:#94a3b8; font-size:0.78rem;">此日無截止排程事項</li>';
    return;
  }

  dayTasks.forEach(t => {
    const urgent = isUrgent(t.dueDate, state.urgentDaysThreshold);
    const qKey = resolveQuadrant(t.importance, urgent);
    const li = document.createElement('li');
    li.className = 'mini-list-item';
    li.innerHTML = `
      <span>${escapeHtml(t.title)}</span>
      <span class="q-color-dot" style="background-color: ${getQuadrantColor(qKey)}" title="${qKey}"></span>
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
