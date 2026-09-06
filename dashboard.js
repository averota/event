// dashboard.js
import { supabase } from './assets/supabaseClient.js';

const logBox = document.getElementById('logTerminal');
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

async function getData() {
  setLog('Connecting to server…');
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';

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

    if (data.length === 0) {
      setLog('Connected! No registrations yet.');
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No registrations yet.</td></tr>';
      return;
    }

    setLog(`Loaded ${data.length} registrations.`);

    data.forEach(item => {
      const tr = document.createElement('tr');

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

      tbody.appendChild(tr);
    });

  } catch (err) {
    setLog('CRITICAL SCRIPT ERROR: ' + err.message, true);
  }
}

// Escapes a single CSV field: doubles internal quotes, wraps in quotes,
// and neutralizes formula-injection characters (=, +, -, @) that Excel
// or Sheets could otherwise execute.
function escapeCsvField(value) {
  let str = String(value ?? '');
  if (/^[=+\-@]/.test(str)) str = "'" + str;
  return `"${str.replace(/"/g, '""')}"`;
}

document.getElementById('dlBtn').addEventListener('click', () => {
  if (localRows.length === 0) { alert('No rows to export'); return; }

  let csv = 'Registered At (UTC+7),Employee ID,Full Name,Gender,Position,Department,Business Unit,Type\n';
  localRows.forEach(r => {
    csv += [
      escapeCsvField(formatPhnomPenhTime(r.created_at)),
      escapeCsvField(r.employee_id),
      escapeCsvField(r.fullname),
      escapeCsvField(r.gender),
      escapeCsvField(r.position),
      escapeCsvField(r.department),
      escapeCsvField(r.bu),
      escapeCsvField(r.is_invited ? 'Invited' : 'Walk-in')
    ].join(',') + '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = window.URL.createObjectURL(blob);
  link.download = 'attendance_export.csv';
  link.click();
});

document.getElementById('rfBtn').addEventListener('click', getData);
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.replace('/login.html');
});

window.addEventListener('DOMContentLoaded', getData);
