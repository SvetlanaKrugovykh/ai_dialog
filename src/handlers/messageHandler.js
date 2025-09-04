const localAIService = require('../services/localAI')
const chatGPTService = require('../services/chatgpt')
const sessionService = require('../services/session')
const authService = require('../services/auth')
const ticketService = require('../services/ticketService')
const ticketParser = require('../services/ticketParser')
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
    this.authCache = new Map()
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
      if (!this.authCache.has(userId)) {
        const authResult = await authService.authorizeUser(userId)
        this.authCache.set(userId, authResult)
      }
      const authResult = this.authCache.get(userId)

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

      // Enforce voice-only input
      if (!msg.voice) {
        await bot.sendMessage(chatId, messages.errors.onlyVoiceAllowed)
        return
      }

      // Handle voice messages
      if (msg.voice) {
        await this.handleVoiceMessage(bot, msg)
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

      logger.info(`Callback query received from user ${userId}: ${data}`)

      // Parse callback data - handle different formats
      let action, ticketId

      if (data.startsWith('editfield_')) {
        // For editfield_title_TKT-123
        const parts = data.split('_')
        if (parts.length >= 3) {
          action = `${parts[0]}_${parts[1]}` // "editfield_title"
          ticketId = parts.slice(2).join('_') // "TKT-123" (handle IDs with dashes)
        } else {
          logger.warn(`Invalid callback format: ${data}`)
          return
        }
      } else {
        // For simple format: action_ticketId
        const parts = data.split('_')
        action = parts[0]
        ticketId = parts.slice(1).join('_') // Handle ticket IDs with dashes
      }

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
        case 'editfull':
          await this.startFullEditing(bot, chatId, userId, ticketId)
          break
        case 'editvoice':
          await this.startVoiceEditing(bot, chatId, userId, ticketId)
          break
        case 'back':
          await this.backToTicketPreview(bot, chatId, userId, ticketId)
          break
        default:
          // Handle field editing callbacks 
          if (action.startsWith('editfield_')) {
            const fieldName = action.split('_')[1] // Extract field name from "editfield_title"
            await this.startFieldEditing(bot, chatId, userId, ticketId, fieldName)
          } else {
            logger.warn(`Unknown callback action: ${action}`)
          }
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

      // Show processing message
      await bot.sendChatAction(chatId, 'typing')
      await bot.sendMessage(chatId, messages.tickets.processingMessage)

      // Create ticket in Service Desk using ticketService
      const creationResult = await ticketService.createTicket({
        content: pendingTicket.content,
        telegramId: userId,
        userInfo: session.userInfo
      })

      if (creationResult.success) {
        // Success - send confirmation with ticket ID
        await bot.sendMessage(chatId, creationResult.message)

        // Mark the ticket as sent
        if (!session.sentTickets) {
          session.sentTickets = []
        }
        session.sentTickets.push(ticketId)

        // Remove from pending tickets
        if (session.pendingTickets) {
          delete session.pendingTickets[ticketId]
          sessionService.updateSession(userId, session)
        }

        logger.info(`Ticket successfully created: ${creationResult.ticketId} for user ${userId}`)

        // Remove the confirmation keyboard using stored message_id keyed by ticketId
        try {
          const messageId = session.messages?.[ticketId]
          if (messageId) {
            await bot.editMessageReplyMarkup(null, { chat_id: chatId, message_id: messageId })
            logger.info(`Inline keyboard removed for message ${messageId}`)

            // Clean up stored message_id
            delete session.messages[ticketId]
            sessionService.updateSession(userId, session)
          } else {
            logger.warn(`No stored message_id for ticket ${ticketId} of user ${userId}`)
          }
        } catch (error) {
          logger.error(`Failed to remove inline keyboard for ticket ${ticketId}:`, error)
        }

      } else {
        // Error - show concise error message and keep ticket pending
        await bot.sendMessage(chatId, creationResult.message)
        const shortErr = creationResult.error || 'unknown_error'
        logger.error(`Ticket creation failed for user ${userId}: ${shortErr}`)

        // In debug mode, still remove the ticket to avoid accumulation
        if (ticketService.getMode() === 'debug' && session.pendingTickets) {
          delete session.pendingTickets[ticketId]
          sessionService.updateSession(userId, session)
        }
      }

    } catch (error) {
      logger.error(logMessages.tickets.confirmError(userId, ticketId), error)
      await bot.sendMessage(chatId, messages.tickets.creationError)
    }
  }

  /**
   * Cancel ticket creation
   */
  async cancelTicket(bot, chatId, userId, ticketId) {
    try {
      const session = sessionService.getSession(userId)

      // Check if the ticket is already sent
      if (session.sentTickets && session.sentTickets.includes(ticketId)) {
        await bot.sendMessage(chatId, messages.errors.ticketAlreadySent)
        return
      }

      // Check if the ticket is already canceled
      if (session.canceledTickets && session.canceledTickets.includes(ticketId)) {
        await bot.sendMessage(chatId, messages.errors.ticketAlreadyCancelled)
        return
      }

      if (session.pendingTickets) {
        delete session.pendingTickets[ticketId]
      }

      // Mark the ticket as canceled
      if (!session.canceledTickets) {
        session.canceledTickets = []
      }
      session.canceledTickets.push(ticketId)
      sessionService.updateSession(userId, session)

      await bot.sendMessage(chatId, messages.success.ticketCancelled)
      logger.info(logMessages.tickets.cancelled(userId, ticketId))

      // Remove the confirmation keyboard after canceling
      const messageId = session.messages?.[ticketId]
      if (messageId) {
        try {
          await bot.editMessageReplyMarkup(
            { reply_markup: { inline_keyboard: [] } },
            { chat_id: chatId, message_id: messageId }
          )
          logger.info(`Inline keyboard removed for message ${messageId}`)

          // Clean up the saved message_id after removing the keyboard
          delete session.messages[ticketId]
          sessionService.updateSession(userId, session)
        } catch (error) {
          logger.error(`Failed to remove inline keyboard for message ${messageId}:`, error)
        }
      } else {
        logger.warn(`No message_id found for user ${userId} to remove inline keyboard.`)
      }
    } catch (error) {
      logger.error(logMessages.tickets.cancelError(userId, ticketId), error)
      // Avoid sending a generic error message if the issue is with keyboard removal
      if (error.code !== 'MESSAGE_ID_INVALID') {
        await bot.sendMessage(chatId, messages.errors.generalError)
      }
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
              { text: messages.tickets.buttons.editFull, callback_data: `editfull_${ticketId}` },
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

        // Check if this is a validation error
        if (localError.message && localError.message.startsWith('VALIDATION_FAILED:')) {
          const reason = localError.message.replace('VALIDATION_FAILED: ', '')
          await bot.sendMessage(chatId, `❌ **Заявку відхилено**\n\n${reason}\n\nБудь ласка, опишіть вашу проблему більш детально та конкретно.`, { parse_mode: 'Markdown' })
          return
        }

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
      if (session.editingTicket) {
        if (session.editingTicket.mode === 'text' || session.editingTicket.mode === 'full') {
          logger.info(`User ${userId} is in editing mode: ${session.editingTicket.mode}`)
          await this.processTicketEdit(bot, chatId, userId, messageText, session.editingTicket.mode)
          return
        } else if (session.editingTicket.mode.startsWith('field_')) {
          // User is editing a specific field
          const fieldName = session.editingTicket.fieldName
          await this.setFieldValue(bot, chatId, userId, session.editingTicket.ticketId, fieldName, messageText)
          return
        }
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

        // Check if this is a validation error
        if (localError.message && localError.message.startsWith('VALIDATION_FAILED:')) {
          const reason = localError.message.replace('VALIDATION_FAILED: ', '')
          await bot.sendMessage(chatId, `❌ **Заявку відхилено**\n\n${reason}\n\nБудь ласка, опишіть вашу проблему більш детально та конкретно.`, { parse_mode: 'Markdown' })
          return
        }

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

      let updatedTicket

      if (inputType === 'full') {
        // For full editing, convert the editable text back to formatted ticket
        updatedTicket = this.convertFromEditableFormat(editText)
      } else {
        // For text/voice editing, apply edits to existing content
        updatedTicket = await this.applyTicketEdits(pendingTicket.content, editText)
      }

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

      logger.info(`Applying edits: "${editInstructions}" to content length ${originalContent.length}`)

      let updatedContent = originalContent
      const lowerEdit = editInstructions.toLowerCase()

      logger.info(`Lowercase edit instructions: "${lowerEdit}"`)

      // Handle title changes (with Surzhyk support) - ALWAYS REPLACE
      if (messages.tickets.editKeywords.title.some(keyword => lowerEdit.includes(keyword))) {
        logger.info('Detected title change request')

        // Extract title from the edit instruction 
        let newTitle = editInstructions
          .replace(/змінити заголовок|заголовок|назва|название|title|тема|на/gi, '')
          .replace(/^(що|что|то що|те що|на|:)?\s*/i, '')
          .trim()

        if (newTitle) {
          logger.info(`Changing title to: "${newTitle}"`)
          updatedContent = updatedContent.replace(/📝\s*\*\*Заголовок:\*\*\s*[^\n]+/i, `📝 **Заголовок:** ${newTitle}`)
          logger.info('Title successfully replaced')
        }
      }

      // Handle description changes
      if (messages.tickets.editKeywords.description.some(keyword => lowerEdit.includes(keyword))) {
        logger.info('Detected description change request')
        const descMatch = updatedContent.match(/📄\s*\*\*Опис:\*\*\s*(.+?)(?=\n🔴|\n🟡|\n🟢|\n⚫|\n📊|$)/s)
        if (descMatch) {
          const currentDesc = descMatch[1].trim()
          logger.info(`Current description: "${currentDesc.substring(0, 50)}..."`)

          // Check if it's "add to description" or "replace description"
          const isReplaceDescription = lowerEdit.includes('замін') || lowerEdit.includes('заме́н') ||
            lowerEdit.includes('змін') || lowerEdit.includes('перепиш') ||
            lowerEdit.includes('replace') || lowerEdit.includes('change')

          // By default, ADD to description unless explicitly asked to replace
          const isAddToDescription = !isReplaceDescription

          // Extract the new description part from the edit instruction
          let newDescPart = editInstructions
            .replace(/додати до опису|додати в опис|змінити опис|замінити опис|опис проблеми|опис|description|додати|добавить|доповнити|заменить|замінити|дополнить|изменить/gi, '')
            .replace(/^(що|что|то що|те що|на|:)?\s*/i, '')
            .trim()

          if (newDescPart) {
            if (isAddToDescription) {
              // Add to existing description (DEFAULT behavior)
              const separator = currentDesc.includes('\n') ? '\n\n' : '. '
              const newFullDesc = `${currentDesc}${separator}${newDescPart}`
              updatedContent = updatedContent.replace(
                /📄\s*\*\*Опис:\*\*\s*(.+?)(?=\n🔴|\n🟡|\n🟢|\n⚫|\n📊|$)/s,
                `📄 **Опис:** ${newFullDesc}`
              )
              logger.info('Description successfully extended (default)')
            } else {
              // Replace description (only when explicitly requested)
              updatedContent = updatedContent.replace(
                /📄\s*\*\*Опис:\*\*\s*(.+?)(?=\n🔴|\n🟡|\n🟢|\n⚫|\n📊|$)/s,
                `📄 **Опис:** ${newDescPart}`
              )
              logger.info('Description successfully replaced (explicit)')
            }
          }
        }
      }

      /* REMOVED: Priority editing functionality - system now auto-determines priority
      // Handle priority changes (with Surzhyk support)
      if (messages.tickets.editKeywords.priority && messages.tickets.editKeywords.priority.some(keyword => lowerEdit.includes(keyword))) {
        logger.info('Detected priority change request')
        let newPriority = 'Medium'
        let priorityEmoji = '🟡'
        
        // High priority keywords (Ukrainian + Russian + Surzhyk)
        if (lowerEdit.includes('високий') || lowerEdit.includes('высокий') || lowerEdit.includes('high') || 
            lowerEdit.includes('вищий') || lowerEdit.includes('вище') || lowerEdit.includes('выше') ||
            lowerEdit.includes('підвищ') || lowerEdit.includes('повыс') || lowerEdit.includes('збільш') ||
            lowerEdit.includes('увеличь') || lowerEdit.includes('повысь')) {
          newPriority = 'High'
          priorityEmoji = '🔴'
          logger.info('Setting priority to High')
        } 
        // Low priority keywords (Ukrainian + Russian + Surzhyk)
        else if (lowerEdit.includes('низький') || lowerEdit.includes('низкий') || lowerEdit.includes('low') ||
                 lowerEdit.includes('нижч') || lowerEdit.includes('ниже') || lowerEdit.includes('зменш') ||
                 lowerEdit.includes('уменьш') || lowerEdit.includes('понизь') || lowerEdit.includes('снизь')) {
          newPriority = 'Low'  
          priorityEmoji = '🟢'
          logger.info('Setting priority to Low')
        } 
        // Critical priority keywords (Ukrainian + Russian + Surzhyk)
        else if (lowerEdit.includes('критичний') || lowerEdit.includes('критический') || lowerEdit.includes('critical') ||
                 lowerEdit.includes('терміново') || lowerEdit.includes('срочно') || lowerEdit.includes('urgent') ||
                 lowerEdit.includes('термінов') || lowerEdit.includes('срочн')) {
          newPriority = 'Critical'
          priorityEmoji = '⚫'
          logger.info('Setting priority to Critical')
        }
        
        // Replace priority line (with any emoji)
        const oldContent = updatedContent
        updatedContent = updatedContent.replace(/[🔴🟡🟢⚫]\s*\*\*Пріоритет:\*\*\s*[^\n]+/i, `${priorityEmoji} **Пріоритет:** ${newPriority}`)
        
        if (oldContent !== updatedContent) {
          logger.info(`Priority successfully changed to ${newPriority}`)
        } else {
          logger.warn('Failed to replace priority line')
        }
      }
      */

      // Log final result
      if (updatedContent === originalContent) {
        logger.info('No changes detected, adding as additional information')
        updatedContent += `\n\n🔄 **Додаткова інформація:**\n${editInstructions}`
      } else {
        logger.info('Content successfully updated')
      }

      return updatedContent

    } catch (error) {
      logger.error('Error applying ticket edits:', error)
      return originalContent + `\n\n🔄 **Додаткова інформація:**\n${editInstructions}`
    }
  }

  /**
   * Start field-by-field editing mode - shows ticket with edit buttons for each field
   */
  async startFullEditing(bot, chatId, userId, ticketId) {
    try {
      const session = sessionService.getSession(userId)

      // Get the current ticket content
      const pendingTicket = session.pendingTickets?.[ticketId]
      if (!pendingTicket) {
        await bot.sendMessage(chatId, messages.errors.ticketNotFound)
        return
      }

      if (!session.editingTicket) {
        session.editingTicket = {}
      }
      session.editingTicket.ticketId = ticketId
      session.editingTicket.mode = 'fields'
      sessionService.updateSession(userId, session)

      // Show ticket with field editing buttons
      await this.showTicketWithEditButtons(bot, chatId, userId, ticketId, pendingTicket)

    } catch (error) {
      logger.error(logMessages.tickets.editError(userId, ticketId), error)
      await bot.sendMessage(chatId, messages.errors.generalError)
    }
  }

  /**
   * Show ticket with buttons to edit individual fields
   */
  async showTicketWithEditButtons(bot, chatId, userId, ticketId, pendingTicket) {
    // Parse current ticket fields
    const fields = this.parseTicketFields(pendingTicket.content)

    // Create ticket display with current values
    const ticketDisplay = `📋 **Редагування заявки по полях**\n\n` +
      `📝 **Заголовок:** ${fields.title || 'Не вказано'}\n` +
      `📄 **Опис:** ${fields.description || 'Не вказано'}\n` +
      `${this.getPriorityEmoji(fields.priority)} **Пріоритет:** ${fields.priority || 'Medium'}\n` +
      `📊 **Категорія:** ${fields.category || 'Не вказано'}\n\n` +
      `⬇️ **Оберіть поле для редагування:**`

    // Create keyboard with edit buttons for each field
    const editFieldsKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: messages.tickets.buttons.editTitle, callback_data: `editfield_title_${ticketId}` },
            { text: messages.tickets.buttons.editDescription, callback_data: `editfield_description_${ticketId}` }
          ],
          [
            { text: messages.tickets.buttons.save, callback_data: `confirm_${ticketId}` },
            { text: messages.tickets.buttons.cancel, callback_data: `cancel_${ticketId}` }
          ]
        ]
      }
    }

    await bot.sendMessage(chatId, ticketDisplay, editFieldsKeyboard)
  }

  /**
   * Parse ticket content to extract individual fields
   */
  parseTicketFields(content) {
    const fields = {}

    // Extract title
    const titleMatch = content.match(/📝\s*\*\*Заголовок:\*\*\s*(.+?)(?=\n|$)/i)
    fields.title = titleMatch ? titleMatch[1].trim() : ''

    // Extract description  
    const descMatch = content.match(/📄\s*\*\*Опис:\*\*\s*(.+?)(?=\n[🔴🟡🟢⚫]|\n📊|\n👤|$)/s)
    fields.description = descMatch ? descMatch[1].trim() : ''

    // Extract priority
    const priorityMatch = content.match(/[🔴🟡🟢⚫]\s*\*\*Пріоритет:\*\*\s*(.+?)(?=\n|$)/i)
    fields.priority = priorityMatch ? priorityMatch[1].trim() : 'Medium'

    // Extract category
    const categoryMatch = content.match(/📂\s*\*\*Категорія:\*\*\s*(.+?)(?=\n|$)/i)
    fields.category = categoryMatch ? categoryMatch[1].trim() : ''

    return fields
  }

  /**
   * Get priority emoji based on priority level
   */
  getPriorityEmoji(priority) {
    if (!priority) return '🟡'
    const p = priority.toLowerCase()
    if (p.includes('high') || p.includes('високий') || p.includes('высокий')) return '🔴'
    if (p.includes('low') || p.includes('низький') || p.includes('низкий')) return '🟢'
    if (p.includes('critical') || p.includes('критичний') || p.includes('критический')) return '⚫'
    return '🟡'
  }

  /**
   * Start editing a specific field
   */
  async startFieldEditing(bot, chatId, userId, ticketId, fieldName) {
    try {
      // Block editing of priority and category - system determines these automatically
      if (fieldName === 'priority' || fieldName === 'category') {
        await bot.sendMessage(chatId, '⚠️ **Це поле не редагується**\n\nПріоритет та категорія визначаються системою автоматично на основі змісту заявки.', { parse_mode: 'Markdown' })
        return
      }

      const session = sessionService.getSession(userId)

      if (!session.editingTicket) {
        session.editingTicket = {}
      }
      session.editingTicket.ticketId = ticketId
      session.editingTicket.mode = `field_${fieldName}`
      session.editingTicket.fieldName = fieldName
      sessionService.updateSession(userId, session)

      // Show appropriate input prompt based on field type
      const instruction = messages.tickets.fieldEditInstructions[fieldName]
      if (instruction) {
        await bot.sendMessage(chatId, instruction, { parse_mode: 'Markdown' })
      } else {
        await bot.sendMessage(chatId, `✏️ Введіть нове значення для поля "${fieldName}":`)
      }

    } catch (error) {
      logger.error(`Error starting field editing for ${fieldName}:`, error)
      await bot.sendMessage(chatId, messages.errors.generalError)
    }
  }

  /**
   * Set the value of a specific field and return to field editing view
   */
  async setFieldValue(bot, chatId, userId, ticketId, fieldName, newValue) {
    try {
      // Block editing of priority and category
      if (fieldName === 'priority' || fieldName === 'category') {
        await bot.sendMessage(chatId, '⚠️ **Це поле не редагується**\n\nПріоритет та категорія визначаються системою автоматично.', { parse_mode: 'Markdown' })
        return
      }

      const session = sessionService.getSession(userId)
      const pendingTicket = session.pendingTickets?.[ticketId]

      if (!pendingTicket) {
        await bot.sendMessage(chatId, messages.errors.ticketNotFound)
        return
      }

      // Update the specific field in ticket content
      const updatedContent = this.updateTicketField(pendingTicket.content, fieldName, newValue)

      // Update pending ticket
      pendingTicket.content = updatedContent
      pendingTicket.lastModified = new Date().toISOString()
      session.pendingTickets[ticketId] = pendingTicket

      // Reset editing mode to field selection
      session.editingTicket.mode = 'fields'
      sessionService.updateSession(userId, session)

      // Show success message
      await bot.sendMessage(chatId, `✅ Поле "${this.getFieldDisplayName(fieldName)}" оновлено!`)

      // Return to field editing view
      await this.showTicketWithEditButtons(bot, chatId, userId, ticketId, pendingTicket)

    } catch (error) {
      logger.error(`Error setting field ${fieldName}:`, error)
      await bot.sendMessage(chatId, messages.errors.generalError)
    }
  }

  /**
   * Update a specific field in ticket content
   */
  updateTicketField(content, fieldName, newValue) {
    switch (fieldName) {
      case 'title':
        return content.replace(/📝\s*\*\*Заголовок:\*\*\s*[^\n]+/i, `📝 **Заголовок:** ${newValue}`)

      case 'description':
        return content.replace(/📄\s*\*\*Опис:\*\*\s*(.+?)(?=\n[🔴🟡🟢⚫]|\n📊|\n👤|$)/s, `📄 **Опис:** ${newValue}`)

      case 'priority':
        const emoji = this.getPriorityEmoji(newValue)
        return content.replace(/[🔴🟡🟢⚫]\s*\*\*Пріоритет:\*\*\s*[^\n]+/i, `${emoji} **Пріоритет:** ${newValue}`)

      case 'category':
        return content.replace(/📂\s*\*\*Категорія:\*\*\s*[^\n]+/i, `📂 **Категорія:** ${newValue}`)

      default:
        return content
    }
  }

  /**
   * Get display name for field
   */
  getFieldDisplayName(fieldName) {
    const names = {
      title: 'Заголовок',
      description: 'Опис',
      priority: 'Пріоритет',
      category: 'Категорія'
    }
    return names[fieldName] || fieldName
  }

  /**
   * Convert ticket content from formatted display to editable plain text
   */
  convertToEditableFormat(content) {
    logger.info(`Converting to editable format: ${content.substring(0, 100)}...`)

    const result = content
      .replace(/📝\s*\*\*Заголовок:\*\*\s*/gi, 'Заголовок: ')
      .replace(/📄\s*\*\*Опис:\*\*\s*/gi, 'Опис: ')
      .replace(/[🔴🟡🟢⚫]\s*\*\*Пріоритет:\*\*\s*/gi, 'Пріоритет: ')
      .replace(/👤\s*\*\*Користувач:\*\*\s*/gi, 'Користувач: ')
      .replace(/📊\s*\*\*Категорія:\*\*\s*/gi, 'Категорія: ')
      .replace(/💻\s*\*\*Відділ:\*\*\s*/gi, 'Відділ: ')
      .replace(/📂\s*\*\*Категорія:\*\*\s*/gi, 'Категорія: ')
      .replace(/🌐\s*\*\*Мова:\*\*\s*/gi, 'Мова: ')
      .replace(/⏰\s*\*\*Створено:\*\*\s*/gi, 'Створено: ')
      .replace(/✅\s*\*\*Статус:\*\*\s*/gi, 'Статус: ')
      .replace(/📋\s*\*\*ID:\*\*\s*/gi, 'ID: ')
      .replace(/\*\*/g, '') // Remove all bold formatting
      .replace(/━+/g, '') // Remove separators
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('🎫') && !line.startsWith('⚠️'))
      .join('\n')
      .trim()

    logger.info(`Converted result: ${result}`)
    return result
  }

  /**
   * Convert editable plain text back to formatted ticket content
   */
  convertFromEditableFormat(editableText) {
    logger.info(`Converting from editable format: ${editableText}`)

    const lines = editableText.split('\n').map(line => line.trim()).filter(line => line)
    let content = ''

    // Keep the same structure as original ticket
    for (const line of lines) {
      const lowerLine = line.toLowerCase()

      if (lowerLine.startsWith('id:')) {
        const id = line.substring(3).trim()
        content += `📋 **ID:** ${id}\n`
      } else if (lowerLine.startsWith('відділ:')) {
        const dept = line.substring('відділ:'.length).trim()
        content += `� **Відділ:** ${dept}\n`
      } else if (lowerLine.startsWith('категорія:')) {
        const category = line.substring('категорія:'.length).trim()
        content += `� **Категорія:** ${category}\n`
      } else if (lowerLine.startsWith('пріоритет:')) {
        const priority = line.substring('пріоритет:'.length).trim()
        let emoji = '🟡' // Default Medium

        if (priority.toLowerCase().includes('high') || priority.toLowerCase().includes('високий') || priority.toLowerCase().includes('высокий')) {
          emoji = '🔴'
        } else if (priority.toLowerCase().includes('low') || priority.toLowerCase().includes('низький') || priority.toLowerCase().includes('низкий')) {
          emoji = '🟢'
        } else if (priority.toLowerCase().includes('critical') || priority.toLowerCase().includes('критичний') || priority.toLowerCase().includes('критический')) {
          emoji = '⚫'
        }

        content += `${emoji} **Пріоритет:** ${priority}\n`
      } else if (lowerLine.startsWith('заголовок:')) {
        const title = line.substring('заголовок:'.length).trim()
        content += `📝 **Заголовок:** ${title}\n`
      } else if (lowerLine.startsWith('опис:')) {
        const desc = line.substring('опис:'.length).trim()
        content += `� **Опис:** ${desc}\n`
      } else if (lowerLine.startsWith('мова:')) {
        const lang = line.substring('мова:'.length).trim()
        content += `🌐 **Мова:** ${lang}\n`
      } else if (lowerLine.startsWith('створено:')) {
        const created = line.substring('створено:'.length).trim()
        content += `⏰ **Створено:** ${created}\n`
      } else if (lowerLine.startsWith('статус:')) {
        const status = line.substring('статус:'.length).trim()
        content += `✅ **Статус:** ${status}\n`
      }
    }

    logger.info(`Converted back to formatted content: ${content}`)
    return content.trim()
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
      // Note: Ticket validation is now performed earlier in localAI.processText()
      // before this function is called, so no need to validate here

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
            // [
            //   { text: messages.tickets.buttons.edit, callback_data: `edit_${ticketId}` }
            // ]
          ]
        }
      }

      // Send ticket preview with confirmation buttons
      const ticketPreview = messages.tickets.preview(ticketContent)

      const sentMessage = await bot.sendMessage(chatId, ticketPreview, {
        ...confirmationKeyboard,
        parse_mode: 'Markdown'
      })

      if (!session.messages) {
        session.messages = {}
      }

      session.messages[ticketId] = sentMessage.message_id
      sessionService.updateSession(userId, session)

      logger.info(`Message with keyboard sent. Saved message_id: ${sentMessage.message_id} for user ${userId}`)
      const updatedSession = sessionService.getSession(userId)
      logger.debug(`Retrieved session data after update for user ${userId}: ${JSON.stringify(updatedSession)}`)
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

  async sendMessageWithKeyboard(bot, chatId, userId, text, keyboard) {
    try {
      const sentMessage = await bot.sendMessage(chatId, text, {
        reply_markup: { inline_keyboard: keyboard }
      })

      // Save the message_id in the session for this specific user and message
      const session = sessionService.getSession(userId) || {}
      if (!session.messages) {
        session.messages = {}
      }

      // Ensure unique association of message_id with the text
      session.messages[text] = sentMessage.message_id
      sessionService.updateSession(userId, session)

      logger.info(`Message with keyboard sent. Saved message_id: ${sentMessage.message_id} for user ${userId}`)
    } catch (error) {
      logger.error(`Failed to send message with keyboard:`, error)
    }
  }

  async removeKeyboard(bot, callbackQuery) {
    if (!(callbackQuery && callbackQuery.message)) {
      logger.warn('Callback query or message data is missing')
      return
    }

    const chatId = callbackQuery.message.chat.id
    const userId = callbackQuery.from.id.toString()
    const session = sessionService.getSession(userId)

    // Try to extract ticketId from callback data (format: action_ticketId or editfield_...)
    let ticketId = null
    if (callbackQuery.data) {
      const parts = callbackQuery.data.split('_')
      if (parts.length >= 2) {
        ticketId = parts.slice(1).join('_')
      }
    }

    let messageId = null
    if (ticketId && session && session.messages && session.messages[ticketId]) {
      messageId = session.messages[ticketId]
    } else if (session && session.messages && callbackQuery.message.text) {
      // Fallback for messages stored by full text
      messageId = session.messages[callbackQuery.message.text]
    }

    if (messageId) {
      try {
        await bot.editMessageReplyMarkup(
          null,
          { chat_id: chatId, message_id: messageId }
        )
        logger.info(`Inline keyboard removed for message ${messageId} of user ${userId}`)

        // Clean up the saved message_id after removing the keyboard
        if (ticketId && session && session.messages && session.messages[ticketId]) {
          delete session.messages[ticketId]
        } else if (callbackQuery.message.text && session && session.messages && session.messages[callbackQuery.message.text]) {
          delete session.messages[callbackQuery.message.text]
        }
        sessionService.updateSession(userId, session)
      } catch (error) {
        logger.error(`Failed to remove inline keyboard for message ${messageId} of user ${userId}:`, error)
      }
    } else {
      logger.warn(`No message_id found for user ${userId} to remove inline keyboard. Session messages: ${JSON.stringify(session?.messages)}`)
    }

    // Confirm the callback query to avoid hanging
    try {
      await bot.answerCallbackQuery(callbackQuery.id)
    } catch (error) {
      logger.error(`Failed to answer callback query for user ${userId}:`, error)
    }
  }
}

module.exports = new MessageHandler()
