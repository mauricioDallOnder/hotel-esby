// Hôtel Contrôle — paste into the Apps Script project bound to your spreadsheet.
// Run setup() once, then deploy as a web app. Never put API_TOKEN in client code.
//https://script.google.com/macros/s/AKfycby8og5t12Q7D9_Nspi-CPu0j5bXygWcoCqPKeOP0sMy5mrRvQPkMfUd96cucJqrT7Xg/exec
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
  // Append-only upgrades preserve existing columns and every historical row.
  if (collection === 'roomInspections') {
    const firstMissing = existing.findIndex(value => !value);
    if (firstMissing >= 0 && firstMissing >= headers.length - 2 && existing.slice(0, firstMissing).join('|') === headers.slice(0, firstMissing).join('|') && existing.slice(firstMissing).every(value => !value)) {
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
    if (input.action === 'list') return json_({ ok: true, data: { issues: records_('issues'), inspections: records_('inspections'), familyEvents: records_('familyEvents'), roomInspections: records_('roomInspections'), maxIssuePhotos: 3, entryVersion: 3, deletedFamilyEventIds: deletedAbsences_() } });
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
    if (input.action !== 'commit' && input.action !== 'commitEntry' && input.action !== 'commitRoomInspection') throw new Error('Action invalide.');
    lock = LockService.getScriptLock();
    lock.waitLock(20000);
    const isEntry = input.action === 'commitEntry' || input.action === 'commitRoomInspection';
    if (input.action === 'commitRoomInspection' && input.collection !== 'roomInspections') throw new Error('Collection invalide.');
    if (isEntry && !['familyEvents', 'roomInspections'].includes(input.collection)) throw new Error('Collection invalide.');
    if (!isEntry && ['familyEvents', 'roomInspections'].includes(input.collection)) throw new Error('Utilisez commitEntry.');
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

const ROOM_CHECK_KEYS = ['taps', 'switches', 'leaks', 'lights', 'smoke', 'damage', 'window', 'bed', 'mattress', 'fridge', 'door_handle_clear', 'door_closer'];
function headers_(collection) {
  const data = HEADERS.slice(10);
  if (collection === 'familyEvents') return ['ID', 'Version', 'Date', 'Chambre', 'Famille', 'Événement', 'Signalé par', 'Observations', 'Photo Drive', 'Modifié le'].concat(data, ['Retour prévu']);
  if (collection === 'roomInspections') return ['ID', 'Version', 'Date', 'Chambre', 'Inspecteur', 'État', 'Ménage', 'Observations', 'Photo Drive', 'Modifié le'].concat(data, ['Moquette', 'Détail moquette', 'Micro-ondes', 'Robinets', 'Interrupteurs', 'Aucune fuite', 'Éclairage', 'Détecteur fumée', 'Rien de cassé', 'Fenêtre', 'Lit', 'Matelas', 'Minibar', 'Poignée dégagée', 'Ferme-porte']);
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
        if (!record.createdIssue || !candidate)
            return undefined;
        const existing = issues.find(issue => issue.id === record.id);
        if (existing)
            return existing;
        const findings = (candidate.roomFindings || []).filter(f => { var _a; return (_a = record.newIssueFindingKeys) === null || _a === void 0 ? void 0 : _a.includes(f.key); });
        return { ...candidate, roomFindings: findings,
            description: findings.length ? [...findings.map(f => f.label), ...(record.notes && !findings.some(f => f.label === record.notes) ? [record.notes] : [])].join("\n").slice(0, 4000) : candidate.description };
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
