// Application State
let appState = {
  mode: 'individual', // 'individual' or 'filelist'
  files: [], // Array of { id, name, entity, task, uri, customData }
  assemblyLines: [],
  subProperties: [], // Array of { name, value }
  predefinedTasks: ['Bildretusche', 'Preflight', 'Proof', 'Export'],
  customSubpropConfigs: [
    {
      name: 'SUB_AssemblyLine',
      options: [
        '001_EAL_JT_LINHA_MONTAGEM',
        '001_Retusche inklusive Smart Crop_Bienen, Forst, Jagd_SFTP',
        '002_Book_PreflightXOrder - interact_Book_140x210',
        'AMENDO AI_PROTEC_PRENSA_IBERICA'
      ]
    }
  ],
  columns: [
    { id: 'name', label: 'File Name', isCustom: false },
    { id: 'entity', label: 'Entity Code', isCustom: false },
    { id: 'task', label: 'Task Name', isCustom: false },
    { id: 'assemblyLine', label: 'Assembly Line', isCustom: false },
    { id: 'uri', label: 'Resolved File URI', isCustom: false }
  ],
  activeXmlIndex: 0, // Index of selected preview XML
  user: null // Logged-in user profile { id, username, email, role }
};

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const filesTableBody = document.getElementById('files-table-body');
const filesTableHeaderRow = document.getElementById('files-table-header-row');
const fileCountBadge = document.getElementById('file-count');
const assemblyLineSelect = document.getElementById('assembly-line-select');
const uriPrefixInput = document.getElementById('uri-prefix-input');
const execDateInput = document.getElementById('exec-date-input');
const subpropertiesList = document.getElementById('subproperties-list');
const xmlPreviewCode = document.getElementById('xml-preview-code');
const xmlTabsContainer = document.getElementById('xml-tabs');
const writeToServerChk = document.getElementById('write-to-server-chk');
const targetFolderInput = document.getElementById('target-folder-input');
const mainPropertyNameInput = document.getElementById('main-property-name-input');
const jobNameTemplateInput = document.getElementById('job-name-template-input');
const tasksListContainer = document.getElementById('tasks-list');
const customSubpropConfigsContainer = document.getElementById('custom-subprop-configs');
const profileSelect = document.getElementById('profile-select');
const newProfileNameInput = document.getElementById('new-profile-name');

// Initialize Application
window.addEventListener('DOMContentLoaded', async () => {
  // Load theme from localStorage with backward compatibility
  let savedTheme = localStorage.getItem('easy-ov-theme') || 'dark';
  if (savedTheme.includes('light')) {
    savedTheme = 'light';
  } else {
    savedTheme = 'dark';
  }
  
  const themeSelect = document.getElementById('theme-select');
  if (themeSelect) {
    themeSelect.value = savedTheme;
  }
  changeTheme(savedTheme);

  // Initialize global thumbnail preview popover dynamically
  const previewPopover = document.createElement('div');
  previewPopover.id = 'thumbnail-preview-popover';
  previewPopover.style.cssText = `
    position: absolute;
    display: none;
    pointer-events: none;
    z-index: 99999;
    border-radius: 8px;
    border: 2px solid var(--accent);
    background: #111215;
    box-shadow: 0 12px 40px rgba(0,0,0,0.8);
    padding: 4px;
    width: 220px;
    height: 220px;
    transition: opacity 0.15s ease-out, transform 0.15s ease-out;
    transform: scale(0.9);
    opacity: 0;
  `;
  const previewImg = document.createElement('img');
  previewImg.style.cssText = 'width: 100%; height: 100%; object-fit: cover; border-radius: 6px;';
  previewPopover.appendChild(previewImg);
  document.body.appendChild(previewPopover);

  // Set date to today
  const today = new Date().toISOString().slice(0, 10);
  if (execDateInput) execDateInput.value = today;

  // Setup Event Listeners
  setupDragAndDrop();
  
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      handleFilesSelected(e.target.files);
    });
  }

  if (uriPrefixInput) {
    uriPrefixInput.addEventListener('input', () => {
      updateFilesUris();
      renderFilesTable();
      updateXmlPreview();
    });
  }

  if (execDateInput) execDateInput.addEventListener('change', updateXmlPreview);
  if (assemblyLineSelect) assemblyLineSelect.addEventListener('change', updateXmlPreview);
  if (mainPropertyNameInput) mainPropertyNameInput.addEventListener('input', updateXmlPreview);
  if (jobNameTemplateInput) jobNameTemplateInput.addEventListener('input', updateXmlPreview);

  // Verify auth session
  await checkAuthState();
});

// Setup Drag and Drop listeners
function setupDragAndDrop() {
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    }, false);
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    handleFilesSelected(files);
  }, false);
}

// Fetch active assembly lines from server API
async function fetchAssemblyLines() {
  try {
    const response = await fetch('/api/assembly-lines');
    const result = await response.json();
    
    if (result.success && result.data.length > 0) {
      appState.assemblyLines = result.data;
      
      // Populate select
      assemblyLineSelect.innerHTML = '';
      result.data.forEach(line => {
        const option = document.createElement('option');
        option.value = line.name;
        option.textContent = line.name;
        assemblyLineSelect.appendChild(option);
      });

      // Default selection (look for the "001_Retusche..." template line or select first)
      const defaultLine = result.data.find(line => line.name.includes('Retusche') && line.name.includes('Smart Crop')) || result.data[0];
      if (defaultLine) {
        assemblyLineSelect.value = defaultLine.name;
      }
      
      updateDbStatus(true, 'Postgres: Connected');
    } else {
      showToast('Database empty or active lines not found', 'error');
      updateDbStatus(false, 'Postgres: No Active Lines');
    }
  } catch (err) {
    console.error('Failed to fetch assembly lines:', err);
    updateDbStatus(false, 'Postgres: Connection Error');
    showToast('Failed to connect to Postgres DB. Using mock lines.', 'error');
    
    // Fallback Mock Data for design demonstration
    appState.assemblyLines = [
      { dbid: '1', name: '001_Retusche inklusive Smart Crop_Bienen, Forst, Jagd_SFTP' },
      { dbid: '2', name: '001_EAL_JT_LINHA_MONTAGEM' },
      { dbid: '3', name: '002_Nesting_Digital_Printz' }
    ];
    
    assemblyLineSelect.innerHTML = '';
    appState.assemblyLines.forEach(line => {
      const option = document.createElement('option');
      option.value = line.name;
      option.textContent = line.name;
      assemblyLineSelect.appendChild(option);
    });
  }
  updateXmlPreview();
}

function updateDbStatus(isConnected, text) {
  const dbStatus = document.getElementById('db-status');
  const indicator = dbStatus.querySelector('.status-indicator');
  const statusText = dbStatus.querySelector('.status-text');
  
  statusText.textContent = text;
  if (isConnected) {
    indicator.classList.remove('offline');
    indicator.classList.add('online');
  } else {
    indicator.classList.remove('online');
    indicator.classList.add('offline');
  }
}

// Toggle Mode
function setMode(mode) {
  if (jobNameTemplateInput) {
    const currentVal = jobNameTemplateInput.value.trim();
    if (mode === 'individual') {
      if (currentVal === 'FILELIST_TASK-{task}_EXEC-{date}' || !currentVal) {
        jobNameTemplateInput.value = '{mainPropName}-{entity}_TASK-{task}_EXEC-{date}';
      }
    } else {
      if (currentVal === '{mainPropName}-{entity}_TASK-{task}_EXEC-{date}' || currentVal === 'ENTITY-{entity}_TASK-{task}_EXEC-{date}' || !currentVal) {
        jobNameTemplateInput.value = 'FILELIST_TASK-{task}_EXEC-{date}';
      }
    }
  }

  appState.mode = mode;
  document.getElementById('mode-individual').classList.toggle('active', mode === 'individual');
  document.getElementById('mode-filelist').classList.toggle('active', mode === 'filelist');
  
  appState.activeXmlIndex = 0;
  updateXmlPreview();
  showToast(`Switched to ${mode === 'individual' ? 'Individual' : 'Filelist'} mode`, 'success');
}

// Helper to read file as Base64 string and full DataURL
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(',')[1];
      resolve({ base64, dataUrl });
    };
    reader.onerror = error => reject(error);
    reader.readAsDataURL(file);
  });
}

