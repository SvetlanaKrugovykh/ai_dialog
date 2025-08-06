const axios = require('axios')
const FormData = require('form-data')
const fs = require('fs')
const logger = require('../utils/logger')
const messages = require('../../data/messages')
const logMessages = require('../../data/logMessages')
const serviceErrors = require('../../data/serviceErrors')
const ticketParser = require('./ticketParser')
require('dotenv').config()

class LocalAIService {
  constructor() {
    this.speechToTextUrl = process.env.SPEECH_TO_TEXT_URL || 'http://localhost:8338/update/'
    this.textProcessingUrl = process.env.TEXT_PROCESSING_URL || 'http://localhost:8344/process/'
    this.speechTimeout = parseInt(process.env.SPEECH_TIMEOUT) || 60000 // 60 seconds
    this.textTimeout = parseInt(process.env.TEXT_TIMEOUT) || 30000 // 30 seconds
  }

  /**
   * Converts voice message to text using local speech-to-text service
   * @param {string} voiceFilePath - path to voice file
   * @param {string} clientId - telegram user id
   * @param {number} segmentNumber - message number in dialog
   * @returns {Promise<string>} - transcribed text
   */
  async speechToText(voiceFilePath, clientId, segmentNumber) {
    try {
      logger.info(logMessages.processing.speechToText(clientId, segmentNumber))

      const formData = new FormData()
      formData.append('clientId', clientId)
      formData.append('segment_number', segmentNumber.toString())
      formData.append('file', fs.createReadStream(voiceFilePath))

      const response = await axios.post(this.speechToTextUrl, formData, {
        headers: {
          ...formData.getHeaders(),
        },
        timeout: this.speechTimeout,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      })

      // Handle different response formats
      let transcribedText
      if (typeof response.data === 'string') {
        // Try to parse JSON string first
        try {
          const parsedData = JSON.parse(response.data)
          transcribedText = parsedData.translated_text ||
            parsedData.text ||
            parsedData.transcription ||
            parsedData.result ||
            parsedData.transcript ||
            response.data
        } catch (parseError) {
          transcribedText = response.data
        }
      } else if (response.data && typeof response.data === 'object') {
        transcribedText = response.data.translated_text ||
          response.data.text ||
          response.data.transcription ||
          response.data.result ||
          response.data.transcript ||
          JSON.stringify(response.data)
      } else {
        transcribedText = String(response.data)
      }

      logger.info(logMessages.processing.speechResult(clientId, transcribedText))

      return transcribedText
    } catch (error) {
      if (process.env.DEBUG_LEVEL !== 'info') {
        logger.error(logMessages.services.speechToTextError, error)
      }
      if (error.code === 'ECONNREFUSED') {
        throw new Error(serviceErrors.speech.unavailable)
      }
      if (error.code === 'ETIMEDOUT') {
        throw new Error(serviceErrors.speech.timeout)
      }
      throw new Error(serviceErrors.speech.failed)
    }
  }

