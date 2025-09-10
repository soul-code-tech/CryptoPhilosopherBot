const express = require('express');
const cors = require('cors');
const path = require('path');

const bot = require('./index.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

app.get('/api/state', (req, res) => {
  res.json({
    balance: bot.globalState.balance,
    positions: bot.globalState.positions,
    stats: bot.globalState.stats,
    history: bot.globalState.history.slice(-50),
    platform: 'BingX Futures'
  });
});

app.post('/api/deposit', (req, res) => {
  const { amount } = req.body;
  if (amount > 0) {
    const success = bot.deposit(amount);
    if (success) {
      res.json({ success: true, balance: bot.globalState.balance });
    } else {
      res.status(400).json({ success: false, message: 'Ошибка пополнения' });
    }
  } else {
    res.status(400).json({ success: false, message: 'Сумма должна быть положительной' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log('Твой фьючерсный трейдинг бот работает!');
});
