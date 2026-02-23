// controllers/motilalPlaceOrder.js
const moCredentials = require("../models/moCredentials");
const getHeaders = require("../GetHeader");
const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const dns = require("dns");
const https = require("https");
const agent = new https.Agent({ keepAlive: true });

const fs = require("fs");
const path = require("path");

// DNS tweak (as you had)
dns.setServers(["1.1.1.1", "8.8.8.8", "8.8.4.4"]);
dns.setDefaultResultOrder("ipv4first");

// Configure axios-retry (as you had)
axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount, error) => {
    console.log(
      `Retry attempt #${retryCount} for ${error?.config?.url} - reason: ${error?.message}`,
    );
    return 500;
  },
  retryCondition: (error) => {
    const shouldRetry =
      axiosRetry.isNetworkOrIdempotentRequestError(error) ||
      error.code === "EAI_AGAIN" ||
      (error.message && error.message.includes("getaddrinfo EAI_AGAIN"));

    if (shouldRetry) {
      console.log(
        `Request failed for ${error?.config?.url}, will retry: ${error.message}`,
      );
    }

    return shouldRetry;
  },
});

// ----------------------
// Motilal placeOrder Controller
// ----------------------
const placeOrder = async (req, res) => {
  try {
    // Required for Motilal order + additional fields for auto-strike
    const {
      client_ids,
      exchange,
      // symboltoken will be overridden by Jainam result
      buyorsell,
      producttype,
      orderduration,
      price,
      quantityinlot,
      ordertype,
      amoorder,
      closeOpenPostion,
      // Auto-strike required fields (Option A)
      symbol, // e.g. NIFTY
      expiry, // e.g. 09Dec2025 or ISO date
      gap, // strike gap e.g. 50
      close, // underlying close price e.g. 26000
      instrument, // "INDEX" or "STOCK" etc
      cepe, // "CE" or "PE"
      aio, // "ATM" or "ITM1" or "OTM2" etc
    } = req.body;

    console.log("req.body auto", req.body);

    const t1 = Date.now();

    // Basic validation
    if (!client_ids || !Array.isArray(client_ids) || client_ids.length === 0) {
      return res.status(400).json({
        status: "ERROR",
        message: "client_ids array is required and cannot be empty",
        errorcode: "MO8001",
      });
    }

    // Calculate strike price (same logic as your AngelOne flow)
    const gapNum = parseFloat(gap);
    if (isNaN(gapNum) || gapNum <= 0) {
      return res.status(400).json({
        status: "ERROR",
        message: "Invalid gap value",
        errorcode: "MO7004",
      });
    }

    const closePrice = parseFloat(close);
    if (isNaN(closePrice)) {
      return res.status(400).json({
        status: "ERROR",
        message: "Invalid close value",
        errorcode: "MO7005",
      });
    }

    if (closeOpenPostion === "YES") {
      console.log("Closing positions before placing new order...");

      const creds = await moCredentials
        .find({ client_id: { $in: client_ids } })
        .lean();

      const exitPromises = creds.map(async (cred) => {
        try {
          const headers = getHeaders(
            cred.auth_token,
            cred.apiKey,
            cred.client_id,
          );

          const positionResp = await axios.post(
            "https://openapi.motilaloswal.com/rest/book/v1/getposition",
            { clientcode: cred.client_id },
            { headers, httpsAgent: agent },
          );

          const positions = positionResp.data?.data || [];

          const openPositions = positions.filter(
            (p) => p.buyquantity !== p.sellquantity,
          );

          const targetUnderlying = String(req.body.symbol).toUpperCase().trim();

          const closePositionPromises = openPositions
            .filter((pos) => {
              if (!pos.symbol) return false;

              const posUnderlying = pos.symbol
                .toUpperCase()
                .split(" ")[0]
                .trim();

              return posUnderlying === targetUnderlying;
            })
            .map(async (pos) => {
              try {
                const netQty = pos.buyquantity - pos.sellquantity;
                const side = netQty > 0 ? "SELL" : "BUY";
                const qty = Math.abs(netQty);

                const payload = {
                  client_ids: [cred.client_id],
                  exchange: pos.exchange,
                  symboltoken: pos.symboltoken,
                  buyorsell: side,
                  ordertype: "MARKET",
                  producttype: pos.productname || "NORMAL",
                  orderduration: "DAY",
                  price: 0,
                  quantityinlot: [qty],
                  amoorder: "N",
                  tag: "AUTO-EXIT",
                };

                const resp = await axios.post(
                  `http://localhost:${process.env.PORT}/place-order`,
                  payload,
                );

                const r =
                  resp.data.find((x) => x.client_id === cred.client_id) || {};

                return {
                  client_id: cred.client_id,
                  status: r.status || "UNKNOWN",
                  message: r.message || "",
                  symbol: pos.symbol,
                  exitSide: side,
                  qty,
                };
              } catch (err) {
                return {
                  client_id: cred.client_id,
                  status: "ERROR",
                  message: err.message,
                  symbol: pos.symbol,
                };
              }
            });

          return Promise.all(closePositionPromises);
        } catch (err) {
          return [
            {
              client_id: cred.client_id,
              status: "ERROR",
              message: "Failed fetching position book",
            },
          ];
        }
      });

      const exitResultsNested = await Promise.all(exitPromises);

      const exitResults = exitResultsNested.flat();

      console.log("Exit Position Results:", exitResults);
    }

    const roundedClose = Math.round(closePrice / gapNum) * gapNum;
    let strikePrice = roundedClose;

    console.log("strikePrice", strikePrice);

    const aioMatch = aio.match(/(ITM|OTM)(\d+)|ATM/i);

    if (String(aio).toUpperCase() !== "ATM") {
      const [, type, digitStr] = aioMatch;
      const digit = parseInt(digitStr, 10) || 0;

      if (cepe === "CE") {
        strikePrice += (type.toUpperCase() === "ITM" ? -1 : 1) * gapNum * digit;
      } else {
        strikePrice += (type.toUpperCase() === "ITM" ? 1 : -1) * gapNum * digit;
      }
    }

    if (strikePrice <= 0) {
      return res.status(400).json({
        status: "ERROR",
        message: "Calculated strike price is invalid (≤ 0)",
        errorcode: "MO7006",
      });
    }

    function formatTradingSymbol(symbol, expiry, strikePrice, cepe, exchange) {
      const day = expiry.slice(0, 2);
      const mon = expiry.slice(2, 5).toUpperCase();
      const year = expiry.slice(7, 9);

      const formattedExpiry = `${day}${mon}${year}`;

      const formattedStrike =
        exchange === "MCX"
          ? Number(strikePrice)
          : Number(strikePrice).toFixed(2);

      return `${symbol}${formattedExpiry}${formattedStrike}${cepe}`;
    }

    function getTokenFromLocalJSON(tradingSymbol, exchange) {
      console.log("tradingSymbol, exchange", tradingSymbol, exchange);

      const fileMap = {
        NSEFO: "nse_fo.json",
        BSEFO: "bse_fo.json",
        MCX: "mcx_fo.json",
      };

      const fileName = fileMap[exchange.toUpperCase()];
      if (!fileName) {
        throw new Error(`Unsupported exchange: ${exchange}`);
      }

      const filePath = path.join(__dirname, "../data", fileName);

      if (!fs.existsSync(filePath)) {
        throw new Error(`Scrip master file not found: ${fileName}`);
      }

      const records = JSON.parse(fs.readFileSync(filePath, "utf8"));

      const match = records.find((r) => r.pTrdSymbol === tradingSymbol);

      if (!match) {
        throw new Error("No matching instrument found in local scrip master");
      }

      console.log("match", match);

      return match.pSymbol; // symboltoken
    }

    // Fetch Jainam token for final ExchangeInstrumentID
    // Build trading symbol
    const tradingSymbol = formatTradingSymbol(
      symbol,
      expiry,
      strikePrice,
      cepe,
      exchange,
    );

    console.log("Calculated Trading Symbol:", tradingSymbol);

    // Fetch token from local JSON
    let finaltoken;

    try {
      finaltoken = getTokenFromLocalJSON(tradingSymbol, exchange);
      req.body.tradingsymbol = tradingSymbol;
    } catch (err) {
      console.error("Local token fetch error:", err.message);

      const results = client_ids.map((cid) => ({
        client_id: cid,
        status: "ERROR",
        message: "Failed to fetch token from local scrip master",
        errorcode: "MO7003",
        uniqueorderid: "",
      }));

      return res.status(400).json({
        status: "ERROR",
        results,
      });
    }

    // ------------- Continue with original Motilal flow -------------
    // Fetch credentials for all client_ids
    const credentials = await moCredentials
      .find({ client_id: { $in: client_ids } })
      .lean();

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

      // Ensure quantityinlot can be mapped per client (if array) or single value
      let qty;
      if (Array.isArray(quantityinlot)) {
        qty = parseFloat(quantityinlot[clientIndex]);
      } else {
        qty = parseFloat(quantityinlot);
      }
      if (isNaN(qty) || qty <= 0) {
        return {
          client_id: cred.client_id,
          status: "ERROR",
          message: "Invalid quantityinlot for client",
          errorcode: "MO8004",
        };
      }

      const orderData = {
        clientcode: cred.client_id,
        exchange,
        // Use the overridden symboltoken
        symboltoken: parseInt(finaltoken),
        buyorsell,
        producttype,
        orderduration,
        ...(price !== undefined && price !== null
          ? { price: parseFloat(price) }
          : {}),
        quantityinlot: qty,
        ordertype,
        price: price ? price : 0,
        amoorder: "N",
      };

      console.log("orderData", orderData);
      const headers = getHeaders(cred.auth_token, cred.apiKey, cred.client_id);

      try {
        const response = await axios.post(
          "https://openapi.motilaloswal.com/rest/trans/v1/placeorder",
          orderData,
          { headers, httpsAgent: agent },
        );

        return {
          client_id: cred.client_id,
          status: response.data?.status || "UNKNOWN",
          message: response.data?.message || "",
          errorcode: response.data?.errorcode || "",
          uniqueorderid: response.data?.uniqueorderid || "",
        };
      } catch (error) {
        console.error(
          `Motilal order failed for client ${cred.client_id}:`,
          error?.message || error,
        );
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
    console.log("Place Order Responses:", JSON.stringify(results, null, 2));

    // Return consistent top-level object
    return res.status(200).json({
      status: "SUCCESS",
      results,
    });
  } catch (error) {
    console.error("Place Order Error:", error.message || error);
    return res.status(500).json({
      status: "ERROR",
      message: error.message || error,
      errorcode: "MO8000",
    });
  }
};

module.exports = placeOrder;
