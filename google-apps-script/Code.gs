// Hôtel Contrôle — paste into the Apps Script project bound to your spreadsheet.
// Run setup() once, then deploy as a web app. Never put API_TOKEN in client code.
const SPREADSHEET_ID = '1mF0nUV0FihRnNJD0V6KnK7iJAjUleksrW-sPZvSd61I';
const TABLES = { issues: 'Anomalies', inspections: 'Rondes' };
const HEADERS = ['ID', 'Version', 'Date', 'Lieu / zone', 'Titre / inspecteur', 'Statut', 'Priorité', 'Responsable', 'Photo Drive', 'Modifié le'].concat(Array.from({length: 12}, (_, i) => 'Données ' + (i + 1)));

function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('API_TOKEN')) props.setProperty('API_TOKEN', Utilities.getUuid() + Utilities.getUuid());
  if (!props.getProperty('PHOTO_FOLDER_ID')) props.setProperty('PHOTO_FOLDER_ID', DriveApp.createFolder('Hôtel Contrôle - Photos privées').getId());
  Object.keys(TABLES).forEach(table_);
  // Retrieve API_TOKEN from Project Settings > Script properties, not public logs.
}
function table_(collection) {
  const name = TABLES[collection];
  if (!name) throw new Error('Collection invalide.');
  const book = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = book.getSheetByName(name);
  if (!sheet) {
    sheet = book.insertSheet(name);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#153f37').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.hideColumns(11, 12);
  }
  if (sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0].join('|') !== HEADERS.join('|')) throw new Error('En-têtes incompatibles dans ' + name + '. Ne modifiez pas la structure.');
  return sheet;
}
function records_(collection) {
  const sheet = table_(collection);
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues().filter(row => row[0]).map(row => JSON.parse(row.slice(10).map(chunk => String(chunk).slice(1)).join('')));
}
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
// GET exposes only health. Private reads use POST so the API token stays out of URLs.
function doGet() { return json_({ ok: true, service: 'Hôtel Contrôle', version: 2 }); }
function doPost(e) {
  let lock;
  try {
    if (!e || !e.postData || e.postData.contents.length > 9000000) throw new Error('Requête invalide.');
    const input = JSON.parse(e.postData.contents);
    const token = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if (!token || input.token !== token) return json_({ ok: false, code: 401, error: 'Accès refusé.' });
    if (input.action === 'list') return json_({ ok: true, data: { issues: records_('issues'), inspections: records_('inspections'), maxIssuePhotos: 3 } });
    if (input.action === 'photo') {
      const issue = records_('issues').find(item => item.id === input.issueId);
      const photoIds = issue ? photoIds_(issue) : [];
      const index = input.index === undefined ? 0 : input.index;
      if (!Number.isInteger(index) || index < 0 || !photoIds[index]) return json_({ ok: false, code: 404, error: 'Photo introuvable.' });
      const file = DriveApp.getFileById(photoIds[index]);
      return json_({ ok: true, data: { base64: Utilities.base64Encode(file.getBlob().getBytes()) } });
    }
    if (input.action !== 'commit') throw new Error('Action invalide.');
    lock = LockService.getScriptLock();
    lock.waitLock(20000);
    const sheet = table_(input.collection);
    const record = input.record;
    if (!record || !/^[\da-f-]{36}$/i.test(record.id) || !Number.isInteger(input.expectedVersion) || record.version !== input.expectedVersion + 1) throw new Error('Enregistrement invalide.');
    const records = records_(input.collection);
    const current = records.find(item => item.id === record.id);
    if ((current ? current.version : 0) !== input.expectedVersion) return json_({ ok: false, code: 409, error: 'Modifié par un autre utilisateur. Actualisez avant de réessayer.' });
    if (input.collection === 'inspections' && current && current.completed) throw new Error('Ronde déjà terminée.');
    // The trusted Next.js server validates the full business schema before commit.
    // The token must only be shared with that server.
    if (input.collection === 'issues') {
      record.photoIds = current ? photoIds_(current) : [];
      const photos = (input.photoData ? [input.photoData] : []).concat(input.photosData || []);
      if (photos.length > 3 || photos.some(photo => typeof photo !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photo) || photo.length > 2800000)) throw new Error('Maximum 3 photos JPEG valides.');
      if (photos.length) {
        if (current) throw new Error('Photos déjà enregistrées.');
        const folderId = PropertiesService.getScriptProperties().getProperty('PHOTO_FOLDER_ID');
        const folder = DriveApp.getFolderById(folderId);
        // Deterministic name reuses a file left by a timed-out save.
        record.photoIds = photos.map((photo, index) => {
          const filename = record.id + '-' + index + '.jpg';
          const files = folder.getFilesByName(filename);
          return files.hasNext() ? files.next().getId() : folder.createFile(Utilities.newBlob(Utilities.base64Decode(photo.split(',')[1]), 'image/jpeg', filename)).getId();
        });
      }
      record.photoId = record.photoIds[0] || null;
    }
    const serialized = JSON.stringify(record);
    if (serialized.length > 420000) throw new Error('Historique trop volumineux.');
    const chunks = Array.from({length: 12}, (_, i) => serialized.slice(i * 35000, (i + 1) * 35000));
    const safe = value => { const str = String(value == null ? '' : value); return /^[=+\-@]/.test(str) ? "'" + str : str; };
    const row = [record.id, record.version, record.date, record.location || record.area, record.title || record.inspector, record.status || (record.completed ? 'Terminée' : 'Brouillon'), record.priority || '', record.assignee || '', photoIds_(record).map(id => 'https://drive.google.com/file/d/' + id + '/view').join('\n'), record.updatedAt].map(safe).concat(chunks.map(chunk => 'j' + chunk));
    const rowNumber = current ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().findIndex(row => row[0] === record.id) + 2 : sheet.getLastRow() + 1;
    sheet.getRange(rowNumber, 1, 1, HEADERS.length).setNumberFormat('@').setValues([row]);
    SpreadsheetApp.flush();
    return json_({ ok: true, data: { id: record.id, version: record.version } });
  } catch (error) { return json_({ ok: false, code: 400, error: String(error.message || error) }); }
  finally { if (lock && lock.hasLock()) lock.releaseLock(); }
}
function photoIds_(record) {
  return record.photoIds && record.photoIds.length ? record.photoIds : record.photoId ? [record.photoId] : [];
}
