// =============================================================
// STATE
// =============================================================
const state = {
    tasks: [],
    currentPriority: 'medium',
    voiceEnabled: true,
    soundEnabled: true,
    darkMode: true,
    pendingAction: null   // used for conversational voice flow
};

// =============================================================
// Phase 2: Voice Interface Integration
// =============================================================

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const SpeechSynthesis = window.speechSynthesis;
let recognition = null;
let recognizing = false;
let continuousMode = false;

// Voice command keyword lists.
// IMPORTANT: multi-word phrases come BEFORE short words so `.find()` matches greedily.
const VOICE_COMMANDS = {
    ADD_TASK: ['add a task', 'add task', 'create task', 'new task', 'remember to', 'remind me to'],
    MARK_DONE: ['mark as done', 'mark done', 'check off', 'checked off', 'complete', 'finish'],
    DELETE: ['delete task', 'remove task', 'delete', 'remove', 'cancel', 'discard'],
    EDIT: ['edit task', 'update task', 'change task', 'edit', 'update', 'modify task', 'modify'],
    LIST: ['show tasks', 'list tasks', 'read tasks', 'what do i have'],
    HELP: ['what can you do', 'commands', 'assistance', 'help']
};

// Priority keyword map used both in parseCommand and in the pending-action handler.
const PRIORITY_WORDS = {
    high: ['high priority', 'urgent', 'important', 'asap', 'critical'],
    medium: ['medium priority', 'normal priority', 'standard priority', 'moderate'],
    low: ['low priority', 'not urgent', 'someday', 'eventually', 'maybe', 'if possible']
};

const AGENT_RESPONSES = {
    TASK_ADDED: [
        "Got it! I've added that to your list.",
        "Task saved. You're on a roll!",
        "Added! Anything else?"
    ],
    TASK_COMPLETED: [
        "Nice work! Task completed.",
        "Checked off! Keep going!",
        "Done! You're making progress."
    ]
};

// ─── Helpers ─────────────────────────────────────────────────

function randPick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function getPreferredVoice() {
    const voices = SpeechSynthesis.getVoices();
    return voices.find(v => v.lang.startsWith('en')) || voices[0] || null;
}

function speak(text) {
    if (!SpeechSynthesis) return;
    SpeechSynthesis.cancel(); // stop any previous speech
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    utterance.pitch = 1.0;
    const voice = getPreferredVoice();
    if (voice) utterance.voice = voice;
    SpeechSynthesis.speak(utterance);
}

/**
 * Given a string, extract any priority words from it and return
 * the cleaned string plus the detected priority level.
 */
function extractPriorityFromText(str) {
    let priority = null;
    let cleaned = str;
    for (const [level, words] of Object.entries(PRIORITY_WORDS)) {
        for (const word of words) {
            if (cleaned.includes(word)) {
                priority = level;
                cleaned = cleaned.replace(word, '');
            }
        }
    }
    return { priority, cleaned: cleaned.trim() };
}

/**
 * Strip the matched keyword (and everything before it) from a string.
 */
function stripKeyword(str, keyword) {
    const idx = str.indexOf(keyword);
    if (idx === -1) return str.trim();
    return str.slice(idx + keyword.length).trim();
}

// ─── Speech Recognition Init ─────────────────────────────────

function showTextOnlyMode() {
    state.voiceEnabled = false;
    voiceBtn.disabled = true;
    voiceStatus.querySelector('.status-text').textContent = 'Voice unavailable';
    voiceStatus.classList.add('disabled');
}

