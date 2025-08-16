const localAIService = require('../services/localAI')
const chatGPTService = require('../services/chatgpt')
const sessionService = require('../services/session')
const authService = require('../services/auth')
const logger = require('../utils/logger')
const messages = require('../../data/messages')
const logMessages = require('../../data/logMessages')
const fs = require('fs')
const path = require('path')

class MessageHandler {
  constructor() {
    this.commands = {
      '/start': this.handleStart.bind(this),
      '/help': this.handleHelp.bind(this),
      '/clear': this.handleClear.bind(this),
      '/stats': this.handleStats.bind(this),
      '/health': this.handleHealth.bind(this)
    }
    this.tempDir = path.join(__dirname, '../../temp')
    this.ensureTempDir()
  }

  ensureTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true })
    }
  }

  /**
   * Main handler for incoming messages
   * @param {Object} bot - bot instance
   * @param {Object} msg - message object
   */
  async handleMessage(bot, msg) {
    try {
      const chatId = msg.chat.id
      const userId = msg.from.id.toString()
      
      logger.info(logMessages.messages.received(userId, msg.voice ? 'voice' : 'text'))

      // Check if message is a command - handle authentication in command handlers
      if (msg.text && msg.text.startsWith('/')) {
        await this.handleCommand(bot, msg)
        return
      }

      // For non-command messages, check authentication here
      const authResult = await authService.authorizeUser(userId)
      
      if (!authResult.allowed) {
        await bot.sendMessage(chatId, authResult.message)
        logger.warn(logMessages.messages.accessDenied(userId))
        return
      }
      
      // Send welcome/warning message for first interaction (non-commands only)
      const session = sessionService.getSession(userId)
      if (!session.authenticated) {
        await bot.sendMessage(chatId, authResult.message)
        session.authenticated = true
        if (authResult.user) {
          session.userInfo = authResult.user
        }
        sessionService.updateSession(userId, session)
      }
      
      // Handle voice messages
      if (msg.voice) {
        await this.handleVoiceMessage(bot, msg)
        return
      }

      // Handle text messages
      if (msg.text) {
        await this.handleTextMessage(bot, msg)
        return
      }

      // Unsupported message type
      await bot.sendMessage(chatId, messages.errors.unsupportedMessage)

    } catch (error) {
      logger.error(logMessages.general.messageHandlingError, error)
      await bot.sendMessage(msg.chat.id, messages.errors.generalError)
    }
  }

  /**
   * Command handler
   * @param {Object} bot - bot instance
   * @param {Object} msg - message object
   */
  async handleCommand(bot, msg) {
    const command = msg.text.split(' ')[0]
    const handler = this.commands[command]

    if (handler) {
      await handler(bot, msg)
    } else {
      await bot.sendMessage(msg.chat.id, messages.errors.unknownCommand)
    }
  }

  /**
   * Handle /start command
   */
  async handleStart(bot, msg) {
    const chatId = msg.chat.id
    const userId = msg.from.id.toString()
    
    // Check user authentication for /start command
    const authResult = await authService.authorizeUser(userId)
    
    if (!authResult.allowed) {
      await bot.sendMessage(chatId, authResult.message)
      logger.warn(logMessages.messages.accessDeniedStart(userId))
      return
    }
    
    // Clear session and set authentication info
    sessionService.clearSession(userId)
    const session = sessionService.getSession(userId)
    session.authenticated = true
    if (authResult.user) {
      session.userInfo = authResult.user
    }
    sessionService.updateSession(userId, session)
    
    // Send auth message only once
    await bot.sendMessage(chatId, authResult.message)
    
    // Get bot info and send welcome message
    const botInfo = await bot.getMe()
    await bot.sendMessage(chatId, messages.bot.ready(botInfo.first_name || botInfo.username))
    logger.info(logMessages.messages.userStarted(userId))
  }

  /**
   * Handle /help command
   */
  async handleHelp(bot, msg) {
    const chatId = msg.chat.id
    const userId = msg.from.id.toString()
    
    // Check authentication for help command
    const authResult = await authService.authorizeUser(userId)
    
    if (!authResult.allowed) {
      await bot.sendMessage(chatId, authResult.message)
      return
    }
    
    const session = sessionService.getSession(userId)
    
    let userInfo = ''
    if (session.userInfo) {
      userInfo = messages.bot.helpHeader(
        session.userInfo.firstname, 
        session.userInfo.lastname, 
        session.userInfo.email
      )
    }
    
    const helpMessage = userInfo + messages.bot.helpMessage(authService.getMode())

    await bot.sendMessage(chatId, helpMessage)
  }

  /**
   * Handle /health command
   */
  async handleHealth(bot, msg) {
    const chatId = msg.chat.id
    const userId = msg.from.id.toString()
    
    // Check authentication for health command
    const authResult = await authService.authorizeUser(userId)
    
    if (!authResult.allowed) {
      await bot.sendMessage(chatId, authResult.message)
      return
    }
    
    try {
      const servicesStatus = await localAIService.checkServicesHealth()
      const allOnline = servicesStatus.speechToText && servicesStatus.textProcessing
      
      const statusMessage = messages.bot.healthStatus(
        servicesStatus.speechToText,
        servicesStatus.textProcessing,
        !!process.env.OPENAI_API_KEY,
        allOnline
      )

      await bot.sendMessage(chatId, statusMessage)
    } catch (error) {
      logger.error(logMessages.services.healthCheckFailed, error)
      await bot.sendMessage(chatId, messages.errors.healthCheckError)
    }
  }

  /**
   * Handle voice messages
   */
  async handleVoiceMessage(bot, msg) {
    const chatId = msg.chat.id
    const userId = msg.from.id.toString()
    const session = sessionService.getSession(userId)

    try {
      // Show processing indicator
      await bot.sendChatAction(chatId, 'typing')
      await bot.sendMessage(chatId, messages.processing.voiceProcessing)

      // Download voice file
      const fileId = msg.voice.file_id
      const file = await bot.getFile(fileId)
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`
      
      // Save voice file temporarily
      const tempFileName = `voice_${userId}_${Date.now()}.oga`
      const tempFilePath = path.join(this.tempDir, tempFileName)
      
      const response = await require('axios').get(fileUrl, { responseType: 'stream' })
      const writer = fs.createWriteStream(tempFilePath)
      response.data.pipe(writer)

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve)
        writer.on('error', reject)
      })

      // Get current message number for this user
      const segmentNumber = session.conversationHistory.length + 1

      try {
        if (process.env.ENABLE_SPEECH_TO_TEXT === 'true') {
          // Process voice through local AI
          const result = await localAIService.processVoiceMessage(tempFilePath, userId, segmentNumber, bot, chatId)
          
          // Save to history
          sessionService.addToHistory(userId, 'voice_message', `[Voice message #${segmentNumber}]`)
          sessionService.addToHistory(userId, 'ai_response', result)

          // Send result to user
          await bot.sendMessage(chatId, messages.processing.aiResponse(result))
        } else {
          // Speech-to-text is disabled - skip to fallback
          logger.warn(logMessages.processing.speechToTextDisabled(userId))
          
          if (process.env.ENABLE_CHATGPT_FALLBACK === 'true') {
            await this.fallbackToChatGPT(bot, msg, '[Voice message - Speech-to-text disabled]', 'ENABLE_SPEECH_TO_TEXT is false')
          } else {
            await bot.sendMessage(chatId, messages.errors.voiceProcessingError)
          }
        }

      } catch (localError) {
        logger.warn(logMessages.processing.localAIFailed(userId, localError))
        
        // Check if ChatGPT fallback is enabled for voice processing
        if (process.env.ENABLE_CHATGPT_FALLBACK === 'true') {
          // Try ChatGPT fallback for voice message (it can't transcribe, but can process general voice message request)
          await this.fallbackToChatGPT(bot, msg, '[Voice message - local transcription failed, processing as general voice request]', localError.message)
        } else {
          // Send error message without fallback
          await bot.sendMessage(chatId, messages.errors.voiceProcessingError)
        }
      }

      // Clean up temp file
      fs.unlink(tempFilePath, (err) => {
        if (err) logger.warn(logMessages.files.tempFileDeleteFailed, err)
      })

    } catch (error) {
      logger.error(logMessages.processing.voiceProcessingError(userId), error)
      await bot.sendMessage(chatId, messages.errors.voiceProcessingError)
    }
  }

  /**
   * Handle text messages
   */
  async handleTextMessage(bot, msg) {
    const chatId = msg.chat.id
    const userId = msg.from.id.toString()
    const messageText = msg.text

    try {
      // Show processing indicator
      await bot.sendChatAction(chatId, 'typing')

      try {
        if (process.env.ENABLE_LOCAL_AI === 'true') {
          // Process text through local AI
          const result = await localAIService.processTextMessage(messageText, userId)
          
          // Save to history
          sessionService.addToHistory(userId, 'text_message', messageText)
          sessionService.addToHistory(userId, 'ai_response', result)

          // Send result to user
          await bot.sendMessage(chatId, messages.processing.aiResponse(result))
        } else {
          // Local AI is disabled - skip to fallback
          logger.warn(logMessages.processing.localAIDisabled(userId))
          
          if (process.env.ENABLE_CHATGPT_FALLBACK === 'true') {
            await this.fallbackToChatGPT(bot, msg, messageText, 'ENABLE_LOCAL_AI is false')
          } else {
            await bot.sendMessage(chatId, messages.errors.textProcessingError)
          }
        }

      } catch (localError) {
        logger.warn(logMessages.processing.localAIFailed(userId, localError))
        
        // Check if ChatGPT fallback is enabled
        if (process.env.ENABLE_CHATGPT_FALLBACK === 'true') {
          // Fallback to ChatGPT if local services fail
          await this.fallbackToChatGPT(bot, msg, messageText, localError.message)
        } else {
          // Send error message without fallback
          await bot.sendMessage(chatId, messages.errors.textProcessingError)
        }
      }

    } catch (error) {
      logger.error(logMessages.processing.textProcessingError(userId), error)
      await bot.sendMessage(chatId, messages.errors.textProcessingError)
    }
  }

  /**
   * Fallback to ChatGPT when local services fail
   */
  async fallbackToChatGPT(bot, msg, originalMessage, localError) {
    const chatId = msg.chat.id
    const userId = msg.from.id.toString()

    try {
      await bot.sendMessage(chatId, messages.processing.localAIFallback(localError))
      
      // Use ChatGPT as fallback
      const gptResponse = await chatGPTService.processQuestion(originalMessage, userId)
      
      // Save to history
      sessionService.addToHistory(userId, 'chatgpt_fallback', gptResponse)
      
      await bot.sendMessage(chatId, messages.processing.chatgptResponse(gptResponse))

    } catch (gptError) {
      logger.error(logMessages.processing.chatgptFallbackFailed(userId), gptError)
      await bot.sendMessage(chatId, messages.errors.servicesUnavailable)
    }
  }

  /**
   * Handle /clear command
   */
  async handleClear(bot, msg) {
    const chatId = msg.chat.id
    const userId = msg.from.id.toString()
    
    // Check authentication for clear command
    const authResult = await authService.authorizeUser(userId)
    
    if (!authResult.allowed) {
      await bot.sendMessage(chatId, authResult.message)
      return
    }
    
    sessionService.clearSession(userId)
    await bot.sendMessage(chatId, messages.success.historyCleared)
  }

  /**
   * Handle /stats command
   */
  async handleStats(bot, msg) {
    const chatId = msg.chat.id
    const userId = msg.from.id.toString()
    
    // Check authentication for stats command
    const authResult = await authService.authorizeUser(userId)
    
    if (!authResult.allowed) {
      await bot.sendMessage(chatId, authResult.message)
      return
    }
    
    const stats = sessionService.getStats()
    const statsMessage = messages.bot.statsMessage(
      stats.totalSessions,
      stats.activeSessions,
      this.getUptime()
    )

    await bot.sendMessage(chatId, statsMessage)
  }

  getUptime() {
    const uptime = process.uptime()
    const hours = Math.floor(uptime / 3600)
    const minutes = Math.floor((uptime % 3600) / 60)
    return `${hours}h ${minutes}m`
  }
}

module.exports = new MessageHandler()
