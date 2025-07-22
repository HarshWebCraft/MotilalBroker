const axios = require("axios");
const getHeaders = require("../GetHeader");

const getProfile = async (req, res) => {
  try {
    const reqBodyData = {
      clientcode: req.body.clientcode,
    };

    console.log(reqBodyData);
    const response = await axios.post(
      "https://openapi.motilaloswal.com/rest/login/v1/getprofile",
      reqBodyData,
      {
        headers: getHeaders(
          req.body.Authorization,
          req.body.ApiKey,
          req.body.clientcode
        ),
      }
    );
    console.log(req.body.Authorization, req.body.ApiKey, req.body.clientcode);

    res.json(response.data);
  } catch (error) {
    console.error(
      "Error Fetching Profile",
      error.response?.data || error.message
    );
    res.status(500).json({
      status: "ERROR",
      message: error.message,
    });
  }
};
module.exports = getProfile;
