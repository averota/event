// invitees.js
//
// SECURITY: this page used to call `db.from('invitees').insert(...)` /
// `.delete(...)` directly with the public anon key. That only worked
// safely because a logged-in user's JWT is attached automatically —
// but it also meant that if row level security on the `invitees`
// table were ever misconfigured (or momentarily disabled), the same
// anon key sitting in this file's source would let ANYONE insert or
// wipe the table directly via the REST API, with no login required.
//
// All writes now go through SECURITY DEFINER RPC functions that are
// explicitly granted to the `authenticated` role only and revoked
// from `anon` (see supabase-security.sql). Direct table grants for
// anon/authenticated are revoked entirely, so this page's behaviour
// is enforced by the database, not just by authGuard.js hiding the page.
import { supabase as db } from './assets/supabaseClient.js';
import { confirmDialog } from './assets/confirmDialog.js';

const TABLE_NAME = 'invitees';

// Schema definition: db column -> accepted header aliases (normalized)
const SCHEMA_FIELDS = {
    employee_id: ['employeeid', 'empid', 'employeeno', 'employeenumber', 'id'],
    fullname:    ['fullname', 'name', 'employeename'],
    gender:      ['gender', 'sex'],
    position:    ['position', 'jobtitle', 'title', 'role'],
    department:  ['department', 'dept'],
    bu:          ['bu', 'businessunit']
};
const REQUIRED_FIELDS = ['employee_id', 'fullname'];

// Human-friendly column headers for tables/exports — shown to the
// user instead of raw database field names like "employee_id".
const HEADER_LABELS = {
    employee_id: 'Employee ID',
    fullname:    'Full Name',
    gender:      'Gender',
    position:    'Position',
    department:  'Department',
    bu:          'Business Unit'
};

function normalizeHeader(h) {
    return String(h).toLowerCase().replace(/[\s_\-]/g, '');
}

function trashIconSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
        '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
}

// DOM refs
const toggleUploadBtn = document.getElementById('toggleUploadBtn');
const uploadPanel = document.getElementById('uploadPanel');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const tableContainer = document.getElementById('tableContainer');
const errorContainer = document.getElementById('errorContainer');
const statusContainer = document.getElementById('statusContainer');
const summaryContainer = document.getElementById('summaryContainer');
const tableHeader = document.getElementById('tableHeader');
const tableBody = document.getElementById('tableBody');
const fileMeta = document.getElementById('fileMeta');
const clearBtn = document.getElementById('clearBtn');
const appendBtn = document.getElementById('appendBtn');
const overwriteBtn = document.getElementById('overwriteBtn');
const clearInviteesBtn = document.getElementById('clearInviteesBtn');

const refreshListBtn = document.getElementById('refreshListBtn');
const viewListContainer = document.getElementById('viewListContainer');
const viewListMeta = document.getElementById('viewListMeta');
const viewListHeader = document.getElementById('viewListHeader');
const viewListBody = document.getElementById('viewListBody');
const downloadXlsxBtn = document.getElementById('downloadXlsxBtn');
const logoutBtn = document.getElementById('logoutBtn');

let currentViewList = [];
let currentDataset = null;

logoutBtn.addEventListener('click', async () => {
    await db.auth.signOut();
    window.location.replace('./login.html');
});

// ---------------------------------------------------------------
// Upload panel is secondary/collapsed by default — only the button
// click opens it, and it auto-collapses again after a successful
// append/overwrite so the page returns to showing the list. While
// the panel is open, the invitee list is hidden so the upload flow
// has the page's full attention; it reappears (refreshed) once the
// panel closes.
// ---------------------------------------------------------------
function setUploadPanelOpen(open) {
    uploadPanel.classList.toggle('hidden', !open);
    viewListContainer.classList.toggle('hidden', open);
    if (open) {
        // Always start from a clean, full-size dropzone when opening —
        // any leftover preview from a previous visit is discarded.
        resetUploadPreview();
    }
}

toggleUploadBtn.addEventListener('click', () => {
    setUploadPanelOpen(uploadPanel.classList.contains('hidden'));
});

// File input handling
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    resetUploadPreview();
    fileMeta.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array' });

            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

            if (jsonRows.length === 0) {
                showError('The uploaded file contains no data.');
                return;
            }

            processRows(jsonRows);
        } catch (err) {
            showError(`Failed to parse file: ${err.message}`);
        }
    };

    reader.onerror = () => showError('Error reading file from disk.');
    reader.readAsArrayBuffer(file);
});

