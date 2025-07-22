const getHeaders = require("../GetHeader");
const speakeasy = require("speakeasy");
const axios = require("axios");
const crypto = require("crypto");

function generateTOTP(secret) {
  return speakeasy.totp({
    secret,
    encoding: "base32",
    digits: 6,
    step: 30,
  });
}

// Utility to hash password
function generateHashedPassword(password, apiKey) {
  const combined = password + apiKey;
  return crypto.createHash("sha256").update(combined).digest("hex");
}

const login = async (req, res) => {
  try {
    // Generate TOTP code using otplib
    const totpCode = generateTOTP(process.env.TOTP_SECRET);
    const hashedPassword = generateHashedPassword(
      process.env.PASSWORD,
      process.env.API_KEY
    );
    const loginData = {
      userid: process.env.USER_ID,
      password: hashedPassword,
      "2FA": process.env.DOB,
      totp: totpCode,
    };

    const response = await axios.post(
      `https://openapi.motilaloswal.com/rest/login/v3/authdirectapi`,
      loginData,
      {
        headers: getHeaders(
          "", // authToken is not needed for login
          process.env.API_KEY,
          process.env.USER_ID
        ),
      }
    );
    console.log("Login Response:", JSON.stringify(response.data, null, 2));

    if (response.data.status === "SUCCESS") {
      authToken = response.data.AuthToken;
      res.json(response.data);
    } else {
      res.status(400).json(response.data);
    }
  } catch (error) {
    console.error("Login Error:", error.response?.data || error.message);
    res.status(500).json({
      status: "ERROR",
      message: error.message,
      errorcode: "MO8000",
    });
  }
};
module.exports = login;
