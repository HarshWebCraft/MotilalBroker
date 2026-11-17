const mongoose = require("mongoose");

const moCredentialsSchema = new mongoose.Schema(
  {
    client_id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    apiKey: {
      type: String,
      required: true,
      trim: true,
    },
    auth_token: {
      type: String,
      required: true,
      trim: true,
    },
    // Outbound IP assigned to this account (for example: "65.255.34.3-3").
    ip: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

const moCredentials = mongoose.model("moCredentials", moCredentialsSchema);

module.exports = moCredentials;
