# Cantina Unifor — Sistema de Ponto de Venda

Trabalho individual: sistema web para uma cantina universitária em que clientes recarregam saldo e compram itens do cardápio, e o administrador gerencia produtos e estoque.

## Tecnologias
| Camada | Tecnologia |
|---|---|
| Frontend | HTML, CSS, JavaScript e React 18 (SPA em `public/index.html`) |
| Backend | Node.js + Express, Web Service REST (rotas `/api/...`) |
| Banco de dados | SQLite (`better-sqlite3`) |
| Autenticação | JWT (expira em 4h) + senhas com hash bcrypt |
| Testes | Jest + Supertest |
| Versionamento | Git |

## Como executar
```bash
npm install
npm start        # http://localhost:3000
npm test         # roda os testes dos serviços
```
Usuário administrador criado automaticamente: `admin@cantina.com` / `admin123`.

## Controle de acesso
- **Autenticação:** login gera token JWT enviado no header `Authorization: Bearer <token>`.
- **Autorização por perfil:**
  - `cliente`: recarrega saldo, compra, vê e cancela os próprios pedidos.
  - `admin`: cadastra, edita e remove produtos; vê todos os pedidos; pode cancelar qualquer pedido. Não realiza compras.

## Features (transações)
| # | Transação | Rota | Perfil | Regras principais |
|---|---|---|---|---|
| 1 | Cadastro de usuário | `POST /api/auth/register` | público | nome, e-mail válido, senha 6+; e-mail único (409) |
| 2 | Login | `POST /api/auth/login` | público | credenciais inválidas → 401 |
| 3 | Recarga de saldo | `POST /api/me/credit` | autenticado | valor entre 0,01 e 500 |
| 4 | Cadastro de produto | `POST /api/products` | admin | preço > 0, estoque inteiro >= 0 |
| 5 | Edição/reposição de produto | `PUT /api/products/:id` | admin | 404 se não existir |
| 6 | Remoção de produto | `DELETE /api/products/:id` | admin | exclusão lógica (preserva histórico) |
| 7 | Compra | `POST /api/orders` | cliente | valida estoque (409) e saldo (402); debita saldo e estoque em uma transação atômica |
| 8 | Cancelamento de pedido | `POST /api/orders/:id/cancel` | dono ou admin | estorna saldo e devolve estoque; não cancela duas vezes (409) |

Consultas: `GET /api/products`, `GET /api/orders` (cliente vê só os seus), `GET /api/me`.

## Modelo de dados
`users(id, name, email, password, role, balance)` · `products(id, name, price, stock, active)` · `orders(id, user_id, total, status, created_at)` · `order_items(id, order_id, product_id, quantity, unit_price)`

## Testes
`tests/api.test.js` contém 18 testes automatizados dos serviços: validações de cadastro, login, proteção de rotas (401/403), CRUD de produtos, recarga, compra (saldo/estoque), listagem por perfil e cancelamento com estorno.

## Estrutura
```
src/db.js      criação das tabelas e dados iniciais
src/app.js     rotas REST, autenticação e regras de negócio
src/server.js  inicialização do servidor
public/        frontend React
tests/         testes formais
```
