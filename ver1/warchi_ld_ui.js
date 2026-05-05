// warchi_ld_ui.js — UI модуль warchi-ld: меню, тулбар, боковая панель, инициализация
// Внешний вид: warchi.ru | Движок: rdf-grapher/ver9d
// Новые элементы UI (относительно warchi.ru) помечены "_" в конце названия

// ============================================================================
// ОТЛАДОЧНЫЙ ЛОГ
// ============================================================================

var debugLogLines = [];

/**
 * Добавляет строку в отладочный лог и отображает в окне отладки
 */
function logDebug(message) {
    var ts = new Date().toLocaleTimeString();
    var line = '[' + ts + '] ' + message;
    debugLogLines.push(line);
    var el = document.getElementById('debug-log-content');
    if (el) {
        el.textContent = debugLogLines.join('\n');
        el.scrollTop = el.scrollHeight;
    }
    console.log(line);
}

function toggleDebugWindow() {
    var win = document.getElementById('debug-window');
    if (!win) return;
    win.style.display = (win.style.display === 'none' || win.style.display === '') ? 'flex' : 'none';
}

function clearDebugLog() {
    debugLogLines = [];
    var el = document.getElementById('debug-log-content');
    if (el) el.textContent = '';
}

// ============================================================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================================================

/**
 * Точка входа — вызывается при DOMContentLoaded из index.html
 */
function initWarchiLD() {
    initMenuBar();
    initSidebar();
    initStatusBar();
    loadConfig();
    scanDiaFolder();
    initDebugWindow();
    // Загрузить онтологию VAD при старте
    loadVADOntologyOnStart();
    var startMsg = 'warchi-ld запущен. Загрузите файл или выберите пример.';
    setStatus(startMsg);
    logDebug(startMsg);
}

function initDebugWindow() {
    var win = document.getElementById('debug-window');
    if (!win) return;
    // Сделать окно перетаскиваемым
    var header = win.querySelector('.debug-window-header');
    if (!header) return;
    var isDragging = false, startX, startY, startLeft, startTop;
    header.addEventListener('mousedown', function(e) {
        if (e.target.tagName === 'BUTTON') return;
        isDragging = true;
        startX = e.clientX; startY = e.clientY;
        startLeft = win.offsetLeft; startTop = win.offsetTop;
        e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        win.style.left = (startLeft + e.clientX - startX) + 'px';
        win.style.top = (startTop + e.clientY - startY) + 'px';
        win.style.right = 'auto';
        win.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', function() { isDragging = false; });
}

// ============================================================================
// СТРОКА МЕНЮ
// ============================================================================

/**
 * Инициализирует обработчики строки меню (click outside = close)
 */
function initMenuBar() {
    document.querySelectorAll('.menu-item').forEach(function(item) {
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            const isOpen = item.classList.contains('menu-item--open');
            closeAllMenuDropdowns();
            if (!isOpen) {
                item.classList.add('menu-item--open');
            }
        });
    });
    document.addEventListener('click', closeAllMenuDropdowns);
}

function closeAllMenuDropdowns() {
    document.querySelectorAll('.menu-item--open').forEach(function(item) {
        item.classList.remove('menu-item--open');
    });
}

// ============================================================================
// БОКОВАЯ ПАНЕЛЬ (навигатор)
// ============================================================================

let sidebarVisible = true;

function initSidebar() {
    // По умолчанию боковая панель открыта
    sidebarVisible = true;
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const openBtn = document.getElementById('sidebar-open-btn');
    if (sidebarVisible) {
        sidebar.style.display = 'none';
        openBtn.style.display = 'block';
        sidebarVisible = false;
    } else {
        sidebar.style.display = 'flex';
        openBtn.style.display = 'none';
        sidebarVisible = true;
    }
}

function showSidebarTab(tabName) {
    // Переключение вкладок навигатора
    ['treeview', 'properties'].forEach(function(name) {
        const content = document.getElementById('sidebar-tab-' + name);
        const btn = document.getElementById('tab-' + name);
        if (content) {
            content.classList.toggle('sidebar-tab-content--hidden', name !== tabName);
        }
        if (btn) {
            btn.classList.toggle('sidebar-tab--active', name === tabName);
        }
    });
}

