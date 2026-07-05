// Supabase Edge Function: clever-api
// Handles all email notifications for the Davis Digital Studio client portal
// Deploy to: supabase functions deploy clever-api

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = "REDACTED_KEY_ROTATED_2026-07-02";
const FROM_EMAIL = "Eric Davis <eric@davisdigitalstudio.com>";
const ERIC_EMAIL = "eric@davisdigitalstudio.com";
const PORTAL_URL = "https://davisdigitalstudio.com/portal";

function brandedEmail(title: string, body: string, ctaText?: string, ctaUrl?: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f0820;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:40px 24px;">
  <div style="margin-bottom:28px;">
    <a href="https://davisdigitalstudio.com" style="font-family:Georgia,serif;font-size:20px;color:#fff;text-decoration:none;">
      Davis<span style="color:#c4aee8;">Digital</span> Studio
    </a>
  </div>
  <div style="background:#1e1338;border-radius:16px;padding:32px;margin-bottom:24px;">
    <h1 style="font-family:Georgia,serif;font-size:24px;font-weight:400;color:#fff;margin:0 0 16px;line-height:1.2;">${title}</h1>
    <div style="font-size:15px;color:rgba(255,255,255,0.65);line-height:1.8;">${body}</div>
    ${ctaText && ctaUrl ? `
    <div style="margin-top:24px;">
      <a href="${ctaUrl}" style="display:inline-block;background:#5b3fa0;color:#fff;font-size:14px;font-weight:600;padding:14px 28px;border-radius:100px;text-decoration:none;">${ctaText}</a>
    </div>` : ""}
  </div>
  <div style="text-align:center;padding-top:16px;border-top:1px solid rgba(255,255,255,0.08);">
    <p style="color:rgba(255,255,255,0.3);font-size:12px;margin:0;">
      Eric Davis · Davis Digital Studio · Los Angeles, CA<br>
      <a href="https://davisdigitalstudio.com" style="color:rgba(196,174,232,0.5);">davisdigitalstudio.com</a>
    </p>
  </div>
</div>
</body></html>`;
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  });
  return res.ok;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const { type, clientName, clientEmail, message, subject, meta } = await req.json();

    let emailSent = false;

    // ── NOTIFICATIONS TO CLIENT (from Eric) ──

    if (type === "welcome" && clientEmail) {
      const html = brandedEmail(
        `Welcome to your portal, ${clientName}!`,
        `Your Davis Digital Studio client portal is ready. This is where you can track your project, review deliverables, share files, and message me directly.<br><br>
        <strong style="color:#fff;">Log in with:</strong><br>
        <span style="color:#c4aee8;">Email:</span> ${clientEmail}<br>
        <span style="color:#c4aee8;">Password:</span> ${meta?.password || "(check your welcome message)"}<br><br>
        First step inside: fill out the <strong style="color:#fff;">Project Brief</strong> so I have everything I need to get started.`,
        "Open your portal →",
        PORTAL_URL
      );
      emailSent = await sendEmail(clientEmail, `Your Davis Digital Studio portal is ready`, html);
    }

    else if (type === "eric_message" && clientEmail) {
      const html = brandedEmail(
        "You have a new message",
        `Eric sent you a message in your project portal:<br><br>
        <div style="background:rgba(91,63,160,0.2);border-left:3px solid #c4aee8;padding:14px 16px;border-radius:8px;color:rgba(255,255,255,0.85);font-style:italic;">"${message}"</div>`,
        "Reply in your portal →",
        PORTAL_URL
      );
      emailSent = await sendEmail(clientEmail, `New message from Eric — Davis Digital Studio`, html);
    }

    else if (type === "eric_file" && clientEmail) {
      const html = brandedEmail(
        "A new file has been uploaded",
        `Eric uploaded a file to your portal:<br><br>
        <div style="background:rgba(91,63,160,0.2);border-left:3px solid #c4aee8;padding:14px 16px;border-radius:8px;color:#fff;">📎 ${message}</div><br>
        Log in to view and download it.`,
        "View your files →",
        PORTAL_URL
      );
      emailSent = await sendEmail(clientEmail, `New file uploaded — Davis Digital Studio`, html);
    }

    else if (type === "approval_needed" && clientEmail) {
      const html = brandedEmail(
        "Your review is needed",
        `Eric has a deliverable ready for your approval:<br><br>
        <div style="background:rgba(91,63,160,0.2);border-left:3px solid #c4aee8;padding:14px 16px;border-radius:8px;">
          <div style="color:#fff;font-weight:600;margin-bottom:6px;">${subject || "Deliverable"}</div>
          <div style="color:rgba(255,255,255,0.7);font-size:14px;">${message}</div>
        </div><br>
        Log in to approve or request revisions.`,
        "Review & approve →",
        PORTAL_URL
      );
      emailSent = await sendEmail(clientEmail, `Action needed: Please review your deliverable`, html);
    }

    else if (type === "invoice" && clientEmail) {
      const html = brandedEmail(
        "You have a new invoice",
        `A new invoice has been added to your portal:<br><br>
        <div style="background:rgba(91,63,160,0.2);border-left:3px solid #c4aee8;padding:14px 16px;border-radius:8px;">
          <div style="color:#fff;font-weight:600;font-size:18px;">$${message}</div>
          <div style="color:rgba(255,255,255,0.6);font-size:13px;margin-top:4px;">${subject || "Project invoice"}</div>
        </div><br>
        Log in to view details and pay.`,
        "View invoice & pay →",
        PORTAL_URL
      );
      emailSent = await sendEmail(clientEmail, `New invoice from Davis Digital Studio — $${message}`, html);
    }

    else if (type === "invoice_reminder" && clientEmail) {
      const html = brandedEmail(
        "Friendly payment reminder",
        `This is a gentle reminder that an invoice is still outstanding:<br><br>
        <div style="background:rgba(240,180,41,0.1);border-left:3px solid #f0b429;padding:14px 16px;border-radius:8px;">
          <div style="color:#fff;font-weight:600;font-size:18px;">$${message}</div>
          <div style="color:rgba(255,255,255,0.6);font-size:13px;margin-top:4px;">${subject || "Outstanding invoice"}</div>
        </div><br>
        If you have any questions, just reply to this email or message me in the portal.`,
        "Pay now →",
        PORTAL_URL
      );
      emailSent = await sendEmail(clientEmail, `Payment reminder — Davis Digital Studio`, html);
    }

    // ── NOTIFICATIONS TO ERIC (from client activity) ──

    else if (type === "brief_submitted") {
      const html = brandedEmail(
        `${clientName} submitted their project brief`,
        `Your client has filled out the project brief. Log in to your admin panel to review it and get started.<br><br>
        <strong style="color:#fff;">Client:</strong> ${clientName}`,
        "View in admin →",
        "https://davisdigitalstudio.com/dds-studio-manage-9k2p"
      );
      emailSent = await sendEmail(ERIC_EMAIL, `[Portal] ${clientName} submitted their project brief`, html);
    }

    else if (type === "contract_acked") {
      const html = brandedEmail(
        `${clientName} signed the agreement`,
        `Your client has acknowledged and signed the project agreement. You're good to proceed.<br><br>
        <strong style="color:#fff;">Client:</strong> ${clientName}<br>
        <strong style="color:#fff;">Date:</strong> ${message}`,
        "View in admin →",
        "https://davisdigitalstudio.com/dds-studio-manage-9k2p"
      );
      emailSent = await sendEmail(ERIC_EMAIL, `[Portal] ${clientName} signed the agreement`, html);
    }

    else if (type === "client_message") {
      const html = brandedEmail(
        `New message from ${clientName}`,
        `Your client sent a message in the portal:<br><br>
        <div style="background:rgba(91,63,160,0.2);border-left:3px solid #c4aee8;padding:14px 16px;border-radius:8px;color:rgba(255,255,255,0.85);font-style:italic;">"${message}"</div>`,
        "Reply in admin →",
        "https://davisdigitalstudio.com/dds-studio-manage-9k2p"
      );
      emailSent = await sendEmail(ERIC_EMAIL, `[Portal] ${clientName}: ${message.substring(0, 60)}${message.length > 60 ? '...' : ''}`, html);
    }

    else if (type === "file_uploaded") {
      const html = brandedEmail(
        `${clientName} uploaded a file`,
        `Your client uploaded a file to the portal:<br><br>
        <div style="background:rgba(91,63,160,0.2);border-left:3px solid #c4aee8;padding:14px 16px;border-radius:8px;color:#fff;">📎 ${message}</div>`,
        "View in admin →",
        "https://davisdigitalstudio.com/dds-studio-manage-9k2p"
      );
      emailSent = await sendEmail(ERIC_EMAIL, `[Portal] ${clientName} uploaded: ${message}`, html);
    }

    else if (type === "approval_action") {
      const action = meta?.action === "revision" ? "requested revisions" : "approved";
      const html = brandedEmail(
        `${clientName} ${action} a deliverable`,
        `<strong style="color:#fff;">Deliverable:</strong> ${subject}<br><br>
        ${meta?.action === "revision" ? `<strong style="color:#fff;">Revision notes:</strong><br>
        <div style="background:rgba(224,85,85,0.1);border-left:3px solid #e05555;padding:14px 16px;border-radius:8px;color:rgba(255,255,255,0.8);margin-top:8px;">${meta?.note || "No notes provided"}</div>` :
        `<div style="background:rgba(106,191,105,0.1);border-left:3px solid #6abf69;padding:14px 16px;border-radius:8px;color:#6abf69;">✓ Approved</div>`}`,
        "View in admin →",
        "https://davisdigitalstudio.com/dds-studio-manage-9k2p"
      );
      emailSent = await sendEmail(ERIC_EMAIL, `[Portal] ${clientName} ${action}: ${subject}`, html);
    }

    return new Response(JSON.stringify({ success: emailSent, type }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
});