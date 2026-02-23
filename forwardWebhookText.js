/**
 * Universal Text Webhook Forwarder
 * Sends plain text (NOT JSON)
 */

const axios = require("axios");

const WEBHOOK_URL =
  "https://lionfish.xalgos.in/webhook/tradingview/35/676c4273-5b08-4d13-aca6-ba069676c895";

async function forwardWebhookText(message) {
  try {
    message = String(message).trim();

    await axios.post(
      "https://lionfish.xalgos.in/webhook/tradingview/35/676c4273-5b08-4d13-aca6-ba069676c895",
      message,
      {
        headers: {
          "Content-Type": "text/plain",
        },
      },
    );

    console.log("📡 Plain text webhook sent");
  } catch (err) {
    console.error(
      "❌ Webhook text send failed:",
      err?.response?.data || err.message,
    );
  }
}

module.exports = forwardWebhookText;
