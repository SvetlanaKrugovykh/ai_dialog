const logger = require('../utils/logger')
const logMessages = require('../../data/logMessages')

class TicketParser {
  constructor() {
    // Department keywords for classification
    this.departmentKeywords = {
      IT: [
        // Ukrainian keywords for IT department
        'комп\'ютер', 'інтернет', 'пошта', 'принтер', 'програма', 'система',
        'мережа', 'сайт', 'сервер', 'база даних', 'пароль', 'доступ',
        'установка', 'налаштування', 'програмне забезпечення', 'антивірус',
        'резервне копіювання', 'відновлення', 'технічна підтримка',
        'оновлення', 'ліцензія', 'обладнання', 'монітор', 'клавіатура',
        'миша', 'звук', 'відео', 'камера', 'мікрофон', 'wi-fi', 'wifi',
        
        // Russian keywords for IT department
        'компьютер', 'интернет', 'почта', 'принтер', 'программа', 'система',
        'сеть', 'сайт', 'сервер', 'база данных', 'пароль', 'доступ',
        'установка', 'настройка', 'программное обеспечение', 'антивирус',
        'резервное копирование', 'восстановление', 'техническая поддержка',
        'обновление', 'лицензия', 'оборудование', 'монитор', 'клавиатура',
        'мышь', 'звук', 'видео', 'камера', 'микрофон', 'вай-фай',
        
        // Common IT terms
        'it', 'айти', 'email', 'е-мейл', 'windows', 'office', 'outlook',
        'excel', 'word', 'powerpoint', 'skype', 'teams', 'zoom',
        'vpn', 'ip', 'dns', 'tcp', 'http', 'https', 'ftp', 'sql'
      ],
      
      Legal: [
        // Ukrainian keywords for Legal department
        'юрист', 'юридичний', 'договір', 'контракт', 'угода', 'документ',
        'правовий', 'закон', 'законодавство', 'нормативний', 'акт',
        'реєстрація', 'ліцензування', 'дозвіл', 'сертифікат', 'патент',
        'торговельна марка', 'авторське право', 'інтелектуальна власність',
        'судовий', 'претензія', 'позов', 'арбітраж', 'медіація',
        'нотаріус', 'довіреність', 'заповіт', 'спадщина', 'податки',
        'відповідальність', 'штраф', 'санкції', 'компліанс',
        
        // Russian keywords for Legal department
        'юрист', 'юридический', 'договор', 'контракт', 'соглашение', 'документ',
        'правовой', 'закон', 'законодательство', 'нормативный', 'акт',
        'регистрация', 'лицензирование', 'разрешение', 'сертификат', 'патент',
        'торговая марка', 'авторское право', 'интеллектуальная собственность',
        'судебный', 'претензия', 'иск', 'арбитраж', 'медиация',
        'нотариус', 'доверенность', 'завещание', 'наследство', 'налоги',
        'ответственность', 'штраф', 'санкции', 'комплаенс'
      ],
      
      HR: [
        // Ukrainian keywords for HR department
        'кадри', 'персонал', 'співробітник', 'працівник', 'найм', 'звільнення',
        'відпустка', 'лікарняний', 'зарплата', 'премія', 'бонус', 'стажування',
        'навчання', 'тренінг', 'атестація', 'оцінка', 'посада', 'підвищення',
        'переведення', 'графік', 'робочий час', 'відгул', 'прогул',
        'дисципліна', 'мотивація', 'командировка', 'витрати', 'компенсація',
        'соціальний пакет', 'страхування', 'медичний огляд', 'профспілка',
        
        // Russian keywords for HR department
        'кадры', 'персонал', 'сотрудник', 'работник', 'найм', 'увольнение',
        'отпуск', 'больничный', 'зарплата', 'премия', 'бонус', 'стажировка',
        'обучение', 'тренинг', 'аттестация', 'оценка', 'должность', 'повышение',
        'перевод', 'график', 'рабочее время', 'отгул', 'прогул',
        'дисциплина', 'мотивация', 'командировка', 'расходы', 'компенсация',
        'социальный пакет', 'страхование', 'медосмотр', 'профсоюз',
        
        // Common HR terms
        'hr', 'эйчар', 'cv', 'резюме', 'собеседование', 'рекрутинг'
      ]
    }
    
    // Priority keywords
    this.priorityKeywords = {
      High: [
        'срочно', 'терміново', 'критично', 'критически', 'аварійно', 'аварийно',
        'негайно', 'немедленно', 'блокер', 'блокирует', 'не працює', 'не работает',
        'зламався', 'сломался', 'падає', 'падает', 'горить', 'горит'
      ],
      Medium: [
        'важливо', 'важно', 'потрібно', 'нужно', 'необхідно', 'необходимо',
        'слід', 'следует', 'варто', 'стоит', 'бажано', 'желательно'
      ],
      Low: [
        'коли буде час', 'когда будет время', 'не поспішаючи', 'не спеша',
        'коли зможете', 'когда сможете', 'на дозвіллі', 'на досуге'
      ]
    }
  }

