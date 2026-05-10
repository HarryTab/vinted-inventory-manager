import 'dotenv/config';
import express from 'express';
import bcrypt from 'bcryptjs';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '25mb' }));
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

const supabase = createClient(
  process.env.SUPABASE_URL || 'http://localhost',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'missing-service-key',
  { auth: { persistSession: false } }
);

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

const PHOTO_TYPES = ['General', 'Front', 'Back', 'Label', 'Flaw', 'Packaging Proof'];
const REQUIRED_PHOTO_TYPES_FOR_LISTING = ['Front', 'Back'];

const inventoryMap = {
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

function toNumber(value) {
  return Number(value) || 0;
}

function toBool(value) {
  return value === true || String(value || '').toLowerCase() === 'true';
}

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
}

function formatDate(value) {
  return isoDate(value) || '';
}

function normalize(value) {
  return String(value || '').toLowerCase().trim();
}

function normalizeStatus(value) {
  return normalize(value).replace(/\s+/g, ' ');
}

function daysBetween(start, end = new Date()) {
  const date = start ? new Date(start) : null;
  if (!date || Number.isNaN(date.valueOf())) return '';
  return Math.max(0, Math.floor((end - date) / 86400000));
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function publicObjectUrl(bucket, path) {
  const base = process.env.SUPABASE_PUBLIC_URL || `${process.env.SUPABASE_URL}/storage/v1/object/public`;
  return `${base}/${bucket}/${encodeURI(path).replace(/#/g, '%23')}`;
}

function dbToClient(row = {}) {
  return Object.fromEntries(
    Object.entries(inventoryMap).map(([clientKey, dbKey]) => [clientKey, row[dbKey] ?? ''])
  );
}

function dbToSheet(row = {}) {
  const client = dbToClient(row);
  return Object.fromEntries(
    Object.entries(sheetHeaderMap).map(([header, clientKey]) => [header, client[clientKey] ?? ''])
  );
}

function clientToDb(data = {}) {
  const db = {};
  for (const [clientKey, dbKey] of Object.entries(inventoryMap)) {
    if (Object.prototype.hasOwnProperty.call(data, clientKey)) db[dbKey] = data[clientKey] || null;
  }
  return db;
}

function applyComputed(item) {
  const purchasePrice = toNumber(item.purchase_price);
  const targetSalePrice = toNumber(item.target_sale_price);
  const desiredProfit = toNumber(item.desired_profit);
  const platformFee = toNumber(item.platform_fee);
  const otherCosts = toNumber(item.other_costs);
  const actualSalePrice = toNumber(item.actual_sale_price);

  item.minimum_sale_price = round2(purchasePrice + platformFee + otherCosts + desiredProfit);
  item.profit_at_target = round2(targetSalePrice - purchasePrice - platformFee - otherCosts);
  item.actual_profit = actualSalePrice ? round2(actualSalePrice - purchasePrice - platformFee - otherCosts) : null;
  item.days_listed = item.listing_date ? daysBetween(item.listing_date) : null;
  return item;
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

async function selectInventory() {
  const { data, error } = await supabase.from('inventory').select('*').order('title', { ascending: true });
  if (error) throw error;
  return (data || []).map(applyComputed);
}

async function getSettings() {
  const { data, error } = await supabase.from('settings').select('key,value');
  if (error) throw error;
  return Object.fromEntries((data || []).map(row => [row.key, row.value]));
}

async function getInventoryById(itemId) {
  const { data, error } = await supabase.from('inventory').select('*').eq('item_id', itemId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Item not found.');
  return applyComputed(data);
}

async function saveInventory(itemId, patch) {
  const row = applyComputed({ ...patch, updated_at: new Date().toISOString() });
  const { data, error } = await supabase.from('inventory').update(row).eq('item_id', itemId).select().single();
  if (error) throw error;
  return applyComputed(data);
}

async function logAudit(itemId, action, field = '', oldValue = '', newValue = '', note = '') {
  await supabase.from('audit_log').insert({
    item_id: itemId || '',
    action,
    field,
    old_value: oldValue == null ? '' : String(oldValue),
    new_value: newValue == null ? '' : String(newValue),
    note
  });
}

async function logStatusChange(itemId, oldStatus, newStatus, note = '') {
  await supabase.from('status_log').insert({ item_id: itemId, old_status: oldStatus || '', new_status: newStatus || '', note });
  await logAudit(itemId, 'Status Change', 'Status', oldStatus, newStatus, note);
}

function matchesSearch(item, q) {
  return [item.item_id, item.barcode, item.title, item.brand, item.category, item.status, item.storage_location]
    .some(value => normalize(value).includes(q));
}

function tableRow(row) {
  const item = dbToClient(row);
  return {
    itemId: item.itemId,
    barcode: item.barcode,
    title: item.title,
    targetPrice: toNumber(item.targetSalePrice),
    listingDate: formatDate(item.listingDate),
    status: item.status || ''
  };
}

async function validateLogin(identifier, password) {
  const input = normalize(identifier);
  const { data, error } = await supabase.from('logins').select('*').or(`email.eq.${input},username.eq.${input}`).maybeSingle();
  if (error) throw error;
  if (!data) return { success: false, message: 'Invalid login details.' };

  const stored = String(data.password_hash || data.password || '');
  const ok = stored.startsWith('$2') ? await bcrypt.compare(String(password || ''), stored) : String(password || '') === stored;
  if (!ok) return { success: false, message: 'Invalid login details.' };
  return { success: true, user: { email: data.email || '', username: data.username || '' } };
}

async function addInventoryItem(formData) {
  const settings = await getSettings();
  const now = new Date().toISOString();
  const purchasePrice = toNumber(formData.purchasePrice);
  const targetSalePrice = toNumber(formData.targetSalePrice);
  const desiredProfit = toNumber(formData.desiredProfit || settings.DEFAULT_DESIRED_PROFIT || 5);
  const platformFee = toNumber(formData.platformFee || settings.DEFAULT_PLATFORM_FEE || 0);
  const otherCosts = toNumber(formData.otherCosts || settings.DEFAULT_OTHER_COSTS || 0);
  const row = applyComputed({
    item_id: `ITEM-${Date.now()}`,
    barcode: String(Math.floor(100000000000 + Math.random() * 900000000000)),
    title: formData.title || '',
    category: formData.category || '',
    brand: formData.brand || '',
    size: formData.size || '',
    condition: formData.condition || '',
    color: formData.color || '',
    purchase_price: purchasePrice,
    target_sale_price: targetSalePrice,
    desired_profit: desiredProfit,
    platform_fee: platformFee,
    other_costs: otherCosts,
    purchase_date: isoDate(formData.purchaseDate),
    listing_date: isoDate(formData.listingDate),
    status: formData.status || 'Draft',
    description: formData.description || buildDescription(formData),
    keywords: formData.keywords || '',
    storage_location: formData.storageLocation || '',
    source: formData.source || '',
    vinted_url: formData.vintedUrl || '',
    notes: formData.notes || '',
    created_at: now,
    updated_at: now
  });
  const { data, error } = await supabase.from('inventory').insert(row).select().single();
  if (error) throw error;
  await logAudit(data.item_id, 'Item Created', '', '', data.title, '');
  return { success: true, itemId: data.item_id, barcode: data.barcode };
}

async function updateExistingItem(formData) {
  const current = await getInventoryById(formData.itemId);
  const patch = clientToDb({
    title: formData.title,
    category: formData.category,
    brand: formData.brand,
    size: formData.size,
    condition: formData.condition,
    color: formData.color,
    purchasePrice: toNumber(formData.purchasePrice),
    targetSalePrice: toNumber(formData.targetSalePrice),
    desiredProfit: toNumber(formData.desiredProfit),
    platformFee: toNumber(formData.platformFee),
    otherCosts: toNumber(formData.otherCosts),
    purchaseDate: isoDate(formData.purchaseDate),
    listingDate: isoDate(formData.listingDate),
    saleDate: isoDate(formData.saleDate),
    actualSalePrice: formData.actualSalePrice === '' ? null : toNumber(formData.actualSalePrice),
    status: formData.status || 'Draft',
    description: formData.description || buildDescription(formData),
    keywords: formData.keywords,
    storageLocation: formData.storageLocation,
    source: formData.source,
    vintedUrl: formData.vintedUrl,
    notes: formData.notes
  });
  const updated = await saveInventory(formData.itemId, patch);
  if (current.status !== updated.status) await logStatusChange(updated.item_id, current.status, updated.status, 'Edited item');
  await logAudit(updated.item_id, 'Item Updated', '', '', updated.title, '');
  return { success: true, itemId: updated.item_id };
}

async function duplicateInventoryItem(itemId) {
  const item = dbToClient(await getInventoryById(itemId));
  return addInventoryItem({ ...item, itemId: undefined, title: `${item.title} Copy`, barcode: undefined, status: 'Draft' });
}

async function fetchItemForEdit(itemId) {
  return dbToSheet(await getInventoryById(itemId));
}

async function fetchItemByBarcode(barcode) {
  const { data, error } = await supabase.from('inventory').select('*').eq('barcode', String(barcode || '').trim()).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No item found for barcode: ${barcode}`);
  return dbToSheet(applyComputed(data));
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

async function searchInventory(query) {
  const q = normalize(query);
  return (await selectInventory()).filter(row => !q || matchesSearch(dbToClient(row), q)).slice(0, 100).map(dbToSheet);
}

async function getActiveItemsTable(query) {
  const q = normalize(query);
  const items = (await selectInventory())
    .filter(row => normalizeStatus(row.status) !== 'archived')
    .filter(row => !q || matchesSearch(dbToClient(row), q))
    .map(tableRow);
  return { rowCount: items.length, items };
}

async function getArchivedItemsTable(query) {
  const q = normalize(query);
  const items = (await selectInventory())
    .filter(row => normalizeStatus(row.status) === 'archived')
    .filter(row => !q || matchesSearch(dbToClient(row), q))
    .map(tableRow);
  return { rowCount: items.length, items };
}

async function saveScannerUpdate(payload) {
  const item = await fetchItemByBarcode(payload.barcode);
  const itemId = item['Item ID'];
  const updated = await updateExistingItem({
    itemId,
    title: item.Title,
    category: item.Category,
    brand: item.Brand,
    size: item.Size,
    condition: item.Condition,
    color: item.Color,
    purchasePrice: item['Purchase Price'],
    targetSalePrice: item['Target Sale Price'],
    desiredProfit: item['Desired Profit'],
    platformFee: item['Platform Fee'],
    otherCosts: item['Other Costs'],
    purchaseDate: item['Purchase Date'],
    listingDate: item['Listing Date'],
    saleDate: item['Sale Date'],
    actualSalePrice: item['Actual Sale Price'],
    status: payload.status || item.Status,
    description: item.Description,
    keywords: item.Keywords,
    storageLocation: payload.storageLocation || item['Storage Location'],
    source: item.Source,
    vintedUrl: item['Vinted URL'],
    notes: payload.notes ?? item.Notes
  });
  return { ...updated, barcode: item.Barcode, status: payload.status || item.Status, storageLocation: payload.storageLocation || item['Storage Location'], notes: payload.notes ?? item.Notes };
}

async function uploadBase64(bucket, folder, payload, fallbackName) {
  const itemId = String(payload.itemId || '').trim();
  if (!itemId) throw new Error('Please select an item first.');
  await getInventoryById(itemId);
  const dataUrl = String(payload.dataUrl || '');
  const [, meta = '', body = dataUrl] = dataUrl.match(/^data:([^;]+);base64,(.*)$/) || [];
  const mimeType = payload.mimeType || meta || 'application/octet-stream';
  const fileName = `${Date.now()}-${String(payload.fileName || fallbackName).replace(/[^\w.\-]+/g, '-')}`;
  const path = `${itemId}/${fileName}`;
  const buffer = Buffer.from(body, 'base64');
  const { error } = await supabase.storage.from(bucket).upload(path, buffer, { contentType: mimeType, upsert: false });
  if (error) throw error;
  return { path, url: publicObjectUrl(bucket, path) };
}

async function uploadItemPicture(payload) {
  const uploaded = await uploadBase64('pictures', payload.itemId, payload, 'picture.jpg');
  if (toBool(payload.isCover)) {
    await supabase.from('pictures').update({ is_cover: false }).eq('item_id', payload.itemId);
  }
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
  const { data, error } = await supabase.from('pictures').insert(row).select().single();
  if (error) throw error;
  await logAudit(payload.itemId, 'Picture Uploaded', 'Picture ID', '', data.picture_id, row.note);
  return { success: true, pictureId: data.picture_id, imageUrl: data.image_url };
}

async function getPicturesForItem(itemId) {
  const { data, error } = await supabase.from('pictures').select('*').eq('item_id', itemId).order('uploaded_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => ({
    pictureId: row.picture_id,
    itemId: row.item_id,
    imageUrl: row.image_url,
    driveFileId: row.storage_path,
    note: row.note || '',
    isCover: !!row.is_cover,
    isPackagingProof: !!row.is_packaging_proof,
    photoType: row.photo_type || 'General',
    uploadedAt: row.uploaded_at || ''
  }));
}

async function updatePictureMeta(pictureId, payload) {
  const current = await supabase.from('pictures').select('*').eq('picture_id', pictureId).maybeSingle();
  if (current.error) throw current.error;
  if (!current.data) throw new Error('Picture not found.');
  if (toBool(payload.isCover)) await supabase.from('pictures').update({ is_cover: false }).eq('item_id', current.data.item_id);
  const { error } = await supabase.from('pictures').update({
    note: payload.note || '',
    is_cover: toBool(payload.isCover),
    is_packaging_proof: toBool(payload.isPackagingProof),
    photo_type: payload.photoType || 'General'
  }).eq('picture_id', pictureId);
  if (error) throw error;
  return { success: true };
}

async function deletePictureById(pictureId) {
  const { data, error } = await supabase.from('pictures').select('*').eq('picture_id', pictureId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Picture not found.');
  if (data.storage_path) await supabase.storage.from('pictures').remove([data.storage_path]);
  const deleted = await supabase.from('pictures').delete().eq('picture_id', pictureId);
  if (deleted.error) throw deleted.error;
  return { success: true };
}

async function uploadItemLabel(payload) {
  const uploaded = await uploadBase64('labels', payload.itemId, payload, 'label.pdf');
  const row = { label_id: `LAB-${Date.now()}`, item_id: payload.itemId, file_url: uploaded.url, storage_path: uploaded.path, note: payload.note || '' };
  const { data, error } = await supabase.from('labels').insert(row).select().single();
  if (error) throw error;
  await logAudit(payload.itemId, 'Label Uploaded', 'Label ID', '', data.label_id, row.note);
  return { success: true, labelId: data.label_id, fileUrl: data.file_url };
}

async function getLabelsForItem(itemId) {
  const { data, error } = await supabase.from('labels').select('*').eq('item_id', itemId).order('uploaded_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => ({ labelId: row.label_id, itemId: row.item_id, fileUrl: row.file_url, driveFileId: row.storage_path, note: row.note || '', uploadedAt: row.uploaded_at || '' }));
}

async function deleteLabelById(labelId) {
  const { data, error } = await supabase.from('labels').select('*').eq('label_id', labelId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Label not found.');
  if (data.storage_path) await supabase.storage.from('labels').remove([data.storage_path]);
  const deleted = await supabase.from('labels').delete().eq('label_id', labelId);
  if (deleted.error) throw deleted.error;
  return { success: true };
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

async function bulkUpdateStatuses(itemIds, newStatus) {
  for (const itemId of itemIds || []) await updateItemStatus(itemId, newStatus, 'Bulk update');
  return { success: true, count: (itemIds || []).length };
}

async function recordSale(itemId, actualSalePrice) {
  const current = await getInventoryById(itemId);
  await saveInventory(itemId, { actual_sale_price: toNumber(actualSalePrice), sale_date: isoDate(new Date()), status: 'Sold' });
  await logStatusChange(itemId, current.status, 'Sold', 'Sale recorded');
  return { success: true };
}

async function relistItem(itemId) {
  const current = await getInventoryById(itemId);
  await saveInventory(itemId, { status: 'Listed', sale_date: null, actual_sale_price: null, listing_date: isoDate(new Date()) });
  await logStatusChange(itemId, current.status, 'Listed', 'Relisted');
  return { success: true };
}

async function getTasks() {
  const settings = await getSettings();
  const warningDays = toNumber(settings.STALE_WARNING_DAYS || 14);
  const dangerDays = toNumber(settings.STALE_DANGER_DAYS || 30);
  const pictures = await supabase.from('pictures').select('item_id,photo_type,is_packaging_proof');
  if (pictures.error) throw pictures.error;
  const byItem = new Map();
  for (const picture of pictures.data || []) {
    const list = byItem.get(picture.item_id) || [];
    list.push(picture);
    byItem.set(picture.item_id, list);
  }
  const tasks = [];
  for (const row of await selectInventory()) {
    const itemPictures = byItem.get(row.item_id) || [];
    if (['Ready to List', 'Listed'].includes(row.status)) {
      const types = new Set(itemPictures.map(p => p.photo_type));
      for (const type of REQUIRED_PHOTO_TYPES_FOR_LISTING) {
        if (!types.has(type)) tasks.push({ itemId: row.item_id, title: row.title, taskType: 'photo', taskLabel: `Add ${type} photo`, status: row.status, ageDays: 0, urgent: true });
      }
    }
    if (row.status === 'Sold' && !itemPictures.some(p => p.is_packaging_proof)) {
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

async function generateAIDescriptionForItem(itemId) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return generateTemplateDescriptionForItem(itemId);
  const item = dbToClient(await getInventoryById(itemId));
  const openai = new OpenAI({ apiKey });
  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    input: `Write a factual, concise Vinted product description for this item. Do not invent details.\n${JSON.stringify(item, null, 2)}`
  });
  const description = response.output_text || buildDescription(item);
  await saveInventory(itemId, { description });
  return description;
}

async function getAuditLogForItem(itemId) {
  const { data, error } = await supabase.from('audit_log').select('*').eq('item_id', itemId).order('timestamp', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => ({ timestamp: row.timestamp, itemId: row.item_id, action: row.action, field: row.field, oldValue: row.old_value, newValue: row.new_value, note: row.note }));
}

async function generateMissingBarcodes() {
  const rows = await selectInventory();
  let count = 0;
  for (const row of rows) {
    if (!row.barcode) {
      await saveInventory(row.item_id, { barcode: String(Math.floor(100000000000 + Math.random() * 900000000000)) });
      count += 1;
    }
  }
  return { success: true, count };
}

async function setupSheets() {
  return { success: true, message: 'Supabase schema is managed by supabase/schema.sql.' };
}

async function updateDashboardSheet() {
  return getDashboardData('all');
}

async function generatePackingListPdf() {
  throw new Error('Packing-list PDF generation is not ported yet.');
}

async function sendUrgentTaskEmail() {
  throw new Error('Email alerts are not configured in the Supabase version yet.');
}

const rpc = {
  setupSheets,
  validateLogin,
  addInventoryItem,
  duplicateInventoryItem,
  updateExistingItem,
  fetchItemForEdit,
  fetchItemByBarcode,
  getItemById: fetchItemForEdit,
  getAllInventoryItemsForClient,
  getAutocompleteIndex,
  searchInventory,
  getActiveItemsTable,
  getArchivedItemsTable,
  saveScannerUpdate,
  generateMissingBarcodes,
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
  sendUrgentTaskEmail,
  getDashboardData,
  updateDashboardSheet,
  generatePackingListPdf,
  generateTemplateDescriptionForItem,
  generateAIDescriptionForItem,
  getAuditLogForItem
};

app.post('/api/rpc/:method', async (req, res) => {
  try {
    const fn = rpc[req.params.method];
    if (!fn) return res.status(404).json({ error: `Unknown method: ${req.params.method}` });
    const result = await fn(...(req.body.args || []));
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

app.listen(port, () => {
  console.log(`Vinted Inventory Manager listening on http://localhost:${port}`);
});
