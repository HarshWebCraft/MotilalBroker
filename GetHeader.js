const getHeaders = (
  authToken,
  API_KEY,
  userID,
  sourceIP = "",
  apiSecret = "",
  accessToken = "",
) => {
  const clientIP = String(sourceIP || "").split("-")[0].trim() || "1.2.3.4";

  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "MOSL/V.1.1.0",
    Authorization: authToken,
    ...(accessToken ? { accesstoken: accessToken } : {}),
    ApiKey: API_KEY,
    ...(apiSecret ? { apisecretkey: apiSecret } : {}),
    ClientLocalIp: clientIP,
    ClientPublicIp: clientIP,
    MacAddress: "00:00:00:00:00:00",
    SourceId: "WEB",
    vendorinfo: userID,
    osname: process.env.OS_NAME || "Linux",
    osversion: process.env.OS_VERSION || "YOUR_LINUX_VERSION",
    devicemodel: process.env.DEVICE_MODEL || "VPS",
    manufacturer: process.env.MANUFACTURER || "YOUR_SERVER_PROVIDER",
    productname: process.env.PRODUCT_NAME || "YOUR_REGISTERED_PRODUCT_NAME",
    productversion: process.env.PRODUCT_VERSION || "1.0.0",
    browsername: process.env.BROWSER_NAME || "Chrome",
    browserversion: process.env.BROWSER_VERSION || "105.0",
  };
};

module.exports = getHeaders;
