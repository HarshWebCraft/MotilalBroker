const getHeaders = require("../GetHeader");
const axios = require("axios");

const placeOrder = async (req, res) => {
  try {
    const orderData = req.body;

    const headers = getHeaders(
      orderData.authorization,
      orderData.apiKey,
      orderData.vendorinfo
    );

    console.log("Request Headers:", headers);

    const response = await axios.post(
      "https://openapi.motilaloswal.com/rest/trans/v1/placeorder",
      orderData,
      { headers }
    );

    console.log("orderData :", orderData);
    console.log("headers : ", headers);

    console.log(
      "Place Order Response:",
      JSON.stringify(response.data, null, 2)
    );
    res.json(response.data);
  } catch (error) {
    console.error("Place Order Error:", error.response?.data || error.message);
    res.status(500).json({
      status: "ERROR",
      message: error.message,
      errorcode: "MO8000",
    });
  }
};

module.exports = placeOrder;
