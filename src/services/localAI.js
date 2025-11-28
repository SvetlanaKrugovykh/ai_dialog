const axios = require('axios')
const FormData = require('form-data')
const fs = require('fs')
const logger = require('../utils/logger')
const messages = require('../../data/messages')
const logMessages = require('../../data/logMessages')
const serviceErrors = require('../../data/serviceErrors')
const ticketParser = require('./ticketParser')
const postAiCorrections = require('../../data/postAiCorrections')
const buildQwenRequest = require('../../data/ai-requests').buildQwenRequest
require('dotenv').config()

function deduplicateSentences(text) {
  const sentences = text.split(/(?<=[.!?])\s+/)
  const seen = new Set()
  return sentences.filter(s => {
    const trimmed = s.trim()
    if (!trimmed) return false
    if (seen.has(trimmed)) return false
    seen.add(trimmed)
    return true
  }).join(' ')
}

class LocalAIService {
  constructor() {
    this.speechToTextUrl = process.env.SPEECH_TO_TEXT_URL || 'http://localhost:8338/update/'
    this.textProcessingUrl = process.env.TEXT_PROCESSING_URL || 'http://localhost:8344/process/'
    this.speechTimeout = parseInt(process.env.SPEECH_TIMEOUT) || 60000 // 60 seconds
    this.textTimeout = parseInt(process.env.TEXT_TIMEOUT) || 30000 // 30 seconds
    this.aiTimeout = parseInt(process.env.AI_TIMEOUT) || 180000 // 180 seconds
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
          transcribedText = deduplicateSentences(transcribedText)
        } catch (parseError) {
          transcribedText = response.data
          transcribedText = deduplicateSentences(transcribedText)
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
      let textResult = text
      let topicResult = ''

      if (process.env.ENABLE_LOCAL_AI === 'true') {
        const _localAiStart = Date.now()
        const prompt_ = buildQwenRequest(text)
        logger.info('DEBUG: Sending prompt_ to Local AI service:', prompt_)
        logger.info(`LOCAL_AI_URL: ${process.env.LOCAL_AI_URL}`)

        try {
          const response = await axios.post(process.env.LOCAL_AI_URL, prompt_, {
            timeout: this.aiTimeout,
            headers: {
              'Content-Type': 'application/json'
            }
          })
          const _localAiDuration = Date.now() - _localAiStart
          logger.info(`Local AI request duration for user ${clientId}: ${_localAiDuration} ms`)
          logger.info(`DEBUG: Raw response.data.response: ${response.data.response}`)

          const parsed = JSON.parse(response.data.response)
          textResult = parsed.text || text
          topicResult = parsed.topic || ''
        } catch (e) {
          const _localAiDuration = Date.now() - _localAiStart
          logger.warn(`Local AI failed for user ${clientId} after ${_localAiDuration}ms: ${e.message}`)
          textResult = text
          topicResult = ''
        }

        logger.info(`Local AI parsed results for user ${clientId}: topic="${topicResult}", text="${textResult}"`)
      }

      const corrected = postAiCorrections.processResults(textResult, topicResult, text)
      textResult = corrected.text
      topicResult = corrected.topic

      if (corrected.appliedRules.length > 0) {
        logger.info(`Post-AI corrections for user ${clientId}: ${corrected.appliedRules.join(', ')}`)
      }

      const validation = ticketParser.validateTicketContent(textResult)
      if (!validation.isValid) {
        logger.warn(`Ticket validation failed for user ${clientId}: ${validation.reason}`)
        throw new Error(`VALIDATION_FAILED: ${validation.reason}`)
      }

      const ticket = ticketParser.parseTicket(textResult, topicResult, clientId)
      const formattedTicket = ticketParser.formatTicketForDisplay(ticket)
      logger.info(logMessages.processing.ticketParsing(clientId, text))
      logger.info(logMessages.processing.textResult(clientId, formattedTicket))

      return formattedTicket
    } catch (error) {
      if (error.message && error.message.startsWith('VALIDATION_FAILED:')) {
        throw error
      }
      logger.warn(`External AI service failed, using ticket parser result: ${error.message}`)

      const ticket = ticketParser.parseTicket(text, '', clientId)
      const formattedTicket = ticketParser.formatTicketForDisplay(ticket)
      logger.info(logMessages.processing.textResult(clientId, formattedTicket))
      return formattedTicket
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

      // Always log full debug info to file
      if (process.env.DEBUG_LEVEL === 'info') {
        logger.info(`Debug - Full response for client ${clientId}: ${JSON.stringify(rawResponse, null, 2)}`)
      }

      // Send only useful message to user in Telegram
      if (process.env.DEBUG_LEVEL === 'info' && bot && chatId) {
        try {
          // Send only transcribed text to user, not the full JSON
          const userMessage = messages.processing.recognizedText(transcribedText)
          await bot.sendMessage(chatId, userMessage)
          logger.info(logMessages.debug.transcriptionSent(chatId))
        } catch (debugError) {
          logger.warn(logMessages.debug.transcriptionSendFailed, debugError)
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
          transcribedText = deduplicateSentences(transcribedText)
        } catch (parseError) {
          transcribedText = response.data
          transcribedText = deduplicateSentences(transcribedText)
        }
      } else if (response.data && typeof response.data === 'object') {
        transcribedText = response.data.translated_text ||
          response.data.text ||
          response.data.transcription ||
          response.data.result ||
          response.data.transcript ||
          JSON.stringify(response.data)
        transcribedText = deduplicateSentences(transcribedText)
      } else {
        transcribedText = String(response.data)
        transcribedText = deduplicateSentences(transcribedText)
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
