const logger = require('../utils/logger')
const logMessages = require('../../data/logMessages')

class SessionService {
  constructor() {
    // User sessions storage in memory
    // In production, it's better to use Redis or database
    this.sessions = new Map()
  }

  /**
   * Creates or gets user session
   * @param {string} userId - user ID
   * @returns {Object} - session object
   */
  getSession(userId) {
    if (!this.sessions.has(userId)) {
      this.sessions.set(userId, {
        userId,
        state: 'idle', // idle, waiting_for_answer
        currentQuestion: null,
        lastActivity: new Date(),
        conversationHistory: [],
        authenticated: false,
        userInfo: null
      })
      logger.info(logMessages.sessions.created(userId))
    }
    
    return this.sessions.get(userId)
  }

  /**
   * Updates session state
   * @param {string} userId - user ID
   * @param {Object} updates - updates object
   */
  updateSession(userId, updates) {
    const session = this.getSession(userId)
    Object.assign(session, updates, { lastActivity: new Date() })
    logger.debug(logMessages.sessions.updated(userId), updates)
  }

  /**
   * Adds message to conversation history
   * @param {string} userId - user ID
   * @param {string} type - message type (question, answer, response)
   * @param {string} content - message content
   */
  addToHistory(userId, type, content) {
    const session = this.getSession(userId)
    session.conversationHistory.push({
      type,
      content,
      timestamp: new Date()
    })
    
    // Limit history to last 50 messages
    if (session.conversationHistory.length > 50) {
      session.conversationHistory = session.conversationHistory.slice(-50)
    }
    
    logger.debug(`Added ${type} to history for user ${userId}`)
  }

  /**
   * Clears user session
   * @param {string} userId - user ID
   */
  clearSession(userId) {
    this.sessions.delete(userId)
    logger.info(`Cleared session for user ${userId}`)
  }

  /**
   * Gets active sessions statistics
   * @returns {Object} - statistics
   */
  getStats() {
    const totalSessions = this.sessions.size
    const activeSessions = Array.from(this.sessions.values())
      .filter(session => {
        const timeDiff = new Date() - session.lastActivity
        return timeDiff < 30 * 60 * 1000 // active in last 30 minutes
      }).length

    return {
      totalSessions,
      activeSessions
    }
  }

  /**
   * Cleans up inactive sessions (older than 1 hour)
   */
  cleanupInactiveSessions() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    let cleaned = 0

    for (const [userId, session] of this.sessions.entries()) {
      if (session.lastActivity < oneHourAgo) {
        this.sessions.delete(userId)
        cleaned++
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} inactive sessions`)
    }
  }

  /**
   * Saves message_id for a given message text in the session
   * @param {string} userId - user ID
   * @param {string} messageText - message text
   * @param {string} messageId - message ID
   */
  saveMessageId(userId, messageText, messageId) {
    const session = this.getSession(userId) || {}
    if (!session.messages) {
      session.messages = {}
    }
    session.messages[messageText] = messageId
    this.updateSession(userId, session)
    logger.info(`Saved message_id: ${messageId} for user ${userId}`)
  }

  /**
   * Retrieves message_id for a given message text from the session
   * @param {string} userId - user ID
   * @param {string} messageText - message text
   * @returns {string|null} - message ID or null if not found
   */
  getMessageId(userId, messageText) {
    const session = this.getSession(userId)
    if (session && session.messages) {
      return session.messages[messageText]
    }
    logger.warn(`No message_id found for user ${userId} and message: ${messageText}`)
    return null
  }
}

module.exports = new SessionService()