// Generate image thumbnail or vector representation based on extension
function generateThumbnailUrl(fileObj) {
  const ext = fileObj.name.split('.').pop().toLowerCase();
  
  // If it's a browser-supported image, use its base64 data URL
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp'].includes(ext)) {
    return fileObj.dataUrl;
  }
  
  // Return sleek SVG vector placeholder for non-supported images (e.g. PDF, TIFF, PSD, XML)
  let color = '#4a90e2'; // default blue
  let text = ext.toUpperCase();
  
  if (ext === 'pdf') {
    color = '#ff4d4d'; // Red for PDF
  } else if (ext === 'xml') {
    color = '#ff9f43'; // Orange for XML
  } else if (['tiff', 'tif'].includes(ext)) {
    color = '#10ac84'; // Teal for TIFF
  } else if (ext === 'psd') {
    color = '#2e86de'; // Dark blue for PSD
  }
  
  return `data:image/svg+xml;utf8,` + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50" width="50" height="50">
      <rect x="5" y="5" width="40" height="40" rx="6" fill="${color}" fill-opacity="0.1" stroke="${color}" stroke-width="1.5"/>
      <rect x="12" y="12" width="26" height="3" rx="1.5" fill="${color}" fill-opacity="0.3"/>
      <rect x="12" y="19" width="18" height="3" rx="1.5" fill="${color}" fill-opacity="0.3"/>
      <rect x="12" y="26" width="22" height="3" rx="1.5" fill="${color}" fill-opacity="0.3"/>
      <text x="25" y="42" font-family="sans-serif" font-size="9" font-weight="bold" fill="${color}" text-anchor="middle">${text}</text>
    </svg>
  `);
}

// Generate thumbnail for PDF using PDF.js (first page render on canvas)
async function generatePdfThumbnail(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
    
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    
    // Target thumbnail width around 300px for crisp hover zoom scaling
    const scale = 300 / page.getViewport({ scale: 1 }).width;
    const viewport = page.getViewport({ scale: scale });
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise;
    
    return canvas.toDataURL('image/jpeg', 0.90); // JPEG format with 90% quality for crisp details
  } catch (err) {
    console.error('Failed to generate PDF thumbnail:', err);
    return null;
  }
}

// Handle File upload / drops
async function handleFilesSelected(fileList) {
  if (fileList.length === 0) return;

  const baseUri = uriPrefixInput.value.trim().replace(/\/+$/, '');
  
  // Generate a random base number for this batch of files (between 100 and 999)
  const randomBase = Math.floor(Math.random() * 900) + 100;
  
  const uploadFilesPayload = [];
  let filesAddedCount = 0;

  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    
    // Check if file is already added
    if (appState.files.some(f => f.name === file.name)) {
      continue;
    }

    let fileData = null;
    try {
      fileData = await readFileAsBase64(file);
      uploadFilesPayload.push({
        name: file.name,
        base64Data: fileData.base64
      });
    } catch (err) {
      console.error(`Failed to read file ${file.name} as base64:`, err);
      continue;
    }

    // Auto-parse filename metadata
    const parsed = parseFileName(file.name);
    
    // Use parsed entity if found, otherwise generate a sequential number with the random base
    const entity = parsed.entity || `${randomBase}|${i + 1}`;
    
    // Construct URI (escaped for URI characters like spaces)
    const escapedName = encodeURIComponent(file.name).replace(/%20/g, '%20'); // match template %20
    const uri = `${baseUri}/${escapedName}`;

    const newFile = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      name: file.name,
      entity: entity,
      task: parsed.task,
      uri: uri,
      customData: {},
      selected: true,
      assemblyLine: '',
      dataUrl: fileData.dataUrl
    };
    
    // Generate thumbnail URL
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'pdf' && window.pdfjsLib) {
      newFile.thumbnail = await generatePdfThumbnail(file) || generateThumbnailUrl(newFile);
    } else {
      newFile.thumbnail = generateThumbnailUrl(newFile);
    }
    appState.files.push(newFile);
    
    filesAddedCount++;
  }
  
  renderFilesTable();
  updateXmlPreview();

  if (filesAddedCount > 0) {
    showToast(`Uploading ${filesAddedCount} file(s) to Local Folder...`, 'info');
    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetFolder: uriPrefixInput.value.trim(),
          files: uploadFilesPayload
        })
      });
      const result = await response.json();
      if (result.success) {
        showToast(`Uploaded and added ${filesAddedCount} files.`, 'success');
      } else {
        showToast(`Files added to list, but upload failed: ${result.error}`, 'error');
      }
    } catch (err) {
      console.error('File upload failed:', err);
      showToast(`Files added to list, but server upload failed.`, 'error');
    }
  }
}

// File Name Parser Logic
function parseFileName(filename) {
  const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.')) || filename;
  const mainProp = (mainPropertyNameInput ? mainPropertyNameInput.value.trim() : '') || 'DLV';
  
  // Try pattern: [MainPropertyName]-[Entity]_TASK-[Task]_[Filename]
  const pattern1Str = `^${mainProp.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}-(.+?)_TASK-(.+?)(?:_.*)?$`;
  const pattern1 = new RegExp(pattern1Str, 'i');
  const match1 = nameWithoutExt.match(pattern1);
  if (match1) {
    return {
      entity: match1[1].replace(/[\-_]/g, '|'),
      task: match1[2]
    };
  }

  // Try legacy pattern: ENTITY-[Entity]_TASK-[Task]_[Filename]
  const patternLegacy = /^ENTITY-(.+?)_TASK-(.+?)(?:_.*)?$/i;
  const matchLegacy = nameWithoutExt.match(patternLegacy);
  if (matchLegacy) {
    return {
      entity: matchLegacy[1].replace(/[\-_]/g, '|'),
      task: matchLegacy[2]
    };
  }

  // Try pattern: [Entity]_[Task]_[Filename] (where entity is like 159_5 or 159-5)
  // e.g. 159_5_Bildretusche_Test 3
  const pattern2 = /^(\d+[\-_]\d+)_([A-Za-z0-9äöüßÄÖÜ_]+)_(.+)$/;
  const match2 = nameWithoutExt.match(pattern2);
  if (match2) {
    return {
      entity: match2[1].replace(/_/g, '|').replace(/-/g, '|'),
      task: match2[2]
    };
  }

  // Default fallback if no match
  return {
    entity: null,
    task: 'Bildretusche'
  };
}

// Update all URIs based on base folder changes
function updateFilesUris() {
  const baseUri = uriPrefixInput.value.trim().replace(/\/+$/, '');
  appState.files.forEach(file => {
    const escapedName = encodeURIComponent(file.name).replace(/%20/g, '%20');
    file.uri = `${baseUri}/${escapedName}`;
  });
}

// Render Files Table
function renderFilesTable() {
  const tbody = document.getElementById('files-table-body');
  fileCountBadge.textContent = `${appState.files.length} File${appState.files.length === 1 ? '' : 's'}`;
  
  // Render headers row dynamically
  if (filesTableHeaderRow) {
    const allSelected = appState.files.length > 0 && appState.files.every(f => f.selected !== false);
    const noneSelected = appState.files.length > 0 && appState.files.every(f => f.selected === false);
    
    let headerHtml = `
      <th width="40"><input type="checkbox" id="select-all-files" ${allSelected ? 'checked' : ''} onchange="toggleSelectAllFiles(this.checked)"></th>
    `;
    
    appState.columns.forEach((col, colIdx) => {
      const moveLeftHtml = colIdx > 0 
        ? `<button type="button" onclick="moveColumn(${colIdx}, -1)" title="Move Left" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.65rem; padding: 0.1rem; transition: var(--transition);">◀</button>` 
        : '';
      const moveRightHtml = colIdx < appState.columns.length - 1 
        ? `<button type="button" onclick="moveColumn(${colIdx}, 1)" title="Move Right" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.65rem; padding: 0.1rem; transition: var(--transition);">▶</button>` 
        : '';
        
      const colWidthStyle = col.width ? `style="width: ${col.width}; min-width: ${col.width};"` : '';
      if (col.isCustom) {
        headerHtml += `
          <th ${colWidthStyle}>
            <div style="display: flex; flex-direction: column; gap: 0.2rem; align-items: stretch; min-width: 100px;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.25rem;">
                <span style="font-size: 0.75rem; letter-spacing: 0.5px; font-weight: bold;">${col.label}</span>
                <div style="display: flex; gap: 0.1rem; align-items: center;">
                  ${moveLeftHtml}
                  ${moveRightHtml}
                  <button type="button" class="btn-delete-row" onclick="removeCustomTableColumn('${col.name.replace(/'/g, "\\'")}')" style="font-size: 0.75rem; padding: 0px 0.25rem; font-weight: bold; background: none; border: none; cursor: pointer; color: var(--error);" title="Delete Column">×</button>
                </div>
              </div>
              <select onchange="updateCustomColumnType('${col.name.replace(/'/g, "\\'")}', this.value)" style="font-size: 0.7rem; padding: 0.15rem 0.3rem; border-radius: 3px; background: rgba(11, 12, 16, 0.8); border: 1px solid var(--border-color); color: var(--text-bright); outline: none; cursor: pointer;">
                <option value="string" ${col.type === 'string' ? 'selected' : ''}>Str</option>
                <option value="integer" ${col.type === 'integer' ? 'selected' : ''}>Int</option>
                <option value="float" ${col.type === 'float' ? 'selected' : ''}>Float</option>
              </select>
            </div>
          </th>
        `;
      } else {
        headerHtml += `
          <th ${colWidthStyle}>
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.25rem;">
              <span style="font-size: 0.75rem; letter-spacing: 0.5px; font-weight: bold;">${col.label}</span>
              <div style="display: flex; gap: 0.1rem; align-items: center;">
                ${moveLeftHtml}
                ${moveRightHtml}
              </div>
            </div>
          </th>
        `;
      }
    });
    
    headerHtml += `<th width="60"></th>`;
    filesTableHeaderRow.innerHTML = headerHtml;
    
    // Set indeterminate status
    const selectAllChk = document.getElementById('select-all-files');
    if (selectAllChk) {
      selectAllChk.indeterminate = !allSelected && !noneSelected;
    }
  }

  if (appState.files.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-state-row">
        <td colspan="${2 + appState.columns.length}">
          <div class="empty-table-state">
            <p>No files uploaded yet. Drag files or browse to begin.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  
  const tasksList = appState.predefinedTasks
    .map(t => t.trim())
    .filter(t => t.length > 0);

  appState.files.forEach((file, index) => {
    const tr = document.createElement('tr');
    
    const rowTasks = [...tasksList];
    if (file.task && !rowTasks.includes(file.task)) {
      rowTasks.unshift(file.task);
    }
    
    let lineSelectOptions = `<option value="">(Use Global Default)</option>`;
    appState.assemblyLines.forEach(line => {
      const selectedAttr = (line.name === file.assemblyLine) ? 'selected' : '';
      lineSelectOptions += `<option value="${line.name}" ${selectedAttr}>${line.name}</option>`;
    });

    let cellsHtml = `
      <td>
        <input type="checkbox" class="file-select-checkbox" data-file-id="${file.id}" ${file.selected !== false ? 'checked' : ''} onchange="toggleFileSelection('${file.id}', this.checked)">
      </td>
    `;
    
    appState.columns.forEach(col => {
      if (col.isCustom) {
        const val = (file.customData && file.customData[col.name]) || '';
        const config = appState.customSubpropConfigs.find(c => c.name && c.name.trim() === col.name.trim());
        
        if (config) {
          const valuesList = config.options.map(o => o.trim()).filter(o => o.length > 0);
          const rowValues = [...valuesList];
          if (val && !rowValues.includes(val)) {
            rowValues.unshift(val);
          }
          let selectOptions = '';
          rowValues.forEach(valOption => {
            const selectedAttr = (valOption === val) ? 'selected' : '';
            selectOptions += `<option value="${valOption}" ${selectedAttr}>${valOption}</option>`;
          });
          
          cellsHtml += `
            <td>
              <select class="table-input" onchange="updateFileCustomField('${file.id}', '${col.name.replace(/'/g, "\\'")}', this.value)" style="width: 100%; min-width: 100px;">
                ${selectOptions}
              </select>
            </td>
          `;
        } else {
          cellsHtml += `
            <td>
              <input type="text" value="${val}" class="table-input" 
                     oninput="updateFileCustomField('${file.id}', '${col.name.replace(/'/g, "\\'")}', this.value)">
            </td>
          `;
        }
      } else {
        // Standard columns
        if (col.id === 'name') {
          cellsHtml += `
            <td>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <img src="${file.thumbnail || ''}" 
                     onmouseenter="showThumbnailPreview(this, event)" 
                     onmouseleave="hideThumbnailPreview()"
                     style="width: 36px; height: 36px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border-color); background: #1a1b23; cursor: pointer;" />
                <span class="file-name-label" style="font-weight: 500;">${file.name}</span>
              </div>
            </td>
          `;
        } else if (col.id === 'entity') {
          cellsHtml += `
            <td>
              <input type="text" value="${file.entity}" class="table-input" 
                     oninput="updateFileField('${file.id}', 'entity', this.value)">
            </td>
          `;
        } else if (col.id === 'task') {
          cellsHtml += `
            <td>
              <div class="rolldown-select" id="rolldown-${file.id}">
                <div class="rolldown-trigger" onclick="toggleRolldown('${file.id}')">
                  <span>${file.task}</span>
                  <span class="rolldown-arrow">▼</span>
                </div>
                <div class="rolldown-options">
                  ${rowTasks.map(taskOption => `
                    <div class="rolldown-option ${taskOption === file.task ? 'selected' : ''}" onclick="selectRolldownOption('${file.id}', '${taskOption.replace(/'/g, "\\'")}')">
                      ${taskOption}
                    </div>
                  `).join('')}
                </div>
              </div>
            </td>
          `;
        } else if (col.id === 'assemblyLine') {
          cellsHtml += `
            <td>
              <select class="table-input" onchange="updateFileAssemblyLine('${file.id}', this.value)" style="width: 100%; min-width: 150px; cursor: pointer;">
                ${lineSelectOptions}
              </select>
            </td>
          `;
        } else if (col.id === 'uri') {
          cellsHtml += `
            <td>
              <input type="text" value="${file.uri}" class="table-input path-input" 
                     oninput="updateFileField('${file.id}', 'uri', this.value)">
            </td>
          `;
        }
      }
    });
    
    cellsHtml += `
      <td>
        <button type="button" class="btn-delete-row" onclick="removeFile('${file.id}')">×</button>
      </td>
    `;
    
    tr.innerHTML = cellsHtml;
    tbody.appendChild(tr);
  });

  // Attach drag-resizing listeners to the newly rendered headers
  initColumnResizing();
}

