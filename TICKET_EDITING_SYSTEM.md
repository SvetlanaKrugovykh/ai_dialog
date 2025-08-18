# Field-Based Ticket Editing System

## System Overview

A complete ticket editing system implementation with individual field modification capabilities and Service Desk integration.

## Core Components

### 1. Callback Request Handling (`messageHandler.js`)

- **Callback Parsing**: System processes complex callback requests like `editfield_title_TKT-123`
- **Priority Support**: Handles callbacks `setpriority_High_TKT-123` (removed in latest version)
- **Editing Modes**: Supports full text, voice, and field-by-field editing modes

### 2. Service Desk Integration (`ticketService.js`)

- **API Integration**: POST requests to `https://127.0.0.1:8001/api/create-ticket`
- **Operating Modes**: Debug and production modes
- **Ticket Parsing**: Automatic field extraction from ticket text
- **Error Handling**: Comprehensive API error handling system

### 3. User Interface (`messages.js`)

- **Ukrainian Interface**: Complete Ukrainian language localization
- **Field Instructions**: Specific instructions for each field type
- **Success/Error Messages**: Informative user feedback messages

## Workflow Algorithm

### 1. Ticket Creation
1. User sends voice message or text
2. System processes and creates pending ticket
3. Preview shown with buttons: SAVE, CANCEL, EDIT

### 2. Editing Process
When "EDIT" is pressed:
1. Options displayed: full editing, voice, field-by-field
2. Field-by-field selection shows buttons for each field
3. User can modify any field individually

### 3. Service Desk Submission
When "SAVE" is pressed:
1. Ticket sent to Service Desk via `ticketService`
2. Debug mode simulates submission
3. User receives confirmation with ticket ID

## Supported Fields

- **title**: Ticket title
- **description**: Problem description
- **urgency**: Urgency level
- **location**: Location information

*Note: Priority and category fields were removed - system now determines these automatically*

## Callback Structure

- `confirm_{ticketId}` - confirm ticket
- `cancel_{ticketId}` - cancel ticket
- `edit_{ticketId}` - start editing
- `editfull_{ticketId}` - full text editing
- `editvoice_{ticketId}` - voice editing
- `editfield_{fieldName}_{ticketId}` - edit specific field

## Operating Modes

### Debug Mode
- Tickets not actually sent to Service Desk
- Test ticket IDs generated
- All actions logged for debugging

### Production Mode
- Real Service Desk submission
- Real API response handling
- Full Zammad integration

## Environment Variables Configuration

```env
# Service Desk settings
ZAMMAD_API_URL=https://127.0.0.1:8001/api
MODE=debug  # or production

# Telegram Bot settings
TELEGRAM_TOKEN=your_telegram_token

# OpenAI settings (optional)
OPENAI_API_KEY=your_openai_key
```

## Logging

All operations are logged with detailed information:

- Ticket creation
- Field editing
- Service Desk submission
- Errors and exceptions

## Testing

To test the system:

1. Start the bot: `node src/index.js`
2. Send voice message or text
3. Use buttons to edit fields
4. Verify Service Desk submission

The system is production-ready and fully integrated with the existing bot.
