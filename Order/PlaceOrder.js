const moCredentials = require("../models/moCredentials");

const getHeaders = require("../GetHeader");
const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const dns = require("dns");
const https = require("https");

const agent = new https.Agent({ keepAlive: true });

dns.setServers(["1.1.1.1", "8.8.8.8", "8.8.4.4"]); // Google DNS
dns.setDefaultResultOrder("ipv4first");

// Configure axios-retry
axiosRetry(axios, {
  retries: 3, // Retry up to 3 times
  retryDelay: (retryCount, error) => {
    console.log(
      `Retry attempt #${retryCount} for ${error?.config?.url} - reason: ${error?.message}`
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
        `Request failed for ${error?.config?.url}, will retry: ${error.message}`
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
      (id) => !credentials.find((cred) => cred.client_id === id)
    );
    if (missingClients.length > 0) {
      return res.status(400).json({
        status: "ERROR",
        message: `No credentials found for client IDs: ${missingClients.join(
          ", "
        )}`,
        errorcode: "MO8003",
      });
    }

    // Create parallel requests for each client
    const orderPromises = credentials.map(async (cred) => {
      const clientIndex = client_ids.indexOf(cred.client_id);
      const orderData = {
        clientcode: cred.client_id,
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
      };
      console.log("orderData", orderData);
      const headers = getHeaders(cred.auth_token, cred.apiKey, cred.client_id);

      try {
        const response = await axios.post(
          "https://openapi.motilaloswal.com/rest/trans/v1/placeorder",
          orderData,
          { headers, httpsAgent: agent }
        );
        return {
          client_id: cred.client_id,
          status: response.data.status,
          message: response.data.message,
          errorcode: response.data.errorcode || "",
          uniqueorderid: response.data.uniqueorderid || "",
        };
      } catch (error) {
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
