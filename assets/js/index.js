// index.js — logic for the homepage (index.html)
import { supabase } from '../../supabase/supabaseClient.js';
import { confirmDialog } from './confirmDialog.js';

const logBox = document.getElementById('logTerminal');
const tableBody = document.getElementById('tableBody');
let localRows = [];

function setLog(text, isError = false) {
  logBox.textContent = text;
  logBox.classList.toggle('is-error', isError);
}

// Falls back to the raw value if it can't be parsed.
function formatPhnomPenhTime(inputStr) {
  const date = new Date(String(inputStr).replace(' ', 'T'));
  const options = {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC'
  };
  const parts = new Intl.DateTimeFormat('en-GB', options).formatToParts(date);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.day}-${map.month}-${map.year} ${map.hour}:${map.minute}`;
}

// Normalizes free-text gender values into 'male' | 'female' | null.
// Handles both full words and single-letter abbreviations (e.g. data
// uploaded from a spreadsheet that used "F"/"M" instead of spelling
// it out), so counts don't silently undercount mismatched formats.
function normalizeGender(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'female' || v === 'f') return 'female';
  if (v === 'male' || v === 'm') return 'male';
  return null;
}

function trashIconSvg() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
    '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
}

// Builds the whole table body off-screen in a DocumentFragment, then
// swaps it into the DOM in one atomic operation. This avoids a
// visible empty-table flash mid-refresh (which a naive
// `tableBody.innerHTML = ''` followed by a loop of `appendChild`
// calls can produce, especially on slower devices) — the browser
// only ever sees the old table or the new one, never a gap.
function renderRows(rows) {
  if (rows.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="10" class="empty-state">No registrations yet.</td></tr>';
    return;
  }

  const fragment = document.createDocumentFragment();

  rows.forEach((item, i) => {
    const tr = document.createElement('tr');

    const idxTd = document.createElement('td');
    idxTd.className = 'idx-col';
    idxTd.textContent = i + 1;
    tr.appendChild(idxTd);

    // textContent (never innerHTML) so user-submitted values can
    // never be interpreted as HTML/script — prevents stored XSS.
    const plainCells = [
      formatPhnomPenhTime(item.created_at),
      item.employee_id || '',
      item.fullname || '',
      item.gender || '',
      item.position || '',
      item.department || '',
      item.bu || ''
    ];

    plainCells.forEach(value => {
      const td = document.createElement('td');
      td.textContent = value;
      tr.appendChild(td);
    });

    const typeTd = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'badge ' + (item.is_invited ? 'badge-invited' : 'badge-walkin');
    badge.textContent = item.is_invited ? 'Invited' : 'Walk-in';
    typeTd.appendChild(badge);
    tr.appendChild(typeTd);

    // Per-row delete action. Assumes the attendees table has a
    // primary key column called `id` — list_attendees() returns it
    // since it selects every column. If your primary key has a
    // different name, update both the `item.id` reference here and
    // the admin_delete_attendee(p_id ...) RPC in
    // supabase-security.sql to match.
    const actionTd = document.createElement('td');
    actionTd.className = 'actions-col';
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-icon-only';
    delBtn.title = 'Delete this registration';
    delBtn.innerHTML = trashIconSvg();
    delBtn.addEventListener('click', () => handleDeleteAttendee(item.id, item.fullname));
    actionTd.appendChild(delBtn);
    tr.appendChild(actionTd);

    fragment.appendChild(tr);
  });

  tableBody.replaceChildren(fragment);
}

async function getData() {
  setLog('Connecting to server…');

  try {
    // Both RPCs are SECURITY DEFINER functions restricted to the
    // `authenticated` role at the database level (see
    // supabase-security.sql) — an anonymous caller with only the
    // public anon key cannot execute them even if they know the name.
    const [statsRes, listRes] = await Promise.all([
      supabase.rpc('get_dashboard_stats'),
      supabase.rpc('list_attendees')
    ]);

    if (statsRes.error) { setLog('Error loading stats: ' + statsRes.error.message, true); return; }
    if (listRes.error) { setLog('Error loading list: ' + listRes.error.message, true); return; }

    const stats = statsRes.data;
    document.getElementById('statInvited').textContent = stats.total_invitees;
    document.getElementById('statRegistered').textContent = stats.total_registered;
    document.getElementById('statPending').textContent = stats.not_registered;
    document.getElementById('statWalkin').textContent = stats.walkins;

    const data = listRes.data || [];
    localRows = data;

    // Computed client-side from the attendee list rather than added to
    // get_dashboard_stats() — avoids a database change for a value we
    // already have on hand from list_attendees().
    const femaleCount = data.filter(r => normalizeGender(r.gender) === 'female').length;
    document.getElementById('statFemale').textContent = femaleCount;

    renderRows(data);
    setLog(data.length === 0 ? 'Connected! No registrations yet.' : `Loaded ${data.length} registrations.`);

  } catch (err) {
    setLog('CRITICAL SCRIPT ERROR: ' + err.message, true);
  }
}

async function handleDeleteAttendee(id, fullname) {
  if (id === undefined || id === null) {
    alert('This row has no id to delete by — check the admin_delete_attendee setup in supabase-security.sql matches your schema.');
    return;
  }

  const confirmed = await confirmDialog({
    title: 'Delete registration',
    body: `Permanently delete the registration for "${fullname || id}"? This cannot be undone.`,
    confirmLabel: 'Delete',
    danger: true
  });
  if (!confirmed) return;

  try {
    const { error } = await supabase.rpc('admin_delete_attendee', { p_id: id });
    if (error) throw error;
    setLog(`Deleted registration for "${fullname || id}".`);
    getData();
  } catch (err) {
    setLog('Delete failed: ' + err.message, true);
  }
}

document.getElementById('clearAttendeesBtn').addEventListener('click', async () => {
  const confirmed = await confirmDialog({
    title: 'Clear all attendees',
    body: 'This will PERMANENTLY DELETE every registration record. The invite list is not affected. This cannot be undone.',
    confirmLabel: 'Clear all attendees',
    danger: true
  });
  if (!confirmed) return;

  try {
    setLog('Clearing attendees…');
    const { error } = await supabase.rpc('admin_clear_attendees');
    if (error) throw error;
    setLog('All attendee records cleared.');
    getData();
  } catch (err) {
    setLog('Clear failed: ' + err.message, true);
  }
});

// Excel export (SheetJS, loaded globally via the CDN <script> tag in
// index.html — same library invitees.html already uses). Includes a
// leading index column matching the on-screen "#" column.
document.getElementById('dlBtn').addEventListener('click', () => {
  if (localRows.length === 0) { alert('No rows to export'); return; }

  const exportRows = localRows.map((r, i) => ({
    'No.': i + 1,
    'Registered At (UTC+7)': formatPhnomPenhTime(r.created_at),
    'Employee ID': r.employee_id || '',
    'Full Name': r.fullname || '',
    'Gender': r.gender || '',
    'Position': r.position || '',
    'Department': r.department || '',
    'Business Unit': r.bu || '',
    'Type': r.is_invited ? 'Invited' : 'Walk-in'
  }));

  const worksheet = XLSX.utils.json_to_sheet(exportRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance');
  XLSX.writeFile(workbook, `attendance_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
});

