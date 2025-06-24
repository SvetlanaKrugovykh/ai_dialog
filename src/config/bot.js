const TelegramBot = require('node-telegram-bot-api')
require('dotenv').config()

const token = process.env.TELEGRAM_BOT_TOKEN

if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN not found in environment variables')
}

const bot = new TelegramBot(token, { polling: true })

// Bot configuration settings
const botConfig = {
  // Maximum message length for Telegram
  maxMessageLength: 4096,
  // Timeout for ChatGPT requests
  chatGptTimeout: 30000,
  // Maximum number of message sending retries
  maxRetries: 3
}

module.exports = { bot, botConfig }
