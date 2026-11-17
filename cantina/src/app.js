const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const SECRET = process.env.JWT_SECRET || 'segredo-de-desenvolvimento';
const r2 = (n) => Math.round(n * 100) / 100;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createApp(db) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // ---------- Middlewares de autenticação / autorização ----------
  const auth = (req, res, next) => {
    try {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const { id } = jwt.verify(token, SECRET);
      const user = db.prepare('SELECT id,name,email,role,balance FROM users WHERE id=?').get(id);
      if (!user) throw new Error('usuário inexistente');
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: 'Não autenticado' });
    }
  };
  const only = (role) => (req, res, next) =>
    req.user.role === role ? next() : res.status(403).json({ error: 'Acesso negado' });
  const wrap = (fn) => (req, res, next) => { try { fn(req, res); } catch (e) { next(e); } };

  // ---------- Transação 1: cadastro de usuário ----------
  app.post('/api/auth/register', wrap((req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !email.includes('@') || !password || password.length < 6)
      throw new HttpError(400, 'Informe nome, e-mail válido e senha com 6+ caracteres');
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email))
      throw new HttpError(409, 'E-mail já cadastrado');
    const info = db.prepare("INSERT INTO users (name,email,password,role) VALUES (?,?,?,'cliente')")
      .run(name, email, bcrypt.hashSync(password, 8));
    res.status(201).json({ id: info.lastInsertRowid, name, email });
  }));

  // ---------- Transação 2: login ----------
  app.post('/api/auth/login', wrap((req, res) => {
    const { email, password } = req.body;
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(email || '');
    if (!u || !bcrypt.compareSync(password || '', u.password))
      throw new HttpError(401, 'E-mail ou senha inválidos');
    const token = jwt.sign({ id: u.id, role: u.role }, SECRET, { expiresIn: '4h' });
    res.json({ token, user: { id: u.id, name: u.name, email: u.email, role: u.role, balance: u.balance } });
  }));

  app.get('/api/me', auth, (req, res) => res.json(req.user));

  // ---------- Transação 3: recarga de saldo ----------
  app.post('/api/me/credit', auth, wrap((req, res) => {
    const amount = Number(req.body.amount);
    if (!(amount > 0) || amount > 500) throw new HttpError(400, 'Valor deve ser entre 0,01 e 500');
    db.prepare('UPDATE users SET balance = ROUND(balance + ?, 2) WHERE id=?').run(amount, req.user.id);
    res.json(db.prepare('SELECT id,name,email,role,balance FROM users WHERE id=?').get(req.user.id));
  }));

  // ---------- Produtos ----------
  app.get('/api/products', auth, (req, res) => {
    res.json(db.prepare('SELECT id,name,price,stock FROM products WHERE active=1 ORDER BY name').all());
  });

  const validProduct = ({ name, price, stock }) => {
    if (!name || !(Number(price) > 0) || !Number.isInteger(Number(stock)) || Number(stock) < 0)
      throw new HttpError(400, 'Produto inválido: informe nome, preço > 0 e estoque inteiro >= 0');
  };

  // Transação 4: cadastro de produto (admin)
  app.post('/api/products', auth, only('admin'), wrap((req, res) => {
    validProduct(req.body);
    const { name, price, stock } = req.body;
    const info = db.prepare('INSERT INTO products (name,price,stock) VALUES (?,?,?)').run(name, Number(price), Number(stock));
    res.status(201).json({ id: info.lastInsertRowid, name, price: Number(price), stock: Number(stock) });
  }));

  // Transação 5: edição / reposição de estoque (admin)
  app.put('/api/products/:id', auth, only('admin'), wrap((req, res) => {
    validProduct(req.body);
    const { name, price, stock } = req.body;
    const info = db.prepare('UPDATE products SET name=?, price=?, stock=? WHERE id=? AND active=1')
      .run(name, Number(price), Number(stock), req.params.id);
    if (!info.changes) throw new HttpError(404, 'Produto não encontrado');
    res.json({ id: Number(req.params.id), name, price: Number(price), stock: Number(stock) });
  }));

  // Transação 6: remoção (exclusão lógica) de produto (admin)
  app.delete('/api/products/:id', auth, only('admin'), wrap((req, res) => {
    const info = db.prepare('UPDATE products SET active=0 WHERE id=? AND active=1').run(req.params.id);
    if (!info.changes) throw new HttpError(404, 'Produto não encontrado');
    res.status(204).end();
  }));

  // ---------- Pedidos ----------
  const loadOrders = (where, params) => {
    const orders = db.prepare(`SELECT o.*, u.name AS user_name FROM orders o JOIN users u ON u.id=o.user_id ${where} ORDER BY o.id DESC`).all(...params);
    const items = db.prepare('SELECT oi.quantity, oi.unit_price, p.name FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=?');
    return orders.map((o) => ({ ...o, items: items.all(o.id) }));
  };

  // Transação 7: compra (debita saldo e estoque atomicamente)
  app.post('/api/orders', auth, only('cliente'), wrap((req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Pedido sem itens');

    const create = db.transaction(() => {
      const merged = new Map(); // junta itens repetidos
      for (const it of items) {
        const q = Number(it.quantity);
        if (!Number.isInteger(q) || q <= 0) throw new HttpError(400, 'Quantidade inválida');
        merged.set(it.productId, (merged.get(it.productId) || 0) + q);
      }
      let total = 0;
      const lines = [];
      for (const [productId, q] of merged) {
        const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(productId);
        if (!p) throw new HttpError(404, 'Produto não encontrado');
        if (p.stock < q) throw new HttpError(409, `Estoque insuficiente para ${p.name}`);
        total += p.price * q;
        lines.push({ p, q });
      }
      total = r2(total);
      const { balance } = db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id);
      if (balance < total) throw new HttpError(402, 'Saldo insuficiente');

      const orderId = db.prepare('INSERT INTO orders (user_id,total) VALUES (?,?)').run(req.user.id, total).lastInsertRowid;
      for (const { p, q } of lines) {
        db.prepare('INSERT INTO order_items (order_id,product_id,quantity,unit_price) VALUES (?,?,?,?)').run(orderId, p.id, q, p.price);
        db.prepare('UPDATE products SET stock = stock - ? WHERE id=?').run(q, p.id);
      }
      db.prepare('UPDATE users SET balance = ROUND(balance - ?, 2) WHERE id=?').run(total, req.user.id);
      return orderId;
    });

    const id = create();
    res.status(201).json(loadOrders('WHERE o.id=?', [id])[0]);
  }));

  // Consulta: cliente vê os seus; admin vê todos
  app.get('/api/orders', auth, (req, res) => {
    res.json(req.user.role === 'admin' ? loadOrders('', []) : loadOrders('WHERE o.user_id=?', [req.user.id]));
  });

  // Transação 8: cancelamento (estorna saldo e devolve estoque)
  app.post('/api/orders/:id/cancel', auth, wrap((req, res) => {
    const cancel = db.transaction(() => {
      const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
      if (!o) throw new HttpError(404, 'Pedido não encontrado');
      if (req.user.role !== 'admin' && o.user_id !== req.user.id) throw new HttpError(403, 'Acesso negado');
      if (o.status !== 'pago') throw new HttpError(409, 'Pedido já cancelado');
      db.prepare("UPDATE orders SET status='cancelado' WHERE id=?").run(o.id);
      db.prepare('UPDATE users SET balance = ROUND(balance + ?, 2) WHERE id=?').run(o.total, o.user_id);
      for (const it of db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id))
        db.prepare('UPDATE products SET stock = stock + ? WHERE id=?').run(it.quantity, it.product_id);
      return o.id;
    });
    const id = cancel();
    res.json(loadOrders('WHERE o.id=?', [id])[0]);
  }));

  app.use((err, req, res, next) => { // eslint-disable-line
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  });
  return app;
}

module.exports = { createApp };