document.getElementById('rfBtn').addEventListener('click', getData);
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.replace(new URL('login.html', window.location.href).toString());
});

// ------------------------------------------------------------
// Live updates: refresh automatically whenever a new registration
// row is inserted, instead of requiring a manual "Refresh" click.
//
// Requires `alter publication supabase_realtime add table
// public.attendees;` to have been run once (see
// supabase-security.sql, section 7). Realtime enforces the same RLS
// policies as regular queries — only a logged-in `authenticated`
// user (which is who's ever viewing this page, thanks to
// authGuard.js) can receive these events, so this doesn't open up
// any new access. This only touches the stats/table, not the whole
// page, so a new registration never causes a full-page reload.
// ------------------------------------------------------------
supabase
  .channel('attendees-changes')
  .on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'attendees' },
    () => {
      setLog('New registration received — refreshing…');
      getData();
    }
  )
  .subscribe();

// ------------------------------------------------------------
// Registration open/closed switch. Reads/writes app_settings via
// two RPCs (see supabase-security.sql, section 6). The actual gate
// that stops registrations also needs to live inside the
// register_participant(...) database function itself (see the
// comment in that SQL section) — this toggle is the control surface,
// not the only enforcement point.
// ------------------------------------------------------------
const registrationToggle = document.getElementById('registrationToggle');
const registrationStatusNote = document.getElementById('registrationStatusNote');

function setToggleUIState(isOpen) {
  registrationToggle.checked = isOpen;
  registrationStatusNote.textContent = isOpen ? 'Open' : 'Closed';
  registrationStatusNote.title = isOpen
    ? 'Registrations are currently open.'
    : 'Registrations are currently closed — the registration page will show a closed notice.';
}

async function loadRegistrationStatus() {
  try {
    const { data, error } = await supabase.rpc('get_registration_status');
    if (error) throw error;
    setToggleUIState(!!data);
    registrationToggle.disabled = false;
  } catch (err) {
    registrationStatusNote.textContent = 'Error';
    registrationStatusNote.title = 'Could not load registration status: ' + err.message;
  }
}

registrationToggle.addEventListener('change', async () => {
  const desiredState = registrationToggle.checked;
  registrationToggle.disabled = true;
  registrationStatusNote.textContent = '…';

  try {
    const { error } = await supabase.rpc('set_registration_status', { p_open: desiredState });
    if (error) throw error;
    setToggleUIState(desiredState);
  } catch (err) {
    // Revert the switch visually since the change didn't actually save.
    setToggleUIState(!desiredState);
    alert('Failed to update registration status: ' + err.message);
  } finally {
    registrationToggle.disabled = false;
  }
});

loadRegistrationStatus();

window.addEventListener('DOMContentLoaded', getData);