function initSpeechRecognition() {
    if (!SpeechRecognition) {
        showTextOnlyMode();
        return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = langSelect ? langSelect.value : 'en-US';
    recognition.interimResults = true;
    recognition.continuous = true;
    continuousMode = continuousToggle ? continuousToggle.checked : false;
    wakeWord = wakeWordInput ? wakeWordInput.value.trim().toLowerCase() : '';

    recognition.onstart = () => {
        recognizing = true;
        updateVoiceUI('listening');
        transcriptText.textContent = 'Listening...';
    };

    recognition.onend = () => {
        recognizing = false;
        // Only reset to idle if we are not showing an error message
        if (voiceStatus.querySelector('.status-text').textContent !== 'Error') {
            updateVoiceUI('idle');
        }
        if (continuousMode) {
            // Delay restart to avoid rapid error loops
            setTimeout(() => {
                try { recognition.start(); } catch (e) { /* already started */ }
            }, 1000);
        }
    };

    recognition.onerror = (e) => {
        console.error('Speech recognition error', e);
        if (e.error === 'no-speech') {
            // Not a real error — just silence, keep listening
            return;
        }
        transcriptText.textContent = 'Error: ' + e.error;
        updateVoiceUI('error');
    };

    recognition.onresult = (event) => {
        let interim = '';
        let finalTranscript = '';
        let lastConfidence = 0;

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
                lastConfidence = event.results[i][0].confidence;
            } else {
                interim += event.results[i][0].transcript;
            }
        }

        transcriptText.textContent = interim || finalTranscript;
        updateConfidence(lastConfidence);

        if (finalTranscript) {
            let text = finalTranscript.trim();

            // Wake-word filtering
            if (wakeWord && wakeWord.length) {
                const lower = text.toLowerCase();
                if (!lower.includes(wakeWord)) return;
                text = lower.replace(wakeWord, '').trim();
            }

            handleVoiceCommand(text);
        }
    };
}

// ─── Voice UI ────────────────────────────────────────────────

function updateVoiceUI(stateStr) {
    voiceBtn.classList.remove('listening', 'processing');
    switch (stateStr) {
        case 'listening':
            voiceBtn.classList.add('listening');
            voiceStatus.querySelector('.status-text').textContent = 'Listening';
            voiceTranscript.style.display = 'flex';
            break;
        case 'processing':
            voiceBtn.classList.add('processing');
            voiceStatus.querySelector('.status-text').textContent = 'Processing';
            break;
        case 'error':
            voiceStatus.querySelector('.status-text').textContent = 'Error';
            voiceTranscript.style.display = 'flex';
            // Keep the error message visible — do NOT clear transcriptText here
            break;
        default: // 'idle'
            voiceStatus.querySelector('.status-text').textContent = 'Ready';
            voiceTranscript.style.display = 'none';
            transcriptText.textContent = '';
            break;
    }
}

// ─── Command Parsing ─────────────────────────────────────────

/**
 * Parse a voice transcript into an action + data object.
 * Returns { action: string|null, data: object|null }
 */
function parseCommand(text) {
    const lowered = text.toLowerCase();
    const result = { action: null, data: null };

    // 1. ADD_TASK
    const addKeyword = VOICE_COMMANDS.ADD_TASK.find(k => lowered.includes(k));
    if (addKeyword) {
        result.action = 'add';
        const remainder = stripKeyword(lowered, addKeyword);
        const { priority, cleaned } = extractPriorityFromText(remainder);
        result.data = { text: cleaned, priority: priority || 'medium' };
        return result;
    }

    // 2. MARK_DONE
    const doneKeyword = VOICE_COMMANDS.MARK_DONE.find(k => lowered.includes(k));
    if (doneKeyword) {
        result.action = 'complete';
        result.data = { text: stripKeyword(lowered, doneKeyword) };
        return result;
    }

    // 3. DELETE
    const deleteKeyword = VOICE_COMMANDS.DELETE.find(k => lowered.includes(k));
    if (deleteKeyword) {
        result.action = 'delete';
        result.data = { text: stripKeyword(lowered, deleteKeyword) };
        return result;
    }

    // 3.5 EDIT
    const editKeyword = VOICE_COMMANDS.EDIT.find(k => lowered.includes(k));
    if (editKeyword) {
        result.action = 'edit';
        result.data = { text: stripKeyword(lowered, editKeyword) };
        return result;
    }

    // 4. LIST
    if (VOICE_COMMANDS.LIST.some(k => lowered.includes(k))) {
        result.action = 'list';
        return result;
    }

    // 5. HELP
    if (VOICE_COMMANDS.HELP.some(k => lowered.includes(k))) {
        result.action = 'help';
        return result;
    }

    return result;
}

