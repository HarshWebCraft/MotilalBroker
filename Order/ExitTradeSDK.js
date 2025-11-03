const MOFSLOPENAPI = require("./MOFSLOPENAPI_NodejsV2.3");
const axios = require("axios");
const parse = require("csv-parse/sync");

/**
 * Utility function to get lot size for a given symbol token from Zerodha's instrument list
 */
async function getLotSize(symbolToken) {
  try {
    const url = "https://api.kite.trade/instruments";
    const resp = await axios.get(url);
    const records = parse.parse(resp.data, { columns: true });
    const result = records.find((r) => r.exchange_token == symbolToken);
    return result ? parseInt(result.lot_size, 10) : 1;
  } catch (err) {
    console.error("Lot size fetch failed:", err.message);
    return 1;
  }
}

/**
 * Function to exit open positions for multiple clients.
 * @param {Object} params - Parameters for exit
 * @param {Array<string>} params.client_ids - List of client IDs
 * @param {string} [params.symbol] - Optional symbol filter
 * @param {string} [params.side] - Optional BUY/SELL filter
 * @param {string} [params.producttype] - Optional product type filter
 * @param {string} [params.exchange] - Optional exchange filter
 * @param {string} [params.symboltoken] - Optional symbol token filter
 * @returns {Promise<Object>} - Summary result
 */
async function ExitPositionSDK(params) {
  try {
    const { client_ids, symbol, side, producttype, exchange, symboltoken } =
      params;

    if (!client_ids || !Array.isArray(client_ids) || client_ids.length === 0) {
      return {
        status: "ERROR",
        message: "client_ids array is required and cannot be empty",
        errorcode: "MO8001",
        closedPositions: [],
      };
    }

    console.log("Fetching positions for clients:", client_ids);

    // Fetch position book for each client
    const positionPromises = client_ids.map(async (client_id) => {
      try {
        const posResponse = await MOFSLOPENAPI.GetPositionBook({
          clientcode: client_id,
        });

        if (!posResponse || posResponse.status !== "SUCCESS") {
          return { client_id, positions: [], error: posResponse?.message };
        }

        return {
          client_id,
          positions: posResponse.data || [],
        };
      } catch (error) {
        console.error(
          `Error fetching position for ${client_id}:`,
          error.message
        );
        return { client_id, positions: [], error: error.message };
      }
    });

    const positionResults = await Promise.all(positionPromises);

    // Filter open positions based on provided filters
    const positionsToClose = [];
    for (const result of positionResults) {
      if (result.error) continue;

      const openPositions = result.positions.filter(
        (pos) => pos.buyquantity !== pos.sellquantity
      );

      for (const pos of openPositions) {
        const netQty = pos.buyquantity - pos.sellquantity;
        const posSide = netQty > 0 ? "BUY" : "SELL";

        const filtersMatch =
          (!symbol || pos.symbol === symbol) &&
          (!symboltoken || pos.symboltoken === symboltoken) &&
          (!side || posSide === side.toUpperCase()) &&
          (!exchange || pos.exchange === exchange.toUpperCase()) &&
          (!producttype || pos.producttype === producttype);

        if (filtersMatch) {
          positionsToClose.push({
            client_id: result.client_id,
            position: pos,
            orderSide: netQty > 0 ? "SELL" : "BUY",
            quantity: Math.abs(netQty),
          });
        }
      }
    }

    if (positionsToClose.length === 0) {
      return {
        status: "SUCCESS",
        message: "No open positions found matching criteria",
        closedPositions: [],
      };
    }

    console.log("Positions to close:", positionsToClose.length);

    // Execute close orders concurrently
    const closePromises = positionsToClose.map(async (posObj) => {
      const { client_id, position, orderSide, quantity } = posObj;
      try {
        const lotSize = await getLotSize(position.symboltoken);
        const lotsToClose = Math.ceil(quantity / lotSize);

        const orderPayload = {
          clientcode: client_id,
          exchange: position.exchange,
          symboltoken: position.symboltoken,
          buyorsell: orderSide,
          ordertype: "MARKET",
          producttype: position.productname || "NORMAL",
          orderduration: "DAY",
          price: 0,
          quantityinlot: lotsToClose,
          amoorder: "N",
          tag: "EXIT",
        };

        const orderResp = await MOFSLOPENAPI.PlaceOrder(orderPayload);

        if (orderResp && orderResp.status === "SUCCESS") {
          return {
            client_id,
            symbol: position.symbol,
            symboltoken: position.symboltoken,
            status: "SUCCESS",
            message: orderResp.message,
            orderSide,
            quantity,
          };
        } else {
          return {
            client_id,
            symbol: position.symbol,
            symboltoken: position.symboltoken,
            status: "ERROR",
            message: orderResp?.message || "Unknown error",
            orderSide,
            quantity,
          };
        }
      } catch (err) {
        console.error(`Error closing position for ${client_id}:`, err.message);
        return {
          client_id,
          symbol: position.symbol,
          symboltoken: position.symboltoken,
          status: "ERROR",
          message: err.message,
          orderSide,
          quantity,
        };
      }
    });

    const closedPositions = await Promise.all(closePromises);

    const successCount = closedPositions.filter(
      (p) => p.status === "SUCCESS"
    ).length;

    return {
      status: successCount > 0 ? "SUCCESS" : "ERROR",
      message: `Closed ${successCount} out of ${closedPositions.length} open positions`,
      closedPositions,
    };
  } catch (err) {
    console.error("ExitPosition Fatal Error:", err.message);
    return {
      status: "ERROR",
      message: err.message,
      errorcode: "MO8000",
      closedPositions: [],
    };
  }
}

module.exports = ExitPositionSDK;
