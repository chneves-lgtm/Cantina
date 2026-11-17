const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

function createDb(file = process.env.DB_FILE || 'cantina.db') {
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cliente',
      balance REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      total REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pago',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL
    );
  `);

  // Seed: administrador e produtos de exemplo
  if (!db.prepare("SELECT 1 FROM users WHERE role='admin'").get()) {
    db.prepare("INSERT INTO users (name,email,password,role) VALUES (?,?,?,'admin')")
      .run('Administrador', 'admin@cantina.com', bcrypt.hashSync('admin123', 8));
  }
  if (!db.prepare('SELECT 1 FROM products').get()) {
    const ins = db.prepare('INSERT INTO products (name,price,stock) VALUES (?,?,?)');
    [['Coxinha', 6.5, 40], ['Pão de queijo', 4, 50], ['Suco de caju', 7, 30], ['Café', 3.5, 60]]
      .forEach((p) => ins.run(...p));
  }
  return db;
}

module.exports = { createDb };