// ─── Command Handling ────────────────────────────────────────

function handleVoiceCommand(transcript) {
    updateVoiceUI('processing');

    const lowered = transcript.toLowerCase();

    // --- Conversational pending state: user said a trigger without task text ---
    // e.g., user said "add task" (pause) then "buy milk high priority"
    if (state.pendingAction === 'add') {
        state.pendingAction = null;
        const { priority, cleaned } = extractPriorityFromText(lowered);
        const finalPriority = priority || state.currentPriority;
        addTask(cleaned || transcript.trim(), finalPriority);
        speak(randPick(AGENT_RESPONSES.TASK_ADDED));
        setTimeout(() => updateVoiceUI('idle'), 300);
        return;
    }

    if (state.pendingAction === 'complete') {
        state.pendingAction = null;
        const task = state.tasks.find(t => !t.completed && t.text.toLowerCase().includes(lowered.trim()));
        if (task) {
            toggleTask(task.id);
            speak(randPick(AGENT_RESPONSES.TASK_COMPLETED));
        } else {
            speak("I couldn't find that task.");
        }
        setTimeout(() => updateVoiceUI('idle'), 300);
        return;
    }

    if (state.pendingAction === 'delete') {
        state.pendingAction = null;
        const task = state.tasks.find(t => t.text.toLowerCase().includes(lowered.trim()));
        if (task) {
            removeTask(task.id);
            speak('Task deleted.');
        } else {
            speak("I couldn't find that task.");
        }
        setTimeout(() => updateVoiceUI('idle'), 300);
        return;
    }

    if (state.pendingAction === 'edit') {
        state.pendingAction = null;
        const task = state.tasks.find(t => t.text.toLowerCase().includes(lowered.trim()));
        if (task) {
            editTask(task.id);
            speak("Editing task.");
        } else {
            speak("I couldn't find that task.");
        }
        setTimeout(() => updateVoiceUI('idle'), 300);
        return;
    }

    // --- Normal command dispatch ---
    const cmd = parseCommand(transcript);

    switch (cmd.action) {
        case 'add':
            if (cmd.data && cmd.data.text) {
                addTask(cmd.data.text, cmd.data.priority);
                speak(randPick(AGENT_RESPONSES.TASK_ADDED));
            } else {
                // Task text missing — ask user
                state.pendingAction = 'add';
                speak('What task would you like to add?');
            }
            break;

        case 'complete':
            if (cmd.data && cmd.data.text) {
                const task = state.tasks.find(t => !t.completed && t.text.toLowerCase().includes(cmd.data.text));
                if (task) {
                    toggleTask(task.id);
                    speak(randPick(AGENT_RESPONSES.TASK_COMPLETED));
                } else {
                    speak("I couldn't find that task.");
                }
            } else {
                state.pendingAction = 'complete';
                speak('Which task should I mark as done?');
            }
            break;

        case 'delete':
            if (cmd.data && cmd.data.text) {
                const task = state.tasks.find(t => t.text.toLowerCase().includes(cmd.data.text));
                if (task) {
                    removeTask(task.id);
                    speak('Task deleted.');
                } else {
                    speak("I couldn't find that task.");
                }
            } else {
                state.pendingAction = 'delete';
                speak('Which task do you want to delete?');
            }
            break;

        case 'edit':
            if (cmd.data && cmd.data.text) {
                const task = state.tasks.find(t => t.text.toLowerCase().includes(cmd.data.text));
                if (task) {
                    editTask(task.id);
                    speak('Editing task.');
                } else {
                    speak("I couldn't find that task.");
                }
            } else {
                state.pendingAction = 'edit';
                speak('Which task do you want to edit?');
            }
            break;

        case 'list':
            if (state.tasks.length === 0) {
                speak('You have no tasks right now.');
            } else {
                const listText = 'Here are your tasks: ' +
                    state.tasks.map(t => (t.completed ? 'completed: ' : '') + t.text).join('; ');
                speak(listText);
            }
            break;

        case 'help':
            speak('You can say things like: add task buy milk, mark done laundry, delete task grocery, edit task meeting, or list tasks.');
            break;

        default:
            // Unrecognised command — silently ignore
            break;
    }

    setTimeout(() => updateVoiceUI('idle'), 300);
}

