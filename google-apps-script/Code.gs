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
    if (!['commit', 'commitIssueV2', 'commitIssueV3', 'commitEntry', 'commitRoomInspection', 'commitRoomInspectionV2', 'commitRoomInspectionV3', 'commitWorkEvent', 'commitCafardFollowupV2', 'commitLaundryCycle', 'commitLaundryCycleV2'].includes(input.action)) throw new Error('Action invalide.');
    lock = LockService.getScriptLock();
    lock.waitLock(20000);
    const isLaundry = input.action === 'commitLaundryCycle' || input.action === 'commitLaundryCycleV2';
    const isRoom = input.action === 'commitRoomInspection' || input.action === 'commitRoomInspectionV2' || input.action === 'commitRoomInspectionV3';
    const isCafard = input.action === 'commitCafardFollowupV2';
    const isEntry = input.action === 'commitEntry' || isRoom || input.action === 'commitWorkEvent' || isCafard || isLaundry;
    if (['commitIssueV2', 'commitIssueV3'].includes(input.action) && input.collection !== 'issues') throw new Error('Collection invalide.');
    if (input.collection === 'issues' && input.record && input.record.problemType !== undefined && input.action !== 'commitIssueV3') throw new Error('Utilisez commitIssueV3.');
    if (input.collection === 'roomInspections' && input.record && input.record.problemDetails !== undefined && input.action !== 'commitRoomInspectionV3') throw new Error('Utilisez commitRoomInspectionV3.');
    if (isCafard && (input.collection !== 'workEvents' || !input.record || input.record.kind !== 'cafardFollowup')) throw new Error('Suivi des cafards invalide.');
    if (input.collection === 'workEvents' && input.record && input.record.cafardObservationId !== undefined && !isCafard) throw new Error('Utilisez commitCafardFollowupV2.');
    if (input.action === 'commitWorkEvent' && input.collection !== 'workEvents') throw new Error('Collection invalide.');
    if (isLaundry && (input.collection !== 'workEvents' || !input.record || input.record.kind !== 'laundryCycle')) throw new Error('Cycle de lingerie invalide.');
    if (input.collection === 'workEvents' && input.record && input.record.kind === 'laundryCycle' && !isLaundry) throw new Error('Utilisez commitLaundryCycleV2.');
    // Old clients keep their original payloads, while plans and extensions must
    // use a versioned action that an old deployment rejects before writing.
    if (input.action === 'commitLaundryCycle' && (input.record.laundryEndsAt !== undefined || input.record.laundryAddedMinutes !== undefined)) throw new Error('Utilisez commitLaundryCycleV2.');
    if (isRoom && input.collection !== 'roomInspections') throw new Error('Collection invalide.');
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
        if (migrated) {
          // This inspection was already accepted before a decision was stored.
          // Its retry is a receipt, not a new opportunity to create a repair
          // under today's matching rules or to validate a now-stale link.
          current.issueSyncVersion = 2; current.createdIssue = !!previous;
          current.relatedIssueIds = current.relatedIssueIds || [];
          current.newIssueFindingKeys = previous ? (previous.roomFindings || []).map(f => f.key) : [];
        }
        input.issue = RoomIssueMatching.prepareRoomIssue(input.issue, current, records_('issues'));
        if (migrated) writeRecord_('roomInspections', current, true, current);
      }
      return json_({ ok: true, data: { collection: input.collection, record: current, issue: syncRoomIssue_(input, current) } });
    }
    if ((current ? current.version : 0) !== input.expectedVersion) return json_({ ok: false, code: 409, error: 'Modifié par un autre utilisateur. Actualisez avant de réessayer.' });
    if (input.collection === 'inspections' && current && current.completed) throw new Error('Ronde déjà terminée.');
    if (input.collection === 'issues' && RoomIssueMatching.shouldCheckIssueDuplicate(record, current)) {
      if (RoomIssueMatching.isCafardTechnicalReport(record) && (!current || current.status === 'resolu' || !RoomIssueMatching.isCafardTechnicalReport(current)))
        return json_({ ok: false, code: 409, error: RoomIssueMatching.cafardTechnicalReportMessage() });
      const duplicate = RoomIssueMatching.findDuplicateOpenIssue(record, records);
      if (duplicate) return json_({ ok: false, code: 409, error: RoomIssueMatching.duplicateRoomIssueMessage(duplicate) });
    }
    if (input.collection === 'workEvents') {
      const observations = record.kind === 'cafardFollowup' && record.cafardObservationId !== undefined ? records_('roomInspections') : [];
      const conflict = WorkLogic.validateWorkEntry(record, records, records_('familyEvents'), deletedAbsences_(), observations);
      if (conflict) return json_({ ok: false, code: 409, error: conflict });
    }
    if (input.collection === 'roomInspections') {
      const conflict = RoomIssueMatching.validateRoomIssuePlan(input.issue, record, records_('issues'));
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
        const end = cycle ? Date.parse(WorkLogic.getLaundryEndsAt(cycle)) : NaN;
        const begins = request.stage === 'soon' ? end - 10 * 60000 : end;
        const expires = request.stage === 'soon' ? end : end + 15 * 60000;
        const requestedExpiry = Date.parse(request.expiresAt);
        if (!Number.isFinite(end) || now < begins || now >= expires || requestedExpiry <= now || requestedExpiry !== expires) continue;
        if (request.stage === 'soon' && cycle.laundryAddedMinutes !== undefined && Date.parse(cycle.occurredAt) > begins) continue;
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
var ProblemPresets = (function () {
var exports = {};
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.problemPresets = void 0;
exports.getProblemPreset = getProblemPreset;
exports.problemPresetsForCheck = problemPresetsForCheck;
exports.problemPresets = [
    { id: "electrical_socket", label: "Prise électrique cassée ou mal fixée", category: "Électricité", checkKeys: ["damage"] },
    { id: "heater_fault", label: "Chauffage / radiateur en panne", category: "Équipements", checkKeys: ["damage"] },
    { id: "water_leak", label: "Fuite d’eau", category: "Plomberie", checkKeys: ["leaks"] },
    { id: "toilet_seat", label: "Abattant WC cassé ou mal fixé", category: "Plomberie", checkKeys: ["damage"] },
    { id: "toilet_flush", label: "Chasse d’eau / bouton défectueux", category: "Plomberie", checkKeys: ["damage"] },
    { id: "electrical_switch", label: "Interrupteur défectueux", category: "Électricité", checkKeys: ["switches"] },
    { id: "tap_fault", label: "Robinet / mitigeur défectueux", category: "Plomberie", checkKeys: ["taps"] },
    { id: "window_fault", label: "Fenêtre qui ferme mal ou défectueuse", category: "Bâtiment", checkKeys: ["window"] },
    { id: "lighting_fault", label: "Éclairage / ampoule défectueux", category: "Électricité", checkKeys: ["lights"] },
    { id: "heater_loose", label: "Radiateur détaché ou mal fixé", category: "Équipements", checkKeys: ["damage"] },
    { id: "radiator_obstructed", label: "Radiateur caché ou encombré", category: "Équipements", checkKeys: ["radiator_clear"] },
    { id: "drain_blocked", label: "Douche / évacuation bouchée", category: "Plomberie", checkKeys: ["damage", "taps"] },
    { id: "door_damage", label: "Porte endommagée", category: "Bâtiment", checkKeys: ["damage"] },
    { id: "smoke_detector", label: "Détecteur de fumée défectueux", category: "Sécurité incendie", checkKeys: ["smoke"] },
    // A minibar answer remains in the inspection; it never creates an automatic issue.
    { id: "fridge_fault", label: "Réfrigérateur en panne", category: "Équipements", checkKeys: [] },
    { id: "other", label: "Autre problème", category: "Autre", checkKeys: ["taps", "switches", "leaks", "lights", "smoke", "damage", "window", "radiator_clear"] },
];
function getProblemPreset(id) {
    return exports.problemPresets.find(preset => preset.id === id);
}
function problemPresetsForCheck(key) {
    return exports.problemPresets.filter(preset => preset.checkKeys.includes(key));
}

return exports;
})();
var RoomIssueMatching = (function () {
var exports = {};
function require(name) { if (name === "./problemPresets") return ProblemPresets; throw new Error("Unknown shared module: " + name); }
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeIssueText = normalizeIssueText;
exports.issueRoom = issueRoom;
exports.openRoomIssues = openRoomIssues;
exports.matchesRoomFinding = matchesRoomFinding;
exports.findDuplicateOpenIssue = findDuplicateOpenIssue;
exports.duplicateRoomIssueMessage = duplicateRoomIssueMessage;
exports.isCafardTechnicalReport = isCafardTechnicalReport;
exports.cafardTechnicalReportMessage = cafardTechnicalReportMessage;
exports.shouldCheckIssueDuplicate = shouldCheckIssueDuplicate;
exports.planRoomIssue = planRoomIssue;
exports.validateRoomIssuePlan = validateRoomIssuePlan;
exports.prepareRoomIssue = prepareRoomIssue;
const problemPresets_1 = require("./problemPresets");
function normalizeIssueText(text) {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
        .replace(/\b(?:chaffauge|cheffauge)\b/g, "chauffage")
        .replace(/\babbatant\b/g, "abattant")
        .replace(/\bbutton\b/g, "bouton")
        .replace(/\bfrigobar\b/g, "minibar");
}
function issueRoom(issue) {
    if (issue.room)
        return issue.room;
    const location = normalizeIssueText(issue.location || "");
    if (/^\d{3}$/.test(location))
        return location;
    const matches = [...location.matchAll(/\b(?:chambre|ch)\s*(?:n(?:o|umero)?\s*)?(\d{3})\b/g)];
    return matches.length === 1 && (location.match(/\d{3,}/g) || []).length === 1 ? matches[0][1] : undefined;
}
function openRoomIssues(issues, room) {
    return issues.filter(issue => issue.status !== "resolu" && issueRoom(issue) === room);
}
const keywords = {
    electrical_socket: /\bprises?\b/,
    heater: /\b(chauffage\w*|radiateur\w*)\b/,
    toilet_seat: /\babattants?\b/,
    toilet_flush: /\b(chasse(?: d eau)?|bouton\w* (?:du |de la |de )?(?:toilette\w*|wc))\b/,
    drain: /\b(evacuation\w*|canalisation\w*|siphon\w*|douche\w*)\b/,
    door_damage: /\bporte\w*\b/,
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
function inferredProblemTypes(text) {
    const value = normalizeIssueText(text), types = [];
    const has = (pattern) => pattern.test(value);
    const loose = /\b(detache\w*|descelle\w*|mal fixe\w*|fixation\w*)\b/;
    const obstructed = /\b(cache[es]*|recouvert[es]*|obstrue[es]*|encombre[es]*)\b/;
    const negativeObstruction = /\b(pas|non|jamais|plus)(?: \w+){0,2} (cache[es]*|recouvert[es]*|obstrue[es]*|encombre[es]*)\b/;
    if (has(keywords.electrical_socket))
        types.push("electrical_socket");
    if (has(keywords.heater)) {
        if (has(loose))
            types.push("heater_loose");
        if (has(obstructed) && !has(negativeObstruction))
            types.push("radiator_obstructed");
        if (has(/\b(panne|hs|defectueu\w*|froid\w*|ne chauffe (?:pas|plus)|ne (?:fonctionne|marche) (?:pas|plus))\b/) ||
            (!has(loose) && !has(obstructed) && has(/\b(casse\w*|probleme)\b/)))
            types.push("heater_fault");
    }
    if (has(keywords.leaks))
        types.push("water_leak");
    if (has(keywords.toilet_seat))
        types.push("toilet_seat");
    if (has(keywords.toilet_flush))
        types.push("toilet_flush");
    if (has(keywords.switches))
        types.push("electrical_switch");
    if (has(keywords.taps))
        types.push("tap_fault");
    if (has(keywords.window))
        types.push("window_fault");
    if (has(keywords.lights))
        types.push("lighting_fault");
    if (has(keywords.drain) && has(/\b(bouche\w*|bloque\w*|engorge\w*)\b/))
        types.push("drain_blocked");
    if (has(keywords.door_damage) && has(/\b(casse\w*|abime\w*|endommage\w*)\b/))
        types.push("door_damage");
    if (has(keywords.smoke))
        types.push("smoke_detector");
    if (has(keywords.fridge) && has(/\b(panne|hs|defectueu\w*|casse\w*|refroid\w*|ne (?:fonctionne|marche) (?:pas|plus))\b/))
        types.push("fridge_fault");
    return types;
}
function findingText(finding) {
    return [finding.label, finding.description].filter(Boolean).join(" ");
}
function typedFindingMatches(issue, finding) {
    const type = finding.problemType;
    const text = findingText(finding);
    const existingText = `${issue.title || ""} ${issue.description || ""}`;
    if (type === "other")
        return !!finding.description && sameManualProblem({ location: issue.location, title: "", description: finding.description }, issue);
    const explicit = issue.problemType && issue.problemType !== "other" ? issue.problemType : undefined;
    const existingTypes = explicit ? [explicit] : inferredProblemTypes(existingText);
    if (!type || !existingTypes.includes(type))
        return false;
    if (differentDetails(text, existingText))
        return false;
    // A selected type is a useful suggestion, but never sufficient on its own
    // to silently combine two repairs. planRoomIssue asks for confirmation when
    // there is no precise description identifying the same fitting.
    return true;
}
function matchesRoomFinding(issue, finding) {
    var _a, _b, _c;
    if (finding.problemType) {
        if ((_a = issue.roomFindings) === null || _a === void 0 ? void 0 : _a.length)
            return issue.roomFindings.some(item => {
                if (!item.problemType)
                    return typedFindingMatches({ ...issue, roomFindings: undefined }, finding);
                return typedFindingMatches({ ...issue, problemType: item.problemType, title: "", description: findingText(item), roomFindings: undefined }, finding);
            });
        return typedFindingMatches(issue, finding);
    }
    if (finding.key === "damage") {
        if (meaningful(finding.description || ""))
            return sameManualProblem({ location: issue.location, title: "", description: finding.description }, issue);
        // "Rien de cassé : Problème" does not identify an object. It can suggest
        // existing room repairs for a human choice, but can never auto-link one.
        return !isCafardTechnicalReport(issue);
    }
    if ((_b = issue.roomFindings) === null || _b === void 0 ? void 0 : _b.length)
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
    return ((_c = keywords[finding.key]) === null || _c === void 0 ? void 0 : _c.test(text)) || false;
}
const genericText = /^(?:chambre\s+\d{3}\s*)?(?:probleme(?: constate| technique)?|anomalie|a verifier|a reparer|voir (?:la )?photo|voir sur place|test)$/;
const failureKinds = [
    ["missing", /\b(absent\w*|manquant\w*|manque)\b/],
    ["obstructed", /\b(cache[es]*|recouvert[es]*|obstrue[es]*|encombre[es]*)\b/],
    ["leak", /\b(fuite\w*|fuit|infiltr\w*)\b/],
    ["failure", /\b(panne|hs|defectueu\w*|grille[es]*|ne (?:\w+ ){0,2}(?:fonctionne|marche) (?:pas|plus))\b/],
    ["broken", /\b(casse[es]*|abime[es]*|endommage[es]*)\b/],
    ["loose", /\b(detache\w*|descelle\w*|mal fixe\w*)\b/],
    ["blocked", /\b(bouche[es]*|bloque[es]*|coince[es]*|ne (?:\w+ ){0,2}ferme (?:pas|plus))\b/],
];
function differentDetails(left, right) {
    const a = normalizeIssueText(left), b = normalizeIssueText(right);
    for (const dimension of [["gauche", "droite"], ["haut", "bas"]]) {
        const sidesA = dimension.filter(side => new RegExp(`\\b${side}\\b`).test(a));
        const sidesB = dimension.filter(side => new RegExp(`\\b${side}\\b`).test(b));
        if (sidesA.length && sidesB.length && !sidesA.some(side => sidesB.includes(side)))
            return true;
    }
    // Named positions and components are evidence of different fittings; a
    // common "damage" key, preset or room number is never such evidence.
    const positions = (text) => text.match(/\b(douche|lavabo|wc|entree|plafond|chevet|fenetre|television|lit|gauche|droite|bureau|evier)\b/g) || [];
    const locationsA = positions(a), locationsB = positions(b);
    if (locationsA.length && locationsB.length && !locationsA.some(position => locationsB.includes(position)))
        return true;
    const components = (text) => text.match(/\b(bec|flexible|poignee|joint|fixation|bouton|vitre)\b/g) || [];
    const partsA = components(a), partsB = components(b);
    if (partsA.length && partsB.length && !partsA.some(part => partsB.includes(part)))
        return true;
    const failuresA = failureKinds.filter(([, pattern]) => pattern.test(a)).map(([kind]) => kind);
    const failuresB = failureKinds.filter(([, pattern]) => pattern.test(b)).map(([kind]) => kind);
    return !!(failuresA.length && failuresB.length && !failuresA.some(kind => failuresB.includes(kind)));
}
function meaningful(value) {
    const text = normalizeIssueText(value || "").replace(/^chambre\s+\d{3}\s+/, "");
    return text.length >= 8 && !genericText.test(text) ? text : "";
}
function sameManualProblem(candidate, existing) {
    const left = normalizeIssueText(`${candidate.title || ""} ${candidate.description || ""}`);
    const right = normalizeIssueText(`${existing.title || ""} ${existing.description || ""}`);
    if (candidate.problemType && existing.problemType && candidate.problemType !== "other" && existing.problemType !== "other" && candidate.problemType !== existing.problemType)
        return false;
    if (differentDetails(left, right))
        return false;
    const leftFailures = failureKinds.filter(([, pattern]) => pattern.test(left)).map(([kind]) => kind);
    const rightFailures = failureKinds.filter(([, pattern]) => pattern.test(right)).map(([kind]) => kind);
    const description = meaningful(candidate.description), title = meaningful(candidate.title);
    if ((description && description === meaningful(existing.description)) || (title && title === meaningful(existing.title)))
        return true;
    if (!leftFailures.some(kind => rightFailures.includes(kind)))
        return false;
    // Paraphrases are matched only with both a named fitting and the same fault;
    // generic titles or a shared category alone must never hide another repair.
    const fittings = Object.entries(keywords).filter(([key]) => !["leaks", "bugs", "cleaning", "carpet", "heater"].includes(key));
    const typedA = inferredProblemTypes(left), typedB = inferredProblemTypes(right);
    if (typedA.some(type => ["heater_fault", "heater_loose", "radiator_obstructed"].includes(type) && typedB.includes(type)))
        return true;
    return fittings.some(([, pattern]) => pattern.test(left) && pattern.test(right));
}
/** A new or reopened report must not create another copy of an open room fault. */
function findDuplicateOpenIssue(candidate, issues) {
    const room = issueRoom(candidate);
    if (!room)
        return undefined;
    return openRoomIssues(issues, room).find(existing => {
        var _a, _b;
        if (candidate.id === existing.id)
            return false;
        const identified = (finding) => finding.key !== "damage" || !!finding.problemType || !!meaningful(finding.description || "");
        if ((_a = candidate.roomFindings) === null || _a === void 0 ? void 0 : _a.some(finding => identified(finding) && matchesRoomFinding(existing, finding)))
            return true;
        if ((_b = existing.roomFindings) === null || _b === void 0 ? void 0 : _b.some(finding => identified(finding) && matchesRoomFinding(candidate, finding)))
            return true;
        return sameManualProblem(candidate, existing);
    });
}
function duplicateRoomIssueMessage(issue) {
    return `Un problème identique est déjà ouvert dans la chambre ${issueRoom(issue)} : ${issue.title}. Ouvrez ce signalement pour le mettre à jour.`;
}
/** Only an unambiguous pest report is routed away from technical repairs. */
function isCafardTechnicalReport(candidate) {
    const pests = /\b(?:cafards?|blattes?)\b/;
    const clauses = (text) => text.split(/[.!?;,\n]+|\bmais\b|\bet\s+(?=(?:des?\s+)?(?:cafards?|blattes?)\b)/i).map(normalizeIssueText).filter(Boolean);
    const description = clauses(candidate.description || "");
    // A precise negative observation takes precedence over a generic title.
    const observations = description.some(text => pests.test(text)) ? description : clauses(candidate.title || "");
    const positive = observations.some(text => pests.test(text) &&
        !/\b(?:aucuns?|sans)\s+(?:cafards?|blattes?)\b/.test(text) &&
        !/\b(?:aucune|absence de)\s+(?:(?:presence|traces?|signes?)\s+de\s+)?(?:cafards?|blattes?)\b/.test(text) &&
        !/\bpas\s+(?:du tout\s+)?de\s+(?:cafards?|blattes?)\b/.test(text) &&
        !/\b(?:ne|n)\s+(?:\w+\s+){0,4}plus\s+de\s+(?:cafards?|blattes?)\b/.test(text) &&
        !/\b(?:cafards?|blattes?)\s+(?:(?:ne|n)\s+(?:\w+\s+){0,3}plus|non|pas)\s+(?:presents?|detectes?|observes?|trouves?)\b/.test(text) &&
        !/\b(?:cafards?|blattes?)\s+(?:sont\s+)?absents?\b/.test(text) &&
        !/\b(?:a verifier|a controler|verifier si|controler si|voir si|s il|si les|si des|si aucun)\b/.test(text) &&
        !(/\b(?:gel|produit|insecticide)\b/.test(text) && /\b(?:applique\w*|application\w*|pulveris\w*)\b/.test(text) &&
            !/\b(?:presence|presents?|detectes?|observes?|trouves?|continuent|persistent)\b/.test(text)));
    if (!positive)
        return false;
    if (candidate.problemType && candidate.problemType !== "other")
        return false;
    // A fitting can merely locate pests ("cafards près du robinet"). It is a
    // technical repair only when a fault is actually described on that fitting.
    const technical = clauses(`${candidate.title || ""}. ${candidate.description || ""}`).some(text => inferredProblemTypes(text).length > 0 &&
        !/\b(?:pas de|aucune?|sans)\s+(?:fuite\w*|panne\w*|probleme\w*)\b/.test(text) &&
        (failureKinds.some(([, pattern]) => pattern.test(text)) || /\b(?:froid|ne chauffe (?:pas|plus))\b/.test(text) ||
            (!pests.test(text) && /\bprobleme\b/.test(text))));
    return !technical;
}
function cafardTechnicalReportMessage() {
    return "Pour les cafards, choisissez la chambre dans le menu Suivi des cafards : elle y garde un seul suivi, avec ses traitements et ses vérifications.";
}
/** Existing duplicate history can still be progressed or resolved, never erased. */
function shouldCheckIssueDuplicate(candidate, current) {
    return candidate.status !== "resolu" && (!current || current.status === "resolu" ||
        issueRoom(candidate) !== issueRoom(current) || normalizeIssueText(candidate.title || "") !== normalizeIssueText(current.title || "") ||
        normalizeIssueText(candidate.description || "") !== normalizeIssueText(current.description || "") || candidate.problemType !== current.problemType);
}
function exactTypedDescription(issue, finding) {
    var _a;
    const detail = meaningful(finding.description || "");
    if (!detail)
        return false;
    return detail === meaningful(issue.description || "") ||
        !!((_a = issue.roomFindings) === null || _a === void 0 ? void 0 : _a.some(item => item.problemType === finding.problemType && detail === meaningful(item.description || "")));
}
/** A preview never throws; write boundaries reject conflicts before any photos or rows are written. */
function planRoomIssue(candidate, record, issues) {
    var _a;
    const conflicts = [], requiresChoice = [];
    const findings = (candidate === null || candidate === void 0 ? void 0 : candidate.roomFindings) || [];
    const links = record.issueLinks || [];
    for (const link of links) {
        if (links.filter(item => item.key === link.key).length > 1) {
            conflicts.push("Choisissez un seul problème existant par équipement.");
            continue;
        }
        if (!findings.some(finding => finding.key === link.key)) {
            conflicts.push("Le problème associé ne correspond plus à un équipement signalé dans ce contrôle. Vérifiez votre sélection.");
            continue;
        }
        const existing = issues.find(issue => issue.id === link.issueId);
        if (!existing || existing.status === "resolu" || issueRoom(existing) !== record.room)
            conflicts.push("Le problème associé a été résolu, déplacé ou supprimé. Actualisez puis choisissez un problème encore ouvert dans cette chambre.");
    }
    if (!candidate)
        return { issue: undefined, relatedIssueIds: [], conflicts, requiresChoice };
    const open = openRoomIssues(issues, record.room);
    const related = new Set();
    const remaining = findings.filter(finding => {
        var _a, _b;
        // Older queued drafts may still carry distinctProblemKeys. They cannot
        // bypass the single open follow-up for the same room checklist finding.
        const explicit = (_a = record.issueLinks) === null || _a === void 0 ? void 0 : _a.find(link => link.key === finding.key);
        if (explicit) {
            const existing = open.find(issue => explicit.issueId === issue.id);
            if (existing) {
                related.add(existing.id);
                return false;
            }
            return true; // A stale link must never silently create a replacement.
        }
        const matching = open.filter(issue => matchesRoomFinding(issue, finding));
        if (matching.length > 1 || (matching.length === 1 && ((finding.problemType && !exactTypedDescription(matching[0], finding)) ||
            (finding.key === "damage" && !finding.problemType && !meaningful(finding.description || ""))))) {
            requiresChoice.push(finding.key);
            conflicts.push(`Un problème similaire est déjà ouvert pour « ${((_b = (0, problemPresets_1.getProblemPreset)(finding.problemType)) === null || _b === void 0 ? void 0 : _b.label) || finding.label} ». Choisissez le signalement à réutiliser ou précisez un problème différent.`);
            return true;
        }
        if (matching.length === 1) {
            related.add(matching[0].id);
            return false;
        }
        return true;
    });
    if (conflicts.length || (((_a = candidate.roomFindings) === null || _a === void 0 ? void 0 : _a.length) && !remaining.length))
        return { issue: undefined, relatedIssueIds: [...related], conflicts, requiresChoice };
    const issue = { ...candidate, roomFindings: remaining,
        description: remaining.length ? [...remaining.map(finding => finding.label), ...(record.notes && !remaining.some(f => f.label === record.notes) ? [record.notes] : [])].join("\n").slice(0, 4000) : candidate.description };
    if (isCafardTechnicalReport(issue))
        conflicts.push(cafardTechnicalReportMessage());
    return { issue: conflicts.length ? undefined : issue, relatedIssueIds: [...related], conflicts, requiresChoice };
}
function validateRoomIssuePlan(candidate, record, issues) {
    return planRoomIssue(candidate, record, issues).conflicts[0];
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
    if (plan.conflicts.length)
        throw new Error(plan.conflicts[0]);
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
exports.getLaundryEndsAt = getLaundryEndsAt;
exports.validateLaundryEntry = validateLaundryEntry;
exports.latestWork = latestWork;
exports.latestCafardObservationId = latestCafardObservationId;
exports.validateWorkEntry = validateWorkEntry;
exports.roomAvailability = roomAvailability;
exports.dailyTasks = dailyTasks;
exports.familyComments = familyComments;
// The visible numbers match the physical labels. Washers and dryers have
// distinct IDs so a cycle can never reserve the wrong kind of appliance.
exports.laundryMachines = [
    { id: "washer-1", label: "Machine à laver 1", kind: "washer", capacityKg: 18, durationMinutes: 44, program: "Rapide 40" },
    { id: "washer-2", label: "Machine à laver 2", kind: "washer", capacityKg: 8, durationMinutes: 38, program: "Rapide 30" },
    { id: "washer-3", label: "Machine à laver 3", kind: "washer", capacityKg: 8, durationMinutes: 38, program: "Rapide 30" },
    { id: "dryer-1", label: "Machine à sécher 1", kind: "dryer", capacityKg: null, durationMinutes: 80, program: "Séchage · 1 h 20" },
    { id: "dryer-2", label: "Machine à sécher 2", kind: "dryer", capacityKg: null, durationMinutes: 80, program: "Séchage · 1 h 20" },
    { id: "dryer-3", label: "Machine à sécher 3", kind: "dryer", capacityKg: null, durationMinutes: 80, program: "Séchage · 1 h 20" },
];
function getLaundryMachine(id) {
    return exports.laundryMachines.find(machine => machine.id === id);
}
// Persisted planned ends are authoritative. Older events did not store one, so
// keep their original 40/30/80-minute timing even when new machine defaults change.
function getLaundryEndsAt(record) {
    const machine = getLaundryMachine(record.targetId), started = Date.parse(record.laundryStartedAt || "");
    if (!machine || !Number.isFinite(started))
        return undefined;
    if (record.laundryEndsAt !== undefined) {
        const end = Date.parse(record.laundryEndsAt);
        return Number.isFinite(end) && end > started ? new Date(end).toISOString() : undefined;
    }
    const originalMinutes = machine.id === "washer-1" ? 40 : machine.kind === "washer" ? 30 : 80;
    return new Date(started + originalMinutes * 60000).toISOString();
}
// This validator is bundled unchanged into Apps Script, inside its write lock.
// Reaching the scheduled end does not release a machine: the clothes stay there
// until an operator explicitly records their removal or cancels the cycle.
function validateLaundryEntry(entry, events, current) {
    const machine = getLaundryMachine(entry.targetId);
    if (!machine || !entry.room || !entry.laundryCycleId || !entry.laundryStartedAt ||
        !entry.laundryStatus || !["en_cours", "recupere", "annule"].includes(entry.laundryStatus))
        return "Renseignez la machine, la chambre et le cycle de linge.";
    const started = Date.parse(entry.laundryStartedAt), occurred = Date.parse(entry.occurredAt);
    if (!Number.isFinite(started) || !Number.isFinite(occurred) || occurred < started)
        return "La mise à jour du linge doit suivre le démarrage du cycle.";
    const added = entry.laundryAddedMinutes;
    if (added !== undefined && (!Number.isInteger(added) || added < 1 || added > 120))
        return "Ajoutez entre 1 et 120 minutes entières.";
    if (!getLaundryEndsAt(entry))
        return "L’heure de fin prévue doit suivre le démarrage du cycle.";
    if (added !== undefined && (entry.laundryStatus !== "en_cours" || !entry.laundryEndsAt))
        return "Seul un cycle en cours peut être prolongé avec une nouvelle heure de fin.";
    if (entry.laundryStatus === "recupere") {
        if (!entry.laundryCollectedAt || entry.laundryCollectedAt !== entry.occurredAt || entry.laundryCollectedBy !== entry.actor)
            return "La récupération doit indiquer sa date, son heure et la personne qui l’enregistre.";
    }
    else if (entry.laundryCollectedAt !== null || entry.laundryCollectedBy !== "") {
        return "Un cycle non récupéré ne peut pas avoir de date ou de responsable de récupération.";
    }
    if (entry.laundryStatus === "en_cours" && added === undefined) {
        if ((current === null || current === void 0 ? void 0 : current.laundryStatus) === "en_cours")
            return "Cette machine contient déjà du linge. Confirmez sa récupération avant de démarrer un autre cycle.";
        if (events.some(event => event.kind === "laundryCycle" && event.laundryCycleId === entry.laundryCycleId))
            return "Ce cycle de linge existe déjà. Utilisez un nouveau cycle.";
        if (entry.laundryStartedAt !== entry.occurredAt)
            return "Le démarrage du cycle doit correspondre à l’heure de cette action.";
        if (current && occurred < Date.parse(current.occurredAt))
            return "Le nouveau cycle ne peut pas commencer avant la libération de la machine.";
        if (entry.laundryEndsAt !== undefined && Date.parse(entry.laundryEndsAt) !== started + machine.durationMinutes * 60000)
            return "Le nouveau cycle doit utiliser la durée prévue pour cette machine.";
        return undefined;
    }
    if (!current || current.laundryStatus !== "en_cours" || current.laundryCycleId !== entry.laundryCycleId)
        return "Ce cycle n’est plus en cours sur cette machine. Actualisez la lingerie.";
    if (entry.room !== current.room || entry.laundryStartedAt !== current.laundryStartedAt ||
        (entry.laundryOwner || "") !== (current.laundryOwner || ""))
        return "Le cycle doit conserver sa chambre, son propriétaire et son heure de démarrage.";
    if (occurred < Date.parse(current.occurredAt))
        return "Cette action doit suivre la dernière mise à jour du cycle.";
    const currentEnd = getLaundryEndsAt(current);
    if (!currentEnd)
        return "L’heure de fin de ce cycle est invalide. Actualisez la lingerie.";
    if (added !== undefined) {
        if (Date.parse(entry.laundryEndsAt) !== Math.max(Date.parse(currentEnd), occurred) + added * 60000)
            return "La nouvelle fin doit ajouter les minutes demandées au temps restant, ou à l’heure actuelle si le délai est dépassé.";
    }
    else if (entry.laundryEndsAt !== undefined && Date.parse(entry.laundryEndsAt) !== Date.parse(currentEnd)) {
        return "La récupération ou l’annulation doit conserver l’heure de fin prévue.";
    }
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
/** Include the observation identity, not only its day, in cafard form concurrency. */
function latestCafardObservationId(inspections, room) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
    let latest;
    for (const record of inspections) {
        if (record.room !== room || record.bugs !== "oui")
            continue;
        const at = record.inspectedAt ? new Date(record.inspectedAt) : null;
        const instant = at && Number.isFinite(at.getTime()) && day.format(at) === record.date ? at.toISOString() : "";
        const order = record.date + "|" + instant + "|" + record.id;
        if (!latest || order > latest.order)
            latest = { id: record.id, order };
    }
    return (latest === null || latest === void 0 ? void 0 : latest.id) || null;
}
function validateWorkEntry(entry, events, families, deletedFamilies = [], inspections = []) {
    const current = latestWork(events, entry.kind).get(entry.targetId);
    if ((current ? current.expectedRevision + 1 : 0) !== entry.expectedRevision)
        return "Ce suivi a été modifié ailleurs. Actualisez, annulez la modification en attente puis recommencez.";
    if (current === null || current === void 0 ? void 0 : current.deleted)
        return "Cette tâche a déjà été supprimée.";
    if (entry.kind === "cafardFollowup" && entry.cafardObservationId !== undefined &&
        entry.cafardObservationId !== latestCafardObservationId(inspections, entry.room))
        return "Une nouvelle détection de cafards a été enregistrée dans cette chambre. Actualisez puis ouvrez son suivi existant avant de le mettre à jour.";
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
