const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios'); // ✅ ДОБАВЛЕНО — исправление ошибки!

const bot = require('./index.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

// API: Получение состояния бота + реального баланса
app.get('/api/state', async (req, res) => {
  try {
    const realBalance = await getBingXRealBalance();
    res.json({
      balance: bot.globalState.balance,
      realBalance: realBalance,
      positions: bot.globalState.positions,
      stats: bot.globalState.stats,
      history: bot.globalState.history.slice(-50),
      platform: 'BingX Futures'
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

// API: Отправка Push-уведомления
app.post('/api/notify', (req, res) => {
  const { title, body, url } = req.body;
  console.log(`🔔 [PUSH] ${title}: ${body}`);
  res.json({ success: true });
});

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Функция получения реального баланса — ИСПРАВЛЕНА!
async function getBingXRealBalance() {
  const BINGX_API_KEY = process.env.BINGX_API_KEY;
  const BINGX_SECRET_KEY = process.env.BINGX_SECRET_KEY;
  const BINGX_FUTURES_URL = 'https://open-api.bingx.com';
  
  const CryptoJS = require('crypto-js');

  function signBingXRequest(params) {
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${key}=${params[key]}`)
      .join('&');
    return CryptoJS.HmacSHA256(sortedParams, BINGX_SECRET_KEY).toString(CryptoJS.enc.Hex);
  }

  try {
    const timestamp = Date.now();
    const params = { timestamp };
    const signature = signBingXRequest(params);
    const url = `${BINGX_FUTURES_URL}/openApi/swap/v2/user/balance?${new URLSearchParams(params)}&signature=${signature}`;

    const response = await axios.get(url, {
      headers: { 'X-BX-APIKEY': BINGX_API_KEY },
      timeout: 10000
    });

    if (response.data.code === 0 && response.data.data) {
      // 🔥 ИСПРАВЛЕНО: BingX может вернуть объект, а не массив
      const assets = response.data.data.assets || response.data.data;
      const assetsArray = Array.isArray(assets) ? assets : Object.values(assets);
      
      const usdtAsset = assetsArray.find(asset => asset.asset === 'USDT');
      if (usdtAsset && usdtAsset.walletBalance) {
        return parseFloat(usdtAsset.walletBalance);
      }
    }
    return null;
  } catch (error) {
    console.error('❌ Ошибка получения реального баланса с BingX:', error.message);
    return null;
  }
}

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log('Твой фьючерсный трейдинг бот работает!');
});