  /**
   * Processes text using local AI model (parsing, translation, etc.)
   * @param {string} text - text to process
   * @param {string} clientId - telegram user id
   * @returns {Promise<string>} - processed text result
   */
  async processText(text, clientId) {
    try {
      logger.info(logMessages.processing.textProcessing(clientId, text))

      // In DEBUG mode, use only local parsing without external AI services
      if (process.env.MODE === 'debug') {
        console.log('DEBUG: Using local ticket parser only')
        const ticket = ticketParser.parseTicket(text, clientId)
        const formattedTicket = ticketParser.formatTicketForDisplay(ticket)
        logger.info(logMessages.processing.textResult(clientId, formattedTicket))
        return formattedTicket
      }

      // In production mode, use external AI service
      const response = await axios.post(this.textProcessingUrl, {
        text: text,
        clientId: clientId,
        timestamp: new Date().toISOString()
      }, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: this.textTimeout
      })

      // Handle ticket-based response format
      let processedResult
      if (response.data && typeof response.data === 'object') {
        if (response.data.ticket_id) {
          // Format ticket information as readable text
          processedResult = messages.ticket.created(response.data)
        } else {
          // Fallback for other object formats
          processedResult = response.data.result || 
            response.data.processed_text || 
            response.data.text ||
            JSON.stringify(response.data, null, 2)
        }
      } else {
        processedResult = response.data
      }
      
      logger.info(logMessages.processing.textResult(clientId, processedResult))

      return processedResult
    } catch (error) {
      if (process.env.DEBUG_LEVEL !== 'info') {
        logger.error(logMessages.services.textProcessingError, error)
      }
      if (error.code === 'ECONNREFUSED') {
        throw new Error(serviceErrors.textProcessing.unavailable)
      }
      if (error.code === 'ETIMEDOUT') {
        throw new Error(serviceErrors.textProcessing.timeout)
      }
      throw new Error(serviceErrors.textProcessing.failed)
    }
  }

  /**
   * Full pipeline: voice to text to processed result
   * @param {string} voiceFilePath - path to voice file
   * @param {string} clientId - telegram user id
   * @param {number} segmentNumber - message number in dialog
   * @param {Object} bot - telegram bot instance (optional, for debug)
   * @param {string} chatId - telegram chat id (optional, for debug)
   * @returns {Promise<string>} - final processed result
   */
  async processVoiceMessage(voiceFilePath, clientId, segmentNumber, bot = null, chatId = null) {
    try {
      console.log('DEBUG: processVoiceMessage called for client:', clientId)
      // Step 1: Convert voice to text
      const { transcribedText, rawResponse } = await this.speechToTextWithDebug(voiceFilePath, clientId, segmentNumber)

      if (process.env.DEBUG_LEVEL === 'info' && bot && chatId) {
        try {
          await bot.sendMessage(chatId, messages.processing.debugTranscription(rawResponse, transcribedText), { parse_mode: 'Markdown' })
          logger.info(logMessages.debug.transcriptionSent(chatId))
        } catch (debugError) {
          logger.warn(logMessages.debug.transcriptionSendFailed, debugError)
          // Fallback without markdown if parsing fails
          try {
            await bot.sendMessage(chatId, messages.processing.debugTranscriptionFallback(transcribedText))
          } catch (fallbackError) {
            logger.error(logMessages.debug.fallbackSendFailed, fallbackError)
          }
        }
      }

      // Step 2: Process the text
      const processedResult = await this.processText(transcribedText, clientId)

      return processedResult
    } catch (error) {
      logger.error(logMessages.services.voiceProcessingPipelineError, error)
      throw error
    }
  }

  /**
   * Helper method for speech to text with debug info
   */
  async speechToTextWithDebug(voiceFilePath, clientId, segmentNumber) {
    try {
      console.log('DEBUG: speechToTextWithDebug called for client:', clientId)
      logger.info(logMessages.processing.speechToText(clientId, segmentNumber))

      const formData = new FormData()
      formData.append('clientId', clientId)
      formData.append('segment_number', segmentNumber.toString())
      formData.append('file', fs.createReadStream(voiceFilePath))

      const response = await axios.post(this.speechToTextUrl, formData, {
        headers: {
          ...formData.getHeaders(),
        },
        timeout: this.speechTimeout,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      })

      // Handle different response formats
      let transcribedText
      if (typeof response.data === 'string') {
        // Try to parse JSON string first
        try {
          const parsedData = JSON.parse(response.data)
          transcribedText = parsedData.translated_text ||
            parsedData.text ||
            parsedData.transcription ||
            parsedData.result ||
            parsedData.transcript ||
            response.data
        } catch (parseError) {
          transcribedText = response.data
        }
      } else if (response.data && typeof response.data === 'object') {
        transcribedText = response.data.translated_text ||
          response.data.text ||
          response.data.transcription ||
          response.data.result ||
          response.data.transcript ||
          JSON.stringify(response.data)
      } else {
        transcribedText = String(response.data)
      }

      logger.info(logMessages.processing.speechResult(clientId, transcribedText))

      return { transcribedText, rawResponse: response.data }
    } catch (error) {
      if (process.env.DEBUG_LEVEL !== 'info') {
        logger.error(logMessages.services.speechToTextError, error)
      }
      if (error.code === 'ECONNREFUSED') {
        throw new Error(serviceErrors.speech.unavailable)
      }
      if (error.code === 'ETIMEDOUT') {
        throw new Error(serviceErrors.speech.timeout)
      }
      throw new Error(serviceErrors.speech.failed)
    }
  }

  /**
   * Process text message directly (skip speech-to-text)
   * @param {string} text - text message
   * @param {string} clientId - telegram user id
   * @returns {Promise<string>} - processed result
   */
  async processTextMessage(text, clientId) {
    try {
      return await this.processText(text, clientId)
    } catch (error) {
      if (process.env.DEBUG_LEVEL !== 'info') {
        logger.error(logMessages.services.textMessageProcessingError, error)
      }
      throw error
    }
  }

  /**
   * Check if local services are available
   * @returns {Promise<Object>} - services status
   */
  async checkServicesHealth() {
    const status = {
      speechToText: false,
      textProcessing: false
    }

    try {
      await axios.get(this.speechToTextUrl.replace('/update/', '/health'), { timeout: 5000 })
      status.speechToText = true
    } catch (error) {
      logger.warn(serviceErrors.health.speechToTextFailed)
    }

    try {
      await axios.get(this.textProcessingUrl.replace('/process/', '/health'), { timeout: 5000 })
      status.textProcessing = true
    } catch (error) {
      logger.warn(serviceErrors.health.textProcessingFailed)
    }

    return status
  }
}

module.exports = new LocalAIService()