// Map raw headers to schema fields, validate & de-duplicate
function processRows(jsonRows) {
    const rawHeaders = Object.keys(jsonRows[0]);

    const headerToField = {};
    const mappedFields = [];
    rawHeaders.forEach(rawHeader => {
        const norm = normalizeHeader(rawHeader);
        for (const [field, aliases] of Object.entries(SCHEMA_FIELDS)) {
            if (aliases.includes(norm) && !mappedFields.includes(field)) {
                headerToField[rawHeader] = field;
                mappedFields.push(field);
                break;
            }
        }
    });

    const missingRequired = REQUIRED_FIELDS.filter(f => !mappedFields.includes(f));
    if (missingRequired.length > 0) {
        showError(`The file is missing required column(s) for: ${missingRequired.join(', ')}. Required columns are employee_id and fullname (or a recognizable alias like "Employee ID" / "Name").`);
        return;
    }

    const allSchemaFields = Object.keys(SCHEMA_FIELDS);
    const mappedRows = jsonRows.map(row => {
        const out = {};
        allSchemaFields.forEach(f => { out[f] = null; });
        for (const [rawHeader, field] of Object.entries(headerToField)) {
            let val = row[rawHeader];
            if (val === undefined || val === null) val = null;
            else {
                val = String(val).trim();
                if (val === '') val = null;
            }
            out[field] = val;
        }
        return out;
    });

    const validRowsRaw = [];
    let invalidCount = 0;
    mappedRows.forEach(row => {
        const hasRequired = REQUIRED_FIELDS.every(f => row[f] !== null && row[f] !== '');
        if (hasRequired) validRowsRaw.push(row);
        else invalidCount++;
    });

    const seen = new Set();
    const validRows = [];
    let duplicateInFileCount = 0;
    validRowsRaw.forEach(row => {
        const key = row.employee_id;
        if (seen.has(key)) {
            duplicateInFileCount++;
        } else {
            seen.add(key);
            validRows.push(row);
        }
    });

    currentDataset = { validRows, invalidCount, duplicateInFileCount, mappedFields, rawHeaders };

    renderSummary(currentDataset);
    renderTable(tableHeader, tableBody, Object.keys(SCHEMA_FIELDS), validRows);
    tableContainer.classList.remove('hidden');
    dropzone.classList.add('compact');
}

// Rendering
function renderSummary(ds) {
    summaryContainer.classList.remove('hidden');
    const total = ds.validRows.length + ds.invalidCount + ds.duplicateInFileCount;
    summaryContainer.innerHTML = `
        <span class="stat-item">Rows in file <span class="stat-value">${total}</span></span>
        <span class="stat-item">Valid <span class="stat-value num-emerald">${ds.validRows.length}</span></span>
        <span class="stat-item">Skipped (missing required fields) <span class="stat-value num-rose">${ds.invalidCount}</span></span>
        <span class="stat-item">Duplicate in file <span class="stat-value num-amber">${ds.duplicateInFileCount}</span></span>
    `;
}