  /**
   * Parse transcribed text and create ticket structure
   * @param {string} text - transcribed text
   * @param {string} clientId - user ID
   * @returns {Object} - parsed ticket structure
   */
  parseTicket(text, clientId) {
    try {
      logger.info(logMessages.processing.ticketParsing(clientId, text))

      const ticket = {
        ticket_id: this.generateTicketId(),
        department: this.determineDepartment(text),
        category: 'Request', // Default category
        priority: this.determinePriority(text),
        title: this.generateTitle(text),
        description: text.trim(),
        requester: clientId,
        language: this.detectLanguage(text),
        created_at: new Date().toISOString(),
        status: 'Open'
      }

      logger.info(logMessages.processing.ticketCreated(clientId, ticket.ticket_id, ticket.department))
      
      return ticket
    } catch (error) {
      logger.error(logMessages.services.ticketParsingError, error)
      throw error
    }
  }

  /**
   * Generate unique ticket ID
   * @returns {string} - ticket ID
   */
  generateTicketId() {
    const now = new Date()
    const timestamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
    return `TKT-${timestamp}${random}`
  }

  /**
   * Determine department based on keywords in text
   * @param {string} text - text to analyze
   * @returns {string} - department name
   */
  determineDepartment(text) {
    const lowerText = text.toLowerCase()
    let maxScore = 0
    let bestDepartment = 'IT' // Default to IT
    
    for (const [dept, keywords] of Object.entries(this.departmentKeywords)) {
      let score = 0
      for (const keyword of keywords) {
        if (lowerText.includes(keyword.toLowerCase())) {
          score += 1
          // Give more weight to exact matches
          if (lowerText.includes(` ${keyword.toLowerCase()} `)) {
            score += 0.5
          }
        }
      }
      
      if (score > maxScore) {
        maxScore = score
        bestDepartment = dept
      }
    }
    
    return bestDepartment
  }

  /**
   * Determine priority based on keywords in text
   * @param {string} text - text to analyze
   * @returns {string} - priority level
   */
  determinePriority(text) {
    const lowerText = text.toLowerCase()
    
    // Check for high priority keywords first
    for (const keyword of this.priorityKeywords.High) {
      if (lowerText.includes(keyword.toLowerCase())) {
        return 'High'
      }
    }
    
    // Check for low priority keywords
    for (const keyword of this.priorityKeywords.Low) {
      if (lowerText.includes(keyword.toLowerCase())) {
        return 'Low'
      }
    }
    
    // Check for medium priority keywords or default to medium
    for (const keyword of this.priorityKeywords.Medium) {
      if (lowerText.includes(keyword.toLowerCase())) {
        return 'Medium'
      }
    }
    
    return 'Medium' // Default priority
  }

  /**
   * Generate title from text
   * @param {string} text - full text
   * @returns {string} - generated title
   */
  generateTitle(text) {
    // Take first meaningful part of the text as title
    let title = text.trim()
    
    // If text is too long, take first sentence or first 50 characters
    if (title.length > 50) {
      // Try to find first sentence
      const sentenceEnd = title.search(/[.!?]\s/)
      if (sentenceEnd > 10 && sentenceEnd < 50) {
        title = title.substring(0, sentenceEnd + 1)
      } else {
        // Take first 47 characters and add "..."
        title = title.substring(0, 47) + '...'
      }
    }
    
    // Capitalize first letter
    return title.charAt(0).toUpperCase() + title.slice(1)
  }

  /**
   * Detect language of the text
   * @param {string} text - text to analyze
   * @returns {string} - detected language
   */
  detectLanguage(text) {
    const lowerText = text.toLowerCase()
    
    // Ukrainian indicators
    const ukrainianChars = (lowerText.match(/[іїєґ]/g) || []).length
    const ukrainianWords = [
      'та', 'або', 'якщо', 'який', 'тому', 'треба', 'потрібно', 'можна',
      'буде', 'має', 'можуть', 'повинен', 'після', 'перед'
    ]
    let ukrainianScore = ukrainianChars * 2
    
    for (const word of ukrainianWords) {
      if (lowerText.includes(word)) {
        ukrainianScore += 1
      }
    }
    
    // Russian indicators
    const russianWords = [
      'что', 'или', 'если', 'который', 'поэтому', 'нужно', 'можно',
      'будет', 'имеет', 'могут', 'должен', 'после', 'перед'
    ]
    let russianScore = 0
    
    for (const word of russianWords) {
      if (lowerText.includes(word)) {
        russianScore += 1
      }
    }
    
    if (ukrainianScore > russianScore) {
      return ukrainianScore > 2 ? 'Ukrainian' : 'Mixed'
    } else if (russianScore > ukrainianScore) {
      return russianScore > 2 ? 'Russian' : 'Mixed'
    } else {
      return 'Mixed'
    }
  }

  /**
   * Format ticket for display
   * @param {Object} ticket - ticket object
   * @returns {string} - formatted ticket text
   */
  formatTicketForDisplay(ticket) {
    const departmentEmojis = {
      'IT': '💻',
      'Legal': '⚖️',
      'HR': '👥'
    }
    
    const priorityEmojis = {
      'High': '🔴',
      'Medium': '🟡',
      'Low': '🟢'
    }
    
    return `🎫 **Заявка створена**

📋 **ID:** ${ticket.ticket_id}
${departmentEmojis[ticket.department] || '📁'} **Відділ:** ${ticket.department}
📂 **Категорія:** ${ticket.category}
${priorityEmojis[ticket.priority] || '⚪'} **Пріоритет:** ${ticket.priority}
📝 **Заголовок:** ${ticket.title}
📄 **Опис:** ${ticket.description}
🌐 **Мова:** ${ticket.language}
⏰ **Створено:** ${new Date(ticket.created_at).toLocaleString('uk-UA')}
✅ **Статус:** ${ticket.status}`
  }
}

module.exports = new TicketParser()
