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

app.get('/api/state', async (req, res) => {
  try {
    res.json({
      balance: bot.globalState.balance,
      realBalance: bot.globalState.realBalance,
      positions: bot.globalState.positions,
      stats: bot.globalState.stats,
      history: bot.globalState.history.slice(-50),
      platform: 'BingX Futures',
      isRealMode: bot.globalState.isRealMode,
      tradeMode: bot.globalState.tradeMode,
      testMode: bot.globalState.testMode
    });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка получения состояния' });
  }
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

app.post('/api/toggleTradeMode', (req, res) => {
  try {
    const newMode = bot.toggleTradeMode();
    res.json({ 
      success: true, 
      tradeMode: newMode,
      message: `Торговый режим переключён на: ${newMode}`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Ошибка переключения торгового режима' });
  }
});

app.post('/api/toggleTestMode', (req, res) => {
  try {
    const newMode = bot.toggleTestMode();
    res.json({ 
      success: true, 
      testMode: newMode,
      message: `Тестовый режим ${newMode ? 'ВКЛЮЧЁН' : 'ВЫКЛЮЧЕН'}`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Ошибка переключения тестового режима' });
  }
});

app.post('/api/forceUpdateBalance', (req, res) => {
  try {
    bot.forceUpdateRealBalance();
    res.json({ 
      success: true, 
      message: 'Запрошено обновление реального баланса'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Ошибка обновления баланса' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log('Твой фьючерсный трейдинг бот работает с переключением режимов!');
});
