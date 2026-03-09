const mongoose = require("mongoose");
const ClientCredentials = mongoose.model("moCredentials");
const getHeaders = require("../GetHeader");
const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const https = require("https");

const agent = new https.Agent({ keepAlive: true });

const axiosInstance = axios.create({
  headers: { "Content-Type": "application/json" },
  timeout: 10000,
});

axiosRetry(axiosInstance, {
  retries: 3,
  retryDelay: () => 500,
  retryCondition: (error) =>
    axiosRetry.isNetworkOrIdempotentRequestError(error) ||
    error.code === "EAI_AGAIN" ||
    error.code === "ECONNREFUSED",
});

const getAllOrders = async (req, res) => {
  try {
    const { accounts } = req.body;

    // ✅ Validate input
    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
      return res.status(400).json({
        status: "ERROR",
        message: "accounts array is required",
        errorcode: "MO9101",
        data: [],
      });
    }

    // ✅ Fetch credentials
    const credentials = await ClientCredentials.find({
      client_id: { $in: accounts },
    }).lean();

    const missingAccounts = accounts.filter(
      (id) => !credentials.find((c) => c.client_id === id),
    );

    if (missingAccounts.length > 0) {
      return res.status(400).json({
        status: "ERROR",
        message: `No credentials found for: ${missingAccounts.join(", ")}`,
        errorcode: "MO9102",
        data: [],
      });
    }

    // ✅ Fetch orderbook in parallel
    const orderPromises = credentials.map(async (cred) => {
      try {
        const headers = getHeaders(
          cred.auth_token,
          cred.apiKey,
          cred.client_id,
        );

        const response = await axiosInstance.post(
          "https://openapi.motilaloswal.com/rest/book/v2/getorderbook",
          {},
          { headers, httpsAgent: agent },
        );

        const allOrders = response.data?.data || [];

        // ✅ Filter running / pending orders
        const runningOrders = allOrders.filter((order) => {
          const status = order.orderstatus?.toLowerCase();
          return (
            status === "confirm" || status === "open" || status === "pending"
          );
        });

        return {
          client_id: cred.client_id,
          status: response.data.status,
          message: response.data.message,
          orders: runningOrders,
        };
      } catch (error) {
        return {
          client_id: cred.client_id,
          status: "ERROR",
          message: error.response?.data?.message || error.message,
          orders: [],
        };
      }
    });

    const results = await Promise.all(orderPromises);

    return res.json({
      status: "SUCCESS",
      message: "Orders fetched successfully",
      data: results,
    });
  } catch (error) {
    console.error("Get Orders Error:", error.message);

    return res.status(500).json({
      status: "ERROR",
      message: error.message,
      errorcode: "MO9100",
      data: [],
    });
  }
};

module.exports = getAllOrders;
