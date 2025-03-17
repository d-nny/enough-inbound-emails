export default {
  // Email handler for processing incoming emails
  async email(message, env, ctx) {
    // Enable verbose logging for this request
    ctx.logLevel = "debug";
    
    try {
      // Generate a unix timestamp for the filename
      const unixTimestamp = Math.floor(Date.now() / 1000);
      const randomId = Math.random().toString(36).substring(2, 10);
      
      // Extract message ID (remove angle brackets if present)
      const messageId = (message.headers.get("message-id") || "").replace(/[<>]/g, "");
      
      // Use exact email addresses (no path modifications)
      const toAddress = message.to;
      const fromAddress = message.from;
      
      // Create simplified Maildir-inspired structure with Unread folder
      const basePath = `emails/${toAddress}`;
      const emailPath = `${basePath}/Unread/${unixTimestamp}_${messageId || randomId}.eml`;
      
      console.log("About to store email in R2", {
        emailPath,
        to: message.to,
        from: message.from,
        rawSize: message.rawSize
      });
      
      // Extract useful metadata with threading information
      const metadata = {
        to: message.to,
        from: message.from,
        subject: message.headers.get("subject") || "",
        date: message.headers.get("date") || new Date().toISOString(),
        messageId: message.headers.get("message-id") || "",
        inReplyTo: message.headers.get("in-reply-to") || "",
        references: message.headers.get("references") || "",
        hasAttachments: false, // Will update this after checking
        size: message.rawSize,
        receivedAt: new Date().toISOString(),
        unixTimestamp: unixTimestamp
      };
      
      // Check for attachments by examining Content-Type headers
      const contentType = message.headers.get("content-type") || "";
      if (contentType.includes("multipart/mixed") || 
          message.headers.get("content-disposition")?.includes("attachment")) {
        metadata.hasAttachments = true;
      }
      
      // Store the raw email in R2 bucket with metadata
      let r2Success = false;
      
      try {
        // Convert ReadableStream<Uint8Array> to ArrayBuffer for more reliable storage
        const rawEmailArrayBuffer = await new Response(message.raw).arrayBuffer();
        
        // Store in R2 with metadata
        const r2Response = await env.EMAIL_BUCKET.put(emailPath, rawEmailArrayBuffer, {
          customMetadata: metadata
        });
        
        r2Success = true;
        
        console.log(`Email successfully stored in R2: ${emailPath}`, {
          to: message.to,
          from: message.from,
          subject: metadata.subject,
          size: metadata.size,
          etag: r2Response.etag
        });
        
        // If R2 storage was successful, call the email processor worker via service binding
        if (env.EMAIL_PROCESSOR) {
          try {
            await env.EMAIL_PROCESSOR.fetch(new Request("/process",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({ emailPath })
              }
            ));
            
            if (!processorResponse.ok) {
              const errorText = await processorResponse.text();
              throw new Error(`Email processor responded with ${processorResponse.status}: ${errorText}`);
            }
            
            const processorResult = await processorResponse.json();
            console.log(`Email processor successfully processed: ${emailPath}`, processorResult);
          } catch (processorError) {
            console.error(`Failed to process email: ${processorError.message}`, {
              error: processorError.stack,
              emailPath: emailPath
            });
          }
        } else {
          console.warn(`EMAIL_PROCESSOR binding not found. Database processing will not occur for: ${emailPath}`);
        }
        
      } catch (r2Error) {
        r2Success = false;
        console.error(`Failed to store email in R2: ${r2Error.message}`, {
          error: r2Error.stack,
          emailPath: emailPath
        });
      }
      
      // Forward email if FORWARD_EMAILS environment variable is set to true
      if (env.FORWARD_EMAILS === true || env.FORWARD_EMAILS === "true") {
        // Determine the forwarding address - use EXTERNAL_EMAIL if set, otherwise default to hardcoded address
        const forwardingAddress = env.EXTERNAL_EMAIL || "lildanc@gmail.com";
        
        // Forward the message with additional headers showing R2 status
        const forwardHeaders = new Headers();
        forwardHeaders.set("X-R2-Status", r2Success ? "SUCCESS" : "FAILED");
        forwardHeaders.set("X-R2-Object-Key", emailPath);
        forwardHeaders.set("X-Original-To", message.to);
        forwardHeaders.set("X-Original-From", message.from);
        forwardHeaders.set("X-Processed-By", "Taskblob Email Service");
        
        // Prepend status info to the subject line
        if (message.headers.has("subject")) {
          const originalSubject = message.headers.get("subject");
          forwardHeaders.set("X-Original-Subject", originalSubject);
          forwardHeaders.set("Subject", `[R2:${r2Success ? "OK" : "FAIL"}] ${originalSubject}`);
        }
        
        // Forward the message
        await message.forward(forwardingAddress, forwardHeaders);
        console.log(`Email forwarded to ${forwardingAddress}`);
      }
      
      return;
    } catch (error) {
      console.error("Error processing email:", error, {
        stack: error.stack,
        to: message.to,
        from: message.from
      });
      
      // Forward to monitoring address in case of errors, if forwarding is enabled
      if (env.FORWARD_EMAILS === true || env.FORWARD_EMAILS === "true") {
        const forwardingAddress = env.EXTERNAL_EMAIL || "lildanc@gmail.com";
        
        const errorForwardHeaders = new Headers();
        errorForwardHeaders.set("X-R2-Status", "ERROR");
        errorForwardHeaders.set("X-Error-Type", error.name || "Unknown");
        errorForwardHeaders.set("X-Error-Message", error.message || "No message");
        errorForwardHeaders.set("X-Original-To", message.to);
        errorForwardHeaders.set("X-Original-From", message.from);
        errorForwardHeaders.set("X-Processed-By", "Taskblob Email Service");
        
        // Add error info to subject
        if (message.headers.has("subject")) {
          const originalSubject = message.headers.get("subject");
          errorForwardHeaders.set("X-Original-Subject", originalSubject);
          errorForwardHeaders.set("Subject", `[ERROR] ${originalSubject}`);
        }
        
        await message.forward(forwardingAddress, errorForwardHeaders);
        console.log(`Error notification forwarded to ${forwardingAddress}`);
      }
    }
  },
  
  // HTTP handler for web requests - returning 403 for security
  async fetch(request, env, ctx) {
    return new Response("Access Denied", {
      status: 403,
      headers: {
        "Content-Type": "text/plain"
      }
    });
  }
}