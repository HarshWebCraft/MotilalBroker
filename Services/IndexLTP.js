const axios = require("axios");
const getHeaders = require("../GetHeader");

const IndexLTP = async (req, res) => {
  try {
    const reqBodyData = {
      clientcode: req.body.clientcode,
      exchangename: req.body.exchangename,
      scripcode: req.body.scripcode,
    };

    const response = await axios.post(
      `https://openapi.motilaloswal.com/rest/report/v1/getindexltpdata`,
      reqBodyData,
      {
        headers: getHeaders(
          req.body.Authorization,
          req.body.ApiKey,
          req.body.clientcode
        ),
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error(
      "Error Fetching Index LTP :",
      error.response?.data || error.message
    );
    res.status(500).json({
      status: "ERROR",
      message: error.message,
    });
  }
};
module.exports = IndexLTP;
