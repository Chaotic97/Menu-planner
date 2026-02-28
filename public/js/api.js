import { getClientId } from './sync.js';

const BASE = '/api';

async function request(path, options = {}) {
  const url = `${BASE}${path}`;
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };

  // Add sync client ID header
  try {
    config.headers['X-Client-Id'] = getClientId();
  } catch {}

  if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
    config.body = JSON.stringify(config.body);
  }

  // Don't set Content-Type for FormData (browser sets it with boundary)
  if (options.body instanceof FormData) {
    delete config.headers['Content-Type'];
  }

  const res = await fetch(url, config);
  if (res.status === 401) {
    window.location.hash = '#/login';
    window.location.reload();
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

// Dishes
export const getDishes = (params) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/dishes${qs ? '?' + qs : ''}`);
};
export const getDish = (id) => request(`/dishes/${id}`);
export const createDish = (data) => request('/dishes', { method: 'POST', body: data });
export const updateDish = (id, data) => request(`/dishes/${id}`, { method: 'PUT', body: data });
export const deleteDish = (id) => request(`/dishes/${id}`, { method: 'DELETE' });
export const restoreDish = (id) => request(`/dishes/${id}/restore`, { method: 'POST' });
export const duplicateDish = (id) => request(`/dishes/${id}/duplicate`, { method: 'POST' });
export const toggleFavorite = (id) => request(`/dishes/${id}/favorite`, { method: 'POST' });
export const importRecipeFromUrl = (url) => request('/dishes/import-url', { method: 'POST', body: { url } });
export const importRecipeFromDocx = (formData) => request('/dishes/import-docx', { method: 'POST', body: formData });
export const bulkImportDocx = (formData) => request('/dishes/bulk-import-docx', { method: 'POST', body: formData });
export const uploadDishPhoto = (id, formData) => request(`/dishes/${id}/photo`, { method: 'POST', body: formData });
export const deleteDishPhoto = (id) => request(`/dishes/${id}/photo`, { method: 'DELETE' });
export const updateDishAllergen = (id, data) => request(`/dishes/${id}/allergens`, { method: 'POST', body: data });

// Tags
export const getAllTags = () => request('/dishes/tags/all');

// Ingredients
export const getIngredients = (search) => {
  const qs = search ? `?search=${encodeURIComponent(search)}` : '';
  return request(`/ingredients${qs}`);
};
export const createIngredient = (data) => request('/ingredients', { method: 'POST', body: data });
export const updateIngredient = (id, data) => request(`/ingredients/${id}`, { method: 'PUT', body: data });
export const updateIngredientStock = (id, inStock) => request(`/ingredients/${id}/stock`, { method: 'PUT', body: { in_stock: inStock } });
export const clearAllStock = () => request('/ingredients/clear-stock', { method: 'POST' });

// Menus
export const getMenus = () => request('/menus');
export const getMenu = (id) => request(`/menus/${id}`);
export const createMenu = (data) => request('/menus', { method: 'POST', body: data });
export const updateMenu = (id, data) => request(`/menus/${id}`, { method: 'PUT', body: data });
export const deleteMenu = (id) => request(`/menus/${id}`, { method: 'DELETE' });
export const restoreMenu = (id) => request(`/menus/${id}/restore`, { method: 'POST' });
export const addDishToMenu = (menuId, data) => request(`/menus/${menuId}/dishes`, { method: 'POST', body: data });
export const updateMenuDish = (menuId, dishId, data) => request(`/menus/${menuId}/dishes/${dishId}`, { method: 'PUT', body: data });
export const removeDishFromMenu = (menuId, dishId) => request(`/menus/${menuId}/dishes/${dishId}`, { method: 'DELETE' });
export const reorderMenuDishes = (menuId, order) => request(`/menus/${menuId}/dishes/reorder`, { method: 'PUT', body: { order } });
export const getMenuKitchenPrint = (menuId) => request(`/menus/${menuId}/kitchen-print`);

// Todos (legacy menu-based endpoints)
export const getShoppingList = (menuId) => request(`/todos/menu/${menuId}/shopping-list`);
export const getScaledShoppingList = (menuId, covers) => request(`/todos/menu/${menuId}/scaled-shopping-list?covers=${covers}`);
export const getPrepTasks = (menuId) => request(`/todos/menu/${menuId}/prep-tasks`);

// Tasks (persistent task system)
export const generateTasks = (menuId, options = {}) => request(`/todos/generate/${menuId}`, { method: 'POST', body: options });
export const getTasks = (params = {}) => {
  const filtered = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''));
  const qs = new URLSearchParams(filtered).toString();
  return request(`/todos${qs ? '?' + qs : ''}`);
};
export const createTask = (data) => request('/todos', { method: 'POST', body: data });
export const updateTask = (id, data) => request(`/todos/${id}`, { method: 'PUT', body: data });
export const deleteTask = (id) => request(`/todos/${id}`, { method: 'DELETE' });
export const batchCompleteTasks = (taskIds, completed) => request('/todos/batch-complete', { method: 'POST', body: { task_ids: taskIds, completed } });

// Today
export const getTodayData = (date) => {
  const qs = date ? `?date=${date}` : '';
  return request(`/today${qs}`);
};
export const getTodaySummary = (date) => {
  const qs = date ? `?date=${date}` : '';
  return request(`/today/summary${qs}`);
};
export const getDayPhases = () => request('/today/day-phases');
export const updateDayPhases = (phases) => request('/today/day-phases', { method: 'PUT', body: { phases } });
export const setTaskNext = (id) => request(`/todos/${id}/next`, { method: 'PUT' });
export const clearTaskNext = () => request('/todos/next', { method: 'DELETE' });

// Allergen keywords
export const getAllergenKeywords = () => request('/dishes/allergen-keywords/all');
export const addAllergenKeyword = (data) => request('/dishes/allergen-keywords', { method: 'POST', body: data });
export const deleteAllergenKeyword = (id) => request(`/dishes/allergen-keywords/${id}`, { method: 'DELETE' });

// Notifications
export const getNotificationPreferences = () => request('/notifications/preferences');
export const updateNotificationPreferences = (prefs) => request('/notifications/preferences', { method: 'PUT', body: prefs });
export const getNotificationPending = () => request('/notifications/pending');

// Auth — public endpoints (no 401 redirect)
async function authRequest(path, options = {}) {
  const url = `${BASE}${path}`;
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };
  if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
    config.body = JSON.stringify(config.body);
  }
  const res = await fetch(url, config);
  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

export const authStatus = () => authRequest('/auth/status');
export const authLogin = (data) => authRequest('/auth/login', { method: 'POST', body: data });
export const authSetup = (data) => authRequest('/auth/setup', { method: 'POST', body: data });
export const authForgot = (data) => authRequest('/auth/forgot', { method: 'POST', body: data });
export const authReset = (data) => authRequest('/auth/reset', { method: 'POST', body: data });
export const authLogout = () => authRequest('/auth/logout', { method: 'POST' });
export const changePassword = (data) => request('/auth/change-password', { method: 'POST', body: data });

// Service Notes
export const getServiceNotes = (params) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/service-notes${qs ? '?' + qs : ''}`);
};
export const getServiceNoteDates = (params) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/service-notes/dates${qs ? '?' + qs : ''}`);
};
export const createServiceNote = (data) => request('/service-notes', { method: 'POST', body: data });
export const updateServiceNote = (id, data) => request(`/service-notes/${id}`, { method: 'PUT', body: data });
export const deleteServiceNote = (id) => request(`/service-notes/${id}`, { method: 'DELETE' });

// Weekly Specials
export const getSpecials = (params) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/menus/specials/list${qs ? '?' + qs : ''}`);
};
export const createSpecial = (data) => request('/menus/specials', { method: 'POST', body: data });
export const updateSpecial = (id, data) => request(`/menus/specials/${id}`, { method: 'PUT', body: data });
export const deleteSpecial = (id) => request(`/menus/specials/${id}`, { method: 'DELETE' });
