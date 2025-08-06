const localAIService = require('../services/localAI')
const chatGPTService = require('../services/chatgpt')
const sessionService = require('../services/session')
const authService = require('../services/auth')
const logger = require('../utils/logger')
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
      
      logger.info(`Received message from user ${userId}, type: ${msg.voice ? 'voice' : 'text'}`)

      // Check user authentication first
      const authResult = await authService.authorizeUser(userId)
      
      if (!authResult.allowed) {
        await bot.sendMessage(chatId, authResult.message)
        logger.warn(`Access denied for user ${userId}`)
        return
      }
      
      // Send welcome/warning message for first interaction
      const session = sessionService.getSession(userId)
      if (!session.authenticated) {
        await bot.sendMessage(chatId, authResult.message)
        session.authenticated = true
        if (authResult.user) {
          session.userInfo = authResult.user
        }
        sessionService.updateSession(userId, session)
      }

      // Check if message is a command
      if (msg.text && msg.text.startsWith('/')) {
        await this.handleCommand(bot, msg)
        return
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
      await bot.sendMessage(chatId, 'Please send a text or voice message.')

    } catch (error) {
      logger.error('Error handling message:', error)
      await bot.sendMessage(msg.chat.id, 'An error occurred while processing the message. Please try again.')
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
      await bot.sendMessage(msg.chat.id, 'Unknown command. Use /help to get a list of commands.')
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
      logger.warn(`Access denied for user ${userId} on /start command`)
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
    
    // Send auth message first
    await bot.sendMessage(chatId, authResult.message)
    
    const welcomeMessage = `
🤖 AI Dialog Bot готовий до роботи!

Цей бот обробляє голосові та текстові повідомлення за допомогою локальних AI сервісів.

Як це працює:
• Надішліть голосове повідомлення або текст
• Локальний AI розпізнає та обробить його
• Отримаєте інтелектуальну відповідь
• Якщо локальний AI не може впоратися, ChatGPT допоможе

Команди:
/help - показати допомогу
/clear - очистити історію
/stats - показати статистику
/health - перевірити статус AI сервісів

Надішліть своє перше повідомлення! 🎤📝
    `

    await bot.sendMessage(chatId, welcomeMessage)
    logger.info(`User ${userId} started the bot`)
  }

  /**
   * Handle /help command
   */
  async handleHelp(bot, msg) {
    const chatId = msg.chat.id
    const userId = msg.from.id.toString()
    const session = sessionService.getSession(userId)
    
    let userInfo = ''
    if (session.userInfo) {
      userInfo = `� Авторизовано: ${session.userInfo.firstname} ${session.userInfo.lastname}\n📧 Email: ${session.userInfo.email}\n\n`
    }
    
    const helpMessage = `
${userInfo}📋 Доступні команди:

/start - почати спочатку
/help - показати цю допомогу
/clear - очистити історію розмови
/stats - показати статистику бота
/health - перевірити статус AI сервісів

💡 Як користуватися:
1. Надішліть голосове повідомлення (рекомендовано) або текст
2. Локальний AI обробить ваше повідомлення
3. Отримаєте інтелектуальну відповідь
4. Продовжуйте розмову!

🎤 Голосові повідомлення автоматично розпізнаються та обробляються
📝 Текстові повідомлення обробляються безпосередньо

� Режим роботи: ${authService.getMode() === 'debug' ? 'НАЛАГОДЖЕННЯ' : 'РОБОЧИЙ'}
    `

    await bot.sendMessage(chatId, helpMessage)
  }

  /**
   * Handle /health command
   */
  async handleHealth(bot, msg) {
    try {
      const servicesStatus = await localAIService.checkServicesHealth()
      
      const statusMessage = `
🔧 AI Services Status:

🎤 Speech-to-Text: ${servicesStatus.speechToText ? '✅ Online' : '❌ Offline'}
🧠 Text Processing: ${servicesStatus.textProcessing ? '✅ Online' : '❌ Offline'}
🤖 ChatGPT Fallback: ${process.env.OPENAI_API_KEY ? '✅ Available' : '❌ Not configured'}

${!servicesStatus.speechToText || !servicesStatus.textProcessing ? 
  '\n⚠️ Some local services are offline. ChatGPT fallback may be used.' : 
  '\n✅ All local services are running normally!'}
      `

      await bot.sendMessage(msg.chat.id, statusMessage)
    } catch (error) {
      logger.error('Error checking services health:', error)
      await bot.sendMessage(msg.chat.id, 'Error checking services status.')
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
      await bot.sendMessage(chatId, '🎤 Processing voice message...')

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
        // Process voice through local AI
        const result = await localAIService.processVoiceMessage(tempFilePath, userId, segmentNumber, bot, chatId)
        
        // Save to history
        sessionService.addToHistory(userId, 'voice_message', `[Voice message #${segmentNumber}]`)
        sessionService.addToHistory(userId, 'ai_response', result)

        // Send result to user
        await bot.sendMessage(chatId, `🧠 AI Response:\n\n${result}`)

      } catch (localError) {
        logger.warn(`Local AI failed for user ${userId}, trying ChatGPT fallback:`, localError)
        
        // Fallback to ChatGPT if local services fail
        await this.fallbackToChatGPT(bot, msg, '[Voice message - transcription failed]', localError.message)
      }

      // Clean up temp file
      fs.unlink(tempFilePath, (err) => {
        if (err) logger.warn('Failed to delete temp file:', err)
      })

    } catch (error) {
      logger.error(`Error processing voice message from user ${userId}:`, error)
      await bot.sendMessage(chatId, 'Sorry, I couldn\'t process your voice message. Please try again or send a text message.')
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
        // Process text through local AI
        const result = await localAIService.processTextMessage(messageText, userId)
        
        // Save to history
        sessionService.addToHistory(userId, 'text_message', messageText)
        sessionService.addToHistory(userId, 'ai_response', result)

        // Send result to user
        await bot.sendMessage(chatId, `🧠 AI Response:\n\n${result}`)

      } catch (localError) {
        logger.warn(`Local AI failed for user ${userId}, trying ChatGPT fallback:`, localError)
        
        // Fallback to ChatGPT if local services fail
        await this.fallbackToChatGPT(bot, msg, messageText, localError.message)
      }

    } catch (error) {
      logger.error(`Error processing text message from user ${userId}:`, error)
      await bot.sendMessage(chatId, 'Sorry, I couldn\'t process your message. Please try again.')
    }
  }

  /**
   * Fallback to ChatGPT when local services fail
   */
  async fallbackToChatGPT(bot, msg, originalMessage, localError) {
    const chatId = msg.chat.id
    const userId = msg.from.id.toString()

    try {
      await bot.sendMessage(chatId, `⚠️ Local AI services are unavailable (${localError}). Using ChatGPT fallback...`)
      
      // Use ChatGPT as fallback
      const gptResponse = await chatGPTService.processQuestion(originalMessage, userId)
      
      // Save to history
      sessionService.addToHistory(userId, 'chatgpt_fallback', gptResponse)
      
      await bot.sendMessage(chatId, `🤖 ChatGPT Response:\n\n${gptResponse}`)

    } catch (gptError) {
      logger.error(`ChatGPT fallback also failed for user ${userId}:`, gptError)
      await bot.sendMessage(chatId, 'Sorry, both local AI and ChatGPT services are currently unavailable. Please try again later.')
    }
  }

  /**
   * Handle /clear command
   */
  async handleClear(bot, msg) {
    const userId = msg.from.id.toString()
    sessionService.clearSession(userId)
    await bot.sendMessage(msg.chat.id, '✅ Conversation history cleared. You can ask a new question!')
  }

  /**
   * Handle /stats command
   */
  async handleStats(bot, msg) {
    const stats = sessionService.getStats()
    const statsMessage = `
📊 Bot statistics:

👥 Total sessions: ${stats.totalSessions}
🟢 Active sessions: ${stats.activeSessions}
🕐 Uptime: ${this.getUptime()}
    `

    await bot.sendMessage(msg.chat.id, statsMessage)
  }

  /**
   * Handle user question
   */
  async handleUserQuestion(bot, msg) {
    const chatId = msg.chat.id
    const userId = msg.from.id.toString()
    const question = msg.text

    // Show typing indicator
    await bot.sendChatAction(chatId, 'typing')

    try {

      const gptResponse = await chatGPTService.processQuestion(question, userId)

      sessionService.updateSession(userId, {
        state: 'waiting_for_answer',
        currentQuestion: question
      })

      sessionService.addToHistory(userId, 'question', question)
      sessionService.addToHistory(userId, 'gpt_response', gptResponse)

      // Send response with suggestion to give own answer
      const responseMessage = `
❓ **Your question:** ${question}

🤖 **ChatGPT answer:**
${gptResponse}

💭 **Want to give your answer to this question?**
Just write your answer and I'll analyze and supplement it!

Or ask a new question.
      `

      await bot.sendMessage(chatId, responseMessage, { parse_mode: 'Markdown' })

    } catch (error) {
      logger.error(`Error processing question from user ${userId}:`, error)
      await bot.sendMessage(chatId, 'Sorry, an error occurred while processing your question. Please try again.')
    }
  }

  /**
   * Handle user answer
   */
  async handleUserAnswer(bot, msg) {
    const chatId = msg.chat.id
    const userId = msg.from.id.toString()
    const userAnswer = msg.text
    const session = sessionService.getSession(userId)

    // Show typing indicator
    await bot.sendChatAction(chatId, 'typing')

    try {
      // Get answer analysis from ChatGPT
      const enhancedResponse = await chatGPTService.enhanceAnswer(
        userAnswer,
        session.currentQuestion,
        userId
      )

      // Save to history
      sessionService.addToHistory(userId, 'user_answer', userAnswer)
      sessionService.addToHistory(userId, 'enhanced_response', enhancedResponse)

      // Reset session state
      sessionService.updateSession(userId, {
        state: 'idle',
        currentQuestion: null
      })

      // Send analysis
      const analysisMessage = `
✍️ **Your answer:** ${userAnswer}

🔍 **Analysis and supplements:**
${enhancedResponse}

Ask the next question or continue the dialogue! 💬
      `

      await bot.sendMessage(chatId, analysisMessage, { parse_mode: 'Markdown' })

    } catch (error) {
      logger.error(`Error enhancing answer from user ${userId}:`, error)
      await bot.sendMessage(chatId, 'Sorry, an error occurred while analyzing your answer. Please try again.')
    }
  }

  getUptime() {
    const uptime = process.uptime()
    const hours = Math.floor(uptime / 3600)
    const minutes = Math.floor((uptime % 3600) / 60)
    return `${hours}h ${minutes}m`
  }
}

module.exports = new MessageHandler()
