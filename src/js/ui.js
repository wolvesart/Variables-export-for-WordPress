// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
        // Remove active class from all tabs and contents
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        // Add active class to clicked tab and corresponding content
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    };
});

// Collection colors palette
const collectionColors = ['#DDCAF9', '#EAF99B', '#F2BC9C', '#C7F6FD', '#D0FDD5', '#E8E8E8'];
const inactiveColor = '#39393B';

// Store collections state
let collectionsData = [];
let activeCollections = new Set();

// Render collections grid
function renderCollections(collections) {
    collectionsData = collections;
    activeCollections = new Set(collections.map(c => c.id));

    const grid = document.getElementById('collections-grid');
    const section = document.getElementById('collections-section');

    if (collections.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    grid.innerHTML = '';

    // Add "All" button first
    const allItem = document.createElement('div');
    allItem.className = 'collection-item';
    allItem.textContent = 'All';
    allItem.style.background = '#FFFFFF';
    allItem.style.setProperty('--item-color', '#FFFFFF');
    allItem.style.fontWeight = '600';

    allItem.onclick = () => {
        const items = grid.querySelectorAll('.collection-item:not(:first-child)');

        if (activeCollections.size < collections.length) {
            // Reactivate all collections
            collections.forEach((collection, index) => {
                activeCollections.add(collection.id);
            });

            // Update all collection items to active state
            items.forEach((item, index) => {
                const color = collectionColors[index % collectionColors.length];
                item.style.background = color;
                item.style.setProperty('--item-color', color);
                item.classList.remove('inactive');
            });

            // Mark "All" button as active
            allItem.style.background = '#FFFFFF';
            allItem.style.setProperty('--item-color', '#FFFFFF');
            allItem.classList.remove('inactive');
        } else {
            // Deactivate all collections
            activeCollections.clear();

            // Update all collection items to inactive state
            items.forEach(item => {
                item.style.setProperty('--item-color', 'var(--color-green-500)');
                item.classList.add('inactive');
            });

            // Mark "All" button as inactive
            allItem.style.setProperty('--item-color', 'var(--color-green-500)');
            allItem.classList.add('inactive');
        }

        schedulePreview();
    };

    grid.appendChild(allItem);

    collections.forEach((collection, index) => {
        const item = document.createElement('div');
        const itemColor = collectionColors[index % collectionColors.length];
        item.className = 'collection-item';
        item.dataset.id = collection.id;
        item.textContent = collection.name;
        item.style.background = itemColor;
        item.style.setProperty('--item-color', itemColor);

        item.onclick = () => {
            if (activeCollections.has(collection.id)) {
                activeCollections.delete(collection.id);
                item.style.setProperty('--item-color', 'var(--color-green-500)');
                item.classList.add('inactive');
            } else {
                activeCollections.add(collection.id);
                item.style.background = itemColor;
                item.style.setProperty('--item-color', itemColor);
                item.classList.remove('inactive');
            }

            // Update "All" button state - active only when ALL collections are selected
            if (activeCollections.size === collections.length) {
                allItem.style.background = '#FFFFFF';
                allItem.style.setProperty('--item-color', '#FFFFFF');
                allItem.classList.remove('inactive');
            } else {
                allItem.style.setProperty('--item-color', 'var(--color-green-500)');
                allItem.classList.add('inactive');
            }

            schedulePreview();
        };

        grid.appendChild(item);
    });
}

// Draw donut chart with SVG
function drawPieChart(used, unused) {
    const svg = document.getElementById('pieChart');
    const total = used + unused;

    if (total === 0) {
        document.getElementById('chart-percent').textContent = '-';
        return;
    }

    // Clear previous content
    svg.innerHTML = '';

    const centerX = 30;
    const centerY = 30;
    const radius = 24;
    const strokeWidth = 6;

    // Calculate percentage and angles
    const percent = Math.round((used / total) * 100);
    const circumference = 2 * Math.PI * radius;
    const usedLength = (used / total) * circumference;
    const unusedLength = (unused / total) * circumference;

    // Get CSS custom properties
    const styles = getComputedStyle(document.documentElement);
    const purpleColor = styles.getPropertyValue('--color-purple-500').trim();
    const greenColor = styles.getPropertyValue('--color-green-500').trim();

    // Create background circle (unused - green)
    const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bgCircle.setAttribute('cx', centerX);
    bgCircle.setAttribute('cy', centerY);
    bgCircle.setAttribute('r', radius);
    bgCircle.setAttribute('fill', 'none');
    bgCircle.setAttribute('stroke', greenColor);
    bgCircle.setAttribute('stroke-width', strokeWidth);
    bgCircle.setAttribute('stroke-linecap', 'butt');
    svg.appendChild(bgCircle);

    // Create progress circle (used - purple) if there are used variables
    if (used > 0) {
        const progressCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        progressCircle.setAttribute('cx', centerX);
        progressCircle.setAttribute('cy', centerY);
        progressCircle.setAttribute('r', radius);
        progressCircle.setAttribute('fill', 'none');
        progressCircle.setAttribute('stroke', purpleColor);
        progressCircle.setAttribute('stroke-width', strokeWidth);
        progressCircle.setAttribute('stroke-linecap', 'butt');
        progressCircle.setAttribute('stroke-dasharray', `${usedLength} ${circumference}`);
        progressCircle.setAttribute('stroke-dashoffset', circumference / 4);
        progressCircle.setAttribute('transform', `rotate(-90 ${centerX} ${centerY})`);
        svg.appendChild(progressCircle);
    }

    // Update percentage
    document.getElementById('chart-percent').textContent = percent + '%';
}

// Download button: build a ZIP with all export files (SCSS + DTCG)
document.getElementById('generate').onclick = () => {
    console.log('Sending generate message');

    parent.postMessage({
        pluginMessage: {
            type: 'generate',
            options: {
                onlyUsed: document.getElementById('onlyUsed').checked,
                selectedCollections: Array.from(activeCollections),
                formats: { scss: true, dtcg: true }
            }
        }
    }, '*');
};

// ---- Export preview: file lists with per-file copy / download ----
let previewFiles = [];
let previewTimer = null;

// Ask code.js to (re)build the file set for the current options.
function requestPreview() {
    parent.postMessage({
        pluginMessage: {
            type: 'preview',
            options: {
                onlyUsed: document.getElementById('onlyUsed').checked,
                selectedCollections: Array.from(activeCollections)
            }
        }
    }, '*');
}

// Debounced: rapid collection toggles shouldn't trigger a burst of regenerations.
function schedulePreview() {
    setFileListsLoading();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(requestPreview, 250);
}

function setFileListsLoading() {
    ['scss-files-list', 'dtcg-files-list'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<div class="file-list-empty">Generating preview…</div>';
    });
}

