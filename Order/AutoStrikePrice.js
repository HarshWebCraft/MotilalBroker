// controllers/motilalPlaceOrder.js
const moCredentials = require("../models/moCredentials");
const getHeaders = require("../GetHeader");
const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const dns = require("dns");
const https = require("https");
const agent = new https.Agent({ keepAlive: true });

// DNS tweak (as you had)
dns.setServers(["1.1.1.1", "8.8.8.8", "8.8.4.4"]);
dns.setDefaultResultOrder("ipv4first");

// Configure axios-retry (as you had)
axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount, error) => {
    console.log(
      `Retry attempt #${retryCount} for ${error?.config?.url} - reason: ${error?.message}`
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
        `Request failed for ${error?.config?.url}, will retry: ${error.message}`
      );
    }

    return shouldRetry;
  },
});

// ----------------------
// JAINAM TOKEN HELPERS
// ----------------------
function mapExchangeAndSeries(exchange, instrument) {
  // exchange expected like "NFO", "BFO", "MCX"
  if (exchange === "NFO") {
    if (instrument === "INDEX") return { exchangeSegment: 2, series: "OPTIDX" };
    return { exchangeSegment: 2, series: "OPTSTK" };
  }
  if (exchange === "BFO") {
    if (instrument === "INDEX") return { exchangeSegment: 12, series: "IO" };
    return { exchangeSegment: 12, series: "SO" };
  }
  if (exchange === "MCX") {
    return { exchangeSegment: 51, series: "OPTFUT" };
  }
  throw new Error(`Unsupported exchange: ${exchange}`);
}

