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

const TABLE_NAME = 'invitees';

const HOME_URL = './index.html';

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

function normalizeHeader(h) {
    return String(h).toLowerCase().replace(/[\s_\-]/g, '');
}

// DOM refs
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

const confirmModal = document.getElementById('confirmModal');
const confirmTitle = document.getElementById('confirmTitle');
const confirmBody = document.getElementById('confirmBody');
const confirmCancel = document.getElementById('confirmCancel');
const confirmProceed = document.getElementById('confirmProceed');

const viewListBtn = document.getElementById('viewListBtn');
const viewListContainer = document.getElementById('viewListContainer');
const viewListMeta = document.getElementById('viewListMeta');
const viewListHeader = document.getElementById('viewListHeader');
const viewListBody = document.getElementById('viewListBody');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');
const downloadXlsxBtn = document.getElementById('downloadXlsxBtn');
const closeViewListBtn = document.getElementById('closeViewListBtn');
const logoutBtn = document.getElementById('logoutBtn');

let currentViewList = null;
let currentDataset = null;

logoutBtn.addEventListener('click', async () => {
    await db.auth.signOut();
    window.location.replace('./login.html');
});

// File input handling
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    resetView();
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
    renderTable(allSchemaFields, validRows);
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

function renderTable(headers, rows) {
    renderTableInto(tableHeader, tableBody, headers, rows, 1000, true);
}

function renderTableInto(headerEl, bodyEl, headers, rows, cap, capNote) {
    const colCount = headers.length + 1;

    let headerHtml = '<tr><th class="idx-col">#</th>';
    headers.forEach(header => { headerHtml += `<th>${escapeHtml(header)}</th>`; });
    headerHtml += '</tr>';
    headerEl.innerHTML = headerHtml;

    if (rows.length === 0) {
        bodyEl.innerHTML = `<tr><td colspan="${colCount}"><div class="empty-state">No records to display.</div></td></tr>`;
        return;
    }

    let bodyHtml = '';
    rows.slice(0, cap).forEach((row, i) => {
        bodyHtml += `<tr><td class="idx-col">${i + 1}</td>`;
        headers.forEach(header => {
            const cellValue = row[header] !== null && row[header] !== undefined ? row[header] : '';
            bodyHtml += `<td>${escapeHtml(cellValue)}</td>`;
        });
        bodyHtml += '</tr>';
    });

    if (capNote && rows.length > cap) {
        bodyHtml += `<tr><td colspan="${colCount}" style="font-style:italic;color:var(--text-faint);">Preview capped at first ${cap} rows — all rows are still included in downloads/uploads.</td></tr>`;
    }

    bodyEl.innerHTML = bodyHtml;
}

function showError(message) {
    errorContainer.textContent = message;
    errorContainer.classList.remove('hidden');
}

function showStatus(html) {
    statusContainer.innerHTML = html;
    statusContainer.classList.remove('hidden');
}

function showSuccessAndReset(message) {
    fileInput.value = '';
    errorContainer.classList.add('hidden');
    summaryContainer.classList.add('hidden');
    tableContainer.classList.add('hidden');
    tableHeader.innerHTML = '';
    tableBody.innerHTML = '';
    currentDataset = null;
    dropzone.classList.remove('compact');

    showStatus(`
        <div class="status-row">
            <span class="num-emerald">${escapeHtml(message)}</span>
            <a href="${HOME_URL}" class="btn btn-ghost">Go to Home</a>
        </div>
    `);
}

function resetView() {
    errorContainer.classList.add('hidden');
    statusContainer.classList.add('hidden');
    summaryContainer.classList.add('hidden');
    tableContainer.classList.add('hidden');
    tableHeader.innerHTML = '';
    tableBody.innerHTML = '';
    currentDataset = null;
    dropzone.classList.remove('compact');
    viewListContainer.classList.add('hidden');
    viewListHeader.innerHTML = '';
    viewListBody.innerHTML = '';
    currentViewList = null;
}

