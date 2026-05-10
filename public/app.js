let autocompleteIndex = [];
  let selectedActiveIds = new Set();
  let pendingPictureFiles = [];
  let pendingAddItemPictureFiles = [];
  let pendingEditItemPictureFiles = [];
  let pendingLabelFiles = [];
  let pendingEditItemLabelFiles = [];
  let inventoryItemCache = {};
  let inventoryItemsLoaded = false;
  let scannerStream = null;
  let scannerDetector = null;
  let scannerFrameRequest = null;
  let scannerLastValue = '';
  const APP_VERSION = String((window.VINTED_CONFIG && window.VINTED_CONFIG.APP_VERSION) || 'local-dev').trim();
  const APP_VERSION_STORAGE_KEY = 'vinted.inventory.appVersion';

  function setStartupText(text) {
    const el = document.getElementById('startupLoaderText');
    if (el) el.textContent = text || '';
  }

  async function prepareAppVersion() {
    setStartupText('Checking for updates...');
    const lastVersion = localStorage.getItem(APP_VERSION_STORAGE_KEY);
    if (lastVersion && lastVersion !== APP_VERSION) {
      setStartupText('Updating cached app data...');
      localStorage.clear();
      sessionStorage.clear();
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(key => caches.delete(key)));
      }
      localStorage.setItem(APP_VERSION_STORAGE_KEY, APP_VERSION);
      window.__appCacheWasCleared = true;
      return;
    }
    if (!lastVersion) localStorage.setItem(APP_VERSION_STORAGE_KEY, APP_VERSION);
    setStartupText('Loading app...');
  }

  function hideStartupLoader() {
    const loader = document.getElementById('startupLoader');
    if (!loader) return;
    loader.classList.add('is-hidden');
    setTimeout(() => loader.remove(), 220);
  }

  function loaderHtml(text, variant = 'panel') {
    const className = variant === 'compact' ? 'loader-compact' : 'loader-panel';
    return `<div class="${className}"><span class="loader-dot"></span><span>${escapeHtml(text)}</span></div>`;
  }

  function tableSkeletonHtml(text, columns = 6, rows = 6) {
    let body = '';
    for (let row = 0; row < rows; row++) {
      body += '<tr>';
      for (let col = 0; col < columns; col++) {
        const width = 42 + ((row + col) % 4) * 14;
        body += `<td><div class="skeleton-line" style="width:${width}%"></div></td>`;
      }
      body += '</tr>';
    }
    return `
      <div class="loader-compact"><span class="loader-dot"></span><span>${escapeHtml(text)}</span></div>
      <table class="skeleton-table"><tbody>${body}</tbody></table>
    `;
  }

  function dashboardSkeletonHtml() {
    let cards = '';
    for (let i = 0; i < 8; i++) {
      cards += '<div class="skeleton-card"><div class="skeleton-line" style="width:62%"></div><div class="skeleton-line" style="width:36%"></div></div>';
    }
    return `<div class="loader-compact"><span class="loader-dot"></span><span>Loading dashboard...</span></div><div class="skeleton-card-grid">${cards}</div>`;
  }

  function setElementHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  const startupReady = prepareAppVersion().catch(err => {
    console.warn('Version preparation failed', err);
    setStartupText('Loading app...');
  });

  function renderMessage(id, text, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = text ? `<div class="${type}">${text}</div>` : '';
  }

  function showToast(text, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = text || '';
    container.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2600);
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeText(text) {
    return String(text || '').toLowerCase().trim();
  }

  function money(value) {
    return `Â£${Number(value || 0).toFixed(2)}`;
  }

  function statusClass(status) {
    return `pill-status-${String(status || '').toLowerCase().replace(/\s+/g, '-')}`;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error(`Could not read file: ${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  function detectDeviceClass() {
    const width = window.innerWidth || document.documentElement.clientWidth || 1200;
    const body = document.body;
    if (!body) return;

    body.classList.remove('device-phone', 'device-tablet', 'device-desktop');

    if (width <= 767) {
      body.classList.add('device-phone');
    } else if (width <= 1100) {
      body.classList.add('device-tablet');
    } else {
      body.classList.add('device-desktop');
    }
  }

  function showLoginScreen() {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('appShell').classList.add('hidden');
  }

  function showApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
  }

  function clearLoginForm() {
    document.getElementById('loginIdentifier').value = '';
    document.getElementById('loginPassword').value = '';
    renderMessage('loginResult', '', 'success');
  }

  function submitLogin() {
    const identifier = document.getElementById('loginIdentifier').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!identifier || !password) {
      renderMessage('loginResult', 'Please enter both username and password.', 'error');
      return;
    }

    google.script.run
      .withSuccessHandler(async res => {
        if (!res || !res.success) {
          renderMessage('loginResult', escapeHtml((res && res.message) || 'Login failed.'), 'error');
          return;
        }

        showApp();
        preloadAutocompleteIndex();
        preloadInventoryItemCache();
        loadDashboard();
        loadActiveItemsTable();
        loadArchivedItemsTable();
        loadTasks();
        showToast('Logged in', 'success');
      })
      .withFailureHandler(err => {
        renderMessage('loginResult', escapeHtml(err.message || 'Login failed.'), 'error');
      })
      .validateLogin(identifier, password);
  }

  function logout() {
    selectedActiveIds.clear();
    inventoryItemCache = {};
    inventoryItemsLoaded = false;
    clearLoginForm();
    showLoginScreen();
    showToast('Logged out', 'success');
  }

  function showTab(tabId, btn) {
    document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));

    const page = document.getElementById(tabId);
    if (page) page.classList.add('active');
    if (btn) btn.classList.add('active');

    if (tabId === 'dashboardTab') loadDashboard();
    if (tabId === 'tableTab') loadActiveItemsTable();
    if (tabId === 'archivedTab') loadArchivedItemsTable();
    if (tabId === 'tasksTab') loadTasks();
    if (tabId === 'picturesTab') loadPicturesForSelectedItem();
    if (tabId === 'labelsTab') loadLabelsForSelectedItem();
  }

  function preloadAutocompleteIndex() {
    google.script.run
      .withSuccessHandler(items => {
        autocompleteIndex = items || [];
      })
      .getAutocompleteIndex();
  }

  function preloadInventoryItemCache(callback) {
    google.script.run
      .withSuccessHandler(items => {
        inventoryItemCache = {};
        (items || []).forEach(item => {
          const itemId = String(item['Item ID'] || '').trim();
          if (itemId) inventoryItemCache[itemId] = item;
        });
        inventoryItemsLoaded = true;
        if (typeof callback === 'function') callback();
      })
      .withFailureHandler(() => {
        inventoryItemCache = {};
        inventoryItemsLoaded = false;
        if (typeof callback === 'function') callback();
      })
      .getAllInventoryItemsForClient();
  }

  function getCachedItem(itemId) {
    return inventoryItemCache[String(itemId || '').trim()] || null;
  }

  function updateCachedItem(item) {
    const itemId = String((item && item['Item ID']) || '').trim();
    if (!itemId) return;
    inventoryItemCache[itemId] = item;
  }

  function filterAutocompleteItems(query) {
    const q = normalizeText(query);
    if (!q) return [];
    return autocompleteIndex.filter(item =>
      [item.itemId, item.barcode, item.title, item.brand, item.status].some(v => normalizeText(v).includes(q))
    ).slice(0, 8);
  }

  function attachLocalAutocomplete(inputId, resultsId, options = {}) {
    const input = document.getElementById(inputId);
    const results = document.getElementById(resultsId);
    if (!input || !results) return;

    const { hiddenId = null, onSelect = null, statusFilter = null } = options;
    const hidden = hiddenId ? document.getElementById(hiddenId) : null;

    function clearResults() {
      results.innerHTML = '';
      results.classList.add('hidden');
    }

    function renderResults(items) {
      if (!items.length) {
        clearResults();
        return;
      }

      let html = '';
      items.forEach(item => {
        html += `
          <div class="autocomplete-item" data-id="${escapeHtml(item.itemId)}" data-title="${escapeHtml(item.title)}">
            <div class="autocomplete-title">${escapeHtml(item.itemId)} â€” ${escapeHtml(item.title)}</div>
            <div class="autocomplete-meta">${escapeHtml(item.barcode || '')} â€¢ ${escapeHtml(item.brand || '')} â€¢ ${escapeHtml(item.status || '')}</div>
          </div>
        `;
      });

      results.innerHTML = html;
      results.classList.remove('hidden');

      results.querySelectorAll('.autocomplete-item').forEach(row => {
        row.addEventListener('click', () => {
          const itemId = row.dataset.id;
          const itemTitle = row.dataset.title;

          if (hidden) hidden.value = itemId;
          input.value = `${itemId} â€” ${itemTitle}`;
          clearResults();

          if (typeof onSelect === 'function') {
            onSelect({ itemId, title: itemTitle });
          }
        });
      });
    }

    input.addEventListener('input', function () {
      if (hidden) hidden.value = '';
      const q = input.value.trim();
      if (!q) {
        clearResults();
        return;
      }

      let items = filterAutocompleteItems(q);
      if (typeof statusFilter === 'function') items = items.filter(statusFilter);
      renderResults(items);
    });

    input.addEventListener('focus', function () {
      if (input.value.trim()) input.dispatchEvent(new Event('input'));
    });

    input.addEventListener('blur', function () {
      setTimeout(clearResults, 180);
    });
  }

  function openEditModal() {
    const modal = document.getElementById('editModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  function closeEditModal() {
    const modal = document.getElementById('editModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.style.display = 'none';
    renderMessage('editResult', '', 'success');
    renderMessage('modalSaleResult', '', 'success');
    renderMessage('editPicturesResult', '', 'success');
    renderMessage('editLabelsResult', '', 'success');
  }

  function openImageLightbox(src) {
    const modal = document.getElementById('imageLightbox');
    const img = document.getElementById('lightboxImage');
    if (!modal || !img) return;
    img.src = src || '';
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  function closeImageLightbox() {
    const modal = document.getElementById('imageLightbox');
    const img = document.getElementById('lightboxImage');
    if (!modal || !img) return;
    img.src = '';
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }

  function openPdfLightbox(src) {
    const modal = document.getElementById('pdfLightbox');
    const frame = document.getElementById('pdfLightboxFrame');
    if (!modal || !frame) return;
    frame.src = src || '';
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  function closePdfLightbox() {
    const modal = document.getElementById('pdfLightbox');
    const frame = document.getElementById('pdfLightboxFrame');
    if (!modal || !frame) return;
    frame.src = '';
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }

  function safeSet(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = value == null ? '' : value;
  }

  function safeSetHtml(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = value == null ? '' : value;
  }

  function toDateInput(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  function populateEditFormFromItem(item) {
    if (!item || typeof item !== 'object') return;

    safeSet('editItemId', item['Item ID'] || '');
    safeSet('editTitle', item['Title'] || '');
    safeSet('editCategory', item['Category'] || '');
    safeSet('editBrand', item['Brand'] || '');
    safeSet('editSize', item['Size'] || '');
    safeSet('editCondition', item['Condition'] || '');
    safeSet('editColor', item['Color'] || '');
    safeSet('editPurchasePrice', item['Purchase Price'] || '');
    safeSet('editTargetSalePrice', item['Target Sale Price'] || '');
    safeSet('editDesiredProfit', item['Desired Profit'] || '');
    safeSet('editPlatformFee', item['Platform Fee'] || '');
    safeSet('editOtherCosts', item['Other Costs'] || '');
    safeSet('editPurchaseDate', toDateInput(item['Purchase Date']));
    safeSet('editListingDate', toDateInput(item['Listing Date']));
    safeSet('editKeywords', item['Keywords'] || '');
    safeSet('editStorageLocation', item['Storage Location'] || '');
    safeSet('editSource', item['Source'] || '');
    safeSet('editVintedUrl', item['Vinted URL'] || '');
    safeSet('editStatus', item['Status'] || 'Draft');
    safeSet('editDescription', item['Description'] || '');
    safeSet('editNotes', item['Notes'] || '');
    safeSet('modalSalePrice', item['Actual Sale Price'] || '');

    safeSetHtml(
      'editMeta',
      `Item ID: <strong>${escapeHtml(item['Item ID'] || '')}</strong> â€¢ Barcode: <strong>${escapeHtml(item['Barcode'] || '')}</strong> â€¢ Current status: <strong>${escapeHtml(item['Status'] || '')}</strong>`
    );
  }

  function openItemEditor(itemId) {
    if (!itemId) {
      renderMessage('editResult', 'No item ID was provided.', 'error');
      return;
    }

    openEditModal();
    pendingEditItemPictureFiles = [];
    pendingEditItemLabelFiles = [];
    safeSet('editItemId', itemId);
    safeSet('editTitle', '');
    safeSet('editCategory', '');
    safeSet('editBrand', '');
    safeSet('editSize', '');
    safeSet('editCondition', '');
    safeSet('editColor', '');
    safeSet('editPurchasePrice', '');
    safeSet('editTargetSalePrice', '');
    safeSet('editDesiredProfit', '');
    safeSet('editPlatformFee', '');
    safeSet('editOtherCosts', '');
    safeSet('editPurchaseDate', '');
    safeSet('editListingDate', '');
    safeSet('editKeywords', '');
    safeSet('editStorageLocation', '');
    safeSet('editSource', '');
    safeSet('editVintedUrl', '');
    safeSet('editStatus', 'Draft');
    safeSet('editDescription', '');
    safeSet('editNotes', '');
    safeSet('modalSalePrice', '');
    safeSetHtml('editMeta', `Item ID: <strong>${escapeHtml(itemId)}</strong>`);
    renderPendingPictureList(pendingEditItemPictureFiles, 'editItemPendingPictures', 'editItem');
    renderPendingLabelList(pendingEditItemLabelFiles, 'editItemPendingLabels', 'editLabel');
    setElementHtml('editPicturesGallery', loaderHtml('Loading pictures...'));
    setElementHtml('editLabelsGallery', loaderHtml('Loading labels...'));
    setElementHtml('auditLogTable', tableSkeletonHtml('Loading audit history...', 6, 4));
    setElementHtml('packagingProofCard', loaderHtml('Loading packaging proof...'));

    const cachedItem = getCachedItem(itemId);

    if (cachedItem) {
      try {
        populateEditFormFromItem(cachedItem);
        renderMessage('editResult', '', 'success');
      } catch (e) {
        renderMessage('editResult', `Could not populate cached item data: ${escapeHtml(e.message)}`, 'error');
      }
    } else {
      renderMessage('editResult', 'Loading item...', 'success');
    }

    loadEditItemPictures();
    loadEditItemLabels();
    loadAuditLog(itemId);
    loadPackagingProofCard(itemId);

    if (!cachedItem) {
      google.script.run
        .withSuccessHandler(function(item) {
          try {
            if (!item || typeof item !== 'object') {
              renderMessage('editResult', 'No item data was returned for this item.', 'error');
              return;
            }
            populateEditFormFromItem(item);
            updateCachedItem(item);
            renderMessage('editResult', '', 'success');
          } catch (e) {
            renderMessage('editResult', `Could not populate item fields: ${escapeHtml(e.message)}`, 'error');
          }
        })
        .withFailureHandler(function(err) {
          renderMessage('editResult', `Could not load the item's data: ${escapeHtml(err.message || 'Unknown error')}`, 'error');
        })
        .fetchItemForEdit(itemId);
    }
  }

  function duplicateCurrentItem() {
    const itemId = document.getElementById('editItemId').value || '';
    if (!itemId) return;

    google.script.run
      .withSuccessHandler(res => {
        showToast(`Duplicated ${res.itemId}`, 'success');
        refreshAll();
      })
      .withFailureHandler(err => renderMessage('editResult', escapeHtml(err.message), 'error'))
      .duplicateInventoryItem(itemId);
  }

  function saveModalSale() {
    const itemId = document.getElementById('editItemId').value;
    const actualSalePrice = document.getElementById('modalSalePrice').value;

    if (!itemId) {
      renderMessage('modalSaleResult', 'No item selected.', 'error');
      return;
    }

    google.script.run
      .withSuccessHandler(res => {
        document.getElementById('editStatus').value = 'Sold';
        renderMessage('modalSaleResult', `Sale recorded. Profit: ${money(res.actualProfit)}`, 'success');
        showToast('Sale recorded', 'success');
        refreshAll();
        openItemEditor(itemId);
      })
      .withFailureHandler(err => renderMessage('modalSaleResult', escapeHtml(err.message), 'error'))
      .recordSale(itemId, actualSalePrice);
  }

  function syncSelectedCheckboxes() {
    document.querySelectorAll('.active-row-checkbox').forEach(cb => {
      cb.checked = selectedActiveIds.has(cb.dataset.itemId);
    });

    const master = document.getElementById('selectAllActive');
    if (master) {
      const boxes = Array.from(document.querySelectorAll('.active-row-checkbox'));
      master.checked = boxes.length > 0 && boxes.every(cb => cb.checked);
    }
  }

  function loadActiveItemsTable() {
    const query = document.getElementById('activeTableSearch')?.value || '';
    setElementHtml('activeItemsTable', tableSkeletonHtml('Loading records...', 8, 7));

    google.script.run
      .withSuccessHandler(payload => {
        const el = document.getElementById('activeItemsTable');
        const items = payload.items || [];
        const rowCount = payload.rowCount || 0;

        if (!items.length) {
          el.innerHTML = `<p class="muted">No active items to show. Rows: ${rowCount}</p>`;
          return;
        }

        let html = `
          <div class="muted" style="margin: 0 0 12px 0;">Rows shown: <strong>${rowCount}</strong></div>
          <table>
            <thead>
              <tr>
                <th><input type="checkbox" id="selectAllActive"></th>
                <th>Title</th>
                <th>Item ID</th>
                <th>Barcode</th>
                <th>Target Price</th>
                <th>Date Listed</th>
                <th>Status</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
        `;

        items.forEach(item => {
          html += `
            <tr class="excel-row">
              <td><input type="checkbox" class="row-check active-row-checkbox" data-item-id="${escapeHtml(item.itemId)}"></td>
              <td>${escapeHtml(item.title)}</td>
              <td>${escapeHtml(item.itemId)}</td>
              <td>${escapeHtml(item.barcode || '')}</td>
              <td>${money(item.targetPrice)}</td>
              <td>${escapeHtml(item.listingDate)}</td>
              <td><span class="pill ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>
              <td><button type="button" class="secondary" onclick="openItemEditor('${escapeHtml(item.itemId)}')">Edit</button></td>
            </tr>
          `;
        });

        html += '</tbody></table>';
        el.innerHTML = html;

        const master = document.getElementById('selectAllActive');
        if (master) {
          master.addEventListener('change', function () {
            document.querySelectorAll('.active-row-checkbox').forEach(cb => {
              cb.checked = master.checked;
              if (master.checked) selectedActiveIds.add(cb.dataset.itemId);
              else selectedActiveIds.delete(cb.dataset.itemId);
            });
          });
        }

        el.querySelectorAll('.active-row-checkbox').forEach(cb => {
          cb.addEventListener('change', function () {
            if (this.checked) selectedActiveIds.add(this.dataset.itemId);
            else selectedActiveIds.delete(this.dataset.itemId);
            syncSelectedCheckboxes();
          });
        });

        syncSelectedCheckboxes();
      })
      .withFailureHandler(err => {
        document.getElementById('activeItemsTable').innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
      })
      .getActiveItemsTable(query);
  }

  function loadArchivedItemsTable() {
    const query = document.getElementById('archivedTableSearch')?.value || '';
    setElementHtml('archivedItemsTable', tableSkeletonHtml('Loading records...', 7, 6));

    google.script.run
      .withSuccessHandler(payload => {
        const el = document.getElementById('archivedItemsTable');
        const items = payload.items || [];
        const rowCount = payload.rowCount || 0;

        if (!items.length) {
          el.innerHTML = `<p class="muted">No archived items to show. Rows: ${rowCount}</p>`;
          return;
        }

        let html = `
          <div class="muted" style="margin: 0 0 12px 0;">Rows shown: <strong>${rowCount}</strong></div>
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Item ID</th>
                <th>Barcode</th>
                <th>Target Price</th>
                <th>Date Listed</th>
                <th>Status</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
        `;

        items.forEach(item => {
          html += `
            <tr class="excel-row">
              <td>${escapeHtml(item.title)}</td>
              <td>${escapeHtml(item.itemId)}</td>
              <td>${escapeHtml(item.barcode || '')}</td>
              <td>${money(item.targetPrice)}</td>
              <td>${escapeHtml(item.listingDate)}</td>
              <td><span class="pill ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>
              <td><button type="button" class="secondary" onclick="openItemEditor('${escapeHtml(item.itemId)}')">Edit</button></td>
            </tr>
          `;
        });

        html += '</tbody></table>';
        el.innerHTML = html;
      })
      .withFailureHandler(err => {
        document.getElementById('archivedItemsTable').innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
      })
      .getArchivedItemsTable(query);
  }

  function applyBulkStatusUpdate() {
    const newStatus = document.getElementById('bulkStatusSelect').value;
    const itemIds = Array.from(selectedActiveIds);

    if (!itemIds.length) {
      renderMessage('bulkResult', 'Please select at least one item.', 'error');
      return;
    }
    if (!newStatus) {
      renderMessage('bulkResult', 'Please choose a status first.', 'error');
      return;
    }

    google.script.run
      .withSuccessHandler(res => {
        renderMessage('bulkResult', `Updated ${res.count} item(s) to ${escapeHtml(newStatus)}.`, 'success');
        selectedActiveIds.clear();
        showToast('Bulk update complete', 'success');
        refreshAll();
      })
      .withFailureHandler(err => renderMessage('bulkResult', escapeHtml(err.message), 'error'))
      .bulkUpdateStatuses(itemIds, newStatus);
  }

  function updateStatus() {
    const itemId = document.getElementById('statusItemId').value;
    const newStatus = document.getElementById('newStatus').value;
    const note = document.getElementById('statusNote').value;

    if (!itemId) {
      renderMessage('statusResult', 'Please select an item first.', 'error');
      return;
    }

    google.script.run
      .withSuccessHandler(() => {
        renderMessage('statusResult', 'Status updated.', 'success');
        showToast('Status updated', 'success');
        refreshAll();
      })
      .withFailureHandler(err => renderMessage('statusResult', escapeHtml(err.message), 'error'))
      .updateItemStatus(itemId, newStatus, note);
  }

  function recordSale() {
    const itemId = document.getElementById('saleItemId').value;
    const actualSalePrice = document.getElementById('actualSalePrice').value;

    if (!itemId) {
      renderMessage('saleResult', 'Please select an item first.', 'error');
      return;
    }

    google.script.run
      .withSuccessHandler(res => {
        renderMessage('saleResult', `Sale recorded. Profit: ${money(res.actualProfit)}`, 'success');
        showToast('Sale recorded', 'success');
        refreshAll();
      })
      .withFailureHandler(err => renderMessage('saleResult', escapeHtml(err.message), 'error'))
      .recordSale(itemId, actualSalePrice);
  }

  function relistItem() {
    const itemId = document.getElementById('relistItemId').value;
    if (!itemId) {
      renderMessage('relistResult', 'Please select an item first.', 'error');
      return;
    }

    google.script.run
      .withSuccessHandler(() => {
        renderMessage('relistResult', 'Item relisted and listing date reset to today.', 'success');
        showToast('Item relisted', 'success');
        refreshAll();
      })
      .withFailureHandler(err => renderMessage('relistResult', escapeHtml(err.message), 'error'))
      .relistItem(itemId);
  }

  function scannerOverlay(text) {
    const el = document.getElementById('scannerOverlay');
    if (el) el.textContent = text || '';
  }

  function parseScannedValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    try {
      const url = new URL(raw);
      return url.searchParams.get('itemId') ||
        url.searchParams.get('item_id') ||
        url.searchParams.get('barcode') ||
        url.pathname.split('/').filter(Boolean).pop() ||
        raw;
    } catch (e) {
      return raw;
    }
  }

  function setScannedItem(item, scannedValue) {
    const itemId = item['Item ID'] || '';
    document.getElementById('scannerItemId').value = itemId;
    document.getElementById('scannerManualCode').value = scannedValue || item['Barcode'] || itemId;
    document.getElementById('scannerItemSummary').innerHTML =
      `Matched <strong>${escapeHtml(itemId)}</strong> &mdash; ${escapeHtml(item['Title'] || '')} (${escapeHtml(item['Status'] || '')})`;
    renderMessage('scannerResult', 'Item found. Choose a status and update when ready.', 'success');
    scannerOverlay('Item found');
  }

  function lookupScannedCode(value) {
    const parsed = parseScannedValue(value);
    if (!parsed) {
      renderMessage('scannerResult', 'No QR or barcode value found.', 'error');
      return;
    }

    google.script.run
      .withSuccessHandler(item => setScannedItem(item, parsed))
      .withFailureHandler(() => {
        google.script.run
          .withSuccessHandler(item => setScannedItem(item, parsed))
          .withFailureHandler(err => {
            document.getElementById('scannerItemId').value = '';
            document.getElementById('scannerItemSummary').innerHTML = '';
            renderMessage('scannerResult', escapeHtml(err.message || 'No matching item found.'), 'error');
            scannerOverlay('No match');
          })
          .fetchItemForEdit(parsed);
      })
      .fetchItemByBarcode(parsed);
  }

  function lookupManualScannerCode() {
    lookupScannedCode(document.getElementById('scannerManualCode').value);
  }

  async function startQrScanner() {
    if (!('BarcodeDetector' in window)) {
      renderMessage('scannerResult', 'This browser does not support live camera decoding. Paste the QR or barcode value into the manual field.', 'error');
      return;
    }

    stopQrScanner();
    scannerLastValue = '';
    scannerDetector = new BarcodeDetector({
      formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e']
    });

    try {
      scannerStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      const video = document.getElementById('scannerVideo');
      video.srcObject = scannerStream;
      await video.play();
      scannerOverlay('Scanning...');
      scanFrame();
    } catch (err) {
      renderMessage('scannerResult', escapeHtml(err.message || 'Could not start camera.'), 'error');
      scannerOverlay('Camera unavailable');
    }
  }

  async function scanFrame() {
    const video = document.getElementById('scannerVideo');
    if (!scannerStream || !scannerDetector || !video) return;

    try {
      const codes = await scannerDetector.detect(video);
      if (codes.length) {
        const value = codes[0].rawValue || '';
        if (value && value !== scannerLastValue) {
          scannerLastValue = value;
          lookupScannedCode(value);
        }
      }
    } catch (e) {
      scannerOverlay('Scanning...');
    }

    scannerFrameRequest = requestAnimationFrame(scanFrame);
  }

  function stopQrScanner() {
    if (scannerFrameRequest) cancelAnimationFrame(scannerFrameRequest);
    scannerFrameRequest = null;
    if (scannerStream) scannerStream.getTracks().forEach(track => track.stop());
    scannerStream = null;
    const video = document.getElementById('scannerVideo');
    if (video) video.srcObject = null;
    scannerOverlay('Camera idle');
  }

  function applyScannedStatus() {
    const itemId = document.getElementById('scannerItemId').value;
    const newStatus = document.getElementById('scannerNewStatus').value;
    const note = document.getElementById('scannerStatusNote').value;
    if (!itemId) {
      renderMessage('scannerResult', 'Scan or look up an item first.', 'error');
      return;
    }

    google.script.run
      .withSuccessHandler(() => {
        renderMessage('scannerResult', 'Scanned item updated.', 'success');
        showToast('Scanned item updated', 'success');
        refreshAll();
      })
      .withFailureHandler(err => renderMessage('scannerResult', escapeHtml(err.message), 'error'))
      .updateItemStatus(itemId, newStatus, note || 'Updated from QR / barcode scanner');
  }

  function sendUrgentTaskEmail() {
    google.script.run
      .withSuccessHandler(res => {
        renderMessage('triggerResult', `Urgent task email sent. Tasks included: ${res.count}`, 'success');
        showToast('Urgent task email sent', 'success');
      })
      .withFailureHandler(err => renderMessage('triggerResult', escapeHtml(err.message), 'error'))
      .sendUrgentTaskEmail();
  }

  function generatePackingPdf() {
    renderMessage('packingPdfResult', 'Generating PDF...', 'success');

    google.script.run
      .withSuccessHandler(res => {
        renderMessage('packingPdfResult', `${escapeHtml(res.name)} ready.`, 'success');
        showToast('Packing PDF ready', 'success');

        const bytes = atob(res.base64);
        const array = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);

        const blob = new Blob([array], { type: res.mimeType || 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = res.name || 'packing-list.pdf';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      })
      .withFailureHandler(err => renderMessage('packingPdfResult', escapeHtml(err.message), 'error'))
      .generatePackingListPdf();
  }

  function generateTemplateDescriptionForSelected() {
    const itemId = document.getElementById('editItemId').value;
    if (!itemId) return;

    google.script.run
      .withSuccessHandler(text => {
        document.getElementById('editDescription').value = text;
        renderMessage('editResult', 'Template description generated.', 'success');
        showToast('Template description generated', 'success');
      })
      .withFailureHandler(err => renderMessage('editResult', escapeHtml(err.message), 'error'))
      .generateTemplateDescriptionForItem(itemId);
  }

  function generateAIDescriptionForSelected() {
    const itemId = document.getElementById('editItemId').value;
    if (!itemId) return;

    renderMessage('editResult', 'Generating AI description...', 'success');

    google.script.run
      .withSuccessHandler(text => {
        document.getElementById('editDescription').value = text;
        renderMessage('editResult', 'AI description generated.', 'success');
        showToast('AI description generated', 'success');
      })
      .withFailureHandler(err => renderMessage('editResult', escapeHtml(err.message), 'error'))
      .generateAIDescriptionForItem(itemId);
  }

  function copyDescription() {
    const text = document.getElementById('editDescription').value || '';
    navigator.clipboard.writeText(text)
      .then(() => {
        renderMessage('editResult', 'Description copied to clipboard.', 'success');
        showToast('Description copied', 'success');
      })
      .catch(() => renderMessage('editResult', 'Could not copy description.', 'error'));
  }

  async function uploadFilesForItem(itemId, filesWithNotes) {
    let completed = 0;
    let failed = 0;
    for (const item of filesWithNotes) {
      try {
        const dataUrl = await readFileAsDataUrl(item.file);
        await new Promise((resolve) => {
          google.script.run
            .withSuccessHandler(() => { completed++; resolve(); })
            .withFailureHandler(() => { failed++; resolve(); })
            .uploadItemPicture({
              itemId,
              fileName: item.file.name,
              mimeType: item.file.type || 'image/jpeg',
              dataUrl,
              note: item.note || '',
              isCover: item.isCover || false,
              isPackagingProof: item.isPackagingProof || false,
              photoType: item.photoType || 'General'
            });
        });
      } catch (err) {
        failed++;
      }
    }
    return { completed, failed };
  }

  async function uploadLabelFilesForItem(itemId, filesWithNotes) {
    let completed = 0;
    let failed = 0;
    for (const item of filesWithNotes) {
      try {
        const dataUrl = await readFileAsDataUrl(item.file);
        await new Promise((resolve) => {
          google.script.run
            .withSuccessHandler(() => { completed++; resolve(); })
            .withFailureHandler(() => { failed++; resolve(); })
            .uploadItemLabel({
              itemId,
              fileName: item.file.name,
              mimeType: item.file.type || 'application/pdf',
              dataUrl,
              note: item.note || ''
            });
        });
      } catch (err) {
        failed++;
      }
    }
    return { completed, failed };
  }

  function renderPendingPictureList(files, containerId, prefix) {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!files.length) {
      el.innerHTML = '<p class="muted">No files selected yet.</p>';
      return;
    }

    let html = '<div class="pending-pictures-list">';
    files.forEach((item, index) => {
      html += `
        <div class="pending-picture-row">
          <div class="pending-picture-name">${escapeHtml(item.file.name)}</div>
          <div class="form-grid">
            <label>
              <span>Note</span>
              <input id="${prefix}Note-${index}" value="${escapeHtml(item.note || '')}" placeholder="Optional note">
            </label>
            <label>
              <span>Photo type</span>
              <select id="${prefix}Type-${index}">
                <option value="General">General</option>
                <option value="Front">Front</option>
                <option value="Back">Back</option>
                <option value="Label">Label</option>
                <option value="Flaw">Flaw</option>
                <option value="Packaging Proof">Packaging Proof</option>
              </select>
            </label>
          </div>
          <div class="check-row">
            <label><input type="checkbox" id="${prefix}Cover-${index}"> Cover image</label>
            <label><input type="checkbox" id="${prefix}Packaging-${index}"> Packaging proof</label>
          </div>
        </div>
      `;
    });
    html += '</div>';
    el.innerHTML = html;

    files.forEach((item, index) => {
      const typeEl = document.getElementById(`${prefix}Type-${index}`);
      const coverEl = document.getElementById(`${prefix}Cover-${index}`);
      const packagingEl = document.getElementById(`${prefix}Packaging-${index}`);
      if (typeEl && item.photoType) typeEl.value = item.photoType;
      if (coverEl) coverEl.checked = !!item.isCover;
      if (packagingEl) packagingEl.checked = !!item.isPackagingProof;
    });
  }

  function renderPendingLabelList(files, containerId, prefix) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!files.length) {
      el.innerHTML = '<p class="muted">No files selected yet.</p>';
      return;
    }

    let html = '<div class="pending-pictures-list">';
    files.forEach((item, index) => {
      html += `
        <div class="pending-picture-row">
          <div class="pending-picture-name">${escapeHtml(item.file.name)}</div>
          <label>
            <span>Note for this label</span>
            <input id="${prefix}Note-${index}" value="${escapeHtml(item.note || '')}" placeholder="Optional note">
          </label>
        </div>
      `;
    });
    html += '</div>';
    el.innerHTML = html;
  }

  function getPictureNotesFromRenderedInputs(files, prefix) {
    return files.map((item, index) => {
      const noteEl = document.getElementById(`${prefix}Note-${index}`);
      const typeEl = document.getElementById(`${prefix}Type-${index}`);
      const coverEl = document.getElementById(`${prefix}Cover-${index}`);
      const packagingEl = document.getElementById(`${prefix}Packaging-${index}`);
      return {
        file: item.file,
        note: noteEl ? noteEl.value : '',
        photoType: typeEl ? typeEl.value : 'General',
        isCover: coverEl ? coverEl.checked : false,
        isPackagingProof: packagingEl ? packagingEl.checked : false
      };
    });
  }

  function getNotesFromRenderedInputs(files, prefix) {
    return files.map((item, index) => {
      const noteEl = document.getElementById(`${prefix}Note-${index}`);
      return { file: item.file, note: noteEl ? noteEl.value : '' };
    });
  }

  async function uploadSelectedPictures() {
    const itemId = document.getElementById('pictureItemId').value || '';
    if (!itemId) {
      renderMessage('picturesResult', 'Select an item first.', 'error');
      return;
    }
    if (!pendingPictureFiles.length) {
      renderMessage('picturesResult', 'Choose one or more image files first.', 'error');
      return;
    }

    const filesWithNotes = getPictureNotesFromRenderedInputs(pendingPictureFiles, 'pictures');
    renderMessage('picturesResult', 'Uploading pictures...', 'success');

    const result = await uploadFilesForItem(itemId, filesWithNotes);

    renderMessage('picturesResult',
      `Finished uploading. Success: ${result.completed}. Failed: ${result.failed}.`,
      result.failed ? 'error' : 'success');

    showToast(`Pictures uploaded: ${result.completed}`, result.failed ? 'error' : 'success');
    pendingPictureFiles = [];
    document.getElementById('pictureFiles').value = '';
    renderPendingPictureList(pendingPictureFiles, 'pendingPictures', 'pictures');
    loadPicturesForSelectedItem();
  }

  function renderPictureChecklist(containerId, checklist) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!checklist) {
      el.innerHTML = '';
      return;
    }
    const missing = checklist.missingRequired || [];
    el.innerHTML = `
      <div class="panel panel-soft checklist-panel">
        <div><strong>Photo checklist</strong></div>
        <div>Cover image: ${checklist.hasCover ? 'Yes' : 'No'}</div>
        <div>Packaging proof: ${checklist.hasPackagingProof ? 'Yes' : 'No'}</div>
        <div>Missing required photos: ${missing.length ? escapeHtml(missing.join(', ')) : 'None'}</div>
      </div>
    `;
  }

  function renderPictureCards(targetId, pictures, deleteFnName, updateFnName) {
    const gallery = document.getElementById(targetId);
    if (!gallery) return;
    if (!pictures || !pictures.length) {
      gallery.innerHTML = '<p class="muted">No pictures for this item yet.</p>';
      return;
    }

    let html = '';
    pictures.forEach(pic => {
      html += `
        <div class="picture-card">
          <img src="${escapeHtml(pic.thumbUrl || pic.imageUrl)}" alt="Item picture" style="object-fit:contain;background:#fff;cursor:pointer;" onclick="openImageLightbox('${escapeHtml(pic.fullImageUrl || pic.thumbUrl || pic.imageUrl)}')">
          <div class="picture-card-body">
            <div class="picture-meta"><strong>${escapeHtml(pic.pictureId)}</strong></div>
            <div class="picture-meta">${escapeHtml(pic.note || 'No note')}</div>
            <div class="picture-meta">${escapeHtml(pic.photoType || 'General')}</div>
            <div class="picture-meta muted">${escapeHtml(pic.uploadedAt || '')}</div>
            <div class="flag-row">
              ${pic.isCover ? '<span class="mini-flag">Cover</span>' : ''}
              ${pic.isPackagingProof ? '<span class="mini-flag">Packaging proof</span>' : ''}
            </div>
            <div class="button-row compact">
              <button type="button" class="secondary" onclick="openImageLightbox('${escapeHtml(pic.fullImageUrl || pic.thumbUrl || pic.imageUrl)}')">Open</button>
              <button type="button" class="secondary" onclick="${updateFnName}('${escapeHtml(pic.pictureId)}', ${pic.isCover ? 'false' : 'true'}, ${pic.isPackagingProof ? 'true' : 'false'}, '${escapeHtml(pic.photoType || 'General')}')">${pic.isCover ? 'Unset Cover' : 'Make Cover'}</button>
              <button type="button" class="secondary" onclick="${updateFnName}('${escapeHtml(pic.pictureId)}', ${pic.isCover ? 'true' : 'false'}, ${pic.isPackagingProof ? 'false' : 'true'}, '${escapeHtml(pic.photoType || 'General')}')">${pic.isPackagingProof ? 'Unset Proof' : 'Make Proof'}</button>
              <button type="button" class="secondary" onclick="${deleteFnName}('${escapeHtml(pic.pictureId)}')">Delete</button>
            </div>
          </div>
        </div>
      `;
    });
    gallery.innerHTML = html;
  }

  function loadPicturesForSelectedItem() {
    const itemId = document.getElementById('pictureItemId')?.value || '';
    if (!itemId) {
      document.getElementById('picturesGallery').innerHTML = '<p class="muted">Select an item first.</p>';
      document.getElementById('pictureChecklist').innerHTML = '';
      return;
    }
    setElementHtml('pictureChecklist', loaderHtml('Loading photo checklist...', 'compact'));
    setElementHtml('picturesGallery', loaderHtml('Loading pictures...'));

    google.script.run
      .withSuccessHandler(function(payload) {
        renderPictureChecklist('pictureChecklist', payload.checklist);
        renderPictureCards('picturesGallery', payload.pictures || [], 'deletePictureAndReload', 'togglePictureMeta');
      })
      .withFailureHandler(function(err) {
        renderMessage('picturesResult', escapeHtml(err.message || 'Could not load pictures.'), 'error');
      })
      .getPicturesForItem(itemId);
  }

  function togglePictureMeta(pictureId, isCover, isPackagingProof, photoType) {
    google.script.run
      .withSuccessHandler(() => {
        showToast('Picture updated', 'success');
        loadPicturesForSelectedItem();
        loadEditItemPictures();
        const editItemId = document.getElementById('editItemId')?.value || '';
        if (editItemId) loadPackagingProofCard(editItemId);
      })
      .withFailureHandler(err => renderMessage('picturesResult', escapeHtml(err.message || 'Could not update picture.'), 'error'))
      .updatePictureMeta(pictureId, { isCover, isPackagingProof, photoType });
  }

  function deletePictureAndReload(pictureId) {
    google.script.run
      .withSuccessHandler(function() {
        renderMessage('picturesResult', 'Picture deleted.', 'success');
        showToast('Picture deleted', 'success');
        loadPicturesForSelectedItem();
      })
      .withFailureHandler(function(err) {
        renderMessage('picturesResult', escapeHtml(err.message || 'Could not delete picture.'), 'error');
      })
      .deletePictureById(pictureId);
  }

  function loadEditItemPictures() {
    const itemId = document.getElementById('editItemId').value || '';
    if (!itemId) {
      document.getElementById('editPicturesGallery').innerHTML = '<p class="muted">No item selected.</p>';
      document.getElementById('editPictureChecklist').innerHTML = '';
      return;
    }
    setElementHtml('editPictureChecklist', loaderHtml('Loading photo checklist...', 'compact'));
    setElementHtml('editPicturesGallery', loaderHtml('Loading pictures...'));

    google.script.run
      .withSuccessHandler(function(payload) {
        renderPictureChecklist('editPictureChecklist', payload.checklist);
        renderPictureCards('editPicturesGallery', payload.pictures || [], 'deletePictureAndReloadEdit', 'togglePictureMetaFromEdit');
      })
      .withFailureHandler(function(err) {
        renderMessage('editPicturesResult', escapeHtml(err.message || 'Could not load pictures.'), 'error');
      })
      .getPicturesForItem(itemId);
  }

  function togglePictureMetaFromEdit(pictureId, isCover, isPackagingProof, photoType) {
    google.script.run
      .withSuccessHandler(() => {
        showToast('Picture updated', 'success');
        loadEditItemPictures();
        loadPicturesForSelectedItem();
        const editItemId = document.getElementById('editItemId')?.value || '';
        if (editItemId) loadPackagingProofCard(editItemId);
      })
      .withFailureHandler(err => renderMessage('editPicturesResult', escapeHtml(err.message || 'Could not update picture.'), 'error'))
      .updatePictureMeta(pictureId, { isCover, isPackagingProof, photoType });
  }

  async function uploadEditItemPictures() {
    const itemId = document.getElementById('editItemId').value || '';
    if (!itemId) {
      renderMessage('editPicturesResult', 'No item selected.', 'error');
      return;
    }
    if (!pendingEditItemPictureFiles.length) {
      renderMessage('editPicturesResult', 'Choose one or more pictures first.', 'error');
      return;
    }

    const filesWithNotes = getPictureNotesFromRenderedInputs(pendingEditItemPictureFiles, 'editItem');
    renderMessage('editPicturesResult', 'Uploading pictures...', 'success');

    const result = await uploadFilesForItem(itemId, filesWithNotes);

    renderMessage('editPicturesResult',
      `Finished uploading. Success: ${result.completed}. Failed: ${result.failed}.`,
      result.failed ? 'error' : 'success');

    showToast(`Pictures uploaded: ${result.completed}`, result.failed ? 'error' : 'success');
    pendingEditItemPictureFiles = [];
    document.getElementById('editItemPictures').value = '';
    renderPendingPictureList(pendingEditItemPictureFiles, 'editItemPendingPictures', 'editItem');
    loadEditItemPictures();
    loadPackagingProofCard(itemId);
  }

  function deletePictureAndReloadEdit(pictureId) {
    google.script.run
      .withSuccessHandler(function() {
        renderMessage('editPicturesResult', 'Picture deleted.', 'success');
        showToast('Picture deleted', 'success');
        loadEditItemPictures();
        const itemId = document.getElementById('editItemId')?.value || '';
        if (itemId) loadPackagingProofCard(itemId);
      })
      .withFailureHandler(function(err) {
        renderMessage('editPicturesResult', escapeHtml(err.message || 'Could not delete picture.'), 'error');
      })
      .deletePictureById(pictureId);
  }

  async function uploadSelectedLabels() {
    const itemId = document.getElementById('labelItemId').value || '';
    if (!itemId) {
      renderMessage('labelsResult', 'Select an item first.', 'error');
      return;
    }
    if (!pendingLabelFiles.length) {
      renderMessage('labelsResult', 'Choose one or more PDF files first.', 'error');
      return;
    }

    const filesWithNotes = getNotesFromRenderedInputs(pendingLabelFiles, 'labels');
    renderMessage('labelsResult', 'Uploading labels...', 'success');

    const result = await uploadLabelFilesForItem(itemId, filesWithNotes);

    renderMessage('labelsResult',
      `Finished uploading. Success: ${result.completed}. Failed: ${result.failed}.`,
      result.failed ? 'error' : 'success');

    showToast(`Labels uploaded: ${result.completed}`, result.failed ? 'error' : 'success');
    pendingLabelFiles = [];
    document.getElementById('labelFiles').value = '';
    renderPendingLabelList(pendingLabelFiles, 'pendingLabels', 'labels');
    loadLabelsForSelectedItem();
  }

  function renderLabelCards(targetId, labels, deleteFnName) {
    const gallery = document.getElementById(targetId);
    if (!gallery) return;
    if (!labels || !labels.length) {
      gallery.innerHTML = '<p class="muted">No labels for this item yet.</p>';
      return;
    }

    let html = '';
    labels.forEach(label => {
      html += `
        <div class="picture-card">
          <div style="height:220px;display:flex;align-items:center;justify-content:center;background:#f8fafc;padding:16px;">
            <div style="text-align:center;">
              <div style="font-size:44px;line-height:1;margin-bottom:10px;">ðŸ“„</div>
              <div style="font-weight:700;">PDF Label</div>
            </div>
          </div>
          <div class="picture-card-body">
            <div class="picture-meta"><strong>${escapeHtml(label.labelId)}</strong></div>
            <div class="picture-meta">${escapeHtml(label.note || 'No note')}</div>
            <div class="picture-meta muted">${escapeHtml(label.uploadedAt || '')}</div>
            <div class="button-row compact">
              <button type="button" class="secondary" onclick="openPdfLightbox('${escapeHtml(label.previewUrl || label.fileUrl)}')">Open</button>
              <button type="button" class="secondary" onclick="${deleteFnName}('${escapeHtml(label.labelId)}')">Delete</button>
            </div>
          </div>
        </div>
      `;
    });
    gallery.innerHTML = html;
  }

  function loadLabelsForSelectedItem() {
    const itemId = document.getElementById('labelItemId')?.value || '';
    if (!itemId) {
      document.getElementById('labelsGallery').innerHTML = '<p class="muted">Select an item first.</p>';
      return;
    }
    setElementHtml('labelsGallery', loaderHtml('Loading labels...'));

    google.script.run
      .withSuccessHandler(function(labels) {
        renderLabelCards('labelsGallery', labels || [], 'deleteLabelAndReload');
      })
      .withFailureHandler(function(err) {
        renderMessage('labelsResult', escapeHtml(err.message || 'Could not load labels.'), 'error');
      })
      .getLabelsForItem(itemId);
  }

  function deleteLabelAndReload(labelId) {
    google.script.run
      .withSuccessHandler(function() {
        renderMessage('labelsResult', 'Label deleted.', 'success');
        showToast('Label deleted', 'success');
        loadLabelsForSelectedItem();
      })
      .withFailureHandler(function(err) {
        renderMessage('labelsResult', escapeHtml(err.message || 'Could not delete label.'), 'error');
      })
      .deleteLabelById(labelId);
  }

  function loadEditItemLabels() {
    const itemId = document.getElementById('editItemId').value || '';
    if (!itemId) {
      document.getElementById('editLabelsGallery').innerHTML = '<p class="muted">No item selected.</p>';
      return;
    }
    setElementHtml('editLabelsGallery', loaderHtml('Loading labels...'));

    google.script.run
      .withSuccessHandler(function(labels) {
        renderLabelCards('editLabelsGallery', labels || [], 'deleteLabelAndReloadEdit');
      })
      .withFailureHandler(function(err) {
        renderMessage('editLabelsResult', escapeHtml(err.message || 'Could not load labels.'), 'error');
      })
      .getLabelsForItem(itemId);
  }

  async function uploadEditItemLabels() {
    const itemId = document.getElementById('editItemId').value || '';
    if (!itemId) {
      renderMessage('editLabelsResult', 'No item selected.', 'error');
      return;
    }
    if (!pendingEditItemLabelFiles.length) {
      renderMessage('editLabelsResult', 'Choose one or more PDF files first.', 'error');
      return;
    }

    const filesWithNotes = getNotesFromRenderedInputs(pendingEditItemLabelFiles, 'editLabel');
    renderMessage('editLabelsResult', 'Uploading labels...', 'success');

    const result = await uploadLabelFilesForItem(itemId, filesWithNotes);

    renderMessage('editLabelsResult',
      `Finished uploading. Success: ${result.completed}. Failed: ${result.failed}.`,
      result.failed ? 'error' : 'success');

    showToast(`Labels uploaded: ${result.completed}`, result.failed ? 'error' : 'success');
    pendingEditItemLabelFiles = [];
    document.getElementById('editItemLabels').value = '';
    renderPendingLabelList(pendingEditItemLabelFiles, 'editItemPendingLabels', 'editLabel');
    loadEditItemLabels();
  }

  function deleteLabelAndReloadEdit(labelId) {
    google.script.run
      .withSuccessHandler(function() {
        renderMessage('editLabelsResult', 'Label deleted.', 'success');
        showToast('Label deleted', 'success');
        loadEditItemLabels();
      })
      .withFailureHandler(function(err) {
        renderMessage('editLabelsResult', escapeHtml(err.message || 'Could not delete label.'), 'error');
      })
      .deleteLabelById(labelId);
  }

  function loadAuditLog(itemId) {
    setElementHtml('auditLogTable', tableSkeletonHtml('Loading audit history...', 6, 4));
    google.script.run
      .withSuccessHandler(function(rows) {
        const el = document.getElementById('auditLogTable');
        if (!el) return;
        if (!rows || !rows.length) {
          el.innerHTML = '<p class="muted">No audit history yet.</p>';
          return;
        }

        let html = `
          <table>
            <thead>
              <tr>
                <th>When</th><th>Action</th><th>Field</th><th>Old</th><th>New</th><th>Note</th>
              </tr>
            </thead>
            <tbody>
        `;

        rows.forEach(row => {
          html += `
            <tr>
              <td>${escapeHtml(row.timestamp || '')}</td>
              <td>${escapeHtml(row.action || '')}</td>
              <td>${escapeHtml(row.field || '')}</td>
              <td>${escapeHtml(row.oldValue || '')}</td>
              <td>${escapeHtml(row.newValue || '')}</td>
              <td>${escapeHtml(row.note || '')}</td>
            </tr>
          `;
        });

        html += '</tbody></table>';
        el.innerHTML = html;
      })
      .withFailureHandler(function(err) {
        const el = document.getElementById('auditLogTable');
        if (el) el.innerHTML = `<div class="error">${escapeHtml(err.message || 'Could not load audit log.')}</div>`;
      })
      .getAuditLogForItem(itemId);
  }

  function loadPackagingProofCard(itemId) {
    setElementHtml('packagingProofCard', loaderHtml('Loading packaging proof...'));
    google.script.run
      .withSuccessHandler(function(result) {
        const el = document.getElementById('packagingProofCard');
        if (!el) return;
        if (!result || !result.exists) {
          el.innerHTML = `
            <div class="packaging-proof-placeholder">
              <div class="packaging-proof-icon">ðŸ“¦</div>
              <div class="packaging-proof-title">No packaging proof image yet</div>
              <div class="muted">Upload a picture and mark it as Packaging Proof.</div>
            </div>
          `;
          return;
        }

        el.innerHTML = `
          <div class="picture-card">
            <img src="${escapeHtml(result.thumbUrl || result.imageUrl)}" alt="Packaging proof" style="object-fit:contain;background:#fff;cursor:pointer;" onclick="openImageLightbox('${escapeHtml(result.fullImageUrl || result.thumbUrl || result.imageUrl)}')">
            <div class="picture-card-body">
              <div class="picture-meta"><strong>Packaging Proof</strong></div>
              <div class="picture-meta">${escapeHtml(result.note || 'No note')}</div>
              <div class="picture-meta muted">${escapeHtml(result.uploadedAt || '')}</div>
              <div class="button-row compact">
                <button type="button" class="secondary" onclick="openImageLightbox('${escapeHtml(result.fullImageUrl || result.thumbUrl || result.imageUrl)}')">Open</button>
              </div>
            </div>
          </div>
        `;
      })
      .withFailureHandler(function() {
        const el = document.getElementById('packagingProofCard');
        if (!el) return;
        el.innerHTML = `
          <div class="packaging-proof-placeholder">
            <div class="packaging-proof-title">Could not load packaging proof</div>
          </div>
        `;
      })
      .getPackagingProofPictureForItem(itemId);
  }

  function loadTasks() {
    setElementHtml('tasksGrouped', tableSkeletonHtml('Loading tasks...', 8, 5));
    google.script.run
      .withSuccessHandler(function(tasks) {
        const el = document.getElementById('tasksGrouped');
        if (!el) return;
        if (!tasks || !tasks.length) {
          el.innerHTML = '<p class="muted">No tasks right now.</p>';
          return;
        }

        const groups = {
          LIST_ITEM: { title: 'To List', tasks: [] },
          PACK_ITEM: { title: 'To Pack', tasks: [] },
          DISPATCH_ITEM: { title: 'To Dispatch', tasks: [] }
        };

        tasks.forEach(task => {
          if (!groups[task.taskType]) groups[task.taskType] = { title: task.taskType, tasks: [] };
          groups[task.taskType].tasks.push(task);
        });

        let html = '';
        Object.keys(groups).forEach(key => {
          const group = groups[key];
          if (!group.tasks.length) return;

          html += `
            <section class="panel panel-soft task-group-panel">
              <div class="panel-head">
                <h2>${escapeHtml(group.title)}</h2>
                <div class="muted">${group.tasks.length} task(s)</div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Priority</th><th>Item ID</th><th>Title</th><th>Task</th><th>Status</th><th>Age (days)</th><th>Open</th><th>Complete</th>
                  </tr>
                </thead>
                <tbody>
          `;

          group.tasks.forEach(task => {
            const priorityHtml = task.isUrgent ? '<span class="mini-flag urgent">Urgent</span>' : '<span class="mini-flag normal">Normal</span>';
            html += `
              <tr class="${task.isUrgent ? 'urgent-row' : 'normal-row'}">
                <td>${priorityHtml}</td>
                <td>${escapeHtml(task.itemId)}</td>
                <td>${escapeHtml(task.title)}</td>
                <td>${escapeHtml(task.taskLabel)}</td>
                <td><span class="pill ${statusClass(task.status)}">${escapeHtml(task.status)}</span></td>
                <td>${escapeHtml(task.ageLabel || task.ageDays || 0)}</td>
                <td><button type="button" class="secondary" onclick="openItemEditor('${escapeHtml(task.itemId)}')">Open Item</button></td>
                <td><button type="button" class="secondary" onclick="completeTaskAction('${escapeHtml(task.taskType)}','${escapeHtml(task.itemId)}')">Complete</button></td>
              </tr>
            `;
          });

          html += `</tbody></table></section>`;
        });

        el.innerHTML = html;
      })
      .withFailureHandler(function(err) {
        const el = document.getElementById('tasksGrouped');
        if (el) el.innerHTML = `<div class="error">${escapeHtml(err.message || 'Could not load tasks.')}</div>`;
      })
      .getTasks();
  }

  function completeTaskAction(taskType, itemId) {
    google.script.run
      .withSuccessHandler(function(res) {
        showToast(res.message || 'Task completed', 'success');
        refreshAll();
      })
      .withFailureHandler(function(err) {
        showToast(err.message || 'Could not complete task', 'error');
      })
      .completeTask(taskType, itemId);
  }

  function refreshAll() {
    preloadAutocompleteIndex();
    preloadInventoryItemCache();
    loadDashboard();
    loadActiveItemsTable();
    loadArchivedItemsTable();
    loadTasks();
    loadPicturesForSelectedItem();
    loadLabelsForSelectedItem();
  }

  function loadDashboard() {
    const range = document.getElementById('dashboardRange')?.value || 'last30';
    setElementHtml('summaryCards', dashboardSkeletonHtml());
    setElementHtml('statusChart', loaderHtml('Loading status breakdown...'));
    setElementHtml('sourceChart', loaderHtml('Loading source breakdown...'));
    google.script.run
      .withSuccessHandler(data => {
        const s = data.summary;
        document.getElementById('summaryCards').innerHTML = `
          <div class="summary-card"><div class="summary-label">Total Items</div><div class="summary-value">${s.totalItems}</div></div>
          <div class="summary-card"><div class="summary-label">Active Items</div><div class="summary-value">${s.activeListings}</div></div>
          <div class="summary-card"><div class="summary-label">Stock Cost</div><div class="summary-value">${money(s.stockCost)}</div></div>
          <div class="summary-card"><div class="summary-label">Realised Profit</div><div class="summary-value">${money(s.realisedProfit)}</div></div>
          <div class="summary-card"><div class="summary-label">Target Revenue</div><div class="summary-value">${money(s.targetRevenue)}</div></div>
          <div class="summary-card"><div class="summary-label">Sold / Completed</div><div class="summary-value">${s.soldItems}</div></div>
          <div class="summary-card"><div class="summary-label">14+ Days Unsold</div><div class="summary-value">${s.staleWarning}</div></div>
          <div class="summary-card"><div class="summary-label">30+ Days Unsold</div><div class="summary-value">${s.staleDanger}</div></div>
          <div class="summary-card"><div class="summary-label">Avg Days To Sell</div><div class="summary-value">${s.avgDaysToSell}</div></div>
          <div class="summary-card"><div class="summary-label">Avg Profit / Sale</div><div class="summary-value">${money(s.avgProfitPerSale)}</div></div>
          <div class="summary-card"><div class="summary-label">Unsold Stock Value</div><div class="summary-value">${money(s.unsoldStockValue)}</div></div>
          <div class="summary-card"><div class="summary-label">Dead Stock Value</div><div class="summary-value">${money(s.deadStockValue)}</div></div>
          <div class="summary-card"><div class="summary-label">Best Brand</div><div class="summary-value small">${escapeHtml(s.bestBrand || '-')}</div></div>
          <div class="summary-card"><div class="summary-label">Best Category</div><div class="summary-value small">${escapeHtml(s.bestCategory || '-')}</div></div>
        `;

        renderBarChart('statusChart', data.statusCounts);
        renderBarChart('sourceChart', data.sourceCounts);
      })
      .withFailureHandler(err => {
        document.getElementById('summaryCards').innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
      })
      .getDashboardData(range);
  }

  function renderBarChart(containerId, dataObj) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const entries = Object.entries(dataObj).filter(([, value]) => Number(value) > 0);

    if (!entries.length) {
      el.innerHTML = '<p class="muted">No data yet.</p>';
      return;
    }

    const max = Math.max(...entries.map(([, v]) => Number(v)));
    let html = '<div class="bar-chart">';
    entries.forEach(([label, value]) => {
      const width = max ? (Number(value) / max) * 100 : 0;
      html += `
        <div class="bar-row">
          <div class="bar-label">${escapeHtml(label)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
          <div>${value}</div>
        </div>
      `;
    });
    html += '</div>';
    el.innerHTML = html;
  }

  document.getElementById('itemForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());

    google.script.run
      .withSuccessHandler(async res => {
        if (pendingAddItemPictureFiles.length) {
          renderMessage('result', `Added ${escapeHtml(res.itemId)} â€¢ Uploading pictures...`, 'success');
          const filesWithNotes = getPictureNotesFromRenderedInputs(pendingAddItemPictureFiles, 'addItem');
          const uploadResult = await uploadFilesForItem(res.itemId, filesWithNotes);

          renderMessage(
            'result',
            `Added ${escapeHtml(res.itemId)} â€¢ Barcode ${escapeHtml(res.barcode || '')}. Pictures uploaded: ${uploadResult.completed}. Failed: ${uploadResult.failed}.`,
            uploadResult.failed ? 'error' : 'success'
          );

          if (uploadResult.completed) showToast('Item and pictures added', uploadResult.failed ? 'error' : 'success');
          pendingAddItemPictureFiles = [];
          document.getElementById('addItemPictures').value = '';
          renderPendingPictureList(pendingAddItemPictureFiles, 'addItemPendingPictures', 'addItem');
        } else {
          renderMessage('result', `Added ${escapeHtml(res.itemId)} â€¢ Barcode ${escapeHtml(res.barcode || '')}`, 'success');
          showToast('Item added', 'success');
        }

        e.target.reset();
        refreshAll();
      })
      .withFailureHandler(err => renderMessage('result', escapeHtml(err.message), 'error'))
      .addInventoryItem(data);
  });

  document.getElementById('editForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());

    google.script.run
      .withSuccessHandler(() => {
        const itemId = data.itemId;
        renderMessage('editResult', 'Item updated.', 'success');
        showToast('Item updated', 'success');

        google.script.run
          .withSuccessHandler(function(item) {
            if (item) updateCachedItem(item);
            refreshAll();
            loadAuditLog(itemId);
          })
          .withFailureHandler(function() {
            refreshAll();
            loadAuditLog(itemId);
          })
          .fetchItemForEdit(itemId);
      })
      .withFailureHandler(err => renderMessage('editResult', escapeHtml(err.message), 'error'))
      .updateExistingItem(data);
  });

  window.addEventListener('load', async function () {
    await startupReady;
    detectDeviceClass();
    showLoginScreen();

    attachLocalAutocomplete('statusSearch', 'statusSearchResults', { hiddenId: 'statusItemId' });
    attachLocalAutocomplete('saleSearch', 'saleSearchResults', { hiddenId: 'saleItemId' });
    attachLocalAutocomplete('relistSearch', 'relistSearchResults', { hiddenId: 'relistItemId' });

    attachLocalAutocomplete('activeTableSearch', 'activeTableSearchResults', {
      onSelect: ({ itemId }) => {
        document.getElementById('activeTableSearch').value = itemId;
        loadActiveItemsTable();
      },
      statusFilter: item => normalizeText(item.status) !== 'archived'
    });

    attachLocalAutocomplete('archivedTableSearch', 'archivedTableSearchResults', {
      onSelect: ({ itemId }) => {
        document.getElementById('archivedTableSearch').value = itemId;
        loadArchivedItemsTable();
      },
      statusFilter: item => normalizeText(item.status) === 'archived'
    });

    attachLocalAutocomplete('pictureItemSearch', 'pictureItemSearchResults', {
      hiddenId: 'pictureItemId',
      onSelect: ({ itemId }) => {
        document.getElementById('pictureItemId').value = itemId;
        loadPicturesForSelectedItem();
      }
    });

    attachLocalAutocomplete('labelItemSearch', 'labelItemSearchResults', {
      hiddenId: 'labelItemId',
      onSelect: ({ itemId }) => {
        document.getElementById('labelItemId').value = itemId;
        loadLabelsForSelectedItem();
      }
    });

    const activeSearch = document.getElementById('activeTableSearch');
    if (activeSearch) activeSearch.addEventListener('input', () => loadActiveItemsTable());

    const archivedSearch = document.getElementById('archivedTableSearch');
    if (archivedSearch) archivedSearch.addEventListener('input', () => loadArchivedItemsTable());

    const picturesInput = document.getElementById('pictureFiles');
    if (picturesInput) {
      picturesInput.addEventListener('change', function(e) {
        pendingPictureFiles = Array.from(e.target.files || []).map(file => ({ file }));
        renderPendingPictureList(pendingPictureFiles, 'pendingPictures', 'pictures');
      });
    }

    const addItemPicturesInput = document.getElementById('addItemPictures');
    if (addItemPicturesInput) {
      addItemPicturesInput.addEventListener('change', function(e) {
        pendingAddItemPictureFiles = Array.from(e.target.files || []).map(file => ({ file }));
        renderPendingPictureList(pendingAddItemPictureFiles, 'addItemPendingPictures', 'addItem');
      });
    }

    const editItemPicturesInput = document.getElementById('editItemPictures');
    if (editItemPicturesInput) {
      editItemPicturesInput.addEventListener('change', function(e) {
        pendingEditItemPictureFiles = Array.from(e.target.files || []).map(file => ({ file }));
        renderPendingPictureList(pendingEditItemPictureFiles, 'editItemPendingPictures', 'editItem');
      });
    }

    const labelFilesInput = document.getElementById('labelFiles');
    if (labelFilesInput) {
      labelFilesInput.addEventListener('change', function(e) {
        pendingLabelFiles = Array.from(e.target.files || []).map(file => ({ file }));
        renderPendingLabelList(pendingLabelFiles, 'pendingLabels', 'labels');
      });
    }

    const editItemLabelsInput = document.getElementById('editItemLabels');
    if (editItemLabelsInput) {
      editItemLabelsInput.addEventListener('change', function(e) {
        pendingEditItemLabelFiles = Array.from(e.target.files || []).map(file => ({ file }));
        renderPendingLabelList(pendingEditItemLabelFiles, 'editItemPendingLabels', 'editLabel');
      });
    }

    renderPendingPictureList(pendingPictureFiles, 'pendingPictures', 'pictures');
    renderPendingPictureList(pendingAddItemPictureFiles, 'addItemPendingPictures', 'addItem');
    renderPendingPictureList(pendingEditItemPictureFiles, 'editItemPendingPictures', 'editItem');
    renderPendingLabelList(pendingLabelFiles, 'pendingLabels', 'labels');
    renderPendingLabelList(pendingEditItemLabelFiles, 'editItemPendingLabels', 'editLabel');

    document.getElementById('loginPassword').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitLogin();
    });

    const modal = document.getElementById('editModal');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeEditModal();
      });
    }

    const imageLightbox = document.getElementById('imageLightbox');
    if (imageLightbox) {
      imageLightbox.addEventListener('click', function (e) {
        if (e.target === imageLightbox) closeImageLightbox();
      });
    }

    const pdfLightbox = document.getElementById('pdfLightbox');
    if (pdfLightbox) {
      pdfLightbox.addEventListener('click', function (e) {
        if (e.target === pdfLightbox) closePdfLightbox();
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        const modalEl = document.getElementById('editModal');
        const imageModal = document.getElementById('imageLightbox');
        const pdfModal = document.getElementById('pdfLightbox');

        if (modalEl && !modalEl.classList.contains('hidden')) closeEditModal();
        if (imageModal && !imageModal.classList.contains('hidden')) closeImageLightbox();
        if (pdfModal && !pdfModal.classList.contains('hidden')) closePdfLightbox();
      }
    });

    window.addEventListener('resize', detectDeviceClass);
    if (window.__appCacheWasCleared) showToast('Updated to the latest version', 'success');
    hideStartupLoader();
  });
