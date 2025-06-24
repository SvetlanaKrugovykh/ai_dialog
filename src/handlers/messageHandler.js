const chatGPTService = require('../services/chatgpt')
const sessionService = require('../services/session')
const logger = require('../utils/logger')

class MessageHandler {
  constructor() {
    this.commands = {
      '/start': this.handleStart.bind(this),
      '/help': this.handleHelp.bind(this),
      '/clear': this.handleClear.bind(this),
      '/stats': this.handleStats.bind(this)
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
      const messageText = msg.text

      logger.info(`Received message from user ${userId}: ${messageText}`)

      // Check if message is a command
      if (messageText.startsWith('/')) {
        await this.handleCommand(bot, msg)
        return
      }

      const session = sessionService.getSession(userId)

      // If user is waiting for answer
      if (session.state === 'waiting_for_answer') {
        await this.handleUserAnswer(bot, msg)
      } else {
        // Process as new question
        await this.handleUserQuestion(bot, msg)
      }

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
    
    sessionService.clearSession(userId)
    
    const welcomeMessage = `
🤖 Welcome to AI Dialog Bot!

This bot will help you in Q&A mode using ChatGPT.

How it works:
• Ask me any question
• Get an answer from ChatGPT
• Optionally, give your own answer to the same question
• I will analyze and supplement your answer

Commands:
/help - show help
/clear - clear history
/stats - show statistics

Ask your first question! 🚀
    `

    await bot.sendMessage(chatId, welcomeMessage)
    logger.info(`User ${userId} started the bot`)
  }

  /**
   * Handle /help command
   */
  async handleHelp(bot, msg) {
    const helpMessage = `
📋 Available commands:

/start - start over
/help - show this help
/clear - clear conversation history
/stats - show bot statistics

💡 How to use:
1. Ask a question
2. Get an answer from ChatGPT
3. Optional: give your answer to the same question
4. Get analysis and supplements to your answer

Just write your question and I'll answer! 🤗
    `

    await bot.sendMessage(msg.chat.id, helpMessage)
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
      // Get answer from ChatGPT
      const gptResponse = await chatGPTService.processQuestion(question, userId)
      
      // Save to session and history
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

  /**
   * Get bot uptime
   */
  getUptime() {
    const uptime = process.uptime()
    const hours = Math.floor(uptime / 3600)
    const minutes = Math.floor((uptime % 3600) / 60)
    return `${hours}h ${minutes}m`
  }
}

module.exports = new MessageHandler()
