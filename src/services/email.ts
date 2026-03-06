// ─── Email sending via Resend ─────────────────────────────────────────────────

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY env var is not set");

  const from = process.env.EMAIL_FROM ?? "InsightCuts <noreply@insightcuts.app>";

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`Resend API error ${resp.status}: ${text}`);
  }
}

export function buildEmailHtml(opts: {
  projectTitle: string;
  summary: string;
  gestureQuery: string;
  clipCount: number;
  insights: string[];
}): string {
  const insightRows = opts.insights
    .slice(0, 5)
    .map(
      (text) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f5f5f5;font-size:13px;color:#444;line-height:1.5;">
          ${escapeHtml(text)}
        </td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#EA580C;padding:24px 28px;">
            <span style="font-size:20px;font-weight:700;color:#fff;">InsightCuts</span>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;">
            <h2 style="margin:0 0 8px;font-size:18px;color:#111;">${escapeHtml(opts.projectTitle)}</h2>
            <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.6;">${escapeHtml(opts.summary)}</p>
            <table cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
              <tr>
                <td style="padding:5px 12px;background:#FFF7ED;border:1px solid #FED7AA;border-radius:20px;font-size:12px;font-weight:600;color:#EA580C;white-space:nowrap;">
                  Search: ${escapeHtml(opts.gestureQuery)}
                </td>
                <td width="8"></td>
                <td style="padding:5px 12px;background:#f5f5f5;border:1px solid #e0e0e0;border-radius:20px;font-size:12px;font-weight:600;color:#555;white-space:nowrap;">
                  ${opts.clipCount} clip${opts.clipCount !== 1 ? "s" : ""} found
                </td>
              </tr>
            </table>
            ${insightRows ? `
            <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.05em;">Key Insights</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f0f0f0;">
              ${insightRows}
            </table>` : ""}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px;border-top:1px solid #f0f0f0;font-size:11px;color:#aaa;text-align:center;">
            Shared via InsightCuts
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
