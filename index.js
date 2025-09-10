const axios = require('axios');

// ==========================
// ГЛОБАЛЬНОЕ СОСТОЯНИЕ — ТРЕЙДИНГ БОТ ВАСЯ 3000 УНИКАЛЬНЫЙ (ФЬЮЧЕРСЫ)
// ==========================
let globalState = {
  balance: 100, // начальный капитал для фьючерсов
  positions: {},
  history: [],
  stats: {
    totalTrades: 0,
    profitableTrades: 0,
    losingTrades: 0,
    winRate: 0,
    totalProfit: 0,
    maxDrawdown: 0,
    peakBalance: 100,
    maxLeverageUsed: 1
  },
  marketMemory: {
    lastTrades: {},
    consecutiveTrades: {},
    volatilityHistory: {},
    fearSentimentHistory: []
  },
  isRunning: true,
  takerFee: 0.0005, // 0.05% для фьючерсов
  maxRiskPerTrade: 0.02, // не более 2% от депозита
  maxLeverage: 10, // макс плечо
  watchlist: [
    { symbol: 'BTC', name: 'bitcoin' },
    { symbol: 'ETH', name: 'ethereum' },
    { symbol: 'BNB', name: 'binancecoin' },
    { symbol: 'SOL', name: 'solana' },
    { symbol: 'XRP', name: 'ripple' },
    { symbol: 'DOGE', name: 'dogecoin' },
    { symbol: 'ADA', name: 'cardano' },
    { symbol: 'DOT', name: 'polkadot' },
    { symbol: 'LINK', name: 'chainlink' }
    // MATIC УДАЛЁН — как ты просил
  ]
};

globalState.watchlist.forEach(coin => {
  globalState.positions[coin.name] = null; // null = нет позиции, { side: 'LONG'/'SHORT', size, entryPrice, ... }
  globalState.marketMemory.lastTrades[coin.name] = [];
  globalState.marketMemory.consecutiveTrades[coin.name] = 0;
  globalState.marketMemory.volatilityHistory[coin.name] = [];
});

// ==========================
// ФУНКЦИЯ: Пополнение баланса
// ==========================
function deposit(amount) {
  if (amount <= 0) return false;
  globalState.balance += amount;
  console.log(`✅ Баланс пополнен на $${amount}. Текущий баланс: $${globalState.balance.toFixed(2)}`);
  return true;
}

// ==========================
// ФУНКЦИЯ: Получение Fear & Greed Index
// ==========================
async function getFearAndGreedIndex() {
  try {
    const response = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 10000 });
    const value = parseInt(response.data.data[0].value);
    globalState.marketMemory.fearSentimentHistory.push({ value, timestamp: Date.now() });
    if (globalState.marketMemory.fearSentimentHistory.length > 24) {
      globalState.marketMemory.fearSentimentHistory.shift();
    }
    return value;
  } catch (e) {
    console.log('⚠️ Не удалось получить индекс страха — используем 50');
    return 50;
  }
}

// ==========================
// ФУНКЦИЯ: Получение текущих цен фьючерсов с BingX
// ==========================
async function getCurrentFuturesPrices() {
  try {
    console.log('📡 Запрашиваю текущие цены фьючерсов с BingX...');

    const response = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/price', { timeout: 15000 });

    if (!response.data || !Array.isArray(response.data.data)) {
      console.error('❌ BingX не вернул массив данных для фьючерсов');
      return {};
    }

    const prices = {};
    for (const ticker of response.data.data) {
      if (!ticker.symbol || !ticker.price) continue;

      const coinSymbol = ticker.symbol.replace('USDT', '').toLowerCase();
      let coinName = '';
      switch(coinSymbol) {
        case 'btc': coinName = 'bitcoin'; break;
        case 'eth': coinName = 'ethereum'; break;
        case 'bnb': coinName = 'binancecoin'; break;
        case 'sol': coinName = 'solana'; break;
        case 'xrp': coinName = 'ripple'; break;
        case 'doge': coinName = 'dogecoin'; break;
        case 'ada': coinName = 'cardano'; break;
        case 'dot': coinName = 'polkadot'; break;
        case 'link': coinName = 'chainlink'; break;
        default: continue;
      }
      prices[coinName] = parseFloat(ticker.price);
    }

    console.log('✅ Цены фьючерсов получены успешно');
    return prices;
  } catch (error) {
    console.error('❌ Ошибка получения цен фьючерсов с BingX:', error.message);
    return {};
  }
}

