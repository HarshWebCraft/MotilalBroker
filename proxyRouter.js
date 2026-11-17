const { HttpsProxyAgent } = require("https-proxy-agent");
const fs = require("fs");
const path = require("path");
const IP = require("./models/ip");

const CONFIG_PATHS = {
  3: path.join(__dirname, "config", "server3-proxies.json"),
  4: path.join(__dirname, "config", "server4-proxies.json"),
  5: path.join(__dirname, "config", "geonix-proxies.json"),
};
const configCache = new Map();

function cleanIP(value) {
  return String(value || "").trim().split("-")[0].trim();
}

function loadConfig(serverNo) {
  const configPath = CONFIG_PATHS[serverNo];
  if (!configPath) return null;

  const stats = fs.statSync(configPath);
  const cached = configCache.get(serverNo);
  if (!cached || cached.mtimeMs !== stats.mtimeMs) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!config.host && serverNo !== "5") {
      throw new Error(`Server ${serverNo} proxy host is missing: ${configPath}`);
    }
    if (!config.username || !config.password || !config.proxies) {
      throw new Error(`Server ${serverNo} proxy configuration is incomplete: ${configPath}`);
    }
    configCache.set(serverNo, { config, mtimeMs: stats.mtimeMs });
  }
  return configCache.get(serverNo).config;
}

async function getServerNo(sourceIP) {
  const value = String(sourceIP || "").trim();
  const suffix = value.split("-")[1];
  if (["3", "4", "5"].includes(suffix)) return suffix;

  const cleanSourceIP = cleanIP(value);
  if (!cleanSourceIP) return "";
  const ipDocument = await IP.findOne({ XalgoID: "XALGO" }).lean();
  const match = ipDocument?.Ips?.find(
    (entry) => cleanIP(entry.ip) === cleanSourceIP,
  );
  return String(match?.ip || "").split("-")[1] || "";
}

async function getProxyAgent(sourceIP) {
  const cleanSourceIP = cleanIP(sourceIP);
  if (!cleanSourceIP) return null;

  const serverNo = await getServerNo(sourceIP);
  const config = loadConfig(serverNo);
  if (!config) {
    throw new Error(`No proxy server is assigned to IP ${cleanSourceIP}`);
  }

  const entry = config.proxies[cleanSourceIP];
  if (!entry) {
    throw new Error(
      `No Server ${serverNo} proxy is configured for IP ${cleanSourceIP}`,
    );
  }

  const isDetailedEntry = typeof entry === "object" && !Array.isArray(entry);
  const host = isDetailedEntry ? entry.host || config.host : config.host;
  const port = Number(isDetailedEntry ? entry.port : entry);
  const username = (isDetailedEntry && entry.username) || config.username;
  const password = (isDetailedEntry && entry.password) || config.password;

  if (!host || !port || !username || !password) {
    throw new Error(
      `Server ${serverNo} proxy configuration is invalid for IP ${cleanSourceIP}`,
    );
  }

  return {
    serverNo,
    agent: new HttpsProxyAgent(
      `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`,
    ),
  };
}

module.exports = { getProxyAgent };
