const axios = require('axios')
const FormData = require('form-data')
const fs = require('fs')
const logger = require('../utils/logger')
require('dotenv').config()

class LocalAIService {
  constructor() {
    this.speechToTextUrl = process.env.SPEECH_TO_TEXT_URL || 'http://localhost:8338/update/'
    this.textProcessingUrl = process.env.TEXT_PROCESSING_URL || 'http://localhost:8339/process/'
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
      logger.info(`Converting speech to text for client ${clientId}, segment ${segmentNumber}`)

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

      const transcribedText = response.data.text || response.data.transcription || response.data
      logger.info(`Speech-to-text result for client ${clientId}: ${transcribedText}`)

      return transcribedText
    } catch (error) {
      logger.error('Speech-to-text service error:', error)
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Speech-to-text service is not available. Please try again later.')
      }
      if (error.code === 'ETIMEDOUT') {
        throw new Error('Speech-to-text service timeout. Please try with a shorter voice message.')
      }
      throw new Error('Failed to convert speech to text. Please try again.')
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
      logger.info(`Processing text for client ${clientId}: ${text}`)

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

      const processedResult = response.data.result || response.data.processed_text || response.data
      logger.info(`Text processing result for client ${clientId}: ${processedResult}`)

      return processedResult
    } catch (error) {
      logger.error('Text processing service error:', error)
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Text processing service is not available. Please try again later.')
      }
      if (error.code === 'ETIMEDOUT') {
        throw new Error('Text processing service timeout. Please try again.')
      }
      throw new Error('Failed to process text. Please try again.')
    }
  }

  /**
   * Full pipeline: voice to text to processed result
   * @param {string} voiceFilePath - path to voice file
   * @param {string} clientId - telegram user id
   * @param {number} segmentNumber - message number in dialog
   * @returns {Promise<string>} - final processed result
   */
  async processVoiceMessage(voiceFilePath, clientId, segmentNumber) {
    try {
      // Step 1: Convert voice to text
      const transcribedText = await this.speechToText(voiceFilePath, clientId, segmentNumber)
      
      // Step 2: Process the text
      const processedResult = await this.processText(transcribedText, clientId)
      
      return processedResult
    } catch (error) {
      logger.error('Voice processing pipeline error:', error)
      throw error
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
      logger.error('Text message processing error:', error)
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
      logger.warn('Speech-to-text service health check failed')
    }

    try {
      await axios.get(this.textProcessingUrl.replace('/process/', '/health'), { timeout: 5000 })
      status.textProcessing = true
    } catch (error) {
      logger.warn('Text processing service health check failed')
    }

    return status
  }
}

module.exports = new LocalAIService()