// Resizable column header divider logic
function initColumnResizing() {
  const table = document.getElementById('files-table');
  if (!table) return;
  
  const headers = table.querySelectorAll('th');
  headers.forEach((th, idx) => {
    // Skip select-all checkbox header (idx = 0) and delete-row actions header (idx = headers.length - 1)
    if (idx === 0 || idx === headers.length - 1) return;
    
    // Check if grip already exists
    if (th.querySelector('.resize-grip')) return;
    
    const grip = document.createElement('div');
    grip.className = 'resize-grip';
    th.appendChild(grip);
    
    let startX = 0;
    let startWidth = 0;
    
    const onMouseDown = (e) => {
      startX = e.pageX;
      startWidth = th.offsetWidth;
      grip.classList.add('resizing');
      
      const onMouseMove = (moveEvent) => {
        const deltaX = moveEvent.pageX - startX;
        const newWidth = Math.max(50, startWidth + deltaX); // Min 50px width limit
        const newWidthPx = newWidth + 'px';
        
        th.style.width = newWidthPx;
        th.style.minWidth = newWidthPx;
        
        // Save the updated width value to appState.columns so it persists in presets!
        // idx - 1 corresponds to index in appState.columns (since th 0 is selection checkbox)
        const colObj = appState.columns[idx - 1];
        if (colObj) {
          colObj.width = newWidthPx;
        }
      };
      
      const onMouseUp = () => {
        grip.classList.remove('resizing');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        updateXmlPreview();
      };
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    };
    
    grip.addEventListener('mousedown', onMouseDown);
  });
}

// Show global thumbnail preview popover relative to the hovered element
function showThumbnailPreview(imgEl, event) {
  const popover = document.getElementById('thumbnail-preview-popover');
  if (!popover) return;
  
  const img = popover.querySelector('img');
  img.src = imgEl.src;
  
  const rect = imgEl.getBoundingClientRect();
  
  // Position the popover to the right of the thumbnail with a small offset
  let left = rect.right + 12 + window.scrollX;
  let top = rect.top - 92 + window.scrollY; // center vertically relative to 220px height
  
  // Prevent popover from extending above the screen top boundary
  if (top < window.scrollY + 10) {
    top = window.scrollY + 10;
  }
  // Prevent popover from extending below the document body bottom boundary
  const bodyHeight = document.body.offsetHeight;
  if (top + 230 > bodyHeight) {
    top = Math.max(window.scrollY + 10, bodyHeight - 230);
  }
  
  popover.style.left = left + 'px';
  popover.style.top = top + 'px';
  popover.style.display = 'block';
  
  // Force browser layout reflow to register the block display style
  popover.offsetHeight;
  
  // Transition styles (fade and scale up)
  popover.style.opacity = '1';
  popover.style.transform = 'scale(1)';
}

// Hide global thumbnail preview popover
function hideThumbnailPreview() {
  const popover = document.getElementById('thumbnail-preview-popover');
  if (!popover) return;
  
  popover.style.opacity = '0';
  popover.style.transform = 'scale(0.9)';
  
  // Hide popover display block after the CSS transition finishes
  setTimeout(() => {
    if (popover.style.opacity === '0') {
      popover.style.display = 'none';
    }
  }, 150);
}

// Edit a field in files table
function updateFileField(id, field, value) {
  const file = appState.files.find(f => f.id === id);
  if (file) {
    file[field] = value;
    updateXmlPreview();
  }
}

// Edit a custom field in files table
function updateFileCustomField(id, colName, value) {
  const file = appState.files.find(f => f.id === id);
  if (file) {
    if (!file.customData) file.customData = {};
    file.customData[colName] = value;
    updateXmlPreview();
  }
}

// Edit individual assembly line choice in files table
function updateFileAssemblyLine(id, value) {
  const file = appState.files.find(f => f.id === id);
  if (file) {
    file.assemblyLine = value;
    updateXmlPreview();
  }
}

