const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const bot = require('./index.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

// API: Получение состояния бота
app.get('/api/state', async (req, res) => {
  try {
    res.json({
      balance: bot.globalState.balance,
      realBalance: bot.globalState.realBalance,
      positions: bot.globalState.positions,
      stats: bot.globalState.stats,
      history: bot.globalState.history.slice(-50),
      platform: 'BingX Futures',
      isRealMode: bot.globalState.isRealMode // 🔥 НОВОЕ: отправляем текущий режим
    });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка получения состояния' });
  }
});

// API: Пополнение демо-баланса
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

// API: Переключение режима
app.post('/api/toggleMode', (req, res) => {
  try {
    const newMode = bot.toggleMode();
    res.json({ 
      success: true, 
      isRealMode: newMode,
      message: `Режим переключён на: ${newMode ? 'РЕАЛЬНЫЙ' : 'ДЕМО'}`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Ошибка переключения режима' });
  }
});

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log('Твой фьючерсный трейдинг бот работает с переключением режимов!');
});
