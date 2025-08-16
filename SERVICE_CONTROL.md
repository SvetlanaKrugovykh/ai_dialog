# Service Control Configuration

This document describes the new service management functionality in AI Dialog Bot.

## Control Flags

Three new flags have been added to the `.env` file for service management:

### ENABLE_LOCAL_AI

```env
ENABLE_LOCAL_AI=true/false
```

**Purpose**: Controls the use of local AI text processing services

- `true` (default): Uses local text processing service on port 8344
- `false`: Skips local AI text processing and goes directly to fallback

**Applied to**:

- Text message processing only

### ENABLE_SPEECH_TO_TEXT

```env
ENABLE_SPEECH_TO_TEXT=true/false
```

**Purpose**: Controls the use of speech-to-text service

- `true` (default): Uses local speech-to-text service on port 8338
- `false`: Skips voice message processing and shows error or uses fallback

**Applied to**:

- Voice message processing only

### ENABLE_CHATGPT_FALLBACK

```env
ENABLE_CHATGPT_FALLBACK=true/false
```

**Purpose**: Controls the use of ChatGPT as a fallback service

- `true` (default): ChatGPT is used as fallback when local services fail or are disabled
- `false`: ChatGPT fallback is disabled, error message is sent on failure

## Logic Flow

### Voice Message Processing

1. **ENABLE_SPEECH_TO_TEXT = true**: 
   - Try to process through speech-to-text service (port 8338)
   - On failure: check ENABLE_CHATGPT_FALLBACK
     - `true`: switch to ChatGPT
     - `false`: send error message

2. **ENABLE_SPEECH_TO_TEXT = false**:
   - Skip speech-to-text processing
   - Check ENABLE_CHATGPT_FALLBACK
     - `true`: switch to ChatGPT
     - `false`: send error message

### Text Message Processing

1. **ENABLE_LOCAL_AI = true**: 
   - Try to process through local AI text processing (port 8344)
   - On failure: check ENABLE_CHATGPT_FALLBACK
     - `true`: switch to ChatGPT
     - `false`: send error message

2. **ENABLE_LOCAL_AI = false**:
   - Skip local AI text processing
   - Check ENABLE_CHATGPT_FALLBACK
     - `true`: switch to ChatGPT
     - `false`: send error message

## Logging

Added new log types:

```javascript
logMessages.processing.localAIDisabled(userId) 
// "Local AI disabled for user ${userId}, switching to fallback"

logMessages.processing.speechToTextDisabled(userId) 
// "Speech-to-text disabled for user ${userId}, switching to fallback"
```

## Usage Scenarios

### Complete AI Services Shutdown

```env
ENABLE_LOCAL_AI=false
ENABLE_CHATGPT_FALLBACK=false
```

Result: Bot will only respond with error messages

### ChatGPT Only

```env
ENABLE_LOCAL_AI=false
ENABLE_CHATGPT_FALLBACK=true
```

Result: All traffic goes through ChatGPT

### Local AI Only

```env
ENABLE_LOCAL_AI=true
ENABLE_CHATGPT_FALLBACK=false
```

Result: No fallback when local services fail

### Full Functionality (default)

```env
ENABLE_LOCAL_AI=true
ENABLE_CHATGPT_FALLBACK=true
```

Result: Standard behavior with fallback switching

## Code Changes

### Modified Files:

- `src/handlers/messageHandler.js` - added flag checks
- `data/logMessages.js` - added localAIDisabled message
- `.env` - added flags with documentation

### Flag Check Locations:

1. `handleVoice()` - before calling `localAIService.processVoiceMessage()`
2. `handleTextMessage()` - before calling `localAIService.processTextMessage()`
3. `fallbackToChatGPT()` - before calling ChatGPT service (previously implemented)
