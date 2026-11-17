const request = require('supertest');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');

let app;
let admin;
let cliente;
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  app = createApp(createDb(':memory:'));
  admin = (await request(app).post('/api/auth/login').send({ email: 'admin@cantina.com', password: 'admin123' })).body.token;
  await request(app).post('/api/auth/register').send({ name: 'Ana', email: 'ana@x.com', password: '123456' });
  cliente = (await request(app).post('/api/auth/login').send({ email: 'ana@x.com', password: '123456' })).body.token;
});

describe('Autenticação', () => {
  test('cadastro com dados inválidos retorna 400', async () => {
    const r = await request(app).post('/api/auth/register').send({ name: 'X', email: 'x', password: '1' });
    expect(r.status).toBe(400);
  });
  test('e-mail duplicado retorna 409', async () => {
    const r = await request(app).post('/api/auth/register').send({ name: 'Ana', email: 'ana@x.com', password: '123456' });
    expect(r.status).toBe(409);
  });
  test('login com senha errada retorna 401', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'ana@x.com', password: 'errada' });
    expect(r.status).toBe(401);
  });
  test('rota protegida sem token retorna 401', async () => {
    expect((await request(app).get('/api/products')).status).toBe(401);
  });
});

describe('Autorização', () => {
  test('cliente não pode cadastrar produto (403)', async () => {
    const r = await request(app).post('/api/products').set(bearer(cliente)).send({ name: 'X', price: 1, stock: 1 });
    expect(r.status).toBe(403);
  });
  test('admin não pode comprar (403)', async () => {
    const r = await request(app).post('/api/orders').set(bearer(admin)).send({ items: [{ productId: 1, quantity: 1 }] });
    expect(r.status).toBe(403);
  });
});

describe('Produtos (admin)', () => {
  let id;
  test('cria produto', async () => {
    const r = await request(app).post('/api/products').set(bearer(admin)).send({ name: 'Bolo', price: 5, stock: 10 });
    expect(r.status).toBe(201);
    id = r.body.id;
  });
  test('rejeita preço inválido', async () => {
    const r = await request(app).post('/api/products').set(bearer(admin)).send({ name: 'Bolo', price: -1, stock: 10 });
    expect(r.status).toBe(400);
  });
  test('edita produto', async () => {
    const r = await request(app).put(`/api/products/${id}`).set(bearer(admin)).send({ name: 'Bolo', price: 6, stock: 20 });
    expect(r.body.price).toBe(6);
  });
  test('remove produto e some da listagem', async () => {
    expect((await request(app).delete(`/api/products/${id}`).set(bearer(admin))).status).toBe(204);
    const list = await request(app).get('/api/products').set(bearer(cliente));
    expect(list.body.find((p) => p.id === id)).toBeUndefined();
  });
});

describe('Saldo e pedidos', () => {
  test('compra sem saldo retorna 402', async () => {
    const r = await request(app).post('/api/orders').set(bearer(cliente)).send({ items: [{ productId: 1, quantity: 1 }] });
    expect(r.status).toBe(402);
  });
  test('recarga inválida retorna 400', async () => {
    expect((await request(app).post('/api/me/credit').set(bearer(cliente)).send({ amount: -5 })).status).toBe(400);
  });
  test('recarga de saldo funciona', async () => {
    const r = await request(app).post('/api/me/credit').set(bearer(cliente)).send({ amount: 50 });
    expect(r.body.balance).toBe(50);
  });
  test('estoque insuficiente retorna 409', async () => {
    const r = await request(app).post('/api/orders').set(bearer(cliente)).send({ items: [{ productId: 1, quantity: 999 }] });
    expect(r.status).toBe(409);
  });

  let orderId;
  test('compra debita saldo e estoque', async () => {
    const r = await request(app).post('/api/orders').set(bearer(cliente)).send({ items: [{ productId: 1, quantity: 2 }, { productId: 4, quantity: 1 }] });
    expect(r.status).toBe(201);
    expect(r.body.total).toBe(16.5);
    orderId = r.body.id;
    expect((await request(app).get('/api/me').set(bearer(cliente))).body.balance).toBe(33.5);
    const prods = (await request(app).get('/api/products').set(bearer(cliente))).body;
    expect(prods.find((p) => p.id === 1).stock).toBe(38);
  });
  test('cliente lista apenas seus pedidos', async () => {
    const r = await request(app).get('/api/orders').set(bearer(cliente));
    expect(r.body).toHaveLength(1);
  });
  test('cancelamento estorna saldo e estoque', async () => {
    const r = await request(app).post(`/api/orders/${orderId}/cancel`).set(bearer(cliente));
    expect(r.body.status).toBe('cancelado');
    expect((await request(app).get('/api/me').set(bearer(cliente))).body.balance).toBe(50);
    const prods = (await request(app).get('/api/products').set(bearer(cliente))).body;
    expect(prods.find((p) => p.id === 1).stock).toBe(40);
  });
  test('cancelar duas vezes retorna 409', async () => {
    expect((await request(app).post(`/api/orders/${orderId}/cancel`).set(bearer(cliente))).status).toBe(409);
  });
});
