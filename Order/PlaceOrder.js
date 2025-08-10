const mongoose = require("mongoose");
const moCredentials = require("../models/moCredentials");

const getHeaders = require("../GetHeader");
const axios = require("axios");

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
      const orderData = {
        clientcode: cred.client_id,
        exchange,
        symboltoken,
        buyorsell,
        producttype,
        orderduration,
        price,
        quantityinlot,
        ordertype,
        amoorder,
      };
      console.log("orderData", orderData);
      const headers = getHeaders(
        cred.auth_token,
        cred.apiKey,
        cred.client_id // Assuming vendorinfo is client_id
      );

      try {
        const response = await axios.post(
          "https://openapi.motilaloswal.com/rest/trans/v1/placeorder",
          orderData,
          { headers }
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
