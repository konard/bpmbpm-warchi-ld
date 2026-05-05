// 5_publisher_editor.js — Классический drag-and-drop редактор VAD-диаграмм
// Реализует перетаскивание фигур из палитры на холст и сохранение координат в vad:x/vad:y

(function () {
    'use strict';

    // ============================================================================
    // КОНСТАНТЫ
    // ============================================================================

    const VAD_NS = 'http://example.org/vad#';
    const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
    const RDFS_NS = 'http://www.w3.org/2000/01/rdf-schema#';

    const SHAPE_W = 160;
    const SHAPE_H = 60;
    const EXEC_W = 140;
    const EXEC_H = 40;
    const GRID = 20;

    // Цвета для подтипов VAD-процессов
    const SUBTYPE_COLORS = {
        DetailedChild:       { fill: '#90CAF9', stroke: '#1565C0' },
        DetailedExternal:    { fill: '#64B5F6', stroke: '#0D47A1' },
        notDetailedChild:    { fill: '#A5D6A7', stroke: '#2E7D32' },
        notDetailedExternal: { fill: '#C8E6C9', stroke: '#1B5E20' },
        NotDefinedType:      { fill: '#BDBDBD', stroke: '#616161' },
        default:             { fill: '#A5D6A7', stroke: '#2E7D32' }
    };

    // Шаблоны палитры — прямоугольник-стрелка для процесса, эллипс для группы
    const PALETTE_ITEMS = [
        { id: 'palette-process', label: 'Процесс', type: 'process',   fill: '#A5D6A7', stroke: '#2E7D32' },
        { id: 'palette-exec',    label: 'Исполнитель', type: 'executor', fill: '#FFFFCC', stroke: '#B8860B' }
    ];

    // ============================================================================
    // СОСТОЯНИЕ РЕДАКТОРА
    // ============================================================================

    let editorCanvas = null;   // <svg> холст
    let editorShapes = [];     // массив {uri, x, y, w, h, label, subtype, type}
    let selectedShapeUri = null;
    let currentTrigUri = null; // текущий граф

    // drag-and-drop
    let dragState = null; // { type:'move'|'palette', shape, startX, startY, origX, origY, ghostEl }

    // ============================================================================
    // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
    // ============================================================================

    function snapGrid(v) { return Math.round(v / GRID) * GRID; }

    function getLabel(uri) {
        if (!window.currentStore) return uri.split('#').pop().split('/').pop();
        const labelPred = RDFS_NS + 'label';
        const quads = window.currentStore.getQuads(uri, labelPred, null, null);
        if (quads.length > 0) return quads[0].object.value;
        return uri.split('#').pop().split('/').pop();
    }

    function getSubtype(uri) {
        if (!window.currentStore) return 'default';
        const subtypePred = VAD_NS + 'processSubtype';
        const quads = window.currentStore.getQuads(uri, subtypePred, null, null);
        if (quads.length > 0) {
            const val = quads[0].object.value;
            const key = val.split('#').pop();
            if (SUBTYPE_COLORS[key]) return key;
        }
        return 'default';
    }

    function getCoord(uri, prop, graphUri) {
        if (!window.currentStore) return null;
        const pred = VAD_NS + prop;
        let quads = graphUri ? window.currentStore.getQuads(uri, pred, null, graphUri) : [];
        if (quads.length === 0) quads = window.currentStore.getQuads(uri, pred, null, null);
        if (quads.length > 0) return parseInt(quads[0].object.value, 10);
        return null;
    }

    function setCoord(uri, prop, value, graphUri) {
        if (!window.currentStore || !graphUri) return;
        const pred = VAD_NS + prop;
        const xsd = 'http://www.w3.org/2001/XMLSchema#integer';
        // Удаляем старые значения
        const old = window.currentStore.getQuads(uri, pred, null, graphUri);
        old.forEach(q => window.currentStore.removeQuad(q));
        // Добавляем новое
        const N3 = window.N3;
        if (!N3) return;
        const quad = N3.DataFactory.quad(
            N3.DataFactory.namedNode(uri),
            N3.DataFactory.namedNode(pred),
            N3.DataFactory.literal(String(value), N3.DataFactory.namedNode(xsd)),
            N3.DataFactory.namedNode(graphUri)
        );
        window.currentStore.addQuad(quad);
    }

    // ============================================================================
    // ЗАГРУЗКА ФИГУР ИЗ ТЕКУЩЕГО STORE
    // ============================================================================

    function loadShapesFromStore(trigUri) {
        currentTrigUri = trigUri;
        editorShapes = [];
        if (!window.currentStore || !trigUri) return;

        const isSubTrig = VAD_NS + 'isSubprocessTrig';
        const quads = window.currentStore.getQuads(null, isSubTrig, trigUri, null);
        const seen = new Set();

        quads.forEach(q => {
            const uri = q.subject.value;
            if (seen.has(uri)) return;
            seen.add(uri);

            const x = getCoord(uri, 'x', trigUri) ?? getCoord(uri, 'x', null) ?? null;
            const y = getCoord(uri, 'y', trigUri) ?? getCoord(uri, 'y', null) ?? null;
            const label = getLabel(uri);
            const subtype = getSubtype(uri);
            const colors = SUBTYPE_COLORS[subtype] || SUBTYPE_COLORS.default;

            editorShapes.push({
                uri,
                x: x !== null ? x : 50 + editorShapes.length * (SHAPE_W + 20),
                y: y !== null ? y : 80,
                w: SHAPE_W,
                h: SHAPE_H,
                label,
                subtype,
                fill: colors.fill,
                stroke: colors.stroke,
                type: 'process'
            });
        });

        // Также загружаем исполнителей из ExecutorGroup
        // (здесь только для отображения на холсте, без x/y они не размещаются)
    }

    // ============================================================================
    // ОТРИСОВКА SVG-ХОЛСТА
    // ============================================================================

    function buildArrowPath(x, y, w, h) {
        // Форма «стрелка вправо» как у chevron в graphviz
        const notch = Math.min(20, w * 0.15);
        const tip = Math.min(24, w * 0.18);
        return [
            `M ${x} ${y}`,
            `L ${x + w - tip} ${y}`,
            `L ${x + w} ${y + h / 2}`,
            `L ${x + w - tip} ${y + h}`,
            `L ${x} ${y + h}`,
            `L ${x + notch} ${y + h / 2}`,
            'Z'
        ].join(' ');
    }

    function renderEditor() {
        if (!editorCanvas) return;
        const svg = editorCanvas;

        // Очистка (кроме defs)
        Array.from(svg.children).forEach(el => {
            if (el.tagName !== 'defs') svg.removeChild(el);
        });

        // Сетка
        const gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        gridGroup.setAttribute('class', 'editor-grid');

        const svgW = parseInt(svg.getAttribute('width') || 1600, 10);
        const svgH = parseInt(svg.getAttribute('height') || 600, 10);

        for (let gx = 0; gx <= svgW; gx += GRID) {
            const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            ln.setAttribute('x1', gx); ln.setAttribute('y1', 0);
            ln.setAttribute('x2', gx); ln.setAttribute('y2', svgH);
            ln.setAttribute('stroke', '#e8e8e8'); ln.setAttribute('stroke-width', '0.5');
            gridGroup.appendChild(ln);
        }
        for (let gy = 0; gy <= svgH; gy += GRID) {
            const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            ln.setAttribute('x1', 0); ln.setAttribute('y1', gy);
            ln.setAttribute('x2', svgW); ln.setAttribute('y2', gy);
            ln.setAttribute('stroke', '#e8e8e8'); ln.setAttribute('stroke-width', '0.5');
            gridGroup.appendChild(ln);
        }
        svg.appendChild(gridGroup);

        // Стрелки между процессами (hasNext)
        if (window.currentStore && currentTrigUri) {
            const hasNext = VAD_NS + 'hasNext';
            const arrowGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            editorShapes.forEach(src => {
                const nextQuads = window.currentStore.getQuads(src.uri, hasNext, null, currentTrigUri);
                nextQuads.forEach(q => {
                    const tgt = editorShapes.find(s => s.uri === q.object.value);
                    if (!tgt) return;
                    const x1 = src.x + src.w;
                    const y1 = src.y + src.h / 2;
                    const x2 = tgt.x;
                    const y2 = tgt.y + tgt.h / 2;
                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
                    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
                    line.setAttribute('stroke', '#555');
                    line.setAttribute('stroke-width', '1.5');
                    line.setAttribute('marker-end', 'url(#arrowhead)');
                    arrowGroup.appendChild(line);
                });
            });
            svg.appendChild(arrowGroup);
        }

        // Фигуры
        editorShapes.forEach(shape => {
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('class', 'editor-shape' + (shape.uri === selectedShapeUri ? ' selected' : ''));
            g.setAttribute('data-uri', shape.uri);
            g.style.cursor = 'grab';

            // Форма-стрелка
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', buildArrowPath(shape.x, shape.y, shape.w, shape.h));
            path.setAttribute('fill', shape.fill);
            path.setAttribute('stroke', shape.uri === selectedShapeUri ? '#FF6F00' : shape.stroke);
            path.setAttribute('stroke-width', shape.uri === selectedShapeUri ? '2.5' : '1.5');
            g.appendChild(path);

            // Метка
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', shape.x + shape.w / 2 - 8);
            text.setAttribute('y', shape.y + shape.h / 2 + 4);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('font-family', 'Arial, sans-serif');
            text.setAttribute('font-size', '11');
            text.setAttribute('fill', '#1a1a1a');
            text.setAttribute('pointer-events', 'none');

            const shortLabel = shape.label.length > 22 ? shape.label.substring(0, 20) + '…' : shape.label;
            text.textContent = shortLabel;
            g.appendChild(text);

            g.addEventListener('mousedown', onShapeMouseDown);
            svg.appendChild(g);
        });
    }

    // ============================================================================
    // СОБЫТИЯ МЫШИ — ПЕРЕТАСКИВАНИЕ ФИГУР
    // ============================================================================

    function onShapeMouseDown(e) {
        e.preventDefault();
        e.stopPropagation();
        const g = e.currentTarget;
        const uri = g.getAttribute('data-uri');
        const shape = editorShapes.find(s => s.uri === uri);
        if (!shape) return;

        selectedShapeUri = uri;
        updatePropertiesPanel(shape);

        const svgRect = editorCanvas.getBoundingClientRect();
        dragState = {
            type: 'move',
            shape,
            startX: e.clientX,
            startY: e.clientY,
            origX: shape.x,
            origY: shape.y,
            svgRect
        };
        renderEditor();
    }

    function onMouseMove(e) {
        if (!dragState) return;

        if (dragState.type === 'move') {
            const dx = e.clientX - dragState.startX;
            const dy = e.clientY - dragState.startY;
            const nx = snapGrid(dragState.origX + dx);
            const ny = snapGrid(dragState.origY + dy);
            dragState.shape.x = Math.max(0, nx);
            dragState.shape.y = Math.max(0, ny);
            renderEditor();
        } else if (dragState.type === 'palette') {
            // Двигаем призрак
            if (dragState.ghostEl) {
                dragState.ghostEl.style.left = (e.clientX - dragState.ghostOffX) + 'px';
                dragState.ghostEl.style.top = (e.clientY - dragState.ghostOffY) + 'px';
            }
        }
    }

    function onMouseUp(e) {
        if (!dragState) return;

        if (dragState.type === 'move') {
            // Сохраняем координаты в store
            const shape = dragState.shape;
            setCoord(shape.uri, 'x', shape.x, currentTrigUri);
            setCoord(shape.uri, 'y', shape.y, currentTrigUri);
            if (typeof window.logDebug === 'function') {
                window.logDebug('Редактор: перемещён ' + shape.label + ' → (' + shape.x + ',' + shape.y + ')');
            }
        } else if (dragState.type === 'palette') {
            dropFromPalette(e);
        }

        dragState = null;
        renderEditor();
    }

    function dropFromPalette(e) {
        if (dragState.ghostEl) {
            document.body.removeChild(dragState.ghostEl);
            dragState.ghostEl = null;
        }

        const svgRect = editorCanvas.getBoundingClientRect();
        const rawX = e.clientX - svgRect.left;
        const rawY = e.clientY - svgRect.top;

        if (rawX < 0 || rawY < 0 || rawX > svgRect.width || rawY > svgRect.height) return;

        const x = snapGrid(rawX - SHAPE_W / 2);
        const y = snapGrid(rawY - SHAPE_H / 2);

        if (dragState.paletteType === 'process') {
            addNewProcessShape(x, y);
        }
    }

    // ============================================================================
    // ДОБАВЛЕНИЕ НОВОГО ПРОЦЕССА ИЗ ПАЛИТРЫ
    // ============================================================================

    function addNewProcessShape(x, y) {
        if (!currentTrigUri || !window.currentStore) return;
        if (!window.N3) return;

        // Генерируем уникальный URI
        const ts = Date.now();
        const newUri = VAD_NS + 'pNew_' + ts;
        const graphUri = currentTrigUri;

        const N3 = window.N3;
        const xsd = 'http://www.w3.org/2001/XMLSchema#integer';

        // Добавляем в ptree (type, label, parent)
        const ptreeUri = VAD_NS + 'ptree';
        window.currentStore.addQuad(N3.DataFactory.quad(
            N3.DataFactory.namedNode(newUri),
            N3.DataFactory.namedNode(RDF_NS + 'type'),
            N3.DataFactory.namedNode(VAD_NS + 'TypeProcess'),
            N3.DataFactory.namedNode(ptreeUri)
        ));
        const defaultLabel = 'Новый процесс';
        window.currentStore.addQuad(N3.DataFactory.quad(
            N3.DataFactory.namedNode(newUri),
            N3.DataFactory.namedNode(RDFS_NS + 'label'),
            N3.DataFactory.literal(defaultLabel),
            N3.DataFactory.namedNode(ptreeUri)
        ));
        window.currentStore.addQuad(N3.DataFactory.quad(
            N3.DataFactory.namedNode(newUri),
            N3.DataFactory.namedNode(VAD_NS + 'hasParentObj'),
            N3.DataFactory.namedNode(ptreeUri),
            N3.DataFactory.namedNode(ptreeUri)
        ));

        // Добавляем в текущий TriG-граф
        window.currentStore.addQuad(N3.DataFactory.quad(
            N3.DataFactory.namedNode(newUri),
            N3.DataFactory.namedNode(VAD_NS + 'isSubprocessTrig'),
            N3.DataFactory.namedNode(graphUri),
            N3.DataFactory.namedNode(graphUri)
        ));
        window.currentStore.addQuad(N3.DataFactory.quad(
            N3.DataFactory.namedNode(newUri),
            N3.DataFactory.namedNode(VAD_NS + 'x'),
            N3.DataFactory.literal(String(x), N3.DataFactory.namedNode(xsd)),
            N3.DataFactory.namedNode(graphUri)
        ));
        window.currentStore.addQuad(N3.DataFactory.quad(
            N3.DataFactory.namedNode(newUri),
            N3.DataFactory.namedNode(VAD_NS + 'y'),
            N3.DataFactory.literal(String(y), N3.DataFactory.namedNode(xsd)),
            N3.DataFactory.namedNode(graphUri)
        ));

        const colors = SUBTYPE_COLORS.default;
        editorShapes.push({ uri: newUri, x, y, w: SHAPE_W, h: SHAPE_H, label: defaultLabel,
            subtype: 'default', fill: colors.fill, stroke: colors.stroke, type: 'process' });

        selectedShapeUri = newUri;
        updatePropertiesPanel(editorShapes[editorShapes.length - 1]);

        if (typeof window.logDebug === 'function') {
            window.logDebug('Редактор: создан новый процесс ' + newUri + ' в (' + x + ',' + y + ')');
        }
        if (typeof window.updateQuadstoreDisplay === 'function') {
            window.updateQuadstoreDisplay();
        }
        renderEditor();
    }

    // ============================================================================
    // ПАНЕЛЬ СВОЙСТВ ВЫБРАННОГО ЭЛЕМЕНТА
    // ============================================================================

    function updatePropertiesPanel(shape) {
        const panel = document.getElementById('editor-props-panel');
        if (!panel) return;

        panel.innerHTML = `
            <div style="font-size:12px;padding:6px 0;border-bottom:1px solid #eee;margin-bottom:6px;font-weight:bold;">
                Свойства
            </div>
            <label style="font-size:11px;display:block;margin-bottom:3px;">URI:</label>
            <div style="font-size:10px;color:#555;word-break:break-all;margin-bottom:6px;">${shape.uri}</div>
            <label style="font-size:11px;display:block;margin-bottom:3px;">Метка:</label>
            <input id="editor-prop-label" type="text" value="${escapeAttr(shape.label)}"
                style="width:100%;font-size:11px;padding:2px 4px;border:1px solid #ccc;border-radius:3px;margin-bottom:6px;">
            <label style="font-size:11px;display:block;margin-bottom:3px;">X:</label>
            <input id="editor-prop-x" type="number" value="${shape.x}"
                style="width:100%;font-size:11px;padding:2px 4px;border:1px solid #ccc;border-radius:3px;margin-bottom:6px;">
            <label style="font-size:11px;display:block;margin-bottom:3px;">Y:</label>
            <input id="editor-prop-y" type="number" value="${shape.y}"
                style="width:100%;font-size:11px;padding:2px 4px;border:1px solid #ccc;border-radius:3px;margin-bottom:6px;">
            <label style="font-size:11px;display:block;margin-bottom:3px;">Подтип:</label>
            <div style="font-size:11px;color:#555;margin-bottom:8px;">${shape.subtype}</div>
            <button onclick="editorApplyProps()" class="btn btn-primary" style="width:100%;font-size:11px;padding:4px;">Применить</button>
        `;
    }

    function escapeAttr(s) {
        return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    window.editorApplyProps = function () {
        const shape = editorShapes.find(s => s.uri === selectedShapeUri);
        if (!shape || !window.currentStore || !window.N3) return;

        const newLabel = document.getElementById('editor-prop-label')?.value ?? shape.label;
        const newX = parseInt(document.getElementById('editor-prop-x')?.value ?? shape.x, 10);
        const newY = parseInt(document.getElementById('editor-prop-y')?.value ?? shape.y, 10);

        // Обновляем метку в store
        const labelPred = RDFS_NS + 'label';
        const N3 = window.N3;
        // Удаляем старые метки
        window.currentStore.getQuads(shape.uri, labelPred, null, null).forEach(q => {
            window.currentStore.removeQuad(q);
        });
        // Добавляем новую метку в ptree
        window.currentStore.addQuad(N3.DataFactory.quad(
            N3.DataFactory.namedNode(shape.uri),
            N3.DataFactory.namedNode(labelPred),
            N3.DataFactory.literal(newLabel),
            N3.DataFactory.namedNode(VAD_NS + 'ptree')
        ));

        shape.label = newLabel;
        shape.x = isNaN(newX) ? shape.x : newX;
        shape.y = isNaN(newY) ? shape.y : newY;

        setCoord(shape.uri, 'x', shape.x, currentTrigUri);
        setCoord(shape.uri, 'y', shape.y, currentTrigUri);

        if (typeof window.logDebug === 'function') {
            window.logDebug('Редактор: изменены свойства ' + shape.label);
        }
        renderEditor();
    };

    // ============================================================================
    // ПАЛИТРА (drag из палитры на холст)
    // ============================================================================

    function buildPalette() {
        const palette = document.getElementById('editor-palette');
        if (!palette) return;
        palette.innerHTML = '';

        PALETTE_ITEMS.forEach(item => {
            const el = document.createElement('div');
            el.className = 'editor-palette-item';
            el.setAttribute('data-type', item.type);
            el.title = 'Перетащите на холст';

            const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svgEl.setAttribute('width', '80');
            svgEl.setAttribute('height', '34');
            svgEl.setAttribute('viewBox', '0 0 80 34');
            svgEl.style.pointerEvents = 'none';

            if (item.type === 'process') {
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', buildArrowPath(2, 2, 76, 30));
                path.setAttribute('fill', item.fill);
                path.setAttribute('stroke', item.stroke);
                path.setAttribute('stroke-width', '1.5');
                svgEl.appendChild(path);
            } else {
                const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
                ellipse.setAttribute('cx', '40'); ellipse.setAttribute('cy', '17');
                ellipse.setAttribute('rx', '36'); ellipse.setAttribute('ry', '14');
                ellipse.setAttribute('fill', item.fill);
                ellipse.setAttribute('stroke', item.stroke);
                ellipse.setAttribute('stroke-width', '1.5');
                svgEl.appendChild(ellipse);
            }

            const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            txt.setAttribute('x', '40'); txt.setAttribute('y', '21');
            txt.setAttribute('text-anchor', 'middle');
            txt.setAttribute('font-family', 'Arial, sans-serif');
            txt.setAttribute('font-size', '9');
            txt.setAttribute('fill', '#1a1a1a');
            txt.textContent = item.label;
            svgEl.appendChild(txt);

            el.appendChild(svgEl);
            el.addEventListener('mousedown', onPaletteMouseDown);
            palette.appendChild(el);
        });
    }

    function onPaletteMouseDown(e) {
        e.preventDefault();
        const el = e.currentTarget;
        const type = el.getAttribute('data-type');
        const rect = el.getBoundingClientRect();

        // Создаём призрак
        const ghost = el.cloneNode(true);
        ghost.style.position = 'fixed';
        ghost.style.left = (e.clientX - rect.width / 2) + 'px';
        ghost.style.top = (e.clientY - rect.height / 2) + 'px';
        ghost.style.width = rect.width + 'px';
        ghost.style.height = rect.height + 'px';
        ghost.style.opacity = '0.7';
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '9999';
        document.body.appendChild(ghost);

        dragState = {
            type: 'palette',
            paletteType: type,
            ghostEl: ghost,
            ghostOffX: rect.width / 2,
            ghostOffY: rect.height / 2
        };
    }

    // ============================================================================
    // ИНИЦИАЛИЗАЦИЯ РЕДАКТОРА
    // ============================================================================

    function initEditor() {
        const container = document.getElementById('editor-canvas-container');
        if (!container) return;

        editorCanvas = document.getElementById('editor-canvas-svg');
        if (!editorCanvas) {
            editorCanvas = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            editorCanvas.id = 'editor-canvas-svg';
            editorCanvas.setAttribute('width', '1600');
            editorCanvas.setAttribute('height', '600');
            editorCanvas.style.background = '#fafafa';
            editorCanvas.style.border = '1px solid #ddd';
            editorCanvas.style.display = 'block';
            editorCanvas.style.cursor = 'default';

            // Маркер стрелки
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', 'arrowhead');
            marker.setAttribute('markerWidth', '10');
            marker.setAttribute('markerHeight', '7');
            marker.setAttribute('refX', '10');
            marker.setAttribute('refY', '3.5');
            marker.setAttribute('orient', 'auto');
            const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            arrow.setAttribute('points', '0 0, 10 3.5, 0 7');
            arrow.setAttribute('fill', '#555');
            marker.appendChild(arrow);
            defs.appendChild(marker);
            editorCanvas.appendChild(defs);

            container.appendChild(editorCanvas);
        }

        // Глобальные обработчики мыши
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        buildPalette();

        // Кнопка «Обновить редактор»
        const refreshBtn = document.getElementById('editor-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function () {
                refreshEditor();
            });
        }
    }

    // ============================================================================
    // ПУБЛИЧНЫЙ ИНТЕРФЕЙС
    // ============================================================================

    /**
     * Обновляет редактор из текущего selectedTrigUri
     */
    function refreshEditor() {
        const trigUri = window.selectedTrigUri;
        if (!trigUri) {
            if (typeof window.logDebug === 'function') {
                window.logDebug('Редактор: нет выбранного TriG графа. Выберите диаграмму в дереве.');
            }
            return;
        }
        loadShapesFromStore(trigUri);
        renderEditor();

        if (typeof window.logDebug === 'function') {
            window.logDebug('Редактор: загружено ' + editorShapes.length + ' фигур из ' + trigUri);
        }

        // Сброс свойств
        const panel = document.getElementById('editor-props-panel');
        if (panel) panel.innerHTML = '<div style="color:#aaa;font-size:11px;padding:6px;">Выберите фигуру</div>';
    }

    window.editorRefresh = refreshEditor;
    window.editorInit = initEditor;

    // Автозапуск при загрузке DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initEditor);
    } else {
        initEditor();
    }

})();