// ============================================================================
// СТАТУСНАЯ СТРОКА
// ============================================================================

function initStatusBar() {
    updateStatusBar();
}

function setStatus(text) {
    const el = document.getElementById('status-text');
    if (el) el.textContent = text;
    // Дублируем в menu-status
    const ms = document.getElementById('menu-status');
    if (ms) ms.textContent = text;
    // Дублируем в отладочный лог (только если это не рекурсивный вызов из logDebug)
    logDebug('[status] ' + text);
}

function updateStatusBar() {
    // Обновляет счётчики триплетов и графов из глобального quadstore
    try {
        if (typeof window.quadstore !== 'undefined' && window.quadstore) {
            const triples = document.getElementById('status-triples');
            const graphs = document.getElementById('status-graphs');
            // vadlib_logic.js хранит данные в глобальных переменных
            if (triples && typeof window.globalRdfStore !== 'undefined') {
                // Подсчёт через N3.Store
            }
        }
    } catch(e) {}
}

// ============================================================================
// ЗАГРУЗКА КОНФИГУРАЦИИ (config.json)
// ============================================================================

function loadConfig() {
    fetch('config.json')
        .then(function(r) { return r.json(); })
        .then(function(cfg) {
            // Применяем свёрнутость панелей из конфига
            Object.keys(cfg).forEach(function(key) {
                if (cfg[key] && cfg[key].collapsed) {
                    const content = document.getElementById('content-' + key);
                    const toggle = document.getElementById('toggle-' + key);
                    if (content) content.style.display = 'none';
                    if (toggle) toggle.innerHTML = '&#9654;';
                }
            });
        })
        .catch(function() {
            // config.json не найден — используем defaults
        });
}

// ============================================================================
// СКАНИРОВАНИЕ ПАПКИ /dia (список примеров)
// ============================================================================

function scanDiaFolder() {
    // Список файлов TTL из папки dia (статически заданный для GitHub Pages)
    const diaFiles = [
        'Trig_VADv8.ttl',
        'Trig_VADv8_warchi.warchi'
    ];
    const select = document.getElementById('example-select');
    if (!select) return;

    diaFiles.forEach(function(filename) {
        const opt = document.createElement('option');
        opt.value = 'dia/' + filename;
        opt.textContent = filename;
        select.appendChild(opt);
    });
}

/**
 * Загружает выбранный пример из папки /dia
 * Вызывается при изменении select#example-select
 */
function loadSelectedExample() {
    const select = document.getElementById('example-select');
    if (!select || !select.value) return;

    const filePath = select.value;
    const filename = filePath.split('/').pop();
    const ext = filename.split('.').pop().toLowerCase();

    logDebug('Загрузка примера: ' + filePath);
    setStatus('Загрузка примера: ' + filename + '…');

    // Обработка .warchi файлов (через конвертер)
    if (ext === 'warchi') {
        fetch(filePath)
            .then(function(r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.text();
            })
            .then(function(text) {
                if (typeof importWarchiFile_ === 'function') {
                    importWarchiFile_(text);
                } else {
                    // Пробуем загрузить как текст напрямую
                    var rdfInput = document.getElementById('rdf-input');
                    if (rdfInput) rdfInput.value = text;
                }
                setStatus('Файл warchi загружен: ' + filename);
                logDebug('Файл warchi загружен: ' + filename);
            })
            .catch(function(err) {
                var msg = 'Ошибка загрузки ' + filename + ': ' + err.message;
                setStatus(msg);
                logDebug('ОШИБКА: ' + msg);
            });
        return;
    }

    // Обработка TTL/TriG файлов
    fetch(filePath)
        .then(function(r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
        })
        .then(function(text) {
            var rdfInput = document.getElementById('rdf-input');
            if (rdfInput) rdfInput.value = text;

            // Устанавливаем формат и режим
            var formatSelect = document.getElementById('input-format');
            if (formatSelect) formatSelect.value = 'trig';
            var modeSelect = document.getElementById('visualization-mode');
            if (modeSelect) modeSelect.value = 'vad-trig';
            if (typeof updateModeDescription === 'function') updateModeDescription();

            var statusEl = document.getElementById('example-status');
            if (statusEl) {
                statusEl.textContent = 'Файл ' + filename + ' успешно загружен';
                statusEl.style.display = 'block';
                statusEl.style.backgroundColor = '#d4edda';
                statusEl.style.borderColor = '#c3e6cb';
                statusEl.style.color = '#155724';
            }

            setStatus('Файл загружен: ' + filename);
            logDebug('Файл загружен: ' + filename + ' (' + text.length + ' символов)');

            // Автоматически визуализируем
            if (typeof refreshVisualization === 'function') {
                refreshVisualization();
            }

            // Разворачиваем панель Publisher
            if (typeof applyPanelCollapsedState === 'function') {
                applyPanelCollapsedState('5_publisher', false);
            }
        })
        .catch(function(err) {
            var msg = 'Ошибка загрузки ' + filename + ': ' + err.message;
            setStatus(msg);
            logDebug('ОШИБКА: ' + msg);
            var statusEl = document.getElementById('example-status');
            if (statusEl) {
                statusEl.textContent = msg;
                statusEl.style.display = 'block';
                statusEl.style.backgroundColor = '#f8d7da';
                statusEl.style.borderColor = '#f5c6cb';
                statusEl.style.color = '#721c24';
            }
        });
}