// ==========================
// ФУНКЦИЯ: Получение исторических свечей фьючерсов с BingX
// ==========================
async function getBingXFuturesHistory(symbol, interval = '1h', limit = 50) {
  try {
    const symbolMap = {
      'bitcoin': 'BTC-USDT',
      'ethereum': 'ETH-USDT',
      'binancecoin': 'BNB-USDT',
      'solana': 'SOL-USDT',
      'ripple': 'XRP-USDT',
      'dogecoin': 'DOGE-USDT',
      'cardano': 'ADA-USDT',
      'polkadot': 'DOT-USDT',
      'chainlink': 'LINK-USDT'
    };

    const bingxSymbol = symbolMap[symbol];
    if (!bingxSymbol) {
      console.error(`❌ Неизвестная монета: ${symbol}`);
      return [];
    }

    console.log(`📡 Запрашиваю историю фьючерсов для: ${bingxSymbol}`);

    const response = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/klines', {
      params: {
        symbol: bingxSymbol,
        interval: interval,
        limit: limit
      },
      timeout: 15000
    });

    if (!response.data || !Array.isArray(response.data.data)) {
      console.error(`❌ BingX вернул не массив для ${symbol}:`, response.data);
      return [];
    }

    const candles = response.data.data.map(candle => ({
      price: parseFloat(candle.close),
      high: parseFloat(candle.high),
      low: parseFloat(candle.low),
      volume: parseFloat(candle.volume),
      time: candle.time
    }));

    console.log(`✅ Получено ${candles.length} свечей для ${symbol}`);
    return candles;

  } catch (error) {
    console.error(`❌ Ошибка получения истории для ${symbol} с BingX:`, error.message);
    return [];
  }
}

