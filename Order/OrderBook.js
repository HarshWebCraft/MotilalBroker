const axios = require("axios");
const getHeaders = require("../GetHeader");
const mongoose = require("mongoose");
const ClientCredentials = mongoose.model("moCredentials");

const OrderBook = async (req, res) => {
  try {
    const { clientcode } = req.body;

    const credentials = await ClientCredentials.find({
      client_id: { $in: clientcode },
    }).lean();

    console.log("Fetched Credentials:", credentials);

    const response = await axios.post(
      `https://openapi.motilaloswal.com/rest/book/v2/getorderbook`,
      JSON.stringify({
        clientcode: req.body.clientcode,
      }),
      {
        headers: getHeaders(
          credentials[0].auth_token,
          credentials[0].apiKey,
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
