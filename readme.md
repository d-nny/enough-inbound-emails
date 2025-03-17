# Email Inbound Handler for Cloudflare

This Cloudflare Worker processes incoming emails, stores them in R2, and triggers the email processor worker to handle database operations.

## How It Works

This worker:
1. Receives incoming emails via Cloudflare Email Routing
2. Stores the raw email content in R2 with metadata
3. Calls the email processor worker via a service binding to process the email
4. Optionally forwards the email to an external address

## Configuration

### Wrangler.toml Settings

The `wrangler.toml` file includes:

- R2 binding for email storage
- Service binding to the email processor worker
- Environment variables for email forwarding

### Environment Variables

- `FORWARD_EMAILS`: Set to "true" to enable email forwarding
- `EXTERNAL_EMAIL`: The email address to forward messages to

## API Endpoints

- `GET /`: Information page
- `GET /test-r2`: Test R2 functionality
- `GET /list-r2`: List R2 bucket contents (use with caution)
- `POST /process-email`: Manually trigger email processing
  - Body: `{ "emailPath": "emails/user@example.com/Inbox/123.eml" }`
- `POST /test-flow`: Test the complete email flow
  - Body: `{ "content": "Email body", "to": "recipient@example.com", "from": "sender@example.com", "subject": "Test Subject" }`

## Setup Instructions

1. **Prerequisites**:
   - [Node.js](https://nodejs.org/) (v16 or later)
   - [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
   - A Cloudflare account with Workers, R2, and Email Routing enabled

2. **Configuration**:
   - Edit `wrangler.toml` to update your account ID
   - Create R2 bucket for email storage
   - Configure service binding to the email processor worker
   - Set environment variables for email forwarding

3. **Install Dependencies**:
   ```bash
   npm install
   ```

4. **Development**:
   ```bash
   npm run dev
   ```

5. **Deployment**:
   ```bash
   npm run deploy
   ```

6. **Email Routing Setup**:
   - In the Cloudflare dashboard, set up Email Routing
   - Create a route that sends emails to this worker
   - See [Cloudflare Email Routing documentation](https://developers.cloudflare.com/email-routing/) for details

## System Design

This worker is part of a two-worker system:

1. **enough-inbound-emails** (this worker): Handles incoming emails, stores them in R2
2. **email-processor-worker**: Processes emails from R2 and stores metadata in D1 database

The first worker calls the second via a service binding, passing the path to the stored email.

## Email Storage Structure

Emails are stored in R2 with the following path structure:
```
emails/{recipient-email}/Unread/{timestamp}_{message-id}.eml
```

## Maintenance

- Monitor R2 storage usage
- Check worker logs for errors
- Periodically review email processing performance