function formatExpiry(raw) {
  if (!raw) return raw;
  raw = String(raw).trim();
  // If already in 09Dec2025 format
  if (/^\d{2}[A-Z][a-z]{2}\d{4}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (isNaN(d)) return raw;
  const day = String(d.getDate()).padStart(2, "0");
  const year = d.getFullYear();
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const mon = monthNames[d.getMonth()];
  return `${day}${mon}${year}`;
}

async function getJainamToken(
  symbol,
  expiry,
  strikePrice,
  optionType,
  exchange,
  instrument
) {
  const { exchangeSegment, series } = mapExchangeAndSeries(
    exchange,
    instrument
  );
  const formattedExpiry = formatExpiry(expiry);

  const url =
    `https://developers.symphonyfintech.in/apimarketdata/instruments/instrument/optionSymbol` +
    `?exchangeSegment=${exchangeSegment}` +
    `&series=${series}` +
    `&symbol=${encodeURIComponent(symbol)}` +
    `&expiryDate=${formattedExpiry}` +
    `&optionType=${optionType}` +
    `&strikePrice=${strikePrice}`;

  const res = await axios.get(url);
  // Expected shape: { type:'success', result: [ { ExchangeInstrumentID, Description, ... } ] }
  const item = res.data?.result?.[0];
  if (!item) {
    // include some debug info if available
    const dbg = res.data || {};
    const msg = `No matching instrument found from Jainam: ${JSON.stringify(
      dbg
    )}`;
    const e = new Error(msg);
    e._jainamResponse = dbg;
    throw e;
  }
  return item; // full object returned
}

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

    const t1 = Date.now();

    // Basic validation
    if (!client_ids || !Array.isArray(client_ids) || client_ids.length === 0) {
      return res.status(400).json({
        status: "ERROR",
        message: "client_ids array is required and cannot be empty",
        errorcode: "MO8001",
      });
    }

    // Validate Motilal required fields
    if (
      !exchange ||
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

    // Validate auto-strike fields (Option A)
    if (
      !symbol ||
      !expiry ||
      gap === undefined ||
      close === undefined ||
      !instrument ||
      !cepe ||
      !aio
    ) {
      return res.status(400).json({
        status: "ERROR",
        message:
          "Missing fields for strike price & token generation. Required: symbol, expiry, gap, close, instrument, cepe, aio",
        errorcode: "MO7001",
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

    if (closeOpenPostion) {
      console.log("Closing positions before placing new order...");

      const exitResults = [];

      // Fetch credentials first (already done later in code, so reuse the query)
      const creds = await moCredentials
        .find({ client_id: { $in: client_ids } })
        .lean();

      for (const cred of creds) {
        const headers = getHeaders(
          cred.auth_token,
          cred.apiKey,
          cred.client_id
        );

        // 1. Fetch user position book
        let positionResp;
        try {
          positionResp = await axios.post(
            "https://openapi.motilaloswal.com/rest/book/v1/getposition",
            { clientcode: cred.client_id },
            { headers, httpsAgent: agent }
          );
        } catch (err) {
          exitResults.push({
            client_id: cred.client_id,
            status: "ERROR",
            message: "Failed fetching position book",
          });
          continue;
        }

        const positions = positionResp.data?.data || [];
        const openPositions = positions.filter(
          (p) => p.buyquantity !== p.sellquantity
        );

        // 2. Loop open positions → close symbol match
        for (const pos of openPositions) {
          if (
            !req.body.tradingsymbol ||
            !req.body.tradingsymbol.includes(pos.symbol)
          ) {
            continue; // skip non-matching symbols
          }

          const netQty = pos.buyquantity - pos.sellquantity;
          const side = netQty > 0 ? "SELL" : "BUY";
          const qty = Math.abs(netQty);

          // Get lot size (same as exit file)
          let lotSize = 1;
          try {
            const kiteResp = await axios.get(
              "https://api.kite.trade/instruments"
            );
            const csv = require("csv-parse/sync").parse;
            const rec = csv(kiteResp.data, { columns: true });
            const row = rec.find((r) => r.exchange_token == pos.symboltoken);
            lotSize = row ? Number(row.lot_size) : 1;
          } catch (err) {
            console.log("Lot-size lookup failed, using 1");
          }

          const lots = qty / lotSize;

          const payload = {
            client_ids: [cred.client_id],
            exchange: pos.exchange,
            symboltoken: pos.symboltoken,
            buyorsell: side,
            ordertype: "MARKET",
            producttype: pos.productname || "NORMAL",
            orderduration: "DAY",
            price: 0,
            quantityinlot: [lots],
            amoorder: "N",
            tag: "AUTO-EXIT",
          };

          // 3. Place exit order
          try {
            const resp = await axios.post(
              `http://localhost:${process.env.PORT}/place-order`,
              payload
            );

            const r =
              resp.data.find((x) => x.client_id === cred.client_id) || {};

            exitResults.push({
              client_id: cred.client_id,
              status: r.status || "UNKNOWN",
              message: r.message || "",
              symbol: pos.symbol,
              exitSide: side,
              qty,
            });
          } catch (err) {
            exitResults.push({
              client_id: cred.client_id,
              status: "ERROR",
              message: err.message,
              symbol: pos.symbol,
            });
          }
        }
      }

      console.log("Exit Position Results:", exitResults);
    }

    const roundedClose = Math.round(closePrice / gapNum) * gapNum;
    let strikePrice = roundedClose;

    const aioMatch = String(aio).match(/(ITM|OTM)(\d+)|^ATM$/i);
    if (!aioMatch) {
      return res.status(400).json({
        status: "ERROR",
        message: "Invalid AIO value. Use ATM, ITM1, OTM3, etc.",
        errorcode: "MO7002",
      });
    }

    if (String(aio).toUpperCase() !== "ATM") {
      const [, type, digitStr] = aioMatch;
      const digit = parseInt(digitStr, 10) || 0;
      if (type && type.toUpperCase() === "ITM") strikePrice -= gapNum * digit;
      else if (type && type.toUpperCase() === "OTM")
        strikePrice += gapNum * digit;
    }

    if (strikePrice <= 0) {
      return res.status(400).json({
        status: "ERROR",
        message: "Calculated strike price is invalid (≤ 0)",
        errorcode: "MO7006",
      });
    }

    // Fetch Jainam token for final ExchangeInstrumentID
    let jainamItem;
    try {
      jainamItem = await getJainamToken(
        symbol,
        expiry,
        strikePrice,
        cepe, // CE / PE
        exchange, // NFO / BFO / MCX
        instrument // INDEX / STOCK
      );

      console.log("Jainam matched item:", jainamItem);
    } catch (err) {
      console.error("Jainam token fetch error:", err.message || err);
      // Build per-client error results (consistent shape)
      const results = client_ids.map((cid) => ({
        client_id: cid,
        status: "ERROR",
        message: "Failed to fetch token from Jainam",
        errorcode: "MO7003",
        uniqueorderid: "",
      }));
      return res.status(400).json({
        status: "ERROR",
        results,
      });
    }

    // Override symboltoken and optionally set tradingsymbol
    // jainamItem.ExchangeInstrumentID is the token, Description or DisplayName can be used for tradingsymbol
    const finaltoken = String(jainamItem.ExchangeInstrumentID);
    req.body.tradingsymbol =
      jainamItem.Description || jainamItem.DisplayName || jainamItem.Name || "";

    // ------------- Continue with original Motilal flow -------------
    // Fetch credentials for all client_ids
    const credentials = await moCredentials
      .find({ client_id: { $in: client_ids } })
      .lean();

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
        symboltoken: finaltoken,
        buyorsell,
        producttype,
        orderduration,
        ...(price !== undefined && price !== null
          ? { price: parseFloat(price) }
          : {}),
        quantityinlot: qty,
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
          status: response.data?.status || "UNKNOWN",
          message: response.data?.message || "",
          errorcode: response.data?.errorcode || "",
          uniqueorderid: response.data?.uniqueorderid || "",
        };
      } catch (error) {
        console.error(
          `Motilal order failed for client ${cred.client_id}:`,
          error?.message || error
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
