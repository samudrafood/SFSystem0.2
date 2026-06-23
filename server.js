const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'system.db');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) return reject(err);
    resolve(this);
  });
});

const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) return reject(err);
    resolve(row);
  });
});

const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) return reject(err);
    resolve(rows);
  });
});

async function initializeDatabase() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    unit TEXT NOT NULL,
    selling_price REAL NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    minimum_stock INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  )`);

  await run(`CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    customer_type TEXT NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    transaction_date TEXT NOT NULL,
    total_amount REAL NOT NULL,
    status TEXT NOT NULL,
    FOREIGN KEY(customer_id) REFERENCES customers(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    subtotal REAL NOT NULL,
    FOREIGN KEY(sale_id) REFERENCES sales(id),
    FOREIGN KEY(product_id) REFERENCES products(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    movement_type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    reference TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(product_id) REFERENCES products(id)
  )`);

  const existingAdmin = await get('SELECT id FROM users WHERE email = ?', ['owner@sfseafood.local']);
  if (!existingAdmin) {
    const ownerPassword = await bcrypt.hash('Owner123!', 10);
    const operatorPassword = await bcrypt.hash('Operator123!', 10);

    await run('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', ['Owner Manager', 'owner@sfseafood.local', ownerPassword, 'owner']);
    await run('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', ['Floor Operator', 'operator@sfseafood.local', operatorPassword, 'operator']);
  }

  const existingProduct = await get('SELECT id FROM products LIMIT 1');
  if (!existingProduct) {
    const sampleProducts = [
      ['TBK-ORANGE', 'Tobiko Orange', 'Roe', 'kg', 34.5, 120, 20, 1],
      ['TBK-BLACK', 'Tobiko Black', 'Roe', 'kg', 36.0, 80, 15, 1],
      ['CRB-STICK', 'Crab Stick', 'Seafood', 'kg', 9.5, 210, 30, 1],
      ['OCT-SLICE', 'Octopus Slice', 'Seafood', 'kg', 22.0, 55, 10, 1],
      ['EBI-FURAI', 'Ebi Furai', 'Seafood', 'kg', 18.0, 90, 25, 1]
    ];

    for (const item of sampleProducts) {
      await run('INSERT INTO products (sku, name, category, unit, selling_price, stock, minimum_stock, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', item);
    }
  }

  const existingCustomer = await get('SELECT id FROM customers LIMIT 1');
  if (!existingCustomer) {
    const sampleCustomers = [
      ['Ocean Restaurant', '081234567890', 'Jl. Pesisir 12', 'Restaurant'],
      ['Northern Distributor', '082345678901', 'Jl. Industri 9', 'Distributor'],
      ['Fresh Retailer', '083456789012', 'Jl. Utama 3', 'Retail'],
      ['Seafood Reseller', '084567890123', 'Jl. Segara 7', 'Reseller']
    ];
    for (const item of sampleCustomers) {
      await run('INSERT INTO customers (name, phone, address, customer_type) VALUES (?, ?, ?, ?)', item);
    }
  }
}

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: 'sf-system-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 4
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

async function requireOwner(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const user = await get('SELECT role FROM users WHERE id = ?', [req.session.userId]);
  if (!user || user.role !== 'owner') {
    return res.status(403).json({ error: 'Owner access required' });
  }
  next();
}

app.get('/api/user', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  const user = await get('SELECT id, name, email, role FROM users WHERE id = ?', [req.session.userId]);
  if (!user) {
    return res.status(401).json({ error: 'Session invalid' });
  }
  res.json(user);
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const user = await get('SELECT id, name, email, password, role FROM users WHERE email = ?', [email.trim().toLowerCase()]);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  req.session.userId = user.id;
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/dashboard', requireAuth, async (req, res) => {
  const totalItemsRow = await get('SELECT COUNT(*) AS count FROM products WHERE active = 1');
  const totalQuantityRow = await get('SELECT COALESCE(SUM(stock), 0) AS total FROM products');
  const today = new Date().toISOString().slice(0, 10);
  const [todaySalesRow, monthSalesRow, transactionsRow, lowStock] = await Promise.all([
    get('SELECT COALESCE(SUM(total_amount), 0) AS total FROM sales WHERE transaction_date = ?', [today]),
    get("SELECT COALESCE(SUM(total_amount), 0) AS total FROM sales WHERE strftime('%Y-%m', transaction_date) = strftime('%Y-%m', 'now')"),
    get('SELECT COUNT(*) AS count FROM sales WHERE transaction_date = ?', [today]),
    all('SELECT id, sku, name, stock, minimum_stock FROM products WHERE stock <= minimum_stock AND active = 1 ORDER BY stock ASC LIMIT 5')
  ]);

  res.json({
    totalItems: totalItemsRow.count,
    totalQuantity: totalQuantityRow.total,
    salesToday: todaySalesRow.total,
    salesMonth: monthSalesRow.total,
    transactionsToday: transactionsRow.count,
    lowStock: lowStock
  });
});

app.get('/api/products', requireAuth, async (req, res) => {
  const { q, category, active } = req.query;
  const conditions = [];
  const params = [];
  if (q) {
    conditions.push('(name LIKE ? OR sku LIKE ? OR category LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }
  if (active === '1' || active === '0') {
    conditions.push('active = ?');
    params.push(Number(active));
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const products = await all(`SELECT * FROM products ${where} ORDER BY name ASC`, params);
  res.json(products);
});

app.post('/api/products', requireOwner, async (req, res) => {
  const { sku, name, category, unit, selling_price, stock, minimum_stock, active } = req.body;
  if (!sku || !name || !category || !unit || selling_price == null) {
    return res.status(400).json({ error: 'Required product fields are missing' });
  }
  try {
    const result = await run(
      'INSERT INTO products (sku, name, category, unit, selling_price, stock, minimum_stock, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [sku.trim(), name.trim(), category.trim(), unit.trim(), Number(selling_price), Number(stock) || 0, Number(minimum_stock) || 0, active ? 1 : 0]
    );
    const product = await get('SELECT * FROM products WHERE id = ?', [result.lastID]);
    res.json(product);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/products/:id', requireOwner, async (req, res) => {
  const { id } = req.params;
  const { sku, name, category, unit, selling_price, stock, minimum_stock, active } = req.body;
  const existing = await get('SELECT id FROM products WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  await run(
    'UPDATE products SET sku = ?, name = ?, category = ?, unit = ?, selling_price = ?, stock = ?, minimum_stock = ?, active = ? WHERE id = ?',
    [sku.trim(), name.trim(), category.trim(), unit.trim(), Number(selling_price), Number(stock) || 0, Number(minimum_stock) || 0, active ? 1 : 0, id]
  );
  const product = await get('SELECT * FROM products WHERE id = ?', [id]);
  res.json(product);
});

app.delete('/api/products/:id', requireOwner, async (req, res) => {
  const { id } = req.params;
  await run('DELETE FROM products WHERE id = ?', [id]);
  res.json({ success: true });
});

app.get('/api/customers', requireAuth, async (req, res) => {
  const { q } = req.query;
  const conditions = [];
  const params = [];
  if (q) {
    conditions.push('(name LIKE ? OR phone LIKE ? OR customer_type LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const customers = await all(`SELECT * FROM customers ${where} ORDER BY name ASC`, params);
  res.json(customers);
});

app.post('/api/customers', requireOwner, async (req, res) => {
  const { name, phone, address, customer_type } = req.body;
  if (!name || !customer_type) {
    return res.status(400).json({ error: 'Customer name and type are required' });
  }
  const result = await run('INSERT INTO customers (name, phone, address, customer_type) VALUES (?, ?, ?, ?)', [name.trim(), phone ? phone.trim() : '', address ? address.trim() : '', customer_type.trim()]);
  const customer = await get('SELECT * FROM customers WHERE id = ?', [result.lastID]);
  res.json(customer);
});

app.put('/api/customers/:id', requireOwner, async (req, res) => {
  const { id } = req.params;
  const { name, phone, address, customer_type } = req.body;
  const existing = await get('SELECT id FROM customers WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ error: 'Customer not found' });
  await run('UPDATE customers SET name = ?, phone = ?, address = ?, customer_type = ? WHERE id = ?', [name.trim(), phone ? phone.trim() : '', address ? address.trim() : '', customer_type.trim(), id]);
  const customer = await get('SELECT * FROM customers WHERE id = ?', [id]);
  res.json(customer);
});

app.post('/api/stock-in', requireAuth, async (req, res) => {
  const { product_id, quantity, notes, date } = req.body;
  const qty = Number(quantity);
  if (!product_id || qty <= 0) return res.status(400).json({ error: 'Valid product and quantity are required' });
  const product = await get('SELECT id, stock FROM products WHERE id = ?', [product_id]);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const newStock = product.stock + qty;
  const createdAt = date ? String(date).slice(0, 10) : new Date().toISOString().slice(0, 10);
  await run('UPDATE products SET stock = ? WHERE id = ?', [newStock, product_id]);
  await run('INSERT INTO stock_movements (product_id, movement_type, quantity, reference, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)', [product_id, 'Stock In', qty, 'Stock In', notes || '', createdAt]);
  const updated = await get('SELECT * FROM products WHERE id = ?', [product_id]);
  res.json(updated);
});

app.post('/api/stock-out', requireAuth, async (req, res) => {
  const { product_id, quantity, notes, date } = req.body;
  const qty = Number(quantity);
  if (!product_id || qty <= 0) return res.status(400).json({ error: 'Valid product and quantity are required' });
  const product = await get('SELECT id, stock FROM products WHERE id = ?', [product_id]);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (product.stock < qty) return res.status(400).json({ error: 'Insufficient stock for stock-out' });
  const newStock = product.stock - qty;
  const createdAt = date ? String(date).slice(0, 10) : new Date().toISOString().slice(0, 10);
  await run('UPDATE products SET stock = ? WHERE id = ?', [newStock, product_id]);
  await run('INSERT INTO stock_movements (product_id, movement_type, quantity, reference, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)', [product_id, 'Stock Out', qty, 'Stock Out', notes || '', createdAt]);
  const updated = await get('SELECT * FROM products WHERE id = ?', [product_id]);
  res.json(updated);
});

app.get('/api/stock-movements', requireAuth, async (req, res) => {
  const { q, type, start, end } = req.query;
  const conditions = [];
  const params = [];
  if (q) {
    conditions.push('(p.name LIKE ? OR p.sku LIKE ? OR sm.reference LIKE ? OR sm.notes LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (type) {
    conditions.push('sm.movement_type = ?');
    params.push(type);
  }
  if (start) {
    conditions.push('sm.created_at >= ?');
    params.push(start);
  }
  if (end) {
    conditions.push('sm.created_at <= ?');
    params.push(end);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await all(`SELECT sm.id, sm.created_at AS date, p.name AS product, p.sku AS sku, sm.movement_type AS movement_type, sm.quantity, sm.reference, sm.notes
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    ${where}
    ORDER BY sm.created_at DESC, sm.id DESC`, params);
  res.json(rows);
});

app.get('/api/sales', requireAuth, async (req, res) => {
  const { q, customer_id, start, end } = req.query;
  const conditions = [];
  const params = [];
  if (customer_id) {
    conditions.push('s.customer_id = ?');
    params.push(customer_id);
  }
  if (start) {
    conditions.push('s.transaction_date >= ?');
    params.push(start);
  }
  if (end) {
    conditions.push('s.transaction_date <= ?');
    params.push(end);
  }
  if (q) {
    conditions.push('(c.name LIKE ? OR p.name LIKE ? OR s.status LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sales = await all(`SELECT s.id, s.transaction_date, s.total_amount, s.status, c.name AS customer_name,
    p.name AS product_name, si.quantity, si.unit_price, si.subtotal
    FROM sales s
    JOIN customers c ON c.id = s.customer_id
    JOIN sale_items si ON si.sale_id = s.id
    JOIN products p ON p.id = si.product_id
    ${where}
    ORDER BY s.transaction_date DESC, s.id DESC`, params);
  res.json(sales);
});

app.get('/api/sales/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const sale = await get('SELECT s.id, s.transaction_date, s.total_amount, s.status, c.name AS customer_name, c.customer_type FROM sales s JOIN customers c ON c.id = s.customer_id WHERE s.id = ?', [id]);
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  const items = await all('SELECT si.*, p.name AS product_name, p.sku FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ?', [id]);
  res.json({ sale, items });
});

app.post('/api/sales', requireAuth, async (req, res) => {
  const { customer_id, product_id, quantity, unit_price, status, transaction_date } = req.body;
  const qty = Number(quantity);
  const price = Number(unit_price);
  if (!customer_id || !product_id || qty <= 0 || price < 0 || !status) {
    return res.status(400).json({ error: 'Valid sale data is required' });
  }
  const customer = await get('SELECT id FROM customers WHERE id = ?', [customer_id]);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const product = await get('SELECT id, stock FROM products WHERE id = ?', [product_id]);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (product.stock < qty) return res.status(400).json({ error: 'Insufficient stock for sale' });
  const total = qty * price;
  const date = transaction_date ? String(transaction_date).slice(0, 10) : new Date().toISOString().slice(0, 10);
  try {
    await run('BEGIN TRANSACTION');
    const saleResult = await run('INSERT INTO sales (customer_id, transaction_date, total_amount, status) VALUES (?, ?, ?, ?)', [customer_id, date, total, status]);
    const saleId = saleResult.lastID;
    await run('INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)', [saleId, product_id, qty, price, total]);
    await run('UPDATE products SET stock = stock - ? WHERE id = ?', [qty, product_id]);
    await run('INSERT INTO stock_movements (product_id, movement_type, quantity, reference, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)', [product_id, 'Sale', qty, `Sale #${saleId}`, '', date]);
    await run('COMMIT');
    const sale = await get('SELECT s.id, s.transaction_date, s.total_amount, s.status, c.name AS customer_name FROM sales s JOIN customers c ON c.id = s.customer_id WHERE s.id = ?', [saleId]);
    res.json(sale);
  } catch (error) {
    await run('ROLLBACK');
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/reports', requireOwner, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const salesTodayRow = await get('SELECT COALESCE(SUM(total_amount), 0) AS total FROM sales WHERE transaction_date = ?', [today]);
  const salesWeekRow = await get("SELECT COALESCE(SUM(total_amount), 0) AS total FROM sales WHERE date(transaction_date) >= date('now', '-6 days') AND date(transaction_date) <= date('now')");
  const salesMonthRow = await get("SELECT COALESCE(SUM(total_amount), 0) AS total FROM sales WHERE strftime('%Y-%m', transaction_date) = strftime('%Y-%m', 'now')");
  const bestProducts = await all(`SELECT p.id, p.name, p.sku, SUM(si.quantity) AS quantity_sold, SUM(si.subtotal) AS revenue
    FROM sale_items si
    JOIN products p ON p.id = si.product_id
    GROUP BY p.id
    ORDER BY quantity_sold DESC
    LIMIT 5`);
  const topCustomers = await all(`SELECT c.id, c.name, c.customer_type, SUM(s.total_amount) AS total_spent
    FROM sales s
    JOIN customers c ON c.id = s.customer_id
    GROUP BY c.id
    ORDER BY total_spent DESC
    LIMIT 5`);
  res.json({
    salesToday: salesTodayRow.total,
    salesWeek: salesWeekRow.total,
    salesMonth: salesMonthRow.total,
    bestProducts,
    topCustomers
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  });