// ============================================================================
// СВОРАЧИВАЕМЫЕ ПАНЕЛИ
// ============================================================================

function togglePanel(panelName) {
    const content = document.getElementById('content-' + panelName);
    const toggle = document.getElementById('toggle-' + panelName);
    if (!content) return;
    const isVisible = content.style.display !== 'none';
    content.style.display = isVisible ? 'none' : '';
    if (toggle) toggle.innerHTML = isVisible ? '&#9654;' : '&#9660;';
}

// ============================================================================
// НОВЫЙ ПРОЕКТ
// ============================================================================

function newProject() {
    closeAllMenuDropdowns();
    if (!confirm('Создать новый проект? Все несохранённые данные будут потеряны.')) return;
    clearRdfInput();
    setStatus('Новый проект создан');
}

function openProject() {
    closeAllMenuDropdowns();
    document.getElementById('file-input').click();
}

// ============================================================================
// RDF EDIT WINDOW
// ============================================================================

function showRdfEditWindow() {
    closeAllMenuDropdowns();
    const textarea = document.getElementById('rdf-edit-textarea');
    const mainTextarea = document.getElementById('rdf-input');
    if (textarea && mainTextarea) {
        textarea.value = mainTextarea.value;
    }
    const win = document.getElementById('rdf-edit-window');
    const overlay = document.getElementById('modal-overlay');
    if (win) win.style.display = 'block';
    if (overlay) overlay.style.display = 'block';
}

function closeRdfEditWindow() {
    const win = document.getElementById('rdf-edit-window');
    const overlay = document.getElementById('modal-overlay');
    if (win) win.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
}

function applyRdfEdit() {
    const textarea = document.getElementById('rdf-edit-textarea');
    const mainTextarea = document.getElementById('rdf-input');
    if (textarea && mainTextarea) {
        mainTextarea.value = textarea.value;
        // Перезагружаем данные в triplestore
        if (typeof parseAndLoadRDF === 'function') {
            parseAndLoadRDF(textarea.value);
        }
    }
    closeRdfEditWindow();
    setStatus('RDF данные обновлены');
}

// ============================================================================
// VIRTUAL TRIG WINDOW
// ============================================================================

function showVirtualTriGWindow() {
    closeAllMenuDropdowns();
    const win = document.getElementById('virtual-trig-window');
    const overlay = document.getElementById('modal-overlay');
    // Получаем виртуальные данные через 10_virtualTriG_logic.js
    if (typeof getVirtualTriGText === 'function') {
        const textarea = document.getElementById('virtual-trig-textarea');
        if (textarea) {
            textarea.value = getVirtualTriGText() || '(Нет виртуальных данных)';
        }
    }
    if (win) win.style.display = 'block';
    if (overlay) overlay.style.display = 'block';
}

function closeVirtualTriGWindow() {
    const win = document.getElementById('virtual-trig-window');
    const overlay = document.getElementById('modal-overlay');
    if (win) win.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
}

