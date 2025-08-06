const axios = require('axios')
const https = require('https')
const logger = require('../utils/logger')
require('dotenv').config()

class AuthService {
  constructor() {
    this.zammadApiUrl = process.env.ZAMMAD_API_URL || 'https://127.0.0.1:8001/api/check-user'
    this.mode = process.env.MODE || 'debug'
    this.timeout = 10000 // 10 seconds timeout
  }

  /**
   * Check if user exists in Zammad system
   * @param {string} telegramId - telegram user id
   * @returns {Promise<Object>} - authentication result
   */
  async checkUser(telegramId) {
    try {
      logger.info(`Checking user authentication for Telegram ID: ${telegramId}`)

      const response = await axios.post(this.zammadApiUrl, {
        telegram_id: telegramId
      }, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: this.timeout,
        // Allow self-signed certificates for localhost
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        })
      })

      const authResult = response.data
      
      if (authResult.success && authResult.exists && authResult.user) {
        logger.info(`User authenticated successfully: ${authResult.user.firstname} ${authResult.user.lastname} (${authResult.user.email})`)
        return {
          authenticated: true,
          user: authResult.user,
          welcomeMessage: `👋 Привіт, ${authResult.user.firstname} ${authResult.user.lastname}!\n📧 ${authResult.user.email}\n✅ Вас успішно авторизовано в системі.`
        }
      } else if (authResult.success && !authResult.exists) {
        const message = `❌ Користувач з Telegram ID ${telegramId} не знайден в системі Zammad.`
        
        if (this.mode === 'debug') {
          logger.warn(`User not found in debug mode: ${telegramId}`)
          return {
            authenticated: false,
            blocked: false,
            user: null,
            warningMessage: `⚠️ РЕЖИМ НАЛАГОДЖЕННЯ\n${message}\nРобота продовжується в тестовому режимі.`
          }
        } else {
          logger.warn(`User not found, blocking access: ${telegramId}`)
          return {
            authenticated: false,
            blocked: true,
            user: null,
            blockMessage: `🚫 ${message}\nДоступ заборонено. Зверніться до адміністратора.`
          }
        }
      } else {
        throw new Error('Invalid response format from Zammad API')
      }

    } catch (error) {
      logger.error('Zammad API authentication error:', error)
      
      const errorMessage = `🔧 Помилка з'єднання з сервісом авторизації.\nСпробуйте пізніше або зверніться до підтримки.`
      
      if (this.mode === 'debug') {
        logger.warn('Authentication service error in debug mode, allowing access')
        return {
          authenticated: false,
          blocked: false,
          user: null,
          warningMessage: `⚠️ РЕЖИМ НАЛАГОДЖЕННЯ\n${errorMessage}\nРобота продовжується в тестовому режимі.`
        }
      } else {
        logger.error('Authentication service error in production mode, blocking access')
        return {
          authenticated: false,
          blocked: true,
          user: null,
          blockMessage: `🚫 ${errorMessage}`
        }
      }
    }
  }

  /**
   * Get current mode
   * @returns {string} - current mode (debug/production)
   */
  getMode() {
    return this.mode
  }

  /**
   * Check if user is allowed to use the bot
   * @param {string} telegramId - telegram user id
   * @returns {Promise<{allowed: boolean, message?: string, user?: Object}>}
   */
  async authorizeUser(telegramId) {
    const authResult = await this.checkUser(telegramId)
    
    if (authResult.authenticated) {
      return {
        allowed: true,
        message: authResult.welcomeMessage,
        user: authResult.user
      }
    } else if (authResult.blocked) {
      return {
        allowed: false,
        message: authResult.blockMessage
      }
    } else {
      // Debug mode - user not found but allowed
      return {
        allowed: true,
        message: authResult.warningMessage
      }
    }
  }
}

module.exports = new AuthService()