// =============================================================
// DOM ELEMENT REFERENCES
// (placed before Task class and event wiring)
// =============================================================
let taskIdCounter = 0;

const voiceBtn = document.getElementById('voiceBtn');
const taskInput = document.getElementById('taskInput');
const addBtn = document.getElementById('addBtn');
const voiceTranscript = document.getElementById('voiceTranscript');
const transcriptText = document.getElementById('transcriptText');
const voiceStatus = document.getElementById('voiceStatus');
const priorityButtons = document.querySelectorAll('.priority-btn');
const highPriorityList = document.getElementById('highPriorityList');
const mediumPriorityList = document.getElementById('mediumPriorityList');
const lowPriorityList = document.getElementById('lowPriorityList');
const highCount = document.getElementById('highCount');
const mediumCount = document.getElementById('mediumCount');
const lowCount = document.getElementById('lowCount');
const totalTasks = document.getElementById('totalTasks');
const completedTasks = document.getElementById('completedTasks');
const completionRate = document.getElementById('completionRate');
const suggestionsContent = document.getElementById('suggestionsContent');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeModal = document.getElementById('closeModal');
const celebrationOverlay = document.getElementById('celebrationOverlay');

// Settings inputs
const voiceToggle = document.getElementById('voiceToggle');
const continuousToggle = document.getElementById('continuousToggle');
const wakeWordInput = document.getElementById('wakeWordInput');
const langSelect = document.getElementById('langSelect');

let wakeWord = '';

// =============================================================
// Task Model
// =============================================================
class Task {
    constructor(text, priority = 'medium') {
        this.id = `task_${Date.now()}_${taskIdCounter++}`;
        this.text = text;
        this.priority = priority;
        this.completed = false;
        this.createdAt = Date.now();
        this.completedAt = null;
    }
}

// =============================================================
// Core Task Operations
// =============================================================

/**
 * Add a task.
 * @param {string} text - Task description (already cleaned of priority words)
 * @param {string|null} priority - 'high' | 'medium' | 'low' | null
 *   Pass null to auto-detect from text then fall back to currentPriority button.
 */
function addTask(text, priority = null) {
    if (!text || text.trim() === '') {
        showNotification('Please enter a task', 'warning');
        return;
    }

    showLoadingSkeleton();

    const trimmed = text.trim();

    // Priority resolution order:
    //  1. Explicit value passed in (from voice parser or pending-action handler)
    //  2. Auto-detect from text via NLP keywords
    //  3. Currently selected priority button
    if (!priority) {
        priority = detectPriority(trimmed) || state.currentPriority;
    }

    const task = new Task(trimmed, priority);
    const { category, confidence } = categorizeTask(trimmed);
    task.category = category;
    task.categoryConfidence = confidence;

    state.tasks.push(task);
    state.tasks = smartSort(state.tasks);

    setTimeout(() => {
        renderAllTasks();
        updateTaskCounts();
        updateStats();
        updateSuggestions();
        taskInput.value = '';
        showNotification('Task added successfully!', 'success');
        saveTasks();
    }, 300);
}

function showLoadingSkeleton(count = 3) {
    const target = document.querySelector('.tasks-container');
    if (!target) return;
    for (let i = 0; i < count; i++) {
        const sk = document.createElement('div');
        sk.className = 'task-skeleton';
        target.appendChild(sk);
        setTimeout(() => sk.remove(), 600);
    }
}

function exportTasks() {
    const data = {
        tasks: JSON.parse(localStorage.getItem('agentic_tasks')) || [],
        exportDate: new Date().toISOString(),
        version: '1.0'
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `tasks_backup_${Date.now()}.json`);
}

