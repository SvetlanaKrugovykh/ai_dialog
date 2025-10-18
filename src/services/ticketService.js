const axios = require('axios')
const https = require('https')
const logger = require('../utils/logger')
const messages = require('../../data/messages')
const logMessages = require('../../data/logMessages')
require('dotenv').config()

class TicketService {
  constructor() {
    this.createTicketEndpoint = process.env.ZAMMAD_API_TICKETS_URL || 'https://127.0.0.1:8001/api'
    this.mode = process.env.MODE || 'debug'
    this.timeout = 15000 // 15 seconds timeout for ticket creation
  }

  /**
   * Create ticket in Zammad Service Desk
   * @param {Object} ticketData - ticket information
   * @param {string} ticketData.content - full formatted ticket content
   * @param {string} ticketData.telegramId - telegram user id
   * @param {Object} ticketData.userInfo - user information from auth
   * @returns {Promise<Object>} - creation result
   */
  async createTicket(ticketData) {
    try {
      const { content, telegramId, userInfo } = ticketData

      // Parse ticket content to extract fields
      const parsedFields = this.parseTicketContent(content)

      logger.info(`Creating ticket for user ${telegramId}: ${parsedFields.title}`)

      // Prepare request body
      const requestBody = {
        title: parsedFields.title || messages.tickets.defaultTitle,
        body: this.formatTicketBody(content, parsedFields),
        customer_id: parseInt(telegramId),
        group_id: this.getGroupId(parsedFields.department),
        priority_id: this.getPriorityId(parsedFields.priority),
        state_id: 1, // Open state
        // Additional fields
        telegram_id: telegramId,
        source: 'telegram_bot',
        original_content: content,
        created_via: 'AI Dialog Bot'
      }

      if (this.mode === 'debug') {
        logger.info('DEBUG MODE: Would create ticket with data:', JSON.stringify(requestBody, null, 2))
        return {
          success: true,
          ticketId: `DEBUG-${Date.now()}`,
          ticketUrl: 'https://debug.mode/ticket/123',
          message: messages.tickets.debugModeCreated
        }
      }

      const response = await axios.post(this.createTicketEndpoint, requestBody, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: this.timeout,
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        })
      })

      const result = response.data

      if (result.success && result?.ticket?.id) {
        // Check for special status responses
        if (result.ticket.id === 'already_registered') {
          logger.info(`Duplicate ticket detected for user ${telegramId}`)
          return {
            success: true,
            isDuplicate: true,
            ticketId: result.ticket.existing_id || 'unknown',
            message: messages.tickets.alreadyRegistered
          }
        }

        if (result.ticket.id === 'insufficient_info') {
          logger.info(`Insufficient information in ticket for user ${telegramId}`)
          return {
            success: false,
            isInsufficientInfo: true,
            message: messages.tickets.insufficientInfo
          }
        }

        // Normal case - numeric ID
        if (typeof result.ticket.id === 'number' || /^\d+$/.test(result.ticket.id)) {
          logger.info(`Ticket created successfully: ID ${result.ticket.id} for user ${telegramId}`)
          return {
            success: true,
            ticketId: result.ticket.id,
            // ticketUrl: result.ticket.url || `${this.createTicketEndpoint}/#ticket/zoom/${result.ticket.id}`,
            message: messages.tickets.created(result.ticket.id, result.ticket.url)
          }
        }

        // Unknown status
        logger.warn(`Unknown ticket status: ${result.ticket.id} for user ${telegramId}`)
        throw new Error(`Unknown response status: ${result.ticket.id}`)

      } else {
        throw new Error('Invalid response format from ticket creation API')
      }

    } catch (error) {
      // Log concise error: prefer HTTP status, then error code, then message
      const shortErr = error?.response?.status || error?.code || error?.message || 'unknown_error'
      logger.error(`Ticket creation error: ${shortErr}`)

      if (this.mode === 'debug') {
        logger.warn('DEBUG MODE: Ticket creation failed, but continuing...')
        return {
          success: false,
          error: error.message,
          message: messages.tickets.debugModeError(error.message)
        }
      } else {
        return {
          success: false,
          error: error.message,
          message: messages.tickets.creationError
        }
      }
    }
  }

  /**
   * Parse ticket content to extract individual fields
   * @param {string} content - formatted ticket content
   * @returns {Object} - parsed fields
   */
  parseTicketContent(content) {
    const fields = {}

    // Extract title
    const titleMatch = content.match(/📝\s*\*\*Заголовок:\*\*\s*(.+?)(?=\n|$)/i)
    fields.title = titleMatch ? titleMatch[1].trim() : ''

    // Extract description
    const descMatch = content.match(/📄\s*\*\*Опис:\*\*\s*(.+?)(?=\n[🔴🟡🟢⚫🌐⏰✅]|\n📊|\n👤|$)/s)
    fields.description = descMatch ? descMatch[1].trim() : ''

    // Extract priority
    const priorityMatch = content.match(/[🔴🟡🟢⚫]\s*\*\*Пріоритет:\*\*\s*(.+?)(?=\n|$)/i)
    fields.priority = priorityMatch ? priorityMatch[1].trim() : 'Medium'

    // Extract department
    const deptMatch = content.match(/💻\s*\*\*Відділ:\*\*\s*(.+?)(?=\n|$)/i)
    fields.department = deptMatch ? deptMatch[1].trim() : 'IT'

    // Extract category
    const categoryMatch = content.match(/📂\s*\*\*Категорія:\*\*\s*(.+?)(?=\n|$)/i)
    fields.category = categoryMatch ? categoryMatch[1].trim() : 'Request'

    // Extract language
    const langMatch = content.match(/🌐\s*\*\*Мова:\*\*\s*(.+?)(?=\n|$)/i)
    fields.language = langMatch ? langMatch[1].trim() : 'Mixed'

    return fields
  }

  /**
   * Format ticket body with all information including emojis
   * @param {string} originalContent - full formatted content
   * @param {Object} parsedFields - parsed individual fields  
   * @returns {string} - formatted body for Zammad
   */
  formatTicketBody(originalContent, parsedFields) {
    // Minimal structured body to send to Service Desk (avoid duplicating full preview)
    let body = ''
    body += '📋 СТРУКТУРОВАНА ІНФОРМАЦІЯ:\n\n'
    body += `📝 Заголовок: ${parsedFields.title}\n`
    body += `📄 Опис: ${parsedFields.description}\n`
    body += `💼 Відділ: ${parsedFields.department}\n`
    body += `🤖 Створено через: AI Dialog Bot\n`

    return body
  }

  /**
   * Map department to Zammad group ID
   * @param {string} department - department name
   * @returns {number} - group ID
   */
  getGroupId(department) {
    const groupMapping = {
      'IT': 1,
      'HR': 2,
      'Finance': 3,
      'Support': 4
    }
    return groupMapping[department] || 1 // Default to IT
  }

  /**
   * Map priority to Zammad priority ID
   * @param {string} priority - priority level
   * @returns {number} - priority ID
   */
  getPriorityId(priority) {
    const priorityMapping = {
      'Low': 1,
      'Medium': 2,
      'High': 3,
      'Critical': 4
    }

    const p = priority?.toLowerCase() || 'medium'
    if (p.includes('low') || p.includes('низький') || p.includes('низкий')) return 1
    if (p.includes('high') || p.includes('високий') || p.includes('высокий')) return 3
    if (p.includes('critical') || p.includes('критичний') || p.includes('критический')) return 4
    return 2 // Default to Medium
  }

  /**
   * Get current mode
   * @returns {string} - current mode (debug/production)
   */
  getMode() {
    return this.mode
  }
}

module.exports = new TicketService()
