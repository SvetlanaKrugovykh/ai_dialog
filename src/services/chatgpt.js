const OpenAI = require('openai')
const logger = require('../utils/logger')
require('dotenv').config()

class ChatGPTService {
  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
    
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not found in environment variables')
    }
  }

  /**
   * Processes user question through ChatGPT
   * @param {string} userMessage - user's message
   * @param {string} userId - user ID for context
   * @returns {Promise<string>} - ChatGPT response
   */
  async processQuestion(userMessage, userId) {
    try {
      logger.info(`Processing question from user ${userId}: ${userMessage}`)

      const completion = await this.client.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant. Answer concisely and to the point. If the question is unclear, ask for clarification.'
          },
          {
            role: 'user',
            content: userMessage
          }
        ],
        max_tokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 1000,
        temperature: parseFloat(process.env.OPENAI_TEMPERATURE) || 0.7,
      })

      const response = completion.choices[0].message.content.trim()
      logger.info(`ChatGPT response for user ${userId}: ${response}`)
      
      return response
    } catch (error) {
      logger.error('ChatGPT API error:', error)
      throw new Error('Sorry, an error occurred while processing your question. Please try again.')
    }
  }

  /**
   * Checks and enhances user's answer through ChatGPT
   * @param {string} userAnswer - user's answer
   * @param {string} originalQuestion - original question
   * @param {string} userId - user ID
   * @returns {Promise<string>} - enhanced/checked answer
   */
  async enhanceAnswer(userAnswer, originalQuestion, userId) {
    try {
      logger.info(`Enhancing answer from user ${userId}: ${userAnswer}`)

      const completion = await this.client.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'Analyze the user\'s answer to the question. If the answer is correct and complete, confirm it. If incomplete or inaccurate, supplement it or correct it. Be constructive and polite.'
          },
          {
            role: 'user',
            content: `Question: ${originalQuestion}\nUser's answer: ${userAnswer}\n\nAnalyze and supplement if necessary:`
          }
        ],
        max_tokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 1000,
        temperature: parseFloat(process.env.OPENAI_TEMPERATURE) || 0.7,
      })

      const enhancedResponse = completion.choices[0].message.content.trim()
      logger.info(`Enhanced answer for user ${userId}: ${enhancedResponse}`)
      
      return enhancedResponse
    } catch (error) {
      logger.error('ChatGPT API error during answer enhancement:', error)
      throw new Error('Sorry, an error occurred while checking the answer. Please try again.')
    }
  }
}

module.exports = new ChatGPTService()