// Add a new custom metadata column to the files table
function addCustomTableColumn() {
  const colName = prompt("Enter new column name (e.g. SUB_Color, SUB_Format, or just KeyName):");
  if (colName === null) return; // User cancelled
  
  const trimmed = colName.trim();
  if (!trimmed) {
    showToast("Column name cannot be empty", "error");
    return;
  }
  
  const reserved = ["File Name", "Entity Code", "Task Name", "Resolved File URI", "Assembly Line"];
  if (reserved.some(r => r.toLowerCase() === trimmed.toLowerCase()) || appState.columns.some(c => c.label.toLowerCase() === trimmed.toLowerCase())) {
    showToast("Column name already exists or is reserved", "error");
    return;
  }
  
  appState.columns.push({ id: 'custom_' + trimmed, name: trimmed, label: trimmed, type: 'string', isCustom: true });
  renderFilesTable();
  updateXmlPreview();
  showToast(`Column "${trimmed}" added!`, "success");
}

// Remove a custom column from the files table
function removeCustomTableColumn(colName) {
  if (!confirm(`Are you sure you want to delete column "${colName}"? Any values typed in it will be lost.`)) {
    return;
  }
  
  appState.columns = appState.columns.filter(c => c.name !== colName);
  appState.files.forEach(file => {
    if (file.customData) {
      delete file.customData[colName];
    }
  });
  
  renderFilesTable();
  updateXmlPreview();
  showToast(`Column "${colName}" removed`, "success");
}

// Update the datatype of a custom table column
function updateCustomColumnType(colName, type) {
  const colObj = appState.columns.find(c => c.name === colName);
  if (colObj) {
    colObj.type = type;
    updateXmlPreview();
  }
}

// Move any column (standard or custom) left or right
function moveColumn(colIdx, direction) {
  const targetIdx = colIdx + direction;
  if (targetIdx < 0 || targetIdx >= appState.columns.length) return;
  
  // Swap columns in state
  const temp = appState.columns[colIdx];
  appState.columns[colIdx] = appState.columns[targetIdx];
  appState.columns[targetIdx] = temp;
  
  renderFilesTable();
  updateXmlPreview();
}

// Toggle selection state for all files in list
function toggleSelectAllFiles(isChecked) {
  appState.files.forEach(file => {
    file.selected = isChecked;
  });
  renderFilesTable();
  updateXmlPreview();
}

// Toggle selection state for a single file
function toggleFileSelection(fileId, isChecked) {
  const file = appState.files.find(f => f.id === fileId);
  if (file) {
    file.selected = isChecked;
  }
  renderFilesTable();
  updateXmlPreview();
}

// Rolldown Select Custom Controls
function toggleRolldown(fileId) {
  if (window.event) window.event.stopPropagation();
  const el = document.getElementById(`rolldown-${fileId}`);
  if (el) {
    const isOpen = el.classList.contains('open');
    document.querySelectorAll('.rolldown-select').forEach(r => r.classList.remove('open'));
    if (!isOpen) {
      el.classList.add('open');
    }
  }
}

function selectRolldownOption(fileId, value) {
  updateFileField(fileId, 'task', value);
  renderFilesTable();
}

// Global click listener to close rolldowns when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.rolldown-select')) {
    document.querySelectorAll('.rolldown-select').forEach(r => r.classList.remove('open'));
  }
});

// Remove file from list
function removeFile(id) {
  appState.files = appState.files.filter(f => f.id !== id);
  if (appState.activeXmlIndex >= appState.files.length) {
    appState.activeXmlIndex = Math.max(0, appState.files.length - 1);
  }
  renderFilesTable();
  updateXmlPreview();
  showToast('File removed', 'success');
}

// Clear all files from the list
function clearFilesList() {
  if (appState.files.length === 0) {
    showToast('List is already empty', 'error');
    return;
  }
  
  if (confirm('Are you sure you want to clear all files from the list?')) {
    appState.files = [];
    appState.activeXmlIndex = 0;
    renderFilesTable();
    updateXmlPreview();
    showToast('Files list cleared', 'success');
  }
}

// Helper to render type dropdown selection
function getTypeSelectHtml(currentType = 'string') {
  return `
    <select class="subprop-type-select" onchange="updateSubProperties()" style="width: 80px; padding: 0.4rem 0.3rem; font-size: 0.75rem; border-radius: 4px; background: rgba(11, 12, 16, 0.6); border: 1px solid var(--border-color); color: var(--text-bright);">
      <option value="string" ${currentType === 'string' ? 'selected' : ''}>Str</option>
      <option value="integer" ${currentType === 'integer' ? 'selected' : ''}>Int</option>
      <option value="float" ${currentType === 'float' ? 'selected' : ''}>Float</option>
    </select>
  `;
}

// Dynamic SubProperties Grid Management
function addSubPropertyRow(name = '', value = '', type = 'string') {
  const id = 'prop-' + Math.random().toString(36).substr(2, 9);
  
  const div = document.createElement('div');
  div.className = 'subprop-row';
  div.id = id;
  
  const config = appState.customSubpropConfigs.find(c => c.name && c.name.trim() === name.trim());
  const typeSelectHtml = getTypeSelectHtml(type);
  
  if (config) {
    const valuesList = config.options
      .map(o => o.trim())
      .filter(o => o.length > 0);
      
    const rowValues = [...valuesList];
    if (value && !rowValues.includes(value)) {
      rowValues.unshift(value);
    }
    
    let selectOptions = '';
    rowValues.forEach(valOption => {
      const selectedAttr = (valOption === value) ? 'selected' : '';
      selectOptions += `<option value="${valOption}" ${selectedAttr}>${valOption}</option>`;
    });
    
    div.innerHTML = `
      <input type="text" placeholder="Name" value="${name}" oninput="handleSubpropertyNameChange('${id}', this.value)">
      <select class="subprop-value-select" onchange="updateSubProperties()" style="flex: 1; min-width: 0; padding: 0.4rem 0.6rem; font-size: 0.8rem; border-radius: 4px; background: rgba(11, 12, 16, 0.6); border: 1px solid var(--border-color); color: var(--text-bright);">
        ${selectOptions}
      </select>
      ${typeSelectHtml}
      <div class="subprop-actions" style="display: flex; gap: 0.15rem; align-items: center;">
        <button type="button" class="btn-order" onclick="moveSubPropertyRow('${id}', -1)" title="Move Up" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.7rem; padding: 0.15rem; transition: var(--transition);">▲</button>
        <button type="button" class="btn-order" onclick="moveSubPropertyRow('${id}', 1)" title="Move Down" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.7rem; padding: 0.15rem; transition: var(--transition);">▼</button>
        <button type="button" class="btn-delete-row" onclick="removeSubPropertyRow('${id}')">×</button>
      </div>
    `;
  } else {
    div.innerHTML = `
      <input type="text" placeholder="Name" value="${name}" oninput="handleSubpropertyNameChange('${id}', this.value)">
      <input type="text" placeholder="Value" value="${value}" oninput="updateSubProperties()">
      ${typeSelectHtml}
      <div class="subprop-actions" style="display: flex; gap: 0.15rem; align-items: center;">
        <button type="button" class="btn-order" onclick="moveSubPropertyRow('${id}', -1)" title="Move Up" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.7rem; padding: 0.15rem; transition: var(--transition);">▲</button>
        <button type="button" class="btn-order" onclick="moveSubPropertyRow('${id}', 1)" title="Move Down" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.7rem; padding: 0.15rem; transition: var(--transition);">▼</button>
        <button type="button" class="btn-delete-row" onclick="removeSubPropertyRow('${id}')">×</button>
      </div>
    `;
  }
  
  subpropertiesList.appendChild(div);
  updateSubProperties();
}

