const axios = require("axios");
const getHeaders = require("../GetHeader");
const moCredentials = require("../models/moCredentials");

const TradeBook = async (req, res) => {
  try {
    const { clientcodes } = req.body;

    if (!Array.isArray(clientcodes) || clientcodes.length === 0) {
      return res.status(400).json({
        status: "ERROR",
        message: "clientcodes must be a non-empty array",
      });
    }

    const results = await Promise.all(
      clientcodes.map(async (clientcode) => {
        try {
          const cred = await moCredentials
            .findOne({ client_id: clientcode })
            .lean();

          if (!cred) {
            return {
              clientcode,
              status: "ERROR",
              message: "Client not found",
            };
          }

          const headers = getHeaders(
            cred.auth_token,
            cred.apiKey,
            cred.client_id,
          );

          const response = await axios.post(
            "https://openapi.motilaloswal.com/rest/book/v2/getorderbook",
            {},
            { headers },
          );

          return {
            clientcode,
            status: "SUCCESS",
            data: response.data,
          };
        } catch (err) {
          return {
            clientcode,
            status: "ERROR",
            message: err.response?.data?.message || err.message,
            errorcode: err.response?.data?.errorcode || "MO8000",
          };
        }
      }),
    );

    res.json({
      status: "SUCCESS",
      results,
    });
  } catch (error) {
    res.status(500).json({
      status: "ERROR",
      message: error.message,
    });
  }
};

module.exports = TradeBook;
