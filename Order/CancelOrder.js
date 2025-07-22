const getHeaders = require("../GetHeader");
const axios = require("axios");

const CancelOrder = async (req, res) => {
  try {
    const orderData = {
      //   clientcode: req.body.clientcode,
      uniqueorderid: req.body.uniqueorderid || "1101823KAL005",
    };

    console.log(
      "Cancel Order Request Data:",
      JSON.stringify(orderData, null, 2)
    );

    const response = await axios.post(
      `https://openapi.motilaloswal.com/rest/trans/v1/cancelorder`,
      orderData,
      {
        headers: getHeaders(
          req.body.Authorization,
          req.body.ApiKey,
          req.body.clientcode
        ),
      }
    );

    console.log(
      "Cancel Order Response:",
      JSON.stringify(response.data, null, 2)
    );
    res.json(response.data);
  } catch (error) {
    console.error("Cancel Order Error:", error.response?.data || error.message);
    res.status(500).json({
      status: "ERROR",
      message: error.message,
      errorcode: "MO8000",
    });
  }
};

module.exports = CancelOrder;
