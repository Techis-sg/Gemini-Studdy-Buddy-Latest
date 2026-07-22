/**
 * Mailjet Email Service Integration
 * Implements Mailjet Send API v3.1
 * https://dev.mailjet.com/email/guides/send-api-v31/
 */

export interface MailjetMessagePayload {
  toEmail: string;
  toName?: string;
  subject: string;
  textPart?: string;
  htmlPart?: string;
  templateId?: number;
  variables?: Record<string, any>;
  customID?: string;
}

export interface MailjetSendResult {
  success: boolean;
  status?: string;
  messageId?: string;
  data?: any;
  error?: string;
}

export function getMailjetCredentials() {
  const apiKey = process.env.MAILJET_API_KEY || "29670a77fe0b8edd77a598424b442a6c";
  const apiSecret = process.env.MAILJET_SECRET_KEY || "50b4b1291dff92c3b637e84b07de403a";
  const senderEmail = process.env.MAILJET_SENDER_EMAIL || "noreply@learnspace.app";
  const senderName = "StudyBuddy Portal";

  return { apiKey, apiSecret, senderEmail, senderName };
}

/**
 * Send email via Mailjet Send API v3.1
 */
export async function sendMailjetEmail(payload: MailjetMessagePayload): Promise<MailjetSendResult> {
  const { apiKey, apiSecret, senderEmail, senderName } = getMailjetCredentials();

  if (!apiKey || !apiSecret) {
    console.error("[Mailjet] API key or Secret is missing.");
    return {
      success: false,
      error: "Mailjet API key or Secret key is missing.",
    };
  }

  const authHeader = "Basic " + Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

  const messageObj: Record<string, any> = {
    From: {
      Email: senderEmail,
      Name: senderName,
    },
    To: [
      {
        Email: payload.toEmail,
        Name: payload.toName || payload.toEmail.split("@")[0],
      },
    ],
    Subject: payload.subject,
  };

  if (payload.textPart) {
    messageObj.TextPart = payload.textPart;
  }

  if (payload.htmlPart) {
    messageObj.HTMLPart = payload.htmlPart;
  } else if (payload.textPart) {
    messageObj.HTMLPart = `<div style="font-family: sans-serif; font-size: 14px; color: #333; line-height: 1.6;">${payload.textPart.replace(/\n/g, "<br/>")}</div>`;
  }

  if (payload.templateId) {
    messageObj.TemplateID = payload.templateId;
    messageObj.TemplateLanguage = true;
    if (payload.variables) {
      messageObj.Variables = payload.variables;
    }
  }

  if (payload.customID) {
    messageObj.CustomID = payload.customID;
  }

  const requestBody = {
    Messages: [messageObj],
  };

  try {
    const response = await fetch("https://api.mailjet.com/v3.1/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(requestBody),
    });

    const responseData = await response.json();

    if (!response.ok) {
      console.error("[Mailjet API Error]", response.status, responseData);
      return {
        success: false,
        error: responseData.ErrorMessage || responseData.message || `Mailjet HTTP ${response.status}`,
        data: responseData,
      };
    }

    const messageResult = responseData.Messages?.[0];
    if (messageResult?.Status === "success") {
      const firstTo = messageResult.To?.[0];
      return {
        success: true,
        status: messageResult.Status,
        messageId: firstTo?.MessageID || messageResult.CustomID || "mj_" + Date.now(),
        data: responseData,
      };
    } else {
      console.warn("[Mailjet Delivery Warning]", messageResult);
      return {
        success: false,
        status: messageResult?.Status || "error",
        error: messageResult?.Errors?.[0]?.ErrorMessage || "Failed to deliver message via Mailjet",
        data: responseData,
      };
    }
  } catch (err: any) {
    console.error("[Mailjet Exception]", err);
    return {
      success: false,
      error: err.message || "Failed to connect to Mailjet API",
    };
  }
}

/**
 * Helper: Send data export notification email
 */
export async function sendDataExportEmail(toEmail: string, toName: string, requestId: string): Promise<MailjetSendResult> {
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; rounded: 12px; background-color: #ffffff;">
      <div style="border-bottom: 2px solid #6366f1; padding-bottom: 16px; margin-bottom: 20px;">
        <h2 style="color: #1e293b; margin: 0; font-size: 20px;">StudyBuddy Portal — Data Export Request</h2>
      </div>
      <p style="color: #475569; font-size: 14px; line-height: 1.6;">Hello <strong>${toName || "User"}</strong>,</p>
      <p style="color: #475569; font-size: 14px; line-height: 1.6;">
        We have received your data export request (Request ID: <code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px; color: #4338ca;">${requestId}</code>).
      </p>
      <p style="color: #475569; font-size: 14px; line-height: 1.6;">
        Your complete data package (subjects, study logs, task histories, and profile settings) is being processed and prepared for download.
      </p>
      <div style="margin: 24px 0; padding: 16px; background-color: #eef2ff; border-left: 4px solid #6366f1; border-radius: 6px;">
        <p style="margin: 0; color: #3730a3; font-size: 13px; font-weight: bold;">Status: Processing Export Package</p>
      </div>
      <p style="color: #94a3b8; font-size: 12px; margin-top: 32px; border-top: 1px solid #f1f5f9; padding-top: 16px;">
        This automated notification was sent via Mailjet API Integration.
      </p>
    </div>
  `;

  return sendMailjetEmail({
    toEmail,
    toName,
    subject: `[StudyBuddy] Data Export Request (${requestId})`,
    textPart: `Hello ${toName},\n\nWe received your data export request (ID: ${requestId}). Your package is being prepared.`,
    htmlPart: htmlContent,
    customID: requestId,
  });
}

/**
 * Helper: Send account deactivation notification email
 */
export async function sendAccountDeactivationEmail(toEmail: string, toName: string): Promise<MailjetSendResult> {
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; background-color: #ffffff;">
      <h2 style="color: #b91c1c; margin-top: 0;">Account Deactivated</h2>
      <p style="color: #475569; font-size: 14px;">Hello <strong>${toName || "User"}</strong>,</p>
      <p style="color: #475569; font-size: 14px; line-height: 1.6;">
        Your StudyBuddy workspace session and account status have been set to <strong>Deactivated</strong>.
      </p>
      <p style="color: #475569; font-size: 14px; line-height: 1.6;">
        If you wish to reactivate your workspace, simply log back in with your credentials and confirm reactivation.
      </p>
    </div>
  `;

  return sendMailjetEmail({
    toEmail,
    toName,
    subject: "[StudyBuddy] Your Account Has Been Deactivated",
    textPart: `Hello ${toName},\n\nYour account has been deactivated. Log in anytime to reactivate your session.`,
    htmlPart: htmlContent,
  });
}
