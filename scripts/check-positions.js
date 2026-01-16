import dotenv from 'dotenv';
import bybitService from '../services/bybit.service.js';
import logger from '../utils/logger.js';

dotenv.config();

async function checkPositions() {
  try {
    logger.info('Checking open positions...');
    
    await bybitService.connect();
    const positions = await bybitService.getOpenPositions();
    
    console.log('\n' + '='.repeat(50));
    
    if (positions.length === 0) {
      console.log('📊 No open positions');
    } else {
      console.log(`📊 Open Positions: ${positions.length}\n`);
      
      positions.forEach((pos, index) => {
        console.log(`Position ${index + 1}:`);
        console.log(`  Symbol: ${pos.symbol}`);
        console.log(`  Side: ${pos.side}`);
        console.log(`  Size: ${pos.size}`);
        console.log(`  Entry Price: $${pos.entryPrice.toFixed(4)}`);
        console.log(`  Mark Price: $${pos.markPrice.toFixed(4)}`);
        console.log(`  Unrealised P&L: ${pos.unrealisedPnl >= 0 ? '+' : ''}$${pos.unrealisedPnl.toFixed(2)}`);
        console.log(`  Leverage: ${pos.leverage}x`);
        console.log('');
      });
    }
    
    console.log('='.repeat(50) + '\n');
    
    process.exit(0);
  } catch (error) {
    logger.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

checkPositions();
