const fs = require('fs')
const path = require('path')

class Logger {
  constructor() {
    this.logDir = path.join(__dirname, '../../logs')
    this.ensureLogDir()
  }

  ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true })
    }
  }

  formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString()
    const logMessage = data 
      ? `[${timestamp}] ${level}: ${message} ${JSON.stringify(data, null, 2)}`
      : `[${timestamp}] ${level}: ${message}`
    
    return logMessage
  }

  writeToFile(level, message) {
    const fileName = `${new Date().toISOString().split('T')[0]}.log`
    const filePath = path.join(this.logDir, fileName)
    
    fs.appendFileSync(filePath, message + '\n', 'utf8')
  }

  info(message, data = null) {
    const formattedMessage = this.formatMessage('INFO', message, data)
    console.log(formattedMessage)
    this.writeToFile('INFO', formattedMessage)
  }

  error(message, data = null) {
    const formattedMessage = this.formatMessage('ERROR', message, data)
    console.error(formattedMessage)
    this.writeToFile('ERROR', formattedMessage)
  }

  warn(message, data = null) {
    const formattedMessage = this.formatMessage('WARN', message, data)
    console.warn(formattedMessage)
    this.writeToFile('WARN', formattedMessage)
  }

  debug(message, data = null) {
    if (process.env.NODE_ENV === 'development') {
      const formattedMessage = this.formatMessage('DEBUG', message, data)
      console.log(formattedMessage)
      this.writeToFile('DEBUG', formattedMessage)
    }
  }
}

module.exports = new Logger()
