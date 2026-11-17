const { createDb } = require('./db');
const { createApp } = require('./app');

const port = process.env.PORT || 3000;
createApp(createDb()).listen(port, () =>
  console.log(`Cantina rodando em http://localhost:${port}`));
