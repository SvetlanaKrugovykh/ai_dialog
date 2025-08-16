# AI Dialog Bot - Recent Changes

## Code Localization Update

All code comments, log messages, and documentation have been converted to English to maintain consistency and improve international collaboration.

### Modified Files:

#### 1. `data/logMessages.js`
- **Purpose**: System logging messages for debugging
- **Changes**: All Ukrainian log messages converted to English
- **Impact**: Cleaner debug logs in English

#### 2. `src/services/localAI.js`
- **Purpose**: Local AI service integration
- **Changes**: Debug message to users changed from Ukrainian to English
- **Message**: `"🔍 Recognized text:\n"${transcribedText}""` (was: `"🔍 Розпізнаний текст:\n"${transcribedText}""`)

#### 3. `src/services/ticketParser.js`
- **Purpose**: Ticket classification and parsing
- **Changes**: Comments converted to English
- **Note**: Keywords remain in Ukrainian/Russian as they are functional data for user input processing

#### 4. `SERVICE_CONTROL.md`
- **Purpose**: Documentation for service control flags
- **Changes**: Complete documentation rewritten in English

### Language Policy

- **Code**: English only (comments, variable names, log messages)
- **Documentation**: English only (.md files)
- **Functional Data**: Ukrainian/Russian keywords preserved for user interaction
- **User Interface**: Remains in Ukrainian (data/messages.js) as required by users

### Service Control Implementation

The bot now supports granular service control through environment variables:

```env
# Local AI services control
ENABLE_LOCAL_AI=true/false

# ChatGPT fallback control  
ENABLE_CHATGPT_FALLBACK=true/false
```

This allows flexible deployment configurations for different environments and service availability scenarios.

### Testing

All files have been syntax-checked and are ready for deployment. The bot maintains full functionality while providing cleaner, English-only development environment.