function handleSubpropertyNameChange(rowId, newName) {
  const row = document.getElementById(rowId);
  if (row) {
    const valueEl = row.querySelector('.subprop-value-select') || row.querySelectorAll('input')[1];
    const currentValue = valueEl ? valueEl.value : '';
    const typeEl = row.querySelector('.subprop-type-select');
    const currentType = typeEl ? typeEl.value : 'string';
    
    const config = appState.customSubpropConfigs.find(c => c.name && c.name.trim() === newName.trim());
    const hasSelect = !!row.querySelector('.subprop-value-select');
    const typeSelectHtml = getTypeSelectHtml(currentType);
    
    if ((config && !hasSelect) || (!config && hasSelect)) {
      if (config) {
        const valuesList = config.options.map(o => o.trim()).filter(o => o.length > 0);
        const rowValues = [...valuesList];
        if (currentValue && !rowValues.includes(currentValue)) {
          rowValues.unshift(currentValue);
        }
        let selectOptions = '';
        rowValues.forEach(valOption => {
          const selectedAttr = (valOption === currentValue) ? 'selected' : '';
          selectOptions += `<option value="${valOption}" ${selectedAttr}>${valOption}</option>`;
        });
        
        row.innerHTML = `
          <input type="text" placeholder="Name" value="${newName}" oninput="handleSubpropertyNameChange('${rowId}', this.value)">
          <select class="subprop-value-select" onchange="updateSubProperties()" style="flex: 1; min-width: 0; padding: 0.4rem 0.6rem; font-size: 0.8rem; border-radius: 4px; background: rgba(11, 12, 16, 0.6); border: 1px solid var(--border-color); color: var(--text-bright);">
            ${selectOptions}
          </select>
          ${typeSelectHtml}
          <div class="subprop-actions" style="display: flex; gap: 0.15rem; align-items: center;">
            <button type="button" class="btn-order" onclick="moveSubPropertyRow('${rowId}', -1)" title="Move Up" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.7rem; padding: 0.15rem; transition: var(--transition);">▲</button>
            <button type="button" class="btn-order" onclick="moveSubPropertyRow('${rowId}', 1)" title="Move Down" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.7rem; padding: 0.15rem; transition: var(--transition);">▼</button>
            <button type="button" class="btn-delete-row" onclick="removeSubPropertyRow('${rowId}')">×</button>
          </div>
        `;
      } else {
        row.innerHTML = `
          <input type="text" placeholder="Name" value="${newName}" oninput="handleSubpropertyNameChange('${rowId}', this.value)">
          <input type="text" placeholder="Value" value="${currentValue}" oninput="updateSubProperties()">
          ${typeSelectHtml}
          <div class="subprop-actions" style="display: flex; gap: 0.15rem; align-items: center;">
            <button type="button" class="btn-order" onclick="moveSubPropertyRow('${rowId}', -1)" title="Move Up" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.7rem; padding: 0.15rem; transition: var(--transition);">▲</button>
            <button type="button" class="btn-order" onclick="moveSubPropertyRow('${rowId}', 1)" title="Move Down" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.7rem; padding: 0.15rem; transition: var(--transition);">▼</button>
            <button type="button" class="btn-delete-row" onclick="removeSubPropertyRow('${rowId}')">×</button>
          </div>
        `;
      }
      
      const nameInput = row.querySelector('input');
      if (nameInput) {
        nameInput.focus();
        const len = nameInput.value.length;
        nameInput.setSelectionRange(len, len);
      }
    }
  }
  updateSubProperties();
}

function removeSubPropertyRow(id) {
  const el = document.getElementById(id);
  if (el) {
    el.remove();
    updateSubProperties();
  }
}

function moveSubPropertyRow(id, direction) {
  const row = document.getElementById(id);
  if (!row) return;
  
  if (direction === -1) {
    const prev = row.previousElementSibling;
    if (prev) {
      row.parentNode.insertBefore(row, prev);
    }
  } else if (direction === 1) {
    const next = row.nextElementSibling;
    if (next) {
      row.parentNode.insertBefore(next, row);
    }
  }
  
  updateSubProperties();
}

// Dynamic Predefined Tasks List Management
function renderTasksList() {
  if (!tasksListContainer) return;
  tasksListContainer.innerHTML = '';
  appState.predefinedTasks.forEach((task, index) => {
    const div = document.createElement('div');
    div.className = 'task-row';
    div.innerHTML = `
      <input type="text" placeholder="Task Name" value="${task}" oninput="updateTaskValue(${index}, this.value)" style="width: 100%;">
      <button type="button" class="btn-delete-row" onclick="removeTaskRow(${index})">×</button>
    `;
    tasksListContainer.appendChild(div);
  });
}

function addTaskRow(taskName = '') {
  appState.predefinedTasks.push(taskName);
  renderTasksList();
  renderFilesTable();
  updateXmlPreview();
}

function removeTaskRow(index) {
  appState.predefinedTasks.splice(index, 1);
  renderTasksList();
  renderFilesTable();
  updateXmlPreview();
}

function updateTaskValue(index, value) {
  appState.predefinedTasks[index] = value;
  renderFilesTable();
  updateXmlPreview();
}

function updateSubProperties() {
  const rows = subpropertiesList.querySelectorAll('.subprop-row');
  appState.subProperties = [];
  
  rows.forEach(row => {
    const nameInput = row.querySelector('input');
    const valueEl = row.querySelector('.subprop-value-select') || row.querySelectorAll('input')[1];
    const typeEl = row.querySelector('.subprop-type-select');
    
    if (nameInput && valueEl) {
      const name = nameInput.value.trim();
      const value = valueEl.value.trim();
      const type = typeEl ? typeEl.value : 'string';
      if (name) {
        appState.subProperties.push({ name, value, type });
      }
    }
  });
  
  updateXmlPreview();
}