// Renders headerEl/bodyEl atomically via DocumentFragment so a
// refresh never shows a visibly empty table mid-update. Pass
// onDelete to add a trash-icon actions column (used for the live
// invitee list, not for the not-yet-saved upload preview).
function renderTable(headerEl, bodyEl, fields, rows, cap = 1000, capNote = true, onDelete = null) {
    const colCount = fields.length + 1 + (onDelete ? 1 : 0); // +1 for index, +1 for actions

    let headerHtml = '<tr><th class="idx-col">#</th>';
    fields.forEach(field => { headerHtml += `<th>${escapeHtml(HEADER_LABELS[field] || field)}</th>`; });
    if (onDelete) headerHtml += `<th class="actions-col">Delete</th>`;
    headerHtml += '</tr>';
    headerEl.innerHTML = headerHtml;

    if (rows.length === 0) {
        bodyEl.innerHTML = `<tr><td colspan="${colCount}"><div class="empty-state">No records to display.</div></td></tr>`;
        return;
    }

    const fragment = document.createDocumentFragment();
    rows.slice(0, cap).forEach((row, i) => {
        const tr = document.createElement('tr');

        const idxTd = document.createElement('td');
        idxTd.className = 'idx-col';
        idxTd.textContent = i + 1;
        tr.appendChild(idxTd);

        fields.forEach(field => {
            const td = document.createElement('td');
            td.textContent = row[field] !== null && row[field] !== undefined ? row[field] : '';
            tr.appendChild(td);
        });

        if (onDelete) {
            const actionTd = document.createElement('td');
            actionTd.className = 'actions-col';
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'btn-icon-only';
            delBtn.title = 'Delete this invitee';
            delBtn.innerHTML = trashIconSvg();
            delBtn.addEventListener('click', () => onDelete(row));
            actionTd.appendChild(delBtn);
            tr.appendChild(actionTd);
        }

        fragment.appendChild(tr);
    });

    if (capNote && rows.length > cap) {
        const noteTr = document.createElement('tr');
        const noteTd = document.createElement('td');
        noteTd.colSpan = colCount;
        noteTd.style.fontStyle = 'italic';
        noteTd.style.color = 'var(--text-faint)';
        noteTd.textContent = `Preview capped at first ${cap} rows — all rows are still included in downloads/uploads.`;
        noteTr.appendChild(noteTd);
        fragment.appendChild(noteTr);
    }

    bodyEl.replaceChildren(fragment);
}

function showError(message) {
    errorContainer.textContent = message;
    errorContainer.classList.remove('hidden');
}

function showStatus(html) {
    statusContainer.innerHTML = html;
    statusContainer.classList.remove('hidden');
}

function clearMessages() {
    errorContainer.classList.add('hidden');
    statusContainer.classList.add('hidden');
}

function resetUploadPreview() {
    errorContainer.classList.add('hidden');
    summaryContainer.classList.add('hidden');
    tableContainer.classList.add('hidden');
    tableHeader.innerHTML = '';
    tableBody.innerHTML = '';
    currentDataset = null;
    dropzone.classList.remove('compact');
    fileInput.value = '';
}

clearBtn.addEventListener('click', resetUploadPreview);

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ---------------------------------------------------------------
// All data access below goes through RPC functions restricted to
// the `authenticated` role — see supabase-security.sql.
// ---------------------------------------------------------------
async function fetchExistingEmployeeIds() {
    const { data, error } = await db.rpc('admin_list_employee_ids');
    if (error) throw error;
    return new Set((data || []).map(r => r.employee_id));
}

async function fetchAllInvitees() {
    const { data, error } = await db.rpc('admin_list_invitees');
    if (error) throw error;
    return data || [];
}

// The single function that (re)loads and (re)renders the main
// invitee list — called on page load, after Refresh, and after any
// append/overwrite/delete/clear action, so the list is always the
// source of truth rather than something the user has to remember to
// reload themselves.
async function refreshInviteeList() {
    try {
        const rows = await fetchAllInvitees();
        currentViewList = rows;
        renderTable(viewListHeader, viewListBody, Object.keys(SCHEMA_FIELDS), rows, 1000, true, handleDeleteInvitee);
        viewListMeta.textContent = `${rows.length} record(s) in "${TABLE_NAME}"`;
    } catch (err) {
        showError(`Failed to load invitee list: ${err.message}`);
    }
}

refreshListBtn.addEventListener('click', () => {
    clearMessages();
    refreshInviteeList();
});

appendBtn.addEventListener('click', async () => {
    if (!currentDataset || currentDataset.validRows.length === 0) return;

    appendBtn.disabled = true;
    try {
        showStatus('Checking existing records in Supabase…');
        const existingIds = await fetchExistingEmployeeIds();
        const rowsToInsert = currentDataset.validRows.filter(r => !existingIds.has(r.employee_id));
        const alreadyExistCount = currentDataset.validRows.length - rowsToInsert.length;

        if (rowsToInsert.length === 0) {
            showStatus(`<span class="num-amber">Nothing to append — all ${currentDataset.validRows.length} valid row(s) already exist in the table.</span>`);
            appendBtn.disabled = false;
            return;
        }

        const confirmed = await confirmDialog({
            title: 'Confirm append',
            body: `This will INSERT ${rowsToInsert.length} new record(s) into "${TABLE_NAME}". ${alreadyExistCount} record(s) already exist (by employee_id) and will be skipped. Existing data in the table will not be changed or removed.`,
            confirmLabel: `Append ${rowsToInsert.length} record(s)`
        });
        if (!confirmed) { appendBtn.disabled = false; showStatus('Append cancelled.'); return; }

        showStatus('Uploading…');
        const { error } = await db.rpc('admin_append_invitees', { p_rows: rowsToInsert });
        if (error) throw error;

        resetUploadPreview();
        setUploadPanelOpen(false);
        await refreshInviteeList();
        showStatus(`<span class="num-emerald">Success — appended ${rowsToInsert.length} record(s). Skipped ${alreadyExistCount} existing record(s).</span>`);
    } catch (err) {
        showStatus(`<span class="num-rose">Append failed: ${escapeHtml(err.message || String(err))}</span>`);
    } finally {
        appendBtn.disabled = false;
    }
});

