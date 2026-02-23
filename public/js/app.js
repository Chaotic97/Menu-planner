import { renderDishList } from './pages/dishList.js';
import { renderDishForm } from './pages/dishForm.js';
import { renderMenuList } from './pages/menuList.js';
import { renderMenuBuilder } from './pages/menuBuilder.js';
import { renderTodoView } from './pages/todoView.js';
import { renderSpecials } from './pages/specials.js';
import { renderServiceNotes } from './pages/serviceNotes.js';
import { renderFlavorPairings } from './pages/flavorPairings.js';
import { openUnitConverter } from './components/unitConverter.js';
import { renderLogin } from './pages/login.js';
import { connectSync } from './sync.js';

const appContent = document.getElementById('app-content');

let isAuthenticated = false;

const routes = [
  { pattern: /^#\/dishes\/new$/, handler: () => renderDishForm(appContent, null) },
  { pattern: /^#\/dishes\/(\d+)\/edit$/, handler: (m) => renderDishForm(appContent, m[1]) },
  { pattern: /^#\/dishes$/, handler: () => renderDishList(appContent) },
  { pattern: /^#\/specials$/, handler: () => renderSpecials(appContent) },
  { pattern: /^#\/service-notes$/, handler: () => renderServiceNotes(appContent) },
  { pattern: /^#\/flavor-pairings$/, handler: () => renderFlavorPairings(appContent) },
  { pattern: /^#\/menus\/(\d+)\/todos$/, handler: (m) => renderTodoView(appContent, m[1]) },
  { pattern: /^#\/menus\/(\d+)$/, handler: (m) => renderMenuBuilder(appContent, m[1]) },
  { pattern: /^#\/menus$/, handler: () => renderMenuList(appContent) },
  { pattern: /^#?\/?$/, handler: () => renderMenuList(appContent) },
];

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/status');
    const data = await res.json();

    if (!data.isSetup) {
      showAuthUI(false);
      renderLogin(appContent, 'setup');
      return false;
    }

    if (!data.isAuthenticated) {
      showAuthUI(false);
      renderLogin(appContent, 'login');
      return false;
    }

    showAuthUI(true);
    return true;
  } catch {
    showAuthUI(false);
    renderLogin(appContent, 'login');
    return false;
  }
}

function showAuthUI(authed) {
  isAuthenticated = authed;
  const nav = document.querySelector('.top-nav');
  const bottomNav = document.getElementById('bottom-nav');
  const logoutBtn = document.getElementById('logout-btn');

  if (nav) nav.style.display = authed ? '' : 'none';
  if (bottomNav) bottomNav.style.display = authed ? '' : 'none';
  if (logoutBtn) logoutBtn.style.display = authed ? '' : 'none';
}

async function handleLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.hash = '#/login';
  window.location.reload();
}

function updateActiveNav(hash) {
  // Top nav links
  document.querySelectorAll('.nav-link').forEach(link => {
    const href = link.getAttribute('href');
    link.classList.toggle('active',
      href === hash || (hash.startsWith(href) && href !== '#/')
    );
  });

  // Bottom nav links
  document.querySelectorAll('.bottom-nav-link[data-route]').forEach(link => {
    const route = link.getAttribute('data-route');
    const isActive = hash === `#${route}` || (hash.startsWith(`#${route}`) && route !== '#/');
    link.classList.toggle('active', isActive);
  });
}

async function router() {
  const hash = window.location.hash || '#/menus';

  // Handle reset-password route (no auth needed)
  if (hash.startsWith('#/reset-password')) {
    showAuthUI(false);
    renderLogin(appContent, 'reset');
    return;
  }

  // Handle login route
  if (hash === '#/login') {
    showAuthUI(false);
    renderLogin(appContent, 'login');
    return;
  }

  // Check auth for all other routes
  if (!isAuthenticated) {
    const authed = await checkAuth();
    if (!authed) return;
  }

  updateActiveNav(hash);

  for (const route of routes) {
    const match = hash.match(route.pattern);
    if (match) {
      route.handler(match);
      return;
    }
  }

  renderMenuList(appContent);
}

// Dark mode
function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
  }
  updateThemeIcon();
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeIcon();
}

function updateThemeIcon() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  btn.innerHTML = isDark ? '&#9788;' : '&#9790;';
  btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
  document.getElementById('bottom-logout-btn')?.addEventListener('click', handleLogout);
  document.getElementById('unit-converter-nav-btn')?.addEventListener('click', () => openUnitConverter());

  const authed = await checkAuth();
  if (authed) {
    connectSync();
    router();
  }
});