function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function importTasks(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported = JSON.parse(e.target.result);
            if (imported.tasks && Array.isArray(imported.tasks)) {
                state.tasks = imported.tasks;
                renderAllTasks();
                updateSuggestions();
                saveTasks();
                showNotification('Tasks imported successfully!', 'success');
            }
        } catch (err) {
            showNotification('Failed to import tasks.', 'error');
            console.error(err);
        }
    };
    reader.readAsText(file);
}

function removeTask(taskId) {
    const index = state.tasks.findIndex(t => t.id === taskId);
    if (index === -1) return;

    state.tasks.splice(index, 1);

    const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);
    if (taskElement) {
        taskElement.classList.add('removing');
        setTimeout(() => {
            taskElement.remove();
            updateTaskCounts();
            updateStats();
            updateSuggestions();
        }, 300);
    }

    saveTasks();
}

function toggleTask(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    task.completed = !task.completed;
    task.completedAt = task.completed ? Date.now() : null;

    const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);
    if (taskElement) {
        taskElement.classList.toggle('completed');
        const checkbox = taskElement.querySelector('.task-checkbox');
        if (checkbox) checkbox.checked = task.completed;
    }

    updateStats();
    updateSuggestions();
    checkAllTasksComplete();
    saveTasks();
}

// =============================================================
// Rendering
// =============================================================

function renderTask(task) {
    const li = document.createElement('li');
    li.className = 'task-item';
    li.setAttribute('data-task-id', task.id);
    li.setAttribute('data-priority', task.priority);
    li.style.position = 'relative';

    if (task.completed) li.classList.add('completed');

    li.innerHTML = `
        <div class="task-content">
            <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''}>
            <span class="task-text">${escapeHtml(task.text)}</span>
        </div>
        <div class="task-actions">
            <button class="task-btn edit-btn" title="Edit task">✏️</button>
            <button class="task-btn delete-btn" title="Delete task">🗑️</button>
        </div>
    `;

    li.querySelector('.task-checkbox').addEventListener('change', () => toggleTask(task.id));
    li.querySelector('.delete-btn').addEventListener('click', () => removeTask(task.id));
    li.querySelector('.edit-btn').addEventListener('click', () => editTask(task.id));

    // Swipe gesture support (mobile)
    let touchStartX = 0;
    li.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
        li._longPressTimer = setTimeout(() => editTask(task.id), 600);
    });
    li.addEventListener('touchmove', () => clearTimeout(li._longPressTimer));
    li.addEventListener('touchend', e => {
        clearTimeout(li._longPressTimer);
        const dist = e.changedTouches[0].screenX - touchStartX;
        if (dist > 100) completeTaskWithAnimation(task, li);
        else if (dist < -100) deleteTaskWithAnimation(task.id, li);
    });

    getListByPriority(task.priority).appendChild(li);

    setTimeout(() => {
        li.style.animation = 'slideInFade 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
    }, 10);
}

function completeTaskWithAnimation(task, element) {
    element.classList.add('ripple-green', 'swiped');
    element.style.transform = 'translateX(20px)';
    element.style.opacity = '0.6';
    setTimeout(() => {
        toggleTask(task.id);
        element.classList.remove('ripple-green', 'swiped');
        element.style.transform = '';
        element.style.opacity = '';
    }, 300);
}

function deleteTaskWithAnimation(taskId, element) {
    element.classList.add('ripple-red');
    element.style.transform = 'translateX(-100%)';
    setTimeout(() => removeTask(taskId), 300);
}

function renderAllTasks() {
    highPriorityList.innerHTML = '';
    mediumPriorityList.innerHTML = '';
    lowPriorityList.innerHTML = '';

    const priorityOrder = { high: 1, medium: 2, low: 3 };
    state.tasks.sort((a, b) => {
        if (a.priority !== b.priority) {
            return priorityOrder[a.priority] - priorityOrder[b.priority];
        }
        return a.createdAt - b.createdAt;
    });

    state.tasks.forEach(task => renderTask(task));
    updateTaskCounts();
    updateStats();
}

function getListByPriority(priority) {
    switch (priority) {
        case 'high': return highPriorityList;
        case 'low': return lowPriorityList;
        default: return mediumPriorityList;
    }
}