// Client-Side Live XML Generator for instant previews
function generateXmlLocal() {
  const selectedFiles = appState.files.filter(f => f.selected !== false);
  if (selectedFiles.length === 0) {
    return [{ filename: 'No Files Selected', content: '<!-- Please select at least one file to preview XML Job Ticket -->' }];
  }

  const assemblyLineRef = assemblyLineSelect.value || 'AssemblyLineReference';
  const rawDate = execDateInput.value || new Date().toISOString().slice(0, 10);
  const cleanDate = rawDate.replace(/-/g, '');
  const xmlList = [];
  const mainPropName = mainPropertyNameInput ? mainPropertyNameInput.value.trim() || 'DLV' : 'DLV';
  const template = jobNameTemplateInput ? jobNameTemplateInput.value.trim() : '';

  const escapeXml = (unsafe) => {
    if (!unsafe) return '';
    return unsafe.toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };

  const buildJobName = (fileEntity, fileTask) => {
    let jName = template;
    if (!jName) {
      jName = appState.mode === 'filelist' 
        ? 'FILELIST_TASK-{task}_EXEC-{date}' 
        : '{mainPropName}-{entity}_TASK-{task}_EXEC-{date}';
    }
    return jName
      .replace(/{mainPropName}/g, mainPropName)
      .replace(/{entity}/g, fileEntity || '')
      .replace(/{task}/g, fileTask || '')
      .replace(/{date}/g, cleanDate);
  };

  if (appState.mode === 'filelist') {
    // Merged Mode (Filelist)
    const taskName = selectedFiles[0].task || 'Task';
    const firstEntity = selectedFiles[0].entity || '';
    const jobName = buildJobName(firstEntity, taskName);
    const xmlEscapedJobName = escapeXml(jobName);
    
    let subPropsStr = '';
    
    // Add all file names and entities (FileName and NumberJob)
    selectedFiles.forEach(file => {
      subPropsStr += `    <SubProperty xsi:type="PropertyString">\n`;
      subPropsStr += `      <Name>FileName</Name>\n`;
      subPropsStr += `      <Value>${escapeXml(file.name)}</Value>\n`;
      subPropsStr += `    </SubProperty>\n`;
      subPropsStr += `    <SubProperty xsi:type="PropertyString">\n`;
      subPropsStr += `      <Name>NumberJob</Name>\n`;
      subPropsStr += `      <Value>${escapeXml(file.entity)}</Value>\n`;
      subPropsStr += `    </SubProperty>\n`;
      
      // Add custom columns values for each file
      appState.columns.filter(c => c.isCustom).forEach(colObj => {
        const val = (file.customData && file.customData[colObj.name]) || '';
        if (val) {
          let xsiType = 'PropertyString';
          if (colObj.type === 'integer') xsiType = 'PropertyInteger';
          else if (colObj.type === 'float') xsiType = 'PropertyFloat';
          
          subPropsStr += `    <SubProperty xsi:type="${xsiType}">\n`;
          subPropsStr += `      <Name>${escapeXml(file.name)}_${escapeXml(colObj.name)}</Name>\n`;
          subPropsStr += `      <Value>${escapeXml(val)}</Value>\n`;
          subPropsStr += `    </SubProperty>\n`;
        }
      });
    });

    // Add task SubProperty
    subPropsStr += `    <SubProperty xsi:type="PropertyString">\n`;
    subPropsStr += `      <Name>task</Name>\n`;
    subPropsStr += `      <Value>${escapeXml(taskName)}</Value>\n`;
    subPropsStr += `    </SubProperty>\n`;

    // Add custom ones
    appState.subProperties.forEach(prop => {
      if (prop.name === 'task') return;
      let xsiType = 'PropertyString';
      if (prop.type === 'integer') xsiType = 'PropertyInteger';
      else if (prop.type === 'float') xsiType = 'PropertyFloat';

      subPropsStr += `    <SubProperty xsi:type="${xsiType}">\n`;
      subPropsStr += `      <Name>${escapeXml(prop.name)}</Name>\n`;
      subPropsStr += `      <Value>${escapeXml(prop.value)}</Value>\n`;
      subPropsStr += `    </SubProperty>\n`;
    });

    let filesStr = '';
    selectedFiles.forEach(file => {
      filesStr += `   <File Uri="${escapeXml(file.uri)}"/>\n`;
    });

    const fileAssemblyLine = selectedFiles[0].assemblyLine || assemblyLineRef;
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<Job Name="${xmlEscapedJobName}">
  <Property xsi:type="PropertyList" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <Name>${escapeXml(mainPropName)}</Name>
${subPropsStr}  </Property>
  <RunList ID="">
${filesStr}  </RunList>
  <AssemblyLineReference>${escapeXml(fileAssemblyLine)}</AssemblyLineReference>
</Job>`;

    const diskFilename = `${jobName}.xml`.replace(/[|]/g, '-');
    xmlList.push({ filename: diskFilename, content });

  } else {
    // Individual XML Mode
    selectedFiles.forEach(file => {
      const jobName = buildJobName(file.entity, file.task);
      const xmlEscapedJobName = escapeXml(jobName);
      
      let subPropsStr = '';
      
      // File-specific (FileName and NumberJob)
      subPropsStr += `    <SubProperty xsi:type="PropertyString">\n`;
      subPropsStr += `      <Name>FileName</Name>\n`;
      subPropsStr += `      <Value>${escapeXml(file.name)}</Value>\n`;
      subPropsStr += `    </SubProperty>\n`;
      subPropsStr += `    <SubProperty xsi:type="PropertyString">\n`;
      subPropsStr += `      <Name>NumberJob</Name>\n`;
      subPropsStr += `      <Value>${escapeXml(file.entity)}</Value>\n`;
      subPropsStr += `    </SubProperty>\n`;

      // Custom Table Columns
      appState.columns.filter(c => c.isCustom).forEach(colObj => {
        const val = (file.customData && file.customData[colObj.name]) || '';
        if (val) {
          let xsiType = 'PropertyString';
          if (colObj.type === 'integer') xsiType = 'PropertyInteger';
          else if (colObj.type === 'float') xsiType = 'PropertyFloat';
          
          subPropsStr += `    <SubProperty xsi:type="${xsiType}">\n`;
          subPropsStr += `      <Name>${escapeXml(colObj.name)}</Name>\n`;
          subPropsStr += `      <Value>${escapeXml(val)}</Value>\n`;
          subPropsStr += `    </SubProperty>\n`;
        }
      });

      // Task
      subPropsStr += `    <SubProperty xsi:type="PropertyString">\n`;
      subPropsStr += `      <Name>task</Name>\n`;
      subPropsStr += `      <Value>${escapeXml(file.task)}</Value>\n`;
      subPropsStr += `    </SubProperty>\n`;

      // Custom
      appState.subProperties.forEach(prop => {
        if (prop.name === 'task') return;
        let xsiType = 'PropertyString';
        if (prop.type === 'integer') xsiType = 'PropertyInteger';
        else if (prop.type === 'float') xsiType = 'PropertyFloat';

        subPropsStr += `    <SubProperty xsi:type="${xsiType}">\n`;
        subPropsStr += `      <Name>${escapeXml(prop.name)}</Name>\n`;
        subPropsStr += `      <Value>${escapeXml(prop.value)}</Value>\n`;
        subPropsStr += `    </SubProperty>\n`;
      });

      const fileAssemblyLine = file.assemblyLine || assemblyLineRef;
      const content = `<?xml version="1.0" encoding="UTF-8"?>
<Job Name="${xmlEscapedJobName}">
  <Property xsi:type="PropertyList" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <Name>${escapeXml(mainPropName)}</Name>
${subPropsStr}  </Property>
  <RunList ID="">
   <File Uri="${escapeXml(file.uri)}"/>
  </RunList>
  <AssemblyLineReference>${escapeXml(fileAssemblyLine)}</AssemblyLineReference>
</Job>`;

      const diskFilename = `${jobName}.xml`.replace(/[|]/g, '-');
      xmlList.push({ filename: diskFilename, content });
    });
  }

  return xmlList;
}

// Update live XML preview
let currentXmls = [];
function updateXmlPreview() {
  currentXmls = generateXmlLocal();
  
  // Render tabs
  xmlTabsContainer.innerHTML = '';
  if (appState.files.length > 0) {
    currentXmls.forEach((item, index) => {
      const tab = document.createElement('div');
      tab.className = `xml-tab ${index === appState.activeXmlIndex ? 'active' : ''}`;
      // Truncate name if too long
      tab.textContent = item.filename.length > 25 ? item.filename.slice(0, 12) + '...' + item.filename.slice(-10) : item.filename;
      tab.title = item.filename;
      tab.onclick = () => {
        appState.activeXmlIndex = index;
        updateXmlPreview();
      };
      xmlTabsContainer.appendChild(tab);
    });
  }

  // Adjust activeXmlIndex if out of bounds
  if (appState.activeXmlIndex >= currentXmls.length) {
    appState.activeXmlIndex = Math.max(0, currentXmls.length - 1);
  }

  // Update tabs selection styles in case active index was adjusted
  const tabElements = xmlTabsContainer.querySelectorAll('.xml-tab');
  tabElements.forEach((tab, index) => {
    if (index === appState.activeXmlIndex) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  // Render code
  const activeXml = currentXmls[appState.activeXmlIndex];
  if (activeXml) {
    xmlPreviewCode.textContent = activeXml.content;
  } else {
    xmlPreviewCode.textContent = '<!-- Upload files to preview XML Job Ticket -->';
  }

  // Dynamically update download button text showing number of files selected
  const downloadBtn = document.getElementById('btn-download');
  if (downloadBtn) {
    const selectedCount = appState.files.filter(f => f.selected !== false).length;
    if (selectedCount === 0) {
      downloadBtn.textContent = 'Download XML';
      downloadBtn.disabled = true;
      downloadBtn.style.opacity = '0.5';
      downloadBtn.style.cursor = 'not-allowed';
    } else {
      downloadBtn.disabled = false;
      downloadBtn.style.opacity = '1';
      downloadBtn.style.cursor = 'pointer';
      if (appState.mode === 'filelist') {
        downloadBtn.textContent = 'Download XML';
      } else {
        downloadBtn.textContent = selectedCount > 1 ? `Download XMLs (${selectedCount})` : 'Download XML';
      }
    }
  }
}

// Copy active XML to clipboard
function copyActiveXml() {
  const activeXml = currentXmls[appState.activeXmlIndex];
  if (!activeXml || appState.files.length === 0) {
    showToast('Nothing to copy', 'error');
    return;
  }
  
  navigator.clipboard.writeText(activeXml.content).then(() => {
    showToast('XML copied to clipboard!', 'success');
  }).catch(err => {
    console.error('Clipboard copy failed:', err);
    showToast('Failed to copy to clipboard', 'error');
  });
}

// Submit generation requests to server
async function submitGenerate() {
  const selectedFiles = appState.files.filter(f => f.selected !== false);
  if (selectedFiles.length === 0) {
    showToast('Please select at least one file to generate Job Tickets.', 'error');
    return;
  }

  const assemblyLineRef = assemblyLineSelect.value;
  if (!assemblyLineRef) {
    showToast('Please select an Assembly Line.', 'error');
    return;
  }

  const payload = {
    mode: appState.mode,
    files: selectedFiles.map(f => ({ 
      name: f.name, 
      entity: f.entity, 
      task: f.task, 
      uri: f.uri,
      assemblyLine: f.assemblyLine || '',
      customData: f.customData || {}
    })),
    customColumns: appState.columns.filter(c => c.isCustom).map(c => ({ name: c.name, type: c.type || 'string' })),
    assemblyLineRef,
    dateStr: execDateInput.value,
    subProperties: appState.subProperties,
    mainPropertyName: mainPropertyNameInput.value.trim() || 'DLV',
    jobNameTemplate: jobNameTemplateInput.value.trim(),
    writeToFolder: writeToServerChk.checked,
    targetFolder: targetFolderInput.value.trim() || null
  };

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    
    if (result.success) {
      let msg = result.message;
      if (result.savedPath) {
        msg += ` Written to: ${result.savedPath}`;
      }
      showToast(msg, 'success');
      
      // Trigger client-side file downloads as well!
      if (!writeToServerChk.checked) {
        downloadGeneratedXmls(result.xmls);
      }
    } else {
      showToast(`Generation failed: ${result.error}`, 'error');
    }
  } catch (err) {
    console.error('Network or server error:', err);
    showToast('Failed to connect to the generator server.', 'error');
  }
}

// Download all selected XML files
function downloadSelectedXmls() {
  const xmlList = generateXmlLocal();
  if (xmlList.length === 0 || (xmlList.length === 1 && xmlList[0].filename === 'No Files Selected')) {
    showToast('No XML files to download. Please select files first.', 'error');
    return;
  }
  
  downloadGeneratedXmls(xmlList);
  showToast(`Started downloading ${xmlList.length} XML Job Ticket${xmlList.length === 1 ? '' : 's'}!`, 'success');
}

// Helper: Download generated XML files directly from browser with anti-congestion delay
function downloadGeneratedXmls(xmls) {
  xmls.forEach((item, index) => {
    setTimeout(() => {
      const blob = new Blob([item.content], { type: 'text/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = item.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, index * 150); // 150ms delay between downloads to prevent congestion and browser blocks
  });
}

// Change theme (Dark vs Light)
function changeTheme(themeName) {
  if (themeName === 'light') {
    document.body.classList.add('theme-light');
  } else {
    document.body.classList.remove('theme-light');
  }
  localStorage.setItem('easy-ov-theme', themeName);
}

// Show custom toast notification
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  toast.innerHTML = `
    <span>${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;
  
  container.appendChild(toast);
  
  // Auto remove after 5 seconds
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s reverse forwards';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// Dynamic Predefined SubProperties Options Configurations Management
function renderCustomSubpropConfigs() {
  if (!customSubpropConfigsContainer) return;
  customSubpropConfigsContainer.innerHTML = '';
  
  appState.customSubpropConfigs.forEach((config, configIndex) => {
    const configCard = document.createElement('div');
    configCard.className = 'custom-subprop-card';
    
    // Header with Prop Name and Delete button
    const header = document.createElement('div');
    header.style.cssText = 'display: flex; gap: 0.4rem; align-items: center; justify-content: space-between;';
    header.innerHTML = `
      <input type="text" placeholder="SubProp Name (e.g. SUB_AssemblyLine)" value="${config.name}" oninput="updateCustomSubpropName(${configIndex}, this.value)" style="flex: 1; font-weight: bold; font-size: 0.8rem; padding: 0.3rem 0.5rem; border-radius: 4px;">
      <button type="button" class="btn-delete-row" onclick="removeCustomSubpropConfig(${configIndex})" style="padding: 0.2rem 0.4rem;" title="Delete Config">×</button>
    `;
    configCard.appendChild(header);
    
    // Options list
    const optionsContainer = document.createElement('div');
    optionsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 0.4rem;';
    
    config.options.forEach((opt, optIndex) => {
      const optRow = document.createElement('div');
      optRow.style.cssText = 'display: flex; gap: 0.4rem; align-items: center;';
      optRow.innerHTML = `
        <input type="text" placeholder="Option Value" value="${opt}" oninput="updateCustomSubpropOption(${configIndex}, ${optIndex}, this.value)" style="flex: 1; font-size: 0.75rem; padding: 0.25rem 0.4rem; border-radius: 4px;">
        <button type="button" class="btn-delete-row" onclick="removeCustomSubpropOption(${configIndex}, ${optIndex})" style="padding: 0.15rem 0.35rem;">×</button>
      `;
      optionsContainer.appendChild(optRow);
    });
    configCard.appendChild(optionsContainer);
    
    // Add Option button
    const actionsRow = document.createElement('div');
    actionsRow.innerHTML = `
      <button type="button" class="btn-text-action" onclick="addCustomSubpropOption(${configIndex})" style="font-size: 0.75rem; padding: 0.2rem 0.4rem;">+ Add Option</button>
    `;
    configCard.appendChild(actionsRow);
    
    customSubpropConfigsContainer.appendChild(configCard);
  });
}

function addCustomSubpropConfig() {
  appState.customSubpropConfigs.push({
    name: 'SUB_NewProp',
    options: ['Option 1']
  });
  renderCustomSubpropConfigs();
  rebuildSubPropertiesDOM();
}

function removeCustomSubpropConfig(configIndex) {
  appState.customSubpropConfigs.splice(configIndex, 1);
  renderCustomSubpropConfigs();
  rebuildSubPropertiesDOM();
}

function updateCustomSubpropName(configIndex, name) {
  appState.customSubpropConfigs[configIndex].name = name;
  rebuildSubPropertiesDOM();
}

function addCustomSubpropOption(configIndex) {
  appState.customSubpropConfigs[configIndex].options.push('');
  renderCustomSubpropConfigs();
  rebuildSubPropertiesDOM();
}

function removeCustomSubpropOption(configIndex, optIndex) {
  appState.customSubpropConfigs[configIndex].options.splice(optIndex, 1);
  renderCustomSubpropConfigs();
  rebuildSubPropertiesDOM();
}

function updateCustomSubpropOption(configIndex, optIndex, value) {
  appState.customSubpropConfigs[configIndex].options[optIndex] = value;
  rebuildSubPropertiesDOM();
}

function rebuildSubPropertiesDOM() {
  const rows = subpropertiesList.querySelectorAll('.subprop-row');
  const currentProps = [];
  rows.forEach(row => {
    const nameInput = row.querySelector('input');
    const valueEl = row.querySelector('.subprop-value-select') || row.querySelectorAll('input')[1];
    const typeEl = row.querySelector('.subprop-type-select');
    if (nameInput && valueEl) {
      currentProps.push({
        name: nameInput.value.trim(),
        value: valueEl.value.trim(),
        type: typeEl ? typeEl.value : 'string'
      });
    }
  });

  subpropertiesList.innerHTML = '';
  currentProps.forEach(prop => {
    addSubPropertyRow(prop.name, prop.value, prop.type);
  });
  updateSubProperties();
  renderFilesTable();
}

// Settings Profiles Manager logic
function loadSavedProfilesList() {
  if (!profileSelect) return;
  profileSelect.innerHTML = '<option value="">-- Select a Profile --</option>';
  
  let profiles = {};
  try {
    profiles = JSON.parse(localStorage.getItem('easy-ov-profiles') || '{}');
  } catch (e) {
    console.error('Failed to parse profiles:', e);
  }
  
  Object.keys(profiles).sort().forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    profileSelect.appendChild(option);
  });
}

function saveCurrentProfile() {
  if (!newProfileNameInput) return;
  const name = newProfileNameInput.value.trim();
  if (!name) {
    showToast('Please enter a profile name.', 'error');
    return;
  }
  
  let profiles = {};
  try {
    profiles = JSON.parse(localStorage.getItem('easy-ov-profiles') || '{}');
  } catch (e) {
    console.error(e);
  }
  
  const profileData = {
    uriPrefix: uriPrefixInput.value.trim(),
    mainPropertyName: mainPropertyNameInput.value.trim(),
    jobNameTemplate: jobNameTemplateInput.value.trim(),
    predefinedTasks: appState.predefinedTasks,
    customSubpropConfigs: appState.customSubpropConfigs,
    columns: appState.columns,
    writeToFolder: writeToServerChk.checked,
    targetFolder: targetFolderInput.value.trim(),
    mode: appState.mode,
    subProperties: appState.subProperties,
    assemblyLine: assemblyLineSelect.value
  };
  
  profiles[name] = profileData;
  localStorage.setItem('easy-ov-profiles', JSON.stringify(profiles));
  
  newProfileNameInput.value = '';
  loadSavedProfilesList();
  profileSelect.value = name;
  showToast(`Profile "${name}" saved successfully!`, 'success');
}

function loadSelectedProfile() {
  if (!profileSelect) return;
  const name = profileSelect.value;
  if (!name) return;
  
  let profiles = {};
  try {
    profiles = JSON.parse(localStorage.getItem('easy-ov-profiles') || '{}');
  } catch (e) {
    console.error(e);
  }
  
  const profile = profiles[name];
  if (!profile) return;
  
  // Apply values to DOM and state
  uriPrefixInput.value = profile.uriPrefix || '';
  mainPropertyNameInput.value = profile.mainPropertyName || 'DLV';
  jobNameTemplateInput.value = profile.jobNameTemplate || '';
  appState.predefinedTasks = profile.predefinedTasks || ['Bildretusche', 'Preflight', 'Proof', 'Export'];
  appState.customSubpropConfigs = profile.customSubpropConfigs || [
    {
      name: 'SUB_AssemblyLine',
      options: [
        '001_EAL_JT_LINHA_MONTAGEM',
        '001_Retusche inklusive Smart Crop_Bienen, Forst, Jagd_SFTP',
        '002_Book_PreflightXOrder - interact_Book_140x210',
        'AMENDO AI_PROTEC_PRENSA_IBERICA'
      ]
    }
  ];
  // Restore Columns layout
  if (profile.columns) {
    appState.columns = profile.columns;
  } else if (profile.customColumns) {
    const defaultCols = [
      { id: 'name', label: 'File Name', isCustom: false },
      { id: 'entity', label: 'Entity Code', isCustom: false },
      { id: 'task', label: 'Task Name', isCustom: false },
      { id: 'assemblyLine', label: 'Assembly Line', isCustom: false },
      { id: 'uri', label: 'Resolved File URI', isCustom: false }
    ];
    const loadedCols = profile.customColumns.map(c => {
      const colObj = typeof c === 'string' ? { name: c, type: 'string' } : c;
      return { id: 'custom_' + colObj.name, name: colObj.name, label: colObj.name, type: colObj.type, isCustom: true };
    });
    appState.columns = [...defaultCols, ...loadedCols];
  } else {
    // Reset to defaults if no column configuration exists
    appState.columns = [
      { id: 'name', label: 'File Name', isCustom: false },
      { id: 'entity', label: 'Entity Code', isCustom: false },
      { id: 'task', label: 'Task Name', isCustom: false },
      { id: 'assemblyLine', label: 'Assembly Line', isCustom: false },
      { id: 'uri', label: 'Resolved File URI', isCustom: false }
    ];
  }
  writeToServerChk.checked = !!profile.writeToFolder;
  targetFolderInput.value = profile.targetFolder || '';
  
  if (profile.mode) {
    setMode(profile.mode);
  }
  
  // Restore SubProperties list state first
  appState.subProperties = profile.subProperties || [];
  
  // Restore Predefined Tasks list in DOM
  renderTasksList();
  
  // Restore Predefined SubProperties configurations in DOM
  renderCustomSubpropConfigs();
  
  // Restore SubProperties list in DOM
  subpropertiesList.innerHTML = '';
  appState.subProperties.forEach(prop => {
    addSubPropertyRow(prop.name, prop.value, prop.type || 'string');
  });
  
  // Restore selected Assembly Line
  if (profile.assemblyLine) {
    assemblyLineSelect.value = profile.assemblyLine;
  }
  
  renderFilesTable();
  updateXmlPreview();
  showToast(`Profile "${name}" loaded successfully!`, 'success');
}

function deleteSelectedProfile() {
  if (!profileSelect) return;
  const name = profileSelect.value;
  if (!name) {
    showToast('Please select a profile to delete.', 'error');
    return;
  }
  
  if (!confirm(`Are you sure you want to delete profile "${name}"?`)) {
    return;
  }
  
  let profiles = {};
  try {
    profiles = JSON.parse(localStorage.getItem('easy-ov-profiles') || '{}');
  } catch (e) {
    console.error(e);
  }
  
  delete profiles[name];
  localStorage.setItem('easy-ov-profiles', JSON.stringify(profiles));
  
  loadSavedProfilesList();
  showToast(`Profile "${name}" deleted!`, 'success');
}

// Verification and management functions for Auth & Admin Panel
async function checkAuthState() {
  try {
    const response = await fetch('/api/auth/me');
    if (!response.ok) {
      showLoginOverlay();
      return;
    }
    const result = await response.json();
    
    if (result.success && result.user) {
      appState.user = result.user;
      
      // Update User Profile display in Header
      const profileDisplay = document.getElementById('user-profile-display');
      if (profileDisplay) {
        profileDisplay.textContent = `👤 ${appState.user.username} (${appState.user.role === 'admin' ? 'Admin' : 'User'})`;
      }
      
      // Toggle Admin Panel button visibility
      const adminBtn = document.getElementById('btn-admin-panel');
      if (adminBtn) {
        adminBtn.style.display = appState.user.role === 'admin' ? 'inline-block' : 'none';
      }
      
      // Hide login screen overlay
      const loginOverlay = document.getElementById('login-overlay');
      if (loginOverlay) {
        loginOverlay.style.opacity = '0';
        setTimeout(() => {
          loginOverlay.style.display = 'none';
        }, 200);
      }
      
      // Initialize application workspace states
      renderTasksList();
      renderCustomSubpropConfigs();
      loadSavedProfilesList();
      
      // Initialize defaults only if lists are currently empty
      if (appState.subProperties.length === 0) {
        addSubPropertyRow('SUB_AssemblyLine', '001_EAL_JT_LINHA_MONTAGEM');
      }
      
      await fetchAssemblyLines();
    } else {
      showLoginOverlay();
    }
  } catch (err) {
    console.error('Authentication verification check failed:', err);
    showLoginOverlay();
  }
}

function showLoginOverlay() {
  const loginOverlay = document.getElementById('login-overlay');
  if (loginOverlay) {
    loginOverlay.style.display = 'flex';
    // Trigger tiny browser reflow for opacity transition
    loginOverlay.offsetHeight;
    loginOverlay.style.opacity = '1';
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  
  const loginFieldInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const errorMsgDiv = document.getElementById('login-error-msg');
  const card = document.querySelector('.login-card');
  
  if (!loginFieldInput || !passwordInput) return;
  
  const loginField = loginFieldInput.value.trim();
  const password = passwordInput.value;
  
  if (errorMsgDiv) {
    errorMsgDiv.style.display = 'none';
    errorMsgDiv.textContent = '';
  }
  
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginField, password })
    });
    
    const result = await response.json();
    
    if (result.success) {
      loginFieldInput.value = '';
      passwordInput.value = '';
      showToast('Logged in successfully!', 'success');
      await checkAuthState();
    } else {
      // Trigger card shake animation on error
      if (card) {
        card.style.animation = 'none';
        card.offsetHeight; // trigger reflow
        card.style.animation = 'shake 0.4s ease-in-out';
      }
      if (errorMsgDiv) {
        errorMsgDiv.textContent = result.error || 'Invalid login details';
        errorMsgDiv.style.display = 'block';
      }
    }
  } catch (err) {
    console.error('Login action failed:', err);
    if (errorMsgDiv) {
      errorMsgDiv.textContent = 'Server connection failed';
      errorMsgDiv.style.display = 'block';
    }
  }
}