overwriteBtn.addEventListener('click', async () => {
    if (!currentDataset || currentDataset.validRows.length === 0) return;

    overwriteBtn.disabled = true;
    try {
        const confirmed = await confirmDialog({
            title: 'Confirm overwrite',
            body: `This will PERMANENTLY DELETE ALL existing rows in "${TABLE_NAME}" and replace them with ${currentDataset.validRows.length} record(s) from this file. This cannot be undone.`,
            confirmLabel: 'Overwrite table',
            danger: true
        });
        if (!confirmed) { overwriteBtn.disabled = false; showStatus('Overwrite cancelled.'); return; }

        showStatus('Overwriting table…');
        // A single RPC call, run inside one DB transaction, so a failure
        // partway through can't leave the table half-deleted.
        const { error } = await db.rpc('admin_overwrite_invitees', { p_rows: currentDataset.validRows });
        if (error) throw error;

        resetUploadPreview();
        setUploadPanelOpen(false);
        await refreshInviteeList();
        showStatus(`<span class="num-emerald">Success — table overwritten with ${currentDataset.validRows.length} record(s).</span>`);
    } catch (err) {
        showStatus(`<span class="num-rose">Overwrite failed: ${escapeHtml(err.message || String(err))}</span>`);
    } finally {
        overwriteBtn.disabled = false;
    }
});

clearInviteesBtn.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
        title: 'Clear all invitees',
        body: 'This will PERMANENTLY DELETE every invitee record. Existing registrations are not affected. This cannot be undone.',
        confirmLabel: 'Clear all invitees',
        danger: true
    });
    if (!confirmed) return;

    clearInviteesBtn.disabled = true;
    try {
        showStatus('Clearing invitees…');
        const { error } = await db.rpc('admin_clear_invitees');
        if (error) throw error;
        await refreshInviteeList();
        showStatus('<span class="num-emerald">All invitee records cleared.</span>');
    } catch (err) {
        showStatus(`<span class="num-rose">Clear failed: ${escapeHtml(err.message || String(err))}</span>`);
    } finally {
        clearInviteesBtn.disabled = false;
    }
});

async function handleDeleteInvitee(row) {
    const confirmed = await confirmDialog({
        title: 'Delete invitee',
        body: `Permanently delete the invitee record for "${row.fullname || row.employee_id}"? This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true
    });
    if (!confirmed) return;

    try {
        const { error } = await db.rpc('admin_delete_invitee', { p_employee_id: row.employee_id });
        if (error) throw error;
        await refreshInviteeList();
        showStatus(`<span class="num-emerald">Deleted "${escapeHtml(row.fullname || row.employee_id)}".</span>`);
    } catch (err) {
        showStatus(`<span class="num-rose">Delete failed: ${escapeHtml(err.message || String(err))}</span>`);
    }
}

// Excel-only export (SheetJS) — friendly headers and a leading index
// column, matching the on-screen "#" column.
downloadXlsxBtn.addEventListener('click', () => {
    if (!currentViewList || currentViewList.length === 0) { alert('No rows to export'); return; }
    const allSchemaFields = Object.keys(SCHEMA_FIELDS);
    const exportRows = currentViewList.map((row, i) => {
        const out = { 'No.': i + 1 };
        allSchemaFields.forEach(f => { out[HEADER_LABELS[f] || f] = row[f] ?? ''; });
        return out;
    });
    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Invitees');
    const filename = `invitees_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, filename);
});

// Load the list immediately on open — uploading is a secondary,
// opt-in action via the "Upload invitees" button, not the default view.
window.addEventListener('DOMContentLoaded', refreshInviteeList);
