// register.js
//
// Public kiosk flow — no login required. All server interaction goes
// through two SECURITY DEFINER RPC functions (check_employee,
// register_participant). The anon key can call ONLY these two
// functions; it has no direct table access (see supabase-security.sql).
// This is why register.html is safe to leave open to walk-in users
// while dashboard.html/invitees.html require a logged-in session.
import { supabase } from './assets/supabaseClient.js';

async function callBackend(action, payload) {
  if (action === 'checkEmployee') {
    const { data, error } = await supabase.rpc('check_employee', {
      p_employee_id: payload.employeeId
    });
    if (error) throw new Error(error.message);
    return data;
  }

  if (action === 'registerParticipant') {
    const fd = payload.formData;
    const { data, error } = await supabase.rpc('register_participant', {
      p_employee_id: fd.employeeId,
      p_fullname: fd.fullname,
      p_gender: fd.gender,
      p_position: fd.position,
      p_department: fd.department,
      p_bu: fd.businessUnit,
      p_is_invited: fd.type === 'Invited'
    });
    if (error) throw new Error(error.message);
    return data;
  }

  throw new Error('Unknown action: ' + action);
}

function toggleLoading(show) {
  document.getElementById('loading').classList.toggle('d-none', !show);
  if (show) {
    document.getElementById('app-logo').classList.add('d-none');
    document.getElementById('step-lookup').classList.add('d-none');
    document.getElementById('step-action').classList.add('d-none');
    document.getElementById('step-success').classList.add('d-none');
  }
}

function lookupEmployee() {
  const empId = document.getElementById('employeeId').value.trim();
  if (!empId) {
    alert('Please enter a valid Employee ID.');
    return;
  }

  toggleLoading(true);
  callBackend('checkEmployee', { employeeId: empId })
    .then(processLookupResult)
    .catch(function (err) {
      document.getElementById('loading').classList.add('d-none');
      document.getElementById('app-logo').classList.remove('d-none');
      document.getElementById('step-lookup').classList.remove('d-none');
      document.body.classList.remove('align-top');
      alert('Error: ' + err.message);
    });
}

function processLookupResult(res) {
  document.getElementById('loading').classList.add('d-none');
  document.getElementById('app-logo').classList.remove('d-none');
  document.getElementById('step-lookup').classList.add('d-none');
  document.getElementById('step-action').classList.remove('d-none');
  document.body.classList.add('align-top');

  const alertBox = document.getElementById('alert-box');
  const submitBtn = document.getElementById('submit-btn');
  const cardView = document.getElementById('employee-card-view');
  const idWrapper = document.getElementById('id-field-wrapper');
  const nameWrapper = document.getElementById('name-field-wrapper');
  const walkinExtra = document.getElementById('walkin-extra-fields');
  const nameInput = document.getElementById('display-name');

  const enteredId = document.getElementById('employeeId').value.trim();
  document.getElementById('display-id').value = enteredId;

  const dataFieldIds = ['display-gender', 'display-position', 'display-department', 'display-bu'];
  dataFieldIds.forEach(function (id) { document.getElementById(id).value = ''; });
  ['walkin-gender-select', 'walkin-position', 'walkin-department', 'walkin-bu'].forEach(function (id) {
    document.getElementById(id).value = '';
  });
  nameInput.value = '';
  ['ec-name', 'ec-position', 'ec-id', 'ec-gender', 'ec-department', 'ec-bu'].forEach(function (id) {
    document.getElementById(id).innerText = '';
  });

  if (res.status === 'INVITED' || res.status === 'ALREADY_REGISTERED') {
    const data = res.data || {};

    document.getElementById('action-title').innerText = 'Verify Information';
    document.getElementById('action-subtitle').innerText = 'Please check your details below';

    nameInput.value = data.fullname || '';
    document.getElementById('display-gender').value = data.gender || '-';
    document.getElementById('display-position').value = data.position || '-';
    document.getElementById('display-department').value = data.department || '-';
    document.getElementById('display-bu').value = data.businessUnit || '-';

    document.getElementById('ec-name').innerText = data.fullname || '';
    document.getElementById('ec-position').innerText = data.position || '-';
    document.getElementById('ec-id').innerText = enteredId;
    document.getElementById('ec-gender').innerText = data.gender || '-';
    document.getElementById('ec-department').innerText = data.department || '-';
    document.getElementById('ec-bu').innerText = data.businessUnit || '-';

    cardView.classList.remove('d-none');
    idWrapper.classList.add('d-none');
    nameWrapper.classList.add('d-none');
    walkinExtra.classList.add('d-none');

    if (res.status === 'INVITED') {
      alertBox.className = 'alert alert-info text-center py-2 small';
      alertBox.innerText = res.message;
      document.getElementById('form-type').value = 'Invited';
      submitBtn.style.display = 'block';
    } else {
      alertBox.className = 'alert alert-warning text-center py-2 small';
      alertBox.innerText = res.message;
      submitBtn.style.display = 'none';
    }

  } else if (res.status === 'NOT_INVITED') {
    document.getElementById('action-title').innerText = 'Register as Walk-in';
    document.getElementById('action-subtitle').innerText = 'Please fill in your details below';

    alertBox.className = 'alert alert-danger text-center py-2 small';
    alertBox.innerText = res.message;

    cardView.classList.add('d-none');
    idWrapper.classList.remove('d-none');
    nameWrapper.classList.remove('d-none');
    walkinExtra.classList.remove('d-none');

    document.getElementById('form-type').value = 'Walk-in';
    submitBtn.style.display = 'block';
  }
}

