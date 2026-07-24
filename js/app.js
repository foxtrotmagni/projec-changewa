/* 
   app.js
   Author: Antigravity AI
   Description: Core interactive logic for the WhatsApp update landing page.
   Handles ticket validation, keyboard input restrictions, visual warnings, 
   and transitions between steps.
*/

// URL Endpoint API (Otomatis mendeteksi Server Node.js Lokal atau Google Apps Script)
const REMOTE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzRIJVW9m13d2HaHady_WokAjBxBsCQNehc60T_qlvxM_kE_TVC0Il9mwy_00pWnejQXw/exec';
const LOCAL_SCRIPT_URL = 'http://localhost:3000/api';

const SCRIPT_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:')
  ? LOCAL_SCRIPT_URL
  : REMOTE_SCRIPT_URL;

document.addEventListener('DOMContentLoaded', () => {
  // --- DOM Elements ---
  const cardGate = document.getElementById('card-gate');
  const cardForm = document.getElementById('card-form');
  const cardSuccess = document.getElementById('card-success');
  const cardError = document.getElementById('card-error');

  const ticketInput = document.getElementById('ticket-input');
  const ticketWarning = document.getElementById('ticket-warning');
  const btnVerify = document.getElementById('btn-verify');

  const formTicket = document.getElementById('form-ticket');
  const formWebsite = document.getElementById('form-website');
  const formUsername = document.getElementById('form-username');
  const formName = document.getElementById('form-name');
  const formWaOld = document.getElementById('form-wa-old');
  const formWaNew = document.getElementById('form-wa-new');
  const btnSubmit = document.getElementById('btn-submit');

  const btnReset = document.getElementById('btn-reset');
  const btnErrorRetry = document.getElementById('btn-error-retry');
  const errorMessageEl = document.getElementById('error-message');

  const step1 = document.getElementById('step-1');
  const step2 = document.getElementById('step-2');
  const step3 = document.getElementById('step-3');

  // --- Utility Functions ---

  // Transition between cards with a smooth fade & scale effect
  const transitionCards = (currentCard, nextCard) => {
    currentCard.classList.add('hidden');
    // Allow animation to complete before changing visibility completely
    setTimeout(() => {
      nextCard.classList.remove('hidden');
    }, 300);
  };

  // Show visual warnings for input fields
  const showWarning = (inputEl, warningEl, message) => {
    inputEl.classList.add('border-error');
    warningEl.textContent = message;
    warningEl.classList.add('visible');

    // Auto-remove warning after 2.5 seconds
    setTimeout(() => {
      inputEl.classList.remove('border-error');
      warningEl.classList.remove('visible');
    }, 2500);
  };

  // --- 1. Ticket Verification Gating ---

  // Rule: FX- followed by exactly 6 digits or letters (e.g. FX-A1B2C3)
  const validateTicket = (ticket) => {
    const regex = /^FX-[A-Z0-9]{6}$/i;
    return regex.test(ticket.trim());
  };

  // Handle enter key press on ticket input
  ticketInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      btnVerify.click();
    }
  });

  const verifyTicketWithBackend = (ticketCode) => {
    btnVerify.disabled = true;
    btnVerify.innerHTML = `<svg class="spinner" width="16" height="16" viewBox="0 0 50 50" style="animation: spin 1s linear infinite; margin-right: 8px; display: inline-block; vertical-align: middle;">
      <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="5" stroke-dasharray="80, 200" stroke-linecap="round"></circle>
    </svg> Memverifikasi...`;

    fetch(`${SCRIPT_URL}?action=verify_ticket&ticket=${encodeURIComponent(ticketCode)}`)
      .then(response => {
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        return response.json();
      })
      .then(data => {
        btnVerify.disabled = false;
        btnVerify.innerHTML = 'Verifikasi Tiket & Lanjutkan';

        if (data.result === 'success' && data.valid) {
          // Fill ticket, username, and website in the next form
          formTicket.value = ticketCode;
          if (data.username) {
            formUsername.value = data.username.toUpperCase();
          }
          if (data.website) {
            formWebsite.value = data.website.toUpperCase();
          }

          // Update progress indicator
          step1.classList.add('completed');
          step2.classList.add('active');

          // Transition screen
          transitionCards(cardGate, cardForm);
        } else {
          // Jika tiket sudah pernah digunakan atau dibuka (mengandung kata 'sudah' atau 'kedaluwarsa'),
          // jadikan halaman blank putih total untuk keamanan.
          var reason = data.reason || '';
          if (reason.indexOf('sudah') !== -1 || reason.indexOf('kedaluwarsa') !== -1 || reason.indexOf('digunakan') !== -1) {
            errorMessageEl.textContent = reason;
            transitionCards(cardGate, cardError);
          } else {
            // Add card shaking effect for visual feedback
            cardGate.classList.add('shake');
            setTimeout(() => {
              cardGate.classList.remove('shake');
            }, 500);

            showWarning(
              ticketInput,
              ticketWarning,
              data.reason || 'Tiket tidak valid!'
            );
          }
        }
      })
      .catch(error => {
        console.error('Error verifying ticket:', error);
        btnVerify.disabled = false;
        btnVerify.innerHTML = 'Verifikasi Tiket & Lanjutkan';

        cardGate.classList.add('shake');
        setTimeout(() => {
          cardGate.classList.remove('shake');
        }, 500);

        showWarning(
          ticketInput,
          ticketWarning,
          'Gagal terhubung ke server verifikasi.'
        );
      });
  };

  btnVerify.addEventListener('click', () => {
    const rawTicket = ticketInput.value.toUpperCase().trim();

    // Auto-format format if user missed hyphen but typed correct length
    let formattedTicket = rawTicket;
    if (rawTicket.startsWith('FX') && rawTicket.charAt(2) !== '-' && rawTicket.length === 8) {
      formattedTicket = 'FX-' + rawTicket.substring(2);
      ticketInput.value = formattedTicket;
    }

    if (validateTicket(formattedTicket)) {
      verifyTicketWithBackend(formattedTicket);
    } else {
      // Add card shaking effect for visual feedback on access restriction
      cardGate.classList.add('shake');
      setTimeout(() => {
        cardGate.classList.remove('shake');
      }, 500);

      showWarning(
        ticketInput,
        ticketWarning,
        'Format tiket salah! Akses ditolak.'
      );
    }
  });

  // --- 2. WhatsApp Number Restriction ---

  const restrictToNumbers = (inputEl) => {
    const warningEl = document.getElementById(`${inputEl.id}-warning`);

    // Keypress filter (prevents typing letters directly)
    inputEl.addEventListener('keypress', (e) => {
      // Allow control keys (backspace, delete, arrows)
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter' || e.key === 'Tab') return;

      // Check if character is NOT a digit
      if (!/[0-9]/.test(e.key)) {
        e.preventDefault();
        showWarning(inputEl, warningEl, 'Hanya nomor saja yang bisa diinput!');
      }
    });

    // Input/Paste event filter (to sanitize pasted text or mobile keyboard entries)
    inputEl.addEventListener('input', (e) => {
      const originalValue = inputEl.value;
      // Remove all non-digit characters
      const cleanValue = originalValue.replace(/[^0-9]/g, '');

      if (originalValue !== cleanValue) {
        inputEl.value = cleanValue;
        showWarning(inputEl, warningEl, 'Karakter non-angka otomatis dihapus!');
      }
    });

    // Handle block paste events specifically
    inputEl.addEventListener('paste', (e) => {
      const pasteData = (e.clipboardData || window.clipboardData).getData('text');
      if (!/^\d+$/.test(pasteData)) {
        e.preventDefault();
        // Insert only the digits from the pasted text
        const digitsOnly = pasteData.replace(/[^0-9]/g, '');

        // Insert digits at current cursor selection
        const start = inputEl.selectionStart;
        const end = inputEl.selectionEnd;
        const text = inputEl.value;
        inputEl.value = text.slice(0, start) + digitsOnly + text.slice(end);

        showWarning(inputEl, warningEl, 'Karakter non-angka pada teks tempel dihapus!');
      }
    });
  };

  restrictToNumbers(formWaOld);
  restrictToNumbers(formWaNew);

  // --- 3. Form Submission Handling ---

  btnSubmit.addEventListener('click', (e) => {
    e.preventDefault();

    // Verify all required fields
    if (!formWebsite.value.trim()) {
      showWarning(formWebsite, document.getElementById('form-website-warning'), 'Website harus diisi!');
      return;
    }
    if (!formUsername.value.trim()) {
      showWarning(formUsername, document.getElementById('form-username-warning'), 'Username harus diisi!');
      return;
    }
    if (!formName.value.trim()) {
      showWarning(formName, document.getElementById('form-name-warning'), 'Nama Lengkap harus diisi!');
      return;
    }
    if (formWaOld.value.length < 10) {
      showWarning(formWaOld, document.getElementById('form-wa-old-warning'), 'Nomor WhatsApp minimal 10 digit!');
      return;
    }
    if (formWaNew.value.length < 10) {
      showWarning(formWaNew, document.getElementById('form-wa-new-warning'), 'Nomor WhatsApp minimal 10 digit!');
      return;
    }

    // Visual loading state on button
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<svg class="spinner" width="20" height="20" viewBox="0 0 50 50" style="animation: spin 1s linear infinite; margin-right: 8px;">
      <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="5" stroke-dasharray="80, 200" stroke-linecap="round"></circle>
    </svg> Memproses...`;

    // Prepare URL-encoded form parameters for Google Apps Script Web App
    const formData = new URLSearchParams();
    formData.append('action', 'submit');
    formData.append('ticket', formTicket.value);
    formData.append('website', formWebsite.value.trim().toUpperCase());
    formData.append('username', formUsername.value.trim().toUpperCase());
    formData.append('nama_lengkap', formName.value.trim().toUpperCase());
    formData.append('wa_lama', formWaOld.value);
    formData.append('wa_baru', formWaNew.value);

    // Send data to Google Apps Script
    fetch(SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors', // Bypasses CORS redirect issues from Google Apps Script
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData
    })
      .then(() => {
        // 1. Update progress indicator
        step2.classList.add('completed');
        step3.classList.add('active');

        // 2. Reset button state
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = 'Kirim Permintaan';

        // 3. Transition to success
        transitionCards(cardForm, cardSuccess);
      })
      .catch((error) => {
        console.error('Error submitting to spreadsheet:', error);
        showWarning(btnSubmit, document.getElementById('form-wa-new-warning'), 'Gagal mengirim data. Silakan coba lagi.');
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = 'Kirim Permintaan';
      });
  });

  // --- 4. Reset & Retry Flow ---

  const resetAllFields = () => {
    ticketInput.value = '';
    formWebsite.value = '';
    formUsername.value = '';
    formName.value = '';
    formWaOld.value = '';
    formWaNew.value = '';

    // Reset progress steps
    step1.classList.remove('completed', 'active');
    step2.classList.remove('completed', 'active');
    step3.classList.remove('completed', 'active');
    step1.classList.add('active');
  };

  btnReset.addEventListener('click', () => {
    resetAllFields();
    transitionCards(cardSuccess, cardGate);
  });

  btnErrorRetry.addEventListener('click', () => {
    resetAllFields();
    // Clean up window history search so they don't get stuck in URL verification loop
    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    transitionCards(cardError, cardGate);
  });

  // --- 5. Automatic URL Parameter Check on Load (One-time Access Link Verification) ---

  const checkUrlParameters = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const key = (urlParams.get('k') || urlParams.get('key') || urlParams.get('ticket') || '').toUpperCase().trim();

    if (key) {
      // Verifikasi kunci akses sekali pakai & tiket langsung dari URL
      fetch(`${SCRIPT_URL}?action=verify_link&key=${encodeURIComponent(key)}`)
        .then(response => {
          if (!response.ok) {
            throw new Error('Network response was not ok');
          }
          return response.json();
        })
        .then(data => {
          if (data.result === 'success' && data.valid) {
            // Auto-fill data tiket, username, & website
            formTicket.value = data.ticket || key;
            if (data.username) {
              formUsername.value = data.username.toUpperCase();
            }
            if (data.website) {
              formWebsite.value = data.website.toUpperCase();
            }

            // Update progress indicator (langsung lompat ke Step 2)
            step1.classList.add('completed');
            step2.classList.add('active');

            // Langsung buka form pengisian data (cardForm) tanpa perlu input tiket manual!
            cardGate.classList.add('hidden');
            cardForm.classList.remove('hidden');
          } else {
            // Jika link akses sudah kedaluwarsa atau tidak valid, tampilkan kartu error
            errorMessageEl.textContent = data.reason || 'Tiket tidak valid atau tautan portal sudah kedaluwarsa.';
            cardGate.classList.add('hidden');
            cardForm.classList.add('hidden');
            cardSuccess.classList.add('hidden');
            cardError.classList.remove('hidden');
          }
        })
        .catch(error => {
          console.error('Error auto-verifying link key:', error);
          // Jika terjadi kesalahan koneksi, izinkan input manual via cardGate
          cardGate.classList.remove('hidden');
        });
    } else {
      // Jika diakses langsung tanpa kunci (?k=...), tampilkan halaman verifikasi tiket manual (cardGate)
      cardGate.classList.remove('hidden');
    }
  };

  // Run the URL parameter check immediately on load
  checkUrlParameters();
});

// CSS spin animation for loader
const styleSheet = document.createElement("style");
styleSheet.innerText = `
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}`;
document.head.appendChild(styleSheet);