clearBtn.addEventListener('click', () => {
    fileInput.value = '';
    resetView();
});

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Confirmation modal helper
function askConfirmation({ title, bodyText, buttonLabel, buttonClass }) {
    return new Promise(resolve => {
        confirmTitle.textContent = title;
        confirmBody.textContent = bodyText;
        confirmProceed.textContent = buttonLabel;
        confirmProceed.className = 'btn ' + buttonClass;
        confirmModal.classList.remove('hidden');

        function cleanup(result) {
            confirmModal.classList.add('hidden');
            confirmProceed.removeEventListener('click', onProceed);
            confirmCancel.removeEventListener('click', onCancel);
            resolve(result);
        }
        function onProceed() { cleanup(true); }
        function onCancel() { cleanup(false); }

        confirmProceed.addEventListener('click', onProceed);
        confirmCancel.addEventListener('click', onCancel);
    });
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

        const confirmed = await askConfirmation({
            title: 'Confirm append',
            bodyText: `This will INSERT ${rowsToInsert.length} new record(s) into "${TABLE_NAME}".\n${alreadyExistCount} record(s) already exist (by employee_id) and will be skipped.\n\nExisting data in the table will not be changed or removed.\n\nProceed?`,
            buttonLabel: `Append ${rowsToInsert.length} record(s)`,
            buttonClass: 'btn-emerald'
        });
        if (!confirmed) { appendBtn.disabled = false; showStatus('Append cancelled.'); return; }

        showStatus('Uploading…');
        const { error } = await db.rpc('admin_append_invitees', { p_rows: rowsToInsert });
        if (error) throw error;

        showSuccessAndReset(`Success — appended ${rowsToInsert.length} record(s). Skipped ${alreadyExistCount} existing record(s).`);
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
        const confirmed = await askConfirmation({
            title: 'Confirm overwrite',
            bodyText: `This will PERMANENTLY DELETE ALL existing rows in "${TABLE_NAME}" and replace them with ${currentDataset.validRows.length} record(s) from this file.\n\nThis cannot be undone. Proceed?`,
            buttonLabel: 'Overwrite table',
            buttonClass: 'btn-amber'
        });
        if (!confirmed) { overwriteBtn.disabled = false; showStatus('Overwrite cancelled.'); return; }

        showStatus('Overwriting table…');
        // A single RPC call, run inside one DB transaction, so a failure
        // partway through can't leave the table half-deleted.
        const { error } = await db.rpc('admin_overwrite_invitees', { p_rows: currentDataset.validRows });
        if (error) throw error;

        showSuccessAndReset(`Success — table overwritten with ${currentDataset.validRows.length} record(s).`);
    } catch (err) {
        showStatus(`<span class="num-rose">Overwrite failed: ${escapeHtml(err.message || String(err))}</span>`);
    } finally {
        overwriteBtn.disabled = false;
    }
});

viewListBtn.addEventListener('click', async () => {
    viewListBtn.disabled = true;
    try {
        showStatus('Loading invitee list from Supabase…');
        const rows = await fetchAllInvitees();
        currentViewList = rows;

        const allSchemaFields = Object.keys(SCHEMA_FIELDS);
        renderTableInto(viewListHeader, viewListBody, allSchemaFields, rows, 1000, true);
        viewListMeta.textContent = `${rows.length} record(s) in "${TABLE_NAME}"`;
        viewListContainer.classList.remove('hidden');
        statusContainer.classList.add('hidden');
        tableContainer.classList.add('hidden');
        summaryContainer.classList.add('hidden');
    } catch (err) {
        showStatus(`<span class="num-rose">Failed to load invitee list: ${escapeHtml(err.message || String(err))}</span>`);
    } finally {
        viewListBtn.disabled = false;
    }
});

closeViewListBtn.addEventListener('click', () => {
    viewListContainer.classList.add('hidden');
    viewListHeader.innerHTML = '';
    viewListBody.innerHTML = '';
    currentViewList = null;
});

function downloadInviteeList(format) {
    if (!currentViewList || currentViewList.length === 0) return;
    const allSchemaFields = Object.keys(SCHEMA_FIELDS);
    const worksheet = XLSX.utils.json_to_sheet(currentViewList, { header: allSchemaFields });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Invitees');
    const filename = `invitees_${new Date().toISOString().slice(0, 10)}.${format}`;
    XLSX.writeFile(workbook, filename, { bookType: format });
}

downloadCsvBtn.addEventListener('click', () => downloadInviteeList('csv'));
downloadXlsxBtn.addEventListener('click', () => downloadInviteeList('xlsx'));
