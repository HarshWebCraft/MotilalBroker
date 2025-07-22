const getHeaders = (authToken, API_KEY, userID) => ({
  Accept: "application/json",
  "User-Agent": `MOSL/V.1.1.0`,
  Authorization: authToken,
  ApiKey: API_KEY,
  ClientLocalIp: "1.2.3.4",
  ClientPublicIp: "1.2.3.4",
  MacAddress: "00:00:00:00:00:00",
  SourceId: "WEB",
  vendorinfo: userID,
  osname: "Windows 10",
  osversion: "10.0.19041",
  devicemodel: process.env.DEVICE_MODEL || "AHV",
  manufacturer: process.env.MANUFACTURER || "DELL",
  productname: process.env.PRODUCT_NAME || "Your Product Name",
  productversion: process.env.PRODUCT_VERSION || "Your Product Version",
  browsername: process.env.BROWSER_NAME || "Chrome",
  browserversion: process.env.BROWSER_VERSION || "105.0",
});

module.exports = getHeaders;
