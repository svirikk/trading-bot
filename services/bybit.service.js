import { RestClientV5 } from 'bybit-api';
import { config } from '../config/settings.js';
import logger from '../utils/logger.js';

class BybitService {
  constructor() {
    this.client = new RestClientV5({
      key: config.bybit.apiKey,
      secret: config.bybit.apiSecret,
      testnet: config.bybit.testnet
    });
    
    this.isConnected = false;
  }

  /**
   * Повертає positionIdx в залежності від режиму позицій акаунта.
   * ONE_WAY: 0
   * HEDGE: LONG=1, SHORT=2
   */
  getPositionIdx(direction) {
    const mode = (config.bybit.positionMode || 'ONE_WAY').toUpperCase();
    if (mode === 'HEDGE') {
      return direction === 'LONG' ? 1 : 2;
    }
    return 0;
  }

  /**
   * Перевіряє з'єднання з API
   */
  async connect() {
    try {
      logger.info('[BYBIT] Connecting to Bybit API...');
      const response = await this.client.getServerTime();
      
      if (response.retCode === 0) {
        this.isConnected = true;
        logger.info(`[BYBIT] ✅ Connected to Bybit ${config.bybit.testnet ? 'TESTNET' : 'MAINNET'}`);
        return true;
      } else {
        throw new Error(`API Error: ${response.retMsg}`);
      }
    } catch (error) {
      logger.error(`[BYBIT] Connection failed: ${error.message}`);
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Отримує баланс USDT на Futures акаунті
   */
  async getUSDTBalance() {
    try {
      const response = await this.client.getWalletBalance({
        accountType: 'UNIFIED'
      });

      if (response.retCode !== 0) {
        throw new Error(`Failed to get balance: ${response.retMsg}`);
      }

      const coins = response.result?.list?.[0]?.coin || [];
      const usdtCoin = coins.find(coin => coin.coin === 'USDT');
      
      if (!usdtCoin) {
        logger.warn('[BYBIT] USDT not found in wallet');
        return 0;
      }

      const availableBalance = parseFloat(usdtCoin.availableToWithdraw || usdtCoin.walletBalance || '0');
      logger.info(`[BYBIT] USDT Balance: ${availableBalance} USDT`);
      
      return availableBalance;
    } catch (error) {
      logger.error(`[BYBIT] Error getting balance: ${error.message}`);
      throw error;
    }
  }

  /**
   * Отримує інформацію про символ (tickSize, minQty, maxQty, pricePrecision)
   */
  async getSymbolInfo(symbol) {
    try {
      const response = await this.client.getInstrumentsInfo({
        category: 'linear',
        symbol: symbol
      });

      if (response.retCode !== 0) {
        throw new Error(`Failed to get symbol info: ${response.retMsg}`);
      }

      const instrument = response.result?.list?.[0];
      if (!instrument) {
        throw new Error(`Symbol ${symbol} not found`);
      }

      return {
        symbol: instrument.symbol,
        tickSize: parseFloat(instrument.lotSizeFilter?.qtyStep || '0.0001'),
        minQty: parseFloat(instrument.lotSizeFilter?.minQty || '0'),
        maxQty: parseFloat(instrument.lotSizeFilter?.maxQty || '999999999'),
        pricePrecision: parseInt(instrument.priceScale || '4'),
        status: instrument.status,
        baseCoin: instrument.baseCoin,
        quoteCoin: instrument.quoteCoin
      };
    } catch (error) {
      logger.error(`[BYBIT] Error getting symbol info for ${symbol}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Отримує поточну ціну символу
   */
  async getCurrentPrice(symbol) {
    try {
      const response = await this.client.getTickers({
        category: 'linear',
        symbol: symbol
      });

      if (response.retCode !== 0) {
        throw new Error(`Failed to get price: ${response.retMsg}`);
      }

      const ticker = response.result?.list?.[0];
      if (!ticker) {
        throw new Error(`Ticker for ${symbol} not found`);
      }

      const lastPrice = parseFloat(ticker.lastPrice);
      logger.info(`[BYBIT] Current price for ${symbol}: ${lastPrice}`);
      
      return lastPrice;
    } catch (error) {
      logger.error(`[BYBIT] Error getting current price for ${symbol}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Встановлює плече для символу
   */
  async setLeverage(symbol, leverage) {
    try {
      const response = await this.client.setLeverage({
        category: 'linear',
        symbol: symbol,
        buyLeverage: leverage.toString(),
        sellLeverage: leverage.toString()
      });
  
      // Перевіряємо чи плече вже встановлене
      if (response.retMsg === 'leverage not modified' || response.retCode === 110043) {
        logger.info(`[BYBIT] Leverage already set to ${leverage}x for ${symbol}`);
        return true;
      }
  
      if (response.retCode !== 0) {
        throw new Error(`Failed to set leverage: ${response.retMsg}`);
      }
  
      logger.info(`[BYBIT] ✅ Leverage ${leverage}x set for ${symbol}`);
      return true;
    } catch (error) {
      // Якщо помилка "leverage not modified" - це OK
      if (error.message.includes('leverage not modified') || 
          error.message.includes('110043')) {
        logger.info(`[BYBIT] Leverage already set to ${leverage}x for ${symbol}`);
        return true;
      }
      
      logger.error(`[BYBIT] Error setting leverage: ${error.message}`);
      throw error;
    }
  }

  /**
   * Відкриває Market ордер
   */
  async openMarketOrder(symbol, side, quantity, positionIdx = 0) {
    try {
      logger.info(`[BYBIT] Opening ${side} market order: ${quantity} ${symbol}...`);
      
      const response = await this.client.submitOrder({
        category: 'linear',
        symbol: symbol,
        side: side, // 'Buy' або 'Sell'
        orderType: 'Market',
        qty: quantity.toString(),
        positionIdx: positionIdx // 0: one-way mode, 1: hedge-mode (LONG), 2: hedge-mode (SHORT)
      });

      if (response.retCode !== 0) {
        throw new Error(`Failed to open order: ${response.retMsg}`);
      }

      const orderId = response.result?.orderId;
      logger.info(`[BYBIT] ✅ Market order opened: Order ID ${orderId}`);
      
      return {
        orderId: orderId,
        orderLinkId: response.result?.orderLinkId,
        symbol: symbol,
        side: side,
        quantity: quantity
      };
    } catch (error) {
      logger.error(`[BYBIT] Error opening market order: ${error.message}`);
      throw error;
    }
  }

  /**
   * Встановлює Take Profit ордер
   */
  async setTakeProfit(symbol, side, takeProfitPrice, quantity, positionIdx = 0) {
    try {
      // Рекомендований шлях для V5: встановлювати TP/SL через setTradingStop
      if (typeof this.client.setTradingStop !== 'function') {
        throw new Error('Bybit client does not support setTradingStop (upgrade bybit-api package)');
      }

      logger.info(`[BYBIT] Setting Take Profit via setTradingStop: @ ${takeProfitPrice} for ${symbol}...`);

      const response = await this.client.setTradingStop({
        category: 'linear',
        symbol,
        positionIdx,
        takeProfit: takeProfitPrice.toString(),
        tpTriggerBy: 'LastPrice'
      });

      if (response.retCode !== 0) {
        throw new Error(`Failed to set Take Profit: ${response.retMsg}`);
      }

      return {
        orderId: response.result?.orderId || 'TP_SET_TRADING_STOP',
        price: takeProfitPrice
      };
    } catch (error) {
      logger.error(`[BYBIT] Error setting Take Profit: ${error.message}`);
      throw error;
    }
  }

  /**
   * Встановлює Stop Loss ордер
   */
  async setStopLoss(symbol, side, stopLossPrice, quantity, positionIdx = 0) {
    try {
      // Рекомендований шлях для V5: встановлювати TP/SL через setTradingStop
      if (typeof this.client.setTradingStop !== 'function') {
        throw new Error('Bybit client does not support setTradingStop (upgrade bybit-api package)');
      }

      logger.info(`[BYBIT] Setting Stop Loss via setTradingStop: @ ${stopLossPrice} for ${symbol}...`);

      const response = await this.client.setTradingStop({
        category: 'linear',
        symbol,
        positionIdx,
        stopLoss: stopLossPrice.toString(),
        slTriggerBy: 'LastPrice'
      });

      if (response.retCode !== 0) {
        throw new Error(`Failed to set Stop Loss: ${response.retMsg}`);
      }

      return {
        orderId: response.result?.orderId || 'SL_SET_TRADING_STOP',
        price: stopLossPrice
      };
    } catch (error) {
      logger.error(`[BYBIT] Error setting Stop Loss: ${error.message}`);
      throw error;
    }
  }

  /**
   * Отримує відкриті позиції
   */
  async getOpenPositions(symbol = null) {
    try {
      const params = {
        category: 'linear'
      };
      
      if (symbol) {
        params.symbol = symbol;
      }

      const response = await this.client.getPositionInfo(params);

      if (response.retCode !== 0) {
        throw new Error(`Failed to get positions: ${response.retMsg}`);
      }

      const positions = (response.result?.list || [])
        .filter(pos => parseFloat(pos.size || '0') !== 0)
        .map(pos => ({
          symbol: pos.symbol,
          side: pos.side,
          size: parseFloat(pos.size || '0'),
          entryPrice: parseFloat(pos.avgPrice || '0'),
          markPrice: parseFloat(pos.markPrice || '0'),
          unrealisedPnl: parseFloat(pos.unrealisedPnl || '0'),
          leverage: parseFloat(pos.leverage || '1')
        }));

      return positions;
    } catch (error) {
      logger.error(`[BYBIT] Error getting open positions: ${error.message}`);
      throw error;
    }
  }

  /**
   * Перевіряє чи є відкрита позиція по символу
   */
  async hasOpenPosition(symbol) {
    const positions = await this.getOpenPositions(symbol);
    return positions.length > 0;
  }

  /**
   * Отримує історію угод
   */
  async getTradeHistory(symbol = null, limit = 50) {
    try {
      const params = {
        category: 'linear',
        limit: limit
      };
      
      if (symbol) {
        params.symbol = symbol;
      }

      const response = await this.client.getExecutionList(params);

      if (response.retCode !== 0) {
        throw new Error(`Failed to get trade history: ${response.retMsg}`);
      }

      return response.result?.list || [];
    } catch (error) {
      logger.error(`[BYBIT] Error getting trade history: ${error.message}`);
      throw error;
    }
  }
}

// Експортуємо singleton
const bybitService = new BybitService();
export default bybitService;
