const axios = require('axios');
const getHeaders = require('../GetHeader');

const TradeDetails = async (req, res) => {
  try {
    const requestData = {
      clientcode: req.body.clientcode || "",
      uniqueorderid: req.body.uniqueorderid || "2700002AA020",
    };

    console.log(
      "Trade Detail Request Data:",
      JSON.stringify(requestData, null, 2)
    );

    const response = await axios.post(
      `https://openapi.motilaloswal.com/rest/book/v1/gettradedetailbyuniqueorderid`,
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
      "Trade Detail Response:",
      JSON.stringify(response.data, null, 2)
    );
    res.json(response.data);
  } catch (error) {
    console.error("Trade Detail Error:", error.response?.data || error.message);
    res.status(500).json({
      status: "ERROR",
      message: error.message,
      errorcode: "MO8000",
    });
  }
};
module.exports = TradeDetails;