// Render both file lists, dispatching each file to the right section by extension.
function renderFileLists(files) {
    previewFiles = files || [];
    const scssList = document.getElementById('scss-files-list');
    const dtcgList = document.getElementById('dtcg-files-list');
    scssList.innerHTML = '';
    dtcgList.innerHTML = '';

    previewFiles.forEach(file => {
        const target = file.filename.endsWith('.json') ? dtcgList : scssList;
        target.appendChild(createFileRow(file));
    });

    if (!scssList.children.length) scssList.innerHTML = '<div class="file-list-empty">No SCSS file</div>';
    if (!dtcgList.children.length) dtcgList.innerHTML = '<div class="file-list-empty">No token file</div>';
}

function createFileRow(file) {
    const row = document.createElement('div');
    row.className = 'file-row';

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = file.filename;

    const actions = document.createElement('div');
    actions.className = 'file-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'file-btn file-btn-copy';
    copyBtn.title = 'Copy';
    copyBtn.setAttribute('aria-label', 'Copy ' + file.filename);
    copyBtn.innerHTML = '<span class="icon"></span>';
    copyBtn.onclick = () => copyFileContent(file.content, copyBtn, file.filename);

    const dlBtn = document.createElement('button');
    dlBtn.className = 'file-btn file-btn-download';
    dlBtn.title = 'Download';
    dlBtn.setAttribute('aria-label', 'Download ' + file.filename);
    dlBtn.innerHTML = '<span class="icon"></span>';
    dlBtn.onclick = () => downloadSingleFile(file);

    actions.appendChild(copyBtn);
    actions.appendChild(dlBtn);
    row.appendChild(name);
    row.appendChild(actions);
    return row;
}

function copyFileContent(text, btn, filename) {
    const done = () => {
        btn.classList.add('copied');
        setTimeout(() => btn.classList.remove('copied'), 1200);
        // Native Figma toast, triggered via code.js
        parent.postMessage({
            pluginMessage: { type: 'notify', message: '📋 ' + filename + ' copied to clipboard' }
        }, '*');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
        fallbackCopy(text, done);
    }
}

// Clipboard fallback for environments where navigator.clipboard is unavailable.
function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
    if (done) done();
}