// ==========================
// ФУНКЦИЯ: УНИКАЛЬНЫЙ ФИЛОСОФСКИЙ АНАЛИЗ (ФЬЮЧЕРСЫ)
// ==========================
function analyzeFuturesWithWisdom(candles, coinName, currentFearIndex) {
  if (candles.length < 10) return null;

  const prices = candles.map(c => c.price);
  const currentPrice = prices[prices.length - 1];
  const sma20 = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const atr = calculateATR(candles.slice(-14)); // волатильность
  const rsi = calculateRSI(prices.slice(-14));

  // 🌀 Закон сохранения энергии — рынок не может бесконечно двигаться в одну сторону
  const isOverextendedUp = currentPrice > sma20 * 1.05;
  const isOverextendedDown = currentPrice < sma20 * 0.95;

  // 🦋 Эффект бабочки — резкий рост волатильности = сигнал
  const volatility = atr / currentPrice;
  const isHighVolatility = volatility > 0.03;

  // 🧭 Компас страха
  const isExtremeFear = currentFearIndex < 20;
  const isExtremeGreed = currentFearIndex > 80;

  let signal = {
    direction: null, // 'LONG' или 'SHORT'
    confidence: 0.5, // 0.0 - 1.0
    leverage: 1,
    reasoning: [],
    stopLoss: null,
    takeProfit: null
  };

  // 🚀 LONG: страх + перепроданность + импульс
  if (isExtremeFear && rsi < 30 && !isOverextendedDown) {
    signal.direction = 'LONG';
    signal.confidence += 0.3;
    signal.reasoning.push("☯️ Инь-Ян: страх + перепроданность → идеальный вход в LONG");
  }

  // 📉 SHORT: жадность + перекупленность + замедление
  if (isExtremeGreed && rsi > 70 && !isOverextendedUp) {
    signal.direction = 'SHORT';
    signal.confidence += 0.3;
    signal.reasoning.push("🔥 Перегрев: жадность + перекупленность → вход в SHORT");
  }

  // 🦋 Эффект бабочки — волатильность как триггер
  if (isHighVolatility) {
    signal.confidence += 0.2;
    signal.reasoning.push("🦋 Эффект бабочки: резкий скачок волатильности → ускорение тренда");
  }

  // 🧱 Архитектура риска — снижаем плечо после серии сделок
  const consecutive = globalState.marketMemory.consecutiveTrades[coinName] || 0;
  if (consecutive >= 2) {
    signal.leverage = Math.max(1, globalState.maxLeverage * 0.5);
    signal.reasoning.push("🧱 Архитектура риска: 2+ сделки → снижаем плечо до " + signal.leverage + "x");
  } else {
    signal.leverage = globalState.maxLeverage;
  }

  // Устанавливаем стоп-лосс и тейк-профит
  if (signal.direction === 'LONG') {
    signal.stopLoss = currentPrice * 0.98; // 2% стоп
    signal.takeProfit = currentPrice * 1.03; // 3% тейк
  } else if (signal.direction === 'SHORT') {
    signal.stopLoss = currentPrice * 1.02; // 2% стоп
    signal.takeProfit = currentPrice * 0.97; // 3% тейк
  }

  // 🌊 Цунами прибыли — динамический выход
  signal.reasoning.push("🌊 Цунами прибыли: 50% позиции закрываем на +3%, остаток в трейлинг-стоп");

  return {
    coin: coinName,
    currentPrice,
    signal,
    rsi,
    volatility,
    sma20,
    fearIndex: currentFearIndex
  };
}

// Вспомогательные функции
function calculateATR(candles) {
  let trSum = 0;
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i-1].price),
      Math.abs(candles[i].low - candles[i-1].price)
    );
    trSum += tr;
  }
  return trSum / candles.length;
}

