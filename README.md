# AI Dialog Bot 🤖

Telegram bot for interactive Q&A with ChatGPT integration.

## Features

- 🔄 Question-answer mode with ChatGPT
- 📝 Analysis and enhancement of user answers
- 💾 User session management
- 📊 Usage statistics
- 🔍 Operation logging

## Project Structure

```
src/
├── config/bot.js           # Telegram bot configuration
├── handlers/messageHandler.js  # Message and command handler
├── services/
│   ├── chatgpt.js         # ChatGPT API service
│   └── session.js         # User session management
├── utils/logger.js        # Logging utility
└── index.js               # Main application file
```

## Installation

1. Install dependencies:
```bash
npm install
```

2. Copy `.env.example` to `.env` and fill in the variables:
```bash
cp .env.example .env
```

3. Configure environment variables in `.env`:
```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
OPENAI_API_KEY=your_openai_api_key_here
```

## Usage

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

## Bot Commands

- `/start` - Start working with the bot
- `/help` - Show help
- `/clear` - Clear conversation history
- `/stats` - Show statistics

## Requirements

- Node.js >= 16.0.0
- Telegram Bot Token
- OpenAI API Key