function updateTaskCounts() {
    const counts = state.tasks.reduce((acc, task) => {
        if (!task.completed) {
            acc[task.priority] = (acc[task.priority] || 0) + 1;
        }
        return acc;
    }, {});
    highCount.textContent = counts.high || 0;
    mediumCount.textContent = counts.medium || 0;
    lowCount.textContent = counts.low || 0;
}

function updateStats() {
    const total = state.tasks.length;
    const completed = state.tasks.filter(t => t.completed).length;
    const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
    totalTasks.textContent = total;
    completedTasks.textContent = completed;
    completionRate.textContent = `${rate}%`;
    // Refresh analytics charts
    if (typeof updateAnalytics === 'function') updateAnalytics();
}

function updateSuggestions() {
    const suggestions = generateSuggestions();
    suggestionsContent.innerHTML = suggestions.map(s => `
        <div class="suggestion-item">
            <span class="suggestion-icon">${s.icon}</span>
            <p class="suggestion-text">${s.text}</p>
        </div>
    `).join('');
}

// =============================================================
// Phase 3: Agentic Intelligence
// =============================================================

// 3.1  Priority detection (NLP keywords — used when no explicit priority passed)
function detectPriority(taskText) {
    const textLower = taskText.toLowerCase();
    const highKW = ['urgent', 'asap', 'critical', 'deadline', 'today', 'now', 'immediately'];
    const lowKW = ['someday', 'maybe', 'eventually', 'when i can', 'if possible', 'nice to have'];
    if (highKW.some(w => textLower.includes(w))) return 'high';
    if (lowKW.some(w => textLower.includes(w))) return 'low';
    return null; // return null so caller can fall back to currentPriority button
}

// 3.2 Task categorisation
const TASK_CATEGORIES = {
    WORK: ['meeting', 'email', 'call', 'report', 'presentation'],
    PERSONAL: ['grocery', 'workout', 'doctor', 'clean', 'laundry'],
    LEARNING: ['read', 'study', 'course', 'practice', 'learn'],
    ERRANDS: ['buy', 'pick up', 'drop off', 'mail', 'bank']
};

function categorizeTask(taskText) {
    const textLower = taskText.toLowerCase();
    let bestMatch = { category: 'OTHER', confidence: 0 };
    Object.entries(TASK_CATEGORIES).forEach(([cat, keywords]) => {
        keywords.forEach(word => {
            if (textLower.includes(word)) {
                bestMatch = { category: cat, confidence: Math.max(bestMatch.confidence, 1 / keywords.length) };
            }
        });
    });
    return bestMatch;
}

// 3.3 Smart ordering
function smartSort(tasks) {
    return tasks.sort((a, b) => {
        if (a.deadline && b.deadline) return a.deadline - b.deadline;
        if (a.deadline) return -1;
        if (b.deadline) return 1;
        if (a.estimatedMinutes && b.estimatedMinutes) return a.estimatedMinutes - b.estimatedMinutes;
        return a.createdAt - b.createdAt;
    });
}

// 3.4 Suggestions
function generateSuggestions() {
    const suggestions = [];
    const incompleteTasks = state.tasks.filter(t => !t.completed);
    const completedToday = state.tasks.filter(t => t.completed && isToday(t.completedAt)).length;

    if (state.tasks.length === 0) {
        return [{ icon: '👋', text: 'Welcome! Start by adding your first task using voice or text.' }];
    }

    const highCount = incompleteTasks.filter(t => t.priority === 'high').length;
    if (highCount > 0) {
        suggestions.push({ icon: '🔥', text: `You have ${highCount} high-priority task${highCount > 1 ? 's' : ''}. Focus on these first!` });
    }

    if (completedToday > 0) {
        suggestions.push({ icon: '🎯', text: `Great work! You've completed ${completedToday} task${completedToday > 1 ? 's' : ''} today.` });
    }

    const hour = new Date().getHours();
    if (hour < 10 && incompleteTasks.length > 0) {
        suggestions.push({ icon: '☀️', text: 'Good morning! Start with your high-priority tasks.' });
    }

    if (incompleteTasks.filter(t => t.priority === 'high').length > 2) {
        suggestions.push({ icon: '⚖️', text: 'You have several urgent tasks. Want me to help prioritize?' });
    }

    if (getCompletionRate(state.tasks) > 70) {
        suggestions.push({ icon: '🚀', text: "You're crushing it today! Only a few tasks left." });
    }

    if (suggestions.length === 0) {
        suggestions.push({ icon: '✨', text: 'Keep going! Every completed task brings you closer to your goals.' });
    }

    return suggestions;
}

