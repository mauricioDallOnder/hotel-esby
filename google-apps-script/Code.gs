// Hôtel Contrôle — paste into the Apps Script project bound to your spreadsheet.
// Run setup() once, then deploy as a web app. Never put API_TOKEN in client code.
const SPREADSHEET_ID = '1mF0nUV0FihRnNJD0V6KnK7iJAjUleksrW-sPZvSd61I';
const TABLES = { issues: 'Anomalies', inspections: 'Rondes', familyEvents: 'Absences et départs', roomInspections: 'Contrôles chambres' };
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
  // The only supported upgrade appends the new check. Never shift old cells.
  if (collection === 'roomInspections' && existing.slice(0, -1).join('|') === headers.slice(0, -1).join('|') && !existing[headers.length - 1]) {
    sheet.getRange(1, headers.length, 1, 1).setValues([[headers[headers.length - 1]]]).setFontWeight('bold');
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
    if (input.action === 'list') return json_({ ok: true, data: { issues: records_('issues'), inspections: records_('inspections'), familyEvents: records_('familyEvents'), roomInspections: records_('roomInspections'), maxIssuePhotos: 3, entryVersion: 2, deletedFamilyEventIds: deletedAbsences_() } });
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
    if (input.action !== 'commit' && input.action !== 'commitEntry') throw new Error('Action invalide.');
    lock = LockService.getScriptLock();
    lock.waitLock(20000);
    const isEntry = input.action === 'commitEntry';
    if (isEntry && !['familyEvents', 'roomInspections'].includes(input.collection)) throw new Error('Collection invalide.');
    if (!isEntry && ['familyEvents', 'roomInspections'].includes(input.collection)) throw new Error('Utilisez commitEntry.');
    if (isEntry && (input.expectedVersion !== 0 || !/^[a-f0-9]{64}$/.test(input.record && input.record.submissionHash))) throw new Error('Enregistrement invalide.');
    const sheet = table_(input.collection);
    const record = input.record;
    if (!record || !/^[\da-f-]{36}$/i.test(record.id) || !Number.isInteger(input.expectedVersion) || record.version !== input.expectedVersion + 1) throw new Error('Enregistrement invalide.');
    const records = records_(input.collection);
    const current = records.find(item => item.id === record.id);
    if (input.collection === 'familyEvents' && deletedAbsences_().includes(record.id)) return json_({ ok: false, code: 409, error: 'Cette absence a été supprimée.' });
    if (isEntry && current && current.submissionHash === record.submissionHash) return json_({ ok: true, data: { collection: input.collection, record: current, issue: syncRoomIssue_(input, current) } });
    if ((current ? current.version : 0) !== input.expectedVersion) return json_({ ok: false, code: 409, error: 'Modifié par un autre utilisateur. Actualisez avant de réessayer.' });
    if (input.collection === 'inspections' && current && current.completed) throw new Error('Ronde déjà terminée.');
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
    if (isEntry) {
      const photos = photoIds_(record).map(id => 'https://drive.google.com/file/d/' + id + '/view').join('\n');
      const visible = collection === 'familyEvents'
        ? [record.id, record.version, record.date, record.room, record.family, record.kind === 'absence' ? 'Absence' : 'Départ', record.actor, record.notes, photos, record.updatedAt]
        : [record.id, record.version, record.date, record.room, record.actor, record.condition, record.cleaning, record.notes, photos, record.updatedAt];
      const extra = collection === 'familyEvents' ? [record.returnDate || ''] : [record.carpet, record.carpetNotes, record.microwave].concat(ROOM_CHECK_KEYS.map(key => { const check = record.checks.find(c => c.key === key); return check ? check.result : ''; }));
      row = visible.map(safe).concat(chunks.map(chunk => 'j' + chunk), extra.map(safe));
    }
    const rowNumber = current ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().findIndex(row => row[0] === record.id) + 2 : sheet.getLastRow() + 1;
    sheet.getRange(rowNumber, 1, 1, row.length).setNumberFormat('@').setValues([row]);
    SpreadsheetApp.flush();
}
function photoIds_(record) {
  return record.photoIds && record.photoIds.length ? record.photoIds : record.photoId ? [record.photoId] : [];
}

const ROOM_CHECK_KEYS = ['taps', 'switches', 'leaks', 'lights', 'smoke', 'damage', 'window', 'bed', 'mattress', 'fridge', 'door_handle_clear'];
function headers_(collection) {
  const data = HEADERS.slice(10);
  if (collection === 'familyEvents') return ['ID', 'Version', 'Date', 'Chambre', 'Famille', 'Événement', 'Signalé par', 'Observations', 'Photo Drive', 'Modifié le'].concat(data, ['Retour prévu']);
  if (collection === 'roomInspections') return ['ID', 'Version', 'Date', 'Chambre', 'Inspecteur', 'État', 'Ménage', 'Observations', 'Photo Drive', 'Modifié le'].concat(data, ['Moquette', 'Détail moquette', 'Micro-ondes', 'Robinets', 'Interrupteurs', 'Aucune fuite', 'Éclairage', 'Détecteur fumée', 'Rien de cassé', 'Fenêtre', 'Lit', 'Matelas', 'Minibar', 'Poignée dégagée']);
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
