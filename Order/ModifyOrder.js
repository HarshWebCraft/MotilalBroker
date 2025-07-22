const axios = require("axios");
const getHeaders = require("../GetHeader");

const ModifyOrder = async (req, res) => {
  try {
    console.log(req.body.Authorization);
    const orderData = {
      clientcode: "",
      uniqueorderid: req.body.uniqueorderid || "1101823KAL005",
      newordertype: req.body.newordertype || "LIMIT",
      neworderduration: req.body.neworderduration || "DAY",
      newquantityinlot: req.body.newquantityinlot || 100,
      newdisclosedquantity: req.body.newdisclosedquantity || 0,
      newprice: req.body.newprice || 235.5,
      newtriggerprice: req.body.newtriggerprice || 0,
      newgoodtilldate: req.body.newgoodtilldate || "",
      lastmodifiedtime:
        req.body.lastmodifiedtime ||
        new Date().toLocaleString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      qtytradedtoday: req.body.qtytradedtoday || 0,
    };

    console.log(
      "Modify Order Request Data:",
      JSON.stringify(orderData, null, 2)
    );
    console.log("orderData :", orderData);
    const response = await axios.post(
      `https://openapi.motilaloswal.com/rest/trans/v2/modifyorder`,
      orderData,
      {
        headers: getHeaders(
          req.body.Authorization,
          req.body.ApiKey,
          req.body.vendorinfo
        ),
      }
    );

    console.log(
      "Modify Order Response:",
      JSON.stringify(response.data, null, 2)
    );
    res.json(response.data);
  } catch (error) {
    console.error("Modify Order Error:", error.response?.data || error.message);
    res.status(500).json({
      status: "ERROR",
      message: error.message,
      errorcode: "MO8000",
    });
  }
};

module.exports = ModifyOrder;