function closeAllModals() {
    document.querySelectorAll('.modal-window').forEach(function(w) {
        w.style.display = 'none';
    });
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.style.display = 'none';
}

// ============================================================================
// ЗУМ ДИАГРАММЫ
// ============================================================================

let currentZoom = 1.0;

function zoomIn_() {
    currentZoom = Math.min(currentZoom + 0.1, 5.0);
    applyZoom_();
}

function zoomOut_() {
    currentZoom = Math.max(currentZoom - 0.1, 0.1);
    applyZoom_();
}

function zoomReset_() {
    currentZoom = 1.0;
    applyZoom_();
}

function applyZoom_() {
    const output = document.getElementById('output');
    if (output) {
        const svg = output.querySelector('svg');
        if (svg) {
            svg.style.transform = 'scale(' + currentZoom + ')';
            svg.style.transformOrigin = 'top left';
        }
    }
}

// ============================================================================
// ОБНОВЛЕНИЕ ДИАГРАММЫ
// ============================================================================

function refreshVisualization() {
    closeAllMenuDropdowns();
    if (typeof visualize === 'function') {
        visualize();
    }
}

// ============================================================================
// ЭКСПОРТ
// ============================================================================

function exportSVG() {
    closeAllMenuDropdowns();
    if (typeof exportSvg === 'function') {
        exportSvg();
    } else {
        const output = document.getElementById('output');
        if (!output) return;
        const svg = output.querySelector('svg');
        if (!svg) { alert('Нет диаграммы для экспорта'); return; }
        const blob = new Blob([svg.outerHTML], {type: 'image/svg+xml'});
        downloadBlob_(blob, 'diagram.svg');
    }
}

function exportPNG() {
    closeAllMenuDropdowns();
    if (typeof exportPng === 'function') {
        exportPng();
    } else {
        alert('Для экспорта PNG сначала визуализируйте диаграмму');
    }
}

function downloadBlob_(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// ============================================================================
// ЗАГРУЗКА ОНТОЛОГИИ VAD ПРИ СТАРТЕ
// ============================================================================

function loadVADOntologyOnStart() {
    // Загружает онтологию из ontology/vad-basic-ontology.trig и tech_Appendix
    const files = [
        'ontology/vad-basic-ontology.trig',
        'ontology/vad-basic-ontology_tech_Appendix.trig'
    ];
    Promise.all(files.map(function(f) {
        return fetch(f).then(function(r) {
            if (!r.ok) return '';
            return r.text();
        }).catch(function() { return ''; });
    })).then(function(contents) {
        const combined = contents.filter(Boolean).join('\n\n');
        if (combined && typeof loadTechAppendix === 'function') {
            loadTechAppendix(combined);
        }
    });
}

// ============================================================================
// CUSTOM НОТАЦИЯ (заглушка — расширяется в будущих версиях)
// ============================================================================

function openCustomNotationDialog_() {
    closeAllMenuDropdowns();
    alert('Механизм Custom нотации: добавьте свои классы и свойства в ontology/ и перезагрузите страницу.\nПодробнее: doc/Custom/readme.md');
}

// ============================================================================
// СПРАВКА И О ПРОГРАММЕ
// ============================================================================

function showHelp() {
    closeAllMenuDropdowns();
    window.open('doc/readme.md', '_blank');
}

function showAbout() {
    closeAllMenuDropdowns();
    alert('warchi-ld ver1\nАрхитектурный редактор VAD на базе Linked Data\nДвижок: rdf-grapher/ver9d (quadstore/N3.js)\nИнтерфейс: warchi.ru\nhttps://github.com/bpmbpm/warchi-ld');
}

// ============================================================================
// ХЕЛПЕР: ПОЛУЧИТЬ ТЕКСТ VIRTUAL TRIG
// ============================================================================

function getVirtualTriGText() {
    // Пробует получить виртуальные данные из глобального хранилища
    if (typeof getVirtualRdfData === 'function') {
        return getVirtualRdfData();
    }
    const el = document.getElementById('rdf-input');
    return el ? '(Virtual TriG: ' + el.value.length + ' символов в quadstore)' : '';
}
