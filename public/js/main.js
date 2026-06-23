const loginSection = document.getElementById('loginSection');
const appSection = document.getElementById('appSection');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const userMenu = document.getElementById('userMenu');
const userRole = document.getElementById('userRole');
const logoutButton = document.getElementById('logoutButton');
const navButtons = Array.from(document.querySelectorAll('.nav-button'));
const ownerOnlyElements = Array.from(document.querySelectorAll('.owner-only'));

let currentUser = null;
let currentSection = 'dashboard';

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function showElement(element) {
  element.classList.remove('hidden');
}

function hideElement(element) {
  element.classList.add('hidden');
}

function setActiveSection(sectionId) {
  currentSection = sectionId;
  document.querySelectorAll('.content-panel').forEach((panel) => {
    panel.classList.toggle('hidden', panel.id !== `${sectionId}Section`);
  });
  navButtons.forEach((button) => button.classList.toggle('active', button.dataset.section === sectionId));
}

function renderUser() {
  if (!currentUser) return;
  userRole.textContent = `${currentUser.name} (${currentUser.role})`;
  if (currentUser.role !== 'owner') {
    ownerOnlyElements.forEach((item) => item.classList.add('hidden'));
  } else {
    ownerOnlyElements.forEach((item) => item.classList.remove('hidden'));
  }
}

async function loadUser() {
  try {
    const user = await requestJson('/api/user');
    currentUser = user;
    loginSection.classList.add('hidden');
    appSection.classList.remove('hidden');
    userMenu.classList.remove('hidden');
    renderUser();
    setActiveSection('dashboard');
    await loadDashboard();
    await loadProducts();
    await loadCustomers();
    await loadSales();
    loadSaleFormOptions();
    loadMovementHistory();
    setDefaultDates();
    if (currentUser.role === 'owner') {
      await loadReports();
    }
  } catch (error) {
    loginSection.classList.remove('hidden');
    appSection.classList.add('hidden');
    userMenu.classList.add('hidden');
  }
}

function setDefaultDates() {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('saleDate').value = today;
  document.getElementById('stockInDate').value = today;
  document.getElementById('stockOutDate').value = today;
}

async function handleLogin(event) {
  event.preventDefault();
  loginError.textContent = '';
  hideElement(loginError);
  const formData = new FormData(loginForm);
  try {
    await requestJson('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: formData.get('email'),
        password: formData.get('password')
      })
    });
    await loadUser();
  } catch (error) {
    loginError.textContent = error.message;
    showElement(loginError);
  }
}

async function handleLogout() {
  await fetch('/api/logout', { method: 'POST' });
  currentUser = null;
  appSection.classList.add('hidden');
  loginSection.classList.remove('hidden');
  userMenu.classList.add('hidden');
}

