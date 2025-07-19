# AI Dialog Bot

Telegram bot with local AI services and ChatGPT fallback.

## Features

- 🎤 Voice message processing
- 📝 Text message processing  
- 🔄 Local AI services integration
- 🤖 ChatGPT fallback when local services fail
- 📊 Services health monitoring

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` file:

```env
TELEGRAM_BOT_TOKEN=your_bot_token
SPEECH_TO_TEXT_URL=http://localhost:8338/update/
TEXT_PROCESSING_URL=http://localhost:8339/process/
OPENAI_API_KEY=your_openai_key
```

3. Run:

```bash
npm start
```

## Commands

- `/start` - Start bot
- `/help` - Show help
- `/clear` - Clear history
- `/stats` - Show stats
- `/health` - Check AI services status
