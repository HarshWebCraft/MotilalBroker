const axios = require("axios");
const getHeaders = require("../GetHeader");

const OrderDetails = async (req, res) => {
  try {
    const requestData = {
      clientcode: req.body.clientcode || "",
      uniqueorderid: req.body.uniqueorderid || "1000001AA020",
    };

    console.log(
      "Order Detail Request Data:",
      JSON.stringify(requestData, null, 2)
    );

    const response = await axios.post(
      `https://openapi.motilaloswal.com/rest/book/v2/getorderdetailbyuniqueorderid`,
      requestData,
      {
        headers: getHeaders(
          req.body.Authorization,
          req.body.ApiKey,
          req.body.clientcode
        ),
      }
    );

    console.log(
      "Order Detail Response:",
      JSON.stringify(response.data, null, 2)
    );
    res.json(response.data);
  } catch (error) {
    console.error("Order Detail Error:", error.response?.data || error.message);
    res.status(500).json({
      status: "ERROR",
      message: error.message,
      errorcode: "MO8000",
    });
  }
};
module.exports = OrderDetails;