async function loadDashboard() {
  try {
    const data = await requestJson('/api/dashboard');
    const cards = document.getElementById('dashboardCards');
    cards.innerHTML = `
      <div class="card summary-card"><h3>Total inventory items</h3><p>${data.totalItems}</p></div>
      <div class="card summary-card"><h3>Total inventory quantity</h3><p>${data.totalQuantity}</p></div>
      <div class="card summary-card"><h3>Sales today</h3><p>${formatCurrency(data.salesToday)}</p></div>
      <div class="card summary-card"><h3>Sales this month</h3><p>${formatCurrency(data.salesMonth)}</p></div>
      <div class="card summary-card"><h3>Transactions today</h3><p>${data.transactionsToday}</p></div>
    `;

    const lowStockContainer = document.getElementById('lowStockContainer');
    if (data.lowStock.length) {
      lowStockContainer.innerHTML = `<table><thead><tr><th>Product</th><th>Stock</th><th>Minimum</th></tr></thead><tbody>${data.lowStock.map(item => `<tr><td>${item.name}</td><td>${item.stock}</td><td>${item.minimum_stock}</td></tr>`).join('')}</tbody></table>`;
    } else {
      lowStockContainer.innerHTML = '<p>No low stock items detected.</p>';
    }
  } catch (error) {
    console.error('Failed to load dashboard', error);
  }
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

async function loadProducts() {
  const query = document.getElementById('productSearch').value;
  const active = document.getElementById('productActiveFilter').value;
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (active !== '') params.set('active', active);
  const products = await requestJson(`/api/products?${params.toString()}`);
  const body = document.getElementById('productTableBody');
  body.innerHTML = products.map(product => `
      <tr>
        <td>${product.sku}</td>
        <td>${product.name}</td>
        <td>${product.category}</td>
        <td>${formatCurrency(product.selling_price)}</td>
        <td>${product.stock}</td>
        <td>${product.minimum_stock}</td>
        <td>${product.active ? 'Active' : 'Inactive'}</td>
        <td class="owner-only">${currentUser.role === 'owner' ? `<button class="button button-small" data-id="${product.id}" data-action="edit-product">Edit</button><button class="button button-tertiary" data-id="${product.id}" data-action="delete-product">Delete</button>` : ''}</td>
      </tr>
    `).join('');

  renderProductForm();
  await populateStockOptions();
}

function renderProductForm(product = null) {
  const container = document.getElementById('productFormContainer');
  if (currentUser.role !== 'owner') {
    container.innerHTML = '<p>Owner can manage product definitions.</p>';
    return;
  }
  container.innerHTML = `
    <form id="productForm" class="form-grid">
      <h3>${product ? 'Edit product' : 'Add product'}</h3>
      <label>SKU <input name="sku" value="${product ? product.sku : ''}" required /></label>
      <label>Name <input name="name" value="${product ? product.name : ''}" required /></label>
      <label>Category <input name="category" value="${product ? product.category : ''}" required /></label>
      <label>Unit <input name="unit" value="${product ? product.unit : ''}" required /></label>
      <label>Price <input type="number" name="selling_price" step="0.01" min="0" value="${product ? product.selling_price : '0.00'}" required /></label>
      <label>Stock <input type="number" name="stock" min="0" value="${product ? product.stock : '0'}" required /></label>
      <label>Minimum stock <input type="number" name="minimum_stock" min="0" value="${product ? product.minimum_stock : '0'}" required /></label>
      <label>Active <select name="active"><option value="1" ${product && product.active ? 'selected' : ''}>Active</option><option value="0" ${product && !product.active ? 'selected' : ''}>Inactive</option></select></label>
      <div class="form-actions"><button type="submit" class="button button-primary">${product ? 'Update product' : 'Add product'}</button>${product ? '<button type="button" id="cancelProduct" class="button button-tertiary">Cancel</button>' : ''}<div id="productMessage" class="form-note"></div></div>
    </form>
  `;
  const form = document.getElementById('productForm');
  form.onsubmit = async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = {
      sku: formData.get('sku'),
      name: formData.get('name'),
      category: formData.get('category'),
      unit: formData.get('unit'),
      selling_price: formData.get('selling_price'),
      stock: formData.get('stock'),
      minimum_stock: formData.get('minimum_stock'),
      active: formData.get('active') === '1'
    };
    try {
      if (product) {
        await requestJson(`/api/products/${product.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      } else {
        await requestJson('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      }
      document.getElementById('productMessage').textContent = 'Saved successfully';
      setTimeout(() => document.getElementById('productMessage').textContent = '', 2500);
      renderProductForm();
      await loadProducts();
      await loadDashboard();
    } catch (error) {
      document.getElementById('productMessage').textContent = error.message;
    }
  };
  const cancelButton = document.getElementById('cancelProduct');
  if (cancelButton) {
    cancelButton.onclick = () => renderProductForm();
  }
}

async function loadCustomers() {
  const query = document.getElementById('customerSearch').value;
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  const customers = await requestJson(`/api/customers?${params.toString()}`);
  const body = document.getElementById('customerTableBody');
  body.innerHTML = customers.map(customer => `
      <tr>
        <td>${customer.name}</td>
        <td>${customer.phone || '-'}</td>
        <td>${customer.address || '-'}</td>
        <td>${customer.customer_type}</td>
        <td class="owner-only">${currentUser.role === 'owner' ? `<button class="button button-small" data-id="${customer.id}" data-action="edit-customer">Edit</button>` : ''}</td>
      </tr>
    `).join('');
  renderCustomerForm();
}

function renderCustomerForm(customer = null) {
  const container = document.getElementById('customerFormContainer');
  if (currentUser.role !== 'owner') {
    container.innerHTML = '<p>Owner can manage customer records.</p>';
    return;
  }
  container.innerHTML = `
    <form id="customerForm" class="form-grid">
      <h3>${customer ? 'Edit customer' : 'Add customer'}</h3>
      <label>Name <input name="name" value="${customer ? customer.name : ''}" required /></label>
      <label>Phone <input name="phone" value="${customer ? customer.phone : ''}" /></label>
      <label>Address <input name="address" value="${customer ? customer.address : ''}" /></label>
      <label>Type <select name="customer_type"><option value="Reseller" ${customer && customer.customer_type === 'Reseller' ? 'selected' : ''}>Reseller</option><option value="Restaurant" ${customer && customer.customer_type === 'Restaurant' ? 'selected' : ''}>Restaurant</option><option value="Distributor" ${customer && customer.customer_type === 'Distributor' ? 'selected' : ''}>Distributor</option><option value="Retail" ${customer && customer.customer_type === 'Retail' ? 'selected' : ''}>Retail</option></select></label>
      <div class="form-actions"><button type="submit" class="button button-primary">${customer ? 'Update customer' : 'Add customer'}</button>${customer ? '<button type="button" id="cancelCustomer" class="button button-tertiary">Cancel</button>' : ''}<div id="customerMessage" class="form-note"></div></div>
    </form>
  `;
  const form = document.getElementById('customerForm');
  form.onsubmit = async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = {
      name: formData.get('name'),
      phone: formData.get('phone'),
      address: formData.get('address'),
      customer_type: formData.get('customer_type')
    };
    try {
      if (customer) {
        await requestJson(`/api/customers/${customer.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      } else {
        await requestJson('/api/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      }
      document.getElementById('customerMessage').textContent = 'Saved successfully';
      setTimeout(() => document.getElementById('customerMessage').textContent = '', 2500);
      renderCustomerForm();
      await loadCustomers();
      await loadSaleFormOptions();
    } catch (error) {
      document.getElementById('customerMessage').textContent = error.message;
    }
  };
  const cancelButton = document.getElementById('cancelCustomer');
  if (cancelButton) {
    cancelButton.onclick = () => renderCustomerForm();
  }
}

async function loadSaleFormOptions() {
  const customers = await requestJson('/api/customers');
  const products = await requestJson('/api/products?active=1');
  const customerSelect = document.getElementById('saleCustomer');
  const productSelect = document.getElementById('saleProduct');
  customerSelect.innerHTML = customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  productSelect.innerHTML = products.map(p => `<option value="${p.id}">${p.name} (${p.sku})</option>`).join('');
  const inProduct = document.getElementById('stockInProduct');
  const outProduct = document.getElementById('stockOutProduct');
  if (inProduct) inProduct.innerHTML = productSelect.innerHTML;
  if (outProduct) outProduct.innerHTML = productSelect.innerHTML;
}

async function populateStockOptions() {
  await loadSaleFormOptions();
}

async function loadSales() {
  const search = document.getElementById('salesSearch').value;
  const start = document.getElementById('salesFilterFrom').value;
  const end = document.getElementById('salesFilterTo').value;
  const params = new URLSearchParams();
  if (search) params.set('q', search);
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  const sales = await requestJson(`/api/sales?${params.toString()}`);
  const body = document.getElementById('salesTableBody');
  body.innerHTML = sales.map(item => `
      <tr>
        <td>${item.transaction_date}</td>
        <td>${item.customer_name}</td>
        <td>${item.product_name}</td>
        <td>${item.quantity}</td>
        <td>${formatCurrency(item.subtotal)}</td>
        <td>${item.status}</td>
      </tr>
    `).join('');
}

async function loadMovementHistory() {
  const query = document.getElementById('movementSearch').value;
  const type = document.getElementById('movementTypeFilter').value;
  const start = document.getElementById('movementStart').value;
  const end = document.getElementById('movementEnd').value;
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (type) params.set('type', type);
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  const rows = await requestJson(`/api/stock-movements?${params.toString()}`);
  const body = document.getElementById('movementTableBody');
  body.innerHTML = rows.map(row => `
      <tr>
        <td>${row.date}</td>
        <td>${row.product}</td>
        <td>${row.movement_type}</td>
        <td>${row.quantity}</td>
        <td>${row.reference || '-'}</td>
        <td>${row.notes || '-'}</td>
      </tr>
    `).join('');
}

async function loadReports() {
  try {
    const data = await requestJson('/api/reports');
    const cards = document.getElementById('reportCards');
    cards.innerHTML = `
      <div class="card summary-card"><h3>Sales today</h3><p>${formatCurrency(data.salesToday)}</p></div>
      <div class="card summary-card"><h3>Sales this week</h3><p>${formatCurrency(data.salesWeek)}</p></div>
      <div class="card summary-card"><h3>Sales this month</h3><p>${formatCurrency(data.salesMonth)}</p></div>
    `;
    document.getElementById('bestProductsBody').innerHTML = data.bestProducts.map(item => `<tr><td>${item.name}</td><td>${item.quantity_sold || 0}</td><td>${formatCurrency(item.revenue || 0)}</td></tr>`).join('');
    document.getElementById('topCustomersBody').innerHTML = data.topCustomers.map(item => `<tr><td>${item.name}</td><td>${item.customer_type}</td><td>${formatCurrency(item.total_spent || 0)}</td></tr>`).join('');
  } catch (error) {
    console.error('Could not load reports', error);
  }
}

loginForm.addEventListener('submit', handleLogin);
logoutButton.addEventListener('click', handleLogout);
navButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setActiveSection(button.dataset.section);
    if (button.dataset.section === 'dashboard') loadDashboard();
    if (button.dataset.section === 'products') loadProducts();
    if (button.dataset.section === 'customers') loadCustomers();
    if (button.dataset.section === 'sales') loadSales();
    if (button.dataset.section === 'movements') loadMovementHistory();
    if (button.dataset.section === 'reports') loadReports();
  });
});