async function handleLogout() {
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST' });
    const result = await response.json();
    if (result.success) {
      appState.user = null;
      appState.files = [];
      renderFilesTable();
      updateXmlPreview();
      
      showToast('Logged out successfully', 'success');
      showLoginOverlay();
    }
  } catch (err) {
    console.error('Logout failed:', err);
    showToast('Failed to log out cleanly', 'error');
  }
}

// Admin Panel Modals & User Management Controls
function openAdminModal() {
  const modal = document.getElementById('admin-modal');
  if (modal) {
    modal.style.display = 'flex';
    fetchAdminUsers();
  }
}

function closeAdminModal() {
  const modal = document.getElementById('admin-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

async function fetchAdminUsers() {
  const tbody = document.getElementById('admin-users-list');
  if (!tbody) return;
  
  tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 1rem; color: var(--text-muted);">Loading active accounts...</td></tr>';
  
  try {
    const response = await fetch('/api/admin/users');
    const result = await response.json();
    
    if (result.success && Array.isArray(result.data)) {
      tbody.innerHTML = '';
      if (result.data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 1rem; color: var(--text-muted);">No accounts found.</td></tr>';
        return;
      }
      
      result.data.forEach(user => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';
        
        // Hide delete actions on currently logged-in self
        const isSelf = user.id === appState.user.id;
        const deleteBtnHtml = isSelf 
          ? `<span style="font-size: 0.75rem; color: var(--text-muted); font-style: italic; padding-right: 0.5rem;">Current Session</span>`
          : `<button type="button" class="btn-delete-row" onclick="deleteAdminUser(${user.id}, '${user.username}')" style="font-size: 0.8rem; padding: 0.15rem 0.4rem;" title="Delete User">×</button>`;
          
        tr.innerHTML = `
          <td style="padding: 0.6rem 0.8rem; font-weight: 500; color: var(--text-bright);">${user.username}</td>
          <td style="padding: 0.6rem 0.8rem; color: var(--text-muted);">${user.email}</td>
          <td style="padding: 0.6rem 0.8rem;"><span class="role-badge ${user.role}">${user.role}</span></td>
          <td style="padding: 0.6rem 0.8rem; text-align: right; display: flex; gap: 0.4rem; justify-content: flex-end; align-items: center;">
            <button type="button" class="btn-secondary" onclick="resetAdminUserPassword(${user.id}, '${user.username}')" style="font-size: 0.7rem; padding: 0.15rem 0.45rem; height: auto;">Reset Pass</button>
            ${deleteBtnHtml}
          </td>
        `;
        tbody.appendChild(tr);
      });
    } else {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 1rem; color: var(--error);">${result.error || 'Failed to fetch user list'}</td></tr>`;
    }
  } catch (err) {
    console.error('Fetch users failed:', err);
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 1rem; color: var(--error);">Network connection error.</td></tr>';
  }
}

async function handleCreateUserSubmit(event) {
  event.preventDefault();
  
  const usernameInput = document.getElementById('create-username');
  const emailInput = document.getElementById('create-email');
  const passwordInput = document.getElementById('create-password');
  const roleSelect = document.getElementById('create-role');
  
  if (!usernameInput || !emailInput || !passwordInput || !roleSelect) return;
  
  const username = usernameInput.value.trim();
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const role = roleSelect.value;
  
  try {
    const response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, role })
    });
    
    const result = await response.json();
    if (result.success) {
      showToast(result.message, 'success');
      usernameInput.value = '';
      emailInput.value = '';
      passwordInput.value = '';
      roleSelect.value = 'user';
      fetchAdminUsers();
    } else {
      showToast(result.error || 'Failed to register account', 'error');
    }
  } catch (err) {
    console.error('Registration request failed:', err);
    showToast('Failed to connect to the server', 'error');
  }
}

async function resetAdminUserPassword(userId, username) {
  const newPassword = prompt(`Enter new password for account "${username}":`);
  if (newPassword === null) return; // cancelled
  
  const trimmed = newPassword.trim();
  if (!trimmed) {
    showToast('Password cannot be empty', 'error');
    return;
  }
  
  try {
    const response = await fetch(`/api/admin/users/${userId}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: trimmed })
    });
    
    const result = await response.json();
    if (result.success) {
      showToast(`Password for "${username}" updated!`, 'success');
    } else {
      showToast(result.error || 'Failed to reset password', 'error');
    }
  } catch (err) {
    console.error('Password reset request failed:', err);
    showToast('Connection to server failed', 'error');
  }
}

async function deleteAdminUser(userId, username) {
  if (!confirm(`Are you sure you want to permanently delete user account "${username}"?`)) {
    return;
  }
  
  try {
    const response = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    const result = await response.json();
    if (result.success) {
      showToast(`Account "${username}" deleted`, 'success');
      fetchAdminUsers();
    } else {
      showToast(result.error || 'Failed to delete account', 'error');
    }
  } catch (err) {
    console.error('Delete request failed:', err);
    showToast('Server connection failed', 'error');
  }
}
