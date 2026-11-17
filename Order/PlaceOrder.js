const moCredentials = require("../models/moCredentials");

const getHeaders = require("../GetHeader");
const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const dns = require("dns");
const https = require("https");
const { getProxyAgent } = require("../proxyRouter");
const { getAggressiveLimitPrice } = require("../utils/motilalOrderPricing");

const agent = new https.Agent({ keepAlive: true });
const PLACE_ORDER_URL =
  "https://openapi.motilaloswal.com/rest/trans/v2/placeorder";

function maskSecret(value) {
  if (!value) return "<missing>";
  const secret = String(value);
  if (secret.length <= 8) return "<redacted>";
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

function safeHeaders(headers) {
  return {
    ...headers,
    Authorization: maskSecret(headers.Authorization),
    accesstoken: maskSecret(headers.accesstoken),
    ApiKey: maskSecret(headers.ApiKey),
    apisecretkey: maskSecret(headers.apisecretkey),
  };
}

dns.setServers(["1.1.1.1", "8.8.8.8", "8.8.4.4"]); // Google DNS
dns.setDefaultResultOrder("ipv4first");

// Configure axios-retry
axiosRetry(axios, {
  retries: 3, // Retry up to 3 times
  retryDelay: (retryCount, error) => {
    console.log(
      `Retry attempt #${retryCount} for ${error?.config?.url} - reason: ${error?.message}`,
    );
    return 500; // wait 500ms between retries
  },
  retryCondition: (error) => {
    // Retry on network errors or specific error codes
    const shouldRetry =
      axiosRetry.isNetworkOrIdempotentRequestError(error) ||
      error.code === "EAI_AGAIN" ||
      error.message.includes("getaddrinfo EAI_AGAIN");

    if (shouldRetry) {
      console.log(
        `Request failed for ${error?.config?.url}, will retry: ${error.message}`,
      );
    }

    return shouldRetry;
  },
});

const placeOrder = async (req, res) => {
  try {
    const {
      client_ids,
      exchange,
      symboltoken,
      buyorsell,
      producttype,
      orderduration,
      price,
      quantityinlot,
      ordertype,
      amoorder,
    } = req.body;
    const t1 = Date.now();

    console.log("req.body", req.body);

    // Validate required fields
    if (!client_ids || !Array.isArray(client_ids) || client_ids.length === 0) {
      return res.status(400).json({
        status: "ERROR",
        message: "client_ids array is required and cannot be empty",
        errorcode: "MO8001",
      });
    }
    if (
      !exchange ||
      !symboltoken ||
      !buyorsell ||
      !producttype ||
      !orderduration ||
      !quantityinlot
    ) {
      return res.status(400).json({
        status: "ERROR",
        message: "Missing required order fields",
        errorcode: "MO8002",
      });
    }

    // Fetch credentials for all client_ids
    const credentials = await moCredentials
      .find({
        client_id: { $in: client_ids },
      })
      .lean();

    // Check if credentials were found for all client_ids
    const missingClients = client_ids.filter(
      (id) => !credentials.find((cred) => cred.client_id === id),
    );
    if (missingClients.length > 0) {
      return res.status(400).json({
        status: "ERROR",
        message: `No credentials found for client IDs: ${missingClients.join(
          ", ",
        )}`,
        errorcode: "MO8003",
      });
    }

    // Create parallel requests for each client
    const orderPromises = credentials.map(async (cred) => {
      const clientIndex = client_ids.indexOf(cred.client_id);
      const orderData = {
        clientcode: "",
        exchange,
        symboltoken,
        buyorsell,
        producttype,
        orderduration,
        ...(price !== undefined && price !== null
          ? { price: parseFloat(price) }
          : {}),
        quantityinlot: parseFloat(quantityinlot[clientIndex]),
        ordertype,
        amoorder,
        triggerprice: 0,
        disclosedquantity: 0,
        algoid: "",
        goodtilldate: "",
        tag: "XLAGO",
      };
      console.log("orderData", orderData);
      const accessToken = cred.auth_token;
      const apiSecret = cred.apisecretkey;
      if (!cred.auth_code || !accessToken || !apiSecret) {
        throw new Error(
          `Missing ${!cred.auth_code ? "auth_code" : !accessToken ? "auth_token" : "apisecretkey"} for ${cred.client_id}`,
        );
      }
      const headers = getHeaders(
        cred.auth_code,
        cred.apiKey,
        cred.client_id,
        cred.ip,
        apiSecret,
        accessToken,
      );

      try {
        const proxyRoute = await getProxyAgent(cred.ip);
        if (proxyRoute) {
          console.log(
            `[Motilal] placing ${cred.client_id} order via Server ${proxyRoute.serverNo} proxy for ${cred.ip}`,
          );
        }
        if (String(orderData.ordertype).toUpperCase() === "MARKET") {
          const quote = await getAggressiveLimitPrice({
            cred,
            exchange: orderData.exchange,
            symboltoken: orderData.symboltoken,
            side: String(orderData.buyorsell).toUpperCase(),
          });
          orderData.ordertype = "LIMIT";
          orderData.price = quote.price;
          console.log("Converted MARKET order to aggressive LIMIT:", quote);
        }
        console.log("Motilal place-order request:", {
          url: PLACE_ORDER_URL,
          headers: safeHeaders(headers),
          body: orderData,
        });
        const response = await axios.post(PLACE_ORDER_URL, orderData, {
          headers,
          httpsAgent: proxyRoute?.agent || agent,
          proxy: proxyRoute ? false : undefined,
        });
        return {
          client_id: cred.client_id,
          status: response.data.status,
          message: response.data.message,
          errorcode: response.data.errorcode || "",
          uniqueorderid: response.data.uniqueorderid || "",
        };
      } catch (error) {
        console.error("Motilal place-order failed:", {
          client_id: cred.client_id,
          status: error.response?.status,
          response: error.response?.data,
          message: error.message,
        });
        return {
          client_id: cred.client_id,
          status: "ERROR",
          message: error.response?.data?.message || error.message,
          errorcode: error.response?.data?.errorcode || "MO8000",
        };
      }
    });

    // Execute all requests in parallel
    const results = await Promise.all(orderPromises);
    const t2 = Date.now();
    const apiLatency = t2 - t1;
    console.log(`API latency (Motilal placeOrder) : ${apiLatency} ms`);
    // Log results
    console.log("Place Order Responses:", JSON.stringify(results, null, 2));

    res.json(results);
  } catch (error) {
    console.error("Place Order Error:", error.message);
    res.status(500).json({
      status: "ERROR",
      message: error.message,
      errorcode: "MO8000",
    });
  }
};

module.exports = placeOrder;