document.getElementById('productSearch').addEventListener('input', loadProducts);
document.getElementById('productActiveFilter').addEventListener('change', loadProducts);
document.getElementById('customerSearch').addEventListener('input', loadCustomers);
document.getElementById('salesSearch').addEventListener('input', loadSales);
document.getElementById('salesFilterFrom').addEventListener('change', loadSales);
document.getElementById('salesFilterTo').addEventListener('change', loadSales);
document.getElementById('movementSearch').addEventListener('input', loadMovementHistory);
document.getElementById('movementTypeFilter').addEventListener('change', loadMovementHistory);
document.getElementById('movementStart').addEventListener('change', loadMovementHistory);
document.getElementById('movementEnd').addEventListener('change', loadMovementHistory);

document.getElementById('saleForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = {
    transaction_date: formData.get('transaction_date'),
    customer_id: formData.get('customer_id'),
    product_id: formData.get('product_id'),
    quantity: formData.get('quantity'),
    unit_price: formData.get('unit_price'),
    status: formData.get('status')
  };
  try {
    await requestJson('/api/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    document.getElementById('saleMessage').textContent = 'Sale recorded.';
    setTimeout(() => document.getElementById('saleMessage').textContent = '', 2500);
    event.target.reset();
    setDefaultDates();
    await loadSales();
    await loadProducts();
    await loadDashboard();
  } catch (error) {
    document.getElementById('saleMessage').textContent = error.message;
  }
});

