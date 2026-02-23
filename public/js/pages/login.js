export function renderLogin(container, mode = 'login') {
  // mode: 'setup', 'login', 'forgot', 'reset'
  const token = new URLSearchParams(window.location.hash.split('?')[1] || '').get('token');

  if (token) mode = 'reset';

  container.innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <h1 class="login-title">Menu Planner</h1>
        <p class="login-subtitle" id="login-subtitle"></p>

        <form id="auth-form" class="login-form">
          <div id="form-fields"></div>
          <div class="login-error" id="login-error"></div>
          <button type="submit" class="btn btn-primary login-btn" id="submit-btn"></button>
        </form>

        <div class="login-links" id="login-links"></div>
      </div>
    </div>
  `;

  const form = document.getElementById('auth-form');
  const fields = document.getElementById('form-fields');
  const error = document.getElementById('login-error');
  const subtitle = document.getElementById('login-subtitle');
  const submitBtn = document.getElementById('submit-btn');
  const links = document.getElementById('login-links');

  function showError(msg) {
    error.textContent = msg;
    error.style.display = msg ? 'block' : 'none';
  }

  function renderMode(m) {
    mode = m;
    showError('');

    if (mode === 'setup') {
      subtitle.textContent = 'Set up your password to get started';
      fields.innerHTML = `
        <div class="form-group">
          <label for="setup-password">Password</label>
          <input type="password" id="setup-password" placeholder="Min 6 characters" required minlength="6" autocomplete="new-password">
        </div>
        <div class="form-group">
          <label for="setup-confirm">Confirm Password</label>
          <input type="password" id="setup-confirm" placeholder="Confirm password" required minlength="6" autocomplete="new-password">
        </div>
        <div class="form-group">
          <label for="setup-email">Recovery Email</label>
          <input type="email" id="setup-email" placeholder="For password recovery" required autocomplete="email">
        </div>
      `;
      submitBtn.textContent = 'Create Password';
      links.innerHTML = '';

    } else if (mode === 'login') {
      subtitle.textContent = 'Enter your password to continue';
      fields.innerHTML = `
        <div class="form-group">
          <label for="login-password">Password</label>
          <input type="password" id="login-password" placeholder="Enter password" required autocomplete="current-password">
        </div>
      `;
      submitBtn.textContent = 'Log In';
      links.innerHTML = `<a href="#" id="forgot-link">Forgot password?</a>`;
      document.getElementById('forgot-link').addEventListener('click', (e) => {
        e.preventDefault();
        renderMode('forgot');
      });

    } else if (mode === 'forgot') {
      subtitle.textContent = 'Enter your recovery email';
      fields.innerHTML = `
        <div class="form-group">
          <label for="forgot-email">Recovery Email</label>
          <input type="email" id="forgot-email" placeholder="Your recovery email" required autocomplete="email">
        </div>
      `;
      submitBtn.textContent = 'Send Reset Link';
      links.innerHTML = `<a href="#" id="back-login">Back to login</a>`;
      document.getElementById('back-login').addEventListener('click', (e) => {
        e.preventDefault();
        renderMode('login');
      });

    } else if (mode === 'reset') {
      subtitle.textContent = 'Set your new password';
      fields.innerHTML = `
        <div class="form-group">
          <label for="reset-password">New Password</label>
          <input type="password" id="reset-password" placeholder="Min 6 characters" required minlength="6" autocomplete="new-password">
        </div>
        <div class="form-group">
          <label for="reset-confirm">Confirm Password</label>
          <input type="password" id="reset-confirm" placeholder="Confirm password" required minlength="6" autocomplete="new-password">
        </div>
      `;
      submitBtn.textContent = 'Reset Password';
      links.innerHTML = `<a href="#" id="back-login">Back to login</a>`;
      document.getElementById('back-login').addEventListener('click', (e) => {
        e.preventDefault();
        window.location.hash = '#/login';
        renderMode('login');
      });
    }

    // Focus the first input
    const firstInput = fields.querySelector('input');
    if (firstInput) setTimeout(() => firstInput.focus(), 50);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    submitBtn.disabled = true;

    try {
      if (mode === 'setup') {
        const password = document.getElementById('setup-password').value;
        const confirm = document.getElementById('setup-confirm').value;
        const email = document.getElementById('setup-email').value;

        if (password !== confirm) {
          showError('Passwords do not match.');
          submitBtn.disabled = false;
          return;
        }

        const res = await fetch('/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password, email }),
        });
        const data = await res.json();

        if (!res.ok) {
          showError(data.error);
          submitBtn.disabled = false;
          return;
        }

        window.location.hash = '#/menus';
        window.location.reload();

      } else if (mode === 'login') {
        const password = document.getElementById('login-password').value;

        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        const data = await res.json();

        if (!res.ok) {
          showError(data.error);
          submitBtn.disabled = false;
          return;
        }

        window.location.hash = '#/menus';
        window.location.reload();

      } else if (mode === 'forgot') {
        const email = document.getElementById('forgot-email').value;

        const res = await fetch('/api/auth/forgot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();

        if (!res.ok) {
          showError(data.error);
          submitBtn.disabled = false;
          return;
        }

        showError('');
        subtitle.textContent = '';
        fields.innerHTML = `<p class="login-success">If that email matches our records, a reset link has been sent. Check your inbox.</p>`;
        submitBtn.style.display = 'none';
        links.innerHTML = `<a href="#" id="back-login">Back to login</a>`;
        document.getElementById('back-login').addEventListener('click', (e) => {
          e.preventDefault();
          submitBtn.style.display = '';
          renderMode('login');
        });

      } else if (mode === 'reset') {
        const password = document.getElementById('reset-password').value;
        const confirm = document.getElementById('reset-confirm').value;

        if (password !== confirm) {
          showError('Passwords do not match.');
          submitBtn.disabled = false;
          return;
        }

        const res = await fetch('/api/auth/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password }),
        });
        const data = await res.json();

        if (!res.ok) {
          showError(data.error);
          submitBtn.disabled = false;
          return;
        }

        showError('');
        subtitle.textContent = '';
        fields.innerHTML = `<p class="login-success">Password reset successfully! You can now log in.</p>`;
        submitBtn.style.display = 'none';
        links.innerHTML = `<a href="#" id="back-login">Go to login</a>`;
        document.getElementById('back-login').addEventListener('click', (e) => {
          e.preventDefault();
          window.location.hash = '#/login';
          submitBtn.style.display = '';
          renderMode('login');
        });
      }
    } catch (err) {
      showError('Something went wrong. Please try again.');
      submitBtn.disabled = false;
    }
  });

  renderMode(mode);
}
