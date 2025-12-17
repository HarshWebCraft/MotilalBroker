const mongoose = require("mongoose");
const moCredentials = require("../models/moCredentials");
const getHeaders = require("../GetHeader");
const axios = require("axios");

const axiosInstance = axios.create({
  timeout: 10000,
  headers: { "Content-Type": "application/json" },
});

const CancelOrder = async (req, res) => {
  try {
    const { client_ids, symbol, side, producttype, exchange } = req.body;

    // Validate required fields
    if (!client_ids || !Array.isArray(client_ids) || client_ids.length === 0) {
      return res.status(400).json({
        status: "ERROR",
        message: "client_ids array is required and cannot be empty",
        errorcode: "MO8001",
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

    // Fetch order book for each client
    const orderBookPromises = credentials.map(async (cred) => {
      try {
        const headers = getHeaders(
          cred.auth_token,
          cred.apiKey,
          cred.client_id
        );
        const response = await axiosInstance.post(
          "https://openapi.motilaloswal.com/rest/book/v2/getorderbook",
          {},
          { headers }
        );
        return {
          client_id: cred.client_id,
          orders: response.data?.data || [],
        };
      } catch (error) {
        console.error(
          `Error fetching order book for client_id: ${cred.client_id}: ${error.message}`
        );
        return { client_id: cred.client_id, orders: [], error: error.message };
      }
    });

    const orderBookResults = await Promise.all(orderBookPromises);
    console.log("Order book:", JSON.stringify(orderBookResults, null, 2));

    // Filter open or pending orders based on symbol, symboltoken, side, and producttype
    const ordersToCancel = [];
    orderBookResults.forEach((result) => {
      if (result.error) return;
      const openOrPendingOrders = result.orders.filter(
        (order) => order.orderstatus.toLowerCase() == "confirm"
      );
      console.log(openOrPendingOrders);
      openOrPendingOrders.forEach((order) => {
        // Apply filters only if provided
        const symbolMatch = !symbol || order.symbol === symbol;
        // const symbolTokenMatch =
        //   !symboltoken || order.symboltoken === symboltoken;
        const sideMatch =
          !side || order.buyorsell.toUpperCase() === side.toUpperCase();
        const productTypeMatch =
          !producttype || order.producttype === producttype;
        const exchangeMatch = !exchange || order.exchange === exchange;

        if (symbolMatch && sideMatch && productTypeMatch && exchangeMatch) {
          ordersToCancel.push({
            client_id: result.client_id,
            uniqueorderid: order.uniqueorderid,
            symbol: order.symbol,
            // symboltoken: order.symboltoken,
            buyorsell: order.buyorsell,
            producttype: order.producttype,
          });
        }
      });
    });
    console.log("Orders to cancel:", JSON.stringify(ordersToCancel, null, 2));

    if (!ordersToCancel.length) {
      const response = client_ids.map((client_id) => ({
        client_id,
        status: "SUCCESS",
        message: "No open or pending orders to cancel",
        errorcode: "",
      }));

      return res.status(200).json({
        status: "SUCCESS",
        message: "No open or pending orders to cancel",
        response,
      });
    }

    // Create parallel cancel requests for each client and order ID
    const cancelPromises = ordersToCancel.map(
      async ({
        client_id,
        uniqueorderid,
        symbol,
        // symboltoken,
        buyorsell,
        producttype,
      }) => {
        const cred = credentials.find((c) => c.client_id === client_id);
        if (!cred) {
          return {
            client_id,
            uniqueorderid,
            symbol,
            // symboltoken,
            buyorsell,
            producttype,
            status: "ERROR",
            message: `No credentials found for client ID: ${client_id}`,
            errorcode: "MO8003",
          };
        }

        const cancelData = {
          clientcode: cred.client_id,
          uniqueorderid,
        };

        const headers = getHeaders(
          cred.auth_token,
          cred.apiKey,
          cred.client_id
        );

        try {
          const response = await axiosInstance.post(
            "https://openapi.motilaloswal.com/rest/trans/v1/cancelorder",
            cancelData,
            { headers }
          );
          return {
            client_id: cred.client_id,
            uniqueorderid,
            symbol,
            // symboltoken,
            buyorsell,
            producttype,
            status: response.data.status,
            message: response.data.message,
            errorcode: response.data.errorcode || "",
          };
        } catch (error) {
          return {
            client_id: cred.client_id,
            uniqueorderid,
            symbol,
            // symboltoken,
            buyorsell,
            producttype,
            status: "ERROR",
            message: error.response?.data?.message || error.message,
            errorcode: error.response?.data?.errorcode || "MO8000",
          };
        }
      }
    );

    // Execute all requests in parallel
    const results = await Promise.all(cancelPromises);

    // Log results
    console.log("Cancel Order Responses:", JSON.stringify(results, null, 2));

    res.json(results);
  } catch (error) {
    console.error("Cancel Order Error:", error.message);
    res.status(500).json({
      status: "ERROR",
      message: error.message,
      errorcode: "MO8000",
    });
  }
};

module.exports = CancelOrder;
