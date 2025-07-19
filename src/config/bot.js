const TelegramBot = require('node-telegram-bot-api')
require('dotenv').config()

const token = process.env.TELEGRAM_BOT_TOKEN

if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN not found in environment variables')
}

const bot = new TelegramBot(token, { polling: true })

const botConfig = {
  maxMessageLength: 4096,
  chatGptTimeout: 30000,
  maxRetries: 3
}

module.exports = { bot, botConfig }
