const axios = require("axios");
const getHeaders = require("../GetHeader");

const OrderBook = async (req, res) => {
  try {
    const requestData = {
      clientcode: req.body.clientcode || "",
    };

    console.log(
      "Order Book Request Data:",
      JSON.stringify(requestData, null, 2),
    );

    const response = await axios.post(
      `https://openapi.motilaloswal.com/rest/book/v2/getorderbook`,
      requestData,
      {
        headers: getHeaders(
          "a0073ba28bf7497eaf0e153292f71cc1_M",
          "MlcFqPbIHboh6tzy",
          req.body.clientcode,
        ),
      },
    );

    console.log("Order Book Response:", JSON.stringify(response.data, null, 2));
    res.json(response.data);
  } catch (error) {
    console.error("Order Book Error:", error.response?.data || error.message);
    res.status(500).json({
      status: "ERROR",
      message: error.message,
      errorcode: "MO8000",
    });
  }
};

module.exports = OrderBook;
