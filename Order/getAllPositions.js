const mongoose = require("mongoose");
const ClientCredentials = mongoose.model("moCredentials");
const getHeaders = require("../GetHeader");
const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const https = require("https");

const agent = new https.Agent({ keepAlive: true });

const axiosInstance = axios.create({
  headers: { "Content-Type": "application/json" },
});

axiosRetry(axiosInstance, {
  retries: 3,
  retryDelay: () => 500,
  retryCondition: (error) =>
    axiosRetry.isNetworkOrIdempotentRequestError(error) ||
    error.code === "EAI_AGAIN" ||
    error.code === "ECONNREFUSED",
});

const getAllPositions = async (req, res) => {
  try {
    const { accounts } = req.body;

    // ✅ Validate input
    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
      return res.status(400).json({
        status: "ERROR",
        message: "accounts array is required",
        errorcode: "MO9001",
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
        errorcode: "MO9002",
        data: [],
      });
    }

    // ✅ Fetch positions in parallel
    const positionPromises = credentials.map(async (cred) => {
      try {
        const headers = getHeaders(
          cred.auth_token,
          cred.apiKey,
          cred.client_id,
        );

        const response = await axiosInstance.post(
          "https://openapi.motilaloswal.com/rest/book/v1/getposition",
          { clientcode: cred.client_id },
          { headers, httpsAgent: agent },
        );

        return {
          client_id: cred.client_id,
          status: response.data.status,
          message: response.data.message,
          positions: response.data.data || [],
        };
      } catch (error) {
        return {
          client_id: cred.client_id,
          status: "ERROR",
          message: error.response?.data?.message || error.message,
          positions: [],
        };
      }
    });

    const results = await Promise.all(positionPromises);

    return res.json({
      status: "SUCCESS",
      message: "Positions fetched successfully",
      data: results,
    });
  } catch (error) {
    console.error("Get Positions Error:", error.message);
    return res.status(500).json({
      status: "ERROR",
      message: error.message,
      errorcode: "MO9000",
      data: [],
    });
  }
};

module.exports = getAllPositions;
