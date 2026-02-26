import { renderDishList } from './pages/dishList.js';
import { renderDishForm } from './pages/dishForm.js';
import { renderDishView } from './pages/dishView.js';
import { renderMenuList } from './pages/menuList.js';
import { renderMenuBuilder } from './pages/menuBuilder.js';
import { renderTodoView } from './pages/todoView.js';
import { renderSpecials } from './pages/specials.js';
import { renderServiceNotes } from './pages/serviceNotes.js';
import { renderFlavorPairings } from './pages/flavorPairings.js';
import { renderSettings } from './pages/settings.js';
import { openUnitConverter } from './components/unitConverter.js';
import { renderLogin } from './pages/login.js';
import { authStatus, authLogout } from './api.js';
import { connectSync } from './sync.js';

const appContent = document.getElementById('app-content');

let isAuthenticated = false;

const routes = [
  { pattern: /^#\/dishes\/new$/, handler: () => renderDishForm(appContent, null) },
  { pattern: /^#\/dishes\/(\d+)\/edit$/, handler: (m) => renderDishForm(appContent, m[1]) },
  { pattern: /^#\/dishes\/(\d+)$/, handler: (m) => renderDishView(appContent, m[1]) },
  { pattern: /^#\/dishes$/, handler: () => renderDishList(appContent) },
  { pattern: /^#\/specials$/, handler: () => renderSpecials(appContent) },
  { pattern: /^#\/service-notes$/, handler: () => renderServiceNotes(appContent) },
  { pattern: /^#\/flavor-pairings$/, handler: () => renderFlavorPairings(appContent) },
  { pattern: /^#\/settings$/, handler: () => renderSettings(appContent) },
  { pattern: /^#\/todos$/, handler: () => renderTodoView(appContent, null) },
  { pattern: /^#\/menus\/(\d+)\/todos$/, handler: (m) => renderTodoView(appContent, m[1]) },
  { pattern: /^#\/menus\/(\d+)$/, handler: (m) => renderMenuBuilder(appContent, m[1]) },
  { pattern: /^#\/menus$/, handler: () => renderMenuList(appContent) },
  { pattern: /^#?\/?$/, handler: () => renderMenuList(appContent) },
];

async function checkAuth() {
  try {
    const data = await authStatus();

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
  const revealBtn = document.getElementById('sidebar-reveal-btn');

  if (nav) nav.style.display = authed ? '' : 'none';
  if (bottomNav) bottomNav.style.display = authed ? '' : 'none';
  if (logoutBtn) logoutBtn.style.display = authed ? '' : 'none';
  if (revealBtn) revealBtn.style.display = authed ? '' : 'none';
}

async function handleLogout() {
  try { await authLogout(); } catch {}
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

const _sunSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
const _moonSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

function updateThemeIcon() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const icon = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');
  const btn = document.getElementById('theme-toggle');
  if (icon) icon.innerHTML = isDark ? _sunSvg : _moonSvg;
  if (label) label.textContent = isDark ? 'Light mode' : 'Dark mode';
  if (btn) btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
}

// Sidebar state management
const _collapseIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>`;
const _expandIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>`;

function initSidebar() {
  const saved = localStorage.getItem('sidebarState') || 'expanded';
  document.documentElement.setAttribute('data-sidebar', saved);
  updateSidebarToggleBtn();
}

function setSidebarState(state) {
  document.documentElement.setAttribute('data-sidebar', state);
  localStorage.setItem('sidebarState', state);
  updateSidebarToggleBtn();
}

function updateSidebarToggleBtn() {
  const btn = document.getElementById('sidebar-toggle-btn');
  if (!btn) return;
  const state = document.documentElement.getAttribute('data-sidebar');
  if (state === 'expanded') {
    btn.innerHTML = _collapseIcon;
    btn.title = 'Collapse sidebar';
    btn.setAttribute('aria-label', 'Collapse sidebar');
  } else {
    btn.innerHTML = _expandIcon;
    btn.title = 'Expand sidebar';
    btn.setAttribute('aria-label', 'Expand sidebar');
  }
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initSidebar();
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
  document.getElementById('bottom-logout-btn')?.addEventListener('click', handleLogout);
  document.getElementById('unit-converter-nav-btn')?.addEventListener('click', () => openUnitConverter());
  document.getElementById('sidebar-toggle-btn')?.addEventListener('click', () => {
    const state = document.documentElement.getAttribute('data-sidebar');
    setSidebarState(state === 'expanded' ? 'collapsed' : 'expanded');
  });
  document.getElementById('sidebar-close-btn')?.addEventListener('click', () => setSidebarState('hidden'));
  document.getElementById('sidebar-reveal-btn')?.addEventListener('click', () => setSidebarState('expanded'));

  const authed = await checkAuth();
  if (authed) {
    connectSync();
    router();
  }
});
