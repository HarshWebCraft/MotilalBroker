// placeOrderSDK.js

const moCredentials = require("../models/moCredentials");
const getHeaders = require("../GetHeader"); // Optional now, but kept for fallback
const dns = require("dns");
const https = require("https");
const axiosRetry = require("axios-retry").default;
const axios = require("axios");
const MOFSLOPENAPI = require("../sdk/MOFSLOPENAPI_NodejsV2.3"); // official SDK
const macaddress = require("macaddress"); // For real MAC fetch
const publicIp = require("public-ip"); // For real public IP fetch
const os = require("os"); // For local IP

// ---- Setup DNS and HTTPS keep-alive agent ----
const agent = new https.Agent({ keepAlive: true });
dns.setServers(["1.1.1.1", "8.8.8.8", "8.8.4.4"]);
dns.setDefaultResultOrder("ipv4first");

// ---- Configure axios retry globally ----
axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount, error) => {
    console.log(
      `Retry #${retryCount} for ${error?.config?.url} - reason: ${error?.message}`
    );
    return 500;
  },
  retryCondition: (error) =>
    axiosRetry.isNetworkOrIdempotentRequestError(error) ||
    error.code === "EAI_AGAIN" ||
    error.message.includes("getaddrinfo EAI_AGAIN"),
});

// ---- Async init promises (no top-level await) ----
const macPromise = new Promise((resolve, reject) => {
  macaddress.one((err, m) => {
    if (err) {
      console.error("MAC fetch failed:", err);
      reject(err);
    } else {
      resolve(m);
    }
  });
});

const publicIpPromise = publicIp.v4().catch((err) => {
  console.error("Public IP fetch failed:", err);
  return "1.2.3.4"; // fallback
});

const getLocalIp = () => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
};

// ---- Main placeOrder using official MO SDK ----
const PlaceOrderSDK = async (req, res) => {
  try {
    // Fetch shared values once per request (cached after first)
    const mac = await macPromise;
    const publicIpAddr = await publicIpPromise;
    const localIp = getLocalIp();
    console.log("MAC:", mac);
    console.log("Public IP:", publicIpAddr);
    console.log("Local IP:", localIp);

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
    const start = Date.now();
    const Base_Url = "https://openapi.motilaloswal.com";

    // --- Basic validation ---
    if (!Array.isArray(client_ids) || client_ids.length === 0) {
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
      !quantityinlot ||
      !Array.isArray(quantityinlot) ||
      quantityinlot.length !== client_ids.length
    ) {
      return res.status(400).json({
        status: "ERROR",
        message: "Missing required order fields or quantityinlot mismatch",
        errorcode: "MO8002",
      });
    }

    // --- Fetch client credentials ---
    const credentials = await moCredentials
      .find({ client_id: { $in: client_ids } })
      .lean();

    const missing = client_ids.filter(
      (id) => !credentials.find((c) => c.client_id === id)
    );
    if (missing.length > 0) {
      return res.status(400).json({
        status: "ERROR",
        message: `No credentials found for client IDs: ${missing.join(", ")}`,
        errorcode: "MO8003",
      });
    }

    // ---- Run SDK calls concurrently ----
    const orderPromises = credentials.map(async (cred) => {
      const clientIndex = client_ids.indexOf(cred.client_id);
      const orderData = {
        clientcode: cred.client_id,
        exchange,
        symboltoken,
        buyorsell,
        producttype,
        orderduration,
        ...(price ? { price: parseFloat(price) } : {}),
        quantityinlot: parseFloat(quantityinlot[clientIndex]),
        ordertype,
        amoorder,
      };

      console.log("orderData", orderData);

      let mo;
      try {
        // Initialize SDK
        const sourceType = cred.auth_token?.endsWith("_M") ? "MOB" : "WEB"; // match token suffix
        mo = new MOFSLOPENAPI(
          cred.apiKey,
          "https://openapi.motilaloswal.com",
          sourceType,
          "Chrome",
          "14"
        );

        mo.m_ApiSecretkey = cred.apiSecret;
        mo.m_strClientLocalIP = localIp;
        mo.m_strMACAddress = mac;
        mo.setClientPublicIp(publicIpAddr);

        // ---- Refresh token if missing or invalid ----
        if (cred.auth_token || cred.auth_token.length < 10) {
          console.log(`Refreshing token for ${cred.client_id}...`);

          const loginResp = await mo.Login(
            cred.client_id,
            cred.password || "harshdv007",
            "26/01/2005",
            "",
            cred.totp || "TC5LKDC6JDCK4HTRS5NQZ65ZRHN6KXSO" // if you have 2FA/TOTP
          );

          if (
            loginResp &&
            loginResp.status === "SUCCESS" &&
            loginResp.AuthToken
          ) {
            cred.auth_token = loginResp.AuthToken;
            await moCredentials.updateOne(
              { client_id: cred.client_id },
              { $set: { auth_token: loginResp.AuthToken } }
            );
            console.log(`Token refreshed for ${cred.client_id}`);
          } else {
            throw new Error(
              `Failed to refresh token for ${cred.client_id}: ${
                loginResp?.message || "unknown error"
              }`
            );
          }
        }

        // ---- Use the valid token ----
        mo.SetAuthToken(cred.auth_token);
        if (mo.InitHeader) mo.InitHeader();

        console.log(`Auth token set for ${cred.client_id}`);

        // ---- Place Order ----
        const response = await mo.PlaceOrder(orderData);
        console.log("Order Response:", response);

        return {
          client_id: cred.client_id,
          status: response?.status || "SUCCESS",
          message: response?.message || "Order placed",
          errorcode: response?.errorcode || "",
          uniqueorderid:
            response?.uniqueorderid || response?.data?.uniqueorderid || "",
        };
      } catch (orderErr) {
        console.error(`Order failed for ${cred.client_id}:`, orderErr);
        return {
          client_id: cred.client_id,
          status: "ERROR",
          message:
            orderErr.response?.data?.message ||
            orderErr.message ||
            "Order placement failed",
          errorcode: orderErr.response?.data?.errorcode || "MO8000",
        };
      } finally {
        if (mo) {
          try {
            await mo.Logout(cred.client_id);
            console.log(`Logged out for ${cred.client_id}`);
          } catch (logoutErr) {
            console.warn(
              `Logout failed for ${cred.client_id}:`,
              logoutErr.message
            );
          }
        }
      }
    });

    const results = await Promise.all(orderPromises);
    const latency = Date.now() - start;
    console.log(`SDK PlaceOrder latency: ${latency} ms`);
    console.log("Responses:", JSON.stringify(results, null, 2));

    res.json(results);
  } catch (err) {
    console.error("PlaceOrder SDK Error:", err.message);
    res.status(500).json({
      status: "ERROR",
      message: err.message,
      errorcode: "MO8000",
    });
  }
};

module.exports = PlaceOrderSDK;
