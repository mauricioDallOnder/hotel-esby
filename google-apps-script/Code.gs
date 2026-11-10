// Hôtel Contrôle — paste into the Apps Script project bound to your spreadsheet.
// Run setup() once, then deploy as a web app. Never put API_TOKEN in client code.
//https://script.google.com/macros/s/AKfycby8og5t12Q7D9_Nspi-CPu0j5bXygWcoCqPKeOP0sMy5mrRvQPkMfUd96cucJqrT7Xg/exec
const SPREADSHEET_ID = '1mF0nUV0FihRnNJD0V6KnK7iJAjUleksrW-sPZvSd61I';
const TABLES = { issues: 'Anomalies', inspections: 'Rondes', familyEvents: 'Absences et départs', roomInspections: 'Contrôles chambres', workEvents: 'Suivi quotidien' };
const HEADERS = ['ID', 'Version', 'Date', 'Lieu / zone', 'Titre / inspecteur', 'Statut', 'Priorité', 'Responsable', 'Photo Drive', 'Modifié le'].concat(Array.from({length: 12}, (_, i) => 'Données ' + (i + 1)));

function setup() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('API_TOKEN')) props.setProperty('API_TOKEN', Utilities.getUuid() + Utilities.getUuid());
  if (!props.getProperty('PHOTO_FOLDER_ID')) props.setProperty('PHOTO_FOLDER_ID', DriveApp.createFolder('Hôtel Contrôle - Photos privées').getId());
  Object.keys(TABLES).forEach(table_);
  setupRooms_();
  } finally { lock.releaseLock(); }
  // Retrieve API_TOKEN from Project Settings > Script properties, not public logs.
}
function table_(collection) {
  const headers = headers_(collection);
  const name = TABLES[collection];
  if (!name) throw new Error('Collection invalide.');
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = book.getSheetByName(name);
  if (!sheet) {
    sheet = book.insertSheet(name);
    if (headers.length > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#153f37').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.hideColumns(11, 12);
  }
  if (headers.length > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  const existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  // Append-only upgrades preserve existing columns and every historical row.
  if (collection === 'roomInspections') {
    const firstMissing = existing.findIndex(value => !value);
    if (firstMissing >= headers.indexOf('Poignée dégagée') && existing.slice(0, firstMissing).join('|') === headers.slice(0, firstMissing).join('|') && existing.slice(firstMissing).every(value => !value)) {
      sheet.getRange(1, firstMissing + 1, 1, headers.length - firstMissing).setValues([headers.slice(firstMissing)]).setFontWeight('bold');
    }
  }
  if (sheet.getRange(1, 1, 1, headers.length).getValues()[0].join('|') !== headers.join('|')) throw new Error('En-têtes incompatibles dans ' + name + '. Ne modifiez pas la structure.');
  return sheet;
}
function records_(collection) {
  const sheet = table_(collection);
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues().filter(row => row[0]).map(row => JSON.parse(row.slice(10, 22).map(chunk => String(chunk).slice(1)).join('')));
}
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
// GET exposes only health. Private reads use POST so the API token stays out of URLs.
function doGet() { return json_({ ok: true, service: 'Hôtel Contrôle', version: 3 }); }
function doPost(e) {
  let lock;
  try {
    if (!e || !e.postData || e.postData.contents.length > 9000000) throw new Error('Requête invalide.');
    const input = JSON.parse(e.postData.contents);
    const token = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if (!token || input.token !== token) return json_({ ok: false, code: 401, error: 'Accès refusé.' });
    if (String(input.action || '').indexOf('laundryPush') === 0) return laundryPushAction_(input);
    if (input.action === 'list') return json_({ ok: true, data: { issues: records_('issues'), inspections: records_('inspections'), familyEvents: records_('familyEvents'), roomInspections: records_('roomInspections'), workEvents: records_('workEvents'), maxIssuePhotos: 3, entryVersion: 3, deletedFamilyEventIds: deletedAbsences_() } });
    if (input.action === 'photo') {
      const collection = input.collection === 'roomInspections' ? 'roomInspections' : 'issues';
      const issue = records_(collection).find(item => item.id === input.issueId);
      const photoIds = issue ? photoIds_(issue) : [];
      const index = input.index === undefined ? 0 : input.index;
      if (!Number.isInteger(index) || index < 0 || !photoIds[index]) return json_({ ok: false, code: 404, error: 'Photo introuvable.' });
      const file = DriveApp.getFileById(photoIds[index]);
      return json_({ ok: true, data: { base64: Utilities.base64Encode(file.getBlob().getBytes()) } });
    }
    if (input.action === 'deleteEntry') {
      if (input.collection !== 'familyEvents' || !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(input.id || '')) throw new Error('Suppression invalide.');
      lock = LockService.getScriptLock(); lock.waitLock(20000);
      const current = records_('familyEvents').find(record => record.id === input.id);
      const deleted = deletedAbsences_().includes(input.id);
      if (!current && !deleted) return json_({ ok: false, code: 404, error: 'Absence introuvable.' });
      if (current && current.kind !== 'absence') throw new Error('Seules les absences peuvent être supprimées.');
      if (!deleted) {
        const tombstones = deletionTable_();
        tombstones.getRange(tombstones.getLastRow() + 1, 1, 1, 2).setValues([[input.id, new Date().toISOString()]]);
        SpreadsheetApp.flush();
      }
      if (current) {
        const sheet = table_('familyEvents');
        const row = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().findIndex(row => row[0] === input.id);
        if (row < 0) throw new Error('Absence introuvable.');
        sheet.deleteRow(row + 2);
        SpreadsheetApp.flush();
      }
      return json_({ ok: true, data: { deleted: true, id: input.id } });
    }
    if (input.action !== 'commit' && input.action !== 'commitEntry' && input.action !== 'commitRoomInspection' && input.action !== 'commitWorkEvent' && input.action !== 'commitLaundryCycle') throw new Error('Action invalide.');
    lock = LockService.getScriptLock();
    lock.waitLock(20000);
    const isEntry = input.action === 'commitEntry' || input.action === 'commitRoomInspection' || input.action === 'commitWorkEvent' || input.action === 'commitLaundryCycle';
    if (input.action === 'commitWorkEvent' && input.collection !== 'workEvents') throw new Error('Collection invalide.');
    if (input.action === 'commitLaundryCycle' && (input.collection !== 'workEvents' || !input.record || input.record.kind !== 'laundryCycle')) throw new Error('Cycle de lingerie invalide.');
    if (input.collection === 'workEvents' && input.record && input.record.kind === 'laundryCycle' && input.action !== 'commitLaundryCycle') throw new Error('Utilisez commitLaundryCycle.');
    if (input.action === 'commitRoomInspection' && input.collection !== 'roomInspections') throw new Error('Collection invalide.');
    if (isEntry && !['familyEvents', 'roomInspections', 'workEvents'].includes(input.collection)) throw new Error('Collection invalide.');
    if (!isEntry && ['familyEvents', 'roomInspections', 'workEvents'].includes(input.collection)) throw new Error('Utilisez commitEntry.');
    if (isEntry && (input.expectedVersion !== 0 || !/^[a-f0-9]{64}$/.test(input.record && input.record.submissionHash))) throw new Error('Enregistrement invalide.');
    const sheet = table_(input.collection);
    const record = input.record;
    if (!record || !/^[\da-f-]{36}$/i.test(record.id) || !Number.isInteger(input.expectedVersion) || record.version !== input.expectedVersion + 1) throw new Error('Enregistrement invalide.');
    const records = records_(input.collection);
    const current = records.find(item => item.id === record.id);
    if (input.collection === 'familyEvents' && deletedAbsences_().includes(record.id)) return json_({ ok: false, code: 409, error: 'Cette absence a été supprimée.' });
    if (isEntry && current && current.submissionHash === record.submissionHash) {
      if (input.collection === 'roomInspections') {
        const migrated = current.issueSyncVersion !== 2;
        // Historical same-ID anomalies must retain their existing identity.
        const previous = records_('issues').find(item => item.id === current.id);
        if (migrated && previous) {
          current.issueSyncVersion = 2; current.createdIssue = true;
          current.relatedIssueIds = []; current.newIssueFindingKeys = (input.issue && input.issue.roomFindings || []).map(f => f.key);
        }
        input.issue = RoomIssueMatching.prepareRoomIssue(input.issue, current, records_('issues'));
        if (migrated) writeRecord_('roomInspections', current, true, current);
      }
      return json_({ ok: true, data: { collection: input.collection, record: current, issue: syncRoomIssue_(input, current) } });
    }
    if ((current ? current.version : 0) !== input.expectedVersion) return json_({ ok: false, code: 409, error: 'Modifié par un autre utilisateur. Actualisez avant de réessayer.' });
    if (input.collection === 'inspections' && current && current.completed) throw new Error('Ronde déjà terminée.');
    if (input.collection === 'workEvents') {
      const conflict = WorkLogic.validateWorkEntry(record, records, records_('familyEvents'), deletedAbsences_());
      if (conflict) return json_({ ok: false, code: 409, error: conflict });
    }
    // The trusted Next.js server validates the full business schema before commit.
    // The token must only be shared with that server.
    if (input.collection === 'issues' || input.collection === 'roomInspections') {
      record.photoIds = current ? photoIds_(current) : [];
      const photos = (input.photoData ? [input.photoData] : []).concat(input.photosData || []);
      if (photos.length > 3 || photos.some(photo => typeof photo !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photo) || photo.length > 2800000)) throw new Error('Maximum 3 photos JPEG valides.');
      if (photos.length) {
        if (current) throw new Error('Photos déjà enregistrées.');
        const folderId = PropertiesService.getScriptProperties().getProperty('PHOTO_FOLDER_ID');
        const folder = DriveApp.getFolderById(folderId);
        // Deterministic name reuses a file left by a timed-out save.
        record.photoIds = photos.map((photo, index) => {
          const filename = record.id + '-' + (isEntry ? record.submissionHash + '-' : '') + index + '.jpg';
          const files = folder.getFilesByName(filename);
          return files.hasNext() ? files.next().getId() : folder.createFile(Utilities.newBlob(Utilities.base64Decode(photo.split(',')[1]), 'image/jpeg', filename)).getId();
        });
      }
      record.photoId = record.photoIds[0] || null;
    }
    if (input.collection === 'roomInspections') {
      input.issue = RoomIssueMatching.prepareRoomIssue(input.issue, record, records_('issues'));
    }
    writeRecord_(input.collection, record, isEntry, current);
    const issue = syncRoomIssue_(input, record);
    return json_({ ok: true, data: isEntry ? { collection: input.collection, record: record, issue: issue } : { id: record.id, version: record.version } });
  } catch (error) { return json_({ ok: false, code: 400, error: String(error.message || error) }); }
  finally { if (lock && lock.hasLock()) lock.releaseLock(); }
}
// Called under the same script lock. A retry repairs a partial write and never
// overwrites an anomaly that has already been assigned or resolved.
function syncRoomIssue_(input, record) {
  if (input.collection !== 'roomInspections' || !input.issue) return;
  const current = records_('issues').find(item => item.id === record.id);
  if (current) return current;
  const issue = Object.assign({}, input.issue, { id: record.id, photoIds: photoIds_(record), photoId: record.photoId });
  if (issue.version !== 1) throw new Error('Anomalie de chambre invalide.');
  writeRecord_('issues', issue, false, null);
  return issue;
}
function writeRecord_(collection, record, isEntry, current) {
    const sheet = table_(collection);
    const serialized = JSON.stringify(record);
    if (serialized.length > 420000) throw new Error('Historique trop volumineux.');
    const chunks = Array.from({length: 12}, (_, i) => serialized.slice(i * 35000, (i + 1) * 35000));
    const safe = value => { const str = String(value == null ? '' : value); return /^[=+\-@]/.test(str) ? "'" + str : str; };
    let row = [record.id, record.version, record.date, record.location || record.area, record.title || record.inspector, record.status || (record.completed ? 'Terminée' : 'Brouillon'), record.priority || '', record.assignee || '', photoIds_(record).map(id => 'https://drive.google.com/file/d/' + id + '/view').join('\n'), record.updatedAt].map(safe).concat(chunks.map(chunk => 'j' + chunk));
    if (isEntry && collection !== 'workEvents') {
      const photos = photoIds_(record).map(id => 'https://drive.google.com/file/d/' + id + '/view').join('\n');
      const visible = collection === 'familyEvents'
        ? [record.id, record.version, record.date, record.room, record.family, record.kind === 'absence' ? 'Absence' : 'Départ', record.actor, record.notes, photos, record.updatedAt]
        : [record.id, record.version, record.date, record.room, record.actor, record.condition, record.cleaning, record.notes, photos, record.updatedAt];
      const extra = collection === 'familyEvents' ? [record.returnDate || ''] : [record.carpet, record.carpetNotes, record.microwave].concat(ROOM_CHECK_KEYS.map(key => {
        const check = record.checks.find(c => c.key === key);
        if (!check) return '';
        if (key === 'radiator_clear') return check.result === 'ok' ? 'Libre' : check.result === 'probleme' ? 'Caché' : check.result;
        return check.result;
      }));
      row = visible.map(safe).concat(chunks.map(chunk => 'j' + chunk), extra.map(safe));
    }
    if (collection === 'workEvents') {
      row = [record.id, record.version, record.date, record.room || '', record.notes, record.kind, '', record.actor, '', record.updatedAt].map(safe).concat(chunks.map(chunk => 'j' + chunk));
    }
    const rowNumber = current ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().findIndex(row => row[0] === record.id) + 2 : sheet.getLastRow() + 1;
    sheet.getRange(rowNumber, 1, 1, row.length).setNumberFormat('@').setValues([row]);
    SpreadsheetApp.flush();
}
function photoIds_(record) {
  return record.photoIds && record.photoIds.length ? record.photoIds : record.photoId ? [record.photoId] : [];
}

// Device capabilities and delivery leases are private server data. This sheet
// is deliberately absent from TABLES and from the ordinary list response.
const LAUNDRY_PUSH_SHEET = 'Notifications lingerie';
const LAUNDRY_PUSH_HEADERS = ['Type', 'ID', 'Données', 'Mis à jour'];
function laundryPushTable_() {
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = book.getSheetByName(LAUNDRY_PUSH_SHEET);
  if (!sheet) {
    sheet = book.insertSheet(LAUNDRY_PUSH_SHEET);
    sheet.getRange(1, 1, 1, 4).setValues([LAUNDRY_PUSH_HEADERS]);
    sheet.setFrozenRows(1);
  }
  if (sheet.getRange(1, 1, 1, 4).getValues()[0].join('|') !== LAUNDRY_PUSH_HEADERS.join('|'))
    throw new Error('En-têtes incompatibles dans Notifications lingerie.');
  return sheet;
}
function laundryPushState_(sheet, now) {
  const state = { subscriptions: [], deliveries: [] };
  const seen = new Set();
  const rows = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  rows.filter(row => row[0] || row[1] || row[2]).forEach(row => {
    const type = row[0], id = String(row[1]), serialized = String(row[2]);
    if (!['subscription', 'delivery'].includes(type) || !/^[a-f0-9]{64}$/.test(id) || serialized[0] !== 'j' || seen.has(type + ':' + id))
      throw new Error('Données de notification incompatibles.');
    seen.add(type + ':' + id);
    const value = JSON.parse(serialized.slice(1));
    if (!value || value.id !== id) throw new Error('Données de notification incompatibles.');
    if (type === 'subscription') {
      if (!value.subscription || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt)))
        throw new Error('Abonnement de notification incompatible.');
      const expiration = value.subscription.expirationTime;
      if (expiration == null || expiration > now) state.subscriptions.push(value);
    } else {
      const expires = Date.parse(value.expiresAt);
      if (!Number.isFinite(expires)) throw new Error('Suivi de notification incompatible.');
      // Keep sent IDs long enough to cover overlapping dispatches and retries.
      if (now < expires + 60 * 60000) state.deliveries.push(value);
    }
  });
  return state;
}
function writeLaundryPushState_(sheet, state) {
  const rows = [LAUNDRY_PUSH_HEADERS].concat(
    state.subscriptions.map(item => ['subscription', item.id, 'j' + JSON.stringify(item), item.updatedAt]),
    state.deliveries.map(item => ['delivery', item.id, 'j' + JSON.stringify(item), item.updatedAt])
  );
  // One padded write replaces this private table without clearing it first.
  const size = Math.max(rows.length, sheet.getLastRow());
  while (rows.length < size) rows.push(['', '', '', '']);
  if (size > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), size - sheet.getMaxRows());
  sheet.getRange(1, 1, size, 4).setNumberFormat('@').setValues(rows);
  SpreadsheetApp.flush();
}
function laundryPushHash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(byte => ('0' + (byte & 255).toString(16)).slice(-2)).join('');
}
function laundryPushEndpoint_(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  const match = /^https:\/\/([^/?#]+)(\/[^#]+)$/.exec(value);
  if (!match) return false;
  const host = match[1].replace(/:443$/, '').toLowerCase();
  return host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' || host === 'web.push.apple.com'
    || /^[a-z0-9-]+\.push\.apple\.com$/.test(host) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(host);
}
function laundryPushSubscription_(input, id, now) {
  if (!input || !laundryPushEndpoint_(input.endpoint) || !/^[a-f0-9]{64}$/.test(id || '') || laundryPushHash_(input.endpoint) !== id
    || !input.keys || !/^[A-Za-z0-9_-]{87}$/.test(input.keys.p256dh || '') || !/^[A-Za-z0-9_-]{22}$/.test(input.keys.auth || '')
    || (input.expirationTime != null && (!Number.isFinite(input.expirationTime) || input.expirationTime <= now)))
    throw new Error('Abonnement de notification invalide ou expiré.');
  return { endpoint: input.endpoint, expirationTime: input.expirationTime == null ? null : input.expirationTime,
    keys: { p256dh: input.keys.p256dh, auth: input.keys.auth } };
}
function laundryPushTime_(value) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error('Date de notification invalide.');
  return time;
}
function laundryPushRequest_(request) {
  if (!request || !/^[a-f0-9]{64}$/.test(request.id || '')
    || !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(request.cycleId || '')
    || !['soon', 'finished'].includes(request.stage)) throw new Error('Notification invalide.');
  laundryPushTime_(request.expiresAt);
}
function laundryPushAction_(input) {
  if (input.action === 'laundryPushStatus') {
    const props = PropertiesService.getScriptProperties();
    const last = props.getProperty('LAUNDRY_PUSH_LAST_RUN_AT');
    return json_({ ok: true, data: {
      configured: props.getProperty('LAUNDRY_PUSH_ENABLED') === '1' && !!laundryAppOrigin_(props.getProperty('LAUNDRY_APP_URL')) && !!props.getProperty('API_TOKEN'),
      ...(last && Number.isFinite(Date.parse(last)) ? { lastRunAt: last } : {})
    } });
  }
  if (!['laundryPushSave', 'laundryPushDelete', 'laundryPushList', 'laundryPushClaim', 'laundryPushComplete'].includes(input.action))
    throw new Error('Action invalide.');
  const now = ['laundryPushClaim', 'laundryPushComplete'].includes(input.action) ? laundryPushTime_(input.now) : Date.now();
  const nowISO = new Date(now).toISOString();
  if (input.action === 'laundryPushClaim') {
    if (!Array.isArray(input.requests) || input.requests.length > 300) throw new Error('Trop de notifications à traiter.');
    input.requests.forEach(laundryPushRequest_);
  }
  if (input.action === 'laundryPushComplete') {
    if (!Array.isArray(input.results) || input.results.length > 50 || input.results.some(result => !result || !/^[a-f0-9]{64}$/.test(result.id || '')
      || !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(result.leaseToken || '') || !['sent', 'retry'].includes(result.outcome)))
      throw new Error('Résultat de notification invalide.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = laundryPushTable_(), state = laundryPushState_(sheet, now);
    let data;
    if (input.action === 'laundryPushSave') {
      const subscription = laundryPushSubscription_(input.subscription, input.id, now);
      const index = state.subscriptions.findIndex(item => item.id === input.id);
      if (index < 0 && state.subscriptions.length >= 50) return json_({ ok: false, code: 409, error: 'Limite de 50 appareils atteinte. Désactivez les notifications sur un ancien appareil.' });
      const stored = { id: input.id, subscription: subscription, createdAt: index < 0 ? nowISO : state.subscriptions[index].createdAt, updatedAt: nowISO };
      if (index < 0) state.subscriptions.push(stored); else state.subscriptions[index] = stored;
      data = { id: input.id };
    } else if (input.action === 'laundryPushDelete') {
      if (!laundryPushEndpoint_(input.endpoint)) throw new Error('Abonnement de notification invalide.');
      const id = laundryPushHash_(input.endpoint);
      state.subscriptions = state.subscriptions.filter(item => item.id !== id);
      data = { removed: true };
    } else if (input.action === 'laundryPushList') {
      data = state.subscriptions;
    } else if (input.action === 'laundryPushClaim') {
      const current = [...WorkLogic.latestWork(records_('workEvents'), 'laundryCycle').values()];
      const deliveries = new Map(state.deliveries.map(item => [item.id, item]));
      const granted = [];
      for (const request of input.requests) {
        if (granted.length >= 50) break;
        const previous = deliveries.get(request.id);
        if (previous && (previous.sentAt || Date.parse(previous.leaseUntil) > now || previous.cycleId !== request.cycleId || previous.stage !== request.stage)) continue;
        const cycle = current.find(item => item.laundryCycleId === request.cycleId && item.laundryStatus === 'en_cours');
        const machine = cycle && WorkLogic.getLaundryMachine(cycle.targetId);
        const end = machine ? Date.parse(cycle.laundryStartedAt) + machine.durationMinutes * 60000 : NaN;
        const begins = request.stage === 'soon' ? end - 10 * 60000 : end;
        const expires = request.stage === 'soon' ? end : end + 15 * 60000;
        const requestedExpiry = Date.parse(request.expiresAt);
        if (!Number.isFinite(end) || now < begins || now >= expires || requestedExpiry <= now || requestedExpiry > expires) continue;
        const leaseToken = Utilities.getUuid();
        const delivery = { id: request.id, cycleId: request.cycleId, stage: request.stage, expiresAt: request.expiresAt,
          leaseToken: leaseToken, leaseUntil: new Date(now + 2 * 60000).toISOString(), sentAt: null, updatedAt: nowISO };
        deliveries.set(request.id, delivery);
        granted.push({ id: request.id, leaseToken: leaseToken });
      }
      state.deliveries = [...deliveries.values()];
      data = granted;
    } else {
      for (const result of input.results) {
        const delivery = state.deliveries.find(item => item.id === result.id);
        if (!delivery || delivery.sentAt || delivery.leaseToken !== result.leaseToken) continue;
        delivery.sentAt = result.outcome === 'sent' ? nowISO : null;
        delivery.leaseToken = null;
        delivery.leaseUntil = null;
        delivery.updatedAt = nowISO;
      }
      data = { completed: true };
    }
    writeLaundryPushState_(sheet, state);
    return json_({ ok: true, data: data });
  } finally { lock.releaseLock(); }
}
function laundryAppOrigin_(value) {
  // An administrator supplies the trusted deployment origin in script settings.
  // Accept an origin only: no credentials, paths, queries, fragments or redirects.
  if (typeof value !== 'string' || !/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[1-9]\d{0,4})?\/?$/i.test(value)) return null;
  const port = /:(\d+)\/?$/.exec(value);
  if (port && Number(port[1]) > 65535) return null;
  return value.replace(/\/$/, '');
}
// Run manually after setting LAUNDRY_APP_URL and deploying the updated app.
// setup() intentionally does not enable outbound notification callbacks.
function setupLaundryNotifications() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const props = PropertiesService.getScriptProperties();
    const origin = laundryAppOrigin_(props.getProperty('LAUNDRY_APP_URL'));
    if (!origin || !props.getProperty('API_TOKEN')) throw new Error('Renseignez LAUNDRY_APP_URL (origine HTTPS de l’application) et API_TOKEN dans les propriétés du script.');
    const previous = ScriptApp.getProjectTriggers().filter(trigger => trigger.getHandlerFunction() === 'dispatchLaundryNotifications');
    ScriptApp.newTrigger('dispatchLaundryNotifications').timeBased().everyMinutes(1).create();
    previous.forEach(trigger => ScriptApp.deleteTrigger(trigger));
    laundryPushTable_();
    props.setProperty('LAUNDRY_APP_URL', origin);
    props.deleteProperty('LAUNDRY_PUSH_LAST_RUN_AT');
    props.setProperty('LAUNDRY_PUSH_ENABLED', '1');
  } finally { lock.releaseLock(); }
}
function dispatchLaundryNotifications() {
  const props = PropertiesService.getScriptProperties();
  const origin = laundryAppOrigin_(props.getProperty('LAUNDRY_APP_URL'));
  const token = props.getProperty('API_TOKEN');
  if (props.getProperty('LAUNDRY_PUSH_ENABLED') !== '1' || !origin || !token) return;
  // Never hold the script lock during this callback: the Next.js dispatcher
  // calls back into laundryPushClaim/Complete, which acquire that same lock.
  const response = UrlFetchApp.fetch(origin + '/api/laundry/notifications/dispatch', {
    method: 'post', contentType: 'application/json', payload: '{}', headers: { Authorization: 'Bearer ' + token },
    followRedirects: false, muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error('Notifications lingerie indisponibles (HTTP ' + status + ').');
  props.setProperty('LAUNDRY_PUSH_LAST_RUN_AT', new Date().toISOString());
}

const ROOM_CHECK_KEYS = ['taps', 'switches', 'leaks', 'lights', 'smoke', 'damage', 'window', 'bed', 'mattress', 'fridge', 'door_handle_clear', 'door_closer', 'radiator_clear'];
function headers_(collection) {
  const data = HEADERS.slice(10);
  if (collection === 'workEvents') return ['ID', 'Version', 'Date', 'Chambre', 'Texte', 'Type de suivi', 'Réservé', 'Auteur', 'Réservé 2', 'Enregistré le'].concat(data);
  if (collection === 'familyEvents') return ['ID', 'Version', 'Date', 'Chambre', 'Famille', 'Événement', 'Signalé par', 'Observations', 'Photo Drive', 'Modifié le'].concat(data, ['Retour prévu']);
  if (collection === 'roomInspections') return ['ID', 'Version', 'Date', 'Chambre', 'Inspecteur', 'État', 'Ménage', 'Observations', 'Photo Drive', 'Modifié le'].concat(data, ['Moquette', 'Détail moquette', 'Micro-ondes', 'Robinets', 'Interrupteurs', 'Aucune fuite', 'Éclairage', 'Détecteur fumée', 'Rien de cassé', 'Fenêtre', 'Lit', 'Matelas', 'Minibar', 'Poignée dégagée', 'Ferme-porte', 'Chauffage / radiateur']);
  return HEADERS;
}
function deletionTable_() {
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = book.getSheetByName('Suppressions absences');
  if (!sheet) {
    sheet = book.insertSheet('Suppressions absences');
    sheet.getRange(1, 1, 1, 2).setValues([['ID', 'Supprimé le']]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}
function deletedAbsences_() {
  const sheet = deletionTable_();
  return sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map(row => String(row[0])).filter(Boolean);
}
const ROOM_GROUPS = [
  { label: "1er étage", rooms: ["101", "102", "103", "104", "105", "106", "107", "108", "109", "110", "114", "115", "116", "117", "118", "119", "120", "121", "122", "123", "124", "125", "126"] },
  { label: "2e étage", rooms: ["201", "202", "203", "204", "205", "206", "207", "208", "209", "210", "211", "212", "214", "215", "216", "217", "218", "219", "220", "221", "222", "223", "224", "225", "226", "227", "228", "229", "230", "231", "232", "233"] },
  { label: "3e étage", rooms: ["302", "303", "304", "305", "306", "307", "308", "309", "310", "311", "312", "314", "315", "316", "317", "318", "319", "320", "321", "322", "323", "324", "325", "326", "327", "328", "329", "330", "331", "332"] },
];
function setupRooms_() {
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = book.getSheetByName('Chambres') || book.insertSheet('Chambres');
  const rows = [['Chambre', 'Groupe']].concat(ROOM_GROUPS.flatMap(group => group.rooms.map(room => [room, group.label])));
  // Only this reference catalogue is reconciled. Historical tables are untouched.
  const previousRows = sheet.getLastRow();
  sheet.getRange(1, 1, rows.length, 2).setNumberFormat('@').setValues(rows);
  if (previousRows > rows.length) sheet.getRange(rows.length + 1, 1, previousRows - rows.length, 2).clearContent();
  sheet.setFrozenRows(1);
}
// BEGIN GENERATED ROOM ISSUE MATCHING — npm run build:apps-script
var RoomIssueMatching = (function () {
var exports = {};
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeIssueText = normalizeIssueText;
exports.issueRoom = issueRoom;
exports.openRoomIssues = openRoomIssues;
exports.matchesRoomFinding = matchesRoomFinding;
exports.planRoomIssue = planRoomIssue;
exports.prepareRoomIssue = prepareRoomIssue;
function normalizeIssueText(text) {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function issueRoom(issue) {
    if (issue.room)
        return issue.room;
    const location = normalizeIssueText(issue.location || "");
    if (/^\d{3}$/.test(location))
        return location;
    const matches = [...location.matchAll(/\b(?:chambre|ch)\s+(\d{3})\b/g)];
    return matches.length === 1 && (location.match(/\b\d{3}\b/g) || []).length === 1 ? matches[0][1] : undefined;
}
function openRoomIssues(issues, room) {
    return issues.filter(issue => issue.status !== "resolu" && issueRoom(issue) === room);
}
const keywords = {
    taps: /\b(robinet\w*|mitigeur\w*)\b/,
    switches: /\binterrupteur\w*\b/,
    leaks: /\b(fuite\w*|infiltration\w*)\b/,
    lights: /\b(eclair\w*|ampoule\w*|lumiere\w*|lampe\w*)\b/,
    smoke: /\b(detecteur\w*|fumee)\b/,
    window: /\b(fenetre\w*|vitrage\w*)\b/,
    bed: /\b(lit|lits|sommier\w*)\b/,
    mattress: /\bmatelas\b/,
    fridge: /\b(minibar\w*|frigo\w*|refrigerateur\w*)\b/,
    door_handle_clear: /\bpoignee\w*\b/,
    door_closer: /\b(ferme porte\w*|groom\w*|fermeture automatique)\b/,
    bugs: /\b(cafard\w*|nuisible\w*|punaise\w*|blatte\w*)\b/,
    carpet: /\bmoquette\w*\b/,
    cleaning: /\b(menage|nettoyage chambre)\b/,
};
function matchesRoomFinding(issue, finding) {
    var _a, _b;
    if ((_a = issue.roomFindings) === null || _a === void 0 ? void 0 : _a.length)
        return issue.roomFindings.some(item => item.key === finding.key &&
            (finding.key !== "observation" || normalizeIssueText(item.label) === normalizeIssueText(finding.label)));
    const text = normalizeIssueText(`${issue.title || ""} ${issue.description || ""}`);
    // A heater fault is different from a heater hidden or obstructed by objects.
    if (finding.key === "radiator_clear")
        return /\b(chauffage\w*|radiateur\w*)\b/.test(text) &&
            /\b(cache[es]*|recouvert[es]*|obstrue[es]*|encombre[es]*)\b/.test(text) &&
            !/\b(pas|non|jamais|plus)(?: \w+){0,2} (cache[es]*|recouvert[es]*|obstrue[es]*|encombre[es]*)\b/.test(text);
    const dirty = /\b(sale\w*|salete\w*|nettoy\w*|proprete)\b/.test(text);
    if (finding.key === "microwave_cleaning")
        return /\bmicro ondes?\b/.test(text) && dirty;
    if (finding.key === "fridge_cleaning")
        return keywords.fridge.test(text) && dirty;
    if (finding.key === "fridge" && dirty && !/\b(panne|hs|fonction\w*|casse\w*|refroid\w*)\b/.test(text))
        return false;
    if (finding.key === "observation")
        return normalizeIssueText(issue.description || "") === normalizeIssueText(finding.label);
    return ((_b = keywords[finding.key]) === null || _b === void 0 ? void 0 : _b.test(text)) || false;
}
function planRoomIssue(candidate, record, issues) {
    var _a;
    if (!candidate)
        return { issue: undefined, relatedIssueIds: [] };
    const open = openRoomIssues(issues, record.room);
    const related = new Set();
    const remaining = (candidate.roomFindings || []).filter(finding => {
        var _a, _b;
        if ((_a = record.distinctProblemKeys) === null || _a === void 0 ? void 0 : _a.includes(finding.key))
            return true;
        const explicit = (_b = record.issueLinks) === null || _b === void 0 ? void 0 : _b.find(link => link.key === finding.key);
        const existing = open.find(issue => (explicit === null || explicit === void 0 ? void 0 : explicit.issueId) === issue.id) || open.find(issue => matchesRoomFinding(issue, finding));
        if (existing) {
            related.add(existing.id);
            return false;
        }
        return true;
    });
    if (((_a = candidate.roomFindings) === null || _a === void 0 ? void 0 : _a.length) && !remaining.length)
        return { issue: undefined, relatedIssueIds: [...related] };
    const issue = { ...candidate, roomFindings: remaining,
        description: remaining.length ? [...remaining.map(finding => finding.label), ...(record.notes && !remaining.some(f => f.label === record.notes) ? [record.notes] : [])].join("\n").slice(0, 4000) : candidate.description };
    return { issue, relatedIssueIds: [...related] };
}
// Persist the decision before either write. Replays keep that decision even if
// a linked issue was resolved after the inspection or a write was interrupted.
function prepareRoomIssue(candidate, record, issues) {
    var _a, _b;
    if (record.issueSyncVersion === 2) {
        if (!record.createdIssue)
            return undefined;
        const existing = issues.find(issue => issue.id === record.id);
        if (existing)
            return existing;
        if (!candidate)
            return undefined;
        const findings = (candidate.roomFindings || []).filter(f => { var _a; return (_a = record.newIssueFindingKeys) === null || _a === void 0 ? void 0 : _a.includes(f.key); });
        // A narrowed rule must not turn an old repair into a different anomaly.
        if (!findings.length)
            return undefined;
        return { ...candidate, roomFindings: findings,
            description: [...findings.map(f => f.label), ...(record.notes && !findings.some(f => f.label === record.notes) ? [record.notes] : [])].join("\n").slice(0, 4000) };
    }
    const plan = planRoomIssue(candidate, record, issues);
    record.relatedIssueIds = plan.relatedIssueIds;
    record.createdIssue = !!plan.issue;
    record.newIssueFindingKeys = ((_b = (_a = plan.issue) === null || _a === void 0 ? void 0 : _a.roomFindings) === null || _b === void 0 ? void 0 : _b.map(f => f.key)) || [];
    record.issueSyncVersion = 2;
    return plan.issue;
}

return exports;
})();
// END GENERATED ROOM ISSUE MATCHING
// BEGIN GENERATED WORK EVENTS — npm run build:apps-script
var WorkLogic = (function () {
var exports = {};
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.laundryMachines = void 0;
exports.getLaundryMachine = getLaundryMachine;
exports.validateLaundryEntry = validateLaundryEntry;
exports.latestWork = latestWork;
exports.validateWorkEntry = validateWorkEntry;
exports.roomAvailability = roomAvailability;
exports.dailyTasks = dailyTasks;
exports.familyComments = familyComments;
// The visible numbers match the physical labels. Washers and dryers have
// distinct IDs so a cycle can never reserve the wrong kind of appliance.
exports.laundryMachines = [
    { id: "washer-1", label: "Machine à laver 1", kind: "washer", capacityKg: 18, durationMinutes: 40, program: "Rapide 40" },
    { id: "washer-2", label: "Machine à laver 2", kind: "washer", capacityKg: 8, durationMinutes: 30, program: "Rapide 30" },
    { id: "washer-3", label: "Machine à laver 3", kind: "washer", capacityKg: 8, durationMinutes: 30, program: "Rapide 30" },
    { id: "dryer-1", label: "Machine à sécher 1", kind: "dryer", capacityKg: null, durationMinutes: 80, program: "Séchage · 1 h 20" },
    { id: "dryer-2", label: "Machine à sécher 2", kind: "dryer", capacityKg: null, durationMinutes: 80, program: "Séchage · 1 h 20" },
    { id: "dryer-3", label: "Machine à sécher 3", kind: "dryer", capacityKg: null, durationMinutes: 80, program: "Séchage · 1 h 20" },
];
function getLaundryMachine(id) {
    return exports.laundryMachines.find(machine => machine.id === id);
}
// This validator is bundled unchanged into Apps Script, inside its write lock.
// Reaching the scheduled end does not release a machine: the clothes stay there
// until an operator explicitly records their removal or cancels the cycle.
function validateLaundryEntry(entry, events, current) {
    if (!getLaundryMachine(entry.targetId) || !entry.room || !entry.laundryCycleId || !entry.laundryStartedAt ||
        !entry.laundryStatus || !["en_cours", "recupere", "annule"].includes(entry.laundryStatus))
        return "Renseignez la machine, la chambre et le cycle de linge.";
    const started = Date.parse(entry.laundryStartedAt), occurred = Date.parse(entry.occurredAt);
    if (!Number.isFinite(started) || !Number.isFinite(occurred) || occurred < started)
        return "La mise à jour du linge doit suivre le démarrage du cycle.";
    if (entry.laundryStatus === "recupere") {
        if (!entry.laundryCollectedAt || entry.laundryCollectedAt !== entry.occurredAt || entry.laundryCollectedBy !== entry.actor)
            return "La récupération doit indiquer sa date, son heure et la personne qui l’enregistre.";
    }
    else if (entry.laundryCollectedAt !== null || entry.laundryCollectedBy !== "") {
        return "Un cycle non récupéré ne peut pas avoir de date ou de responsable de récupération.";
    }
    if (entry.laundryStatus === "en_cours") {
        if ((current === null || current === void 0 ? void 0 : current.laundryStatus) === "en_cours")
            return "Cette machine contient déjà du linge. Confirmez sa récupération avant de démarrer un autre cycle.";
        if (events.some(event => event.kind === "laundryCycle" && event.laundryCycleId === entry.laundryCycleId))
            return "Ce cycle de linge existe déjà. Utilisez un nouveau cycle.";
        if (entry.laundryStartedAt !== entry.occurredAt)
            return "Le démarrage du cycle doit correspondre à l’heure de cette action.";
        if (current && occurred < Date.parse(current.occurredAt))
            return "Le nouveau cycle ne peut pas commencer avant la libération de la machine.";
        return undefined;
    }
    if (!current || current.laundryStatus !== "en_cours" || current.laundryCycleId !== entry.laundryCycleId)
        return "Ce cycle n’est plus en cours sur cette machine. Actualisez la lingerie.";
    if (entry.room !== current.room || entry.laundryStartedAt !== current.laundryStartedAt ||
        (entry.laundryOwner || "") !== (current.laundryOwner || ""))
        return "Le cycle doit conserver sa chambre, son propriétaire et son heure de démarrage.";
    if (occurred < Date.parse(current.occurredAt))
        return "La récupération ou l’annulation doit suivre le démarrage du cycle.";
    return undefined;
}
function latestWork(events, kind) {
    const latest = new Map();
    for (const event of events.filter(e => e.kind === kind)) {
        const previous = latest.get(event.targetId);
        if (!previous || previous.expectedRevision < event.expectedRevision)
            latest.set(event.targetId, event);
    }
    return latest;
}
function validateWorkEntry(entry, events, families, deletedFamilies = []) {
    const current = latestWork(events, entry.kind).get(entry.targetId);
    if ((current ? current.expectedRevision + 1 : 0) !== entry.expectedRevision)
        return "Ce suivi a été modifié ailleurs. Actualisez, annulez la modification en attente puis recommencez.";
    if (current === null || current === void 0 ? void 0 : current.deleted)
        return "Cette tâche a déjà été supprimée.";
    if (entry.kind === "laundryCycle")
        return validateLaundryEntry(entry, events, current);
    if (entry.kind === "familyComment") {
        const family = families.find(f => f.id === entry.familyEventId);
        if (!family || deletedFamilies.includes(family.id))
            return "Cet événement familial n’existe plus.";
        if (family.room !== entry.room || (current && current.familyEventId !== entry.familyEventId))
            return "Ce commentaire appartient à un autre événement.";
    }
    if (entry.kind === "dailyTask" && entry.deleted && !current)
        return "Cette tâche n’existe pas.";
    return undefined;
}
function roomAvailability(room, events, latestInspection) {
    const manual = latestWork(events, "roomAvailability").get(room);
    return { free: manual ? manual.free : (latestInspection === null || latestInspection === void 0 ? void 0 : latestInspection.occupied) === false ? true : (latestInspection === null || latestInspection === void 0 ? void 0 : latestInspection.occupied) === true ? false : undefined,
        source: manual, revision: manual ? manual.expectedRevision + 1 : 0 };
}
function dailyTasks(events, date) {
    return [...latestWork(events, "dailyTask").values()].filter(t => !t.deleted && t.date === date)
        .sort((a, b) => Number(a.done) - Number(b.done) || a.occurredAt.localeCompare(b.occurredAt) || a.targetId.localeCompare(b.targetId));
}
function familyComments(family, events) {
    const original = { type: "createWorkEvent", id: family.id, kind: "familyComment", targetId: family.id, expectedRevision: -1,
        room: family.room, date: family.date, actor: family.actor, notes: family.notes, occurredAt: "updatedAt" in family ? family.updatedAt : `${family.date}T00:00:00.000Z`, familyEventId: family.id };
    const history = events.filter(e => e.kind === "familyComment" && e.familyEventId === family.id);
    const latest = latestWork(history, "familyComment");
    if (family.notes && !latest.has(family.id))
        latest.set(family.id, original);
    return [...latest.values()].map(comment => ({ ...comment,
        revisions: [...(comment.targetId === family.id && family.notes ? [original] : []), ...history.filter(e => e.targetId === comment.targetId)].sort((a, b) => a.expectedRevision - b.expectedRevision),
    })).sort((a, b) => b.date.localeCompare(a.date) || b.occurredAt.localeCompare(a.occurredAt));
}

return exports;
})();
// END GENERATED WORK EVENTS