function handleRegister(e) {
  e.preventDefault();
  toggleLoading(true);

  const formData = {
    employeeId: document.getElementById('display-id').value,
    fullname: document.getElementById('display-name').value,
    gender: document.getElementById('display-gender').value || '-',
    position: document.getElementById('display-position').value || '-',
    department: document.getElementById('display-department').value || '-',
    businessUnit: document.getElementById('display-bu').value || '-',
    type: document.getElementById('form-type').value
  };

  callBackend('registerParticipant', { formData: formData })
    .then(function (res) {
      document.getElementById('loading').classList.add('d-none');
      if (res.success) {
        document.getElementById('step-success').classList.remove('d-none');
        document.body.classList.remove('align-top');
        document.getElementById('success-message').innerText = res.message || 'Your registration has been successfully recorded.';
      } else {
        document.getElementById('step-action').classList.remove('d-none');
        alert(res.message);
      }
    })
    .catch(function (err) {
      document.getElementById('loading').classList.add('d-none');
      document.getElementById('step-action').classList.remove('d-none');
      alert('Error: ' + err.message);
    });
}

function resetForm() {
  document.getElementById('step-success').classList.add('d-none');
  document.getElementById('step-action').classList.add('d-none');
  document.getElementById('app-logo').classList.remove('d-none');
  document.getElementById('step-lookup').classList.remove('d-none');
  document.getElementById('employeeId').value = '';
  document.getElementById('regForm').reset();
  document.getElementById('employee-card-view').classList.add('d-none');
  document.getElementById('id-field-wrapper').classList.remove('d-none');
  document.getElementById('name-field-wrapper').classList.remove('d-none');
  document.getElementById('walkin-extra-fields').classList.add('d-none');
  document.body.classList.remove('align-top');
}

// Wire up events (previously inline onclick/onchange/oninput attributes —
// moving these here keeps the HTML free of inline JS, which is required
// once a strict script-src Content-Security-Policy is in place).
document.getElementById('lookupBtn').addEventListener('click', lookupEmployee);
document.getElementById('regForm').addEventListener('submit', handleRegister);
document.getElementById('backBtn').addEventListener('click', resetForm);
document.getElementById('okBtn').addEventListener('click', resetForm);

document.getElementById('walkin-gender-select').addEventListener('change', function () {
  document.getElementById('display-gender').value = this.value;
});
document.getElementById('walkin-position').addEventListener('input', function () {
  document.getElementById('display-position').value = this.value;
});
document.getElementById('walkin-department').addEventListener('input', function () {
  document.getElementById('display-department').value = this.value;
});
document.getElementById('walkin-bu').addEventListener('input', function () {
  document.getElementById('display-bu').value = this.value;
});