function downloadSingleFile(file) {
    const blob = new Blob([file.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Rebuild the preview whenever the "only used" option changes.
document.getElementById('onlyUsed').addEventListener('change', schedulePreview);

// Cancel button (SCSS)
document.getElementById('cancel').onclick = () => {
    console.log('Sending cancel message');

    parent.postMessage({
        pluginMessage: {
            type: 'cancel'
        }
    }, '*');
};

// Populate mapping dropdowns with variable groups
function populateMappingDropdowns(variableGroups) {
    const selects = document.querySelectorAll('.mapping-select');

    // Keywords for auto-matching groups to mappings
    const matchPatterns = {
        'map-colors': ['color', 'colour', 'palette', 'couleur'],
        'map-fontFamilies': ['family', 'families', 'font-family', 'typeface', 'police'],
        'map-fontSizes': ['size', 'font-size', 'text-size', 'taille'],
        'map-spacing': ['spacing', 'space', 'gap', 'margin', 'padding', 'espacement'],
        'map-radius': ['radius', 'corner', 'round', 'border-radius', 'rayon']
    };

    selects.forEach(select => {
        const selectId = select.id;
        // Keep the first option (-- Select --)
        select.innerHTML = '<option value="">-- Select --</option>';

        // Filter groups based on the expected type for this mapping
        let filteredGroups = variableGroups;

        // Filter by type based on which mapping this is
        if (selectId === 'map-colors') {
            filteredGroups = variableGroups.filter(g => g.types.includes('COLOR'));
        } else if (selectId === 'map-fontFamilies') {
            filteredGroups = variableGroups.filter(g => g.types.includes('STRING'));
        } else if (selectId === 'map-fontSizes' || selectId === 'map-spacing' || selectId === 'map-radius') {
            filteredGroups = variableGroups.filter(g => g.types.includes('FLOAT'));
        }

        // Add groups as options with collection name prefix
        let bestMatch = null;
        const patterns = matchPatterns[selectId] || [];

        filteredGroups.forEach(group => {
            const option = document.createElement('option');
            option.value = group.id;
            option.textContent = group.collectionName + ' / ' + group.name;
            select.appendChild(option);

            // Check if group name matches any pattern for auto-selection
            const groupNameLower = group.name.toLowerCase();
            for (const pattern of patterns) {
                if (groupNameLower.includes(pattern) || groupNameLower === pattern) {
                    bestMatch = group.id;
                    break;
                }
            }
        });

        // Auto-select the best match if found
        if (bestMatch) {
            select.value = bestMatch;
        }
    });
}

// Get current mappings
function getMappings() {
    return {
        colors: document.getElementById('map-colors').value,
        fontFamilies: document.getElementById('map-fontFamilies').value,
        fontSizes: document.getElementById('map-fontSizes').value,
        spacing: document.getElementById('map-spacing').value,
        radius: document.getElementById('map-radius').value
    };
}

// Generate theme.json button
document.getElementById('generateTheme').onclick = () => {
    const mappings = getMappings();
    const onlyUsed = document.getElementById('onlyUsedTheme').checked;

    console.log('Sending generate-theme message with mappings');

    parent.postMessage({
        pluginMessage: {
            type: 'generate-theme',
            mappings: mappings,
            onlyUsed: onlyUsed
        }
    }, '*');
};

// Cancel theme.json button
document.getElementById('cancelTheme').onclick = () => {
    parent.postMessage({
        pluginMessage: {
            type: 'cancel'
        }
    }, '*');
};

// Réception des messages depuis code.js
window.onmessage = async (event) => {
    const msg = event.data.pluginMessage;
    console.log('Message received:', msg);

    if (msg.type === 'initial-stats') {
        // Lightweight stats: render the dashboard immediately. Used/unused counts
        // arrive later via the 'usage-stats' message, so show a placeholder for now.
        document.getElementById('stat-total').textContent = msg.stats.total;
        document.getElementById('stat-exported').textContent = '…';
        document.getElementById('stat-skipped').textContent = '…';
        document.getElementById('chart-percent').textContent = '…';
        document.getElementById('dashboard').classList.add('show');
        document.getElementById('chart-hint').style.display = 'none';

        // Render collections grid
        if (msg.collections) {
            renderCollections(msg.collections);
        }

        // Populate mapping dropdowns with variable groups for theme.json tab
        if (msg.variableGroups) {
            populateMappingDropdowns(msg.variableGroups);
        }

        // Build the initial export preview (file lists) in the background.
        requestPreview();
    }

    if (msg.type === 'preview-files') {
        // File set for the current options: populate the SCSS / DTCG lists.
        renderFileLists(msg.files);
    }

    if (msg.type === 'usage-stats') {
        // Follow-up to 'initial-stats': fill in used/unused counts and draw the chart.
        document.getElementById('stat-exported').textContent = msg.stats.exported;
        document.getElementById('stat-skipped').textContent = msg.stats.skipped;
        drawPieChart(msg.stats.exported, msg.stats.skipped);
    }

    if (msg.type === 'download-multiple') {
        // Créer un fichier ZIP contenant tous les fichiers
        const zip = new JSZip();

        msg.files.forEach(file => {
            zip.file(file.filename, file.content);
        });

        // Generate and download the ZIP
        const zipBlob = await zip.generateAsync({type: 'blob'});
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'figma-variables-export.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Afficher les stats si présentes
        if (msg.stats) {
            document.getElementById('stat-total').textContent = msg.stats.total;
            document.getElementById('stat-exported').textContent = msg.stats.exported;
            document.getElementById('stat-skipped').textContent = msg.stats.skipped;
            document.getElementById('dashboard').classList.add('show');

            // Hide hint and draw pie chart
            document.getElementById('chart-hint').style.display = 'none';
            drawPieChart(msg.stats.exported, msg.stats.skipped);
        }
    }

    if (msg.type === 'download-theme') {
        // Download theme.json file
        const blob = new Blob([msg.content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'theme.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
};