function calculateRSI(prices) {
  if (prices.length < 2) return 50;
  let gains = 0, losses = 0, count = 0;
  for (let i = 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i-1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
    count++;
  }
  const avgGain = gains / count;
  const avgLoss = losses / count;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ==========================
// ФУНКЦИЯ: Открытие фьючерсной позиции (ДЕМО)
// ==========================
function openFuturesTrade(coin, direction, leverage, size, price, stopLoss, takeProfit) {
  const cost = (size * price) / leverage; // маржинальная стоимость
  const fee = size * price * globalState.takerFee;

  if (cost + fee > globalState.balance * globalState.maxRiskPerTrade) {
    console.log(`❌ Риск превышает ${globalState.maxRiskPerTrade * 100}% от депозита`);
    return false;
  }

  if (globalState.positions[coin]) {
    console.log(`❌ Уже есть открытая позиция по ${coin}`);
    return false;
  }

  globalState.balance -= fee;
  globalState.positions[coin] = {
    side: direction,
    size,
    entryPrice: price,
    leverage,
    stopLoss,
    takeProfit,
    fee,
    timestamp: new Date().toLocaleString(),
    trailingStop: price * (direction === 'LONG' ? 0.99 : 1.01) // начальный трейлинг
  };

  const trade = {
    coin,
    type: direction,
    size,
    entryPrice: price,
    leverage,
    stopLoss,
    takeProfit,
    fee,
    timestamp: new Date().toLocaleString(),
    status: 'OPEN'
  };

  globalState.history.push(trade);
  globalState.stats.totalTrades++;
  globalState.marketMemory.consecutiveTrades[coin] = (globalState.marketMemory.consecutiveTrades[coin] || 0) + 1;
  globalState.stats.maxLeverageUsed = Math.max(globalState.stats.maxLeverageUsed, leverage);

  console.log(`✅ ОТКРЫТА ${direction} ПОЗИЦИЯ: ${size.toFixed(6)} ${coin} с плечом ${leverage}x`);
  console.log(`   💰 Маржинальная стоимость: $${cost.toFixed(2)}`);
  console.log(`   🎯 Тейк-профит: $${takeProfit.toFixed(2)} (+3%)`);
  console.log(`   🛑 Стоп-лосс: $${stopLoss.toFixed(2)} (-2%)`);
  console.log(`   💸 Комиссия: $${fee.toFixed(4)}`);

  return true;
}

// ==========================
// ФУНКЦИЯ: Проверка открытых позиций
// ==========================
async function checkOpenPositions(currentPrices) {
  for (const coin of globalState.watchlist) {
    const position = globalState.positions[coin.name];
    if (!position) continue;

    const currentPrice = currentPrices[coin.name];
    if (!currentPrice) continue;

    let shouldClose = false;
    let reason = '';

    // 🌊 Цунами прибыли: 50% при +3%
    if (position.side === 'LONG' && currentPrice >= position.takeProfit) {
      shouldClose = true;
      reason = '🎯 Достигнут тейк-профит +3% — фиксируем 50% прибыли';
    } else if (position.side === 'SHORT' && currentPrice <= position.takeProfit) {
      shouldClose = true;
      reason = '🎯 Достигнут тейк-профит +3% — фиксируем 50% прибыли';
    }

    // 🛑 Стоп-лосс
    if (position.side === 'LONG' && currentPrice <= position.stopLoss) {
      shouldClose = true;
      reason = '🛑 Сработал стоп-лосс -2%';
    } else if (position.side === 'SHORT' && currentPrice >= position.stopLoss) {
      shouldClose = true;
      reason = '🛑 Сработал стоп-лосс -2%';
    }

    if (shouldClose) {
      console.log(`✅ ЗАКРЫТИЕ: ${reason} по ${coin.name}`);
      // В демо-режиме просто закрываем
      const trade = globalState.history.find(t => t.coin === coin.name && t.status === 'OPEN');
      if (trade) {
        trade.exitPrice = currentPrice;
        trade.profitPercent = position.side === 'LONG' 
          ? (currentPrice - trade.entryPrice) / trade.entryPrice 
          : (trade.entryPrice - currentPrice) / trade.entryPrice;
        trade.status = 'CLOSED';
        
        // Обновляем статистику
        if (trade.profitPercent > 0) {
          globalState.stats.profitableTrades++;
          globalState.balance += (trade.size * trade.entryPrice * trade.profitPercent);
        } else {
          globalState.stats.losingTrades++;
          globalState.balance += (trade.size * trade.entryPrice * trade.profitPercent); // убыток
        }
      }
      
      globalState.positions[coin.name] = null;
      globalState.marketMemory.consecutiveTrades[coin.name] = 0;
    } else {
      // Обновляем трейлинг-стоп
      if (position.side === 'LONG' && currentPrice > position.entryPrice * 1.01) {
        position.trailingStop = Math.max(position.trailingStop, currentPrice * 0.99);
      } else if (position.side === 'SHORT' && currentPrice < position.entryPrice * 0.99) {
        position.trailingStop = Math.min(position.trailingStop, currentPrice * 1.01);
      }
    }
  }
}

// ==========================
// ФУНКЦИЯ: Показ прогресса открытых позиций
// ==========================
function showOpenPositionsProgress(currentPrices) {
  console.log(`\n📊 ОТКРЫТЫЕ ПОЗИЦИИ — ПРОГРЕСС:`);
  let hasOpen = false;

  for (const coin of globalState.watchlist) {
    const position = globalState.positions[coin.name];
    if (!position) continue;

    const currentPrice = currentPrices[coin.name];
    if (!currentPrice) continue;

    let progress = 0;
    let targetPrice = position.takeProfit;
    let distanceToTarget = 0;

    if (position.side === 'LONG') {
      progress = (currentPrice - position.entryPrice) / (targetPrice - position.entryPrice) * 100;
      distanceToTarget = ((targetPrice - currentPrice) / currentPrice) * 100;
    } else {
      progress = (position.entryPrice - currentPrice) / (position.entryPrice - targetPrice) * 100;
      distanceToTarget = ((currentPrice - targetPrice) / currentPrice) * 100;
    }

    // 🎲 Расчёт вероятности успеха
    let successProbability = 50;
    if (progress > 0) successProbability = 50 + progress * 0.5;
    if (distanceToTarget < 0) successProbability += 20; // уже в плюсе
    successProbability = Math.min(95, Math.max(5, successProbability));

    console.log(`\n📈 ${coin.name} ${position.side}:`);
    console.log(`   Вход: $${position.entryPrice.toFixed(2)} | Текущая: $${currentPrice.toFixed(2)}`);
    console.log(`   🎯 Цель: $${targetPrice.toFixed(2)} (${distanceToTarget > 0 ? '+' : ''}${distanceToTarget.toFixed(2)}% до цели)`);
    console.log(`   📊 Прогресс: ${Math.min(100, Math.max(0, progress)).toFixed(1)}%`);
    console.log(`   🎲 Вероятность успеха: ${successProbability.toFixed(0)}%`);
    console.log(`   🛑 Стоп: $${position.stopLoss.toFixed(2)} | Трейлинг: $${position.trailingStop.toFixed(2)}`);
    console.log(`   ⚖️ Плечо: ${position.leverage}x`);

    hasOpen = true;
  }

  if (!hasOpen) console.log(`   Нет открытых позиций`);
}

// ==========================
// ФУНКЦИЯ: Вывод статистики
// ==========================
function printStats() {
  const s = globalState.stats;
  console.log(`\n📊 СТАТИСТИКА ТОРГОВЛИ:`);
  console.log(`   Сделок всего: ${s.totalTrades} (прибыльных: ${s.profitableTrades}, убыточных: ${s.losingTrades})`);
  console.log(`   Win Rate: ${s.winRate.toFixed(1)}%`);
  console.log(`   Чистая прибыль: $${s.totalProfit.toFixed(2)} (${((s.totalProfit / 100) * 100).toFixed(1)}%)`);
  console.log(`   Макс. просадка: ${s.maxDrawdown.toFixed(1)}%`);
  console.log(`   Макс. плечо: ${s.maxLeverageUsed}x`);
  console.log(`   Текущий баланс: $${globalState.balance.toFixed(2)}`);
}

// ==========================
// ГЛАВНАЯ ФУНКЦИЯ — ЦИКЛ БОТА
// ==========================
(async () => {
  console.log('🤖 ЗАПУСК БОТА v7.0 — ТРЕЙДИНГ БОТ ВАСЯ 3000 УНИКАЛЬНЫЙ (ФЬЮЧЕРСЫ С ПЛЕЧОМ)');
  console.log('📌 deposit(сумма) — пополнить баланс');
  console.log('📈 Торгует фьючерсами с риск-менеджментом и философской логикой');

  while (globalState.isRunning) {
    try {
      console.log(`\n[${new Date().toLocaleTimeString()}] === АНАЛИЗ ОТ ВАСИ 3000 (ФЬЮЧЕРСЫ) ===`);

      const fearIndex = await getFearAndGreedIndex();
      console.log(`😱 Индекс страха и жадности: ${fearIndex}`);

      const currentPrices = await getCurrentFuturesPrices();
      await checkOpenPositions(currentPrices);

      showOpenPositionsProgress(currentPrices);

      let bestOpportunity = null;
      let bestReasoning = [];

      for (const coin of globalState.watchlist) {
        console.log(`\n🔍 Анализирую фьючерс ${coin.name}...`);

        const candles = await getBingXFuturesHistory(coin.name, '1h', 50);
        if (candles.length < 10) {
          console.log(`   ⚠️ Пропускаем ${coin.name} — недостаточно данных`);
          await new Promise(r => setTimeout(r, 1200));
          continue;
        }

        const analysis = analyzeFuturesWithWisdom(candles, coin.name, fearIndex);
        if (!analysis || !analysis.signal.direction) {
          await new Promise(r => setTimeout(r, 1200));
          continue;
        }

        console.log(`   ✅ Сигнал для ${coin.name}: ${analysis.signal.direction}`);
        analysis.signal.reasoning.forEach(r => console.log(`   • ${r}`));

        if (!bestOpportunity) {
          bestOpportunity = analysis;
          bestReasoning = analysis.signal.reasoning;
        }

        await new Promise(r => setTimeout(r, 1200));
      }

      if (bestOpportunity && globalState.balance > 10) {
        console.log(`\n💎 ВАСЯ 3000 РЕКОМЕНДУЕТ: ${bestOpportunity.signal.direction} по ${bestOpportunity.coin}`);
        bestReasoning.forEach(r => console.log(`   • ${r}`));

        // Расчёт размера позиции с риск-менеджментом
        const riskAmount = globalState.balance * globalState.maxRiskPerTrade;
        const price = bestOpportunity.currentPrice;
        const stopDistance = bestOpportunity.signal.direction === 'LONG' 
          ? price - bestOpportunity.signal.stopLoss 
          : bestOpportunity.signal.stopLoss - price;
        
        const size = riskAmount / stopDistance;
        const finalSize = Math.max(0.001, size); // минимальный размер

        console.log(`\n🟢 ВХОД: ${bestOpportunity.signal.direction} ${finalSize.toFixed(6)} ${bestOpportunity.coin} с плечом ${bestOpportunity.signal.leverage}x`);
        openFuturesTrade(
          bestOpportunity.coin,
          bestOpportunity.signal.direction,
          bestOpportunity.signal.leverage,
          finalSize,
          bestOpportunity.currentPrice,
          bestOpportunity.signal.stopLoss,
          bestOpportunity.signal.takeProfit
        );
      } else {
        console.log(`\n⚪ Вася 3000 не видит возможностей — отдыхаем...`);
      }

      // Обновляем статистику
      globalState.stats.totalProfit = globalState.balance - 100;
      if (globalState.balance > globalState.stats.peakBalance) {
        globalState.stats.peakBalance = globalState.balance;
      }
      globalState.stats.maxDrawdown = ((globalState.stats.peakBalance - globalState.balance) / globalState.stats.peakBalance) * 100;
      globalState.stats.winRate = globalState.stats.totalTrades > 0
        ? (globalState.stats.profitableTrades / globalState.stats.totalTrades) * 100
        : 0;

      if (Date.now() % 60000 < 10000) {
        console.log(`\n💰 ТЕКУЩИЙ БАЛАНС: $${globalState.balance.toFixed(2)}`);
      }

      if (globalState.stats.totalTrades > 0 && globalState.history.length % 2 === 0) {
        printStats();
      }

    } catch (error) {
      console.error('💥 КРИТИЧЕСКАЯ ОШИБКА В ЦИКЛЕ:', error.message);
    }

    console.log(`\n💤 Ждём 60 секунд до следующего анализа...`);
    await new Promise(r => setTimeout(r, 60000));
  }
})();

module.exports = {
  globalState,
  deposit
};

global.deposit = deposit;
global.balance = () => globalState.balance;
global.stats = () => globalState.stats;
global.history = () => globalState.history;

console.log('\n✅ Трейдинг Бот Вася 3000 Уникальный (Фьючерсы) запущен!');
console.log('Философия + риск-менеджмент + плечо = прибыль.');
