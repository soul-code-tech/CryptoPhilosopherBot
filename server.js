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
      isRealMode: bot.globalState.isRealMode,
      tradeMode: bot.globalState.tradeMode,
      riskLevel: bot.globalState.riskLevel,
      currentPrices: bot.globalState.currentPrices,
      fearIndex: bot.globalState.fearIndex,
      news: bot.globalState.marketMemory.news || []
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

// API: Переключение режима (ДЕМО ↔ РЕАЛЬНЫЙ)
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

// API: Переключение торгового режима (stable ↔ scalping)
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

// API: Установка уровня риска
app.post('/api/setRiskLevel', (req, res) => {
  try {
    const { level } = req.body;
    if (!level || !['recommended', 'medium', 'high', 'extreme'].includes(level)) {
      return res.status(400).json({ success: false, message: 'Неверный уровень риска' });
    }
    
    const newLevel = bot.setRiskLevel(level);
    res.json({ 
      success: true, 
      riskLevel: newLevel,
      message: `Уровень риска установлен на: ${newLevel}`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Ошибка установки уровня риска' });
  }
});

// API: Принудительное обновление реального баланса
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

// API: Получение новостей
app.get('/api/news', async (req, res) => {
  try {
    const news = bot.globalState.marketMemory.news || [];
    res.json({ news });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка получения новостей' });
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
