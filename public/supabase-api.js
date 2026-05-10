(function () {
  const STATUS_OPTIONS = [
    'Draft',
    'Ready to List',
    'Listed',
    'Reserved',
    'Sold',
    'Packed',
    'Dispatched',
    'Delivered',
    'Returned',
    'Archived'
  ];

  const REQUIRED_PHOTO_TYPES_FOR_LISTING = ['Front', 'Back'];

  const clientToDbMap = {
    itemId: 'item_id',
    barcode: 'barcode',
    title: 'title',
    category: 'category',
    brand: 'brand',
    size: 'size',
    condition: 'condition',
    color: 'color',
    purchasePrice: 'purchase_price',
    targetSalePrice: 'target_sale_price',
    minimumSalePrice: 'minimum_sale_price',
    desiredProfit: 'desired_profit',
    platformFee: 'platform_fee',
    otherCosts: 'other_costs',
    purchaseDate: 'purchase_date',
    listingDate: 'listing_date',
    saleDate: 'sale_date',
    actualSalePrice: 'actual_sale_price',
    status: 'status',
    daysListed: 'days_listed',
    profitAtTarget: 'profit_at_target',
    actualProfit: 'actual_profit',
    description: 'description',
    keywords: 'keywords',
    storageLocation: 'storage_location',
    source: 'source',
    vintedUrl: 'vinted_url',
    notes: 'notes',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  };

  const sheetHeaderMap = {
    'Item ID': 'itemId',
    Barcode: 'barcode',
    Title: 'title',
    Category: 'category',
    Brand: 'brand',
    Size: 'size',
    Condition: 'condition',
    Color: 'color',
    'Purchase Price': 'purchasePrice',
    'Target Sale Price': 'targetSalePrice',
    'Minimum Sale Price': 'minimumSalePrice',
    'Desired Profit': 'desiredProfit',
    'Platform Fee': 'platformFee',
    'Other Costs': 'otherCosts',
    'Purchase Date': 'purchaseDate',
    'Listing Date': 'listingDate',
    'Sale Date': 'saleDate',
    'Actual Sale Price': 'actualSalePrice',
    Status: 'status',
    'Days Listed': 'daysListed',
    'Profit at Target': 'profitAtTarget',
    'Actual Profit': 'actualProfit',
    Description: 'description',
    Keywords: 'keywords',
    'Storage Location': 'storageLocation',
    Source: 'source',
    'Vinted URL': 'vintedUrl',
    Notes: 'notes',
    'Created At': 'createdAt',
    'Updated At': 'updatedAt'
  };

  function getConfig() {
    const config = window.VINTED_CONFIG || {};
    config.SUPABASE_URL = String(config.SUPABASE_URL || '').trim().replace(/\/+$/, '');
    config.SUPABASE_ANON_KEY = String(config.SUPABASE_ANON_KEY || '').trim();
    config.SUPABASE_PUBLIC_URL = String(config.SUPABASE_PUBLIC_URL || `${config.SUPABASE_URL}/storage/v1/object/public`).trim();
    config.APP_VERSION = String(config.APP_VERSION || 'local-dev').trim();
    if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
      throw new Error('Missing Supabase config. Copy public/config.example.js to public/config.js and fill in the anon key.');
    }
    return config;
  }

  const config = getConfig();
  const supabase = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

  function toNumber(value) {
    return Number(value) || 0;
  }

  function toBool(value) {
    return value === true || String(value || '').toLowerCase() === 'true';
  }

  function normalize(value) {
    return String(value || '').toLowerCase().trim();
  }

  function normalizeStatus(value) {
    return normalize(value).replace(/\s+/g, ' ');
  }

  function isoDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
  }

  function formatDate(value) {
    return isoDate(value) || '';
  }

  function daysBetween(start, end = new Date()) {
    const date = start ? new Date(start) : null;
    if (!date || Number.isNaN(date.valueOf())) return '';
    return Math.max(0, Math.floor((end - date) / 86400000));
  }

  function round2(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function applyComputed(row) {
    const purchasePrice = toNumber(row.purchase_price);
    const targetSalePrice = toNumber(row.target_sale_price);
    const desiredProfit = toNumber(row.desired_profit);
    const platformFee = toNumber(row.platform_fee);
    const otherCosts = toNumber(row.other_costs);
    const actualSalePrice = toNumber(row.actual_sale_price);

    return {
      ...row,
      minimum_sale_price: round2(purchasePrice + platformFee + otherCosts + desiredProfit),
      profit_at_target: round2(targetSalePrice - purchasePrice - platformFee - otherCosts),
      actual_profit: actualSalePrice ? round2(actualSalePrice - purchasePrice - platformFee - otherCosts) : null,
      days_listed: row.listing_date ? daysBetween(row.listing_date) : null
    };
  }

  function dbToClient(row = {}) {
    return Object.fromEntries(
      Object.entries(clientToDbMap).map(([clientKey, dbKey]) => [clientKey, row[dbKey] ?? ''])
    );
  }

  function dbToSheet(row = {}) {
    const client = dbToClient(applyComputed(row));
    return Object.fromEntries(
      Object.entries(sheetHeaderMap).map(([header, clientKey]) => [header, client[clientKey] ?? ''])
    );
  }

  function formToDb(formData = {}) {
    return {
      title: formData.title || '',
      category: formData.category || '',
      brand: formData.brand || '',
      size: formData.size || '',
      condition: formData.condition || '',
      color: formData.color || '',
      purchase_price: toNumber(formData.purchasePrice),
      target_sale_price: toNumber(formData.targetSalePrice),
      desired_profit: toNumber(formData.desiredProfit),
      platform_fee: toNumber(formData.platformFee),
      other_costs: toNumber(formData.otherCosts),
      purchase_date: isoDate(formData.purchaseDate),
      listing_date: isoDate(formData.listingDate),
      sale_date: isoDate(formData.saleDate),
      actual_sale_price: formData.actualSalePrice === '' ? null : toNumber(formData.actualSalePrice),
      status: formData.status || 'Draft',
      description: formData.description || buildDescription(formData),
      keywords: formData.keywords || '',
      storage_location: formData.storageLocation || '',
      source: formData.source || '',
      vinted_url: formData.vintedUrl || '',
      notes: formData.notes || '',
      updated_at: new Date().toISOString()
    };
  }

  function buildDescription(data) {
    return [
      [data.brand, data.title].filter(Boolean).join(' '),
      data.size ? `Size: ${data.size}` : '',
      data.condition ? `Condition: ${data.condition}` : '',
      data.color ? `Colour: ${data.color}` : '',
      data.notes || ''
    ].filter(Boolean).join('\n');
  }

  function matchesSearch(item, q) {
    return [item.itemId, item.barcode, item.title, item.brand, item.category, item.status, item.storageLocation]
      .some(value => normalize(value).includes(q));
  }

  function tableRow(row) {
    const item = dbToClient(applyComputed(row));
    return {
      itemId: item.itemId,
      barcode: item.barcode,
      title: item.title,
      targetPrice: toNumber(item.targetSalePrice),
      listingDate: formatDate(item.listingDate),
      status: item.status || ''
    };
  }

  function publicObjectUrl(bucket, path) {
    const base = config.SUPABASE_PUBLIC_URL || `${config.SUPABASE_URL}/storage/v1/object/public`;
    return `${base}/${bucket}/${encodeURI(path).replace(/#/g, '%23')}`;
  }

  async function query(promise) {
    const { data, error } = await promise;
    if (error) throw error;
    return data;
  }

  async function getSettings() {
    const rows = await query(supabase.from('settings').select('key,value'));
    return Object.fromEntries((rows || []).map(row => [row.key, row.value]));
  }

  async function selectInventory() {
    const rows = await query(supabase.from('inventory').select('*').order('title', { ascending: true }));
    return (rows || []).map(applyComputed);
  }

  async function getInventoryById(itemId) {
    const row = await query(supabase.from('inventory').select('*').eq('item_id', itemId).maybeSingle());
    if (!row) throw new Error('Item not found.');
    return applyComputed(row);
  }

  async function saveInventory(itemId, patch) {
    const row = await query(
      supabase.from('inventory')
        .update(applyComputed({ ...patch, updated_at: new Date().toISOString() }))
        .eq('item_id', itemId)
        .select()
        .single()
    );
    return applyComputed(row);
  }

  async function logAudit(itemId, action, field = '', oldValue = '', newValue = '', note = '') {
    await query(supabase.from('audit_log').insert({
      item_id: itemId || '',
      action,
      field,
      old_value: oldValue == null ? '' : String(oldValue),
      new_value: newValue == null ? '' : String(newValue),
      note
    }));
  }

  async function logStatusChange(itemId, oldStatus, newStatus, note = '') {
    await query(supabase.from('status_log').insert({ item_id: itemId, old_status: oldStatus || '', new_status: newStatus || '', note }));
    await logAudit(itemId, 'Status Change', 'Status', oldStatus, newStatus, note);
  }

  async function validateLogin(identifier, password) {
    const input = normalize(identifier);
    const row = await query(supabase.from('logins').select('*').or(`email.eq.${input},username.eq.${input}`).maybeSingle());
    if (!row) return { success: false, message: 'Invalid login details.' };

    const storedHash = String(row.password_hash || '');
    const storedPassword = String(row.password || '');
    const bcrypt = window.dcodeIO && window.dcodeIO.bcrypt;
    const ok = storedHash && bcrypt
      ? bcrypt.compareSync(String(password || ''), storedHash)
      : String(password || '') === storedPassword;

    if (!ok) return { success: false, message: 'Invalid login details.' };
    return { success: true, user: { email: row.email || '', username: row.username || '' } };
  }

  async function addInventoryItem(formData) {
    const settings = await getSettings();
    const now = new Date().toISOString();
    const row = applyComputed({
      ...formToDb({
        desiredProfit: settings.DEFAULT_DESIRED_PROFIT || 5,
        platformFee: settings.DEFAULT_PLATFORM_FEE || 0,
        otherCosts: settings.DEFAULT_OTHER_COSTS || 0,
        ...formData
      }),
      item_id: `ITEM-${Date.now()}`,
      barcode: String(Math.floor(100000000000 + Math.random() * 900000000000)),
      created_at: now,
      updated_at: now
    });
    const data = await query(supabase.from('inventory').insert(row).select().single());
    await logAudit(data.item_id, 'Item Created', '', '', data.title, '');
    return { success: true, itemId: data.item_id, barcode: data.barcode };
  }

  async function updateExistingItem(formData) {
    const current = await getInventoryById(formData.itemId);
    const updated = await saveInventory(formData.itemId, formToDb(formData));
    if (current.status !== updated.status) await logStatusChange(updated.item_id, current.status, updated.status, 'Edited item');
    await logAudit(updated.item_id, 'Item Updated', '', '', updated.title, '');
    return { success: true, itemId: updated.item_id };
  }

  async function duplicateInventoryItem(itemId) {
    const item = dbToClient(await getInventoryById(itemId));
    return addInventoryItem({ ...item, title: `${item.title} Copy`, status: 'Draft' });
  }

  async function fetchItemForEdit(itemId) {
    return dbToSheet(await getInventoryById(itemId));
  }

  async function fetchItemByBarcode(barcode) {
    const row = await query(supabase.from('inventory').select('*').eq('barcode', String(barcode || '').trim()).maybeSingle());
    if (!row) throw new Error(`No item found for barcode: ${barcode}`);
    return dbToSheet(row);
  }

  async function getAllInventoryItemsForClient() {
    return (await selectInventory()).map(dbToSheet);
  }

  async function getAutocompleteIndex() {
    return (await selectInventory()).map(row => ({
      itemId: row.item_id || '',
      barcode: row.barcode || '',
      title: row.title || '',
      brand: row.brand || '',
      status: row.status || '',
      listingDate: formatDate(row.listing_date),
      targetPrice: toNumber(row.target_sale_price)
    }));
  }

  async function getActiveItemsTable(queryText) {
    const q = normalize(queryText);
    const items = (await selectInventory())
      .filter(row => normalizeStatus(row.status) !== 'archived')
      .filter(row => !q || matchesSearch(dbToClient(row), q))
      .map(tableRow);
    return { rowCount: items.length, items };
  }

  async function getArchivedItemsTable(queryText) {
    const q = normalize(queryText);
    const items = (await selectInventory())
      .filter(row => normalizeStatus(row.status) === 'archived')
      .filter(row => !q || matchesSearch(dbToClient(row), q))
      .map(tableRow);
    return { rowCount: items.length, items };
  }

  async function bulkUpdateStatuses(itemIds, newStatus) {
    for (const itemId of itemIds || []) await updateItemStatus(itemId, newStatus, 'Bulk update');
    return { success: true, count: (itemIds || []).length };
  }

  async function updateItemStatus(itemId, newStatus, note = '') {
    if (!STATUS_OPTIONS.includes(newStatus)) throw new Error('Unknown status.');
    const current = await getInventoryById(itemId);
    const patch = { status: newStatus };
    if (newStatus === 'Listed' && !current.listing_date) patch.listing_date = isoDate(new Date());
    if (newStatus === 'Sold' && !current.sale_date) patch.sale_date = isoDate(new Date());
    await saveInventory(itemId, patch);
    await logStatusChange(itemId, current.status, newStatus, note);
    return { success: true };
  }

  async function recordSale(itemId, actualSalePrice) {
    const current = await getInventoryById(itemId);
    const updated = await saveInventory(itemId, { actual_sale_price: toNumber(actualSalePrice), sale_date: isoDate(new Date()), status: 'Sold' });
    await logStatusChange(itemId, current.status, 'Sold', 'Sale recorded');
    return { success: true, actualProfit: updated.actual_profit };
  }

  async function relistItem(itemId) {
    const current = await getInventoryById(itemId);
    await saveInventory(itemId, { status: 'Listed', sale_date: null, actual_sale_price: null, listing_date: isoDate(new Date()) });
    await logStatusChange(itemId, current.status, 'Listed', 'Relisted');
    return { success: true };
  }

  async function uploadBase64(bucket, payload, fallbackName) {
    const itemId = String(payload.itemId || '').trim();
    if (!itemId) throw new Error('Please select an item first.');
    await getInventoryById(itemId);
    const dataUrl = String(payload.dataUrl || '');
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    const mimeType = payload.mimeType || (match && match[1]) || 'application/octet-stream';
    const body = (match && match[2]) || dataUrl;
    const bytes = Uint8Array.from(atob(body), char => char.charCodeAt(0));
    const fileName = `${Date.now()}-${String(payload.fileName || fallbackName).replace(/[^\w.\-]+/g, '-')}`;
    const path = `${itemId}/${fileName}`;
    await query(supabase.storage.from(bucket).upload(path, new Blob([bytes], { type: mimeType }), { contentType: mimeType, upsert: false }));
    return { path, url: publicObjectUrl(bucket, path) };
  }

  async function uploadItemPicture(payload) {
    const uploaded = await uploadBase64('pictures', payload, 'picture.jpg');
    if (toBool(payload.isCover)) await query(supabase.from('pictures').update({ is_cover: false }).eq('item_id', payload.itemId));
    const row = {
      picture_id: `PIC-${Date.now()}`,
      item_id: payload.itemId,
      image_url: uploaded.url,
      storage_path: uploaded.path,
      note: payload.note || '',
      is_cover: toBool(payload.isCover),
      is_packaging_proof: toBool(payload.isPackagingProof),
      photo_type: payload.photoType || 'General'
    };
    const data = await query(supabase.from('pictures').insert(row).select().single());
    await logAudit(payload.itemId, 'Picture Uploaded', 'Picture ID', '', data.picture_id, row.note);
    return { success: true, pictureId: data.picture_id, imageUrl: data.image_url };
  }

  function buildPhotoChecklist(pictures) {
    const types = new Set((pictures || []).map(pic => pic.photoType));
    const missing = REQUIRED_PHOTO_TYPES_FOR_LISTING.filter(type => !types.has(type));
    return {
      required: REQUIRED_PHOTO_TYPES_FOR_LISTING,
      missing,
      hasCover: (pictures || []).some(pic => pic.isCover),
      hasPackagingProof: (pictures || []).some(pic => pic.isPackagingProof)
    };
  }

  async function getPicturesForItem(itemId) {
    const rows = await query(supabase.from('pictures').select('*').eq('item_id', itemId).order('uploaded_at', { ascending: false }));
    const pictures = (rows || []).map(row => ({
      pictureId: row.picture_id,
      itemId: row.item_id,
      imageUrl: row.image_url,
      thumbUrl: row.image_url,
      fullImageUrl: row.image_url,
      driveFileId: row.storage_path,
      note: row.note || '',
      isCover: !!row.is_cover,
      isPackagingProof: !!row.is_packaging_proof,
      photoType: row.photo_type || 'General',
      uploadedAt: row.uploaded_at || ''
    }));
    return { pictures, checklist: buildPhotoChecklist(pictures) };
  }

  async function updatePictureMeta(pictureId, payload) {
    const current = await query(supabase.from('pictures').select('*').eq('picture_id', pictureId).maybeSingle());
    if (!current) throw new Error('Picture not found.');
    if (toBool(payload.isCover)) await query(supabase.from('pictures').update({ is_cover: false }).eq('item_id', current.item_id));
    await query(supabase.from('pictures').update({
      note: payload.note || current.note || '',
      is_cover: toBool(payload.isCover),
      is_packaging_proof: toBool(payload.isPackagingProof),
      photo_type: payload.photoType || current.photo_type || 'General'
    }).eq('picture_id', pictureId));
    return { success: true };
  }

  async function deletePictureById(pictureId) {
    const row = await query(supabase.from('pictures').select('*').eq('picture_id', pictureId).maybeSingle());
    if (!row) throw new Error('Picture not found.');
    if (row.storage_path) await query(supabase.storage.from('pictures').remove([row.storage_path]));
    await query(supabase.from('pictures').delete().eq('picture_id', pictureId));
    return { success: true };
  }

  async function uploadItemLabel(payload) {
    const uploaded = await uploadBase64('labels', payload, 'label.pdf');
    const row = { label_id: `LAB-${Date.now()}`, item_id: payload.itemId, file_url: uploaded.url, storage_path: uploaded.path, note: payload.note || '' };
    const data = await query(supabase.from('labels').insert(row).select().single());
    await logAudit(payload.itemId, 'Label Uploaded', 'Label ID', '', data.label_id, row.note);
    return { success: true, labelId: data.label_id, fileUrl: data.file_url };
  }

  async function getLabelsForItem(itemId) {
    const rows = await query(supabase.from('labels').select('*').eq('item_id', itemId).order('uploaded_at', { ascending: false }));
    return (rows || []).map(row => ({ labelId: row.label_id, itemId: row.item_id, fileUrl: row.file_url, driveFileId: row.storage_path, note: row.note || '', uploadedAt: row.uploaded_at || '' }));
  }

  async function deleteLabelById(labelId) {
    const row = await query(supabase.from('labels').select('*').eq('label_id', labelId).maybeSingle());
    if (!row) throw new Error('Label not found.');
    if (row.storage_path) await query(supabase.storage.from('labels').remove([row.storage_path]));
    await query(supabase.from('labels').delete().eq('label_id', labelId));
    return { success: true };
  }

  async function getAuditLogForItem(itemId) {
    const rows = await query(supabase.from('audit_log').select('*').eq('item_id', itemId).order('timestamp', { ascending: false }));
    return (rows || []).map(row => ({ timestamp: row.timestamp, itemId: row.item_id, action: row.action, field: row.field, oldValue: row.old_value, newValue: row.new_value, note: row.note }));
  }

  async function getPackagingProofPictureForItem(itemId) {
    const payload = await getPicturesForItem(itemId);
    const picture = payload.pictures.find(pic => pic.isPackagingProof);
    if (!picture) return { exists: false };
    return { exists: true, ...picture };
  }

  async function getTasks() {
    const settings = await getSettings();
    const warningDays = toNumber(settings.STALE_WARNING_DAYS || 14);
    const dangerDays = toNumber(settings.STALE_DANGER_DAYS || 30);
    const pictures = await query(supabase.from('pictures').select('item_id,photo_type,is_packaging_proof'));
    const byItem = new Map();
    for (const picture of pictures || []) {
      const list = byItem.get(picture.item_id) || [];
      list.push(picture);
      byItem.set(picture.item_id, list);
    }

    const tasks = [];
    for (const row of await selectInventory()) {
      const itemPictures = byItem.get(row.item_id) || [];
      if (['Ready to List', 'Listed'].includes(row.status)) {
        const types = new Set(itemPictures.map(pic => pic.photo_type));
        for (const type of REQUIRED_PHOTO_TYPES_FOR_LISTING) {
          if (!types.has(type)) tasks.push({ itemId: row.item_id, title: row.title, taskType: 'photo', taskLabel: `Add ${type} photo`, status: row.status, ageDays: 0, urgent: true });
        }
      }
      if (row.status === 'Sold' && !itemPictures.some(pic => pic.is_packaging_proof)) {
        tasks.push({ itemId: row.item_id, title: row.title, taskType: 'packagingProof', taskLabel: 'Add packaging proof', status: row.status, ageDays: daysBetween(row.sale_date), urgent: true });
      }
      if (row.status === 'Listed') {
        const age = daysBetween(row.listing_date);
        if (age >= warningDays) tasks.push({ itemId: row.item_id, title: row.title, taskType: 'staleListing', taskLabel: age >= dangerDays ? 'Review stale listing' : 'Check listing age', status: row.status, ageDays: age, urgent: age >= dangerDays });
      }
    }
    return tasks;
  }

  async function completeTask() {
    return { success: true };
  }

  async function getDashboardData(rangeKey = 'last30') {
    const items = await selectInventory();
    const sold = items.filter(row => normalizeStatus(row.status) === 'sold');
    const summary = {
      totalItems: items.length,
      activeListings: items.filter(row => normalizeStatus(row.status) === 'listed').length,
      soldItems: sold.length,
      stockCost: round2(items.reduce((sum, row) => sum + toNumber(row.purchase_price), 0)),
      targetRevenue: round2(items.reduce((sum, row) => sum + toNumber(row.target_sale_price), 0)),
      realisedProfit: round2(sold.reduce((sum, row) => sum + toNumber(row.actual_profit), 0)),
      staleWarning: items.filter(row => row.status === 'Listed' && daysBetween(row.listing_date) >= 14).length,
      staleDanger: items.filter(row => row.status === 'Listed' && daysBetween(row.listing_date) >= 30).length,
      avgDaysToSell: sold.length ? round2(sold.reduce((sum, row) => sum + daysBetween(row.listing_date, new Date(row.sale_date || Date.now())), 0) / sold.length) : 0,
      avgProfitPerSale: sold.length ? round2(sold.reduce((sum, row) => sum + toNumber(row.actual_profit), 0) / sold.length) : 0,
      unsoldStockValue: round2(items.filter(row => normalizeStatus(row.status) !== 'sold').reduce((sum, row) => sum + toNumber(row.purchase_price), 0)),
      deadStockValue: round2(items.filter(row => row.status === 'Archived').reduce((sum, row) => sum + toNumber(row.purchase_price), 0))
    };
    const statusCounts = Object.fromEntries(STATUS_OPTIONS.map(status => [status, 0]));
    const sourceCounts = {};
    for (const row of items) {
      statusCounts[row.status || 'Draft'] = (statusCounts[row.status || 'Draft'] || 0) + 1;
      sourceCounts[row.source || 'Unknown'] = (sourceCounts[row.source || 'Unknown'] || 0) + 1;
    }
    return { rangeKey, summary, statusCounts, sourceCounts };
  }

  async function generateTemplateDescriptionForItem(itemId) {
    const item = dbToClient(await getInventoryById(itemId));
    const description = buildDescription(item);
    await saveInventory(itemId, { description });
    return description;
  }

  async function unsupported(name) {
    throw new Error(`${name} needs a backend function and is not available on GitHub Pages yet.`);
  }

  window.vintedApi = {
    validateLogin,
    addInventoryItem,
    duplicateInventoryItem,
    updateExistingItem,
    fetchItemForEdit,
    fetchItemByBarcode,
    getItemById: fetchItemForEdit,
    getAllInventoryItemsForClient,
    getAutocompleteIndex,
    getActiveItemsTable,
    getArchivedItemsTable,
    uploadItemPicture,
    getPicturesForItem,
    updatePictureMeta,
    deletePictureById,
    uploadItemLabel,
    getLabelsForItem,
    deleteLabelById,
    bulkUpdateStatuses,
    updateItemStatus,
    recordSale,
    relistItem,
    getTasks,
    completeTask,
    getDashboardData,
    generateTemplateDescriptionForItem,
    getAuditLogForItem,
    getPackagingProofPictureForItem,
    sendUrgentTaskEmail: () => unsupported('Email alerts'),
    generatePackingListPdf: () => unsupported('Packing-list PDF generation'),
    generateAIDescriptionForItem: () => unsupported('AI description generation')
  };
})();