function getCompletionRate(tasks) {
    const total = tasks.length;
    if (total === 0) return 0;
    return Math.round((tasks.filter(t => t.completed).length / total) * 100);
}

// =============================================================
// Event Listeners
// =============================================================

// Add button / Enter key — pass null so addTask auto-detects via detectPriority
// then falls back to the currently-selected priority button
addBtn.addEventListener('click', () => addTask(taskInput.value, null));

taskInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addTask(taskInput.value, null);
});

priorityButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        priorityButtons.forEach(b => b.classList.remove('priority-btn-active'));
        btn.classList.add('priority-btn-active');
        state.currentPriority = btn.getAttribute('data-priority');
    });
});

settingsBtn.addEventListener('click', () => settingsModal.classList.add('active'));
closeModal.addEventListener('click', () => settingsModal.classList.remove('active'));
settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.classList.remove('active');
});

// Voice settings
voiceToggle.addEventListener('change', () => {
    state.voiceEnabled = voiceToggle.checked;
    if (!state.voiceEnabled) {
        if (recognizing) { continuousMode = false; recognition.stop(); }
        voiceBtn.disabled = true;
        updateVoiceUI('idle');
    } else {
        voiceBtn.disabled = false;
    }
});

continuousToggle.addEventListener('change', () => {
    continuousMode = continuousToggle.checked;
    if (!continuousMode && recognizing) recognition.stop();
});

wakeWordInput.addEventListener('input', () => {
    wakeWord = wakeWordInput.value.trim().toLowerCase();
});

langSelect.addEventListener('change', () => {
    if (recognition) {
        recognition.lang = langSelect.value;
        if (recognizing) { recognition.stop(); recognition.start(); }
    }
});

// Export / Import
const exportBtn = document.getElementById('exportBtn');
const importInput = document.getElementById('importInput');
if (exportBtn) exportBtn.addEventListener('click', exportTasks);
if (importInput) importInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length) {
        importTasks(e.target.files[0]);
        e.target.value = '';
    }
});

// Voice button: toggle listening on/off
voiceBtn.addEventListener('click', () => {
    if (!recognition) return;
    if (recognizing) {
        continuousMode = false;
        recognition.stop();
    } else {
        recognition.start();
    }
});

// =============================================================
// Utility Functions
// =============================================================

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function isToday(timestamp) {
    const today = new Date();
    const date = new Date(timestamp);
    return date.getDate() === today.getDate() &&
        date.getMonth() === today.getMonth() &&
        date.getFullYear() === today.getFullYear();
}

function showNotification(message, type = 'info') {
    // Visual toast notification
    let toast = document.getElementById('toastNotification');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toastNotification';
        toast.style.cssText = `
            position: fixed; bottom: 24px; right: 24px; z-index: 9999;
            padding: 12px 20px; border-radius: 10px; font-size: 14px;
            font-weight: 500; color: #fff; opacity: 0;
            transition: opacity 0.3s ease; pointer-events: none;
        `;
        document.body.appendChild(toast);
    }
    const colors = { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#6366f1' };
    toast.style.background = colors[type] || colors.info;
    toast.textContent = message;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 3000);

    console.log(`[${type.toUpperCase()}] ${message}`);
}

function updateConfidence(conf) {
    const meter = document.getElementById('confidenceMeter');
    if (!meter) return;
    if (conf && !isNaN(conf)) {
        const pct = Math.round(conf * 100);
        meter.textContent = `${pct}%`;
        meter.style.color = conf > 0.75 ? 'var(--accent-primary)'
            : conf > 0.5 ? 'var(--text-secondary)'
                : 'var(--error)';
    } else {
        meter.textContent = '';
    }
}

