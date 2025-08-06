const axios = require('axios')
const https = require('https')
const logger = require('../utils/logger')
const messages = require('../../data/messages')
const logMessages = require('../../data/logMessages')
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
      logger.info(logMessages.auth.checking(telegramId))

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
        logger.info(logMessages.auth.success(
          authResult.user.firstname, 
          authResult.user.lastname, 
          authResult.user.email
        ))
        return {
          authenticated: true,
          user: authResult.user,
          welcomeMessage: messages.auth.welcome(
            authResult.user.firstname, 
            authResult.user.lastname, 
            authResult.user.email
          )
        }
      } else if (authResult.success && !authResult.exists) {
        const message = messages.auth.userNotFound(telegramId)
        
        if (this.mode === 'debug') {
          logger.warn(logMessages.auth.notFoundDebug(telegramId))
          return {
            authenticated: false,
            blocked: false,
            user: null,
            warningMessage: messages.auth.debugModeWarning(message)
          }
        } else {
          logger.warn(logMessages.auth.notFoundBlocked(telegramId))
          return {
            authenticated: false,
            blocked: true,
            user: null,
            blockMessage: messages.auth.accessDenied(message)
          }
        }
      } else {
        throw new Error('Invalid response format from Zammad API')
      }

    } catch (error) {
      logger.error('Zammad API authentication error:', error)
      
      const errorMessage = messages.auth.serviceError
      
      if (this.mode === 'debug') {
        logger.warn(logMessages.auth.serviceErrorDebug)
        return {
          authenticated: false,
          blocked: false,
          user: null,
          warningMessage: messages.auth.debugModeWarning(errorMessage)
        }
      } else {
        logger.error(logMessages.auth.serviceErrorProduction)
        return {
          authenticated: false,
          blocked: true,
          user: null,
          blockMessage: messages.auth.accessDenied(errorMessage)
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
