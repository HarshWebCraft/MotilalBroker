const mongoose = require("mongoose");
const ClientCredentials = mongoose.model("moCredentials");
const getHeaders = require("../GetHeader");
const axios = require("axios");
const placeOrder = require("./PlaceOrder");
const parse = require("csv-parse/sync");

const axiosInstance = axios.create({
  timeout: 10000,
  headers: { "Content-Type": "application/json" },
});

async function getLotSize(symbol) {
  // Zerodha publishes contract master here:
  const url = "https://api.kite.trade/instruments";
  const resp = await axios.get(url);

  const records = parse.parse(resp.data, { columns: true });
  const result = records.find((r) => r.exchange_token == symbol);
  return result ? result.lot_size : "Symbol not found";
}

const exitPosition = async (req, res) => {
  try {
    const { client_ids, symbol, side, producttype, exchange, symboltoken } =
      req.body;

    // Validate required fields
    if (!client_ids || !Array.isArray(client_ids) || client_ids.length === 0) {
      return res.status(400).json({
        status: "ERROR",
        message: "client_ids array is required and cannot be empty",
        errorcode: "MO8001",
        closedPositions: [],
      });
    }
    console.log(client_ids);
    // Fetch credentials for all client_ids
    const credentials = await ClientCredentials.find({
      client_id: { $in: client_ids },
    }).lean();

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
        closedPositions: [],
      });
    }

    // Fetch position book for each client
    const positionBookPromises = credentials.map(async (cred) => {
      try {
        const headers = getHeaders(
          cred.auth_token,
          cred.apiKey,
          cred.client_id
        );
        const response = await axiosInstance.post(
          "https://openapi.motilaloswal.com/rest/book/v1/getposition",
          { clientcode: cred.client_id },
          { headers }
        );
        return {
          client_id: cred.client_id,
          auth_token: cred.auth_token,
          apiKey: cred.apiKey,
          positions: response.data?.data || [],
          status: response.data.status,
          message: response.data.message,
        };
      } catch (error) {
        console.error(
          `Error fetching position book for client_id: ${cred.client_id}: ${error.message}`
        );
        return {
          client_id: cred.client_id,
          positions: [],
          error: error.message,
        };
      }
    });

    const positionBookResults = await Promise.all(positionBookPromises);

    // Filter open positions based on symbol, side, and producttype
    const sellPositions = [];
    const buyPositions = [];
    positionBookResults.forEach((result) => {
      if (result.error || result.status !== "SUCCESS") return;

      const openPositions = result.positions.filter(
        (pos) => pos.buyquantity !== pos.sellquantity
      );

      openPositions.forEach((pos) => {
        const netQty = pos.buyquantity - pos.sellquantity;
        const positionSide = netQty > 0 ? "BUY" : "SELL";

        // Apply filters only if provided
        const symbolMatch = !symbol || pos.symbol === symbol;
        const symbolTokenMatch =
          !symboltoken || pos.symboltoken === symboltoken;
        const sideMatch = !side || positionSide === side.toUpperCase();
        const exchangeMatch =
          !exchange || pos.exchange === exchange.toUpperCase();
        const productTypeMatch =
          !producttype || pos.producttype === producttype;

        if (
          symbolMatch &&
          sideMatch &&
          productTypeMatch &&
          exchangeMatch &&
          symbolTokenMatch
        ) {
          const targetArray =
            positionSide === "SELL" ? sellPositions : buyPositions;
          targetArray.push({
            client_id: result.client_id,
            auth_token: result.auth_token,
            apiKey: result.apiKey,
            position: pos,
          });
        }
      });
    });

    // Combine positions: sell first, then buy
    const positionsToClose = [...sellPositions, ...buyPositions];

    if (!positionsToClose.length) {
      console.log(
        `No open positions to close for client_ids: ${JSON.stringify(
          client_ids
        )}, filters: ${JSON.stringify({ symbol, side, producttype })}`
      );
      return res.status(200).json({
        status: "SUCCESS",
        message: "No open positions found matching the criteria",
        closedPositions: [],
      });
    }

    // Close positions
    console.log(positionsToClose);
    const closePromises = positionsToClose.map(
      async ({ client_id, position }) => {
        const netQty = position.buyquantity - position.sellquantity;
        const orderSide = netQty > 0 ? "SELL" : "BUY";
        const quantity = Math.abs(netQty);
        const lotSize = await getLotSize(position.symboltoken);
        const lotsToClose = quantity / lotSize;

        const payload = {
          client_ids: [client_id],
          exchange: position.exchange,
          symboltoken: position.symboltoken,
          buyorsell: orderSide,
          ordertype: "MARKET",
          producttype: position.productname || "NORMAL",
          orderduration: "DAY",
          price: 0.0,
          quantityinlot: lotsToClose,
          amoorder: "N",
          tag: `CLOSE`,
        };
        console.log(payload);

        try {
          const response = await axiosInstance.post(
            `http://localhost:${process.env.PORT}/place-order`,
            payload
          );
          const orderResult = response.data.find(
            (r) => r.client_id === client_id
          ) || {
            status: "ERROR",
            message: "No response for client_id",
            errorcode: "MO8004",
          };
          console.log(orderResult);
          return {
            client_id,
            symbol: position.symbol,
            symboltoken: position.symboltoken,
            status: orderResult.status,
            message: orderResult.message,
            orderSide,
            quantity,
            errorcode: orderResult.errorcode || "",
          };
        } catch (error) {
          return {
            client_id,
            symbol: position.symbol,
            symboltoken: position.symboltoken,
            status: "ERROR",
            message: error.response?.data?.message || error.message,
            orderSide,
            quantity,
            errorcode: error.response?.data?.errorcode || "MO8000",
          };
        }
      }
    );

    // Execute all close requests in parallel
    const closedPositions = await Promise.all(closePromises);
    // console.log(closedPositions);
    // Log results
    const successfulCloses = closedPositions.filter(
      (result) => result.status === "SUCCESS"
    );
    console.log(
      `Closed ${successfulCloses.length} out of ${
        positionsToClose.length
      } open positions for client_ids: ${JSON.stringify(client_ids)}`
    );

    res.json({
      status: successfulCloses.length > 0 ? "SUCCESS" : "ERROR",
      message: `Closed ${successfulCloses.length} out of ${positionsToClose.length} open positions`,
      closedPositions,
    });
  } catch (error) {
    console.error("Close Order Error:", error.message);
    res.status(500).json({
      status: "ERROR",
      message: error.message,
      errorcode: "MO8000",
      closedPositions: [],
    });
  }
};

module.exports = exitPosition;