document.getElementById('stockInForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = {
    date: formData.get('date'),
    product_id: formData.get('product_id'),
    quantity: formData.get('quantity'),
    notes: formData.get('notes')
  };
  try {
    await requestJson('/api/stock-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    document.getElementById('stockInMessage').textContent = 'Stock in recorded.';
    setTimeout(() => document.getElementById('stockInMessage').textContent = '', 2500);
    event.target.reset();
    setDefaultDates();
    await loadProducts();
    await loadDashboard();
    await loadMovementHistory();
  } catch (error) {
    document.getElementById('stockInMessage').textContent = error.message;
  }
});

document.getElementById('stockOutForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = {
    date: formData.get('date'),
    product_id: formData.get('product_id'),
    quantity: formData.get('quantity'),
    notes: formData.get('notes')
  };
  try {
    await requestJson('/api/stock-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    document.getElementById('stockOutMessage').textContent = 'Stock out recorded.';
    setTimeout(() => document.getElementById('stockOutMessage').textContent = '', 2500);
    event.target.reset();
    setDefaultDates();
    await loadProducts();
    await loadDashboard();
    await loadMovementHistory();
  } catch (error) {
    document.getElementById('stockOutMessage').textContent = error.message;
  }
});

document.body.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (action === 'edit-product') {
    const products = await requestJson(`/api/products?q=`);
    const product = products.find((item) => String(item.id) === id);
    if (product) renderProductForm(product);
  }
  if (action === 'delete-product') {
    if (!confirm('Remove this product?')) return;
    await requestJson(`/api/products/${id}`, { method: 'DELETE' });
    await loadProducts();
    await loadDashboard();
  }
  if (action === 'edit-customer') {
    const customers = await requestJson('/api/customers');
    const customer = customers.find((item) => String(item.id) === id);
    if (customer) renderCustomerForm(customer);
  }
});

loadUser();
