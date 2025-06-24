const { bot } = require('./config/bot')
const messageHandler = require('./handlers/messageHandler')
const sessionService = require('./services/session')
const logger = require('./utils/logger')
require('dotenv').config()

// Bot initialization
logger.info('🤖 AI Dialog Bot starting...')

// Incoming messages handler
bot.on('message', async (msg) => {
  try {
    await messageHandler.handleMessage(bot, msg)
  } catch (error) {
    logger.error('Error in message handler:', error)
    await bot.sendMessage(msg.chat.id, 'An error occurred. Please try again.')
  }
})

// Polling errors handler
bot.on('polling_error', (error) => {
  logger.error('Polling error:', error)

  if (error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED') {
    logger.info('Connection error, attempting to restart polling...')
    setTimeout(() => {
      bot.stopPolling()
        .then(() => bot.startPolling())
        .catch(err => logger.error('Failed to restart polling:', err))
    }, 5000)
  }
})

// Periodic cleanup of inactive sessions (every 30 minutes)
setInterval(() => {
  sessionService.cleanupInactiveSessions()
}, 30 * 60 * 1000)

// Process termination handler
process.on('SIGINT', () => {
  logger.info('🛑 Bot stopping gracefully...')
  bot.stopPolling()
    .then(() => {
      logger.info('✅ Bot stopped successfully')
      process.exit(0)
    })
    .catch(err => {
      logger.error('Error stopping bot:', err)
      process.exit(1)
    })
})

// Unhandled exceptions handler
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error)
  process.exit(1)
})

logger.info('✅ AI Dialog Bot is running!')

module.exports = { bot }

