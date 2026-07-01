export async function sendWebhook(content, options = {}) {
  const webhookUrl =
    options.webhookUrl ||
    process.env.DISCORD_WEBHOOK_URL ||
    process.env.CREDITCARDMASTER_DISCORD_WEBHOOK_URL ||
    process.env.CONGRESS_TRADES_DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return { sent: false, reason: "missing_webhook_url" };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "CreditCardMaster",
      content: String(content).slice(0, 1900),
    }),
  });

  if (!response.ok) {
    return { sent: false, reason: `discord_webhook_${response.status}` };
  }

  return { sent: true };
}
