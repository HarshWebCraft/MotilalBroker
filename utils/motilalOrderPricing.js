const axios = require("axios");
const https = require("https");
const getHeaders = require("../GetHeader");
const { getProxyAgent } = require("../proxyRouter");

const agent = new https.Agent({ keepAlive: true });
const LTP_URL = "https://openapi.motilaloswal.com/rest/report/v3/getltpdata";
const TICK_SIZE = 0.05;

function roundToTick(price, side) {
  const ticks = price / TICK_SIZE;
  const rounded = side === "BUY" ? Math.ceil(ticks) : Math.floor(ticks);
  return Number((rounded * TICK_SIZE).toFixed(2));
}

async function getAggressiveLimitPrice({ cred, exchange, symboltoken, side }) {
  const accessToken = cred.auth_token;
  const apiSecret = cred.apisecretkey;
  if (!cred.auth_code || !accessToken || !apiSecret) {
    throw new Error(`Missing Motilal tokens for ${cred.client_id}`);
  }

  const proxyRoute = await getProxyAgent(cred.ip);
  const headers = getHeaders(
    cred.auth_code,
    cred.apiKey,
    cred.client_id,
    cred.ip,
    apiSecret,
    accessToken,
  );
  const response = await axios.post(
    LTP_URL,
    { clientcode: "", exchange, scripcode: Number(symboltoken) },
    {
      headers,
      httpsAgent: proxyRoute?.agent || agent,
      proxy: proxyRoute ? false : undefined,
    },
  );

  const data = response.data?.data;
  if (response.data?.status !== "SUCCESS" || !data) {
    throw new Error(response.data?.message || "Motilal LTP request failed");
  }

  // Motilal returns all quote prices in paisa.
  const ltp = Number(data.ltp) / 100;
  const bid = Number(data.bid) / 100;
  const ask = Number(data.ask) / 100;
  const basePrice = side === "BUY" ? ask || ltp : bid || ltp;
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    throw new Error(`Invalid LTP for ${exchange}:${symboltoken}`);
  }

  const percent = Number(process.env.MOTILAL_AGGRESSIVE_PRICE_PERCENT || 1);
  if (!Number.isFinite(percent) || percent < 0) {
    throw new Error("MOTILAL_AGGRESSIVE_PRICE_PERCENT must be zero or greater");
  }

  const multiplier = side === "BUY" ? 1 + percent / 100 : 1 - percent / 100;
  const price = roundToTick(basePrice * multiplier, side);

  return { ltp, bid, ask, basePrice, percent, price };
}

module.exports = { getAggressiveLimitPrice };