function checkAllTasksComplete() {
    const incomplete = state.tasks.filter(t => !t.completed);
    if (state.tasks.length > 0 && incomplete.length === 0) {
        celebrateCompletion();
    }
}

function celebrateCompletion() {
    celebrationOverlay.classList.add('active');
    const confettiContainer = document.getElementById('confettiContainer');
    if (confettiContainer) {
        for (let i = 0; i < 30; i++) {
            const piece = document.createElement('div');
            piece.className = 'celebration-piece';
            piece.style.left = Math.random() * 100 + '%';
            piece.style.background = `hsl(${Math.random() * 360}, 100%, 50%)`;
            confettiContainer.appendChild(piece);
            piece.addEventListener('animationend', () => piece.remove());
        }
    }
    setTimeout(() => celebrationOverlay.classList.remove('active'), 3000);
}

function editTask(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (task) {
        const newText = prompt('Edit task:', task.text);
        if (newText && newText.trim() !== '') {
            task.text = newText.trim();
            renderAllTasks();
            saveTasks();
        }
    }
}

function saveTasks() {
    try {
        localStorage.setItem('agentic_tasks', JSON.stringify(state.tasks));
    } catch (error) {
        console.error('Failed to save tasks:', error);
    }
}

function loadTasks() {
    try {
        const stored = localStorage.getItem('agentic_tasks');
        if (stored) {
            state.tasks = JSON.parse(stored);
            renderAllTasks();
            updateSuggestions();
        }
    } catch (error) {
        console.error('Failed to load tasks:', error);
    }
}

// =============================================================
// Injected CSS for dynamically-created task items
// =============================================================
const style = document.createElement('style');
style.textContent = `
    .task-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--space-md);
        background: var(--bg-tertiary);
        border-radius: var(--radius-md);
        border: 1px solid rgba(255, 255, 255, 0.05);
        transition: all var(--transition-base);
        cursor: pointer;
    }
    .task-item:hover {
        background: var(--bg-elevated);
        border-color: var(--accent-primary);
        transform: translateX(4px);
    }
    .task-item.completed { opacity: 0.6; }
    .task-item.completed .task-text {
        text-decoration: line-through;
        color: var(--text-dim);
    }
    .task-item.removing { animation: slideOutRight 0.3s ease-out forwards; }
    @keyframes slideInFade {
        from { opacity: 0; transform: translateX(-20px); }
        to   { opacity: 1; transform: translateX(0); }
    }
    @keyframes slideOutRight {
        from { opacity: 1; transform: translateX(0); }
        to   { opacity: 0; transform: translateX(100%); }
    }
    .task-content {
        display: flex; align-items: center;
        gap: var(--space-sm); flex: 1;
    }
    .task-checkbox {
        width: 20px; height: 20px;
        cursor: pointer; accent-color: var(--accent-primary);
    }
    .task-text { font-size: var(--font-base); color: var(--text-primary); }
    .task-actions {
        display: flex; gap: var(--space-xs);
        opacity: 0; transition: opacity var(--transition-fast);
    }
    .task-item:hover .task-actions { opacity: 1; }
    .task-btn {
        width: 32px; height: 32px; background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: var(--radius-sm); cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: all var(--transition-fast); font-size: var(--font-sm);
    }
    .task-btn:hover { background: var(--bg-elevated); transform: scale(1.1); }
    .delete-btn:hover { border-color: var(--error); }
    .edit-btn:hover   { border-color: var(--info); }
`;
document.head.appendChild(style);

// =============================================================
// Init
// =============================================================

function init() {
    if (voiceToggle && !voiceToggle.checked) {
        voiceBtn.disabled = true;
        state.voiceEnabled = false;
    }
    initSpeechRecognition();
    loadTasks();
    updateSuggestions();

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service worker registered.', reg))
            .catch(err => console.warn('SW registration failed:', err));
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
