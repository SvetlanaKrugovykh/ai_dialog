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
      const chatId = msg.chat?.id || msg.callback_query?.message?.chat?.id
      const userId = msg.from?.id?.toString() || msg.callback_query?.from?.id?.toString()
      
      // Handle callback queries from inline keyboards first
      if (msg.callback_query) {
        logger.info(`Callback query received from user ${userId}: ${msg.callback_query.data}`)
        await this.handleCallbackQuery(bot, msg.callback_query)
        return
      }
      
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
      const chatId = msg.chat?.id || msg.callback_query?.message?.chat?.id
      if (chatId) {
        await bot.sendMessage(chatId, messages.errors.generalError)
      }
    }
  }

  /**
   * Handle callback queries from inline keyboards
   * @param {Object} bot - bot instance
   * @param {Object} callbackQuery - callback query object
   */
  async handleCallbackQuery(bot, callbackQuery) {
    try {
      const chatId = callbackQuery.message.chat.id
      const userId = callbackQuery.from.id.toString()
      const data = callbackQuery.data

      // Acknowledge the callback query
      await bot.answerCallbackQuery(callbackQuery.id)

      // Parse callback data: action_ticketId
      const [action, ticketId] = data.split('_')

      switch (action) {
        case 'confirm':
          await this.confirmTicket(bot, chatId, userId, ticketId)
          break
        case 'cancel':
          await this.cancelTicket(bot, chatId, userId, ticketId)
          break
        case 'edit':
          await this.editTicket(bot, chatId, userId, ticketId)
          break
        case 'edittext':
          await this.startTextEditing(bot, chatId, userId, ticketId)
          break
        case 'editvoice':
          await this.startVoiceEditing(bot, chatId, userId, ticketId)
          break
        case 'back':
          await this.backToTicketPreview(bot, chatId, userId, ticketId)
          break
        default:
          logger.warn(`Unknown callback action: ${action}`)
      }

    } catch (error) {
      logger.error(logMessages.general.callbackHandlingError, error)
      await bot.sendMessage(callbackQuery.message.chat.id, messages.errors.generalError)
    }
  }

  /**
   * Confirm and send ticket to Service-Desk
   */
  async confirmTicket(bot, chatId, userId, ticketId) {
    try {
      const session = sessionService.getSession(userId)
      const pendingTicket = session.pendingTickets?.[ticketId]

      if (!pendingTicket) {
        await bot.sendMessage(chatId, messages.errors.ticketNotFound)
        return
      }

      // Here would be the actual Service-Desk API call
      // For now, we'll just simulate successful creation
      await bot.sendMessage(chatId, messages.success.ticketSent(pendingTicket.id))
      
      // Remove from pending tickets
      if (session.pendingTickets) {
        delete session.pendingTickets[ticketId]
        sessionService.updateSession(userId, session)
      }

      logger.info(logMessages.tickets.confirmed(userId, ticketId))

    } catch (error) {
      logger.error(logMessages.tickets.confirmError(userId, ticketId), error)
      await bot.sendMessage(chatId, messages.errors.ticketConfirmError)
    }
  }

  /**
   * Cancel ticket creation
   */
  async cancelTicket(bot, chatId, userId, ticketId) {
    try {
      const session = sessionService.getSession(userId)
      
      if (session.pendingTickets) {
        delete session.pendingTickets[ticketId]
        sessionService.updateSession(userId, session)
      }

      await bot.sendMessage(chatId, messages.success.ticketCancelled)
      logger.info(logMessages.tickets.cancelled(userId, ticketId))

    } catch (error) {
      logger.error(logMessages.tickets.cancelError(userId, ticketId), error)
      await bot.sendMessage(chatId, messages.errors.generalError)
    }
  }

  /**
   * Start ticket editing process
   */
  async editTicket(bot, chatId, userId, ticketId) {
    try {
      const session = sessionService.getSession(userId)
      const pendingTicket = session.pendingTickets?.[ticketId]

      if (!pendingTicket) {
        await bot.sendMessage(chatId, messages.errors.ticketNotFound)
        return
      }

      // Set editing mode
      if (!session.editingTicket) {
        session.editingTicket = {}
      }
      session.editingTicket.ticketId = ticketId
      session.editingTicket.mode = 'waiting'
      sessionService.updateSession(userId, session)

      // Create editing options keyboard
      const editOptions = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: messages.tickets.buttons.editText, callback_data: `edittext_${ticketId}` },
              { text: messages.tickets.buttons.editVoice, callback_data: `editvoice_${ticketId}` }
            ],
            [
              { text: messages.tickets.buttons.back, callback_data: `back_${ticketId}` }
            ]
          ]
        }
      }

      await bot.sendMessage(chatId, messages.tickets.editOptions, editOptions)
      logger.info(logMessages.tickets.editStarted(userId, ticketId))

    } catch (error) {
      logger.error(logMessages.tickets.editError(userId, ticketId), error)
      await bot.sendMessage(chatId, messages.errors.generalError)
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

      // Check if user is in voice editing mode
      if (session.editingTicket && session.editingTicket.mode === 'voice') {
        if (process.env.ENABLE_SPEECH_TO_TEXT === 'true') {
          // Process voice for editing
          const segmentNumber = session.conversationHistory.length + 1
          const transcription = await localAIService.speechToText(tempFilePath, userId, segmentNumber)
          await this.processTicketEdit(bot, chatId, userId, transcription, 'voice')
        } else {
          await bot.sendMessage(chatId, messages.errors.voiceProcessingError)
        }
        
        // Clean up temp file
        fs.unlink(tempFilePath, (err) => {
          if (err) logger.warn(logMessages.files.tempFileDeleteFailed, err)
        })
        return
      }

      // Get current message number for this user
      const segmentNumber = session.conversationHistory.length + 1

      try {
        if (process.env.ENABLE_SPEECH_TO_TEXT === 'true') {
          // Process voice through local AI
          const result = await localAIService.processVoiceMessage(tempFilePath, userId, segmentNumber, bot, chatId)
          
          // Save to history
          sessionService.addToHistory(userId, 'voice_message', `[Voice message #${segmentNumber}]`)
          sessionService.addToHistory(userId, 'ai_response', result)

          // Create pending ticket for confirmation instead of sending directly
          await this.createPendingTicket(bot, chatId, userId, result, 'voice')

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
      // Check if user is in editing mode
      const session = sessionService.getSession(userId)
      if (session.editingTicket && session.editingTicket.mode === 'text') {
        await this.processTicketEdit(bot, chatId, userId, messageText, 'text')
        return
      }

      // Show processing indicator
      await bot.sendChatAction(chatId, 'typing')

      try {
        if (process.env.ENABLE_LOCAL_AI === 'true') {
          // Process text through local AI
          const result = await localAIService.processTextMessage(messageText, userId)
          
          // Save to history
          sessionService.addToHistory(userId, 'text_message', messageText)
          sessionService.addToHistory(userId, 'ai_response', result)

          // Create pending ticket for confirmation instead of sending directly
          await this.createPendingTicket(bot, chatId, userId, result, 'text')

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
   * Process ticket editing from text or voice input
   */
  async processTicketEdit(bot, chatId, userId, editText, inputType) {
    try {
      const session = sessionService.getSession(userId)
      const ticketId = session.editingTicket?.ticketId
      const pendingTicket = session.pendingTickets?.[ticketId]

      if (!pendingTicket || !ticketId) {
        await bot.sendMessage(chatId, messages.errors.ticketNotFound)
        return
      }

      // Show processing indicator
      await bot.sendChatAction(chatId, 'typing')
      await bot.sendMessage(chatId, messages.tickets.processing)

      // Process edit instructions
      const updatedTicket = await this.applyTicketEdits(pendingTicket.content, editText)
      
      // Update pending ticket
      pendingTicket.content = updatedTicket
      pendingTicket.lastModified = new Date().toISOString()
      session.pendingTickets[ticketId] = pendingTicket

      // Clear editing mode
      session.editingTicket = null
      sessionService.updateSession(userId, session)

      // Show updated ticket with confirmation buttons
      const confirmationKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: messages.tickets.buttons.confirm, callback_data: `confirm_${ticketId}` },
              { text: messages.tickets.buttons.cancel, callback_data: `cancel_${ticketId}` }
            ],
            [
              { text: messages.tickets.buttons.editAgain, callback_data: `edit_${ticketId}` }
            ]
          ]
        }
      }

      const ticketPreview = messages.tickets.updatedPreview(updatedTicket)

      await bot.sendMessage(chatId, ticketPreview, {
        ...confirmationKeyboard,
        parse_mode: 'Markdown'
      })

      logger.info(`Ticket ${ticketId} edited by user ${userId} via ${inputType}`)

    } catch (error) {
      logger.error(logMessages.tickets.editError(userId, 'unknown'), error)
      await bot.sendMessage(chatId, messages.errors.generalError)
    }
  }

  /**
   * Apply edit instructions to ticket content
   */
  async applyTicketEdits(originalContent, editInstructions) {
    try {
      // Simple keyword-based editing logic
      // In production, this could use AI to understand natural language editing instructions
      
      let updatedContent = originalContent
      const lowerEdit = editInstructions.toLowerCase()

      // Handle title changes
      if (lowerEdit.includes('заголовок') || lowerEdit.includes('назва')) {
        const titleMatch = editInstructions.match(/(?:заголовок|назва)(?:\s+на)?:?\s*(.+?)(?:\n|$)/i)
        if (titleMatch) {
          const newTitle = titleMatch[1].trim()
          updatedContent = updatedContent.replace(/📝\s*\*\*Заголовок:\*\*\s*[^\n]+/i, `📝 **Заголовок:** ${newTitle}`)
        }
      }

      // Handle description changes
      if (lowerEdit.includes('опис') || lowerEdit.includes('проблем')) {
        const descMatch = editInstructions.match(/(?:опис|проблем)(?:\s+на)?:?\s*(.+?)(?:\n|$)/i)
        if (descMatch) {
          const newDesc = descMatch[1].trim()
          updatedContent = updatedContent.replace(/📄\s*\*\*Опис:\*\*\s*[^\n]+/i, `📄 **Опис:** ${newDesc}`)
        }
      }

      // Handle priority changes
      if (lowerEdit.includes('пріоритет')) {
        let newPriority = 'Medium'
        if (lowerEdit.includes('високий') || lowerEdit.includes('high')) {
          newPriority = 'High'
        } else if (lowerEdit.includes('низький') || lowerEdit.includes('low')) {
          newPriority = 'Low'
        } else if (lowerEdit.includes('критичний') || lowerEdit.includes('critical')) {
          newPriority = 'Critical'
        }
        updatedContent = updatedContent.replace(/🔴\s*\*\*Пріоритет:\*\*\s*[^\n]+/i, `🔴 **Пріоритет:** ${newPriority}`)
      }

      // If no specific changes detected, append the edit as additional information
      if (updatedContent === originalContent) {
        updatedContent += `\n\n🔄 **Додаткова інформація:**\n${editInstructions}`
      }

      return updatedContent

    } catch (error) {
      logger.error('Error applying ticket edits:', error)
      return originalContent + `\n\n🔄 **Додаткова інформація:**\n${editInstructions}`
    }
  }

  /**
   * Start text editing mode
   */
  async startTextEditing(bot, chatId, userId, ticketId) {
    try {
      const session = sessionService.getSession(userId)
      
      if (!session.editingTicket) {
        session.editingTicket = {}
      }
      session.editingTicket.ticketId = ticketId
      session.editingTicket.mode = 'text'
      sessionService.updateSession(userId, session)

      await bot.sendMessage(chatId, 
        messages.tickets.textEditInstruction,
        { parse_mode: 'Markdown' }
      )

    } catch (error) {
      logger.error(logMessages.tickets.editError(userId, ticketId), error)
      await bot.sendMessage(chatId, messages.errors.generalError)
    }
  }

  /**
   * Start voice editing mode
   */
  async startVoiceEditing(bot, chatId, userId, ticketId) {
    try {
      const session = sessionService.getSession(userId)
      
      if (!session.editingTicket) {
        session.editingTicket = {}
      }
      session.editingTicket.ticketId = ticketId
      session.editingTicket.mode = 'voice'
      sessionService.updateSession(userId, session)

      await bot.sendMessage(chatId, 
        messages.tickets.voiceEditInstruction,
        { parse_mode: 'Markdown' }
      )

    } catch (error) {
      logger.error(logMessages.tickets.editError(userId, ticketId), error)
      await bot.sendMessage(chatId, messages.errors.generalError)
    }
  }

  /**
   * Return to ticket preview
   */
  async backToTicketPreview(bot, chatId, userId, ticketId) {
    try {
      const session = sessionService.getSession(userId)
      const pendingTicket = session.pendingTickets?.[ticketId]

      if (!pendingTicket) {
        await bot.sendMessage(chatId, messages.errors.ticketNotFound)
        return
      }

      // Clear editing mode
      session.editingTicket = null
      sessionService.updateSession(userId, session)

      // Show ticket preview again
      const confirmationKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: messages.tickets.buttons.confirm, callback_data: `confirm_${ticketId}` },
              { text: messages.tickets.buttons.cancel, callback_data: `cancel_${ticketId}` }
            ],
            [
              { text: messages.tickets.buttons.edit, callback_data: `edit_${ticketId}` }
            ]
          ]
        }
      }

      const ticketPreview = messages.tickets.preview(pendingTicket.content)

      await bot.sendMessage(chatId, ticketPreview, {
        ...confirmationKeyboard,
        parse_mode: 'Markdown'
      })

    } catch (error) {
      logger.error(logMessages.tickets.editError(userId, ticketId), error)
      await bot.sendMessage(chatId, messages.errors.generalError)
    }
  }

  /**
   * Create pending ticket for user confirmation
   */
  async createPendingTicket(bot, chatId, userId, ticketContent, sourceType) {
    try {
      // Generate unique ticket ID
      const ticketId = `TKT-${Date.now()}`
      
      // Get or initialize session
      const session = sessionService.getSession(userId)
      if (!session.pendingTickets) {
        session.pendingTickets = {}
      }

      // Store pending ticket
      session.pendingTickets[ticketId] = {
        id: ticketId,
        content: ticketContent,
        sourceType: sourceType,
        createdAt: new Date().toISOString(),
        userId: userId
      }
      sessionService.updateSession(userId, session)

      // Create confirmation keyboard
      const confirmationKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: messages.tickets.buttons.confirm, callback_data: `confirm_${ticketId}` },
              { text: messages.tickets.buttons.cancel, callback_data: `cancel_${ticketId}` }
            ],
            [
              { text: messages.tickets.buttons.edit, callback_data: `edit_${ticketId}` }
            ]
          ]
        }
      }

      // Send ticket preview with confirmation buttons
      const ticketPreview = messages.tickets.preview(ticketContent)

      await bot.sendMessage(chatId, ticketPreview, {
        ...confirmationKeyboard,
        parse_mode: 'Markdown'
      })

      logger.info(logMessages.tickets.created(userId, ticketId))

    } catch (error) {
      logger.error(logMessages.tickets.createError(userId), error)
      await bot.sendMessage(chatId, messages.errors.ticketCreateError)
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
