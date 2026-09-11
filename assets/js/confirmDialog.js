// assets/confirmDialog.js
//
// One shared confirmation modal, built on the .modal-overlay/.modal-box
// styles already in assets/styles.css, instead of every page carrying
// its own copy of the modal markup + open/close wiring.
//
// Usage:
//   const ok = await confirmDialog({
//     title: 'Confirm overwrite',
//     body: 'This cannot be undone.',
//     confirmLabel: 'Overwrite table',
//     danger: true
//   });
//   if (!ok) return;
export function confirmDialog({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <h3></h3>
        <div class="modal-body"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-action="cancel">Cancel</button>
          <button type="button" class="btn ${danger ? 'btn-rose' : 'btn-brand'}" data-action="confirm"></button>
        </div>
      </div>
    `;

    // textContent, never innerHTML, for caller-supplied strings.
    overlay.querySelector('h3').textContent = title;
    overlay.querySelector('.modal-body').textContent = body;
    overlay.querySelector('[data-action="confirm"]').textContent = confirmLabel;

    document.body.appendChild(overlay);

    function cleanup(result) {
      overlay.remove();
      resolve(result);
    }

    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => cleanup(false));
    overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => cleanup(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false);
    });
  });
}
