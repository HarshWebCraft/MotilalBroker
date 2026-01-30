const axios = require("axios");
const getHeaders = require("../GetHeader");
const moCredentials = require("../models/moCredentials");

const cancelSingleOrder = async (req, res) => {
  try {
    const { clientcodes } = req.body;

    if (!Array.isArray(clientcodes) || clientcodes.length === 0) {
      return res.status(400).json({
        status: "ERROR",
        message: "clientcodes must be a non-empty array",
      });
    }

    console.log("--", req.body);

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

          const cancelData = {
            clientcode: cred.client_id,
            uniqueorderid: req.body.uniqueorderid,
          };

          console.log("cancelData", cancelData);

          await axios.post(
            "https://openapi.motilaloswal.com/rest/trans/v1/cancelorder",
            {
              clientcode: cred.client_id,
              uniqueorderid: req.body.uniqueorderid,
            },
            { headers },
          );

          console.log("==", response.data);

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

module.exports = cancelSingleOrder;
